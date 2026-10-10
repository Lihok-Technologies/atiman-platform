/**
 * Published Knowledge Resolution — ATM-001-KF-04A
 *
 * Verifies the read-only operational resolver for IMMUTABLE PUBLISHED knowledge
 * versions. The defect class this suite guards against is the one the V1 register
 * records as G-13/G-15: an operational consumer being served the MUTABLE working
 * definition instead of the immutable published version.
 *
 * Invariants asserted here:
 *   - only `published`, sealed versions are served;
 *   - a superseded or retired version is refused, never substituted;
 *   - the working definition is NEVER a fallback, and editing it after
 *     publication does not change what the resolver returns;
 *   - tenant isolation is enforced on the FROZEN version scope;
 *   - global (organization_id IS NULL) knowledge stays readable by tenants;
 *   - an unauthenticated caller is refused;
 *   - resolution is EXPLICIT: publishing a second version does not silently
 *     replace the first (no implicit "current"/"latest" business rule);
 *   - discovery returns the frozen applicability verbatim.
 *
 * Publication in this suite is performed out of band (the approved publication
 * lifecycle is covered by knowledge-publication-admission and
 * governed-knowledge-foundation). This suite tests the RESOLUTION contract.
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
  : 'database-mutating published-knowledge-resolution suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// Disposable fixtures. The id block MUST stay disjoint from every other suite's:
// the sanctioned runner executes suites in PARALLEL PROCESSES against ONE shared
// database, and fixtures use `ON CONFLICT (id) DO NOTHING`, so a colliding id
// silently substitutes another suite's principal. `9970xx`/`9971xx` is asserted
// disjoint from the corpus by the R12 test below.
const ORG = 995501;
const ORG_B = 995502;
const ADMIN = 995511;      // ORG admin
const SUPERVISOR = 995512; // ORG supervisor
const OPERATOR = 995513;   // ORG operator
const ADMIN_B = 995514;    // ORG_B admin
const OPERATOR_B = 995515; // ORG_B operator
const CATEGORY = 995521;
const CLASS = 995522;
const EQUIPMENT_TYPE = 995523;
const EQUIPMENT_TYPE_OTHER = 995524;

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-kf04a-000';
const ROUTES_FILE = path.join(__dirname, '..', 'src', 'routes', 'published-knowledge.routes.js');

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

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG, 'KF04A Org A'], [ORG_B, 'KF04A Org B']]) {
      await query(conn, `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, [id, name]);
    }
    for (const [id, username, role, orgId] of [
      [ADMIN, 'kf04a-admin', 'admin', ORG],
      [SUPERVISOR, 'kf04a-supervisor', 'supervisor', ORG],
      [OPERATOR, 'kf04a-operator', 'operator', ORG],
      [ADMIN_B, 'kf04a-admin-b', 'admin', ORG_B],
      [OPERATOR_B, 'kf04a-operator-b', 'operator', ORG_B]
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'KF04A Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, orgId]);
    }
    await query(conn, `INSERT INTO equipment_categories (id, category_code, category_name)
      VALUES (?, 'KF04ACAT', 'KF04A Category') ON CONFLICT (id) DO NOTHING`, [CATEGORY]);
    await query(conn, `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
      VALUES (?, ?, 'KF04ACLS', 'KF04A Class') ON CONFLICT (id) DO NOTHING`, [CLASS, CATEGORY]);
    for (const [id, code, name] of [[EQUIPMENT_TYPE, 'KF04ATYPE', 'KF04A Knife Type'], [EQUIPMENT_TYPE_OTHER, 'KF04AOTHER', 'KF04A Other Type']]) {
      await query(conn, `INSERT INTO equipment_types (id, class_id, type_code, type_name)
        VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`, [id, CLASS, code, name]);
    }
  });
}

/** A working (mutable) draft definition. */
async function createWorkingTemplate(orgId = ORG, name = 'KF04A Working Definition') {
  return withConn(async (conn) => {
    const [t] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name,
         maintenance_type, task_kind, estimated_duration_minutes, priority,
         knowledge_type_id, task_family_id, maintenance_strategy, trigger_mechanism, knowledge_scope, content_origin,
         ai_assisted, ai_assistance_detail)
       VALUES (?, ?, ?, ?, 'preventive', 'inspection', 30, 'medium',
         (SELECT id FROM knowledge_types WHERE type_code='MAINTENANCE_PROCEDURE'),
         (SELECT id FROM task_families WHERE family_code='inspect'),
         'preventive', 'no_fixed_interval', 'customer', 'authored', FALSE, NULL)
       RETURNING id`,
      [EQUIPMENT_TYPE, orgId, `KF04A-${uniq()}`, name]);
    await query(conn,
      `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary, added_by_user_id)
       VALUES (?, ?, true, ?)`, [t.id, EQUIPMENT_TYPE, ADMIN]);
    return t.id;
  });
}

async function addWorkingStep(templateId, instruction) {
  return withConn(async (conn) => {
    const [s] = await query(conn,
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, (SELECT COALESCE(MAX(step_no), 0) + 1 FROM task_template_steps WHERE task_template_id = ?),
               'instruction', ?, true) RETURNING id`,
      [templateId, templateId, instruction]);
    return s.id;
  });
}

/** Out-of-band source + immutable edition (authoring is covered elsewhere). */
async function createSourceVersion(orgId = ORG) {
  return withConn(async (conn) => {
    const [s] = await query(conn,
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, issuing_organization, organization_id, created_by_user_id)
       VALUES (?, 'manufacturer_manual', 'KF04A Source', 'Probe', ?, ?) RETURNING id`,
      [`KF04A-SRC-${uniq()}`, orgId, ADMIN]);
    const [v] = await query(conn,
      `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title, reference_number, created_by_user_id)
       VALUES (?, '1.0', 'KF04A Edition', 'R1', ?) RETURNING id`, [s.id, ADMIN]);
    return { sourceId: s.id, sourceVersionId: v.id };
  });
}

/**
 * Seal a working definition into an immutable published version, out of band.
 * Mirrors the publication shape the admission trigger requires.
 */
async function publishVersion(templateId, {
  organizationId = ORG,
  knowledgeScope = 'customer',
  templateName = 'KF04A Published Version',
  sourceVersionId = null,
  applicabilityTypeId = EQUIPMENT_TYPE,
  withSafety = true
} = {}) {
  // The publication-admission trigger requires a frozen provenance evidence row,
  // and a safety attestation that matches the frozen control set. Fixtures must
  // therefore always carry evidence; one is created when the caller omits it.
  let evidenceSourceVersionId = sourceVersionId;
  if (!evidenceSourceVersionId) {
    const created = await createSourceVersion(organizationId === null ? null : organizationId);
    evidenceSourceVersionId = created.sourceVersionId;
  }
  const safetyReviewState = withSafety ? 'reviewed_controls_defined' : 'reviewed_no_control_required';

  return withConn(async (conn) => {
    const steps = await query(conn,
      `SELECT id, step_no, step_type, instruction FROM task_template_steps WHERE task_template_id = ? ORDER BY step_no`,
      [templateId]);
    assert.ok(steps.length > 0, 'fixture requires at least one working step before publication');

    const [version] = await query(conn,
      `INSERT INTO task_template_versions (task_template_id, version_number, equipment_type_id, template_name,
         maintenance_type, lifecycle_state_at_publish, is_step_set_sealed, knowledge_scope, organization_id,
         knowledge_type_id, task_family_id, maintenance_strategy, trigger_mechanism,
         published_by_user_id, reviewer_user_id, reviewed_at, approver_user_id, approved_at,
         safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at)
       VALUES (?, (SELECT COALESCE(MAX(version_number), 0) + 1 FROM task_template_versions WHERE task_template_id = ?),
         ?, ?, 'preventive', 'published', FALSE, ?, ?,
         (SELECT id FROM knowledge_types WHERE type_code='MAINTENANCE_PROCEDURE'),
         (SELECT id FROM task_families WHERE family_code='inspect'),
         'preventive', 'no_fixed_interval',
         ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP,
         ?, ?, CURRENT_TIMESTAMP)
       RETURNING id`,
      [templateId, templateId, applicabilityTypeId, templateName, knowledgeScope, organizationId,
        SUPERVISOR, ADMIN, ADMIN, safetyReviewState, ADMIN]);

    await query(conn,
      `INSERT INTO task_template_version_equipment_types (task_template_version_id, equipment_type_id, is_primary)
       VALUES (?, ?, true)`, [version.id, applicabilityTypeId]);

    for (const step of steps) {
      await query(conn,
        `INSERT INTO task_template_step_versions (task_template_version_id, step_no, task_template_step_id, step_type, instruction)
         VALUES (?, ?, ?, ?, ?)`, [version.id, step.step_no, step.id, step.step_type, step.instruction]);
    }
    if (withSafety) {
      const [control] = await query(conn,
        `INSERT INTO task_template_safety_controls (task_template_id, safety_type, description, is_mandatory)
         VALUES (?, 'isolation', 'KF04A isolate before work', true) RETURNING id`, [templateId]);
      await query(conn,
        `INSERT INTO task_template_safety_control_versions (task_template_version_id, task_template_safety_control_id, safety_type, description, is_mandatory)
         VALUES (?, ?, 'isolation', 'KF04A isolate before work', true)`, [version.id, control.id]);
    }
    await query(conn,
      `INSERT INTO knowledge_template_version_evidence
         (task_template_version_id, knowledge_source_version_id, section_or_clause, confidence_level, supporting_role)
       VALUES (?, ?, 'S1', 'established', 'primary')`, [version.id, evidenceSourceVersionId]);
    await query(conn, `UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = ?`, [version.id]);
    return version.id;
  });
}

const templateVersionCount = (templateId) => withConn((conn) =>
  query(conn, `SELECT COUNT(*)::int AS n FROM task_template_versions WHERE task_template_id = ?`, [templateId]));
const versionState = (versionId) => withConn((conn) =>
  query(conn, `SELECT lifecycle_state_at_publish FROM task_template_versions WHERE id = ?`, [versionId]));

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
const resolveVersion = (versionId, userId) =>
  call('GET', `/api/knowledge-published/versions/${versionId}`, { userId });
const listForTemplate = (templateId, userId) =>
  call('GET', `/api/knowledge-published/templates/${templateId}/versions`, { userId });
const listForType = (typeId, userId) =>
  call('GET', `/api/knowledge-published/equipment-types/${typeId}/versions`, { userId });

describe('Published Knowledge Resolution (ATM-001-KF-04A)', { skip: DB_TEST_SKIP_REASON }, () => {
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
  // A — the resolver serves immutable published content
  // =========================================================================
  it('A — resolves a published version with its frozen steps, safety controls, applicability and evidence', async () => {
    const templateId = await createWorkingTemplate();
    await addWorkingStep(templateId, 'KF04A step one');
    await addWorkingStep(templateId, 'KF04A step two');
    const { sourceVersionId } = await createSourceVersion();
    const versionId = await publishVersion(templateId, { templateName: 'KF04A Published Name', sourceVersionId });

    const res = await resolveVersion(versionId, OPERATOR);

    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    const data = res.body.data;
    assert.strictEqual(data.version.id, versionId);
    assert.strictEqual(data.version.lifecycleState, 'published');
    assert.strictEqual(data.version.isStepSetSealed, true);
    assert.strictEqual(data.version.organizationScope, 'tenant');
    assert.strictEqual(data.version.templateName, 'KF04A Published Name');
    assert.strictEqual(data.steps.length, 2, 'both frozen steps are served');
    assert.deepStrictEqual(data.steps.map((s) => s.stepNo), [1, 2], 'steps are in execution order');
    assert.strictEqual(data.steps[0].instruction, 'KF04A step one');
    assert.strictEqual(data.safetyControls.length, 1, 'frozen safety controls are served');
    assert.strictEqual(data.safetyControls[0].isMandatory, true);
    assert.strictEqual(data.applicability.length, 1, 'frozen applicability is served');
    assert.strictEqual(data.applicability[0].equipmentTypeId, EQUIPMENT_TYPE);
    assert.strictEqual(data.evidence.length, 1, 'frozen provenance evidence is served');
    assert.strictEqual(data.evidence[0].confidenceLevel, 'established');
    assert.strictEqual(data.evidence[0].supportingRole, 'primary');
    assert.strictEqual(data.evidence[0].subject, 'version');
    assert.ok(data.evidence[0].sourceCode, 'evidence carries its source identity');
    assert.strictEqual(data.evidence[0].versionDesignation, '1.0', 'evidence carries its edition identity');
    // No internal content fingerprint is projected into the operational contract.
    assert.strictEqual(data.version.approvedContentSha, undefined, 'internal fingerprint is not exposed');
  });

  // =========================================================================
  // B — a draft / unpublished definition is never served
  // =========================================================================
  it('B — a definition with no published version yields no resolvable knowledge (no draft substitution)', async () => {
    const templateId = await createWorkingTemplate();
    await addWorkingStep(templateId, 'KF04A draft-only step');

    const list = await listForTemplate(templateId, ADMIN);
    assert.strictEqual(list.status, 200, `list must succeed: ${JSON.stringify(list.body)}`);
    assert.deepStrictEqual(list.body.data.versions, [], 'a draft has no published version to serve');

    // No version row exists, so any version id is a non-disclosing not-found.
    const miss = await resolveVersion(999999999, ADMIN);
    assert.strictEqual(miss.status, 404, 'an unknown version is a non-disclosing 404');
    assert.strictEqual((await templateVersionCount(templateId))[0].n, 0, 'no version was created by reading');
  });

  // =========================================================================
  // C/D — superseded and retired versions are refused
  // =========================================================================
  it('C — a superseded version is refused, never served as current guidance', async () => {
    const templateId = await createWorkingTemplate();
    await addWorkingStep(templateId, 'KF04A supersede step');
    const first = await publishVersion(templateId, { templateName: 'KF04A v1' });
    const second = await publishVersion(templateId, { templateName: 'KF04A v2' });
    await withConn((conn) => query(conn,
      `UPDATE task_template_versions SET superseded_by_version_id = ? WHERE id = ?`, [second, first]));
    assert.strictEqual((await versionState(first))[0].lifecycle_state_at_publish, 'superseded', 'fixture must really be superseded');

    const res = await resolveVersion(first, ADMIN);
    assert.strictEqual(res.status, 409, `expected 409, got ${res.status}`);
    assert.strictEqual(res.body.code, 'PUBLISHED_VERSION_NOT_CURRENT');
  });

  it('D — a retired version is refused', async () => {
    const templateId = await createWorkingTemplate();
    await addWorkingStep(templateId, 'KF04A retire step');
    const versionId = await publishVersion(templateId, { templateName: 'KF04A retire me' });
    await withConn((conn) => query(conn,
      `UPDATE task_template_versions SET lifecycle_state_at_publish = 'retired' WHERE id = ?`, [versionId]));
    assert.strictEqual((await versionState(versionId))[0].lifecycle_state_at_publish, 'retired');

    const res = await resolveVersion(versionId, ADMIN);
    assert.strictEqual(res.status, 409, `expected 409, got ${res.status}`);
    assert.strictEqual(res.body.code, 'PUBLISHED_VERSION_NOT_CURRENT');
  });

  // =========================================================================
  // E — the working definition is never a fallback
  // =========================================================================
  it('E — editing the working definition after publication never changes what is resolved', async () => {
    const templateId = await createWorkingTemplate(ORG, 'KF04A Original Working Name');
    await addWorkingStep(templateId, 'KF04A frozen instruction');
    const versionId = await publishVersion(templateId, { templateName: 'KF04A Frozen Published Name' });

    const before = await resolveVersion(versionId, SUPERVISOR);
    assert.strictEqual(before.body.data.version.templateName, 'KF04A Frozen Published Name');
    assert.strictEqual(before.body.data.steps.length, 1);

    // Mutate the working definition the way authoring legitimately would.
    await withConn(async (conn) => {
      await query(conn, `UPDATE task_templates SET template_name = ? WHERE id = ?`, ['KF04A Mutated Working Name', templateId]);
      await query(conn, `UPDATE task_template_steps SET instruction = ? WHERE task_template_id = ?`, ['KF04A mutated instruction', templateId]);
    });
    await addWorkingStep(templateId, 'KF04A added after publication');

    const after = await resolveVersion(versionId, SUPERVISOR);
    assert.strictEqual(after.status, 200);
    assert.strictEqual(after.body.data.version.templateName, 'KF04A Frozen Published Name', 'frozen header is unchanged');
    assert.strictEqual(after.body.data.steps.length, 1, 'a step added after publication is not in the frozen set');
    assert.strictEqual(after.body.data.steps[0].instruction, 'KF04A frozen instruction', 'frozen step text is unchanged');
  });

  // =========================================================================
  // F — tenant isolation on the frozen version scope
  // =========================================================================
  it('F — a tenant-scoped version is not readable by another tenant, and is readable by its owner', async () => {
    const templateId = await createWorkingTemplate(ORG_B);
    await addWorkingStep(templateId, 'KF04A tenant B step');
    const versionId = await publishVersion(templateId, { organizationId: ORG_B, templateName: 'KF04A Tenant B version' });

    const foreign = await resolveVersion(versionId, ADMIN);           // ORG
    assert.strictEqual(foreign.status, 404, 'cross-tenant resolution must be a non-disclosing 404');

    const foreignList = await listForTemplate(templateId, ADMIN);
    assert.deepStrictEqual(foreignList.body.data.versions, [], 'cross-tenant listing exposes nothing');

    const owner = await resolveVersion(versionId, OPERATOR_B);
    assert.strictEqual(owner.status, 200, `owner tenant must resolve: ${JSON.stringify(owner.body)}`);
    assert.strictEqual(owner.body.data.version.organizationScope, 'tenant');
  });

  // =========================================================================
  // G — global knowledge protection (readable, not mutable here)
  // =========================================================================
  it('G — a global (organization_id IS NULL) published version is readable by a tenant', async () => {
    const templateId = await createWorkingTemplate();
    await addWorkingStep(templateId, 'KF04A global step');
    const versionId = await publishVersion(templateId, {
      organizationId: null, knowledgeScope: 'shared', templateName: 'KF04A Shared Reference'
    });

    const res = await resolveVersion(versionId, OPERATOR);
    assert.strictEqual(res.status, 200, `global version must be readable: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.data.version.organizationScope, 'global');

    const foreignTenant = await resolveVersion(versionId, OPERATOR_B);
    assert.strictEqual(foreignTenant.status, 200, 'global knowledge is readable across tenants');
  });

  // =========================================================================
  // H — authorization
  // =========================================================================
  it('H — an unauthenticated caller is refused', async () => {
    const templateId = await createWorkingTemplate();
    await addWorkingStep(templateId, 'KF04A auth step');
    const versionId = await publishVersion(templateId);

    const res = await call('GET', `/api/knowledge-published/versions/${versionId}`, {});
    assert.strictEqual(res.status, 401, `expected 401, got ${res.status}`);
  });

  // =========================================================================
  // I — explicit selection, no silent latest-version replacement
  // =========================================================================
  it('I — publishing a second version does not silently replace the first', async () => {
    const templateId = await createWorkingTemplate();
    await addWorkingStep(templateId, 'KF04A versioning step');
    const v1 = await publishVersion(templateId, { templateName: 'KF04A explicit v1' });
    const v2 = await publishVersion(templateId, { templateName: 'KF04A explicit v2' });

    const list = await listForTemplate(templateId, ADMIN);
    const ids = list.body.data.versions.map((v) => v.id);
    assert.deepStrictEqual(ids, [v2, v1], 'both published versions are offered, newest first, for explicit choice');

    const r1 = await resolveVersion(v1, ADMIN);
    const r2 = await resolveVersion(v2, ADMIN);
    assert.strictEqual(r1.body.data.version.templateName, 'KF04A explicit v1', 'v1 resolves to v1, explicitly');
    assert.strictEqual(r2.body.data.version.templateName, 'KF04A explicit v2');
    assert.notStrictEqual(r1.body.data.version.id, r2.body.data.version.id);
  });

  // =========================================================================
  // J — discovery by frozen applicability
  // =========================================================================
  it('J — discovery by Equipment Type returns only versions whose frozen applicability covers it', async () => {
    const matching = await createWorkingTemplate();
    await addWorkingStep(matching, 'KF04A matching step');
    const matchingVersion = await publishVersion(matching, { applicabilityTypeId: EQUIPMENT_TYPE });

    const other = await createWorkingTemplate();
    await addWorkingStep(other, 'KF04A other step');
    const otherVersion = await publishVersion(other, { applicabilityTypeId: EQUIPMENT_TYPE_OTHER });

    const res = await listForType(EQUIPMENT_TYPE, OPERATOR);
    assert.strictEqual(res.status, 200);
    const ids = res.body.data.versions.map((v) => v.id);
    assert.ok(ids.includes(matchingVersion), 'the applicable version is discovered');
    assert.ok(!ids.includes(otherVersion), 'a version applicable to another Type is not offered');
    const offered = res.body.data.versions.find((v) => v.id === matchingVersion);
    assert.strictEqual(offered.equipmentTypeId, EQUIPMENT_TYPE);
  });

  // =========================================================================
  // K — validation and fail-closed input handling
  // =========================================================================
  it('K — a non-numeric version id is rejected with 400, not a 500 or a wildcard', async () => {
    const res = await resolveVersion('not-a-number', ADMIN);
    assert.strictEqual(res.status, 400, `expected 400, got ${res.status}`);
    assert.strictEqual(res.body.code, 'PUBLISHED_KNOWLEDGE_VALIDATION_FAILED');
  });

  // =========================================================================
  // L — the route surface is read-only and does not change capabilities
  // =========================================================================
  it('L — the resolver adds only read routes, no capability or bundle change', async () => {
    const routes = fs.readFileSync(ROUTES_FILE, 'utf8');
    const mutations = routes.match(/router\.(post|put|patch|delete)\(/g) || [];
    assert.strictEqual(mutations.length, 0, 'the published-knowledge surface exposes no mutating route');
    assert.match(routes, /requirePermission\('KNOWLEDGE', 'VIEW'\)/, 'reads use the existing KNOWLEDGE.VIEW guard');

    const { CAPABILITIES, LEGACY_COMPATIBILITY_BUNDLES } = require('../src/config/capabilities');
    assert.strictEqual(Object.keys(CAPABILITIES).length, 21, 'capability vocabulary is unchanged (21)');
    assert.ok(!LEGACY_COMPATIBILITY_BUNDLES.supervisor.includes('evidence.attach'));
    assert.strictEqual(LEGACY_COMPATIBILITY_BUNDLES.operator.length, 2, 'operator bundle unchanged');
    assert.strictEqual(LEGACY_COMPATIBILITY_BUNDLES.supervisor.length, 14, 'supervisor bundle unchanged');
  });

  it('R12 — fixture identifiers stay disjoint from every sibling suite', async () => {
    const fixtureIds = [ORG, ORG_B, ADMIN, SUPERVISOR, OPERATOR, ADMIN_B, OPERATOR_B,
      CATEGORY, CLASS, EQUIPMENT_TYPE, EQUIPMENT_TYPE_OTHER];
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
