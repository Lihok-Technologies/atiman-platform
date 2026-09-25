/**
 * Knowledge Pack Publication Admission — Integration Tests
 *
 * ATM-001 M4 — proves governed Knowledge Pack authoring, composition, review,
 * approval and publication, and the migration-015 integrity that makes a
 * released Pack trustworthy.
 *
 * Two layers are asserted:
 *
 *   SCHEMA   the PostgreSQL invariants themselves (publisher attribution, the
 *            governed-state CHECK, approver/publisher separation, and the
 *            parent-row lock that closes the membership/publication race).
 *            These are asserted by DEFINITION and by behaviour, because a
 *            name-only check passes on a database carrying a weakened revision.
 *
 *   APPLICATION  the governed path through the real model against the real
 *            database — not mocked behaviour — including negative cases.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { KnowledgePack, KnowledgePackVersion } = require('../src/models/knowledge-pack.model');
const {
  validatePublicationAdmission,
  PackAdmissionError,
  PackConflictError,
  PackNotFoundError
} = require('../src/services/knowledge-pack.service');
const { checkPermission } = require('../src/config/permissions');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating knowledge-pack-publication-admission suite requires the '
    + 'sanctioned database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) '
    + 'so that test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// Disposable fixtures, disjoint from every other suite's namespace.
const ORG = 997001;
const TENANT_ORG = 997002;
const REVIEWER = 997101;
const APPROVER = 997102;
const PUBLISHER = 997103;
const OPERATOR = 997104;
const CATEGORY = 997201;
const CLASS = 997202;
const EQUIPMENT_TYPE = 997203;
// A working task_templates row that is deliberately NOT a task_template_versions row.
const WORKING_ONLY_TEMPLATE_ID = 997999;

const MIGRATION_015 = path.join(__dirname, '..', 'database', 'postgresql',
  '015_knowledge_pack_publication_governance.sql');

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

/** Run `fn` in a transaction that is always rolled back (for refusal probes). */
async function inRollback(fn) {
  const conn = await getConnection();
  try {
    const result = await fn(conn);
    await conn.rollback();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

const isCheckViolation = (error) => /violates check constraint|check constraint/i.test(error.message || '');
const constraintNamed = (name) => (error) => new RegExp(name).test(error.message || '');

let seq = 0;
const uniq = (prefix) => `${prefix}-${Date.now()}-${(seq += 1)}`;

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG, 'M4 Pack Org'], [TENANT_ORG, 'M4 Tenant Org']]) {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [id, name]);
    }
    for (const [id, username, role] of [
      [REVIEWER, 'm4-reviewer', 'supervisor'],
      [APPROVER, 'm4-approver', 'supervisor'],
      [PUBLISHER, 'm4-publisher', 'admin'],
      [OPERATOR, 'm4-operator', 'operator']
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'M4 Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, ORG]);
    }
    await query(conn, `INSERT INTO equipment_categories (id, category_code, category_name)
      VALUES (?, 'M4CAT', 'M4 Category') ON CONFLICT (id) DO NOTHING`, [CATEGORY]);
    await query(conn, `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
      VALUES (?, ?, 'M4CLS', 'M4 Class') ON CONFLICT (id) DO NOTHING`, [CLASS, CATEGORY]);
    await query(conn, `INSERT INTO equipment_types (id, class_id, type_code, type_name)
      VALUES (?, ?, 'M4TYPE', 'M4 Equipment Type') ON CONFLICT (id) DO NOTHING`, [EQUIPMENT_TYPE, CLASS]);
  });
}

/**
 * A genuinely governed immutable task_template_version, built with raw SQL.
 *
 * The M1 governance constraint (migration 013) requires the full attribution for
 * a published version, and migration 009's deferred seal constraint requires the
 * step set to be sealed by COMMIT — so assembly and sealing happen in one
 * transaction. `organizationId` controls whether the member is globally
 * applicable knowledge (NULL) or a tenant's private knowledge.
 */
async function createGovernedTemplateVersion({ organizationId = null, lifecycleState = 'published' } = {}) {
  return withConn(async (conn) => {
    const [template] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name, maintenance_type)
       VALUES (?, ?, ?, 'M4 Governed Template', 'preventive') RETURNING id`,
      [EQUIPMENT_TYPE, organizationId, uniq('M4T')]);
    const [step] = await query(conn,
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, 1, 'instruction', 'Inspect the asset for abnormal condition', true) RETURNING id`,
      [template.id]);

    const [version] = await query(conn,
      `INSERT INTO task_template_versions (
         task_template_id, version_number, equipment_type_id, template_name, maintenance_type,
         lifecycle_state_at_publish, reviewer_user_id, reviewed_at, approver_user_id, approved_at,
         safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
       VALUES (?, 1, ?, 'M4 Governed Template', 'preventive', ?, ?, NOW(), ?, NOW(),
               'reviewed_no_control_required', ?, NOW(), ?) RETURNING id`,
      [template.id, EQUIPMENT_TYPE, lifecycleState, REVIEWER, APPROVER, REVIEWER, PUBLISHER]);

    await query(conn,
      `INSERT INTO task_template_step_versions
         (task_template_version_id, step_no, task_template_step_id, step_type, instruction)
       VALUES (?, 1, ?, 'instruction', 'Inspect the asset for abnormal condition')`,
      [version.id, step.id]);
    await query(conn, `UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = ?`, [version.id]);

    return { templateId: template.id, versionId: version.id, stepId: step.id };
  });
}

/**
 * A task template whose version 1 is SUPERSEDED by its published version 2.
 *
 * Migration 009 requires a superseded version to name an existing published
 * successor in the same template and forbids self-supersession, so the successor
 * is constructed properly rather than asserted into existence.
 */
async function createSupersededTemplateVersion() {
  return withConn(async (conn) => {
    const [template] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name, maintenance_type)
       VALUES (?, NULL, ?, 'M4 Superseded Template', 'preventive') RETURNING id`,
      [EQUIPMENT_TYPE, uniq('M4S')]);
    const [step] = await query(conn,
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, 1, 'instruction', 'Inspect the asset for abnormal condition', true) RETURNING id`,
      [template.id]);

    const makeVersion = async (versionNumber) => {
      const [version] = await query(conn,
        `INSERT INTO task_template_versions (
           task_template_id, version_number, equipment_type_id, template_name, maintenance_type,
           lifecycle_state_at_publish, reviewer_user_id, reviewed_at, approver_user_id, approved_at,
           safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
         VALUES (?, ?, ?, 'M4 Superseded Template', 'preventive', 'published', ?, NOW(), ?, NOW(),
                 'reviewed_no_control_required', ?, NOW(), ?) RETURNING id`,
        [template.id, versionNumber, EQUIPMENT_TYPE, REVIEWER, APPROVER, REVIEWER, PUBLISHER]);
      await query(conn,
        `INSERT INTO task_template_step_versions
           (task_template_version_id, step_no, task_template_step_id, step_type, instruction)
         VALUES (?, 1, ?, 'instruction', 'Inspect the asset for abnormal condition')`,
        [version.id, step.id]);
      return version.id;
    };

    const supersededVersionId = await makeVersion(1);
    const successorVersionId = await makeVersion(2);
    await query(conn,
      'UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id IN (?, ?)',
      [supersededVersionId, successorVersionId]);
    await query(conn,
      `UPDATE task_template_versions
          SET lifecycle_state_at_publish = 'superseded', superseded_by_version_id = ?
        WHERE id = ?`,
      [successorVersionId, supersededVersionId]);

    return { templateId: template.id, supersededVersionId, successorVersionId };
  });
}

/** A Pack identity with a fresh code. */
async function createPack() {
  return KnowledgePack.createPack({ packCode: uniq('M4PACK'), packName: 'M4 Test Pack' });
}

/** A Pack version in draft. */
async function createDraftVersion(packId) {
  return KnowledgePackVersion.createVersion(packId, { versionNumber: '1.0.0' }, { userId: REVIEWER });
}

/** Drive a Pack version to `approved` through the governed lifecycle. */
async function driveToApproved(packId, versionId) {
  await KnowledgePackVersion.submitForReview(packId, versionId);
  await KnowledgePackVersion.recordReview(packId, versionId, REVIEWER);
  return KnowledgePackVersion.approveVersion(packId, versionId, APPROVER);
}

/** A Pack version that is approved and holds one globally applicable member. */
async function createPublishablePackVersion() {
  const pack = await createPack();
  const version = await createDraftVersion(pack.id);
  const member = await createGovernedTemplateVersion({ organizationId: null });
  await KnowledgePackVersion.addMember(pack.id, version.id, member.versionId, REVIEWER);
  await driveToApproved(pack.id, version.id);
  return { pack, versionId: version.id, memberVersionId: member.versionId };
}

describe('Knowledge Pack Publication Admission (ATM-001 M4)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  // ==========================================================
  // SCHEMA — migration 015 invariants
  // ==========================================================
  describe('A. migration 015 schema invariants', () => {
    it('installs publisher attribution with an ON DELETE RESTRICT foreign key', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT c.confdeltype::text AS del, a.attnotnull AS notnull
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'published_by_user_id'
        WHERE c.conname = 'fk_knowledge_pack_versions_published_by'
          AND c.conrelid = 'knowledge_pack_versions'::regclass
      `));
      assert.strictEqual(rows.length, 1, 'the publisher FK must exist');
      assert.strictEqual(rows[0].del, 'r', 'the publisher FK must be ON DELETE RESTRICT');
      assert.strictEqual(rows[0].notnull, false, 'the publisher is nullable before publication');
    });

    it('enforces governed-state attribution by constraint definition', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'knowledge_pack_versions'::regclass
          AND conname IN ('chk_knowledge_pack_versions_requires_governance',
                          'chk_knowledge_pack_versions_approver_not_publisher')
      `));
      const defs = new Map(rows.map((r) => [r.conname, r.definition]));

      const governance = defs.get('chk_knowledge_pack_versions_requires_governance');
      assert.ok(governance, 'the governed-state attribution constraint must exist');
      for (const column of ['reviewer_user_id', 'reviewed_at', 'approver_user_id', 'approved_at', 'published_by_user_id']) {
        assert.ok(governance.includes(column), `governed attribution must require ${column}`);
      }
      assert.ok(governance.includes('published'), 'the constraint must apply to governed states');

      const sod = defs.get('chk_knowledge_pack_versions_approver_not_publisher');
      assert.ok(sod, 'the segregation-of-duties constraint must exist');
      assert.ok(sod.includes('approver_user_id <> published_by_user_id'),
        'the database must reject an approver who is also the publisher');
    });

    it('keeps the lifecycle vocabulary unchanged: no rejected state was added', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'knowledge_pack_versions'::regclass
          AND conname = 'chk_knowledge_pack_versions_lifecycle_state'
      `));
      assert.strictEqual(rows.length, 1);
      assert.ok(!/rejected/.test(rows[0].definition),
        'migration 015 must not introduce a rejected lifecycle state');
      for (const state of ['draft', 'under_review', 'approved', 'published', 'superseded', 'retired']) {
        assert.ok(rows[0].definition.includes(state), `lifecycle must still permit ${state}`);
      }
    });

    it('re-applies cleanly: migration 015 is convergent and idempotent', async () => {
      // The canonical runner keeps no applied-migrations ledger, so every run
      // re-applies every file. 015 must therefore be safe to execute again.
      const sql = fs.readFileSync(MIGRATION_015, 'utf8');
      await withConn(async (conn) => {
        await conn.query(sql);
        await conn.query(sql);
      });
      const rows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM pg_constraint
        WHERE conrelid = 'knowledge_pack_versions'::regclass
          AND conname IN ('chk_knowledge_pack_versions_requires_governance',
                          'chk_knowledge_pack_versions_approver_not_publisher',
                          'fk_knowledge_pack_versions_published_by')
      `));
      assert.strictEqual(rows[0].n, 3, 're-applying 015 must not duplicate constraints');
    });

    it('hardens the membership guard with a parent-row lock', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'knowledge_pack_membership_guard'
      `));
      assert.strictEqual(rows.length, 1, 'the membership guard must exist');
      const def = rows[0].definition;
      assert.ok(/FOR\s+SHARE/i.test(def),
        'the guard must lock the parent pack version row (FOR SHARE) while deciding');
      // The M2 lifecycle rules must survive the hardening unchanged.
      assert.ok(def.includes("'draft', 'under_review', 'approved'"),
        'the guard must still authorize exactly the M2 pre-publication states');
    });

    it('preserves the M2 guard triggers and membership architecture', async () => {
      const triggers = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'knowledge_pack_version_task_template_versions' AND NOT t.tgisinternal
      `));
      assert.ok(triggers[0].n >= 3, 'the three M2 membership guard triggers must remain');

      const polymorphic = await withConn((conn) => query(conn, `
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'knowledge_pack_version_task_template_versions'
          AND column_name IN ('item_type', 'item_version_id')
      `));
      assert.strictEqual(polymorphic.length, 0, 'membership must remain type-specific, not polymorphic');
    });
  });

  // ==========================================================
  // SCHEMA — the invariant behaviours themselves
  // ==========================================================
  describe('B. governed-state and segregation-of-duties enforcement', () => {
    const insertPackVersion = (conn, packId, versionNumber, extra = {}) => {
      const columns = ['knowledge_pack_id', 'version_number', 'lifecycle_state'];
      const values = ['?', '?', '?'];
      const params = [packId, versionNumber, extra.lifecycle_state || 'published'];
      for (const key of ['reviewer_user_id', 'reviewed_at', 'approver_user_id', 'approved_at', 'published_by_user_id']) {
        if (extra[key] !== undefined) {
          columns.push(key);
          values.push(key.endsWith('_at') ? 'NOW()' : '?');
          if (!key.endsWith('_at')) params.push(extra[key]);
        }
      }
      return query(conn,
        `INSERT INTO knowledge_pack_versions (${columns.join(', ')})
         VALUES (${values.join(', ')}) RETURNING id`, params);
    };

    it('refuses a published pack version with no governance attribution', async () => {
      const pack = await createPack();
      await inRollback(async (conn) => {
        await assert.rejects(
          () => insertPackVersion(conn, pack.id, '1.0.0', {
            reviewer_user_id: null, reviewed_at: null, approver_user_id: null,
            approved_at: null, published_by_user_id: null
          }),
          (error) => {
            assert.ok(isCheckViolation(error), `expected a CHECK violation, got: ${error.message}`);
            return true;
          }
        );
      });
    });

    it('refuses a published pack version missing only the publisher', async () => {
      const pack = await createPack();
      await inRollback(async (conn) => {
        await assert.rejects(
          () => insertPackVersion(conn, pack.id, '1.0.0', {
            reviewer_user_id: REVIEWER, reviewed_at: true,
            approver_user_id: APPROVER, approved_at: true
          }),
          (error) => {
            assert.ok(isCheckViolation(error), `expected a CHECK violation, got: ${error.message}`);
            return true;
          }
        );
      });
    });

    it('accepts a published pack version with complete attribution', async () => {
      const pack = await createPack();
      const rows = await withConn((conn) => insertPackVersion(conn, pack.id, '1.0.0', {
        reviewer_user_id: REVIEWER, reviewed_at: true,
        approver_user_id: APPROVER, approved_at: true,
        published_by_user_id: PUBLISHER
      }));
      assert.ok(rows[0].id, 'a fully attributed published pack version must be accepted');
    });

    it('refuses a published pack version whose approver is also its publisher', async () => {
      const pack = await createPack();
      await inRollback(async (conn) => {
        await assert.rejects(
          () => insertPackVersion(conn, pack.id, '1.0.0', {
            reviewer_user_id: REVIEWER, reviewed_at: true,
            approver_user_id: PUBLISHER, approved_at: true,
            published_by_user_id: PUBLISHER
          }),
          (error) => {
            assert.ok(constraintNamed('chk_knowledge_pack_versions_approver_not_publisher')(error)
              || isCheckViolation(error), `expected the SoD constraint, got: ${error.message}`);
            return true;
          }
        );
      });
    });

    it('still allows pre-publication states without attribution', async () => {
      const pack = await createPack();
      for (const state of ['draft', 'under_review', 'approved']) {
        const rows = await withConn((conn) => insertPackVersion(conn, pack.id, `${state}`, { lifecycle_state: state }));
        assert.ok(rows[0].id, `${state} must remain insertable without attribution`);
      }
    });

    it('protects the publisher from being erased by user deletion', async () => {
      const pack = await createPack();
      const versionRows = await withConn((conn) => insertPackVersion(conn, pack.id, '1.0.0', {
        reviewer_user_id: REVIEWER, reviewed_at: true,
        approver_user_id: APPROVER, approved_at: true,
        published_by_user_id: PUBLISHER
      }));
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, 'DELETE FROM users WHERE id = ?', [PUBLISHER]),
          (error) => /foreign key constraint|violates foreign key/i.test(error.message || ''),
          'deleting the accountable publisher must be refused'
        );
      });
      void versionRows;
    });
  });

  // ==========================================================
  // CONCURRENCY — the defect migration 015 closes
  // ==========================================================
  describe('C. membership / publication concurrency', () => {
    it('prevents membership committing across the publication boundary', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      const member = await createGovernedTemplateVersion({ organizationId: null });
      const approvals = await driveToApproved(pack.id, version.id);
      assert.strictEqual(approvals.lifecycle_state, 'approved');

      // Connection A holds an open membership mutation; connection B publishes.
      const a = await getConnection();
      const b = await getConnection();
      try {
        await a.query(
          `INSERT INTO knowledge_pack_version_task_template_versions
             (knowledge_pack_version_id, task_template_version_id, added_by_user_id)
           VALUES (?, ?, ?)`,
          [version.id, member.versionId, REVIEWER]);

        await b.query('BEGIN');
        let publicationResolved = false;
        const publication = b.query(
          `UPDATE knowledge_pack_versions
              SET lifecycle_state = 'published', published_at = NOW(), published_by_user_id = ?
            WHERE id = ? AND lifecycle_state = 'approved'`,
          [PUBLISHER, version.id]
        ).then(() => { publicationResolved = true; });

        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.strictEqual(publicationResolved, false,
          'publication must wait for the in-flight membership mutation (parent-row lock)');

        await a.commit();
        await publication;
        await b.commit();
      } finally {
        await a.rollback().catch(() => {});
        await b.rollback().catch(() => {});
        a.release();
        b.release();
      }

      const final = await withConn((conn) => query(conn,
        'SELECT lifecycle_state FROM knowledge_pack_versions WHERE id = ?', [version.id]));
      const members = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM knowledge_pack_version_task_template_versions
          WHERE knowledge_pack_version_id = ?`, [version.id]));
      assert.strictEqual(final[0].lifecycle_state, 'published');
      assert.strictEqual(members[0].n, 1,
        'the member committed before publication, so the published composition is the validated one');
    });

    it('rejects a membership mutation that is blocked until publication commits', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      const member = await createGovernedTemplateVersion({ organizationId: null });
      await driveToApproved(pack.id, version.id);

      const a = await getConnection();
      const b = await getConnection();
      let membershipError = null;
      try {
        await b.query('BEGIN');
        await b.query(
          `UPDATE knowledge_pack_versions
              SET lifecycle_state = 'published', published_at = NOW(), published_by_user_id = ?
            WHERE id = ? AND lifecycle_state = 'approved'`,
          [PUBLISHER, version.id]);

        let settled = false;
        const membership = a.query(
          `INSERT INTO knowledge_pack_version_task_template_versions
             (knowledge_pack_version_id, task_template_version_id, added_by_user_id)
           VALUES (?, ?, ?)`,
          [version.id, member.versionId, REVIEWER]
        ).then(() => { settled = true; }).catch((error) => { settled = true; membershipError = error; });

        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.strictEqual(settled, false,
          'membership must wait while publication holds the parent row');

        await b.commit();
        await membership;
      } finally {
        await a.rollback().catch(() => {});
        await b.rollback().catch(() => {});
        a.release();
        b.release();
      }

      assert.ok(membershipError, 'membership must be refused once the pack version is published');
      assert.match(membershipError.message, /membership is frozen/);
    });
  });

  // ==========================================================
  // APPLICATION — governed authoring and lifecycle
  // ==========================================================
  describe('D. governed Pack authoring and lifecycle', () => {
    it('creates a Knowledge Pack', async () => {
      const pack = await createPack();
      assert.ok(pack.id, 'a pack identity must be created');
      assert.ok(pack.pack_code, 'the pack code must be persisted');
    });

    it('rejects a Pack with no pack code', async () => {
      await assert.rejects(
        () => KnowledgePack.createPack({ packCode: '', packName: 'No code' }),
        (error) => error.code === 'PACK_VALIDATION_FAILED'
      );
    });

    it('rejects a duplicate pack code', async () => {
      const pack = await createPack();
      await assert.rejects(
        () => KnowledgePack.createPack({ packCode: pack.pack_code, packName: 'Duplicate' }),
        (error) => /duplicate key|PACK_CODE_ALREADY_EXISTS/i.test(`${error.code} ${error.message}`)
      );
    });

    it('creates a Pack version in draft with its author recorded', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      assert.strictEqual(version.lifecycle_state, 'draft');
      assert.strictEqual(Number(version.author_user_id), REVIEWER);
      assert.strictEqual(version.published_by_user_id, null, 'a draft has no publisher');
    });

    it('does not expose generic mutation of a pack version', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      // Wrapped in an async function: the refusal throws synchronously, and
      // assert.rejects() does not catch a synchronous throw.
      await assert.rejects(async () => KnowledgePackVersion.update(version.id, { change_summary: 'x' }),
        (error) => error.code === 'PACK_MUTATION_NOT_EXPOSED');
      await assert.rejects(async () => KnowledgePackVersion.delete(version.id),
        (error) => error.code === 'PACK_MUTATION_NOT_EXPOSED');
    });

    it('adds and removes membership while the pack version is mutable', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      const member = await createGovernedTemplateVersion({ organizationId: null });

      const membershipId = await KnowledgePackVersion.addMember(pack.id, version.id, member.versionId, REVIEWER);
      assert.ok(membershipId, 'membership must be created');
      let members = await KnowledgePackVersion.listMembers(pack.id, version.id);
      assert.strictEqual(members.length, 1);

      await KnowledgePackVersion.removeMember(pack.id, version.id, membershipId);
      members = await KnowledgePackVersion.listMembers(pack.id, version.id);
      assert.strictEqual(members.length, 0, 'membership must be removable while mutable');
    });

    it('rejects duplicate membership', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      const member = await createGovernedTemplateVersion({ organizationId: null });
      await KnowledgePackVersion.addMember(pack.id, version.id, member.versionId, REVIEWER);
      await assert.rejects(
        () => KnowledgePackVersion.addMember(pack.id, version.id, member.versionId, REVIEWER),
        (error) => error.code === 'MEMBER_ALREADY_PRESENT'
      );
    });

    it('rejects a working task template as a member', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);

      // Architecturally: the membership column is a foreign key to
      // task_template_versions, so a working task template is structurally
      // unrepresentable as a member, not merely rejected by a service check.
      const fk = await withConn((conn) => query(conn, `
        SELECT confrelid::regclass::text AS target FROM pg_constraint
        WHERE conname = 'fk_kpvtv_template_version'
      `));
      assert.strictEqual(fk.length, 1, 'the membership FK must exist');
      assert.strictEqual(fk[0].target, 'task_template_versions',
        'membership must reference immutable versions, never working task_templates');

      // Behaviourally: a working template's id must not be composable. The two
      // tables have independent id sequences, so this fixture pins an explicit
      // id and proves it really is absent from task_template_versions — the
      // refusal then proves the version-only contract, not an id collision.
      const workingOnly = await withConn(async (conn) => {
        await query(conn,
          `INSERT INTO task_templates (id, equipment_type_id, template_code, template_name, maintenance_type)
           VALUES (?, ?, 'M4-WORKING-ONLY', 'M4 Working-Only Template', 'preventive')
           ON CONFLICT (id) DO NOTHING`,
          [WORKING_ONLY_TEMPLATE_ID, EQUIPMENT_TYPE]);
        const isTemplate = await query(conn,
          'SELECT 1 AS found FROM task_templates WHERE id = ?', [WORKING_ONLY_TEMPLATE_ID]);
        const isVersion = await query(conn,
          'SELECT 1 AS found FROM task_template_versions WHERE id = ?', [WORKING_ONLY_TEMPLATE_ID]);
        return { isTemplate: isTemplate.length === 1, isVersion: isVersion.length === 1 };
      });
      assert.ok(workingOnly.isTemplate, 'fixture: the working template must exist');
      assert.strictEqual(workingOnly.isVersion, false,
        'fixture: the working template id is not a task template version id');

      await assert.rejects(
        () => KnowledgePackVersion.addMember(pack.id, version.id, WORKING_ONLY_TEMPLATE_ID, REVIEWER),
        (error) => error instanceof PackNotFoundError || error.statusCode === 404
      );
    });

    it('rejects a superseded member: only published members are admissible', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      const { supersededVersionId, successorVersionId } = await createSupersededTemplateVersion();

      const state = await withConn((conn) => query(conn,
        'SELECT lifecycle_state_at_publish FROM task_template_versions WHERE id = ?', [supersededVersionId]));
      assert.strictEqual(state[0].lifecycle_state_at_publish, 'superseded');

      await assert.rejects(
        () => KnowledgePackVersion.addMember(pack.id, version.id, supersededVersionId, REVIEWER),
        (error) => error.code === 'MEMBER_NOT_PUBLISHED',
        'a superseded version is immutable but no longer current, so it must not be composable'
      );
      // The published successor in the same template IS admissible, proving the
      // refusal is about publication state rather than the template.
      const membershipId = await KnowledgePackVersion.addMember(
        pack.id, version.id, successorVersionId, REVIEWER);
      assert.ok(membershipId, 'the published successor must be admissible');
    });

    it('drives the governed lifecycle draft -> under_review -> reviewed -> approved', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);

      const submitted = await KnowledgePackVersion.submitForReview(pack.id, version.id);
      assert.strictEqual(submitted.lifecycle_state, 'under_review');

      const reviewed = await KnowledgePackVersion.recordReview(pack.id, version.id, REVIEWER);
      assert.strictEqual(reviewed.lifecycle_state, 'under_review', 'recording a review does not approve');
      assert.strictEqual(Number(reviewed.reviewer_user_id), REVIEWER);
      assert.ok(reviewed.reviewed_at, 'the review timestamp must be recorded');

      const approved = await KnowledgePackVersion.approveVersion(pack.id, version.id, APPROVER);
      assert.strictEqual(approved.lifecycle_state, 'approved');
      assert.strictEqual(Number(approved.approver_user_id), APPROVER);
      assert.ok(approved.approved_at, 'the approval timestamp must be recorded');
    });

    it('refuses submission from a state that is not draft', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      await KnowledgePackVersion.submitForReview(pack.id, version.id);
      await assert.rejects(
        () => KnowledgePackVersion.submitForReview(pack.id, version.id),
        (error) => error.code === 'PACK_VERSION_NOT_SUBMITTABLE'
      );
    });

    it('refuses approval of a pack version that was never reviewed', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      await KnowledgePackVersion.submitForReview(pack.id, version.id);
      await assert.rejects(
        () => KnowledgePackVersion.approveVersion(pack.id, version.id, APPROVER),
        (error) => error.code === 'PACK_VERSION_NOT_REVIEWED'
      );
    });

    it('binds a pack version to the pack that was addressed', async () => {
      const packA = await createPack();
      const packB = await createPack();
      const version = await createDraftVersion(packA.id);
      assert.strictEqual(await KnowledgePackVersion.findVersionInPack(packB.id, version.id), null,
        'a version must not be reachable through another pack');
      await assert.rejects(
        () => KnowledgePackVersion.removeMember(packB.id, version.id, 1),
        (error) => error instanceof PackNotFoundError || error.statusCode === 404
      );
    });
  });

  // ==========================================================
  // APPLICATION — the publication admission boundary
  // ==========================================================
  describe('E. publication admission', () => {
    it('rejects publication of an empty pack version', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      await driveToApproved(pack.id, version.id);
      await assert.rejects(
        () => KnowledgePackVersion.publishVersion(pack.id, version.id, PUBLISHER),
        (error) => {
          assert.ok(error instanceof PackAdmissionError, `expected admission failure, got ${error.message}`);
          assert.ok(error.failures.some((f) => f.rule === 'PACK_EMPTY'), 'PACK_EMPTY must be reported');
          return true;
        }
      );
    });

    it('rejects publication from an invalid lifecycle state', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      const member = await createGovernedTemplateVersion({ organizationId: null });
      await KnowledgePackVersion.addMember(pack.id, version.id, member.versionId, REVIEWER);

      await assert.rejects(
        () => KnowledgePackVersion.publishVersion(pack.id, version.id, PUBLISHER),
        (error) => error instanceof PackAdmissionError
          && error.failures.some((f) => f.rule === 'PACK_VERSION_NOT_PUBLISHABLE')
      );
    });

    it('rejects publication when approval attribution is incomplete', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      const member = await createGovernedTemplateVersion({ organizationId: null });
      await KnowledgePackVersion.addMember(pack.id, version.id, member.versionId, REVIEWER);

      // Reach `under_review` and strip the review attribution, then approve via
      // SQL so an incomplete record reaches the admission gate.
      await KnowledgePackVersion.submitForReview(pack.id, version.id);
      await withConn((conn) => query(conn,
        `UPDATE knowledge_pack_versions SET lifecycle_state = 'approved', approver_user_id = ?,
           approved_at = NOW(), reviewer_user_id = NULL, reviewed_at = NULL WHERE id = ?`,
        [APPROVER, version.id]));

      await assert.rejects(
        () => KnowledgePackVersion.publishVersion(pack.id, version.id, PUBLISHER),
        (error) => {
          assert.ok(error instanceof PackAdmissionError);
          const rules = error.failures.map((f) => f.rule);
          assert.ok(rules.includes('REVIEW_ATTRIBUTION_MISSING'), `expected review attribution failure, got ${rules}`);
          assert.ok(rules.includes('REVIEW_TIMESTAMP_MISSING'), `expected review timestamp failure, got ${rules}`);
          return true;
        }
      );
    });

    it('rejects publication when the publisher approved the pack version', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      const member = await createGovernedTemplateVersion({ organizationId: null });
      await KnowledgePackVersion.addMember(pack.id, version.id, member.versionId, REVIEWER);
      await driveToApproved(pack.id, version.id);

      // APPROVER tries to publish what APPROVER approved.
      await assert.rejects(
        () => KnowledgePackVersion.publishVersion(pack.id, version.id, APPROVER),
        (error) => {
          assert.ok(error instanceof PackAdmissionError);
          assert.ok(error.failures.some((f) => f.rule === 'SEGREGATION_OF_DUTIES_VIOLATION'),
            'approver == publisher must be refused by name');
          return true;
        }
      );

      const unchanged = await KnowledgePackVersion.findVersionById(version.id);
      assert.strictEqual(unchanged.lifecycle_state, 'approved', 'a refused publication must write nothing');
    });

    it('publishes with distinct accountable humans and records the publisher', async () => {
      const { pack, versionId } = await createPublishablePackVersion();
      const before = Date.now();
      const published = await KnowledgePackVersion.publishVersion(pack.id, versionId, PUBLISHER);

      assert.strictEqual(published.lifecycle_state, 'published', 'lifecycle must become published');
      assert.strictEqual(Number(published.published_by_user_id), PUBLISHER, 'the publisher must be persisted');
      assert.ok(published.published_at, 'published_at must be persisted');
      assert.ok(new Date(published.published_at).getTime() >= before - 1000,
        'published_at must be the publication instant');
      assert.strictEqual(Number(published.approver_user_id), APPROVER);
      assert.notStrictEqual(Number(published.approver_user_id), Number(published.published_by_user_id));
    });

    it('rejects republishing an already published pack version', async () => {
      const { pack, versionId } = await createPublishablePackVersion();
      await KnowledgePackVersion.publishVersion(pack.id, versionId, PUBLISHER);
      await assert.rejects(
        () => KnowledgePackVersion.publishVersion(pack.id, versionId, PUBLISHER),
        (error) => error instanceof PackAdmissionError
          && error.failures.some((f) => f.rule === 'PACK_VERSION_ALREADY_PUBLISHED')
      );
    });

    it('never permits post-publication backfilling of the publisher', async () => {
      const { pack, versionId } = await createPublishablePackVersion();
      await KnowledgePackVersion.publishVersion(pack.id, versionId, PUBLISHER);
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, 'UPDATE knowledge_pack_versions SET published_by_user_id = ? WHERE id = ?',
            [REVIEWER, versionId]),
          (error) => /immutable|cannot be updated/i.test(error.message || ''),
          'a published pack version must be immutable, including its publisher'
        );
      });
    });

    it('freezes membership once the pack version is published', async () => {
      const { pack, versionId, memberVersionId } = await createPublishablePackVersion();
      await KnowledgePackVersion.publishVersion(pack.id, versionId, PUBLISHER);

      const other = await createGovernedTemplateVersion({ organizationId: null });
      await assert.rejects(
        () => KnowledgePackVersion.addMember(pack.id, versionId, other.versionId, REVIEWER),
        (error) => error.code === 'PACK_MEMBERSHIP_FROZEN'
      );

      const existing = await KnowledgePackVersion.listMembers(pack.id, versionId);
      await assert.rejects(
        () => KnowledgePackVersion.removeMember(pack.id, versionId, existing[0].id),
        (error) => error.code === 'PACK_MEMBERSHIP_FROZEN'
      );
      assert.strictEqual((await KnowledgePackVersion.listMembers(pack.id, versionId)).length, 1,
        `the member ${memberVersionId} must survive the frozen composition`);
    });

    it('reports every admission failure at once, and writes nothing', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      // Empty, unreviewed, unapproved, and attempted by another identity.
      await withConn((conn) => query(conn,
        `UPDATE knowledge_pack_versions SET lifecycle_state = 'approved' WHERE id = ?`, [version.id]));
      await assert.rejects(
        () => KnowledgePackVersion.publishVersion(pack.id, version.id, PUBLISHER),
        (error) => {
          const rules = error.failures.map((f) => f.rule);
          assert.ok(rules.includes('PACK_EMPTY'), 'PACK_EMPTY must be reported');
          assert.ok(rules.includes('REVIEW_ATTRIBUTION_MISSING'), 'review attribution must be reported');
          assert.ok(rules.includes('APPROVER_ATTRIBUTION_MISSING'), 'approver attribution must be reported');
          assert.ok(rules.length > 1, 'the gate must fail closed with every reason, not the first');
          return true;
        }
      );
      const unchanged = await KnowledgePackVersion.findVersionById(version.id);
      assert.strictEqual(unchanged.lifecycle_state, 'approved');
      assert.strictEqual(unchanged.published_by_user_id, null);
    });
  });

  // ==========================================================
  // SCOPE / AUTHORIZATION
  // ==========================================================
  describe('F. scope and authorization boundaries', () => {
    it('is shared knowledge: a pack identity has no tenant scope', async () => {
      const columns = await withConn((conn) => query(conn, `
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'knowledge_packs' AND column_name = 'organization_id'
      `));
      assert.strictEqual(columns.length, 0,
        'knowledge_packs is shared knowledge and has no organization scope');
    });

    it('refuses tenant-scoped knowledge as a member of a shared pack', async () => {
      const pack = await createPack();
      const version = await createDraftVersion(pack.id);
      const tenantVersion = await createGovernedTemplateVersion({ organizationId: TENANT_ORG });
      await assert.rejects(
        () => KnowledgePackVersion.addMember(pack.id, version.id, tenantVersion.versionId, REVIEWER),
        (error) => error.code === 'MEMBER_SCOPE_VIOLATION'
      );
    });

    it('grants pack authoring only to the existing authoring capabilities', () => {
      assert.strictEqual(checkPermission('admin', 'TASKS', 'CREATE'), 'all');
      assert.strictEqual(checkPermission('admin', 'TASKS', 'UPDATE'), 'all');
      assert.strictEqual(checkPermission('operator', 'TASKS', 'CREATE'), 'none',
        'generic authenticated users must not author packs');
      assert.strictEqual(checkPermission('operator', 'TASKS', 'UPDATE'), 'none');
      assert.strictEqual(checkPermission('operator', 'KNOWLEDGE', 'APPROVE'), 'none');
      assert.strictEqual(checkPermission('operator', 'KNOWLEDGE', 'REVIEW'), 'none');
    });

    it('wires every pack route to the approved capability', async () => {
      const router = require('../src/routes/knowledge-pack.routes');
      const routes = new Map(router.stack.filter((l) => l.route).map((l) => {
        const methods = Object.keys(l.route.methods).join(',').toUpperCase();
        return [`${methods} ${l.route.path}`, l.route.stack.map((entry) => entry.handle)];
      }));

      // Authentication is mounted once on the router, not per route.
      assert.ok(router.stack.some((l) => !l.route && l.name === 'authenticate'),
        'the pack router must require authentication');

      // Authorization is verified BEHAVIOURALLY, by invoking the wired guard.
      // requirePermission() returns an anonymous arrow, so a name-based check
      // would be vacuous.
      const invokeGuard = async (guard, role) => {
        const outcome = { nextCalled: false, status: null };
        const res = {
          status(code) { outcome.status = code; return this; },
          json() { return this; }
        };
        await guard({ user: { id: 1, role }, params: {}, body: {}, query: {} }, res, () => {
          outcome.nextCalled = true;
        });
        return outcome;
      };

      // The exact approved capability mapping. Pack authoring reuses TASKS
      // authoring (admin only); review and approval reuse KNOWLEDGE.REVIEW /
      // KNOWLEDGE.APPROVE (supervisor + admin); publication follows the M1
      // requireAdmin pattern (supervisor + admin); reads reuse KNOWLEDGE.VIEW,
      // which the existing model already grants to every role.
      const READ = ['operator', 'supervisor', 'admin'];
      const KNOWLEDGE_DECISION = ['supervisor', 'admin'];
      const ADMIN_ONLY = ['admin'];
      const roleMatrix = {
        'POST /': ADMIN_ONLY,
        'GET /': READ,
        'GET /:packId': READ,
        'POST /:packId/versions': ADMIN_ONLY,
        'GET /:packId/versions': READ,
        'GET /:packId/versions/:versionId': READ,
        'GET /:packId/versions/:versionId/members': READ,
        'POST /:packId/versions/:versionId/members': ADMIN_ONLY,
        'DELETE /:packId/versions/:versionId/members/:membershipId': ADMIN_ONLY,
        'POST /:packId/versions/:versionId/submit-for-review': KNOWLEDGE_DECISION,
        'POST /:packId/versions/:versionId/review': KNOWLEDGE_DECISION,
        'POST /:packId/versions/:versionId/approve': KNOWLEDGE_DECISION,
        'POST /:packId/versions/:versionId/publish': KNOWLEDGE_DECISION
      };

      assert.deepStrictEqual([...routes.keys()].sort(), Object.keys(roleMatrix).sort(),
        'every pack route must have an asserted authorization expectation');

      for (const [key, guards] of routes) {
        // Each route stack is [authorization guard, controller]: authentication
        // is mounted on the router, so the guard is the first entry here and the
        // controller is last. Invoking the controller would prove nothing.
        assert.ok(guards.length >= 2, `${key} must carry an authorization guard ahead of its handler`);
        const guard = guards[0];
        for (const role of ['operator', 'supervisor', 'admin']) {
          const outcome = await invokeGuard(guard, role);
          const expected = roleMatrix[key].includes(role);
          assert.strictEqual(outcome.nextCalled, expected,
            `${key} for role ${role}: expected ${expected ? 'admitted' : 'denied'}, `
            + `got next=${outcome.nextCalled} status=${outcome.status}`);
          if (!expected) {
            assert.strictEqual(outcome.status, 403, `${key} must deny ${role} with 403`);
          }
        }
      }

      assert.ok(routes.has('POST /'), 'the pack creation route must exist');
      assert.ok(routes.has('POST /:packId/versions'), 'the pack version creation route must exist');
      assert.ok(routes.has('POST /:packId/versions/:versionId/members'), 'membership addition must exist');
      assert.ok(routes.has('DELETE /:packId/versions/:versionId/members/:membershipId'),
        'membership removal must exist');
      // Publication must follow the M1 publication authorization pattern, which
      // is requireAdmin — NOT the narrower TASKS authoring capability.
      const publishGuard = routes.get('POST /:packId/versions/:versionId/publish')[0];
      const createGuard = routes.get('POST /')[0];
      assert.notStrictEqual(publishGuard, createGuard,
        'publication must not reuse the pack-authoring guard');
    });
  });

  // ==========================================================
  // PRIOR MILESTONES REMAIN INTACT
  // ==========================================================
  describe('G. M1 / M2 / M3 remain intact', () => {
    it('M1: governed task template publication still refuses approver == publisher', async () => {
      // A real working template, so the probe inserts rather than selecting nothing.
      const governed = await createGovernedTemplateVersion({ organizationId: null });
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO task_template_versions (
              task_template_id, version_number, equipment_type_id, template_name, maintenance_type,
              lifecycle_state_at_publish, reviewer_user_id, reviewed_at, approver_user_id, approved_at,
              safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
            VALUES (?, 991, ?, 'M1 SoD Probe', 'preventive', 'published', ?, NOW(), ?, NOW(),
                    'reviewed_no_control_required', ?, NOW(), ?)`,
          [governed.templateId, EQUIPMENT_TYPE, REVIEWER, PUBLISHER, REVIEWER, PUBLISHER]),
          (error) => /chk_task_template_versions_approver_not_publisher|check constraint/i.test(error.message || ''),
          'the M1 segregation-of-duties constraint must still reject approver == publisher'
        );
      });
    });

    it('M1: the template governance constraints are unchanged', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'task_template_versions'::regclass
          AND conname IN ('chk_task_template_versions_requires_governance',
                          'chk_task_template_versions_approver_not_publisher')
      `));
      assert.strictEqual(rows.length, 2, 'both M1 governance constraints must still exist');
    });

    it('M2: membership is never retargeted, and stays frozen for superseded and retired', async () => {
      const pack = await createPack();
      const draft = await createDraftVersion(pack.id);
      const member = await createGovernedTemplateVersion({ organizationId: null });
      const membershipId = await KnowledgePackVersion.addMember(pack.id, draft.id, member.versionId, REVIEWER);

      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn,
            `UPDATE knowledge_pack_version_task_template_versions SET task_template_version_id = ?
              WHERE id = ?`, [member.versionId, membershipId]),
          (error) => /immutable|insufficient privilege/i.test(error.message || ''),
          'membership must never be retargeted'
        );
      });

      // `retired` needs no successor, unlike `superseded`, so it is the second
      // released state that can be constructed in isolation.
      const released = await withConn(async (conn) => {
        const rows = await query(conn,
          `UPDATE knowledge_pack_versions SET lifecycle_state = 'retired', reviewer_user_id = ?,
             reviewed_at = NOW(), approver_user_id = ?, approved_at = NOW(), published_by_user_id = ?
           WHERE id = ? RETURNING id`, [REVIEWER, APPROVER, PUBLISHER, draft.id]);
        return rows[0];
      });
      assert.ok(released.id, 'the released-state probe must be reachable');
      await assert.rejects(
        () => KnowledgePackVersion.addMember(pack.id, draft.id, member.versionId, REVIEWER),
        (error) => error.code === 'PACK_MEMBERSHIP_FROZEN',
        'membership must be frozen for a retired pack version, not only a published one'
      );
    });

    it('M3: frozen provenance remains unreachable and its lineage immutable', async () => {
      const { KnowledgeTemplateEvidenceModel } = require('../src/models/knowledge-provenance.model');
      // `update` is an own class field, so it exists on an instance, not the class.
      const evidenceModel = new KnowledgeTemplateEvidenceModel();
      const rows = await withConn((conn) => query(conn, `
        SELECT c.confdeltype::text AS del FROM pg_constraint c
        WHERE c.conname = 'fk_knowledge_template_version_evidence_copied_from'
      `));
      assert.strictEqual(rows.length, 1, 'the frozen-provenance lineage FK must still exist');
      assert.strictEqual(rows[0].del, 'r',
        'frozen provenance lineage must still be ON DELETE RESTRICT (M3 invariant)');

      // M3's model must still be unable to reach frozen provenance at all.
      await assert.rejects(
        async () => evidenceModel.update(1, { derivation_notes: 'tampered' }),
        (error) => /not available through provenance authoring/i.test(error.message || ''),
        'the M3 working-evidence model must still refuse generic mutation'
      );
    });
  });

  // ==========================================================
  // SERVICE — pure admission rules
  // ==========================================================
  describe('H. admission rules (pure)', () => {
    it('reports a missing pack version', () => {
      const failures = validatePublicationAdmission({ packVersion: null, members: [], publisherUserId: PUBLISHER });
      assert.deepStrictEqual(failures.map((f) => f.rule), ['PACK_VERSION_NOT_FOUND']);
    });

    it('reports a member whose version is unreachable', () => {
      const failures = validatePublicationAdmission({
        packVersion: { lifecycle_state: 'approved', reviewer_user_id: REVIEWER, reviewed_at: new Date(),
          approver_user_id: APPROVER, approved_at: new Date() },
        members: [{ task_template_version_id: null, lifecycle_state_at_publish: null, organization_id: null }],
        publisherUserId: PUBLISHER
      });
      const rules = failures.map((f) => f.rule);
      assert.ok(rules.includes('MEMBER_VERSION_NOT_FOUND'), 'an unreachable member must not pass silently');
    });
  });
});
