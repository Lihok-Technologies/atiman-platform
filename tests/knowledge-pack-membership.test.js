/**
 * Knowledge Pack Membership Integration Tests
 *
 * ATM-001 M2 — proves that knowledge pack membership is immutable and can only
 * ever reference immutable published knowledge.
 *
 * The invariant under test, at the PostgreSQL level:
 *   - a pack version may be composed only while it is not yet released;
 *   - once released, its membership is frozen and can neither grow nor shrink;
 *   - membership is never retargeted;
 *   - a member is an immutable task_template_version, never a mutable working
 *     template, so later edits to working knowledge cannot alter a package.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { getConnection, isIntegrationTest } = require('../src/config/database');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating knowledge-pack-membership suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// Disposable fixtures, disjoint from every other suite's namespace.
const ORG = 995001;
const REVIEWER = 995101;
const APPROVER = 995102;
const PUBLISHER = 995103;
const CATEGORY = 995201;
const CLASS = 995202;
const EQUIPMENT_TYPE = 995203;

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
    await query(conn, `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
      [ORG, 'M2 Pack Membership Org']);
    for (const [id, username, role] of [
      [REVIEWER, 'm2-reviewer', 'supervisor'],
      [APPROVER, 'm2-approver', 'supervisor'],
      [PUBLISHER, 'm2-publisher', 'admin']
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'M2 Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, ORG]);
    }
    await query(conn, `INSERT INTO equipment_categories (id, category_code, category_name)
      VALUES (?, 'M2CAT', 'M2 Category') ON CONFLICT (id) DO NOTHING`, [CATEGORY]);
    await query(conn, `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
      VALUES (?, ?, 'M2CLS', 'M2 Class') ON CONFLICT (id) DO NOTHING`, [CLASS, CATEGORY]);
    await query(conn, `INSERT INTO equipment_types (id, class_id, type_code, type_name)
      VALUES (?, ?, 'M2TYPE', 'M2 Equipment Type') ON CONFLICT (id) DO NOTHING`, [EQUIPMENT_TYPE, CLASS]);
  });
}

let packSeq = 0;

/**
 * A pack identity with a uniquely-coded version in the requested lifecycle state.
 *
 * Migration 009 requires a superseded pack version to name a published successor
 * in the same pack, so that state is constructed properly rather than asserted
 * into existence.
 *
 * Migration 015 (ATM-001 M4) requires a GOVERNED pack version — published,
 * superseded or retired — to carry complete durable governance attribution, and
 * requires its approver to differ from its publisher. Attribution is therefore
 * attached to governed states only: a draft or under_review version carries
 * none, because recording an approval for a version that was never approved
 * would be false attribution rather than a fixture convenience.
 */
async function createPackVersion(lifecycleState = 'draft') {
  packSeq += 1;
  return withConn(async (conn) => {
    const [pack] = await query(conn,
      `INSERT INTO knowledge_packs (pack_code, pack_name) VALUES (?, ?) RETURNING id`,
      [`M2-PACK-${Date.now()}-${packSeq}`, 'M2 Test Pack']);

    const governed = ['published', 'superseded', 'retired'].includes(lifecycleState);
    const attributionColumns = governed
      ? ', reviewer_user_id, reviewed_at, approver_user_id, approved_at, published_by_user_id'
      : '';
    const attributionValues = governed
      ? `, ${REVIEWER}, NOW(), ${APPROVER}, NOW(), ${PUBLISHER}`
      : '';

    if (lifecycleState === 'superseded') {
      const [successor] = await query(conn,
        `INSERT INTO knowledge_pack_versions
           (knowledge_pack_id, version_number, lifecycle_state, published_at${attributionColumns})
         VALUES (?, '2.0.0', 'published', NOW()${attributionValues}) RETURNING id`, [pack.id]);
      const [version] = await query(conn,
        `INSERT INTO knowledge_pack_versions
           (knowledge_pack_id, version_number, lifecycle_state, published_at, superseded_by_version_id${attributionColumns})
         VALUES (?, '1.0.0', 'superseded', NOW(), ?${attributionValues}) RETURNING id`, [pack.id, successor.id]);
      return version.id;
    }

    const [version] = await query(conn,
      `INSERT INTO knowledge_pack_versions
         (knowledge_pack_id, version_number, lifecycle_state, published_at${attributionColumns})
       VALUES (?, '1.0.0', ?, ?${attributionValues}) RETURNING id`,
      [pack.id, lifecycleState,
        ['published', 'retired'].includes(lifecycleState) ? new Date() : null]);
    return version.id;
  });
}

let templateSeq = 0;

/**
 * Create a working template and publish it to produce an immutable
 * task_template_version, using the real M1 publication path so the member is a
 * genuine governed version rather than a hand-built row.
 */
async function createPublishedTemplateVersion() {
  const { TaskTemplate } = require('../src/models');
  templateSeq += 1;

  const templateId = await withConn(async (conn) => {
    const [template] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name,
         maintenance_type, task_kind, frequency_value, frequency_unit, estimated_duration_minutes, priority)
       VALUES (?, ?, ?, 'M2 Governed Template', 'preventive', 'inspection', 1, 'month', 30, 'medium')
       RETURNING id`,
      [EQUIPMENT_TYPE, ORG, `M2-${Date.now()}-${templateSeq}`]);
    await query(conn,
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, 1, 'instruction', 'Inspect the asset for abnormal condition', true)`,
      [template.id]);

    // Evidence is required by the M1 admission gate.
    const [source] = await query(conn,
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
       VALUES (?, 'engineering_standard', 'M2 Source', ?) RETURNING id`,
      [`M2-SRC-${Date.now()}-${templateSeq}`, ORG]);
    const [sourceVersion] = await query(conn,
      `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
       VALUES (?, '1.0', 'M2 Source Version') RETURNING id`, [source.id]);
    await query(conn,
      `INSERT INTO knowledge_template_evidence (task_template_id, knowledge_source_version_id,
         section_or_clause, derivation_notes, added_by_user_id)
       VALUES (?, ?, 'Section 4.2', 'Derived from the equipment manual', ?)`,
      [template.id, sourceVersion.id, REVIEWER]);
    return template.id;
  });

  await TaskTemplate.recordSafetyReview(templateId, REVIEWER, ORG, 'reviewed_no_control_required');
  await TaskTemplate.submitForReview(templateId, REVIEWER, ORG);
  await TaskTemplate.approveTemplate(templateId, APPROVER, ORG);
  const result = await TaskTemplate.publishVersion(templateId, PUBLISHER, { publishedByOrganizationId: ORG });

  return { templateId, versionId: result.versionId };
}

/**
 * Create a working task_template WITHOUT publishing it.
 *
 * Used to prove membership cannot reference mutable working knowledge: such an
 * id exists in task_templates but has no corresponding version row.
 */
async function createUnpublishedWorkingTemplate() {
  templateSeq += 1;
  return withConn(async (conn) => {
    const [template] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name,
         maintenance_type, task_kind, frequency_value, frequency_unit, estimated_duration_minutes, priority)
       VALUES (?, ?, ?, 'M2 Unpublished Working Template', 'preventive', 'inspection', 1, 'month', 30, 'medium')
       RETURNING id`,
      [EQUIPMENT_TYPE, ORG, `M2-UNPUB-${Date.now()}-${templateSeq}`]);
    await query(conn,
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, 1, 'instruction', 'Working step that was never published', true)`,
      [template.id]);
    return template.id;
  });
}

/** Insert a membership row directly, bypassing any service layer. */
function addMember(packVersionId, templateVersionId, addedBy = REVIEWER) {
  return withConn((conn) => query(conn,
    `INSERT INTO knowledge_pack_version_task_template_versions
       (knowledge_pack_version_id, task_template_version_id, added_by_user_id)
     VALUES (?, ?, ?) RETURNING id`,
    [packVersionId, templateVersionId, addedBy]).then((rows) => rows[0].id));
}

const removeMember = (membershipId) => withConn((conn) => query(conn,
  `DELETE FROM knowledge_pack_version_task_template_versions WHERE id = ?`, [membershipId]));

const countMembers = (packVersionId) => withConn((conn) => query(conn,
  `SELECT COUNT(*)::int AS n FROM knowledge_pack_version_task_template_versions WHERE knowledge_pack_version_id = ?`,
  [packVersionId]).then((rows) => rows[0].n));

describe('Knowledge Pack Membership', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  // ------------------------------------------------------- composable states
  describe('Membership may be composed before release', () => {
    for (const state of ['draft', 'under_review', 'approved']) {
      it(`allows INSERT while the pack version is ${state}`, async () => {
        const packVersionId = await createPackVersion(state);
        const { versionId } = await createPublishedTemplateVersion();

        const membershipId = await addMember(packVersionId, versionId);
        assert.ok(membershipId, 'expected a membership row id');
        assert.strictEqual(await countMembers(packVersionId), 1);
      });
    }

    it('allows DELETE while the pack version is not yet released', async () => {
      const packVersionId = await createPackVersion('under_review');
      const { versionId } = await createPublishedTemplateVersion();
      const membershipId = await addMember(packVersionId, versionId);

      await removeMember(membershipId);
      assert.strictEqual(await countMembers(packVersionId), 0);
    });
  });

  // --------------------------------------------------------- frozen on release
  describe('Membership is frozen once the pack version is released', () => {
    for (const state of ['published', 'superseded', 'retired']) {
      it(`rejects INSERT while the pack version is ${state}`, async () => {
        const packVersionId = await createPackVersion(state);
        const { versionId } = await createPublishedTemplateVersion();

        await assert.rejects(
          () => addMember(packVersionId, versionId),
          /membership is frozen|insufficient privilege/i,
          `a ${state} pack version must not gain members`
        );
        assert.strictEqual(await countMembers(packVersionId), 0);
      });
    }

    it('rejects DELETE after the pack version is published', async () => {
      // Compose while draft, then release, then attempt to remove the member.
      const packVersionId = await createPackVersion('draft');
      const { versionId } = await createPublishedTemplateVersion();
      const membershipId = await addMember(packVersionId, versionId);

      await withConn((conn) => query(conn,
        `UPDATE knowledge_pack_versions
            SET lifecycle_state = 'published', published_at = NOW(),
                reviewer_user_id = ?, reviewed_at = NOW(),
                approver_user_id = ?, approved_at = NOW(),
                published_by_user_id = ?
          WHERE id = ?`,
        [REVIEWER, APPROVER, PUBLISHER, packVersionId]));

      await assert.rejects(
        () => removeMember(membershipId),
        /membership is frozen|insufficient privilege/i,
        'a published pack version must not lose members'
      );
      assert.strictEqual(await countMembers(packVersionId), 1,
        'the member must still be present after the refused delete');
    });
  });

  // --------------------------------------------------------------- immutability
  describe('Membership is never retargeted', () => {
    it('rejects every UPDATE, including retargeting either foreign key', async () => {
      const packVersionId = await createPackVersion('draft');
      const otherPackVersionId = await createPackVersion('draft');
      const first = await createPublishedTemplateVersion();
      const second = await createPublishedTemplateVersion();
      const membershipId = await addMember(packVersionId, first.versionId);

      const attempts = {
        'retarget pack version': `UPDATE knowledge_pack_version_task_template_versions
           SET knowledge_pack_version_id = ${otherPackVersionId} WHERE id = ${membershipId}`,
        'retarget template version': `UPDATE knowledge_pack_version_task_template_versions
           SET task_template_version_id = ${second.versionId} WHERE id = ${membershipId}`,
        'rewrite attribution': `UPDATE knowledge_pack_version_task_template_versions
           SET added_by_user_id = ${APPROVER} WHERE id = ${membershipId}`,
        'rewrite timestamp': `UPDATE knowledge_pack_version_task_template_versions
           SET added_at = NOW() WHERE id = ${membershipId}`
      };

      for (const [label, sql] of Object.entries(attempts)) {
        await assert.rejects(
          () => withConn((conn) => query(conn, sql)),
          /immutable and cannot be updated|insufficient privilege/i,
          `expected UPDATE rejection for: ${label}`
        );
      }

      // The original row is untouched by every refused attempt.
      const rows = await withConn((conn) => query(conn,
        `SELECT knowledge_pack_version_id, task_template_version_id, added_by_user_id
           FROM knowledge_pack_version_task_template_versions WHERE id = ?`, [membershipId]));
      assert.strictEqual(Number(rows[0].knowledge_pack_version_id), packVersionId);
      assert.strictEqual(Number(rows[0].task_template_version_id), first.versionId);
      assert.strictEqual(Number(rows[0].added_by_user_id), REVIEWER);
    });
  });

  // -------------------------------------------------------- integrity and FKs
  describe('Referential integrity', () => {
    it('rejects duplicate membership of the same version in the same pack version', async () => {
      const packVersionId = await createPackVersion('draft');
      const { versionId } = await createPublishedTemplateVersion();
      await addMember(packVersionId, versionId);

      await assert.rejects(
        () => addMember(packVersionId, versionId),
        /unique|duplicate/i
      );
      assert.strictEqual(await countMembers(packVersionId), 1);
    });

    it('allows the same version in a different pack version', async () => {
      const { versionId } = await createPublishedTemplateVersion();
      const firstPackVersion = await createPackVersion('draft');
      const secondPackVersion = await createPackVersion('draft');

      await addMember(firstPackVersion, versionId);
      await addMember(secondPackVersion, versionId);
      assert.strictEqual(await countMembers(firstPackVersion), 1);
      assert.strictEqual(await countMembers(secondPackVersion), 1);
    });

    it('rejects a membership row whose pack version does not exist', async () => {
      const { versionId } = await createPublishedTemplateVersion();
      await assert.rejects(
        () => addMember(999999999, versionId),
        /foreign key|violates/i
      );
    });

    it('rejects a membership row whose task template version does not exist', async () => {
      const packVersionId = await createPackVersion('draft');
      await assert.rejects(
        () => addMember(packVersionId, 999999999),
        /foreign key|violates/i
      );
    });

    it('rejects a membership row whose added_by_user_id does not exist', async () => {
      const packVersionId = await createPackVersion('draft');
      const { versionId } = await createPublishedTemplateVersion();
      await assert.rejects(
        () => addMember(packVersionId, versionId, 999999999),
        /foreign key|violates/i
      );
    });

    it('cannot reference a mutable working template instead of an immutable version', async () => {
      // The FK targets task_template_versions only, so a working task_templates
      // id is not a valid member. This is what makes "membership points only at
      // immutable knowledge" structural rather than a convention.
      //
      // task_templates and task_template_versions use independent identity
      // sequences, so an arbitrary working id may coincidentally also be a
      // version id. This picks a working template whose id is NOT an existing
      // version id, so the rejection below can only be explained by the FK
      // targeting the version table.
      const packVersionId = await createPackVersion('draft');

      let candidateTemplateId = null;
      for (let attempt = 0; attempt < 20 && candidateTemplateId === null; attempt += 1) {
        const templateId = await createUnpublishedWorkingTemplate();
        const clash = await withConn((conn) => query(conn,
          `SELECT COUNT(*)::int AS n FROM task_template_versions WHERE id = ?`, [templateId]));
        if (clash[0].n === 0) candidateTemplateId = templateId;
      }
      assert.ok(candidateTemplateId,
        'could not obtain a working-template id with no corresponding version row');

      await assert.rejects(
        () => addMember(packVersionId, candidateTemplateId),
        /foreign key|violates/i,
        'a working template id must not be accepted as a pack member'
      );

      // Structural proof, independent of id collisions: the membership FK
      // targets the immutable version table, not the mutable working table.
      const fk = await withConn((conn) => query(conn, `
        SELECT ccu.table_name AS target
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
         WHERE tc.table_name = 'knowledge_pack_version_task_template_versions'
           AND tc.constraint_type = 'FOREIGN KEY'
           AND tc.constraint_name = 'fk_kpvtv_template_version'`));
      assert.strictEqual(fk[0].target, 'task_template_versions',
        'membership must reference immutable versions, never mutable working records');
    });
  });

  // ------------------------------------------------------------ delete safety
  describe('Delete protection', () => {
    it('ON DELETE RESTRICT prevents deleting a pack version that has members', async () => {
      const packVersionId = await createPackVersion('draft');
      const { versionId } = await createPublishedTemplateVersion();
      await addMember(packVersionId, versionId);

      await assert.rejects(
        () => withConn((conn) => query(conn,
          `DELETE FROM knowledge_pack_versions WHERE id = ?`, [packVersionId])),
        /foreign key|violates|restrict/i
      );

      const still = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM knowledge_pack_versions WHERE id = ?`, [packVersionId]));
      assert.strictEqual(still[0].n, 1, 'the pack version must survive the refused delete');
    });

    it('a referenced task template version stays protected by its existing immutability rules', async () => {
      const packVersionId = await createPackVersion('draft');
      const { versionId } = await createPublishedTemplateVersion();
      await addMember(packVersionId, versionId);

      await assert.rejects(
        () => withConn((conn) => query(conn,
          `DELETE FROM task_template_versions WHERE id = ?`, [versionId])),
        /cannot be deleted|insufficient privilege|immutable|violates/i
      );

      assert.strictEqual(await countMembers(packVersionId), 1,
        'membership must be intact after a refused version delete');
    });
  });

  // ---------------------------------------------------- historical stability
  describe('Historical pack contents do not drift', () => {
    it('editing the mutable working template does not alter the historical member', async () => {
      const packVersionId = await createPackVersion('draft');
      const { templateId, versionId } = await createPublishedTemplateVersion();
      await addMember(packVersionId, versionId);

      const before = await withConn((conn) => query(conn,
        `SELECT template_name FROM task_template_versions WHERE id = ?`, [versionId]));

      // Mutate the WORKING record and its working steps after publication.
      await withConn(async (conn) => {
        await query(conn, `UPDATE task_templates SET template_name = 'Renamed After Publication' WHERE id = ?`,
          [templateId]);
        await query(conn, `UPDATE task_template_steps SET instruction = 'Changed after publication'
          WHERE task_template_id = ?`, [templateId]);
      });

      const after = await withConn((conn) => query(conn,
        `SELECT template_name FROM task_template_versions WHERE id = ?`, [versionId]));
      assert.strictEqual(after[0].template_name, before[0].template_name,
        'the immutable version must not follow the working record');

      const workingName = await withConn((conn) => query(conn,
        `SELECT template_name FROM task_templates WHERE id = ?`, [templateId]));
      assert.strictEqual(workingName[0].template_name, 'Renamed After Publication',
        'the working record should actually have changed, so the assertion above is meaningful');
    });

    it('a released pack remains reproducible after working knowledge changes', async () => {
      const packVersionId = await createPackVersion('draft');
      const { templateId, versionId } = await createPublishedTemplateVersion();
      await addMember(packVersionId, versionId);
      await withConn((conn) => query(conn,
        `UPDATE knowledge_pack_versions
            SET lifecycle_state = 'published', published_at = NOW(),
                reviewer_user_id = ?, reviewed_at = NOW(),
                approver_user_id = ?, approved_at = NOW(),
                published_by_user_id = ?
          WHERE id = ?`,
        [REVIEWER, APPROVER, PUBLISHER, packVersionId]));

      const before = await withConn((conn) => query(conn,
        `SELECT m.task_template_version_id, v.template_name, v.lifecycle_state_at_publish
           FROM knowledge_pack_version_task_template_versions m
           JOIN task_template_versions v ON v.id = m.task_template_version_id
          WHERE m.knowledge_pack_version_id = ?`, [packVersionId]));

      await withConn(async (conn) => {
        await query(conn, `UPDATE task_templates SET template_name = 'Mutated', description = 'Mutated'
          WHERE id = ?`, [templateId]);
        await query(conn, `DELETE FROM task_template_steps WHERE task_template_id = ?`, [templateId]).catch(() => {});
      });

      const after = await withConn((conn) => query(conn,
        `SELECT m.task_template_version_id, v.template_name, v.lifecycle_state_at_publish
           FROM knowledge_pack_version_task_template_versions m
           JOIN task_template_versions v ON v.id = m.task_template_version_id
          WHERE m.knowledge_pack_version_id = ?`, [packVersionId]));

      assert.deepStrictEqual(
        after.map((r) => [Number(r.task_template_version_id), r.template_name, r.lifecycle_state_at_publish]),
        before.map((r) => [Number(r.task_template_version_id), r.template_name, r.lifecycle_state_at_publish]),
        'released pack contents must be reproducible from immutable versions alone'
      );
      assert.strictEqual(after.length, 1);
    });
  });

  // ------------------------------------------------------------ schema posture
  describe('Migration posture', () => {
    it('membership table carries the approved columns and no extra architecture', async () => {
      const columns = await withConn((conn) => query(conn,
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'knowledge_pack_version_task_template_versions'
          ORDER BY column_name`));
      const names = columns.map((c) => c.column_name).sort();

      assert.deepStrictEqual(names, [
        'added_at', 'added_by_user_id', 'id',
        'knowledge_pack_version_id', 'task_template_version_id'
      ], 'no item_type, no tenant field, no change_summary, no duplicated content');

      // The guard function and its triggers are what make the invariant real.
      const guard = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relname = 'knowledge_pack_version_task_template_versions'
            AND NOT t.tgisinternal`));
      assert.strictEqual(guard[0].n, 3, 'insert, update and delete guards must all be installed');
    });
  });
});
