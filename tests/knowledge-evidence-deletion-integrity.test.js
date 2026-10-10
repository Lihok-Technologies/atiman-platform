/**
 * Knowledge Evidence Deletion Integrity — ATM-001-KF-06
 *
 * REMEDIATION OF ATIMAN-KF-01/02 FINDING F-1.
 *
 * Confirmed defect (before this change). A principal holding `knowledge.author`
 * but NOT `evidence.attach` was refused on the direct detach route
 * (`DELETE /api/knowledge-provenance/templates/:id/evidence/:evidenceId` → 403)
 * yet could still destroy the same working evidence by deleting the parent draft
 * definition (`DELETE /api/task-templates/:id` → 200), because
 * `knowledge_template_evidence.task_template_id` (and `…task_template_step_id`)
 * are `ON DELETE CASCADE`. Authorization covered a route, not the operation's
 * effect.
 *
 * The corrected rule. A definition deletion that would remove working provenance
 * evidence is refused (`409 EVIDENCE_PRESENT`) until that evidence is detached
 * explicitly. Detachment is governed by `evidence.attach` (ATM-003-R1 §3.1, as
 * reconciled by ATM-001-K3-G2), so `knowledge.author` alone can no longer destroy
 * provenance. The rule mirrors the already-established governed-authoring
 * refusal `STEP_EVIDENCE_PRESENT`, which refuses a step-set replacement over
 * attached evidence for exactly the same reason.
 *
 * Invariants asserted here:
 *   - knowledge.author does not imply evidence.attach;
 *   - evidence.attach governs the working-evidence citation lifecycle;
 *   - tenant isolation and global write protection are unchanged;
 *   - published/frozen knowledge remains immutable;
 *   - approval/publication separation of duties is unchanged;
 *   - legitimate draft authoring and deletion still work;
 *   - a refused deletion mutates nothing.
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
const { Client } = require('pg');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { LEGACY_COMPATIBILITY_BUNDLES } = require('../src/config/capabilities');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating knowledge-evidence-deletion-integrity suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// Disposable fixtures. The id block MUST stay disjoint from every other suite's:
// the sanctioned runner executes suites in PARALLEL PROCESSES against ONE shared
// database, and every fixture uses `ON CONFLICT (id) DO NOTHING`, so a colliding
// id silently substitutes another suite's principal. `9985xx` is unused
// corpus-wide, and R12 asserts that mechanically.
const ORG = 998501;
const ORG_B = 998502;
const ADMIN = 998511;          // legacy bundle: knowledge.author + evidence.attach
const SUPERVISOR = 998512;     // legacy bundle: knowledge.author only
const OPERATOR = 998513;       // legacy bundle: neither
const STEWARD = 998514;        // operator + EXPLICIT knowledge.author + evidence.attach
const FOREIGN_ADMIN = 998515;  // ORG_B admin (both capabilities, other tenant)
const FOREIGN_SUPERVISOR = 998516; // ORG_B supervisor (knowledge.author only)
const CATEGORY = 998521;
const CLASS = 998522;
const EQUIPMENT_TYPE = 998523;

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-kf06-0000';
const MODEL_FILE = path.join(__dirname, '..', 'src', 'models', 'task-template.model.js');
const CONTROLLER_FILE = path.join(__dirname, '..', 'src', 'controllers', 'task-template.controller.js');
const ROUTES_FILE = path.join(__dirname, '..', 'src', 'routes', 'task-template.routes.js');

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

/** Idempotent explicit grant (migration 022 refuses DELETE, so insert-if-absent). */
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
    for (const [id, name] of [[ORG, 'KF06 Evidence Org'], [ORG_B, 'KF06 Foreign Org']]) {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [id, name]);
    }
    for (const [id, username, role, orgId] of [
      [ADMIN, 'kf06-admin', 'admin', ORG],
      [SUPERVISOR, 'kf06-supervisor', 'supervisor', ORG],
      [OPERATOR, 'kf06-operator', 'operator', ORG],
      [STEWARD, 'kf06-steward', 'operator', ORG],
      [FOREIGN_ADMIN, 'kf06-foreign-admin', 'admin', ORG_B],
      [FOREIGN_SUPERVISOR, 'kf06-foreign-supervisor', 'supervisor', ORG_B]
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'KF06 Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, orgId]);
    }

    // The Steward holds BOTH provenance capabilities by explicit grant (an
    // operator role grants neither by bundle), which is the documented recovery
    // path for a principal that must both author and cite.
    await grantCapability(conn, STEWARD, ORG, 'knowledge.author', ADMIN);
    await grantCapability(conn, STEWARD, ORG, 'evidence.attach', ADMIN);

    await query(conn, `INSERT INTO equipment_categories (id, category_code, category_name)
      VALUES (?, 'KF06CAT', 'KF06 Category') ON CONFLICT (id) DO NOTHING`, [CATEGORY]);
    await query(conn, `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
      VALUES (?, ?, 'KF06CLS', 'KF06 Class') ON CONFLICT (id) DO NOTHING`, [CLASS, CATEGORY]);
    await query(conn, `INSERT INTO equipment_types (id, class_id, type_code, type_name)
      VALUES (?, ?, 'KF06TYPE', 'KF06 Equipment Type') ON CONFLICT (id) DO NOTHING`, [EQUIPMENT_TYPE, CLASS]);
  });
}

/** A working (draft) task template in the given organization. */
async function createTemplate(orgId = ORG) {
  return withConn(async (conn) => {
    const [template] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name,
         maintenance_type, task_kind, frequency_value, frequency_unit, estimated_duration_minutes, priority,
         knowledge_type_id, task_family_id, maintenance_strategy, trigger_mechanism, knowledge_scope, content_origin,
         ai_assisted, ai_assistance_detail)
       VALUES (?, ?, ?, 'KF06 Working Template', 'preventive', 'inspection', NULL, NULL, 30, 'medium',
         (SELECT id FROM knowledge_types WHERE type_code='MAINTENANCE_PROCEDURE'),
         (SELECT id FROM task_families WHERE family_code='inspect'),
         'preventive', 'no_fixed_interval', 'customer', 'authored', FALSE, NULL)
       RETURNING id`,
      [EQUIPMENT_TYPE, orgId, `KF06-TPL-${uniq()}`]);
    await query(conn,
      `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary, added_by_user_id)
       VALUES (?, ?, true, ?)`, [template.id, EQUIPMENT_TYPE, ADMIN]);
    return template.id;
  });
}

async function addStep(templateId) {
  return withConn(async (conn) => {
    const [step] = await query(conn,
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, (SELECT COALESCE(MAX(step_no), 0) + 1 FROM task_template_steps WHERE task_template_id = ?),
               'instruction', 'KF06 step', true) RETURNING id`,
      [templateId, templateId]);
    return step.id;
  });
}

/** A tenant source + immutable edition, authored by the given principal. */
async function authorSourceAndVersion(userId) {
  const source = await call('POST', '/api/knowledge-provenance/sources', { userId,
    body: { sourceCode: `KF06-SRC-${uniq()}`, sourceCategory: 'manufacturer_manual', defaultTitle: 'KF06 source', issuingOrganization: 'Probe' } });
  assert.strictEqual(source.status, 201, `source creation failed: ${JSON.stringify(source.body)}`);
  const sourceId = source.body.data.source.id;
  const version = await call('POST', `/api/knowledge-provenance/sources/${sourceId}/versions`, { userId,
    body: { versionDesignation: '1.0', title: 'KF06 edition', referenceNumber: 'R1', publicationDate: '2026-01-15' } });
  assert.strictEqual(version.status, 201, `version creation failed: ${JSON.stringify(version.body)}`);
  return { sourceId, versionId: version.body.data.version.id };
}

/** A global (system/OWNER) source and edition, created out of band. */
async function ensureGlobalSource() {
  return withConn(async (conn) => {
    const existing = await query(conn, `SELECT id FROM knowledge_sources WHERE source_code = 'KF06-GLOBAL-REF'`);
    let sourceId;
    if (existing.length) {
      sourceId = existing[0].id;
    } else {
      const [s] = await query(conn,
        `INSERT INTO knowledge_sources (source_code, source_category, default_title, issuing_organization, organization_id, created_by_user_id)
         VALUES ('KF06-GLOBAL-REF', 'manufacturer_manual', 'KF06 Global Reference', 'Global Body', NULL, NULL) RETURNING id`);
      sourceId = s.id;
    }
    const versions = await query(conn, `SELECT id FROM knowledge_source_versions WHERE knowledge_source_id = ?`, [sourceId]);
    let versionId;
    if (versions.length) {
      versionId = versions[0].id;
    } else {
      const [v] = await query(conn,
        `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title, reference_number, created_by_user_id)
         VALUES (?, '1.0', 'KF06 Global Edition', 'GLOBAL-1', NULL) RETURNING id`, [sourceId]);
      versionId = v.id;
    }
    return { sourceId, versionId };
  });
}

/**
 * Seal a working definition into a published immutable version, out of band.
 * Mirrors the publication shape the admission trigger requires: a frozen
 * evidence row, applicability, a step version set, governance attribution, and
 * a sealed step set before commit.
 */
async function publishVersionOutOfBand(templateId, knowledgeSourceVersionId, copiedFromEvidenceId = null) {
  return withConn(async (conn) => {
    const [version] = await query(conn,
      `INSERT INTO task_template_versions (task_template_id, version_number, equipment_type_id, template_name,
         maintenance_type, lifecycle_state_at_publish, is_step_set_sealed, knowledge_scope, organization_id,
         knowledge_type_id, task_family_id, maintenance_strategy, trigger_mechanism,
         published_by_user_id, reviewer_user_id, reviewed_at, approver_user_id, approved_at,
         safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at)
       VALUES (?, ?, ?, 'KF06 Published Version', 'preventive', 'published', false, 'customer', ?,
         (SELECT id FROM knowledge_types WHERE type_code='MAINTENANCE_PROCEDURE'),
         (SELECT id FROM task_families WHERE family_code='inspect'),
         'preventive', 'no_fixed_interval',
         ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, 'reviewed_no_control_required', ?, CURRENT_TIMESTAMP)
       RETURNING id`,
      [templateId, Math.floor(Date.now() % 100000), EQUIPMENT_TYPE, ORG, SUPERVISOR, ADMIN, ADMIN, ADMIN]);
    await query(conn,
      `INSERT INTO task_template_version_equipment_types (task_template_version_id, equipment_type_id, is_primary)
       VALUES (?, ?, true)`, [version.id, EQUIPMENT_TYPE]);
    const [step] = await query(conn,
      `SELECT id FROM task_template_steps WHERE task_template_id = ? ORDER BY id LIMIT 1`, [templateId]);
    await query(conn,
      `INSERT INTO task_template_step_versions (task_template_version_id, step_no, task_template_step_id, step_type, instruction)
       VALUES (?, 1, ?, 'instruction', 'KF06 frozen step')`, [version.id, step.id]);
    // (b) admission requires a frozen evidence row on the version.
    await query(conn,
      `INSERT INTO knowledge_template_version_evidence
         (task_template_version_id, knowledge_source_version_id, section_or_clause, copied_from_template_evidence_id)
       VALUES (?, ?, 'F1', ?)`, [version.id, knowledgeSourceVersionId, copiedFromEvidenceId]);
    await query(conn, `UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = ?`, [version.id]);
    return version.id;
  });
}

const countRows = (table, column, value) => withConn((conn) =>
  query(conn, `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} = ?`, [value]));
const templateCount = (id) => countRows('task_templates', 'id', id);
const evidenceForTemplate = (id) => withConn((conn) => query(conn,
  `SELECT COUNT(*)::int AS n FROM knowledge_template_evidence e
    WHERE e.task_template_id = ?
       OR e.task_template_step_id IN (SELECT s.id FROM task_template_steps s WHERE s.task_template_id = ?)`,
  [id, id]));

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

const attachEvidence = async (templateId, versionId, userId) => {
  const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
    userId, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'S1' }
  });
  assert.strictEqual(res.status, 201, `evidence attachment failed: ${JSON.stringify(res.body)}`);
  return res.body.data.evidence.id;
};

describe('Knowledge Evidence Deletion Integrity (ATM-001-KF-06)', { skip: DB_TEST_SKIP_REASON }, () => {
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
  // A — the direct route was, and remains, denied to a knowledge.author-only actor
  // =========================================================================

  it('A — a supervisor without evidence.attach cannot delete working evidence directly (403, nothing removed)', async () => {
    const templateId = await createTemplate();
    const { versionId } = await authorSourceAndVersion(ADMIN);
    const evidenceId = await attachEvidence(templateId, versionId, ADMIN);
    const before = (await evidenceForTemplate(templateId))[0].n;

    const res = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${evidenceId}`, { userId: SUPERVISOR });

    assert.strictEqual(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(String(res.body.message), /evidence\.attach/, 'the refusal must name the required capability');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, before, 'evidence rows must be unchanged');
  });

  // =========================================================================
  // B — the F-1 bypass: parent deletion must no longer destroy evidence
  // =========================================================================

  it('B — a supervisor cannot destroy template-level working evidence through parent deletion (409 EVIDENCE_PRESENT)', async () => {
    const templateId = await createTemplate();
    const { versionId } = await authorSourceAndVersion(ADMIN);
    await attachEvidence(templateId, versionId, ADMIN);

    const res = await call('DELETE', `/api/task-templates/${templateId}`, { userId: SUPERVISOR });

    assert.strictEqual(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.code, 'EVIDENCE_PRESENT', 'refusal must carry the EVIDENCE_PRESENT code');
    assert.strictEqual((await templateCount(templateId))[0].n, 1, 'the definition must survive');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, 1, 'the evidence must survive');
  });

  it('B2 — a supervisor cannot destroy STEP-level working evidence through parent deletion either', async () => {
    const templateId = await createTemplate();
    const stepId = await addStep(templateId);
    const { versionId } = await authorSourceAndVersion(ADMIN);
    const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
      userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'S1' }
    });
    assert.strictEqual(attached.status, 201, `step evidence attach failed: ${JSON.stringify(attached.body)}`);
    // Re-point the evidence at the step to exercise the step-level cascade.
    await withConn((conn) => query(conn,
      `UPDATE knowledge_template_evidence SET task_template_id = NULL, task_template_step_id = ? WHERE id = ?`,
      [stepId, attached.body.data.evidence.id]));

    const before = (await evidenceForTemplate(templateId))[0].n;
    assert.strictEqual(before, 1, 'step-level evidence must be counted');

    const res = await call('DELETE', `/api/task-templates/${templateId}`, { userId: SUPERVISOR });
    assert.strictEqual(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual((await templateCount(templateId))[0].n, 1, 'the definition must survive');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, 1, 'the step evidence must survive');
  });

  it('B3 — the denied principal cannot complete detach-then-delete: both halves are refused', async () => {
    const templateId = await createTemplate();
    const { versionId } = await authorSourceAndVersion(ADMIN);
    const evidenceId = await attachEvidence(templateId, versionId, ADMIN);

    // Half one: the evidence.attach-governed detach.
    const detach = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${evidenceId}`, { userId: SUPERVISOR });
    assert.strictEqual(detach.status, 403, `detach must be refused, got ${detach.status}`);

    // Half two: the authoring-governed deletion.
    const del = await call('DELETE', `/api/task-templates/${templateId}`, { userId: SUPERVISOR });
    assert.strictEqual(del.status, 409, `deletion must be refused, got ${del.status}`);

    assert.strictEqual((await templateCount(templateId))[0].n, 1, 'definition intact');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, 1, 'evidence intact');
  });

  // =========================================================================
  // C — refusal is atomic: nothing is partially mutated
  // =========================================================================
  it('C — a refused deletion mutates nothing (template, steps and evidence all intact)', async () => {
    const templateId = await createTemplate();
    const stepId = await addStep(templateId);
    await addStep(templateId);
    const { versionId } = await authorSourceAndVersion(ADMIN);
    await attachEvidence(templateId, versionId, ADMIN);

    const stepsBefore = (await countRows('task_template_steps', 'task_template_id', templateId))[0].n;
    const applicabilityBefore = (await countRows('task_template_equipment_types', 'task_template_id', templateId))[0].n;

    const res = await call('DELETE', `/api/task-templates/${templateId}`, { userId: SUPERVISOR });
    assert.strictEqual(res.status, 409, 'the operation must be refused');

    assert.strictEqual((await templateCount(templateId))[0].n, 1, 'template intact');
    assert.strictEqual((await countRows('task_template_steps', 'task_template_id', templateId))[0].n, stepsBefore, 'steps intact');
    assert.strictEqual((await countRows('task_template_equipment_types', 'task_template_id', templateId))[0].n, applicabilityBefore, 'applicability intact');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, 1, 'evidence intact');
    assert.ok(stepId > 0, 'sanity');
  });

  // =========================================================================
  // D — authorized actors retain the legitimate workflow
  // =========================================================================

  it('D — an authorized actor detaches evidence explicitly, then deletes the definition', async () => {
    const templateId = await createTemplate();
    const { versionId } = await authorSourceAndVersion(ADMIN);
    const evidenceId = await attachEvidence(templateId, versionId, ADMIN);

    // Evidence-free definitions delete directly.
    const noEvidence = await createTemplate();
    const direct = await call('DELETE', `/api/task-templates/${noEvidence}`, { userId: ADMIN });
    assert.strictEqual(direct.status, 200, `an evidence-free definition must still delete: ${JSON.stringify(direct.body)}`);
    assert.strictEqual((await templateCount(noEvidence))[0].n, 0, 'the evidence-free definition is gone');

    // The explicit detach is the sanctioned removal path (evidence.attach).
    const detach = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${evidenceId}`, { userId: ADMIN });
    assert.strictEqual(detach.status, 200, `admin detach must succeed: ${JSON.stringify(detach.body)}`);

    const del = await call('DELETE', `/api/task-templates/${templateId}`, { userId: ADMIN });
    assert.strictEqual(del.status, 200, `after detach the definition must delete: ${JSON.stringify(del.body)}`);
    assert.strictEqual((await templateCount(templateId))[0].n, 0, 'definition removed');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, 0, 'evidence removed by the sanctioned path');
  });

  it('D2 — the explicit-grant Steward completes the same authorized workflow', async () => {
    const templateId = await createTemplate();
    const { versionId } = await authorSourceAndVersion(STEWARD);
    const evidenceId = await attachEvidence(templateId, versionId, STEWARD);

    const detach = await call('DELETE',
      `/api/knowledge-provenance/templates/${templateId}/evidence/${evidenceId}`, { userId: STEWARD });
    assert.strictEqual(detach.status, 200, 'steward detach');
    const del = await call('DELETE', `/api/task-templates/${templateId}`, { userId: STEWARD });
    assert.strictEqual(del.status, 200, 'steward delete after detach');
  });

  // =========================================================================
  // E — tenant isolation
  // =========================================================================

  it('E — cross-tenant deletion remains blocked for admins and supervisors alike', async () => {
    const templateId = await createTemplate(ORG);
    const { versionId } = await authorSourceAndVersion(ADMIN);
    await attachEvidence(templateId, versionId, ADMIN);

    for (const [label, userId] of [['foreign admin', FOREIGN_ADMIN], ['foreign supervisor', FOREIGN_SUPERVISOR]]) {
      const res = await call('DELETE', `/api/task-templates/${templateId}`, { userId });
      assert.strictEqual(res.status, 403, `${label}: expected 403, got ${res.status}`);
    }
    assert.strictEqual((await templateCount(templateId))[0].n, 1, 'the definition must survive');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, 1, 'the evidence must survive');
  });

  // =========================================================================
  // F — global knowledge boundaries
  // =========================================================================

  it('F — global reference knowledge stays read-only to tenants and is never touched by deletion', async () => {
    const global = await ensureGlobalSource();
    const snapshot = () => withConn((conn) => query(conn,
      `SELECT s.source_code, s.organization_id, s.created_by_user_id,
              (SELECT COUNT(*)::int FROM knowledge_source_versions v WHERE v.knowledge_source_id = s.id) AS versions
         FROM knowledge_sources s WHERE s.id = ?`, [global.sourceId]));

    const before = (await snapshot())[0];
    assert.strictEqual(before.organization_id, null, 'the fixture is a global source');

    // A tenant still cannot author into the global lineage.
    const write = await call('POST', `/api/knowledge-provenance/sources/${global.sourceId}/versions`, {
      userId: STEWARD, body: { versionDesignation: '2.0', title: 'KF06 illegal edition' }
    });
    assert.strictEqual(write.status, 409, `global write must be refused: ${JSON.stringify(write.body)}`);
    assert.strictEqual(write.body.code, 'SOURCE_NOT_TENANT_WRITABLE', 'refusal code');

    // Authorized deletion of a definition that cited a global edition leaves the global rows untouched.
    const templateId = await createTemplate(ORG);
    const evidenceId = await attachEvidence(templateId, global.versionId, STEWARD);
    await call('DELETE', `/api/knowledge-provenance/templates/${templateId}/evidence/${evidenceId}`, { userId: STEWARD });
    const del = await call('DELETE', `/api/task-templates/${templateId}`, { userId: STEWARD });
    assert.strictEqual(del.status, 200, `delete after detach must succeed: ${JSON.stringify(del.body)}`);

    const after = (await snapshot())[0];
    assert.deepStrictEqual(after, before, 'the global source row and lineage must be unchanged');
    assert.strictEqual(after.organization_id, null, 'the global source stays global');
  });

  // =========================================================================
  // G — published knowledge remains immutable
  // =========================================================================

  it('G — a definition with a published immutable version cannot be deleted, and nothing is destroyed', async () => {
    const templateId = await createTemplate();
    const stepId = await addStep(templateId);
    const { versionId: sourceVersionId } = await authorSourceAndVersion(ADMIN);
    // Published version with frozen provenance but NO working evidence.
    const versionId = await publishVersionOutOfBand(templateId, sourceVersionId);

    const res = await call('DELETE', `/api/task-templates/${templateId}`, { userId: ADMIN });

    assert.ok(res.status >= 400, `deletion of a published definition must be refused, got ${res.status}`);
    assert.strictEqual((await templateCount(templateId))[0].n, 1, 'the definition must survive');
    assert.strictEqual((await countRows('task_template_versions', 'id', versionId))[0].n, 1, 'the immutable version must survive');
    assert.strictEqual((await countRows('task_template_step_versions', 'task_template_version_id', versionId))[0].n, 1, 'frozen step versions must survive');
    assert.strictEqual((await countRows('knowledge_template_version_evidence', 'task_template_version_id', versionId))[0].n, 1, 'frozen evidence must survive');
    assert.ok(stepId > 0, 'sanity');
  });

  it('G2 — working evidence copied into a published version is reported as present, not silently removed', async () => {
    const templateId = await createTemplate();
    const stepId = await addStep(templateId);
    const { versionId } = await authorSourceAndVersion(ADMIN);
    const evidenceId = await attachEvidence(templateId, versionId, ADMIN);
    // Published version whose frozen evidence records the working row it came from.
    const publishedVersion = await publishVersionOutOfBand(templateId, versionId, evidenceId);

    const res = await call('DELETE', `/api/task-templates/${templateId}`, { userId: ADMIN });
    assert.strictEqual(res.status, 409, `expected 409 EVIDENCE_PRESENT, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.code, 'EVIDENCE_PRESENT', 'refusal code');
    assert.strictEqual((await templateCount(templateId))[0].n, 1, 'definition survives');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, 1, 'working evidence survives');
    assert.strictEqual((await countRows('knowledge_template_version_evidence', 'task_template_version_id', publishedVersion))[0].n, 1, 'frozen evidence survives');
    assert.ok(stepId > 0, 'sanity');
  });

  // =========================================================================
  // H — approval and publication separation of duties is unchanged
  // =========================================================================

  it('H — provenance authority still confers no review, approval or publication authority', async () => {
    const templateId = await createTemplate();
    const governed = [
      ['submit-for-review', 'knowledge.review'],
      ['reject', 'knowledge.review'],
      ['approve', 'knowledge.approve'],
      ['safety-review', 'knowledge.safety_review'],
      ['publish', 'knowledge.publish']
    ];
    for (const [route, capability] of governed) {
      const res = await call('POST', `/api/task-templates/${templateId}/${route}`, { userId: STEWARD, body: {} });
      assert.strictEqual(res.status, 403, `${route}: expected 403, got ${res.status}`);
      assert.match(String(res.body.message), new RegExp(capability.replace('.', '\\.')),
        `${route}: refusal must name ${capability}`);
    }
    const constraint = await withConn((conn) => query(conn,
      `SELECT COUNT(*)::int AS n FROM pg_constraint
        WHERE conname = 'chk_task_template_versions_approver_not_publisher'`));
    assert.strictEqual(constraint[0].n, 1, 'approver ≠ publisher must remain enforced in schema');
  });

  // =========================================================================
  // I — unrelated draft authoring remains functional
  // =========================================================================

  it('I — creating, updating and evidence-free deletion of drafts still work', async () => {
    const templateId = await createTemplate();
    assert.ok(templateId > 0, 'fixture definition created');

    const update = await call('PUT', `/api/task-templates/${templateId}`, {
      userId: SUPERVISOR, body: { template_name: 'KF06 Renamed Template' }
    });
    assert.strictEqual(update.status, 200, `a knowledge.author principal must still update a draft: ${JSON.stringify(update.body)}`);

    const { versionId } = await authorSourceAndVersion(SUPERVISOR);
    assert.ok(versionId > 0, 'a knowledge.author principal must still author provenance');

    const deleteEmpty = await call('DELETE', `/api/task-templates/${templateId}`, { userId: SUPERVISOR });
    assert.strictEqual(deleteEmpty.status, 200, `an evidence-free draft must still delete: ${JSON.stringify(deleteEmpty.body)}`);
  });

  // =========================================================================
  // J — no alternative reachable deletion path
  // =========================================================================

  it('J — the evidence-removal surface is exactly the sanctioned detach path', async () => {
    // Static: the only SQL in src/ that deletes working evidence or its steps.
    const evidenceDeletes = await grepSource(/(INSERT|UPDATE|DELETE)[^\n]*knowledge_template_evidence\b/);
    const stepDeletes = await grepSource(/DELETE FROM task_template_steps\b/);
    const templateDeletes = await grepSource(/DELETE FROM task_templates\b/);

    assert.strictEqual(stepDeletes.length, 1,
      `exactly one step-deletion site is expected (the guarded authoring primitive), found ${stepDeletes.length}`);
    assert.match(stepDeletes[0].file, /knowledge-authoring\.service\.js$/, 'the step-deletion site is the authoring primitive');
    assert.strictEqual(templateDeletes.length, 1,
      `exactly one template-deletion statement is expected, found ${templateDeletes.length}`);
    assert.match(templateDeletes[0].file, /task-template\.model\.js$/, 'the definition deletion lives inside the guarded model operation');

    // The detach path is the only statement that removes working evidence.
    const workingEvidenceDeletes = evidenceDeletes.filter((hit) => /DELETE FROM knowledge_template_evidence/i.test(hit.text));
    assert.strictEqual(workingEvidenceDeletes.length, 1,
      `exactly one working-evidence deletion site expected, found ${workingEvidenceDeletes.length}`);
    assert.match(workingEvidenceDeletes[0].file, /knowledge-provenance\.model\.js$/, 'the single site is the tenant-scoped detach');

    // The model enforces the domain rule atomically; the controller maps it; the route guard is unchanged.
    const model = fs.readFileSync(MODEL_FILE, 'utf8');
    assert.match(model, /async countWorkingEvidence\(templateId, conn = null\)/, 'the working-evidence count must exist');
    assert.match(model, /EVIDENCE_PRESENT/, 'the refusal code must exist');
    const deleteFn = model.slice(model.indexOf('async deleteIfEditable('), model.indexOf('async deleteIfEditable(') + 2000);
    assert.match(deleteFn, /await this\.countWorkingEvidence\(id, conn\)/, 'deleteIfEditable must consult the count inside the transaction');
    assert.match(deleteFn, /SELECT id FROM task_templates WHERE id = \? FOR UPDATE/,
      'the guard must lock the definition row so attachment cannot land between count and delete');
    assert.match(deleteFn, /SELECT id FROM task_template_steps WHERE task_template_id = \? FOR UPDATE/,
      'the guard must also lock the step rows, because a step-level attachment locks the step and not the definition');
    assert.match(deleteFn, /await conn\.commit\(\)/, 'the count and the deletion must be one atomic unit');
    assert.match(deleteFn, /throw error;/, 'deleteIfEditable must refuse when evidence is present');

    const controller = fs.readFileSync(CONTROLLER_FILE, 'utf8');
    assert.match(controller, /error\.code === 'EVIDENCE_PRESENT'/, 'the controller must map the refusal');
    assert.match(controller, /409/, 'the refusal must be a conflict');

    const routes = fs.readFileSync(ROUTES_FILE, 'utf8');
    const templateDeleteRoutes = routes.match(/router\.delete\('\/:id'/g) || [];
    assert.strictEqual(templateDeleteRoutes.length, 1, 'exactly one template-deletion route');
    assert.match(routes, /router\.delete\('\/:id', requireCapability\('knowledge\.author'\)/, 'its guard is unchanged');

    // Capability bundles are unchanged: knowledge.author still does not imply evidence.attach.
    assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.supervisor.includes('evidence.attach'),
      'the supervisor bundle must still exclude evidence.attach');
    assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.operator.includes('evidence.attach'),
      'the operator bundle must still exclude evidence.attach');
    assert.ok(LEGACY_COMPATIBILITY_BUNDLES.admin.includes('evidence.attach'),
      'the admin bundle must still hold evidence.attach');

    // Behavioural: no other reachable mutation removes the evidence either.
    const templateId = await createTemplate();
    const { versionId } = await authorSourceAndVersion(STEWARD);
    await attachEvidence(templateId, versionId, STEWARD);
    const before = (await evidenceForTemplate(templateId))[0].n;

    const attempts = [
      ['PUT /task-templates/:id', () => call('PUT', `/api/task-templates/${templateId}`, { userId: STEWARD, body: { template_name: 'KF06 attempt' } })],
      ['POST /task-templates/:id/clone', () => call('POST', `/api/task-templates/${templateId}/clone`, { userId: STEWARD, body: {} })],
      ['POST /sources (authoring)', () => call('POST', '/api/knowledge-provenance/sources', { userId: STEWARD, body: { sourceCode: `KF06-X-${uniq()}`, sourceCategory: 'manufacturer_manual', defaultTitle: 'x', issuingOrganization: 'x' } })],
      ['DELETE /task-templates/:id (unauthorized)', () => call('DELETE', `/api/task-templates/${templateId}`, { userId: SUPERVISOR })]
    ];
    for (const [label, attempt] of attempts) {
      const res = await attempt();
      assert.ok(Number.isInteger(res.status), `${label}: expected an HTTP response`);
      assert.strictEqual((await evidenceForTemplate(templateId))[0].n, before,
        `${label} must not change the evidence row count (status ${res.status})`);
    }
  });

  it('R13 — a concurrent attachment cannot be cascaded away: guard and deletion are atomic', async () => {
    const templateId = await createTemplate();
    const { versionId } = await authorSourceAndVersion(ADMIN);

    const client = new Client({
      host: process.env.TEST_DB_HOST,
      port: parseInt(process.env.TEST_DB_PORT, 10),
      database: process.env.TEST_DB_NAME,
      user: process.env.TEST_DB_USER,
      password: process.env.TEST_DB_PASSWORD
    });
    await client.connect();

    let res;
    try {
      // An attachment is written and left UNCOMMITTED, holding the parent row's
      // FOR KEY SHARE lock. The guard cannot see it yet; the deletion must wait
      // for the lock rather than proceed and cascade the row away.
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO knowledge_template_evidence
           (task_template_id, knowledge_source_version_id, section_or_clause, added_by_user_id)
         VALUES ($1, $2, 'S1', $3)`,
        [templateId, versionId, ADMIN]);

      const pending = call('DELETE', `/api/task-templates/${templateId}`, { userId: ADMIN });
      await new Promise((resolve) => setTimeout(resolve, 400));
      await client.query('COMMIT');
      res = await pending;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* the original error is what matters */ }
      throw error;
    } finally {
      await client.end();
    }

    assert.strictEqual(res.status, 409,
      `the concurrent attachment must force a refusal, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.code, 'EVIDENCE_PRESENT', 'refusal code');
    assert.strictEqual((await templateCount(templateId))[0].n, 1, 'the definition must survive');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, 1, 'the concurrently attached evidence must survive');
  });

  it('R14 — a concurrent STEP-level attachment cannot be cascaded away either', async () => {
    const templateId = await createTemplate();
    const stepId = await addStep(templateId);
    const { versionId } = await authorSourceAndVersion(ADMIN);

    const client = new Client({
      host: process.env.TEST_DB_HOST,
      port: parseInt(process.env.TEST_DB_PORT, 10),
      database: process.env.TEST_DB_NAME,
      user: process.env.TEST_DB_USER,
      password: process.env.TEST_DB_PASSWORD
    });
    await client.connect();

    let res;
    try {
      // A step-level attachment takes its FOR KEY SHARE lock on the STEP row, not
      // on the definition, so the definition lock alone would not serialize it.
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO knowledge_template_evidence
           (task_template_step_id, knowledge_source_version_id, section_or_clause, added_by_user_id)
         VALUES ($1, $2, 'S1', $3)`,
        [stepId, versionId, ADMIN]);

      const pending = call('DELETE', `/api/task-templates/${templateId}`, { userId: SUPERVISOR });
      await new Promise((resolve) => setTimeout(resolve, 400));
      await client.query('COMMIT');
      res = await pending;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* the original error is what matters */ }
      throw error;
    } finally {
      await client.end();
    }

    assert.strictEqual(res.status, 409,
      `the concurrent step-level attachment must force a refusal, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.code, 'EVIDENCE_PRESENT', 'refusal code');
    assert.strictEqual((await templateCount(templateId))[0].n, 1, 'the definition must survive');
    assert.strictEqual((await countRows('task_template_steps', 'id', stepId))[0].n, 1, 'the step must survive');
    assert.strictEqual((await evidenceForTemplate(templateId))[0].n, 1, 'the concurrently attached step evidence must survive');
  });

  it('R12 — fixture identifiers stay disjoint from every sibling suite', async () => {
    const fixtureIds = [ORG, ORG_B, ADMIN, SUPERVISOR, OPERATOR, STEWARD,
      FOREIGN_ADMIN, FOREIGN_SUPERVISOR, CATEGORY, CLASS, EQUIPMENT_TYPE];
    const self = path.basename(__filename);
    const siblings = fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js') && n !== self);
    assert.ok(siblings.length > 10, 'expected a populated test corpus to check against');
    for (const id of fixtureIds) {
      for (const name of siblings) {
        const text = fs.readFileSync(path.join(__dirname, name), 'utf8');
        assert.ok(!new RegExp(`\\b${id}\\b`).test(text),
          `fixture id ${id} is already used by ${name}; the shared-database corpus requires a disjoint id block`);
      }
    }
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });
});

/** Search src/ for lines matching a pattern, returning file + trimmed line. */
async function grepSource(pattern) {
  const root = path.join(__dirname, '..', 'src');
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (pattern.test(line)) hits.push({ file: full, line: index + 1, text: line.trim() });
      });
    }
  };
  walk(root);
  return hits;
}
