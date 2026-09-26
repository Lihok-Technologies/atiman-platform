/**
 * Governed Crosswalk Application Layer — Integration Tests
 *
 * ATM-001 M5R.3E — proves the governed application layer over the accepted
 * M5R.3C crosswalk (migration 017) and M5R.3D evidence (migration 018).
 *
 * Two layers are exercised:
 *   - HTTP: the real Express app with real JWTs, proving that authorization uses
 *     the EXISTING capability model and that every governed operation is a named
 *     action rather than generic CRUD.
 *   - Direct model/SQL: proving the database guards are the real enforcement and
 *     that the model surfaces them rather than working around them.
 *
 * The mandatory rule under test: APPROVAL MUST BE EVIDENCE-BACKED. The ADR (§O)
 * states it and §AG assigns its enforcement to the service/domain layer, so this
 * suite proves it is enforced here and is transactionally safe against
 * concurrent evidence detachment.
 *
 * Copyright boundary: every fixture is SYNTHETIC. No standards content is
 * reproduced, imported or asserted.
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
  EquipmentTypeExternalClassification,
  ExternalClassificationCrosswalkEvidence
} = require('../src/models/knowledge-crosswalk.model');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating crosswalk application suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';
const ORG = 997301;
const ADMIN = 997311;
const SUPERVISOR = 997312;
const OPERATOR = 997313;
const CODE_PREFIX = 'M5R3E-';
const CATEGORY_PREFIX = 'M5R3ECAT-';

const UNIQ = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const query = (conn, sql, params) => conn.query(sql, params);

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

// ---------------------------------------------------------------- HTTP helpers

let server;
let port;

function call(method, httpPath, { userId, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: httpPath,
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

// ------------------------------------------------------------------- fixtures

async function ensureFixture() {
  await withConn(async (conn) => {
    await query(conn,
      `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
      [ORG, 'M5R3E Org']);
    // usernames and emails are scoped to the id so this fixture can never
    // collide with another suite's user (users.username is globally unique).
    for (const [id, role] of [[ADMIN, 'admin'], [SUPERVISOR, 'supervisor'], [OPERATOR, 'operator']]) {
      const name = `m5r3e-${id}`;
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', ?, ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, name, `${name}@test.local`, name, role, ORG]);
    }
  });
}

async function createEquipmentType() {
  const tag = UNIQ();
  return withConn(async (conn) => {
    const cat = await query(conn,
      `INSERT INTO equipment_categories (category_code, category_name) VALUES (?, ?) RETURNING id`,
      [`${CATEGORY_PREFIX}${tag}`, `M5R3E Category ${tag}`]);
    const cls = await query(conn,
      `INSERT INTO equipment_classes (category_id, class_code, class_name) VALUES (?, ?, ?) RETURNING id`,
      [cat[0].id, `${CODE_PREFIX}CLS-${tag}`, `M5R3E Class ${tag}`]);
    const typ = await query(conn,
      `INSERT INTO equipment_types (class_id, type_code, type_name) VALUES (?, ?, ?) RETURNING id`,
      [cls[0].id, `${CODE_PREFIX}TYP-${tag}`, `M5R3E Type ${tag}`]);
    return typ[0].id;
  });
}

/** organizationId NULL = global authority; non-null = tenant-scoped authority. */
async function createAuthority({ organizationId = null } = {}) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, issuing_organization, organization_id)
       VALUES (?, 'engineering_standard', 'M5R3E Synthetic Authority', 'Synthetic Authority', ?)
       RETURNING id`, [`${CODE_PREFIX}AUTH-${UNIQ()}`, organizationId]);
    return rows[0].id;
  });
}

async function addEdition(sourceId, designation) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_source_versions
         (knowledge_source_id, version_designation, title, reference_number, issuing_organization)
       VALUES (?, ?, 'M5R3E Synthetic Edition', 'SYNTH-REF', 'Synthetic Authority')
       RETURNING id`, [sourceId, designation]);
    return rows[0].id;
  });
}

async function addClassification(versionId, label = 'Synthetic Pump Classification') {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO external_classification
         (knowledge_source_version_id, classification_code, classification_label)
       VALUES (?, ?, ?) RETURNING id`, [versionId, `EXT-PUMP-${UNIQ()}`, label]);
    return rows[0].id;
  });
}

/** A global authority edition owning one classification. */
async function globalEditionWithClassification() {
  const versionId = await addEdition(await createAuthority(), '2016');
  const classificationId = await addClassification(versionId);
  return { versionId, classificationId };
}

// -------------------------------------------------------------- operation helpers

async function propose(body, userId = ADMIN) {
  const res = await call('POST', '/api/knowledge-crosswalks', { userId, body });
  assert.strictEqual(res.status, 201, `propose failed: ${JSON.stringify(res.body)}`);
  return res.body.data.crosswalk;
}

async function proposeMapped({ equipmentTypeId, versionId, classificationId }) {
  return propose({
    equipmentTypeId, knowledgeSourceVersionId: versionId, externalClassificationId: classificationId,
    mappingOutcome: 'DIRECT_EQUIVALENT'
  });
}

async function proposeNoDirectMapping({ equipmentTypeId, versionId }) {
  return propose({ equipmentTypeId, knowledgeSourceVersionId: versionId, mappingOutcome: 'NO_DIRECT_MAPPING' });
}

async function submit(crosswalkId, userId = SUPERVISOR) {
  return call('POST', `/api/knowledge-crosswalks/${crosswalkId}/submit`, { userId });
}

async function approve(crosswalkId, userId = SUPERVISOR) {
  return call('POST', `/api/knowledge-crosswalks/${crosswalkId}/approve`, { userId });
}

async function attachEvidence(crosswalkId, body, userId = ADMIN) {
  return call('POST', `/api/knowledge-crosswalks/${crosswalkId}/evidence`, { userId, body });
}

/** The synthetic locator every evidence fixture uses. */
const evidenceBody = (versionId, overrides = {}) => ({
  knowledgeSourceVersionId: versionId,
  sectionOrClause: 'SYNTH-1.1',
  pageOrParagraph: 'p. 1',
  derivationNotes: 'Synthetic derivation note',
  confidenceLevel: 'established',
  supportingRole: 'primary',
  ...overrides
});

/** A fully approved mapped crosswalk with its own relationship evidence. */
async function approvedMappedCrosswalk() {
  const typeId = await createEquipmentType();
  const { versionId, classificationId } = await globalEditionWithClassification();
  const crosswalk = await proposeMapped({
    equipmentTypeId: typeId, versionId, classificationId
  });
  await attachEvidence(crosswalk.id, evidenceBody(versionId));
  await submit(crosswalk.id);
  const res = await approve(crosswalk.id);
  assert.strictEqual(res.status, 200, `approval failed: ${JSON.stringify(res.body)}`);
  return { crosswalk, typeId, versionId, classificationId };
}

describe('Governed Crosswalk Application Layer (ATM-001 M5R.3E)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    const app = require('../src/app');
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // ==========================================================
  // READ
  // ==========================================================
  describe('READ', () => {
    it('1. lists crosswalks for an equipment type', async () => {
      const { crosswalk, typeId } = await approvedMappedCrosswalk();
      const res = await call('GET', `/api/knowledge-crosswalks?equipmentTypeId=${typeId}`, { userId: OPERATOR });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.equipmentTypeId, typeId);
      assert.strictEqual(res.body.data.investigated, true);
      assert.ok(res.body.data.crosswalks.some((c) => Number(c.id) === Number(crosswalk.id)));
    });

    it('2. reads one crosswalk', async () => {
      const { crosswalk } = await approvedMappedCrosswalk();
      const res = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}`, { userId: OPERATOR });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(Number(res.body.data.crosswalk.id), Number(crosswalk.id));
      assert.strictEqual(res.body.data.crosswalk.review_state, 'approved');
    });

    it('3. exposes source and edition provenance', async () => {
      const { crosswalk, versionId } = await approvedMappedCrosswalk();
      const res = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}`, { userId: OPERATOR });
      const row = res.body.data.crosswalk;
      assert.strictEqual(Number(row.knowledge_source_version_id), Number(versionId));
      assert.strictEqual(row.version_designation, '2016');
      assert.ok(row.source_code && row.source_code.startsWith(CODE_PREFIX));
      assert.strictEqual(row.source_organization_id, null, 'the authority is global');
      assert.strictEqual(row.reference_number, 'SYNTH-REF');
    });

    it('4. exposes evidence', async () => {
      const { crosswalk } = await approvedMappedCrosswalk();
      const res = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}/evidence`, { userId: OPERATOR });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.subject, 'crosswalk');
      assert.strictEqual(res.body.data.evidence.length, 1);
      assert.strictEqual(res.body.data.evidence[0].section_or_clause, 'SYNTH-1.1');
    });

    it('5. history and supersession are reachable', async () => {
      const { crosswalk, typeId } = await approvedMappedCrosswalk();
      const edition2024 = await addEdition(await createAuthority(), '2024');
      const successor = await proposeMapped({
        equipmentTypeId: typeId, versionId: edition2024,
        classificationId: await addClassification(edition2024)
      });
      await attachEvidence(successor.id, evidenceBody(edition2024));
      await submit(successor.id);
      await approve(successor.id);
      const linked = await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: successor.id } });
      assert.strictEqual(linked.status, 200, JSON.stringify(linked.body));

      const history = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}/history`, { userId: OPERATOR });
      assert.strictEqual(history.status, 200);
      assert.strictEqual(history.body.data.history.length, 2, 'predecessor and successor are both reachable');
      assert.strictEqual(history.body.data.history[0].lifecycle, 'superseded');
      assert.strictEqual(history.body.data.history[1].lifecycle, 'approved_mapping');
      assert.strictEqual(Number(history.body.data.currentId), Number(successor.id));

      // The default list shows current truth only; history requires asking for it.
      const current = await call('GET', `/api/knowledge-crosswalks?equipmentTypeId=${typeId}`, { userId: OPERATOR });
      assert.ok(!current.body.data.crosswalks.some((c) => Number(c.id) === Number(crosswalk.id)),
        'a superseded row is not current truth');
      const withHistory = await call('GET',
        `/api/knowledge-crosswalks?equipmentTypeId=${typeId}&includeHistory=true`, { userId: OPERATOR });
      assert.ok(withHistory.body.data.crosswalks.some((c) => Number(c.id) === Number(crosswalk.id)),
        'but it is never deleted, and is reachable on request');
    });

    it('6. review_state and mapping_outcome stay separate facts', async () => {
      const typeId = await createEquipmentType();
      const { versionId } = await globalEditionWithClassification();

      // approved + NO_DIRECT_MAPPING must be expressible as ONE row carrying both
      // facts, not collapsed into one status.
      const ndm = await proposeNoDirectMapping({ equipmentTypeId: typeId, versionId });
      await attachEvidence(ndm.id, evidenceBody(versionId));
      await submit(ndm.id);
      const approved = await approve(ndm.id);
      assert.strictEqual(approved.status, 200, JSON.stringify(approved.body));

      const res = await call('GET', `/api/knowledge-crosswalks/${ndm.id}`, { userId: OPERATOR });
      const row = res.body.data.crosswalk;
      assert.strictEqual(row.review_state, 'approved', 'governance status');
      assert.strictEqual(row.mapping_outcome, 'NO_DIRECT_MAPPING', 'engineering conclusion');
      assert.strictEqual(row.lifecycle, 'approved_no_direct_mapping', 'derived, not substituted');
      assert.strictEqual(row.external_classification_id, null);
      assert.strictEqual(row.relationship, null);
    });

    it('6b. absence of a row is reported as not investigated, never invented', async () => {
      const typeId = await createEquipmentType();
      const { versionId } = await globalEditionWithClassification();
      const res = await call('GET', `/api/knowledge-crosswalks?equipmentTypeId=${typeId}`, { userId: OPERATOR });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.crosswalks.length, 0);
      assert.strictEqual(res.body.data.investigated, false,
        'no row means no governed conclusion, which is not NO_DIRECT_MAPPING');

      const model = await EquipmentTypeExternalClassification
        .hasBeenInvestigated(typeId, versionId);
      assert.strictEqual(model, false);
    });
  });

  // ==========================================================
  // PROPOSE
  // ==========================================================
  describe('PROPOSE', () => {
    it('7. a valid mapped draft can be proposed', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      assert.strictEqual(crosswalk.review_state, 'draft');
      assert.strictEqual(crosswalk.mapping_outcome, 'DIRECT_EQUIVALENT');
      assert.strictEqual(crosswalk.relationship, 'DIRECT_EQUIVALENT',
        'the mirror column is derived from the outcome, never demanded from the caller');
      assert.strictEqual(Number(crosswalk.proposed_by_user_id), ADMIN,
        'proposer attribution comes from the authenticated principal');
    });

    it('8. a valid NO_DIRECT_MAPPING draft can be proposed', async () => {
      const typeId = await createEquipmentType();
      const { versionId } = await globalEditionWithClassification();
      const crosswalk = await proposeNoDirectMapping({ equipmentTypeId: typeId, versionId });
      assert.strictEqual(crosswalk.review_state, 'draft');
      assert.strictEqual(crosswalk.mapping_outcome, 'NO_DIRECT_MAPPING');
      assert.strictEqual(crosswalk.external_classification_id, null);
      assert.strictEqual(crosswalk.relationship, null);
    });

    it('9. an incoherent proposal is rejected', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();

      const mappedWithoutConcept = await call('POST', '/api/knowledge-crosswalks',
        { userId: ADMIN, body: { equipmentTypeId: typeId, knowledgeSourceVersionId: versionId, mappingOutcome: 'RELATED_TO' } });
      assert.strictEqual(mappedWithoutConcept.status, 400);
      assert.ok(mappedWithoutConcept.body.failures.some((f) => f.rule === 'CROSSWALK_MAPPING_REQUIRES_CLASSIFICATION'));

      const ndmWithConcept = await call('POST', '/api/knowledge-crosswalks',
        { userId: ADMIN, body: { equipmentTypeId: typeId, knowledgeSourceVersionId: versionId, externalClassificationId: classificationId, mappingOutcome: 'NO_DIRECT_MAPPING' } });
      assert.strictEqual(ndmWithConcept.status, 400);
      assert.ok(ndmWithConcept.body.failures.some((f) => f.rule === 'CROSSWALK_NDM_HAS_CLASSIFICATION'));

      const badOutcome = await call('POST', '/api/knowledge-crosswalks',
        { userId: ADMIN, body: { equipmentTypeId: typeId, knowledgeSourceVersionId: versionId, mappingOutcome: 'SECTOR_SPECIFIC_EQUIVALENT' } });
      assert.strictEqual(badOutcome.status, 400);
      assert.ok(badOutcome.body.failures.some((f) => f.rule === 'CROSSWALK_OUTCOME_INVALID'));
    });

    it('10. a tenant-scoped source is rejected', async () => {
      const typeId = await createEquipmentType();
      const tenantEdition = await addEdition(await createAuthority({ organizationId: ORG }), '1.0');
      const res = await call('POST', '/api/knowledge-crosswalks',
        { userId: ADMIN, body: { equipmentTypeId: typeId, knowledgeSourceVersionId: tenantEdition, mappingOutcome: 'NO_DIRECT_MAPPING' } });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'CROSSWALK_SOURCE_NOT_GLOBAL');
    });

    it('10b. an edition mismatch is rejected', async () => {
      const typeId = await createEquipmentType();
      const sourceId = await createAuthority();
      const ed2016 = await addEdition(sourceId, '2016');
      const ed2024 = await addEdition(sourceId, '2024');
      const concept2016 = await addClassification(ed2016);
      const res = await call('POST', '/api/knowledge-crosswalks',
        {
          userId: ADMIN,
          body: {
            equipmentTypeId: typeId, knowledgeSourceVersionId: ed2024,
            externalClassificationId: concept2016, mappingOutcome: 'DIRECT_EQUIVALENT'
          }
        });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'CROSSWALK_EDITION_MISMATCH');
    });
  });

  // ==========================================================
  // WORKFLOW
  // ==========================================================
  describe('WORKFLOW', () => {
    it('11. draft -> under_review works', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      const res = await submit(crosswalk.id);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.crosswalk.review_state, 'under_review');
      assert.strictEqual(res.body.data.crosswalk.mapping_outcome, 'DIRECT_EQUIVALENT',
        'the conclusion is untouched by a governance transition');
    });

    it('12. under_review -> approved works WITH relationship evidence', async () => {
      const { crosswalk } = await approvedMappedCrosswalk();
      const res = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}`, { userId: OPERATOR });
      const row = res.body.data.crosswalk;
      assert.strictEqual(row.review_state, 'approved');
      assert.ok(row.reviewed_by_user_id, 'reviewer attribution is recorded');
      assert.ok(row.reviewed_at);
      assert.ok(row.approved_by_user_id, 'approver attribution is recorded');
      assert.ok(row.approved_at);
    });

    it('13. approval WITHOUT relationship evidence fails', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      await submit(crosswalk.id);
      const res = await approve(crosswalk.id);
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'CROSSWALK_RELATIONSHIP_EVIDENCE_REQUIRED');

      const after = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}`, { userId: OPERATOR });
      assert.strictEqual(after.body.data.crosswalk.review_state, 'under_review',
        'a refused approval leaves the proposal governed but unapproved');
      assert.strictEqual(after.body.data.crosswalk.approved_by_user_id, null);
    });

    it('14. external-concept-only evidence does NOT satisfy approval', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });

      // Concept evidence: evidence that the external concept exists. Written
      // directly because the approved API exposes only crosswalk-scoped evidence
      // attachment; the crosswalk is not the subject of this row.
      await withConn((conn) => query(conn,
        `INSERT INTO equipment_type_external_classification_evidence
           (knowledge_source_version_id, external_classification_id, crosswalk_id, section_or_clause)
         VALUES (?, ?, NULL, 'SYNTH-1.1')`, [versionId, classificationId]));

      await submit(crosswalk.id);
      const res = await approve(crosswalk.id);
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'CROSSWALK_RELATIONSHIP_EVIDENCE_REQUIRED',
        'evidence about the concept says nothing about the Atiman relationship');

      const count = await EquipmentTypeExternalClassification.countRelationshipEvidence(crosswalk.id);
      assert.strictEqual(count, 0);
    });

    it('15. NO_DIRECT_MAPPING approval WITH relationship evidence succeeds', async () => {
      const typeId = await createEquipmentType();
      const { versionId } = await globalEditionWithClassification();
      const crosswalk = await proposeNoDirectMapping({ equipmentTypeId: typeId, versionId });
      await attachEvidence(crosswalk.id, evidenceBody(versionId, {
        derivationNotes: 'the edition was reviewed and no defensible direct mapping exists'
      }));
      await submit(crosswalk.id);
      const res = await approve(crosswalk.id);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.crosswalk.mapping_outcome, 'NO_DIRECT_MAPPING');
      assert.strictEqual(res.body.data.relationshipEvidence, 1);
    });

    it('16. NO_DIRECT_MAPPING approval WITHOUT evidence fails', async () => {
      const typeId = await createEquipmentType();
      const { versionId } = await globalEditionWithClassification();
      const crosswalk = await proposeNoDirectMapping({ equipmentTypeId: typeId, versionId });
      await submit(crosswalk.id);
      const res = await approve(crosswalk.id);
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'CROSSWALK_RELATIONSHIP_EVIDENCE_REQUIRED',
        '"we investigated and found nothing" is a positive conclusion and must be evidenced');
    });

    it('17. invalid direct state jumps fail', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();

      // draft -> approved, bypassing review entirely.
      const fresh = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      await attachEvidence(fresh.id, evidenceBody(versionId));
      const jump = await approve(fresh.id);
      assert.strictEqual(jump.status, 409);
      assert.strictEqual(jump.body.code, 'CROSSWALK_INVALID_TRANSITION');

      // submitting twice is not a transition.
      await submit(fresh.id);
      const twice = await submit(fresh.id);
      assert.strictEqual(twice.status, 409);
      assert.strictEqual(twice.body.code, 'CROSSWALK_INVALID_TRANSITION');

      // rejecting something already approved is not a transition.
      await approve(fresh.id);
      const lateReject = await call('POST', `/api/knowledge-crosswalks/${fresh.id}/reject`, { userId: SUPERVISOR });
      assert.strictEqual(lateReject.status, 409);
      assert.strictEqual(lateReject.body.code, 'CROSSWALK_INVALID_TRANSITION');
    });

    it('18. a rejected proposal is retained as governed knowledge', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      await submit(crosswalk.id);
      const rejected = await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/reject`, { userId: SUPERVISOR });
      assert.strictEqual(rejected.status, 200);
      assert.strictEqual(rejected.body.data.crosswalk.review_state, 'rejected');
      assert.ok(rejected.body.data.crosswalk.reviewed_by_user_id, 'the refusal is attributed');

      // Still readable, and still not deletable through the application.
      const read = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}`, { userId: OPERATOR });
      assert.strictEqual(read.status, 200);
      assert.strictEqual(read.body.data.crosswalk.review_state, 'rejected');

      // The database refuses to delete it, so "considered and refused" survives.
      await assert.rejects(
        () => withConn((conn) => query(conn,
          'DELETE FROM equipment_type_external_classification WHERE id = ?', [crosswalk.id])),
        (e) => /cannot be deleted; only draft proposals are deletable/.test(e.message || '')
      );
    });

    it('19. an approved row cannot be casually edited', async () => {
      const { crosswalk, versionId } = await approvedMappedCrosswalk();

      const viaPatch = await call('PATCH', `/api/knowledge-crosswalks/${crosswalk.id}`,
        { userId: ADMIN, body: { mappingOutcome: 'RELATED_TO' } });
      assert.strictEqual(viaPatch.status, 409);
      assert.strictEqual(viaPatch.body.code, 'CROSSWALK_NOT_EDITABLE');

      // And the database refuses the same edit even by direct SQL.
      await assert.rejects(
        () => withConn((conn) => query(conn,
          `UPDATE equipment_type_external_classification SET mapping_outcome = 'RELATED_TO',
             relationship = 'RELATED_TO' WHERE id = ?`, [crosswalk.id])),
        (e) => /immutable except its supersession pointer/.test(e.message || '')
      );
      assert.ok(versionId);
    });

    it('19b. a draft IS editable, but its subject and edition are fixed', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });

      const edited = await call('PATCH', `/api/knowledge-crosswalks/${crosswalk.id}`,
        { userId: ADMIN, body: { mappingOutcome: 'BROADER_THAN', confidenceLevel: 'uncertain' } });
      assert.strictEqual(edited.status, 200);
      assert.strictEqual(edited.body.data.crosswalk.mapping_outcome, 'BROADER_THAN');
      assert.strictEqual(edited.body.data.crosswalk.relationship, 'BROADER_THAN');
      assert.strictEqual(edited.body.data.crosswalk.confidence_level, 'uncertain');

      // An edit that would leave the row incoherent is refused before the DB.
      const incoherent = await call('PATCH', `/api/knowledge-crosswalks/${crosswalk.id}`,
        { userId: ADMIN, body: { mappingOutcome: 'NO_DIRECT_MAPPING' } });
      assert.strictEqual(incoherent.status, 400,
        'switching to NO_DIRECT_MAPPING while a classification is still attached is incoherent');

      // The subject and the investigated edition are not editable at all.
      const subjectAttempt = await call('PATCH', `/api/knowledge-crosswalks/${crosswalk.id}`,
        { userId: ADMIN, body: { equipmentTypeId: await createEquipmentType() } });
      assert.strictEqual(subjectAttempt.status, 400);
      assert.ok(subjectAttempt.body.failures.some((f) => f.rule === 'CROSSWALK_EDIT_EMPTY'),
        'a payload that only changes the subject changes nothing editable');
    });
  });

  // ==========================================================
  // EVIDENCE
  // ==========================================================
  describe('EVIDENCE', () => {
    it('20. relationship evidence attaches', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      const res = await attachEvidence(crosswalk.id, evidenceBody(versionId));
      assert.strictEqual(res.status, 201);
      assert.strictEqual(Number(res.body.data.evidence.crosswalk_id), Number(crosswalk.id));
      assert.strictEqual(res.body.data.evidence.external_classification_id, null,
        'exactly one subject: relationship evidence never also claims a concept');
    });

    it('21. evidence retains its exact source version', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });

      // A DIFFERENT governed edition corroborating the relationship is legitimate
      // (M5R.3D established that deliberately; the ADR requires edition equality
      // only for the crosswalk and the classification it cites).
      const corroborating = await addEdition(await createAuthority(), '2019');
      const res = await attachEvidence(crosswalk.id, evidenceBody(corroborating));
      assert.strictEqual(res.status, 201);
      assert.strictEqual(Number(res.body.data.evidence.knowledge_source_version_id), Number(corroborating));

      const listed = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}/evidence`, { userId: OPERATOR });
      assert.strictEqual(Number(listed.body.data.evidence[0].knowledge_source_version_id), Number(corroborating));
      assert.strictEqual(listed.body.data.evidence[0].version_designation, '2019');
    });

    it('22. two-subject evidence is rejected', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });

      await assert.rejects(
        () => withConn((conn) => query(conn,
          `INSERT INTO equipment_type_external_classification_evidence
             (knowledge_source_version_id, external_classification_id, crosswalk_id)
           VALUES (?, ?, ?)`, [versionId, classificationId, crosswalk.id])),
        (e) => /chk_equipment_type_external_classification_evidence_subject/.test(e.message || '')
      );
      await assert.rejects(
        () => withConn((conn) => query(conn,
          `INSERT INTO equipment_type_external_classification_evidence
             (knowledge_source_version_id) VALUES (?)`, [versionId])),
        (e) => /chk_equipment_type_external_classification_evidence_subject/.test(e.message || '')
      );
    });

    it('23. tenant-scoped evidence is rejected', async () => {
      const { crosswalk } = await approvedMappedCrosswalk();
      const tenantEdition = await addEdition(await createAuthority({ organizationId: ORG }), '1.0');
      const res = await attachEvidence(crosswalk.id, evidenceBody(tenantEdition));
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'CROSSWALK_SOURCE_NOT_GLOBAL');
    });

    it('24. detaching evidence cannot leave an approved crosswalk unsupported', async () => {
      const { crosswalk, versionId } = await approvedMappedCrosswalk();
      const listed = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}/evidence`, { userId: OPERATOR });
      const evidenceId = listed.body.data.evidence[0].id;

      const res = await call('DELETE', `/api/knowledge-crosswalks/${crosswalk.id}/evidence/${evidenceId}`,
        { userId: ADMIN });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'EVIDENCE_APPROVED_IMMUTABLE');

      const after = await EquipmentTypeExternalClassification.countRelationshipEvidence(crosswalk.id);
      assert.strictEqual(after, 1, 'approved truth keeps its evidence');
      assert.ok(versionId);

      // Detachment IS permitted while the proposal is still a working draft.
      const typeId = await createEquipmentType();
      const edition = await addEdition(await createAuthority(), '2016');
      const draft = await proposeNoDirectMapping({ equipmentTypeId: typeId, versionId: edition });
      const attached = await attachEvidence(draft.id, evidenceBody(edition));
      const detached = await call('DELETE',
        `/api/knowledge-crosswalks/${draft.id}/evidence/${attached.body.data.evidence.id}`, { userId: ADMIN });
      assert.strictEqual(detached.status, 200);
      assert.strictEqual(detached.body.data.detached, true);
    });

    it('25. concept evidence stays distinct from relationship evidence', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });

      await withConn((conn) => query(conn,
        `INSERT INTO equipment_type_external_classification_evidence
           (knowledge_source_version_id, external_classification_id, crosswalk_id, derivation_notes)
         VALUES (?, ?, NULL, 'the concept exists')`, [versionId, classificationId]));
      const relationship = await attachEvidence(crosswalk.id, evidenceBody(versionId, {
        derivationNotes: 'the relationship is defensible'
      }));

      const asRelationship = await ExternalClassificationCrosswalkEvidence.listEvidenceForCrosswalk(crosswalk.id);
      assert.strictEqual(asRelationship.length, 1,
        'the crosswalk evidence query does not see the concept evidence');
      assert.strictEqual(Number(asRelationship[0].id), Number(relationship.body.data.evidence.id));

      const conceptRows = await withConn((conn) => query(conn,
        `SELECT id FROM equipment_type_external_classification_evidence WHERE external_classification_id = ?`,
        [classificationId]));
      assert.strictEqual(conceptRows.length, 1);
      assert.notStrictEqual(Number(conceptRows[0].id), Number(relationship.body.data.evidence.id));
    });

    it('25b. evidence is validated for provenance and locators', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });

      const noSource = await attachEvidence(crosswalk.id, { sectionOrClause: 'SYNTH-1.1' });
      assert.strictEqual(noSource.status, 400);
      assert.ok(noSource.body.failures.some((f) => f.rule === 'EVIDENCE_SOURCE_VERSION_REQUIRED'));

      const noLocator = await attachEvidence(crosswalk.id, { knowledgeSourceVersionId: versionId });
      assert.strictEqual(noLocator.status, 400);
      assert.ok(noLocator.body.failures.some((f) => f.rule === 'EVIDENCE_ATTRIBUTION_INCOMPLETE'));

      const badRole = await attachEvidence(crosswalk.id, evidenceBody(versionId, { supportingRole: 'secondary' }));
      assert.strictEqual(badRole.status, 400);
      assert.ok(badRole.body.failures.some((f) => f.rule === 'EVIDENCE_ROLE_INVALID'));
    });
  });

  // ==========================================================
  // SUPERSESSION
  // ==========================================================
  describe('SUPERSESSION', () => {
    it('26. an approved successor for the same equipment type supersedes', async () => {
      const { crosswalk, typeId } = await approvedMappedCrosswalk();
      const edition2024 = await addEdition(await createAuthority(), '2024');
      const successor = await proposeMapped({
        equipmentTypeId: typeId, versionId: edition2024,
        classificationId: await addClassification(edition2024)
      });
      await attachEvidence(successor.id, evidenceBody(edition2024));
      await submit(successor.id);
      await approve(successor.id);

      const res = await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: successor.id } });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(Number(res.body.data.crosswalk.superseded_by_crosswalk_id), Number(successor.id));
      assert.strictEqual(res.body.data.crosswalk.review_state, 'approved',
        'superseding does not change the governance status of the retired row');
    });

    it('27. an unapproved successor cannot supersede approved truth', async () => {
      const { crosswalk, typeId } = await approvedMappedCrosswalk();
      const edition2024 = await addEdition(await createAuthority(), '2024');
      const draftSuccessor = await proposeMapped({
        equipmentTypeId: typeId, versionId: edition2024,
        classificationId: await addClassification(edition2024)
      });

      const res = await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: draftSuccessor.id } });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'SUPERSEDE_SUCCESSOR_NOT_APPROVED');

      const after = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}`, { userId: OPERATOR });
      assert.strictEqual(after.body.data.crosswalk.superseded_by_crosswalk_id, null,
        'the predecessor is still the current truth');
    });

    it('28. a successor for a different equipment type fails', async () => {
      const { crosswalk } = await approvedMappedCrosswalk();
      const otherTypeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const foreign = await proposeMapped({
        equipmentTypeId: otherTypeId, versionId, classificationId
      });
      await attachEvidence(foreign.id, evidenceBody(versionId));
      await submit(foreign.id);
      await approve(foreign.id);

      const res = await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: foreign.id } });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'SUPERSEDE_SUBJECT_MISMATCH');
    });

    it('29. predecessor evidence stays attached to the predecessor', async () => {
      const { crosswalk, typeId, versionId } = await approvedMappedCrosswalk();
      const before = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}/evidence`, { userId: OPERATOR });
      assert.strictEqual(before.body.data.evidence.length, 1);

      const edition2024 = await addEdition(await createAuthority(), '2024');
      const successor = await proposeMapped({
        equipmentTypeId: typeId, versionId: edition2024,
        classificationId: await addClassification(edition2024)
      });
      await attachEvidence(successor.id, evidenceBody(edition2024));
      await submit(successor.id);
      await approve(successor.id);
      await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: successor.id } });

      const after = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}/evidence`, { userId: OPERATOR });
      assert.strictEqual(after.body.data.evidence.length, 1,
        'the historic support stays with the row it supported');
      assert.strictEqual(Number(after.body.data.evidence[0].knowledge_source_version_id), Number(versionId));
    });

    it('30. a successor must establish its own evidence', async () => {
      const { crosswalk, typeId } = await approvedMappedCrosswalk();
      const edition2024 = await addEdition(await createAuthority(), '2024');
      const successor = await proposeMapped({
        equipmentTypeId: typeId, versionId: edition2024,
        classificationId: await addClassification(edition2024)
      });

      // Nothing is inherited: the successor has no evidence of its own.
      assert.strictEqual(
        await EquipmentTypeExternalClassification.countRelationshipEvidence(successor.id), 0);
      await submit(successor.id);
      const refused = await approve(successor.id);
      assert.strictEqual(refused.status, 409);
      assert.strictEqual(refused.body.code, 'CROSSWALK_RELATIONSHIP_EVIDENCE_REQUIRED');

      // Only after establishing its own evidence may it be approved and linked.
      await attachEvidence(successor.id, evidenceBody(edition2024));
      const approved = await approve(successor.id);
      assert.strictEqual(approved.status, 200);
      const linked = await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: successor.id } });
      assert.strictEqual(linked.status, 200);
    });

    it('31. self-supersession and cycles remain refused', async () => {
      const { crosswalk, typeId } = await approvedMappedCrosswalk();
      const self = await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: crosswalk.id } });
      assert.strictEqual(self.status, 409);
      assert.strictEqual(self.body.code, 'SUPERSEDE_SELF');

      const edition2024 = await addEdition(await createAuthority(), '2024');
      const second = await proposeMapped({
        equipmentTypeId: typeId, versionId: edition2024,
        classificationId: await addClassification(edition2024)
      });
      await attachEvidence(second.id, evidenceBody(edition2024));
      await submit(second.id);
      await approve(second.id);
      await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: second.id } });

      // The successor cannot point back at its own predecessor.
      const cycle = await call('POST', `/api/knowledge-crosswalks/${second.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: crosswalk.id } });
      assert.ok(cycle.status === 409 || cycle.status === 400, `unexpected: ${JSON.stringify(cycle.body)}`);
    });

    it('31b. superseding a non-approved row is refused', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const draft = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      const res = await call('POST', `/api/knowledge-crosswalks/${draft.id}/supersede`,
        { userId: SUPERVISOR, body: { successorCrosswalkId: draft.id + 1 } });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.code, 'SUPERSEDE_PREDECESSOR_NOT_APPROVED');
    });
  });

  // ==========================================================
  // AUTHORIZATION
  // ==========================================================
  describe('AUTHORIZATION', () => {
    it('32. KNOWLEDGE.VIEW can read on any role', async () => {
      const { crosswalk } = await approvedMappedCrosswalk();
      for (const userId of [ADMIN, SUPERVISOR, OPERATOR]) {
        const res = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}`, { userId });
        assert.strictEqual(res.status, 200, `role ${userId} should read`);
      }
      const anonymous = await call('GET', `/api/knowledge-crosswalks/${crosswalk.id}`);
      assert.strictEqual(anonymous.status, 401);
    });

    it('33. an unauthorized caller cannot mutate knowledge', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();

      const anonymous = await call('POST', '/api/knowledge-crosswalks',
        { body: { equipmentTypeId: typeId, knowledgeSourceVersionId: versionId, classificationId, mappingOutcome: 'RELATED_TO' } });
      assert.strictEqual(anonymous.status, 401);

      // TASKS.UPDATE is admin-only, matching M3 provenance authoring.
      const operatorPropose = await call('POST', '/api/knowledge-crosswalks',
        {
          userId: OPERATOR,
          body: { equipmentTypeId: typeId, knowledgeSourceVersionId: versionId, externalClassificationId: classificationId, mappingOutcome: 'RELATED_TO' }
        });
      assert.strictEqual(operatorPropose.status, 403);

      const supervisorPropose = await call('POST', '/api/knowledge-crosswalks',
        {
          userId: SUPERVISOR,
          body: { equipmentTypeId: typeId, knowledgeSourceVersionId: versionId, externalClassificationId: classificationId, mappingOutcome: 'RELATED_TO' }
        });
      assert.strictEqual(supervisorPropose.status, 403);

      const operatorAttach = await attachEvidence(1, evidenceBody(versionId), OPERATOR);
      assert.strictEqual(operatorAttach.status, 403);
    });

    it('34. review operations require KNOWLEDGE.REVIEW', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });

      const operatorSubmit = await submit(crosswalk.id, OPERATOR);
      assert.strictEqual(operatorSubmit.status, 403, 'an operator may not submit knowledge for review');

      const supervisorSubmit = await submit(crosswalk.id, SUPERVISOR);
      assert.strictEqual(supervisorSubmit.status, 200, 'KNOWLEDGE.REVIEW is granted to supervisor');

      const operatorReject = await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/reject`, { userId: OPERATOR });
      assert.strictEqual(operatorReject.status, 403);
    });

    it('35. approval requires KNOWLEDGE.APPROVE', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      await attachEvidence(crosswalk.id, evidenceBody(versionId));
      await submit(crosswalk.id);

      const operatorApprove = await approve(crosswalk.id, OPERATOR);
      assert.strictEqual(operatorApprove.status, 403, 'an operator may not approve governed knowledge');

      const supervisorApprove = await approve(crosswalk.id, SUPERVISOR);
      assert.strictEqual(supervisorApprove.status, 200, 'KNOWLEDGE.APPROVE is granted to supervisor');
      assert.strictEqual(Number(supervisorApprove.body.data.crosswalk.approved_by_user_id), SUPERVISOR,
        'the approver is the authenticated principal, never a body value');
    });

    it('35b. the approver cannot be supplied in the request body', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      await attachEvidence(crosswalk.id, evidenceBody(versionId));
      await submit(crosswalk.id);

      const res = await call('POST', `/api/knowledge-crosswalks/${crosswalk.id}/approve`,
        { userId: SUPERVISOR, body: { approvedByUserId: ADMIN, reviewState: 'approved', approver: ADMIN } });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(Number(res.body.data.crosswalk.approved_by_user_id), SUPERVISOR,
        'a payload cannot nominate a different approver');
    });

    it('36. an AI-assisted proposal cannot self-approve or bypass human attribution', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const proposed = await call('POST', '/api/knowledge-crosswalks', {
        userId: ADMIN,
        body: {
          equipmentTypeId: typeId, knowledgeSourceVersionId: versionId,
          externalClassificationId: classificationId, mappingOutcome: 'DIRECT_EQUIVALENT',
          aiAssisted: true, aiAssistanceDetail: { source: 'synthetic-suggestion', note: 'drafting aid' }
        }
      });
      assert.strictEqual(proposed.status, 201);
      const crosswalk = proposed.body.data.crosswalk;
      assert.strictEqual(crosswalk.ai_assisted, true);
      assert.strictEqual(crosswalk.review_state, 'draft', 'AI assistance never approves');
      assert.strictEqual(crosswalk.approved_by_user_id, null);
      assert.strictEqual(crosswalk.approved_at, null);

      // Structured against an AI-flag-only proposal: a flag without detail is not
      // an accountable attribution.
      const flagOnly = await call('POST', '/api/knowledge-crosswalks', {
        userId: ADMIN,
        body: {
          equipmentTypeId: typeId, knowledgeSourceVersionId: versionId, mappingOutcome: 'NO_DIRECT_MAPPING',
          aiAssisted: true
        }
      });
      assert.strictEqual(flagOnly.status, 400);
      assert.ok(flagOnly.body.failures.some((f) => f.rule === 'CROSSWALK_AI_DETAIL_REQUIRED'));

      // Approval still requires a human principal holding KNOWLEDGE.APPROVE.
      await attachEvidence(crosswalk.id, evidenceBody(versionId));
      await submit(crosswalk.id);
      const aiCannotApprove = await approve(crosswalk.id, OPERATOR);
      assert.strictEqual(aiCannotApprove.status, 403);
      const human = await approve(crosswalk.id, SUPERVISOR);
      assert.strictEqual(human.status, 200);
      assert.strictEqual(Number(human.body.data.crosswalk.approved_by_user_id), SUPERVISOR);
    });
  });

  // ==========================================================
  // CONCURRENCY — approval versus evidence detachment
  // ==========================================================
  describe('CONCURRENCY', () => {
    it('36b. concurrent approval and detachment can never yield unsupported approved truth', async () => {
      // Repeated because the two orderings are decided by the row lock, and both
      // outcomes are correct — what must never happen is an approved crosswalk
      // left with zero relationship evidence.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const typeId = await createEquipmentType();
        const { versionId } = await globalEditionWithClassification();
        const crosswalk = await proposeNoDirectMapping({ equipmentTypeId: typeId, versionId });
        const attached = await attachEvidence(crosswalk.id, evidenceBody(versionId));
        const evidenceId = attached.body.data.evidence.id;
        await submit(crosswalk.id);

        const [approveRes, detachRes] = await Promise.all([
          approve(crosswalk.id, SUPERVISOR),
          call('DELETE', `/api/knowledge-crosswalks/${crosswalk.id}/evidence/${evidenceId}`, { userId: ADMIN })
        ]);

        const final = await withConn((conn) => query(conn,
          `SELECT review_state FROM equipment_type_external_classification WHERE id = ?`, [crosswalk.id]));
        const evidenceCount = await EquipmentTypeExternalClassification.countRelationshipEvidence(crosswalk.id);

        if (final[0].review_state === 'approved') {
          assert.strictEqual(evidenceCount, 1,
            `attempt ${attempt}: approved truth must retain its evidence `
              + `(approve=${approveRes.status}, detach=${detachRes.status})`);
        } else {
          assert.ok([200, 409].includes(detachRes.status), `unexpected detach status ${detachRes.status}`);
        }
        assert.notStrictEqual(approveRes.status, 500, `attempt ${attempt}: approval must not error`);
      }
    });
  });

  // ==========================================================
  // REGRESSION / BOUNDARY
  // ==========================================================
  describe('REGRESSION', () => {
    it('37. the accepted migration chain 001-018 is intact, with 019 appended by M5R.4B', async () => {
      const dir = path.join(__dirname, '..', 'database', 'postgresql');
      const files = fs.readdirSync(dir).filter((n) => /^\d{3}_.*\.sql$/.test(n)).sort();

      // The eighteen migrations this layer was accepted against are still in
      // place, in order, under their original names — nothing renamed, removed
      // or renumbered. This is the enduring half of the original assertion.
      assert.deepStrictEqual(files.slice(0, 18), [
        '001_core.sql',
        '002_equipment_taxonomy.sql',
        '003_templates_maintenance.sql',
        '004_work_management.sql',
        '005_commercial_security.sql',
        '006_customization_files.sql',
        '007_indexes.sql',
        '008_views.sql',
        '009_knowledge_versioning.sql',
        '010_knowledge_versioning_indexes.sql',
        '011_knowledge_provenance.sql',
        '012_task_template_safety_control_versioning.sql',
        '013_knowledge_governance_admission.sql',
        '014_knowledge_pack_membership.sql',
        '015_knowledge_pack_publication_governance.sql',
        '016_external_classification_foundation.sql',
        '017_equipment_type_external_classification_crosswalk.sql',
        '018_external_classification_crosswalk_evidence.sql'
      ].sort(), 'the accepted chain 001-018 must be unmodified');

      // ATM-001 M5R.4B later appended the governed taxonomy identity-lifecycle
      // mechanism as 019. M5R.3E itself still added no migration, which is what
      // the original assertion was protecting.
      assert.strictEqual(files.length, 19, '019 is the only migration after the accepted chain');
      assert.strictEqual(files[18], '019_taxonomy_identity_lifecycle.sql');
    });

    it('38. M5R.3E introduced no schema of its own; 019 belongs to ATM-001 M5R.4B', async () => {
      const dir = path.join(__dirname, '..', 'database', 'postgresql');
      const migrations = fs.readdirSync(dir).filter((n) => /^\d{3}_.*\.sql$/.test(n)).sort();
      assert.ok(migrations.includes('019_taxonomy_identity_lifecycle.sql'));

      // The relations THIS layer uses are the accepted ones, unchanged.
      const rows = await withConn((conn) => query(conn, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('equipment_type_external_classification',
                             'equipment_type_external_classification_evidence')
        ORDER BY table_name`));
      assert.strictEqual(rows.length, 2);

      // M5R.3E added no schema of its own: migration 019 is the identity-lifecycle
      // mechanism and it must not touch the crosswalk structures at all.
      const m019 = fs.readFileSync(
        path.join(dir, '019_taxonomy_identity_lifecycle.sql'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
      assert.doesNotMatch(m019, /equipment_type_external_classification/,
        'migration 019 is a separate mechanism and must not alter the crosswalk');
    });

    it('39. the canonical equipment taxonomy is unchanged', async () => {
      const scoped = () => withConn((conn) => query(conn, `
        SELECT
          (SELECT COUNT(*)::int FROM equipment_categories WHERE category_code LIKE ?) AS categories,
          (SELECT COUNT(*)::int FROM equipment_classes c
             JOIN equipment_categories cat ON cat.id = c.category_id
             WHERE cat.category_code LIKE ?) AS classes,
          (SELECT COUNT(*)::int FROM equipment_types t
             JOIN equipment_classes c ON c.id = t.class_id
             JOIN equipment_categories cat ON cat.id = c.category_id
             WHERE cat.category_code LIKE ?) AS types`,
      [`${CATEGORY_PREFIX}%`, `${CATEGORY_PREFIX}%`, `${CATEGORY_PREFIX}%`]));

      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const before = await scoped();

      const crosswalk = await proposeMapped({ equipmentTypeId: typeId, versionId, classificationId });
      await attachEvidence(crosswalk.id, evidenceBody(versionId));
      await submit(crosswalk.id);
      await approve(crosswalk.id);

      const after = await scoped();
      assert.deepStrictEqual(after[0], before[0],
        'governing a crosswalk references canonical identity and never changes it');
    });

    it('39b. no standards content is populated by this layer', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM equipment_type_external_classification ec
        JOIN external_classification x ON x.id = ec.external_classification_id
        WHERE x.classification_code LIKE 'ISO-%' OR x.classification_code LIKE 'ISO14224-%'`));
      assert.strictEqual(rows[0].n, 0);
    });

    it('40. the application layer exposes no generic mutation surface', async () => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'routes', 'knowledge-crosswalk.routes.js'), 'utf8');
      // Assert against CODE, not prose: the routes file's own doc comment
      // explains that no route sets review_state directly, so scanning raw text
      // would flag the file for describing the property it has.
      const routes = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');

      // Governance status, supersession and human attribution are never taken
      // from a request. No route mentions them at all.
      assert.ok(!/review_state/.test(routes), 'no route sets review_state directly');
      assert.ok(!/superseded_by/.test(routes), 'no route sets the supersession pointer directly');
      assert.ok(!/approved_by_user_id|reviewed_by_user_id/.test(routes),
        'no route accepts attribution from a caller');

      // The only PATCH is the guarded draft edit; there is no generic PUT.
      const patchRoutes = routes.match(/router\.patch\(/g) || [];
      assert.strictEqual(patchRoutes.length, 1, 'exactly one PATCH route');
      assert.ok(/router\.patch\('\/:id',\s*requirePermission\('TASKS', 'UPDATE'\),\s*crosswalkController\.updateDraftCrosswalk\)/.test(routes),
        'and it is the draft edit');
      assert.ok(!/router\.put\(/.test(routes), 'no PUT route exists');

      // Every write is a named governed operation.
      for (const op of ['submit', 'approve', 'reject', 'supersede']) {
        assert.ok(new RegExp(`/:id/${op}`).test(routes), `${op} is an explicit governed operation`);
      }
      assert.ok(/:id\/evidence/.test(routes), 'evidence attach/detach is crosswalk-scoped');
    });
  });
});
