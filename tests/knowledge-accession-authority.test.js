/**
 * Knowledge Accession Authority — ATM-001-K3 / ATM-001-K3-G2 focused suite
 *
 * ATM-001-K3 — SME ACCESSION AUTHORITY & EVIDENCE ENTRY POINT.
 * ATM-001-K3-G2 — KNOWLEDGE PROVENANCE AUTHORIZATION MAPPING (OWNER-approved
 * Option B of the G1 reconciliation).
 *
 * This file proves the authority seam ONLY. It authors no real knowledge, creates
 * no source or evidence of record, changes no schema, and does not touch the
 * legacy TASKS.CREATE / TASKS.UPDATE seam that still guards Knowledge Pack and
 * Standards Crosswalk authoring (out of this change's bounded scope).
 *
 * The approved mapping (docs/architecture/ATM-001-K3-G2-…)
 * --------------------------------------------------------
 *   knowledge.author   POST /sources, POST /sources/:id/versions
 *     Authoring a provenance source identity and its immutable editions
 *     (`created_by_user_id`; ATM-003-R1 §3.1 "Create and edit a draft definition").
 *   evidence.attach    POST /templates/:id/evidence, DELETE …/evidence/:id
 *     Attaching and detaching provenance evidence on a working definition or step
 *     (`added_by_user_id`; ATM-003-R1 §3.1 "Attach provenance evidence to a
 *     definition or step").
 *   KNOWLEDGE.VIEW     the three read routes, unchanged.
 *
 * Why the mapping changed. ATM-001-K3 (commit 3aa5bbd) placed all four mutation
 * routes under `knowledge.author`. Because the legacy supervisor bundle holds
 * `knowledge.author` but deliberately excludes `evidence.attach` (ATM-003-R3 §3/§4,
 * under the OWNER adjudication of 2026-09-27 §7 — "do not silently grant an
 * existing role an action it could not previously perform"), the supervisor
 * silently gained provenance evidence attachment and the recorded recovery
 * ("explicit grant of evidence.attach") conferred nothing. K3-G2 reconciles the
 * routes with ATM-003-R1 §3.1's two accountable acts and two attribution columns.
 *
 * Capability bundles are unchanged. A principal needing both acts receives both
 * capabilities through explicit grants.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const {
  LEGACY_COMPATIBILITY_BUNDLES,
  isGrantable
} = require('../src/config/capabilities');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating knowledge-accession-authority suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// Disposable fixtures. The id block MUST stay disjoint from every other suite's:
// the sanctioned runner executes suites in PARALLEL PROCESSES against ONE shared
// database, and every fixture uses `ON CONFLICT (id) DO NOTHING`, so a colliding
// id is not an error — it is a silent substitution of another suite's principal,
// with another suite's role and organization. `9994xx` is unused corpus-wide, and
// R15 asserts that mechanically so the collision cannot return unnoticed.
const ORG = 999401;
const ORG_B = 999402;
const ADMIN = 999411;          // legacy bundle: knowledge.author + evidence.attach
const SUPERVISOR = 999412;     // legacy bundle: knowledge.author only
const OPERATOR = 999413;       // legacy bundle: neither
const SME = 999414;            // operator + EXPLICIT knowledge.author
const FOREIGN_SME = 999415;    // ORG_B operator + EXPLICIT knowledge.author + evidence.attach
const FOREIGN_ADMIN = 999416;  // ORG_B admin, grantor for ORG_B
const EV_ONLY = 999417;        // operator + EXPLICIT evidence.attach only
const STEWARD = 999418;        // operator + EXPLICIT knowledge.author + evidence.attach
const SUPERVISOR_EV = 999419;  // supervisor + EXPLICIT evidence.attach only
const CATEGORY = 999421;
const CLASS = 999422;
const EQUIPMENT_TYPE = 999423;

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const ROUTES_FILE = path.join(__dirname, '..', 'src', 'routes', 'knowledge-provenance.routes.js');

async function withConn(fn) {
  const conn = await getConnection();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

const query = (conn, sql, params) => conn.query(sql, params);

let seq = 0;
const uniq = () => `${Date.now()}-${++seq}`;

/**
 * Idempotent explicit grant. `user_capabilities` rows are NEVER deleted — the
 * migration 022 trigger refuses DELETE ("a record of an accountable act"), so the
 * fixture inserts only when no active grant exists. A revoked grant is history and
 * may legitimately coexist with a later active grant, which is exactly what the
 * revocation test below relies on.
 */
async function grantCapability(conn, userId, orgId, capability, grantedBy) {
  await query(conn,
    `INSERT INTO user_capabilities (user_id, organization_id, capability, source, granted_by_user_id)
     SELECT ?, ?, ?, 'explicit', ?
      WHERE NOT EXISTS (
        SELECT 1 FROM user_capabilities
         WHERE user_id = ? AND organization_id = ? AND capability = ? AND revoked_at IS NULL
      )`,
    [userId, orgId, capability, grantedBy, userId, orgId, capability]);
}

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG, 'K3 Accession Org'], [ORG_B, 'K3 Foreign Org']]) {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [id, name]);
    }
    for (const [id, username, role, orgId] of [
      [ADMIN, 'k3-admin', 'admin', ORG],
      [SUPERVISOR, 'k3-supervisor', 'supervisor', ORG],
      [OPERATOR, 'k3-operator', 'operator', ORG],
      [SME, 'k3-sme', 'operator', ORG],
      [FOREIGN_SME, 'k3-foreign-sme', 'operator', ORG_B],
      [FOREIGN_ADMIN, 'k3-foreign-admin', 'admin', ORG_B],
      [EV_ONLY, 'k3-evidence-only', 'operator', ORG],
      [STEWARD, 'k3-steward', 'operator', ORG],
      [SUPERVISOR_EV, 'k3-supervisor-events', 'supervisor', ORG]
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'K3 Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, orgId]);
    }

    // Explicit grants are issued per accountable act. Migration 022 refuses a
    // grant whose grantor is outside the grant's organization, so each tenant is
    // granted by its own administrator (who holds both capabilities via the admin
    // bundle and therefore does not depend on this suite's grants).
    await grantCapability(conn, SME, ORG, 'knowledge.author', ADMIN);
    await grantCapability(conn, FOREIGN_SME, ORG_B, 'knowledge.author', FOREIGN_ADMIN);
    await grantCapability(conn, FOREIGN_SME, ORG_B, 'evidence.attach', FOREIGN_ADMIN);
    await grantCapability(conn, EV_ONLY, ORG, 'evidence.attach', ADMIN);
    await grantCapability(conn, STEWARD, ORG, 'knowledge.author', ADMIN);
    await grantCapability(conn, STEWARD, ORG, 'evidence.attach', ADMIN);
    await grantCapability(conn, SUPERVISOR_EV, ORG, 'evidence.attach', ADMIN);

    await query(conn, `INSERT INTO equipment_categories (id, category_code, category_name)
      VALUES (?, 'K3CAT', 'K3 Category') ON CONFLICT (id) DO NOTHING`, [CATEGORY]);
    await query(conn, `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
      VALUES (?, ?, 'K3CLS', 'K3 Class') ON CONFLICT (id) DO NOTHING`, [CLASS, CATEGORY]);
    await query(conn, `INSERT INTO equipment_types (id, class_id, type_code, type_name)
      VALUES (?, ?, 'K3TYPE', 'K3 Equipment Type') ON CONFLICT (id) DO NOTHING`, [EQUIPMENT_TYPE, CLASS]);
  });
}

/** A working task template in the given organization, with one step. */
async function createWorkingTemplate(orgId = ORG) {
  return withConn(async (conn) => {
    const [template] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name,
         maintenance_type, task_kind, frequency_value, frequency_unit, estimated_duration_minutes, priority, knowledge_type_id, task_family_id, maintenance_strategy, trigger_mechanism, knowledge_scope, content_origin,
         ai_assisted, ai_assistance_detail)
       VALUES (?, ?, ?, 'K3 Working Template', 'preventive', 'inspection', NULL, NULL, 30, 'medium', (SELECT id FROM knowledge_types WHERE type_code='MAINTENANCE_PROCEDURE'), (SELECT id FROM task_families WHERE family_code='inspect'), 'preventive', 'no_fixed_interval', 'customer', 'authored', FALSE, NULL)
       RETURNING id`,
      [EQUIPMENT_TYPE, orgId, `K3-TPL-${uniq()}`]);
    await query(conn,
      `INSERT INTO task_template_equipment_types
         (task_template_id, equipment_type_id, is_primary, added_by_user_id)
       VALUES (?, ?, true, ?)`,
      [template.id, EQUIPMENT_TYPE, ADMIN]);
    await query(conn,
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, 1, 'instruction', 'Working step', true)`, [template.id]);
    return template.id;
  });
}

// ---------------------------------------------------------------- HTTP helpers

let server;
let port;

function call(method, path_, { userId, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: path_,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(userId ? { Authorization: `Bearer ${jwt.sign({ userId }, JWT_SECRET)}` } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = String(data).slice(0, 200); }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sourcePayload = (overrides = {}) => ({
  sourceCode: `K3-SRC-${uniq()}`,
  sourceCategory: 'manufacturer_manual',
  defaultTitle: 'K3 Accessioned Source',
  issuingOrganization: 'Example Manufacturer',
  ...overrides
});

const versionPayload = (overrides = {}) => ({
  versionDesignation: '1.0',
  title: 'K3 Accessioned Source Version',
  referenceNumber: 'REF-K3',
  publicationDate: '2026-01-15',
  ...overrides
});

const evidencePayload = (versionId, overrides = {}) => ({
  knowledgeSourceVersionId: versionId,
  sectionOrClause: 'S1',
  ...overrides
});

/** Create a source + version through the real API and return both ids. */
async function authorSourceAndVersion(userId) {
  const source = await call('POST', '/api/knowledge-provenance/sources', { userId, body: sourcePayload() });
  assert.strictEqual(source.status, 201, `source creation failed: ${JSON.stringify(source.body)}`);
  const sourceId = source.body.data.source.id;

  const version = await call('POST', `/api/knowledge-provenance/sources/${sourceId}/versions`, {
    userId, body: versionPayload()
  });
  assert.strictEqual(version.status, 201, `version creation failed: ${JSON.stringify(version.body)}`);
  return { sourceId, versionId: version.body.data.version.id };
}

/** Attach working evidence through the real API and return its id. */
async function attachEvidence(templateId, versionId, userId) {
  const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
    userId, body: evidencePayload(versionId)
  });
  assert.strictEqual(res.status, 201, `evidence attachment failed: ${JSON.stringify(res.body)}`);
  return res.body.data.evidence.id;
}

/** The four mutation routes, for the "all four behave alike" checks. */
const MUTATIONS = ['sources', 'versions', 'attach', 'detach'];

describe('Knowledge Accession Authority (ATM-001-K3 / K3-G2)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    const app = require('../src/app');
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  // =========================================================================
  // knowledge.author — the authoring half (sources and editions)
  // =========================================================================

  it('R1 — a principal holding knowledge.author accessions a source (created_by recorded)', async () => {
    const res = await call('POST', '/api/knowledge-provenance/sources', {
      userId: SUPERVISOR, body: sourcePayload()
    });
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.source.source_code.startsWith('K3-SRC-'), true);
    assert.strictEqual(Number(res.body.data.source.organization_id), ORG);
    // ATM-003-R1 §3.1 names created_by as the enforcement evidence for
    // knowledge.author; widening the reach must not lose the accountability record.
    assert.strictEqual(Number(res.body.data.source.created_by_user_id), SUPERVISOR);
  });

  it('R2 — the same principal creates an immutable source version', async () => {
    const { versionId } = await authorSourceAndVersion(SUPERVISOR);
    assert.ok(versionId > 0, 'source version must be created');
  });

  // =========================================================================
  // evidence.attach — the citation half, and why the supervisor needs a grant
  // =========================================================================

  it('R3 — a legacy supervisor holding knowledge.author but NOT evidence.attach is refused on evidence attachment', async () => {
    const templateId = await createWorkingTemplate();
    const { versionId } = await authorSourceAndVersion(ADMIN);

    const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: SUPERVISOR, body: evidencePayload(versionId)
    });
    assert.strictEqual(res.status, 403,
      `legacy supervisor must not gain evidence attachment: ${JSON.stringify(res.body)}`);
    assert.match(String(res.body.message), /evidence\.attach/,
      'the refusal must name the required capability');

    // Nothing was written: a capability refusal is not a partial write.
    const rows = await withConn((conn) => query(conn,
      `SELECT COUNT(*)::int AS n FROM knowledge_template_evidence
        WHERE task_template_id = ? AND knowledge_source_version_id = ?`, [templateId, versionId]));
    assert.strictEqual(Number(rows[0].n), 0, 'a refused attachment must create no evidence row');
  });

  it('R4 — the same supervisor is refused on evidence detachment', async () => {
    const templateId = await createWorkingTemplate();
    const { versionId } = await authorSourceAndVersion(ADMIN);
    const evidenceId = await attachEvidence(templateId, versionId, ADMIN);

    const res = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${evidenceId}`,
      { userId: SUPERVISOR });
    assert.strictEqual(res.status, 403,
      `legacy supervisor must not gain evidence detachment: ${JSON.stringify(res.body)}`);
    assert.match(String(res.body.message), /evidence\.attach/);

    const rows = await withConn((conn) => query(conn,
      `SELECT COUNT(*)::int AS n FROM knowledge_template_evidence WHERE id = ?`, [evidenceId]));
    assert.strictEqual(Number(rows[0].n), 1, 'the refused detach must not remove the row');
  });

  it('R5 — a principal holding neither capability is refused on all four mutations, naming the capability per route', async () => {
    const templateId = await createWorkingTemplate();
    const { versionId } = await authorSourceAndVersion(ADMIN);

    const attempts = [
      ['sources', 'knowledge.author', () => call('POST', '/api/knowledge-provenance/sources', { userId: OPERATOR, body: sourcePayload() })],
      ['versions', 'knowledge.author', () => call('POST', '/api/knowledge-provenance/sources/1/versions', { userId: OPERATOR, body: versionPayload() })],
      ['attach', 'evidence.attach', () => call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, { userId: OPERATOR, body: evidencePayload(versionId) })],
      ['detach', 'evidence.attach', () => call('DELETE', `/api/knowledge-provenance/templates/${templateId}/evidence/1`, { userId: OPERATOR })]
    ];

    for (const [label, capability, attempt] of attempts) {
      const res = await attempt();
      assert.strictEqual(res.status, 403, `${label}: expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
      // The refusal must name the capability that route is actually guarded by,
      // proving the guard is capability-based and correctly mapped.
      assert.match(String(res.body.message), new RegExp(capability.replace('.', '\\.')),
        `${label}: refusal must name ${capability}, got ${JSON.stringify(res.body)}`);
    }
    assert.strictEqual(attempts.length, MUTATIONS.length);
  });

  it('R6 — an unauthenticated caller is refused with 401 on all four mutations', async () => {
    const attempts = [
      () => call('POST', '/api/knowledge-provenance/sources', { body: sourcePayload() }),
      () => call('POST', '/api/knowledge-provenance/sources/1/versions', { body: versionPayload() }),
      () => call('POST', '/api/knowledge-provenance/templates/1/evidence', { body: evidencePayload(1) }),
      () => call('DELETE', '/api/knowledge-provenance/templates/1/evidence/1')
    ];
    for (const attempt of attempts) {
      const res = await attempt();
      assert.strictEqual(res.status, 401, `expected 401, got ${res.status}`);
    }
  });

  // =========================================================================
  // The approved mapping, principal by principal
  // =========================================================================

  it('R7 — an explicit knowledge.author grant exposes authoring but NOT evidence attachment', async () => {
    // The SME holds role `operator`, so the legacy bundle grants them nothing
    // here; their ONLY authority is the explicit knowledge.author grant.
    const templateId = await createWorkingTemplate();
    const { sourceId, versionId } = await authorSourceAndVersion(SME);
    assert.ok(sourceId > 0, 'knowledge.author must author a source');

    const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: SME, body: evidencePayload(versionId)
    });
    assert.strictEqual(res.status, 403,
      `knowledge.author alone must not attach evidence: ${JSON.stringify(res.body)}`);
    assert.match(String(res.body.message), /evidence\.attach/);
  });

  it('R8 — an explicit evidence.attach grant alone exposes citation but NOT authoring', async () => {
    const templateId = await createWorkingTemplate();
    const { sourceId, versionId } = await authorSourceAndVersion(ADMIN);

    const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: EV_ONLY, body: evidencePayload(versionId)
    });
    assert.strictEqual(attached.status, 201,
      `evidence.attach alone must permit citation: ${JSON.stringify(attached.body)}`);
    assert.strictEqual(Number(attached.body.data.evidence.added_by_user_id), EV_ONLY);

    const detached = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${attached.body.data.evidence.id}`,
      { userId: EV_ONLY });
    assert.strictEqual(detached.status, 200, `evidence.attach alone must permit detachment: ${JSON.stringify(detached.body)}`);

    const source = await call('POST', '/api/knowledge-provenance/sources', { userId: EV_ONLY, body: sourcePayload() });
    assert.strictEqual(source.status, 403, 'evidence.attach must not author a source');
    assert.match(String(source.body.message), /knowledge\.author/);

    const version = await call('POST', `/api/knowledge-provenance/sources/${sourceId}/versions`, {
      userId: EV_ONLY, body: versionPayload()
    });
    assert.strictEqual(version.status, 403, 'evidence.attach must not author a source version');
    assert.match(String(version.body.message), /knowledge\.author/);
  });

  it('R9 — both capabilities together complete the whole provenance entry point', async () => {
    const templateId = await createWorkingTemplate();
    const { sourceId, versionId } = await authorSourceAndVersion(STEWARD);
    assert.ok(sourceId > 0);

    const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: STEWARD, body: evidencePayload(versionId)
    });
    assert.strictEqual(attached.status, 201, `expected 201, got ${attached.status}: ${JSON.stringify(attached.body)}`);
    assert.strictEqual(Number(attached.body.data.evidence.added_by_user_id), STEWARD);

    const detached = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${attached.body.data.evidence.id}`,
      { userId: STEWARD });
    assert.strictEqual(detached.status, 200);
  });

  it('R10 — an explicitly granted supervisor can attach and detach within authorized tenant scope', async () => {
    // SUPERVISOR_EV holds an active explicit evidence.attach grant, so the
    // resolver returns EXPLICIT_GRANTS mode and the legacy supervisor bundle is
    // discarded entirely — they hold evidence.attach and nothing else.
    const templateId = await createWorkingTemplate();
    const { versionId } = await authorSourceAndVersion(ADMIN);

    const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: SUPERVISOR_EV, body: evidencePayload(versionId)
    });
    assert.strictEqual(attached.status, 201,
      `explicit evidence.attach grant must recover citation: ${JSON.stringify(attached.body)}`);
    assert.strictEqual(Number(attached.body.data.evidence.added_by_user_id), SUPERVISOR_EV);

    const detached = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${attached.body.data.evidence.id}`,
      { userId: SUPERVISOR_EV });
    assert.strictEqual(detached.status, 200);

    // The grant is for the evidence act only: it does not confer authoring.
    const source = await call('POST', '/api/knowledge-provenance/sources', {
      userId: SUPERVISOR_EV, body: sourcePayload()
    });
    assert.strictEqual(source.status, 403, 'an evidence.attach grant must not author a source');
    assert.match(String(source.body.message), /knowledge\.author/);
  });

  it('R11 — both provenance capabilities confer no review, approval, safety-review or publication authority', async () => {
    const templateId = await createWorkingTemplate();
    const governed = [
      ['submit-for-review', 'knowledge.review'],
      ['reject', 'knowledge.review'],
      ['reopen', 'knowledge.review'],
      ['approve', 'knowledge.approve'],
      ['safety-review', 'knowledge.safety_review'],
      ['publish', 'knowledge.publish']
    ];
    for (const [route, capability] of governed) {
      const res = await call('POST', `/api/task-templates/${templateId}/${route}`, {
        userId: STEWARD, body: {}
      });
      assert.strictEqual(res.status, 403, `${route}: expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.match(String(res.body.message), new RegExp(capability.replace('.', '\\.')),
        `${route}: refusal must name ${capability}, got ${JSON.stringify(res.body)}`);
    }
  });

  it('R12 — read authority is unchanged and still reaches the provenance surface', async () => {
    const { sourceId } = await authorSourceAndVersion(ADMIN);
    for (const [label, userId] of [['supervisor', SUPERVISOR], ['operator', OPERATOR]]) {
      const list = await call('GET', '/api/knowledge-provenance/sources', { userId });
      assert.strictEqual(list.status, 200, `${label} source list: ${JSON.stringify(list.body)}`);
      assert.ok(Array.isArray(list.body.data.sources));

      const versions = await call('GET', `/api/knowledge-provenance/sources/${sourceId}/versions`, { userId });
      assert.strictEqual(versions.status, 200, `${label} version list: ${JSON.stringify(versions.body)}`);
    }
  });

  it('R13 — the legacy admin (both capabilities) is not narrowed', async () => {
    const templateId = await createWorkingTemplate();
    const { sourceId, versionId } = await authorSourceAndVersion(ADMIN);
    assert.ok(sourceId > 0);

    const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: ADMIN, body: evidencePayload(versionId)
    });
    assert.strictEqual(attached.status, 201, `admin attach: ${JSON.stringify(attached.body)}`);

    const detached = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${attached.body.data.evidence.id}`,
      { userId: ADMIN });
    assert.strictEqual(detached.status, 200, `admin detach: ${JSON.stringify(detached.body)}`);
  });

  it('R14 — the mapping does not weaken tenancy', async () => {
    const templateId = await createWorkingTemplate(ORG);

    // A principal in ORG_B who holds BOTH provenance capabilities may accession
    // into their OWN tenant...
    const foreign = await authorSourceAndVersion(FOREIGN_SME);
    const ownSource = await call('GET', '/api/knowledge-provenance/sources', { userId: FOREIGN_SME });
    assert.strictEqual(ownSource.status, 200);
    assert.ok(ownSource.body.data.sources.some((s) => Number(s.organization_id) === ORG_B),
      'the foreign SME must see their own tenant\'s source');

    // ...but must not reach ORG's working knowledge. Another tenant's subject is
    // reported as not-found rather than disclosed, even though the guard passes.
    const crossAttach = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: FOREIGN_SME, body: evidencePayload(foreign.versionId)
    });
    assert.strictEqual(crossAttach.status, 404,
      `cross-tenant attach must be refused, got ${crossAttach.status}: ${JSON.stringify(crossAttach.body)}`);

    const crossDetach = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/1`, { userId: FOREIGN_SME });
    assert.strictEqual(crossDetach.status, 404,
      `cross-tenant detach must be refused, got ${crossDetach.status}: ${JSON.stringify(crossDetach.body)}`);

    // And no cross-tenant evidence row was written.
    const rows = await withConn((conn) => query(conn,
      `SELECT COUNT(*)::int AS n FROM knowledge_template_evidence
        WHERE task_template_id = ? AND knowledge_source_version_id = ?`,
      [templateId, foreign.versionId]));
    assert.strictEqual(Number(rows[0].n), 0, 'no cross-tenant evidence row may exist');
  });

  // =========================================================================
  // Structural guarantees against silent drift
  // =========================================================================

  it('R15 — the guard-to-capability map is the approved map, and the bundles agree', async () => {
    // Code lines only: a comment mentioning a seam must not satisfy this.
    const code = fs.readFileSync(ROUTES_FILE, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');

    assert.doesNotMatch(code, /requirePermission\('TASKS'/,
      'the provenance routes must no longer be guarded by the legacy TASKS matrix');

    // The exact per-route binding. This is the guard-to-capability regression
    // assertion: it names each route, so a future edit that silently moves a
    // route back onto the wrong capability fails here — the blind spot that let
    // the ATM-001-K3 discrepancy through (the parity test checked bundles, the
    // old accession test checked only a total).
    assert.match(code, /router\.post\('\/sources', requireCapability\('knowledge\.author'\)/,
      'POST /sources must require knowledge.author');
    assert.match(code, /router\.post\('\/sources\/:id\/versions', requireCapability\('knowledge\.author'\)/,
      'POST /sources/:id/versions must require knowledge.author');
    assert.match(code, /router\.post\('\/templates\/:templateId\/evidence', requireCapability\('evidence\.attach'\)/,
      'POST /templates/:templateId/evidence must require evidence.attach');
    assert.match(code, /router\.delete\('\/templates\/:templateId\/evidence\/:evidenceId', requireCapability\('evidence\.attach'\)/,
      'DELETE /templates/:templateId/evidence/:evidenceId must require evidence.attach');

    assert.strictEqual((code.match(/requireCapability\('knowledge\.author'\)/g) || []).length, 2,
      'exactly the two authoring routes require knowledge.author');
    assert.strictEqual((code.match(/requireCapability\('evidence\.attach'\)/g) || []).length, 2,
      'exactly the two evidence routes require evidence.attach');
    assert.strictEqual((code.match(/requirePermission\('KNOWLEDGE', 'VIEW'\)/g) || []).length, 3,
      'the three read routes must keep KNOWLEDGE.VIEW unchanged');

    // Both capabilities must be human-grantable, or the approved recovery
    // ("explicit grant of evidence.attach") could not exist.
    assert.strictEqual(isGrantable('knowledge.author'), true);
    assert.strictEqual(isGrantable('evidence.attach'), true);

    // Guard ↔ bundle agreement. evidence.attach was admin-only before the
    // capability model and is deliberately absent from the supervisor and
    // operator bundles (ATM-003-R3 §3/§4). If a future change either swaps the
    // route guards or adds the capability to a less-privileged bundle, the
    // mapping and the bundles would disagree again — this catches both halves.
    assert.ok(LEGACY_COMPATIBILITY_BUNDLES.supervisor.includes('knowledge.author'),
      'the supervisor bundle must hold knowledge.author');
    assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.supervisor.includes('evidence.attach'),
      'the supervisor bundle must NOT hold evidence.attach (ATM-003-R3 §4)');
    assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.operator.includes('knowledge.author'),
      'the operator bundle must not hold knowledge.author');
    assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.operator.includes('evidence.attach'),
      'the operator bundle must not hold evidence.attach');
    assert.ok(LEGACY_COMPATIBILITY_BUNDLES.admin.includes('knowledge.author'),
      'the admin bundle must hold knowledge.author');
    assert.ok(LEGACY_COMPATIBILITY_BUNDLES.admin.includes('evidence.attach'),
      'the admin bundle must hold evidence.attach');

    // Fixture-namespace disjointness, asserted mechanically.
    //
    // The sanctioned runner executes suites in PARALLEL PROCESSES against ONE
    // shared database, and every fixture here uses `ON CONFLICT (id) DO NOTHING`.
    // A colliding id is therefore NOT an error: the other suite's row survives and
    // this suite silently resolves a principal with another suite's role and
    // organization. CI caught exactly that once; this assertion makes the class
    // of defect impossible to reintroduce unnoticed.
    const fixtureIds = [ORG, ORG_B, ADMIN, SUPERVISOR, OPERATOR, SME, FOREIGN_SME,
      FOREIGN_ADMIN, EV_ONLY, STEWARD, SUPERVISOR_EV, CATEGORY, CLASS, EQUIPMENT_TYPE];
    const self = path.basename(__filename);
    const siblings = fs.readdirSync(__dirname)
      .filter((name) => name.endsWith('.test.js') && name !== self);
    assert.ok(siblings.length > 10, 'expected a populated test corpus to check against');

    for (const id of fixtureIds) {
      for (const name of siblings) {
        const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
        assert.ok(!new RegExp(`\\b${id}\\b`).test(text),
          `fixture id ${id} is already used by ${name}; the shared-database corpus `
          + 'requires a disjoint id block');
      }
    }
  });

  it('R16 — revoking either grant closes that half of the entry point again', async () => {
    // Authority that cannot be withdrawn is not a grant. Revocation is the
    // migration 022 contract: a revoked grant is history, never deleted.

    // (a) knowledge.author revoked -> authoring closes.
    await withConn(async (conn) => {
      await query(conn,
        `UPDATE user_capabilities
            SET revoked_at = CURRENT_TIMESTAMP, revoked_by_user_id = ?
          WHERE user_id = ? AND organization_id = ? AND capability = 'knowledge.author'
            AND revoked_at IS NULL`,
        [ADMIN, SME, ORG]);
    });

    const authoring = await call('POST', '/api/knowledge-provenance/sources', {
      userId: SME, body: sourcePayload()
    });
    assert.strictEqual(authoring.status, 403,
      `after revocation the SME must be refused, got ${authoring.status}: ${JSON.stringify(authoring.body)}`);
    assert.match(String(authoring.body.message), /knowledge\.author/);

    // Restore the fixture for any later run in the same database (a new active
    // grant is the documented remedy; the revoked row is preserved as history).
    await withConn((conn) => grantCapability(conn, SME, ORG, 'knowledge.author', ADMIN));

    // (b) evidence.attach revoked -> citation closes, authoring is unaffected.
    await withConn(async (conn) => {
      await query(conn,
        `UPDATE user_capabilities
            SET revoked_at = CURRENT_TIMESTAMP, revoked_by_user_id = ?
          WHERE user_id = ? AND organization_id = ? AND capability = 'evidence.attach'
            AND revoked_at IS NULL`,
        [ADMIN, STEWARD, ORG]);
    });

    const templateId = await createWorkingTemplate();
    const { sourceId, versionId } = await authorSourceAndVersion(STEWARD);
    assert.ok(sourceId > 0, 'the still-held knowledge.author grant must continue to author');

    const citation = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: STEWARD, body: evidencePayload(versionId)
    });
    assert.strictEqual(citation.status, 403,
      `after revocation the Steward must be refused citation, got ${citation.status}: ${JSON.stringify(citation.body)}`);
    assert.match(String(citation.body.message), /evidence\.attach/);

    await withConn((conn) => grantCapability(conn, STEWARD, ORG, 'evidence.attach', ADMIN));
  });

  // Cleanup happens via process exit; the suite leaves disposable fixtures in the
  // sanctioned test database, consistent with the other M1/M2/I-series suites.
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });
});
