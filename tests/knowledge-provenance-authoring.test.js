/**
 * Knowledge Provenance Authoring Integration Tests
 *
 * ATM-001 M3 — proves the minimum governed provenance authoring path:
 * create a source, create an immutable source version, attach it as WORKING
 * evidence on working knowledge, list it, detach it while working, and never
 * reach frozen published evidence.
 *
 * Two layers are exercised:
 *   - HTTP: the real Express app with real JWTs, proving authorization.
 *   - Direct model/SQL: proving immutability and the frozen boundary, which the
 *     API deliberately cannot express.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { TaskTemplate } = require('../src/models');
const {
  KnowledgeSource,
  KnowledgeSourceVersion,
  KnowledgeTemplateEvidence
} = require('../src/models/knowledge-provenance.model');
const { ProvenanceValidationError } = require('../src/services/knowledge-provenance.service');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating knowledge-provenance suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// Disposable fixtures, disjoint from every other suite's namespace.
const ORG = 996001;
const ORG_B = 996002;
const ADMIN = 996101;        // can author (TASKS.CREATE / TASKS.UPDATE are admin-only)
const SUPERVISOR = 996102;   // may review knowledge, but cannot author provenance
const OPERATOR = 996103;     // read-only
const FOREIGN_ADMIN = 996104; // admin of ORG_B
const CATEGORY = 996201;
const CLASS = 996202;
const EQUIPMENT_TYPE = 996203;

const JWT_SECRET = 'test-only-jwt-secret-not-for-production-000000';

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

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG, 'M3 Provenance Org'], [ORG_B, 'M3 Foreign Org']]) {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`, [id, name]);
    }
    for (const [id, username, role, orgId] of [
      [ADMIN, 'm3-admin', 'admin', ORG],
      [SUPERVISOR, 'm3-supervisor', 'supervisor', ORG],
      [OPERATOR, 'm3-operator', 'operator', ORG],
      [FOREIGN_ADMIN, 'm3-foreign-admin', 'admin', ORG_B]
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'M3 Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, orgId]);
    }
    await query(conn, `INSERT INTO equipment_categories (id, category_code, category_name)
      VALUES (?, 'M3CAT', 'M3 Category') ON CONFLICT (id) DO NOTHING`, [CATEGORY]);
    await query(conn, `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
      VALUES (?, ?, 'M3CLS', 'M3 Class') ON CONFLICT (id) DO NOTHING`, [CLASS, CATEGORY]);
    await query(conn, `INSERT INTO equipment_types (id, class_id, type_code, type_name)
      VALUES (?, ?, 'M3TYPE', 'M3 Equipment Type') ON CONFLICT (id) DO NOTHING`, [EQUIPMENT_TYPE, CLASS]);
  });
}

let seq = 0;
const uniq = () => `${Date.now()}-${++seq}`;

/** A working task template in the given organization, with one step. */
async function createWorkingTemplate(orgId = ORG) {
  return withConn(async (conn) => {
    const [template] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name,
         maintenance_type, task_kind, frequency_value, frequency_unit, estimated_duration_minutes, priority)
       VALUES (?, ?, ?, 'M3 Working Template', 'preventive', 'inspection', 1, 'month', 30, 'medium')
       RETURNING id`,
      [EQUIPMENT_TYPE, orgId, `M3-${uniq()}`]);
    await query(conn,
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, 1, 'instruction', 'Working step', true)`, [template.id]);
    return template.id;
  });
}

// ---------------------------------------------------------------- HTTP helpers

let server;
let port;

function call(method, path, { userId, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path,
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
  sourceCode: `M3-SRC-${uniq()}`,
  sourceCategory: 'manufacturer_manual',
  defaultTitle: 'M3 Authored Source',
  issuingOrganization: 'Example Manufacturer',
  ...overrides
});

const versionPayload = (overrides = {}) => ({
  versionDesignation: '1.0',
  title: 'M3 Authored Source Version',
  referenceNumber: 'REF-001',
  publicationDate: '2026-01-15',
  ...overrides
});

/** Create a source + version through the real API and return both ids. */
async function authorSourceAndVersion(userId = ADMIN) {
  const source = await call('POST', '/api/knowledge-provenance/sources', { userId, body: sourcePayload() });
  assert.strictEqual(source.status, 201, `source creation failed: ${JSON.stringify(source.body)}`);
  const sourceId = source.body.data.source.id;

  const version = await call('POST', `/api/knowledge-provenance/sources/${sourceId}/versions`, {
    userId, body: versionPayload()
  });
  assert.strictEqual(version.status, 201, `version creation failed: ${JSON.stringify(version.body)}`);
  return { sourceId, versionId: version.body.data.version.id };
}

describe('Knowledge Provenance Authoring (ATM-001 M3)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = JWT_SECRET;
    const app = require('../src/app');
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
  });

  // ------------------------------------------------------------- authorization
  describe('Authorization', () => {
    it('allows an authorized principal to create a source', async () => {
      const res = await call('POST', '/api/knowledge-provenance/sources', { userId: ADMIN, body: sourcePayload() });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.source.source_code.startsWith('M3-SRC-'), true);
      assert.strictEqual(Number(res.body.data.source.organization_id), ORG);
      assert.strictEqual(Number(res.body.data.source.created_by_user_id), ADMIN);
    });

    it('rejects unauthenticated source creation', async () => {
      const res = await call('POST', '/api/knowledge-provenance/sources', { body: sourcePayload() });
      assert.strictEqual(res.status, 401);
    });

    it('rejects source creation by a supervisor (no TASKS.CREATE capability)', async () => {
      const res = await call('POST', '/api/knowledge-provenance/sources', {
        userId: SUPERVISOR, body: sourcePayload()
      });
      assert.strictEqual(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
    });

    it('rejects source creation by an operator', async () => {
      const res = await call('POST', '/api/knowledge-provenance/sources', {
        userId: OPERATOR, body: sourcePayload()
      });
      assert.strictEqual(res.status, 403);
    });

    it('rejects evidence attachment by a supervisor (no TASKS.UPDATE capability)', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: SUPERVISOR,
        body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'S1' }
      });
      assert.strictEqual(res.status, 403);
    });

    it('allows knowledge reading by a supervisor (KNOWLEDGE.VIEW)', async () => {
      const res = await call('GET', '/api/knowledge-provenance/sources', { userId: SUPERVISOR });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.data.sources));
    });
  });

  // ---------------------------------------------------------- source authoring
  describe('Source authoring', () => {
    it('validates required schema fields', async () => {
      const res = await call('POST', '/api/knowledge-provenance/sources', {
        userId: ADMIN, body: { sourceCategory: 'manufacturer_manual' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, 'PROVENANCE_VALIDATION_FAILED');
      const rules = res.body.failures.map((f) => f.rule);
      assert.ok(rules.includes('SOURCE_CODE_REQUIRED'));
      assert.ok(rules.includes('SOURCE_TITLE_REQUIRED'));
    });

    it('rejects an unknown source_category', async () => {
      const res = await call('POST', '/api/knowledge-provenance/sources', {
        userId: ADMIN, body: sourcePayload({ sourceCategory: 'wikipedia' })
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.failures.some((f) => f.rule === 'SOURCE_CATEGORY_INVALID'));
    });

    it('rejects a duplicate source_code within the same organization', async () => {
      const code = `M3-DUP-${uniq()}`;
      const first = await call('POST', '/api/knowledge-provenance/sources', { userId: ADMIN, body: sourcePayload({ sourceCode: code }) });
      assert.strictEqual(first.status, 201);
      const second = await call('POST', '/api/knowledge-provenance/sources', { userId: ADMIN, body: sourcePayload({ sourceCode: code }) });
      assert.strictEqual(second.status, 409);
      assert.strictEqual(second.body.code, 'PROVENANCE_DUPLICATE');
    });

    it('does not accept a caller-supplied organization_id (no global source creation)', async () => {
      const res = await call('POST', '/api/knowledge-provenance/sources', {
        userId: ADMIN, body: sourcePayload({ organizationId: null })
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(Number(res.body.data.source.organization_id), ORG,
        'organization_id must be derived from the principal, never from the payload');
    });
  });

  // -------------------------------------------------- source version authoring
  describe('Source version authoring', () => {
    it('creates an immutable source version', async () => {
      const { sourceId, versionId } = await authorSourceAndVersion();
      const rows = await withConn((conn) => query(conn,
        `SELECT * FROM knowledge_source_versions WHERE id = ?`, [versionId]));
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(Number(rows[0].knowledge_source_id), sourceId);
      assert.strictEqual(rows[0].version_designation, '1.0');
    });

    it('requires a valid source', async () => {
      const res = await call('POST', '/api/knowledge-provenance/sources/999999999/versions', {
        userId: ADMIN, body: versionPayload()
      });
      assert.strictEqual(res.status, 404);
    });

    it('validates required version fields', async () => {
      const source = await call('POST', '/api/knowledge-provenance/sources', { userId: ADMIN, body: sourcePayload() });
      const res = await call('POST', `/api/knowledge-provenance/sources/${source.body.data.source.id}/versions`, {
        userId: ADMIN, body: { referenceNumber: 'R' }
      });
      assert.strictEqual(res.status, 400);
      const rules = res.body.failures.map((f) => f.rule);
      assert.ok(rules.includes('SOURCE_VERSION_DESIGNATION_REQUIRED'));
      assert.ok(rules.includes('SOURCE_VERSION_TITLE_REQUIRED'));
    });

    it('rejects file upload through this capability (no document storage in M3)', async () => {
      const source = await call('POST', '/api/knowledge-provenance/sources', { userId: ADMIN, body: sourcePayload() });
      const res = await call('POST', `/api/knowledge-provenance/sources/${source.body.data.source.id}/versions`, {
        userId: ADMIN, body: versionPayload({ uploadedFileId: 1 })
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.failures.some((f) => f.rule === 'SOURCE_VERSION_FILE_UPLOAD_NOT_SUPPORTED'));
    });

    it('duplicate version_designation within a source is rejected', async () => {
      const source = await call('POST', '/api/knowledge-provenance/sources', { userId: ADMIN, body: sourcePayload() });
      const sourceId = source.body.data.source.id;
      const first = await call('POST', `/api/knowledge-provenance/sources/${sourceId}/versions`, { userId: ADMIN, body: versionPayload({ versionDesignation: '2.0' }) });
      assert.strictEqual(first.status, 201);
      const second = await call('POST', `/api/knowledge-provenance/sources/${sourceId}/versions`, { userId: ADMIN, body: versionPayload({ versionDesignation: '2.0' }) });
      assert.strictEqual(second.status, 409);
    });

    it('is immutable: UPDATE is refused by the database', async () => {
      const { versionId } = await authorSourceAndVersion();
      await assert.rejects(
        () => withConn((conn) => query(conn,
          `UPDATE knowledge_source_versions SET title = 'tampered' WHERE id = ?`, [versionId])),
        /immutable and cannot be updated/
      );
      const rows = await withConn((conn) => query(conn,
        `SELECT title FROM knowledge_source_versions WHERE id = ?`, [versionId]));
      assert.notStrictEqual(rows[0].title, 'tampered');
    });

    it('is immutable: DELETE is refused once evidence references it', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'S1' }
      });
      assert.strictEqual(attached.status, 201);

      await assert.rejects(
        () => withConn((conn) => query(conn,
          `DELETE FROM knowledge_source_versions WHERE id = ?`, [versionId])),
        /referenced by evidence and cannot be deleted/
      );
    });

    it('refuses source-version update and delete through the model', async () => {
      // BaseModel supplies generic update()/delete(); the provenance models
      // override them to refuse, so the model cannot advertise a mutation
      // surface the database forbids.
      assert.throws(() => KnowledgeSourceVersion.update(1, { title: 'x' }), /immutable/i);
      assert.throws(() => KnowledgeSourceVersion.delete(1), /immutable/i);
    });
  });

  // --------------------------------------------------------- evidence attachment
  describe('Working evidence attachment', () => {
    it('attaches an immutable source version as working evidence', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN,
        body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'Section 4.2', confidenceLevel: 'established', supportingRole: 'primary' }
      });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(Number(res.body.data.evidence.task_template_id), templateId);
      assert.strictEqual(Number(res.body.data.evidence.knowledge_source_version_id), versionId);
      assert.strictEqual(Number(res.body.data.evidence.added_by_user_id), ADMIN);
      assert.strictEqual(res.body.data.evidence.confidence_level, 'established');
    });

    it('rejects evidence referencing a non-existent source version', async () => {
      const templateId = await createWorkingTemplate();
      const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: 999999999, sectionOrClause: 'S1' }
      });
      assert.strictEqual(res.status, 404);
    });

    it('rejects evidence referencing a non-existent working template', async () => {
      const { versionId } = await authorSourceAndVersion();
      const res = await call('POST', '/api/knowledge-provenance/templates/999999999/evidence', {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'S1' }
      });
      assert.strictEqual(res.status, 404);
    });

    it('rejects evidence that states no source location', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId }
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.failures.some((f) => f.rule === 'EVIDENCE_ATTRIBUTION_INCOMPLETE'));
    });

    it('lists working evidence for a working template', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'Clause 7' }
      });

      const res = await call('GET', `/api/knowledge-provenance/templates/${templateId}/evidence`, { userId: OPERATOR });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.evidence.length, 1);
      assert.strictEqual(res.body.data.evidence[0].section_or_clause, 'Clause 7');
      assert.ok(res.body.data.evidence[0].source_code, 'listing should resolve source context');
    });

    it('lists source versions of a source', async () => {
      const { sourceId } = await authorSourceAndVersion();
      const res = await call('GET', `/api/knowledge-provenance/sources/${sourceId}/versions`, { userId: ADMIN });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.versions.length >= 1);
    });
  });

  // ----------------------------------------------------------- detach boundary
  describe('Working vs frozen evidence boundary', () => {
    it('allows detaching WORKING evidence before publication', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'S1' }
      });
      const evidenceId = attached.body.data.evidence.id;

      const res = await call('DELETE', `/api/knowledge-provenance/templates/${templateId}/evidence/${evidenceId}`, { userId: ADMIN });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.detached, true);

      const listed = await call('GET', `/api/knowledge-provenance/templates/${templateId}/evidence`, { userId: ADMIN });
      assert.strictEqual(listed.body.data.evidence.length, 0);
    });

    /**
     * Discovered during implementation and asserted here deliberately:
     * migration 011 pins WORKING evidence once it has been copied into a
     * published version, because knowledge_template_version_evidence.
     * copied_from_template_evidence_id is ON DELETE RESTRICT. The database is
     * therefore stricter than "frozen rows are immutable" — it is impossible for
     * a published package to lose the working row its frozen provenance came
     * from. M3 surfaces that as a clean 409 rather than a raw database error.
     */
    it('refuses to detach working evidence once it has been frozen into a published version', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'Frozen Clause' }
      });
      const evidenceId = attached.body.data.evidence.id;

      await TaskTemplate.recordSafetyReview(templateId, SUPERVISOR, ORG, 'reviewed_no_control_required');
      await TaskTemplate.submitForReview(templateId, SUPERVISOR, ORG);
      await TaskTemplate.approveTemplate(templateId, SUPERVISOR, ORG);
      await TaskTemplate.publishVersion(templateId, ADMIN, { publishedByOrganizationId: ORG });

      const detached = await call('DELETE', `/api/knowledge-provenance/templates/${templateId}/evidence/${evidenceId}`, { userId: ADMIN });
      assert.strictEqual(detached.status, 409, `expected 409, got ${detached.status}: ${JSON.stringify(detached.body)}`);
      assert.strictEqual(detached.body.code, 'EVIDENCE_FROZEN');

      // Both the working row and its frozen counterpart survive.
      const workingStillThere = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM knowledge_template_evidence WHERE id = ?`, [evidenceId]));
      assert.strictEqual(workingStillThere[0].n, 1);
    });

    it('detaching unattached working evidence does not alter frozen published evidence', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'Frozen Clause' }
      });
      assert.strictEqual(attached.status, 201);
      const frozenEvidenceId = attached.body.data.evidence.id;

      // Publish through the real M1 path, which freezes evidence.
      await TaskTemplate.recordSafetyReview(templateId, SUPERVISOR, ORG, 'reviewed_no_control_required');
      await TaskTemplate.submitForReview(templateId, SUPERVISOR, ORG);
      await TaskTemplate.approveTemplate(templateId, SUPERVISOR, ORG);
      const published = await TaskTemplate.publishVersion(templateId, ADMIN, { publishedByOrganizationId: ORG });

      const frozenBefore = await withConn((conn) => query(conn,
        `SELECT * FROM knowledge_template_version_evidence WHERE task_template_version_id = ?`, [published.versionId]));
      assert.strictEqual(frozenBefore.length, 1, 'M1 should have frozen one template-level evidence row');

      // A DIFFERENT, unrelated working evidence row (attached after publication,
      // so it has no frozen counterpart) can still be detached normally.
      const laterEvidence = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'Added After Publication' }
      });
      assert.strictEqual(laterEvidence.status, 201);
      const detached = await call('DELETE',
        `/api/knowledge-provenance/templates/${templateId}/evidence/${laterEvidence.body.data.evidence.id}`,
        { userId: ADMIN });
      assert.strictEqual(detached.status, 200, JSON.stringify(detached.body));

      // The frozen rows and the pinned working row are untouched.
      const frozenAfter = await withConn((conn) => query(conn,
        `SELECT * FROM knowledge_template_version_evidence WHERE task_template_version_id = ?`, [published.versionId]));
      assert.strictEqual(frozenAfter.length, 1, 'frozen evidence must survive an unrelated working detach');
      assert.strictEqual(frozenAfter[0].section_or_clause, frozenBefore[0].section_or_clause);
      assert.strictEqual(Number(frozenAfter[0].knowledge_source_version_id), Number(frozenBefore[0].knowledge_source_version_id));

      const pinned = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM knowledge_template_evidence WHERE id = ?`, [frozenEvidenceId]));
      assert.strictEqual(pinned[0].n, 1, 'the pinned working row must still exist');
    });

    it('frozen evidence is immutable by the database', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'S1' }
      });
      await TaskTemplate.recordSafetyReview(templateId, SUPERVISOR, ORG, 'reviewed_no_control_required');
      await TaskTemplate.submitForReview(templateId, SUPERVISOR, ORG);
      await TaskTemplate.approveTemplate(templateId, SUPERVISOR, ORG);
      const published = await TaskTemplate.publishVersion(templateId, ADMIN, { publishedByOrganizationId: ORG });

      await assert.rejects(
        () => withConn((conn) => query(conn,
          `UPDATE knowledge_template_version_evidence SET section_or_clause = 'tampered' WHERE task_template_version_id = ?`,
          [published.versionId])),
        /immutable and cannot be UPDATE/
      );
      await assert.rejects(
        () => withConn((conn) => query(conn,
          `DELETE FROM knowledge_template_version_evidence WHERE task_template_version_id = ?`,
          [published.versionId])),
        /immutable and cannot be DELETE/
      );
    });

    it('the model exposes no path to frozen evidence', async () => {
      const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'src', 'models', 'knowledge-provenance.model.js'), 'utf8');
      assert.ok(!/knowledge_template_version_evidence/.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')),
        'the provenance model must contain no executable reference to frozen evidence');
    });

    it('rejects detaching evidence that does not exist', async () => {
      const templateId = await createWorkingTemplate();
      const res = await call('DELETE', `/api/knowledge-provenance/templates/${templateId}/evidence/999999999`, { userId: ADMIN });
      assert.strictEqual(res.status, 404);
    });
  });

  // ------------------------------------------------------------ tenant isolation
  describe('Tenant isolation', () => {
    it('a foreign admin cannot attach evidence to another tenant\'s template', async () => {
      const templateId = await createWorkingTemplate(ORG);
      // The foreign admin authors a source in their own org...
      const foreignSource = await call('POST', '/api/knowledge-provenance/sources', { userId: FOREIGN_ADMIN, body: sourcePayload() });
      assert.strictEqual(foreignSource.status, 201);
      const foreignVersion = await call('POST', `/api/knowledge-provenance/sources/${foreignSource.body.data.source.id}/versions`, {
        userId: FOREIGN_ADMIN, body: versionPayload()
      });
      assert.strictEqual(foreignVersion.status, 201);

      // ...and cannot use it (or anything else) against ORG's template.
      const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: FOREIGN_ADMIN,
        body: { knowledgeSourceVersionId: foreignVersion.body.data.version.id, sectionOrClause: 'S1' }
      });
      assert.strictEqual(res.status, 404, 'cross-tenant access must not disclose the template');
    });

    it('a tenant cannot see or use another tenant\'s source version', async () => {
      const foreignSource = await call('POST', '/api/knowledge-provenance/sources', { userId: FOREIGN_ADMIN, body: sourcePayload() });
      const foreignVersion = await call('POST', `/api/knowledge-provenance/sources/${foreignSource.body.data.source.id}/versions`, {
        userId: FOREIGN_ADMIN, body: versionPayload()
      });
      const foreignVersionId = foreignVersion.body.data.version.id;

      const templateId = await createWorkingTemplate(ORG);
      const res = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: foreignVersionId, sectionOrClause: 'S1' }
      });
      assert.strictEqual(res.status, 404);
    });

    it('source listing is tenant-scoped', async () => {
      const mine = await call('POST', '/api/knowledge-provenance/sources', { userId: ADMIN, body: sourcePayload() });
      const theirs = await call('POST', '/api/knowledge-provenance/sources', { userId: FOREIGN_ADMIN, body: sourcePayload() });

      const listed = await call('GET', '/api/knowledge-provenance/sources', { userId: ADMIN });
      const ids = listed.body.data.sources.map((s) => Number(s.id));
      assert.ok(ids.includes(Number(mine.body.data.source.id)));
      assert.ok(!ids.includes(Number(theirs.body.data.source.id)), 'another tenant\'s source must not be listed');
    });

    it('the database rejects a cross-tenant evidence association even if validation is bypassed', async () => {
      const templateId = await createWorkingTemplate(ORG);
      const foreignSource = await call('POST', '/api/knowledge-provenance/sources', { userId: FOREIGN_ADMIN, body: sourcePayload() });
      const foreignVersion = await call('POST', `/api/knowledge-provenance/sources/${foreignSource.body.data.source.id}/versions`, {
        userId: FOREIGN_ADMIN, body: versionPayload()
      });

      await assert.rejects(
        () => withConn((conn) => query(conn,
          `INSERT INTO knowledge_template_evidence (task_template_id, knowledge_source_version_id, section_or_clause)
           VALUES (?, ?, 'S1')`,
          [templateId, foreignVersion.body.data.version.id])),
        /tenant scope does not match task organization/
      );
    });
  });

  // ------------------------------------------------------------ M1 compatibility
  describe('M1 compatibility', () => {
    it('M1 publication recognizes evidence authored through M3', async () => {
      const templateId = await createWorkingTemplate();
      const { versionId } = await authorSourceAndVersion();
      const attached = await call('POST', `/api/knowledge-provenance/templates/${templateId}/evidence`, {
        userId: ADMIN, body: { knowledgeSourceVersionId: versionId, sectionOrClause: 'Section 9.1', derivationNotes: 'Authored via M3' }
      });
      assert.strictEqual(attached.status, 201);

      await TaskTemplate.recordSafetyReview(templateId, SUPERVISOR, ORG, 'reviewed_no_control_required');
      await TaskTemplate.submitForReview(templateId, SUPERVISOR, ORG);
      await TaskTemplate.approveTemplate(templateId, SUPERVISOR, ORG);

      const result = await TaskTemplate.publishVersion(templateId, ADMIN, { publishedByOrganizationId: ORG });
      assert.ok(result.versionId, 'publication must succeed with M3-authored evidence');

      const frozen = await withConn((conn) => query(conn,
        `SELECT e.*, v.version_designation
           FROM knowledge_template_version_evidence e
           JOIN knowledge_source_versions v ON v.id = e.knowledge_source_version_id
          WHERE e.task_template_version_id = ?`, [result.versionId]));
      assert.strictEqual(frozen.length, 1);
      assert.strictEqual(frozen[0].version_designation, '1.0');
    });

    it('M3 does not weaken M1: publication still fails without evidence', async () => {
      const templateId = await createWorkingTemplate();
      await TaskTemplate.recordSafetyReview(templateId, SUPERVISOR, ORG, 'reviewed_no_control_required');
      await TaskTemplate.submitForReview(templateId, SUPERVISOR, ORG);
      await TaskTemplate.approveTemplate(templateId, SUPERVISOR, ORG);

      await assert.rejects(
        () => TaskTemplate.publishVersion(templateId, ADMIN, { publishedByOrganizationId: ORG }),
        (error) => {
          const rules = (error.failures || []).map((f) => f.rule);
          assert.ok(rules.includes('EVIDENCE_MISSING'), `expected EVIDENCE_MISSING, got ${rules.join(', ')}`);
          return true;
        }
      );
    });
  });

  // -------------------------------------------------------------------- model API
  describe('Model surface', () => {
    it('refuses source update/delete and working-evidence update/delete', async () => {
      assert.throws(() => KnowledgeSource.update(1, { default_title: 'x' }), /not available through provenance authoring/i);
      assert.throws(() => KnowledgeSource.delete(1), /not available through provenance authoring/i);
      assert.throws(() => KnowledgeTemplateEvidence.update(1, { section_or_clause: 'x' }), /detach/i);
      assert.throws(() => KnowledgeTemplateEvidence.delete(1), /tenant-scoped detach/i);
    });

    it('reports validation failures with a structured error type', () => {
      const error = new ProvenanceValidationError([{ rule: 'X', message: 'y' }]);
      assert.strictEqual(error.statusCode, 400);
      assert.strictEqual(error.code, 'PROVENANCE_VALIDATION_FAILED');
      assert.strictEqual(error.failures.length, 1);
    });
  });

  // Cleanup happens via process exit; the suite leaves disposable fixtures in
  // the sanctioned test database, consistent with the other M1/M2 suites.
  it('closes the test HTTP server', async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });
});
