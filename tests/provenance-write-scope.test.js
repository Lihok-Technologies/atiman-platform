/**
 * Provenance Write Scope — ATM-001-K3-R1 adversarial suite
 *
 * ATM-001-K3-R1 — SHARED PROVENANCE WRITE-SCOPE REMEDIATION (MAJOR-1).
 *
 * Independent K3 VUDA reproduced that a tenant principal holding only
 * `knowledge.author` could create a new immutable version under a GLOBAL source
 * (`organization_id IS NULL`), writing into shared reference provenance that is
 * intentionally readable across tenants. The cause was that `createVersion`
 * authorized its parent source through the READ predicate
 * (`organization_id IS NULL OR organization_id = ?`), conflating "a tenant may
 * reference shared provenance" with "a tenant may write shared provenance".
 *
 * Ratified architecture this suite enforces:
 *   - ATM-000 §4: "Customer data is isolated; shared knowledge is referenceable
 *     but immutable to tenants."
 *   - ATM-001 M3: "Shared reference provenance remains a system/OWNER act."
 *   - ATM-001 M5R3A §2.1: `organization_id IS NULL` IS a global/system source, and
 *     `findSourceById` is deliberately global-inclusive so tenants can READ it.
 *   - ATM-001 M5R3A §3.3: application authoring of a global source is NO — BY
 *     DESIGN AND PRESERVED; the executable OWNER mechanism (D) is NOT IMPLEMENTED,
 *     so such rows "can only come from a direct, governed system/OWNER database
 *     operation outside the tenant authoring path" (§3.4).
 *   - Migration 011 trigger: "Global source (NULL org) supports any template" —
 *     global CITATION must keep working.
 *
 * The global source/version fixture below is created the way the ratified records
 * say global provenance is created: directly, out of band, with
 * `organization_id IS NULL` and `created_by_user_id IS NULL`. It mirrors the shape
 * of the two real global sources in production.
 *
 * Database-mutating suite: gated on isIntegrationTest().
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating provenance-write-scope suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// Disposable fixtures. The block MUST stay disjoint from every other suite's: the
// sanctioned runner executes suites in PARALLEL PROCESSES against ONE shared
// database, and fixtures insert with ON CONFLICT DO NOTHING, so a colliding id
// silently substitutes another suite's principal (with its role and organization)
// instead of failing. The corpus-wide 9971xx debt is deliberately NOT repaired
// here; this assertion protects only the ids this mission introduces.
const ORG_A = 999601;
const ORG_B = 999602;
const AUTHOR = 999611;    // ORG_A, explicit knowledge.author
const NO_CAP = 999612;    // ORG_A, no knowledge.author
const AUTHOR_B = 999613;  // ORG_B, explicit knowledge.author
const GRANTOR = 999614;   // ORG_A admin, grants the explicit capabilities
const GRANTOR_B = 999615; // ORG_B admin — migration 022 requires a same-tenant grantor
const CATEGORY = 999621;
const CLASS = 999622;
const EQUIPMENT_TYPE = 999623;

// Stable, run-invariant identity for the out-of-band global reference provenance.
const GLOBAL_SOURCE_CODE = 'K3R1-GLOBAL-REF';
const GLOBAL_VERSION = 'R1';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';

let globalSourceId = null;
let globalVersionId = null;

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

/** Idempotent explicit grant; user_capabilities rows are never deleted. */
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
    for (const [id, name] of [[ORG_A, 'K3R1 Tenant A'], [ORG_B, 'K3R1 Tenant B']]) {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [id, name]);
    }
    for (const [id, username, role, orgId] of [
      [AUTHOR, 'k3r1-author', 'operator', ORG_A],
      [NO_CAP, 'k3r1-nocap', 'operator', ORG_A],
      [AUTHOR_B, 'k3r1-author-b', 'operator', ORG_B],
      [GRANTOR, 'k3r1-grantor', 'admin', ORG_A],
      [GRANTOR_B, 'k3r1-grantor-b', 'admin', ORG_B]
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'K3R1 Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, orgId]);
    }

    // `knowledge.author` only. Neither principal is a legacy admin or supervisor,
    // so every allowance below comes from the capability alone. Migration 022
    // refuses a grant whose grantor is outside the grant's organization, so each
    // tenant is granted by its own administrator.
    await grantCapability(conn, AUTHOR, ORG_A, 'knowledge.author', GRANTOR);
    await grantCapability(conn, AUTHOR_B, ORG_B, 'knowledge.author', GRANTOR_B);

    await query(conn, `INSERT INTO equipment_categories (id, category_code, category_name)
      VALUES (?, 'K3R1CAT', 'K3R1 Category') ON CONFLICT (id) DO NOTHING`, [CATEGORY]);
    await query(conn, `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
      VALUES (?, ?, 'K3R1CLS', 'K3R1 Class') ON CONFLICT (id) DO NOTHING`, [CLASS, CATEGORY]);
    await query(conn, `INSERT INTO equipment_types (id, class_id, type_code, type_name)
      VALUES (?, ?, 'K3R1TYPE', 'K3R1 Equipment Type') ON CONFLICT (id) DO NOTHING`, [EQUIPMENT_TYPE, CLASS]);

    // ---- Global reference provenance: the ratified system/OWNER act, out of band.
    const existingSource = await query(conn,
      `SELECT id FROM knowledge_sources WHERE organization_id IS NULL AND source_code = ?`,
      [GLOBAL_SOURCE_CODE]);
    if (existingSource.length > 0) {
      globalSourceId = existingSource[0].id;
    } else {
      const [row] = await query(conn,
        `INSERT INTO knowledge_sources
           (source_code, source_category, default_title, issuing_organization, organization_id, created_by_user_id)
         VALUES (?, 'engineering_standard', 'K3R1 Global Reference', 'Global Standards Body', NULL, NULL)
         RETURNING id`,
        [GLOBAL_SOURCE_CODE]);
      globalSourceId = row.id;
    }

    const existingVersion = await query(conn,
      `SELECT id FROM knowledge_source_versions
        WHERE knowledge_source_id = ? AND version_designation = ?`,
      [globalSourceId, GLOBAL_VERSION]);
    if (existingVersion.length > 0) {
      globalVersionId = existingVersion[0].id;
    } else {
      const [row] = await query(conn,
        `INSERT INTO knowledge_source_versions
           (knowledge_source_id, version_designation, title, reference_number,
            issuing_organization, publication_date, created_by_user_id)
         VALUES (?, ?, 'K3R1 Global Reference Edition', 'GLOBAL-REF-1',
                 'Global Standards Body', '2026-01-01', NULL)
         RETURNING id`,
        [globalSourceId, GLOBAL_VERSION]);
      globalVersionId = row.id;
    }
  });
}

/** A working task template in the given organization, with one step. */
async function createWorkingTemplate(orgId) {
  return withConn(async (conn) => {
    const [template] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name,
         maintenance_type, task_kind, frequency_value, frequency_unit, estimated_duration_minutes, priority, knowledge_type_id, task_family_id, maintenance_strategy, trigger_mechanism, knowledge_scope, content_origin,
         ai_assisted, ai_assistance_detail)
       VALUES (?, ?, ?, 'K3R1 Working Template', 'preventive', 'inspection', NULL, NULL, 30, 'medium', (SELECT id FROM knowledge_types WHERE type_code='MAINTENANCE_PROCEDURE'), (SELECT id FROM task_families WHERE family_code='inspect'), 'preventive', 'no_fixed_interval', 'customer', 'authored', FALSE, NULL)
       RETURNING id`,
      [EQUIPMENT_TYPE, orgId, `K3R1-TPL-${uniq()}`]);
    await query(conn,
      `INSERT INTO task_template_equipment_types
         (task_template_id, equipment_type_id, is_primary, added_by_user_id)
       VALUES (?, ?, true, ?)`,
      [template.id, EQUIPMENT_TYPE, AUTHOR]);
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
  sourceCode: `K3R1-SRC-${uniq()}`,
  sourceCategory: 'manufacturer_manual',
  defaultTitle: 'K3R1 Authored Source',
  issuingOrganization: 'Example Manufacturer',
  ...overrides
});

const versionPayload = (overrides = {}) => ({
  versionDesignation: `1.${seq + 1}`,
  title: 'K3R1 Authored Source Version',
  referenceNumber: 'REF-K3R1',
  publicationDate: '2026-01-15',
  ...overrides
});

const evidencePayload = (versionId, overrides = {}) => ({
  knowledgeSourceVersionId: versionId,
  sectionOrClause: 'S1',
  ...overrides
});

const countVersionsUnder = (sourceId) => withConn(async (conn) => {
  const rows = await query(conn,
    `SELECT COUNT(*)::int AS n FROM knowledge_source_versions WHERE knowledge_source_id = ?`,
    [sourceId]);
  return Number(rows[0].n);
});

describe('Provenance Write Scope (ATM-001-K3-R1)', { skip: DB_TEST_SKIP_REASON }, () => {
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
  // A. Tenant-owned provenance must keep working end to end
  // =========================================================================

  it('W1 — tenant author creates a source in their OWN organization', async () => {
    const res = await call('POST', '/api/knowledge-provenance/sources', {
      userId: AUTHOR, body: sourcePayload()
    });
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(Number(res.body.data.source.organization_id), ORG_A);
    assert.strictEqual(Number(res.body.data.source.created_by_user_id), AUTHOR);
  });

  it('W2 — tenant author creates a version under their OWN source', async () => {
    const created = await call('POST', '/api/knowledge-provenance/sources', {
      userId: AUTHOR, body: sourcePayload()
    });
    assert.strictEqual(created.status, 201);
    const sourceId = created.body.data.source.id;

    const res = await call('POST', `/api/knowledge-provenance/sources/${sourceId}/versions`, {
      userId: AUTHOR, body: versionPayload()
    });
    assert.strictEqual(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(Number(res.body.data.version.created_by_user_id), AUTHOR);
  });

  it('W3 — tenant author cites their OWN version and detaches the working evidence', async () => {
    const templateId = await createWorkingTemplate(ORG_A);
    const created = await call('POST', '/api/knowledge-provenance/sources', {
      userId: AUTHOR, body: sourcePayload()
    });
    const sourceId = created.body.data.source.id;
    const version = await call('POST', `/api/knowledge-provenance/sources/${sourceId}/versions`, {
      userId: AUTHOR, body: versionPayload()
    });
    assert.strictEqual(version.status, 201);

    const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: AUTHOR, body: evidencePayload(version.body.data.version.id)
    });
    assert.strictEqual(attached.status, 201, `cite own version: ${JSON.stringify(attached.body)}`);

    const detached = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${attached.body.data.evidence.id}`,
      { userId: AUTHOR });
    assert.strictEqual(detached.status, 200, `detach own evidence: ${JSON.stringify(detached.body)}`);
  });

  // =========================================================================
  // B. Global provenance: READ and CITE preserved, WRITE denied
  // =========================================================================

  it('W4 — tenant author can still READ global reference provenance', async () => {
    const sources = await call('GET', '/api/knowledge-provenance/sources', { userId: AUTHOR });
    assert.strictEqual(sources.status, 200);
    const global = sources.body.data.sources.find((s) => Number(s.id) === Number(globalSourceId));
    assert.ok(global, 'the global source must remain visible to a tenant');
    assert.strictEqual(global.organization_id, null);

    const versions = await call('GET',
      `/api/knowledge-provenance/sources/${globalSourceId}/versions`, { userId: AUTHOR });
    assert.strictEqual(versions.status, 200, `read global versions: ${JSON.stringify(versions.body)}`);
    assert.ok(versions.body.data.versions.some((v) => Number(v.id) === Number(globalVersionId)),
      'the global edition must remain readable');
  });

  it('W5 — tenant author can still CITE a legitimate global source version', async () => {
    const templateId = await createWorkingTemplate(ORG_A);
    const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: AUTHOR, body: evidencePayload(globalVersionId)
    });
    assert.strictEqual(res.status, 201,
      `global citation must remain allowed, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('W6 — MAJOR-1: tenant author must NOT create a version under a GLOBAL source', async () => {
    const before_ = await countVersionsUnder(globalSourceId);

    const res = await call('POST', `/api/knowledge-provenance/sources/${globalSourceId}/versions`, {
      userId: AUTHOR, body: versionPayload()
    });

    assert.notStrictEqual(res.status, 201,
      `MAJOR-1: a tenant principal must not author into global provenance, got ${res.status}: `
      + JSON.stringify(res.body));
    assert.strictEqual(res.status, 409,
      `expected the explicit global-write refusal (409), got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.code, 'SOURCE_NOT_TENANT_WRITABLE',
      `expected code SOURCE_NOT_TENANT_WRITABLE, got ${JSON.stringify(res.body)}`);

    const after_ = await countVersionsUnder(globalSourceId);
    assert.strictEqual(after_, before_,
      'a refused global write must create no version row');
  });

  it('W7 — the two halves hold SIMULTANEOUSLY: read/cite global YES, write global NO', async () => {
    const templateId = await createWorkingTemplate(ORG_A);

    const read = await call('GET', `/api/knowledge-provenance/sources/${globalSourceId}/versions`,
      { userId: AUTHOR });
    assert.strictEqual(read.status, 200);

    const cite = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: AUTHOR, body: evidencePayload(globalVersionId)
    });
    assert.strictEqual(cite.status, 201, `cite global: ${JSON.stringify(cite.body)}`);

    const write = await call('POST', `/api/knowledge-provenance/sources/${globalSourceId}/versions`, {
      userId: AUTHOR, body: versionPayload()
    });
    assert.strictEqual(write.status, 409, `write global must be denied: ${JSON.stringify(write.body)}`);
  });

  it('W8 — the global source identity is unchanged after every attempt', async () => {
    const rows = await withConn((conn) => query(conn,
      `SELECT organization_id, source_code FROM knowledge_sources WHERE id = ?`, [globalSourceId]));
    assert.strictEqual(rows[0].organization_id, null,
      'the global source must not have become tenant-scoped');
    assert.strictEqual(rows[0].source_code, GLOBAL_SOURCE_CODE);

    const globals = await withConn((conn) => query(conn,
      `SELECT COUNT(*)::int AS n FROM knowledge_sources
        WHERE organization_id IS NULL AND source_code = ?`, [GLOBAL_SOURCE_CODE]));
    assert.strictEqual(Number(globals[0].n), 1, 'exactly one global source per source_code');
  });

  // =========================================================================
  // C. Cross-tenant isolation
  // =========================================================================

  it('W9 — a foreign tenant cannot create a version under another tenant\'s source', async () => {
    const created = await call('POST', '/api/knowledge-provenance/sources', {
      userId: AUTHOR, body: sourcePayload()
    });
    const sourceId = created.body.data.source.id;

    const res = await call('POST', `/api/knowledge-provenance/sources/${sourceId}/versions`, {
      userId: AUTHOR_B, body: versionPayload()
    });
    assert.strictEqual(res.status, 404,
      `cross-tenant version write must be refused, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  it('W10 — a foreign tenant cannot cite another tenant\'s source version', async () => {
    const created = await call('POST', '/api/knowledge-provenance/sources', {
      userId: AUTHOR, body: sourcePayload()
    });
    const version = await call('POST',
      `/api/knowledge-provenance/sources/${created.body.data.source.id}/versions`,
      { userId: AUTHOR, body: versionPayload() });
    assert.strictEqual(version.status, 201);

    const templateB = await createWorkingTemplate(ORG_B);
    const res = await call('POST', `/api/knowledge-provenance/templates/${templateB}/evidence`, {
      userId: AUTHOR_B, body: evidencePayload(version.body.data.version.id)
    });
    // Refused at the OUTER layer: the version is resolved through the
    // global-inclusive read predicate, under which a foreign tenant's version is
    // simply not visible, so the request is an opaque 404 that does not disclose
    // the row's existence. The EVIDENCE_SOURCE_SCOPE_MISMATCH conflict (409) sits
    // below that as defence-in-depth for a version that did resolve. The property
    // under test is the refusal, not which layer produced it.
    assert.strictEqual(res.status, 404,
      `cross-tenant citation must be refused, got ${res.status}: ${JSON.stringify(res.body)}`);

    // And nothing was written.
    const rows = await withConn((conn) => query(conn,
      `SELECT COUNT(*)::int AS n FROM knowledge_template_evidence
        WHERE task_template_id = ? AND knowledge_source_version_id = ?`,
      [templateB, version.body.data.version.id]));
    assert.strictEqual(Number(rows[0].n), 0, 'no cross-tenant evidence row may exist');
  });

  it('W11 — a foreign tenant cannot mutate another tenant\'s working evidence', async () => {
    const templateA = await createWorkingTemplate(ORG_A);
    const attached = await call('POST', `/api/knowledge-provenance/templates/${templateA}/evidence`, {
      userId: AUTHOR, body: evidencePayload(globalVersionId)
    });
    assert.strictEqual(attached.status, 201);

    const res = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateA}/evidence/${attached.body.data.evidence.id}`,
      { userId: AUTHOR_B });
    assert.strictEqual(res.status, 404,
      `cross-tenant evidence mutation must be refused, got ${res.status}: ${JSON.stringify(res.body)}`);

    // The evidence must still exist.
    const rows = await withConn((conn) => query(conn,
      `SELECT COUNT(*)::int AS n FROM knowledge_template_evidence WHERE id = ?`,
      [attached.body.data.evidence.id]));
    assert.strictEqual(Number(rows[0].n), 1, 'the foreign detach must not have deleted the row');
  });

  // =========================================================================
  // D. Identity spoofing — the session stays authoritative
  // =========================================================================

  it('W12 — body-supplied organization and user identity cannot redirect a source write', async () => {
    const res = await call('POST', '/api/knowledge-provenance/sources', {
      userId: AUTHOR,
      body: sourcePayload({ organizationId: ORG_B, organization_id: ORG_B, userId: AUTHOR_B, user_id: AUTHOR_B })
    });
    assert.strictEqual(res.status, 201, `${JSON.stringify(res.body)}`);
    assert.strictEqual(Number(res.body.data.source.organization_id), ORG_A,
      'the session organization must win over the body');
    assert.strictEqual(Number(res.body.data.source.created_by_user_id), AUTHOR,
      'the session principal must win over the body');
  });

  it('W13 — body identity spoofing cannot make a global or cross-tenant version write succeed', async () => {
    const globalAttempt = await call('POST',
      `/api/knowledge-provenance/sources/${globalSourceId}/versions`, {
        userId: AUTHOR,
        body: versionPayload({ organizationId: null, organization_id: null, userId: GRANTOR })
      });
    assert.strictEqual(globalAttempt.status, 409,
      `spoofed global write must still be refused: ${JSON.stringify(globalAttempt.body)}`);

    const created = await call('POST', '/api/knowledge-provenance/sources', {
      userId: AUTHOR, body: sourcePayload()
    });
    const foreignAttempt = await call('POST',
      `/api/knowledge-provenance/sources/${created.body.data.source.id}/versions`, {
        userId: AUTHOR_B,
        body: versionPayload({ organizationId: ORG_A, organization_id: ORG_A })
      });
    assert.strictEqual(foreignAttempt.status, 404,
      `spoofed cross-tenant write must still be refused: ${JSON.stringify(foreignAttempt.body)}`);
  });

  it('W14 — body identity spoofing cannot redirect an evidence write', async () => {
    const templateA = await createWorkingTemplate(ORG_A);
    const res = await call('POST', `/api/knowledge-provenance/templates/${templateA}/evidence`, {
      userId: AUTHOR_B,
      body: evidencePayload(globalVersionId, { organizationId: ORG_A, userId: AUTHOR })
    });
    assert.strictEqual(res.status, 404,
      `a foreign principal must not write into ORG_A evidence even with a spoofed body: `
      + JSON.stringify(res.body));
  });

  // =========================================================================
  // E. Capability and lifecycle boundaries
  // =========================================================================

  it('W15 — a principal without knowledge.author is refused on every mutation', async () => {
    const templateId = await createWorkingTemplate(ORG_A);
    const attempts = [
      ['create source', () => call('POST', '/api/knowledge-provenance/sources', { userId: NO_CAP, body: sourcePayload() })],
      ['create version', () => call('POST', `/api/knowledge-provenance/sources/${globalSourceId}/versions`, { userId: NO_CAP, body: versionPayload() })],
      ['attach evidence', () => call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, { userId: NO_CAP, body: evidencePayload(globalVersionId) })],
      ['detach evidence', () => call('DELETE', `/api/knowledge-provenance/templates/${templateId}/evidence/1`, { userId: NO_CAP })]
    ];
    for (const [label, attempt] of attempts) {
      const res = await attempt();
      assert.strictEqual(res.status, 403, `${label}: expected 403, got ${res.status}`);
      assert.match(String(res.body.message), /knowledge\.author/, `${label}: must name the capability`);
    }
  });

  it('W16 — knowledge.author still confers no review, approval, safety-review or publication', async () => {
    const templateId = await createWorkingTemplate(ORG_A);
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
        userId: AUTHOR, body: {}
      });
      assert.strictEqual(res.status, 403, `${route}: expected 403, got ${res.status}`);
      assert.match(String(res.body.message), new RegExp(capability.replace('.', '\\.')),
        `${route}: refusal must name ${capability}`);
    }
  });

  // =========================================================================
  // F. Anti-drift: the write predicate must not regress to the read predicate
  // =========================================================================

  it('W17 — the write scope is a distinct predicate, and fixture ids stay disjoint', async () => {
    const model = fs.readFileSync(path.join(__dirname, '..', 'src', 'models', 'knowledge-provenance.model.js'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');

    // The write-scope lookup must enforce strict tenant equality.
    assert.match(model, /organization_id = \?/,
      'a strict tenant write predicate must exist');

    // createVersion must AUTHORIZE through the tenant write predicate. The
    // global-inclusive read helper may still appear inside createVersion, but only
    // AFTER write authority has been refused — as the explanation lookup that
    // distinguishes a global source from an absent one. It must never be the guard.
    const createVersionBody = model.slice(model.indexOf('async createVersion('),
      model.indexOf('async findVersionById'));
    const writeIdx = createVersionBody.indexOf('findTenantWritableSourceById(');
    const refusalIdx = createVersionBody.indexOf('if (!source)');
    const readIdx = createVersionBody.indexOf('KnowledgeSource.findSourceById(');
    assert.ok(writeIdx > -1 && writeIdx < refusalIdx,
      'createVersion must authorize through the tenant write predicate');
    assert.ok(readIdx === -1 || readIdx > refusalIdx,
      'the global-inclusive read predicate must not be the write authorization — it may only '
      + 'explain a refusal that has already happened');

    // Read scope stays global-inclusive: removing it would break shared reference.
    assert.match(model, /organization_id IS NULL OR organization_id = \?/,
      'the read predicate must stay global-inclusive');

    const fixtureIds = [ORG_A, ORG_B, AUTHOR, NO_CAP, AUTHOR_B, GRANTOR, GRANTOR_B,
      CATEGORY, CLASS, EQUIPMENT_TYPE];
    const self = path.basename(__filename);
    const siblings = fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js') && n !== self);
    assert.ok(siblings.length > 10, 'expected a populated corpus to check against');
    for (const id of fixtureIds) {
      for (const name of siblings) {
        const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
        assert.ok(!new RegExp(`\\b${id}\\b`).test(text),
          `fixture id ${id} is already used by ${name}; the shared-database corpus requires `
          + 'a disjoint id block');
      }
    }
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });
});
