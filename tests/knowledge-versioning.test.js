/**
 * Knowledge Versioning Foundation Tests
 * Verifies the core tables and immutability expectations
 * defined in ATM-013E.
 */

const { describe, it, before, afterEach } = require('node:test');
const assert = require('node:assert');
const { getConnection, pool, isIntegrationTest } = require('../src/config/database');
const taskTemplateController = require('../src/controllers/task-template.controller');

// Database safety gate.
// This suite performs destructive database mutations, so it must be gated on
// exactly the same predicate that src/config/database.js uses to choose
// credentials. `isIntegrationTest()` is what makes the pool read TEST_DB_* and
// refuse to fall back to the runtime DB_*/PG* credentials. Gating on anything
// weaker (for example RUN_DB_TESTS alone) would leave the pool pointed at the
// runtime database - production in a configured environment - while this suite
// still executed its mutations.
const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating knowledge-versioning suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'TEST_DB_* is used instead of runtime DB_*/PG* credentials; '
    + 'run it via `npm run test:integration`';

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function ensureTestUser(conn) {
  const [user] = await conn.query(`
    INSERT INTO users (username, email, password_hash, full_name, role, is_active)
    VALUES (
      'pub-user-' || floor(random() * 1000000000)::int::text,
      'pub-user-' || floor(random() * 1000000000)::int::text || '@test.local',
      'hash',
      'Test Publisher',
      'admin',
      true
    )
    RETURNING id
  `);
  return user;
}

// Disposable, deterministic tenants for the tenant-scoped provenance assertions.
// Atiman taxonomy is global reference data and organizations are NOT part of the
// knowledge migration, so this suite creates the minimum identity fixtures it
// needs using the CURRENT organizations schema (organization_name). No legacy
// ODM-CMMS organization or user is imported, and no per-tenant taxonomy concept
// is reproduced.
const TEST_ORGANIZATION_IDS = [990001, 990002];

// ATM-001 M1 — deterministic governance principals for the raw-SQL version
// fixtures below.
//
// A governed task_template_versions row must now carry a frozen publisher that
// is NOT the approver, so the fixtures cannot rely on "whatever user happens to
// exist": ordering-dependent principals would be equal to each other on a
// single-user database and would also drift between runs against a reused test
// database. Two named principals, seeded once and committed, make the
// attribution explicit and stable.
const GOVERNANCE_REVIEWER_USERNAME = 'kv-governance-reviewer';
const GOVERNANCE_PUBLISHER_USERNAME = 'kv-governance-publisher';

// Interpolated into the fixture SQL as ${GOVERNANCE_*_SQL} by the raw version
// INSERTs below, so a principal can never drift between the seed and its use.
const GOVERNANCE_REVIEWER_SQL = `(SELECT id FROM users WHERE username = '${GOVERNANCE_REVIEWER_USERNAME}')`;
const GOVERNANCE_PUBLISHER_SQL = `(SELECT id FROM users WHERE username = '${GOVERNANCE_PUBLISHER_USERNAME}')`;

async function ensureGovernancePrincipals() {
  const conn = await getConnection();
  try {
    for (const [username, fullName, role] of [
      [GOVERNANCE_REVIEWER_USERNAME, 'KV Governance Reviewer', 'supervisor'],
      [GOVERNANCE_PUBLISHER_USERNAME, 'KV Governance Publisher', 'admin']
    ]) {
      // Each placeholder is used for exactly one column: reusing one placeholder
      // for both a varchar column value and a concatenation operand makes
      // PostgreSQL deduce inconsistent parameter types and reject the statement.
      await conn.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
         VALUES ($1, $2, 'hash', $3, $4, true)
         ON CONFLICT (username) DO NOTHING`,
        [username, `${username}@test.local`, fullName, role]
      );
    }
    // Committed so every test transaction can see them and the FK cannot be
    // rolled back out from under a fixture.
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function ensureTestOrganizations() {
  const conn = await getConnection();
  try {
    for (const id of TEST_ORGANIZATION_IDS) {
      await conn.query(
        `INSERT INTO organizations (id, organization_name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [id, `Atiman Test Organization ${id}`]
      );
    }
    // Individual tests roll their own work back, so the fixture must be
    // committed to remain visible to them.
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

const isForbiddenError = (err) => {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('immutable') || msg.includes('cannot be') || msg.includes('insufficient privilege') || msg.includes('cannot be deleted');
};

const isUpdateForbiddenError = (err) => {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('immutable') || msg.includes('cannot be updated') || msg.includes('insufficient privilege');
};

const isSupersessionError = (err) => {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('supersede') || msg.includes('same knowledge_pack') || msg.includes('same task_template') || msg.includes('check_violation') || msg.includes('cycle') || msg.includes('must be published');
};

const isSealError = (err) => {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('seal') || msg.includes('cannot be changed') || msg.includes('must be sealed before commit') || msg.includes('check_violation');
};

async function nextTemplateVersion(conn, templateId) {
  const [row] = await conn.query(`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
    FROM task_template_versions
    WHERE task_template_id = $1
  `, [templateId]);
  return row.next_version;
}

async function createTestTemplate(conn) {
  const [category] = await conn.query(`
    INSERT INTO equipment_categories (category_code, category_name)
    VALUES ('TC' || floor(random() * 1000000000)::int::text, 'Test Category')
    RETURNING id
  `);
  const [cls] = await conn.query(`
    INSERT INTO equipment_classes (category_id, class_code, class_name)
    VALUES ($1, 'CL' || floor(random() * 1000000000)::int::text, 'Test Class')
    RETURNING id
  `, [category.id]);
  const [type] = await conn.query(`
    INSERT INTO equipment_types (class_id, type_code, type_name)
    VALUES ($1, 'TP' || floor(random() * 1000000000)::int::text, 'Test Type')
    RETURNING id
  `, [cls.id]);
  const [template] = await conn.query(`
    INSERT INTO task_templates (equipment_type_id, template_code, template_name, maintenance_type)
    VALUES ($1, 'TT' || floor(random() * 1000000000)::int::text, 'Test Template', 'corrective')
    RETURNING id, equipment_type_id
  `, [type.id]);
  return { ...template, _categoryId: category.id, _classId: cls.id, _typeId: type.id };
}

const isAncestryError = (err) => {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('does not belong to task_template_id') || msg.includes('check_violation');
};

describe('Knowledge Versioning Foundation', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureTestOrganizations();
    await ensureGovernancePrincipals();
  });

  it('creates required knowledge versioning tables', async () => {
    const tables = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'knowledge_packs',
          'knowledge_pack_versions',
          'task_template_versions',
          'task_template_step_versions'
        )
      ORDER BY table_name
    `);
    const names = tables.map(t => t.table_name);
    assert.ok(names.includes('knowledge_packs'));
    assert.ok(names.includes('knowledge_pack_versions'));
    assert.ok(names.includes('task_template_versions'));
    assert.ok(names.includes('task_template_step_versions'));
  });

  it('does not create deferred knowledge_pack_version_items table', async () => {
    const tables = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'knowledge_pack_version_items'
    `);
    assert.strictEqual(tables.length, 0, 'knowledge_pack_version_items should not exist yet');
  });

  it('task_template_versions has no knowledge_pack_version_id column', async () => {
    const cols = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'task_template_versions'
        AND column_name = 'knowledge_pack_version_id'
    `);
    assert.strictEqual(cols.length, 0, 'knowledge_pack_version_id column should not exist on task_template_versions');
  });

  it('enforces unique pack code on knowledge_packs', async () => {
    const constraints = await query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'knowledge_packs'::regclass
        AND contype = 'u'
    `);
    const names = constraints.map(c => c.conname);
    assert.ok(names.some(n => n.includes('knowledge_packs_pack_code')));
  });

  it('enforces unique pack/version on knowledge_pack_versions', async () => {
    const constraints = await query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'knowledge_pack_versions'::regclass
        AND contype = 'u'
    `);
    const names = constraints.map(c => c.conname);
    assert.ok(names.some(n => n.includes('knowledge_pack_versions_pack_version')));
  });

  it('enforces unique template/version on task_template_versions', async () => {
    const constraints = await query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'task_template_versions'::regclass
        AND contype = 'u'
    `);
    const names = constraints.map(c => c.conname);
    assert.ok(names.some(n => n.includes('task_template_versions_template_version')));
  });

  it('enforces unique step_no within a template version', async () => {
    const constraints = await query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'task_template_step_versions'::regclass
        AND contype = 'u'
    `);
    const names = constraints.map(c => c.conname);
    assert.ok(names.some(n => n.includes('task_template_step_versions_version_step_no')));
  });

  it('task_template_versions only accepts post-publication lifecycle states', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      assert.ok(template, 'Need at least one task_templates row');

      // published is valid
      const [valid] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Valid State', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);
      assert.ok(valid.id);

      // draft is invalid for a publication record
      let rejected = false;
      try {
        await conn.query(`
          INSERT INTO task_template_versions (
            task_template_id, version_number, equipment_type_id,
            template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
          VALUES ($1, 2, $2, 'Draft State', 'preventive', 'draft',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        `, [template.id, template.equipment_type_id]);
      } catch (err) {
        rejected = /check.*constraint|violates check constraint|new row.*violates/i.test(err.message || '');
      }
      assert.ok(rejected, 'draft lifecycle_state_at_publish should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('can insert and query a pack/version/template-version/step-version chain', async () => {
    const conn = await getConnection();
    try {
      const [packRow] = await conn.query(`
        INSERT INTO knowledge_packs (pack_code, pack_name)
        VALUES ('chain-test-pack', 'Chain Test Pack')
        RETURNING id
      `);
      const packId = packRow.id;

      const [packVersionRow] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state)
        VALUES ($1, '0.1.0', 'draft')
        RETURNING id
      `, [packId]);
      const packVersionId = packVersionRow.id;

      const template = await createTestTemplate(conn);
      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Chain step')
        RETURNING id
      `, [template.id]);

      assert.ok(template, 'Need at least one task_templates row');
      assert.ok(step, 'Need at least one task_template_steps row for that template');

      const [templateVersion] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Chain Test Template', 'preventive',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [stepVersion] = await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Chain test instruction')
        RETURNING id
      `, [templateVersion.id, step.id]);

      assert.ok(templateVersion.id > 0);
      assert.ok(stepVersion.id > 0);

      // Clean up: use rollback because step versions are always immutable.
      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks UPDATE of content columns on published knowledge_pack_versions', async () => {
    const conn = await getConnection();
    try {
      const [pack] = await conn.query(`
        INSERT INTO knowledge_packs (pack_code, pack_name)
        VALUES ('immutable-pack', 'Immutable Pack')
        RETURNING id
      `);

      const [packVersion] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '1.0.0', 'published', NOW())
        RETURNING id
      `, [pack.id]);

      let blocked = false;
      try {
        await conn.query(`
          UPDATE knowledge_pack_versions SET change_summary = 'tampered' WHERE id = $1
        `, [packVersion.id]);
      } catch (err) {
        blocked = isUpdateForbiddenError(err);
      }
      assert.ok(blocked, 'UPDATE of published pack version content should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks DELETE of published knowledge_pack_versions', async () => {
    const conn = await getConnection();
    try {
      const [pack] = await conn.query(`
        INSERT INTO knowledge_packs (pack_code, pack_name)
        VALUES ('delete-test-pack', 'Delete Test Pack')
        RETURNING id
      `);

      const [packVersion] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '1.0.0', 'published', NOW())
        RETURNING id
      `, [pack.id]);

      let blocked = false;
      try {
        await conn.query(`DELETE FROM knowledge_pack_versions WHERE id = $1`, [packVersion.id]);
      } catch (err) {
        blocked = isForbiddenError(err);
      }
      assert.ok(blocked, 'DELETE of published pack version should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('allows only supersession/retirement metadata transitions on published task_template_versions', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);

      const [templateVersionV1] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Transition Template v1', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [templateVersionV2] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 2, $2, 'Transition Template v2', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      // Allowed: supersede v1 with the later version of the same template.
      await conn.query(`
        UPDATE task_template_versions
        SET lifecycle_state_at_publish = 'superseded', superseded_by_version_id = $1
        WHERE id = $2
      `, [templateVersionV2.id, templateVersionV1.id]);

      // Once superseded, content changes remain blocked.
      let blocked = false;
      try {
        await conn.query(`
          UPDATE task_template_versions SET template_name = 'Tampered' WHERE id = $1
        `, [templateVersionV1.id]);
      } catch (err) {
        blocked = isUpdateForbiddenError(err);
      }
      assert.ok(blocked, 'UPDATE of superseded template version content should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects self-supersession for knowledge_pack_versions and task_template_versions', async () => {
    const conn = await getConnection();
    try {
      const [pack] = await conn.query(`
        INSERT INTO knowledge_packs (pack_code, pack_name)
        VALUES ('self-super-pack', 'Self Supersession Pack')
        RETURNING id
      `);
      const [packVersion] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '1.0.0', 'published', NOW())
        RETURNING id
      `, [pack.id]);

      let packBlocked = false;
      await conn.query('SAVEPOINT self_super_pack');
      try {
        await conn.query(`
          UPDATE knowledge_pack_versions
          SET superseded_by_version_id = $1
          WHERE id = $1
        `, [packVersion.id]);
      } catch (err) {
        packBlocked = isSupersessionError(err);
        await conn.query('ROLLBACK TO SAVEPOINT self_super_pack');
      }
      assert.ok(packBlocked, 'Self-supersession of pack version should be rejected');

      const template = await createTestTemplate(conn);
      const [templateVersion] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Self Super Template', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      let templateBlocked = false;
      await conn.query('SAVEPOINT self_super_template');
      try {
        await conn.query(`
          UPDATE task_template_versions
          SET superseded_by_version_id = $1
          WHERE id = $1
        `, [templateVersion.id]);
      } catch (err) {
        templateBlocked = isSupersessionError(err);
        await conn.query('ROLLBACK TO SAVEPOINT self_super_template');
      }
      assert.ok(templateBlocked, 'Self-supersession of template version should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('requires pack-version supersession to stay within the same pack', async () => {
    const conn = await getConnection();
    try {
      const [packA] = await conn.query(`
        INSERT INTO knowledge_packs (pack_code, pack_name)
        VALUES ('same-pack-a', 'Pack A')
        RETURNING id
      `);
      const [packB] = await conn.query(`
        INSERT INTO knowledge_packs (pack_code, pack_name)
        VALUES ('same-pack-b', 'Pack B')
        RETURNING id
      `);

      const [packVersionA] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '1.0.0', 'published', NOW())
        RETURNING id
      `, [packA.id]);

      const [packVersionB] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '1.0.0', 'published', NOW())
        RETURNING id
      `, [packB.id]);

      // Attempting to supersede pack version A with a version from pack B must fail.
      let blocked = false;
      await conn.query('SAVEPOINT cross_pack_test');
      try {
        await conn.query(`
          UPDATE knowledge_pack_versions
          SET superseded_by_version_id = $1, lifecycle_state = 'superseded'
          WHERE id = $2
        `, [packVersionB.id, packVersionA.id]);
      } catch (err) {
        blocked = isSupersessionError(err);
        await conn.query('ROLLBACK TO SAVEPOINT cross_pack_test');
      }
      assert.ok(blocked, 'Cross-pack supersession should be rejected');

      // Superseding A with a second version from the SAME pack should succeed.
      const [packVersionA2] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '2.0.0', 'published', NOW())
        RETURNING id
      `, [packA.id]);

      await conn.query(`
        UPDATE knowledge_pack_versions
        SET superseded_by_version_id = $1, lifecycle_state = 'superseded'
        WHERE id = $2
      `, [packVersionA2.id, packVersionA.id]);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('requires task-template-version supersession to stay within the same task template', async () => {
    const conn = await getConnection();
    try {
      const templateA = await createTestTemplate(conn);
      const templateB = await createTestTemplate(conn);
      assert.ok(templateB, 'Need at least two distinct task_templates rows');

      const [versionA1] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Template A v1', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [templateA.id, templateA.equipment_type_id]);

      const [versionB1] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Template B v1', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [templateB.id, templateB.equipment_type_id]);

      // Cross-template supersession must fail.
      let blocked = false;
      await conn.query('SAVEPOINT cross_template_test');
      try {
        await conn.query(`
          UPDATE task_template_versions
          SET superseded_by_version_id = $1, lifecycle_state_at_publish = 'superseded'
          WHERE id = $2
        `, [versionB1.id, versionA1.id]);
      } catch (err) {
        blocked = isSupersessionError(err);
        await conn.query('ROLLBACK TO SAVEPOINT cross_template_test');
      }
      assert.ok(blocked, 'Cross-template supersession should be rejected');

      // Same-template supersession must succeed.
      const [versionA2] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 2, $2, 'Template A v2', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [templateA.id, templateA.equipment_type_id]);

      await conn.query(`
        UPDATE task_template_versions
        SET superseded_by_version_id = $1, lifecycle_state_at_publish = 'superseded'
        WHERE id = $2
      `, [versionA2.id, versionA1.id]);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks UPDATE of task_template_step_versions', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [templateVersion] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Step Update Template', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);
      const [stepVersion] = await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Step to remain immutable')
        RETURNING id
      `, [templateVersion.id, step.id]);

      let blocked = false;
      try {
        await conn.query(`UPDATE task_template_step_versions SET instruction = 'changed' WHERE id = $1`, [stepVersion.id]);
      } catch (err) {
        blocked = isForbiddenError(err);
      }
      assert.ok(blocked, 'UPDATE of task_template_step_versions should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks DELETE of task_template_step_versions', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [templateVersion] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Step Delete Template', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);
      const [stepVersion] = await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Step to remain immutable')
        RETURNING id
      `, [templateVersion.id, step.id]);

      let blocked = false;
      try {
        await conn.query(`DELETE FROM task_template_step_versions WHERE id = $1`, [stepVersion.id]);
      } catch (err) {
        blocked = isForbiddenError(err);
      }
      assert.ok(blocked, 'DELETE of task_template_step_versions should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });
  it('seals published template step sets and blocks later step changes', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [templateVersion] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Sealed Step Set Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);

      const [stepVersion] = await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Step to be sealed')
        RETURNING id
      `, [templateVersion.id, step.id]);

      // Seal the step set.
      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [templateVersion.id]);

      // INSERT blocked
      let blockedInsert = false;
      await conn.query('SAVEPOINT seal_insert_test');
      try {
        await conn.query(`
          INSERT INTO task_template_step_versions (
            task_template_version_id, step_no, task_template_step_id, step_type, instruction
          )
          VALUES ($1, 2, $2, 'instruction', 'Should not be added')
        `, [templateVersion.id, step.id]);
      } catch (err) {
        blockedInsert = isForbiddenError(err);
        await conn.query('ROLLBACK TO SAVEPOINT seal_insert_test');
      }
      assert.ok(blockedInsert, 'INSERT into sealed step set should be blocked');

      // UPDATE blocked
      let blockedUpdate = false;
      await conn.query('SAVEPOINT seal_update_test');
      try {
        await conn.query(`UPDATE task_template_step_versions SET instruction = 'changed' WHERE id = $1`, [stepVersion.id]);
      } catch (err) {
        blockedUpdate = isForbiddenError(err);
        await conn.query('ROLLBACK TO SAVEPOINT seal_update_test');
      }
      assert.ok(blockedUpdate, 'UPDATE of sealed step set should be blocked');

      // DELETE blocked
      let blockedDelete = false;
      await conn.query('SAVEPOINT seal_delete_test');
      try {
        await conn.query(`DELETE FROM task_template_step_versions WHERE id = $1`, [stepVersion.id]);
      } catch (err) {
        blockedDelete = isForbiddenError(err);
        await conn.query('ROLLBACK TO SAVEPOINT seal_delete_test');
      }
      assert.ok(blockedDelete, 'DELETE from sealed step set should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('allows step set assembly before sealing', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [templateVersion] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Unsealed Step Set Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);

      const [stepVersion] = await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Step before seal')
        RETURNING id
      `, [templateVersion.id, step.id]);

      assert.ok(stepVersion.id > 0);

      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [templateVersion.id]);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('requires successor to be a valid published version', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);

      const [v1] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Successor Valid v1', 'preventive', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [v2Retired] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 2, $2, 'Successor Retired', 'preventive', 'retired',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      // Attempting to supersede v1 with a retired version should fail.
      let blocked = false;
      await conn.query('SAVEPOINT retired_successor_test');
      try {
        await conn.query(`
          UPDATE task_template_versions
          SET superseded_by_version_id = $1
          WHERE id = $2
        `, [v2Retired.id, v1.id]);
      } catch (err) {
        blocked = isSupersessionError(err) || /successor.*must be published/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT retired_successor_test');
      }
      assert.ok(blocked, 'Supersession by a retired successor should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('requires superseded state to have a successor', async () => {
    const conn = await getConnection();
    try {
      const [pack] = await conn.query(`
        INSERT INTO knowledge_packs (pack_code, pack_name)
        VALUES ('orphan-super-pack', 'Orphan Supersession Pack')
        RETURNING id
      `);
      const [packVersion] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '1.0.0', 'published', NOW())
        RETURNING id
      `, [pack.id]);

      let blocked = false;
      await conn.query('SAVEPOINT orphan_super_test');
      try {
        await conn.query(`
          UPDATE knowledge_pack_versions
          SET lifecycle_state = 'superseded'
          WHERE id = $1
        `, [packVersion.id]);
      } catch (err) {
        blocked = isSupersessionError(err) || /must specify superseded_by_version_id/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT orphan_super_test');
      }
      assert.ok(blocked, 'Superseded state without successor should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });


  it('rejects unsealing a sealed task_template_version', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [version] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Unseal Test Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);
      await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Step to seal')
      `, [version.id, step.id]);

      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [version.id]);

      let blocked = false;
      await conn.query('SAVEPOINT unseal_test');
      try {
        await conn.query(`
          UPDATE task_template_versions SET is_step_set_sealed = FALSE WHERE id = $1
        `, [version.id]);
      } catch (err) {
        blocked = isSealError(err);
        await conn.query('ROLLBACK TO SAVEPOINT unseal_test');
      }
      assert.ok(blocked, 'Unsealing a sealed template version should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects sealing a task_template_version with zero steps', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [version] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Zero Step Seal Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      let blocked = false;
      await conn.query('SAVEPOINT zero_seal_test');
      try {
        await conn.query(`
          UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
        `, [version.id]);
      } catch (err) {
        blocked = isSealError(err);
        await conn.query('ROLLBACK TO SAVEPOINT zero_seal_test');
      }
      assert.ok(blocked, 'Sealing a template version with zero steps should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects committing a published task_template_version with an unsealed step set', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Unsealed Commit Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
      `, [template.id, template.equipment_type_id]);

      let blocked = false;
      try {
        // Force the deferred seal check to run before commit.
        await conn.query('SET CONSTRAINTS ALL IMMEDIATE');
      } catch (err) {
        blocked = /must be sealed before commit|check_violation/i.test(err.message || '');
      }
      assert.ok(blocked, 'Committing an unsealed published template version should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('allows assemble -> seal -> commit for a task_template_version', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [version] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Assemble Seal Commit Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);
      await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Assembled step')
      `, [version.id, step.id]);

      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [version.id]);

      // Simulate commit-time deferred seal check without persisting test data.
      let ok = false;
      try {
        await conn.query('SET CONSTRAINTS ALL IMMEDIATE');
        ok = true;
      } catch (err) {
        ok = false;
      }
      assert.ok(ok, 'Assemble -> seal -> commit should satisfy the deferred seal check');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks inserting a step after the step set is sealed', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [version] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Post-Seal Insert Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);
      await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Pre-seal step')
      `, [version.id, step.id]);

      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [version.id]);

      let blocked = false;
      await conn.query('SAVEPOINT post_seal_insert_test');
      try {
        await conn.query(`
          INSERT INTO task_template_step_versions (
            task_template_version_id, step_no, task_template_step_id, step_type, instruction
          )
          VALUES ($1, 2, $2, 'instruction', 'Should not be added')
        `, [version.id, step.id]);
      } catch (err) {
        blocked = isForbiddenError(err);
        await conn.query('ROLLBACK TO SAVEPOINT post_seal_insert_test');
      }
      assert.ok(blocked, 'INSERT into a sealed step set should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('allows v1 -> v2 -> v3 supersession chain for knowledge_pack_versions', async () => {
    const conn = await getConnection();
    try {
      const [pack] = await conn.query(`
        INSERT INTO knowledge_packs (pack_code, pack_name)
        VALUES ('chain-pack', 'Chain Pack')
        RETURNING id
      `);

      const [v1] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '1.0.0', 'published', NOW())
        RETURNING id
      `, [pack.id]);

      const [v2] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '2.0.0', 'published', NOW())
        RETURNING id
      `, [pack.id]);

      const [v3] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '3.0.0', 'published', NOW())
        RETURNING id
      `, [pack.id]);

      await conn.query(`
        UPDATE knowledge_pack_versions
        SET superseded_by_version_id = $1
        WHERE id = $2
      `, [v2.id, v1.id]);

      await conn.query(`
        UPDATE knowledge_pack_versions
        SET superseded_by_version_id = $1
        WHERE id = $2
      `, [v3.id, v2.id]);

      const rows = await conn.query(`
        SELECT id, lifecycle_state FROM knowledge_pack_versions
        WHERE id IN ($1, $2, $3)
        ORDER BY id
      `, [v1.id, v2.id, v3.id]);

      assert.strictEqual(rows.find(r => r.id === v1.id).lifecycle_state, 'superseded');
      assert.strictEqual(rows.find(r => r.id === v2.id).lifecycle_state, 'superseded');
      assert.strictEqual(rows.find(r => r.id === v3.id).lifecycle_state, 'published');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects back-link supersession cycles for knowledge_pack_versions', async () => {
    const conn = await getConnection();
    try {
      const [pack] = await conn.query(`
        INSERT INTO knowledge_packs (pack_code, pack_name)
        VALUES ('backlink-pack', 'Backlink Pack')
        RETURNING id
      `);

      const [v1] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '1.0.0', 'published', NOW())
        RETURNING id
      `, [pack.id]);

      const [v2] = await conn.query(`
        INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, published_at)
        VALUES ($1, '2.0.0', 'published', NOW())
        RETURNING id
      `, [pack.id]);

      await conn.query(`
        UPDATE knowledge_pack_versions
        SET superseded_by_version_id = $1
        WHERE id = $2
      `, [v2.id, v1.id]);

      let blocked = false;
      await conn.query('SAVEPOINT backlink_pack_test');
      try {
        await conn.query(`
          UPDATE knowledge_pack_versions
          SET superseded_by_version_id = $1
          WHERE id = $2
        `, [v1.id, v2.id]);
      } catch (err) {
        blocked = isSupersessionError(err);
        await conn.query('ROLLBACK TO SAVEPOINT backlink_pack_test');
      }
      assert.ok(blocked, 'Back-link supersession v2 -> v1 should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('allows v1 -> v2 -> v3 supersession chain for task_template_versions', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);

      const [v1] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Chain v1', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [v2] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 2, $2, 'Chain v2', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [v3] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 3, $2, 'Chain v3', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      await conn.query(`
        UPDATE task_template_versions
        SET superseded_by_version_id = $1
        WHERE id = $2
      `, [v2.id, v1.id]);

      await conn.query(`
        UPDATE task_template_versions
        SET superseded_by_version_id = $1
        WHERE id = $2
      `, [v3.id, v2.id]);

      const rows = await conn.query(`
        SELECT id, lifecycle_state_at_publish FROM task_template_versions
        WHERE id IN ($1, $2, $3)
        ORDER BY id
      `, [v1.id, v2.id, v3.id]);

      assert.strictEqual(rows.find(r => r.id === v1.id).lifecycle_state_at_publish, 'superseded');
      assert.strictEqual(rows.find(r => r.id === v2.id).lifecycle_state_at_publish, 'superseded');
      assert.strictEqual(rows.find(r => r.id === v3.id).lifecycle_state_at_publish, 'published');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects back-link supersession cycles for task_template_versions', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);

      const [v1] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Backlink v1', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [v2] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 2, $2, 'Backlink v2', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      await conn.query(`
        UPDATE task_template_versions
        SET superseded_by_version_id = $1
        WHERE id = $2
      `, [v2.id, v1.id]);

      let blocked = false;
      await conn.query('SAVEPOINT backlink_template_test');
      try {
        await conn.query(`
          UPDATE task_template_versions
          SET superseded_by_version_id = $1
          WHERE id = $2
        `, [v1.id, v2.id]);
      } catch (err) {
        blocked = isSupersessionError(err);
        await conn.query('ROLLBACK TO SAVEPOINT backlink_template_test');
      }
      assert.ok(blocked, 'Back-link supersession v2 -> v1 should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });


  it('rejects committing a retired task_template_version with an unsealed step set', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Unsealed Retired Template', 'preventive', 'retired', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
      `, [template.id, template.equipment_type_id]);

      let blocked = false;
      try {
        await conn.query('SET CONSTRAINTS ALL IMMEDIATE');
      } catch (err) {
        blocked = /must be sealed before commit|check_violation/i.test(err.message || '');
      }
      assert.ok(blocked, 'Committing a retired unsealed template version should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects committing a superseded task_template_version with an unsealed step set', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);

      const [v1] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Unsealed Superseded Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [v2] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 2, $2, 'Successor Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      // v2 must be sealed because every committed version requires it.
      // We need at least one step for v2 before sealing.
      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);
      await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Successor step')
      `, [v2.id, step.id]);

      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [v2.id]);

      // This will coerce v1 to superseded.
      await conn.query(`
        UPDATE task_template_versions
        SET superseded_by_version_id = $1
        WHERE id = $2
      `, [v2.id, v1.id]);

      let blocked = false;
      try {
        await conn.query('SET CONSTRAINTS ALL IMMEDIATE');
      } catch (err) {
        blocked = /must be sealed before commit|check_violation/i.test(err.message || '');
      }
      assert.ok(blocked, 'Committing a superseded unsealed template version should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects task_template_step_versions whose source step belongs to a different template', async () => {
    const conn = await getConnection();
    try {
      const templateA = await createTestTemplate(conn);
      const templateB = await createTestTemplate(conn);
      assert.ok(templateB, 'Need at least two distinct task_templates rows');

      const [versionA] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Ancestry Template A', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [templateA.id, templateA.equipment_type_id]);

      const [stepB] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Template B step')
        RETURNING id
      `, [templateB.id]);
      assert.ok(stepB, 'Need at least one step for template B');

      let blocked = false;
      await conn.query('SAVEPOINT ancestry_test');
      try {
        await conn.query(`
          INSERT INTO task_template_step_versions (
            task_template_version_id, step_no, task_template_step_id, step_type, instruction
          )
          VALUES ($1, 1, $2, 'instruction', 'Step from wrong template')
        `, [versionA.id, stepB.id]);
      } catch (err) {
        blocked = isAncestryError(err);
        await conn.query('ROLLBACK TO SAVEPOINT ancestry_test');
      }
      assert.ok(blocked, 'Source step from a different template should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });


  it('creates required knowledge provenance tables', async () => {
    const tables = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'knowledge_sources',
          'knowledge_source_versions',
          'knowledge_template_evidence',
          'knowledge_template_version_evidence'
        )
      ORDER BY table_name
    `);
    const names = tables.map(t => t.table_name);
    assert.ok(names.includes('knowledge_sources'));
    assert.ok(names.includes('knowledge_source_versions'));
    assert.ok(names.includes('knowledge_template_evidence'));
    assert.ok(names.includes('knowledge_template_version_evidence'));
  });

  it('enforces tenant/global scoped uniqueness on knowledge_sources', async () => {
    const conn = await getConnection();
    try {
      // Global source with NULL organization_id
      const [global1] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title)
        VALUES ('global-manual', 'manufacturer_manual', 'Global Manual')
        RETURNING id
      `);
      assert.ok(global1.id > 0);

      // Same code from the same (NULL) scope must fail.
      let blocked = false;
      await conn.query('SAVEPOINT source_dup_global');
      try {
        await conn.query(`
          INSERT INTO knowledge_sources (source_code, source_category, default_title)
          VALUES ('global-manual', 'engineering_standard', 'Another Global Manual')
        `);
      } catch (err) {
        blocked = /unique|duplicate|violates/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT source_dup_global');
      }
      assert.ok(blocked, 'Duplicate global source_code should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('enforces exact version uniqueness on knowledge_source_versions', async () => {
    const conn = await getConnection();
    try {
      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title)
        VALUES ('versioned-std', 'engineering_standard', 'Versioned Standard')
        RETURNING id
      `);

      const [v1] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, '2023 Edition', 'Versioned Standard 2023')
        RETURNING id
      `, [source.id]);
      assert.ok(v1.id > 0);

      let blocked = false;
      await conn.query('SAVEPOINT source_version_dup');
      try {
        await conn.query(`
          INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
          VALUES ($1, '2023 Edition', 'Duplicate Version')
        `, [source.id]);
      } catch (err) {
        blocked = /unique|duplicate|violates/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT source_version_dup');
      }
      assert.ok(blocked, 'Duplicate source version_designation should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks UPDATE of knowledge_source_versions', async () => {
    const conn = await getConnection();
    try {
      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title)
        VALUES ('immutable-source', 'manufacturer_manual', 'Immutable Source')
        RETURNING id
      `);

      const [version] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, 'Rev A', 'Immutable Rev A')
        RETURNING id
      `, [source.id]);

      let blocked = false;
      await conn.query('SAVEPOINT source_version_update');
      try {
        await conn.query(`
          UPDATE knowledge_source_versions SET title = 'Tampered' WHERE id = $1
        `, [version.id]);
      } catch (err) {
        blocked = isForbiddenError(err);
        await conn.query('ROLLBACK TO SAVEPOINT source_version_update');
      }
      assert.ok(blocked, 'UPDATE of knowledge_source_versions should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks DELETE of referenced knowledge_source_versions', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title)
        VALUES ('referenced-source', 'manufacturer_manual', 'Referenced Source')
        RETURNING id
      `);
      const [version] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, 'Rev 1', 'Referenced Rev 1')
        RETURNING id
      `, [source.id]);

      await conn.query(`
        INSERT INTO knowledge_template_evidence (
          task_template_id, knowledge_source_version_id, confidence_level, supporting_role
        ) VALUES ($1, $2, 'established', 'primary')
      `, [template.id, version.id]);

      let blocked = false;
      await conn.query('SAVEPOINT source_version_delete');
      try {
        await conn.query(`DELETE FROM knowledge_source_versions WHERE id = $1`, [version.id]);
      } catch (err) {
        blocked = isForbiddenError(err) || /referenced by evidence|foreign key/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT source_version_delete');
      }
      assert.ok(blocked, 'DELETE of referenced knowledge_source_versions should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('enforces exactly-one subject on knowledge_template_evidence', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);
      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title)
        VALUES ('exactly-one-source', 'engineering_standard', 'Exactly One Source')
        RETURNING id
      `);
      const [version] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, '1.0', 'Exactly One Version')
        RETURNING id
      `, [source.id]);

      let blockedBoth = false;
      await conn.query('SAVEPOINT evidence_both_subjects');
      try {
        await conn.query(`
          INSERT INTO knowledge_template_evidence (
            task_template_id, task_template_step_id, knowledge_source_version_id
          ) VALUES ($1, $2, $3)
        `, [template.id, step.id, version.id]);
      } catch (err) {
        blockedBoth = /check.*constraint|violates check constraint/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT evidence_both_subjects');
      }
      assert.ok(blockedBoth, 'Evidence linking both template and step should be rejected');

      let blockedNeither = false;
      await conn.query('SAVEPOINT evidence_neither_subject');
      try {
        await conn.query(`
          INSERT INTO knowledge_template_evidence (
            task_template_id, task_template_step_id, knowledge_source_version_id
          ) VALUES (NULL, NULL, $1)
        `, [version.id]);
      } catch (err) {
        blockedNeither = /check.*constraint|violates check constraint|null value in column/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT evidence_neither_subject');
      }
      assert.ok(blockedNeither, 'Evidence with no subject should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('allows UPDATE of knowledge_template_evidence and blocks UPDATE of frozen version evidence', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);
      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title)
        VALUES ('frozen-ev-source', 'manufacturer_manual', 'Frozen Evidence Source')
        RETURNING id
      `);
      const [version] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, 'Rev 1', 'Frozen Evidence Rev 1')
        RETURNING id
      `, [source.id]);

      const [evidence] = await conn.query(`
        INSERT INTO knowledge_template_evidence (
          task_template_id, knowledge_source_version_id, confidence_level, supporting_role
        ) VALUES ($1, $2, 'provisional', 'supporting')
        RETURNING id
      `, [template.id, version.id]);

      // Working evidence is editable.
      await conn.query(`
        UPDATE knowledge_template_evidence
        SET derivation_notes = 'Updated working note'
        WHERE id = $1
      `, [evidence.id]);

      // Create a published template version with one step version so we can attach frozen evidence.
      const [templateVersion] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Frozen Evidence Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      const [stepVersion] = await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Frozen evidence step')
        RETURNING id
      `, [templateVersion.id, step.id]);

      // Frozen evidence must be inserted while the parent version is still unsealed.
      const [frozenEvidence] = await conn.query(`
        INSERT INTO knowledge_template_version_evidence (
          task_template_version_id, knowledge_source_version_id, confidence_level, supporting_role
        ) VALUES ($1, $2, 'established', 'primary')
        RETURNING id
      `, [templateVersion.id, version.id]);

      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [templateVersion.id]);

      // Frozen evidence must not be updated.
      let blockedUpdate = false;
      await conn.query('SAVEPOINT frozen_evidence_update');
      try {
        await conn.query(`
          UPDATE knowledge_template_version_evidence
          SET derivation_notes = 'Tampered'
          WHERE id = $1
        `, [frozenEvidence.id]);
      } catch (err) {
        blockedUpdate = isForbiddenError(err);
        await conn.query('ROLLBACK TO SAVEPOINT frozen_evidence_update');
      }
      assert.ok(blockedUpdate, 'UPDATE of frozen version evidence should be blocked');

      // Frozen evidence must not be deleted.
      let blockedDelete = false;
      await conn.query('SAVEPOINT frozen_evidence_delete');
      try {
        await conn.query(`DELETE FROM knowledge_template_version_evidence WHERE id = $1`, [frozenEvidence.id]);
      } catch (err) {
        blockedDelete = isForbiddenError(err);
        await conn.query('ROLLBACK TO SAVEPOINT frozen_evidence_delete');
      }
      assert.ok(blockedDelete, 'DELETE of frozen version evidence should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });



  it('allows frozen evidence INSERT before seal and blocks after seal', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);

      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('frozen-seal-source', 'manufacturer_manual', 'Frozen Seal Source', $1)
        RETURNING id
      `, [template.organization_id]);

      const [version] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, 'Rev 1', 'Frozen Seal Rev 1')
        RETURNING id
      `, [source.id]);

      const [templateVersion] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Frozen Seal Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      // Insert frozen template-version evidence while unsealed must succeed.
      await conn.query(`
        INSERT INTO knowledge_template_version_evidence (
          task_template_version_id, knowledge_source_version_id, confidence_level, supporting_role
        ) VALUES ($1, $2, 'established', 'primary')
      `, [templateVersion.id, version.id]);

      const [stepVersion] = await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Frozen seal step')
        RETURNING id
      `, [templateVersion.id, step.id]);

      // Insert frozen step-version evidence while unsealed must succeed.
      await conn.query(`
        INSERT INTO knowledge_template_version_evidence (
          task_template_step_version_id, knowledge_source_version_id, confidence_level, supporting_role
        ) VALUES ($1, $2, 'established', 'supporting')
      `, [stepVersion.id, version.id]);

      // Seal the version.
      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [templateVersion.id]);

      // After seal, INSERT into frozen evidence must fail.
      let blockedTemplate = false;
      await conn.query('SAVEPOINT frozen_insert_after_seal_template');
      try {
        await conn.query(`
          INSERT INTO knowledge_template_version_evidence (
            task_template_version_id, knowledge_source_version_id, confidence_level, supporting_role
          ) VALUES ($1, $2, 'provisional', 'supporting')
        `, [templateVersion.id, version.id]);
      } catch (err) {
        blockedTemplate = /cannot insert.*sealed|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT frozen_insert_after_seal_template');
      }
      assert.ok(blockedTemplate, 'INSERT into frozen template-version evidence after seal should fail');

      let blockedStep = false;
      await conn.query('SAVEPOINT frozen_insert_after_seal_step');
      try {
        await conn.query(`
          INSERT INTO knowledge_template_version_evidence (
            task_template_step_version_id, knowledge_source_version_id, confidence_level, supporting_role
          ) VALUES ($1, $2, 'provisional', 'supporting')
        `, [stepVersion.id, version.id]);
      } catch (err) {
        blockedStep = /cannot insert.*sealed|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT frozen_insert_after_seal_step');
      }
      assert.ok(blockedStep, 'INSERT into frozen step-version evidence after seal should fail');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('allows global source to support tenant template', async () => {
    const conn = await getConnection();
    try {
      const [org] = await conn.query(`SELECT id FROM organizations ORDER BY id LIMIT 1`);
      assert.ok(org, 'Need an organization');
      const baseTemplate = await createTestTemplate(conn);

      const [template] = await conn.query(`
        INSERT INTO task_templates (
          equipment_type_id, template_name, maintenance_type, task_kind, organization_id, created_by
        )
        VALUES ($1, 'Global Source Tenant Template', 'preventive', 'inspection', $2, NULL)
        RETURNING id, organization_id, equipment_type_id
      `, [baseTemplate.equipment_type_id, org.id]);

      const [globalSource] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('global-scope-source', 'engineering_standard', 'Global Scope Source', NULL)
        RETURNING id
      `);

      const [globalVersion] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, '1.0', 'Global Scope Version')
        RETURNING id
      `, [globalSource.id]);

      const [evidence] = await conn.query(`
        INSERT INTO knowledge_template_evidence (
          task_template_id, knowledge_source_version_id, confidence_level, supporting_role
        ) VALUES ($1, $2, 'established', 'primary')
        RETURNING id
      `, [template.id, globalVersion.id]);

      assert.ok(evidence.id > 0);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects cross-tenant source association', async () => {
    const conn = await getConnection();
    try {
      const [orgA] = await conn.query(`SELECT id FROM organizations ORDER BY id LIMIT 1`);
      const [orgB] = await conn.query(`SELECT id FROM organizations ORDER BY id OFFSET 1 LIMIT 1`);
      assert.ok(orgA && orgB, 'Need two organizations');
      const baseTemplate = await createTestTemplate(conn);

      const [templateA] = await conn.query(`
        INSERT INTO task_templates (
          equipment_type_id, template_name, maintenance_type, task_kind, organization_id, created_by
        )
        VALUES ($1, 'Tenant A Template', 'preventive', 'inspection', $2, NULL)
        RETURNING id, organization_id, equipment_type_id
      `, [baseTemplate.equipment_type_id, orgA.id]);

      const [templateB] = await conn.query(`
        INSERT INTO task_templates (
          equipment_type_id, template_name, maintenance_type, task_kind, organization_id, created_by
        )
        VALUES ($1, 'Tenant B Template', 'preventive', 'inspection', $2, NULL)
        RETURNING id, organization_id
      `, [baseTemplate.equipment_type_id, orgB.id]);

      const [tenantSource] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('tenant-a-source', 'manufacturer_manual', 'Tenant A Source', $1)
        RETURNING id
      `, [templateA.organization_id]);

      const [tenantVersion] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, '1.0', 'Tenant A Version')
        RETURNING id
      `, [tenantSource.id]);

      let blocked = false;
      await conn.query('SAVEPOINT cross_tenant_source');
      try {
        await conn.query(`
          INSERT INTO knowledge_template_evidence (
            task_template_id, knowledge_source_version_id, confidence_level, supporting_role
          ) VALUES ($1, $2, 'established', 'primary')
        `, [templateB.id, tenantVersion.id]);
      } catch (err) {
        blocked = /tenant scope does not match|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT cross_tenant_source');
      }
      assert.ok(blocked, 'Cross-tenant source association should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects tenant source supporting global template', async () => {
    const conn = await getConnection();
    try {
      const baseTemplate = await createTestTemplate(conn);

      const [globalTemplate] = await conn.query(`
        INSERT INTO task_templates (
          equipment_type_id, template_name, maintenance_type, task_kind, organization_id, created_by
        )
        VALUES ($1, 'Global Template For Tenant Source', 'preventive', 'inspection', NULL, NULL)
        RETURNING id, organization_id
      `, [baseTemplate.equipment_type_id]);
      assert.ok(globalTemplate, 'Need a global task_template');

      const [org] = await conn.query(`SELECT id FROM organizations ORDER BY id LIMIT 1`);
      assert.ok(org, 'Need an organization for the source');

      const [tenantSource] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('tenant-global-source', 'manufacturer_manual', 'Tenant Global Source', $1)
        RETURNING id
      `, [org.id]);

      const [tenantVersion] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, '1.0', 'Tenant Global Version')
        RETURNING id
      `, [tenantSource.id]);

      let blocked = false;
      await conn.query('SAVEPOINT tenant_to_global');
      try {
        await conn.query(`
          INSERT INTO knowledge_template_evidence (
            task_template_id, knowledge_source_version_id, confidence_level, supporting_role
          ) VALUES ($1, $2, 'established', 'primary')
        `, [globalTemplate.id, tenantVersion.id]);
      } catch (err) {
        blocked = /tenant scope does not match|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT tenant_to_global');
      }
      assert.ok(blocked, 'Tenant source supporting global template should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks source organization change after source versions exist', async () => {
    const conn = await getConnection();
    try {
      const [org] = await conn.query(`SELECT id FROM organizations ORDER BY id LIMIT 1`);
      assert.ok(org, 'Need an organization for the source');

      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('scope-lock-source', 'manufacturer_manual', 'Scope Lock Source', $1)
        RETURNING id
      `, [org.id]);

      // Create a version to lock the scope.
      await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, '1.0', 'Scope Lock Version')
      `, [source.id]);

      let blocked = false;
      await conn.query('SAVEPOINT source_scope_change');
      try {
        await conn.query(`
          UPDATE knowledge_sources SET organization_id = NULL WHERE id = $1
        `, [source.id]);
      } catch (err) {
        blocked = /cannot change after source versions exist|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT source_scope_change');
      }
      assert.ok(blocked, 'Changing source organization_id after versions exist should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks deleting uploaded_file referenced by knowledge_source_versions', async () => {
    const conn = await getConnection();
    try {
      const [org] = await conn.query(`SELECT id FROM organizations ORDER BY id LIMIT 1`);
      assert.ok(org, 'Need an organization for source and uploaded file');

      const [file] = await conn.query(`
        INSERT INTO uploaded_files (organization_id, file_name, original_name, file_path)
        VALUES ($1, 'provenance-ref.pdf', 'provenance-ref.pdf', '/uploads/provenance-ref.pdf')
        RETURNING id
      `, [org.id]);

      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('file-ref-source', 'manufacturer_manual', 'File Ref Source', $1)
        RETURNING id
      `, [org.id]);

      await conn.query(`
        INSERT INTO knowledge_source_versions (
          knowledge_source_id, version_designation, title, uploaded_file_id
        ) VALUES ($1, '1.0', 'File Ref Version', $2)
      `, [source.id, file.id]);

      let blocked = false;
      await conn.query('SAVEPOINT delete_referenced_file');
      try {
        await conn.query(`DELETE FROM uploaded_files WHERE id = $1`, [file.id]);
      } catch (err) {
        blocked = /foreign key|references|restrict/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT delete_referenced_file');
      }
      assert.ok(blocked, 'Deleting uploaded_file referenced by knowledge_source_versions should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });



  it('allows same-tenant uploaded file and rejects cross-tenant file', async () => {
    const conn = await getConnection();
    try {
      const [orgA] = await conn.query(`SELECT id FROM organizations ORDER BY id LIMIT 1`);
      const [orgB] = await conn.query(`SELECT id FROM organizations ORDER BY id OFFSET 1 LIMIT 1`);
      assert.ok(orgA && orgB, 'Need two organizations');

      const [fileA] = await conn.query(`
        INSERT INTO uploaded_files (organization_id, file_name, original_name, file_path)
        VALUES ($1, 'tenant-a.pdf', 'tenant-a.pdf', '/uploads/tenant-a.pdf')
        RETURNING id
      `, [orgA.id]);

      const [fileB] = await conn.query(`
        INSERT INTO uploaded_files (organization_id, file_name, original_name, file_path)
        VALUES ($1, 'tenant-b.pdf', 'tenant-b.pdf', '/uploads/tenant-b.pdf')
        RETURNING id
      `, [orgB.id]);

      // Tenant source with same-tenant file succeeds.
      const [tenantSource] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('tenant-file-source', 'manufacturer_manual', 'Tenant File Source', $1)
        RETURNING id
      `, [orgA.id]);

      const [versionOk] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title, uploaded_file_id)
        VALUES ($1, '1.0', 'Tenant File Version', $2)
        RETURNING id
      `, [tenantSource.id, fileA.id]);
      assert.ok(versionOk.id > 0);

      // Tenant source with cross-tenant file fails.
      let blockedCross = false;
      await conn.query('SAVEPOINT source_version_cross_file');
      try {
        await conn.query(`
          INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title, uploaded_file_id)
          VALUES ($1, '2.0', 'Cross Tenant File Version', $2)
        `, [tenantSource.id, fileB.id]);
      } catch (err) {
        blockedCross = /tenant scope does not match|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT source_version_cross_file');
      }
      assert.ok(blockedCross, 'Tenant source referencing cross-tenant uploaded_file should be rejected');

      // Global source with tenant file fails.
      const [globalSource] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('global-file-source', 'engineering_standard', 'Global File Source', NULL)
        RETURNING id
      `);

      let blockedGlobalTenant = false;
      await conn.query('SAVEPOINT source_version_global_tenant_file');
      try {
        await conn.query(`
          INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title, uploaded_file_id)
          VALUES ($1, '1.0', 'Global Tenant File Version', $2)
        `, [globalSource.id, fileA.id]);
      } catch (err) {
        blockedGlobalTenant = /global knowledge_source cannot reference|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT source_version_global_tenant_file');
      }
      assert.ok(blockedGlobalTenant, 'Global source referencing tenant uploaded_file should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks changing organization_id of referenced uploaded_file', async () => {
    const conn = await getConnection();
    try {
      const [orgA] = await conn.query(`SELECT id FROM organizations ORDER BY id LIMIT 1`);
      const [orgB] = await conn.query(`SELECT id FROM organizations ORDER BY id OFFSET 1 LIMIT 1`);
      assert.ok(orgA && orgB, 'Need two organizations');

      const [file] = await conn.query(`
        INSERT INTO uploaded_files (organization_id, file_name, original_name, file_path)
        VALUES ($1, 'lock-file.pdf', 'lock-file.pdf', '/uploads/lock-file.pdf')
        RETURNING id
      `, [orgA.id]);

      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('lock-file-source', 'manufacturer_manual', 'Lock File Source', $1)
        RETURNING id
      `, [orgA.id]);

      await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title, uploaded_file_id)
        VALUES ($1, '1.0', 'Lock File Version', $2)
      `, [source.id, file.id]);

      let blocked = false;
      await conn.query('SAVEPOINT uploaded_file_org_change');
      try {
        await conn.query(`UPDATE uploaded_files SET organization_id = $1 WHERE id = $2`, [orgB.id, file.id]);
      } catch (err) {
        blocked = /cannot change while referenced|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT uploaded_file_org_change');
      }
      assert.ok(blocked, 'Changing organization_id of referenced uploaded_file should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('blocks deleting copied_from working evidence referenced by frozen evidence', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);
      const [step] = await conn.query(`
        INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction)
        VALUES ($1, 1, 'instruction', 'Test step')
        RETURNING id
      `, [template.id]);

      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('lineage-source', 'manufacturer_manual', 'Lineage Source', $1)
        RETURNING id
      `, [template.organization_id]);

      const [version] = await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, '1.0', 'Lineage Version')
        RETURNING id
      `, [source.id]);

      const [workingEvidence] = await conn.query(`
        INSERT INTO knowledge_template_evidence (
          task_template_id, knowledge_source_version_id, confidence_level, supporting_role
        ) VALUES ($1, $2, 'established', 'primary')
        RETURNING id
      `, [template.id, version.id]);

      const [templateVersion] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id,
          template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id)
        VALUES ($1, 1, $2, 'Lineage Template', 'preventive', 'published', FALSE,
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, template.equipment_type_id]);

      await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id, step_type, instruction
        )
        VALUES ($1, 1, $2, 'instruction', 'Lineage step')
      `, [templateVersion.id, step.id]);

      await conn.query(`
        INSERT INTO knowledge_template_version_evidence (
          task_template_version_id, knowledge_source_version_id, copied_from_template_evidence_id,
          confidence_level, supporting_role
        ) VALUES ($1, $2, $3, 'established', 'primary')
      `, [templateVersion.id, version.id, workingEvidence.id]);

      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [templateVersion.id]);

      let blocked = false;
      await conn.query('SAVEPOINT delete_copied_from');
      try {
        await conn.query(`DELETE FROM knowledge_template_evidence WHERE id = $1`, [workingEvidence.id]);
      } catch (err) {
        blocked = /foreign key|references|restrict/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT delete_copied_from');
      }
      assert.ok(blocked, 'Deleting working evidence referenced by frozen copied_from should be blocked');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('locks source identity fields after source versions exist', async () => {
    const conn = await getConnection();
    try {
      const [orgA] = await conn.query(`SELECT id FROM organizations ORDER BY id LIMIT 1`);
      const [orgB] = await conn.query(`SELECT id FROM organizations ORDER BY id OFFSET 1 LIMIT 1`);
      assert.ok(orgA && orgB, 'Need two organizations');

      const [source] = await conn.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
        VALUES ('identity-lock-source', 'manufacturer_manual', 'Identity Lock Source', $1)
        RETURNING id
      `, [orgA.id]);

      await conn.query(`
        INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
        VALUES ($1, '1.0', 'Identity Lock Version')
      `, [source.id]);

      // organization_id locked
      let blockedOrg = false;
      await conn.query('SAVEPOINT source_org_lock');
      try {
        await conn.query(`UPDATE knowledge_sources SET organization_id = $1 WHERE id = $2`, [orgB.id, source.id]);
      } catch (err) {
        blockedOrg = /organization_id cannot change|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT source_org_lock');
      }
      assert.ok(blockedOrg, 'Changing source organization_id after versions exist should be rejected');

      // source_code locked
      let blockedCode = false;
      await conn.query('SAVEPOINT source_code_lock');
      try {
        await conn.query(`UPDATE knowledge_sources SET source_code = 'new-code' WHERE id = $1`, [source.id]);
      } catch (err) {
        blockedCode = /source_code cannot change|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT source_code_lock');
      }
      assert.ok(blockedCode, 'Changing source_code after versions exist should be rejected');

      // source_category locked
      let blockedCategory = false;
      await conn.query('SAVEPOINT source_category_lock');
      try {
        await conn.query(`UPDATE knowledge_sources SET source_category = 'engineering_standard' WHERE id = $1`, [source.id]);
      } catch (err) {
        blockedCategory = /source_category cannot change|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT source_category_lock');
      }
      assert.ok(blockedCategory, 'Changing source_category after versions exist should be rejected');

      // descriptive field still editable
      await conn.query(`
        UPDATE knowledge_sources
        SET default_title = 'Updated Title', issuing_organization = 'Updated Org', is_active = FALSE
        WHERE id = $1
      `, [source.id]);

      const [updated] = await conn.query(`
        SELECT default_title, issuing_organization, is_active FROM knowledge_sources WHERE id = $1
      `, [source.id]);
      assert.strictEqual(updated.default_title, 'Updated Title');
      assert.strictEqual(updated.issuing_organization, 'Updated Org');
      assert.strictEqual(updated.is_active, false);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });




  it('creates task_template_safety_control_versions with migration 012', async () => {
    const conn = await getConnection();
    try {
      const [table] = await conn.query(`
        SELECT 1 AS ok FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename = 'task_template_safety_control_versions'
      `);
      assert.ok(table, 'task_template_safety_control_versions table should exist');
      assert.strictEqual(table.ok, 1);
      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('applies 012 idempotently without error', async () => {
    const fs = require('fs');
    const path = require('path');
    const migrationPath = path.join(__dirname, '..', 'database', 'postgresql', '012_task_template_safety_control_versioning.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    const conn = await getConnection();
    try {
      await conn.query(sql);
      await conn.query(sql);

      const [idx] = await conn.query(`
        SELECT COUNT(*) AS cnt
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'task_template_safety_control_versions'
      `);
      assert.ok(parseInt(idx.cnt, 10) >= 2, 'expected at least two indexes on safety-control versions');

      await conn.query(`
        DO $$
        BEGIN
          PERFORM 1 FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename = 'task_template_safety_control_versions';
          ASSERT FOUND, 'migration 012 table missing';
        END $$;
      `);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('allows valid safety-control version insertion before sealing', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);

      const versionNo = await nextTemplateVersion(conn, template.id);
      const [version] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id, template_name,
          maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id) VALUES ($1, $2, $3, 'Safety Publish Test', 'corrective', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, versionNo, template.equipment_type_id]);

      const [safetyControl] = await conn.query(`
        INSERT INTO task_template_safety_controls (
          task_template_id, safety_type, description, is_mandatory
        ) VALUES ($1, 'lockout', 'LOTO before work', true)
        RETURNING id
      `, [template.id]);

      const [stepNo] = await conn.query(`
        SELECT COALESCE(MAX(step_no), 0) + 1 AS next_no FROM task_template_steps
        WHERE task_template_id = $1
      `, [template.id]);

      const [step] = await conn.query(`
        INSERT INTO task_template_steps (
          task_template_id, step_no, step_type, instruction
        ) VALUES ($1, $2, 'instruction', 'Perform safety check')
        RETURNING id
      `, [template.id, stepNo.next_no]);

      await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id,
          step_type, instruction
        ) VALUES ($1, $2, $3, 'instruction', 'Perform safety check')
      `, [version.id, 1, step.id]);

      const [scVersion] = await conn.query(`
        INSERT INTO task_template_safety_control_versions (
          task_template_version_id, task_template_safety_control_id,
          safety_type, description, is_mandatory
        ) VALUES ($1, $2, 'lockout', 'LOTO before work', true)
        RETURNING id
      `, [version.id, safetyControl.id]);
      assert.ok(scVersion.id > 0);

      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [version.id]);

      const [sealed] = await conn.query(`
        SELECT is_step_set_sealed FROM task_template_versions WHERE id = $1
      `, [version.id]);
      assert.strictEqual(sealed.is_step_set_sealed, true);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects invalid safety-control version references', async () => {
    const conn = await getConnection();
    try {
      const templateA = await createTestTemplate(conn);
      const templateB = await createTestTemplate(conn);

      const [controlB] = await conn.query(`
        INSERT INTO task_template_safety_controls (
          task_template_id, safety_type, description
        ) VALUES ($1, 'insulation', 'Verify insulation')
        RETURNING id
      `, [templateB.id]);

      const versionNo = await nextTemplateVersion(conn, templateA.id);
      const [version] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id, template_name,
          maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id) VALUES ($1, $2, $3, 'Cross Safety Test', 'corrective', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [templateA.id, versionNo, templateA.equipment_type_id]);

      const [stepNo] = await conn.query(`
        SELECT COALESCE(MAX(step_no), 0) + 1 AS next_no FROM task_template_steps
        WHERE task_template_id = $1
      `, [templateA.id]);
      const [step] = await conn.query(`
        INSERT INTO task_template_steps (
          task_template_id, step_no, step_type, instruction
        ) VALUES ($1, $2, 'instruction', 'Do something')
        RETURNING id
      `, [templateA.id, stepNo.next_no]);

      await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id,
          step_type, instruction
        ) VALUES ($1, $2, $3, 'instruction', 'Do something')
      `, [version.id, 1, step.id]);

      let blocked = false;
      await conn.query('SAVEPOINT bad_safety_control');
      try {
        await conn.query(`
          INSERT INTO task_template_safety_control_versions (
            task_template_version_id, task_template_safety_control_id,
            safety_type, description
          ) VALUES ($1, $2, 'insulation', 'Verify insulation')
        `, [version.id, controlB.id]);
      } catch (err) {
        blocked = /does not belong to task_template_id|check_violation/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT bad_safety_control');
      }
      assert.ok(blocked, 'Safety control from another template should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects safety-control version modification after parent is sealed', async () => {
    const conn = await getConnection();
    try {
      const template = await createTestTemplate(conn);

      const [control] = await conn.query(`
        INSERT INTO task_template_safety_controls (
          task_template_id, safety_type, description
        ) VALUES ($1, 'grounding', 'Ensure grounding')
        RETURNING id
      `, [template.id]);

      const versionNo = await nextTemplateVersion(conn, template.id);
      const [version] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id, template_name,
          maintenance_type, lifecycle_state_at_publish,
            reviewer_user_id, reviewed_at, approver_user_id, approved_at,
            safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at, published_by_user_id) VALUES ($1, $2, $3, 'Seal Safety Test', 'corrective', 'published',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            ${GOVERNANCE_REVIEWER_SQL}, NOW(),
            'reviewed_no_control_required',
            ${GOVERNANCE_REVIEWER_SQL}, NOW(), ${GOVERNANCE_PUBLISHER_SQL})
        RETURNING id
      `, [template.id, versionNo, template.equipment_type_id]);

      const [stepNo] = await conn.query(`
        SELECT COALESCE(MAX(step_no), 0) + 1 AS next_no FROM task_template_steps
        WHERE task_template_id = $1
      `, [template.id]);
      const [step] = await conn.query(`
        INSERT INTO task_template_steps (
          task_template_id, step_no, step_type, instruction
        ) VALUES ($1, $2, 'instruction', 'Do something')
        RETURNING id
      `, [template.id, stepNo.next_no]);

      await conn.query(`
        INSERT INTO task_template_step_versions (
          task_template_version_id, step_no, task_template_step_id,
          step_type, instruction
        ) VALUES ($1, $2, $3, 'instruction', 'Do something')
      `, [version.id, 1, step.id]);

      const [scVersion] = await conn.query(`
        INSERT INTO task_template_safety_control_versions (
          task_template_version_id, task_template_safety_control_id,
          safety_type, description
        ) VALUES ($1, $2, 'grounding', 'Ensure grounding')
        RETURNING id
      `, [version.id, control.id]);
      assert.ok(scVersion.id > 0);

      await conn.query(`
        UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1
      `, [version.id]);

      const [sealed] = await conn.query(`
        SELECT is_step_set_sealed FROM task_template_versions WHERE id = $1
      `, [version.id]);
      assert.strictEqual(sealed.is_step_set_sealed, true);

      let blockedUpdate = false;
      await conn.query('SAVEPOINT update_sc_version');
      try {
        await conn.query(`
          UPDATE task_template_safety_control_versions
          SET description = 'tampered' WHERE id = $1
        `, [scVersion.id]);
      } catch (err) {
        blockedUpdate = /immutable and cannot be UPDATE|insufficient_privilege/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT update_sc_version');
      }
      assert.ok(blockedUpdate, 'Update of safety-control version should be rejected');

      let blockedDelete = false;
      await conn.query('SAVEPOINT delete_sc_version');
      try {
        await conn.query(`DELETE FROM task_template_safety_control_versions WHERE id = $1`, [scVersion.id]);
      } catch (err) {
        blockedDelete = /immutable and cannot be DELETE|insufficient_privilege/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT delete_sc_version');
      }
      assert.ok(blockedDelete, 'Delete of safety-control version should be rejected');

      let blockedInsert = false;
      await conn.query('SAVEPOINT insert_after_seal');
      try {
        await conn.query(`
          INSERT INTO task_template_safety_control_versions (
            task_template_version_id, task_template_safety_control_id,
            safety_type, description
          ) VALUES ($1, $2, 'grounding', 'Ensure grounding')
        `, [version.id, control.id]);
      } catch (err) {
        blockedInsert = /cannot add task_template_safety_control_versions to sealed|insufficient_privilege/i.test(err.message || '');
        await conn.query('ROLLBACK TO SAVEPOINT insert_after_seal');
      }
      assert.ok(blockedInsert, 'Insert after seal should be rejected');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  // ============================================================
  // ATM-013F2B — Atomic Template Publication Tests
  // ============================================================

  async function createPublishableTemplate(conn, options = {}) {
    const template = await createTestTemplate(conn);

    const [activityCode] = await conn.query(`
      INSERT INTO activity_codes (activity_code, activity_name, activity_category)
      VALUES ('AC' || floor(random() * 1000000000)::int::text, 'Test Activity', 'inspection')
      RETURNING id
    `);

    await conn.query(`
      UPDATE task_templates
      SET priority = 'high', activity_code_id = $1
      WHERE id = $2
    `, [activityCode.id, template.id]);

    const [step1] = await conn.query(`
      INSERT INTO task_template_steps (
        task_template_id, step_no, step_type, instruction, activity_code_id, options, safety_note, is_visual_only,
        requires_equipment_stopped, prohibit_if_running, prohibit_opening_covers
      ) VALUES ($1, 1, 'instruction', 'First step', $2, $3::jsonb, $4, false, true, true, true)
      RETURNING id
    `, [template.id, activityCode.id, JSON.stringify({ choices: ['option-a', 'option-b'] }), 'Step 1 safety note']);

    const [step2] = await conn.query(`
      INSERT INTO task_template_steps (
        task_template_id, step_no, step_type, instruction
      ) VALUES ($1, 2, 'measurement', 'Second step')
      RETURNING id
    `, [template.id]);

    const [safetyControl] = await conn.query(`
      INSERT INTO task_template_safety_controls (
        task_template_id, safety_type, description, is_mandatory
      ) VALUES ($1, 'lockout', 'LOTO required', true)
      RETURNING id
    `, [template.id]);

    // ATM-001 M1 — published knowledge must cite immutable sources. The
    // fixture therefore always carries evidence; there is no evidenced=false
    // escape hatch, because such a fixture could never be published and would
    // make an admission failure look like a versioning defect.
    const [source] = await conn.query(`
      INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
      VALUES ('pub-source-' || floor(random() * 1000000000)::int::text, 'manufacturer_manual', 'Publication Source', NULL)
      RETURNING id
    `);

    const [sourceVersion] = await conn.query(`
      INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
      VALUES ($1, '1.0', 'Publication Source Version')
      RETURNING id
    `, [source.id]);

    await conn.query(`
      INSERT INTO knowledge_template_evidence (
        task_template_id, knowledge_source_version_id,
        section_or_clause, page_or_paragraph, derivation_notes,
        confidence_level, supporting_role
      ) VALUES ($1, $2, 'Section A', 'Page 1', 'Template-level rationale', 'established', 'primary')
    `, [template.id, sourceVersion.id]);

    await conn.query(`
      INSERT INTO knowledge_template_evidence (
        task_template_step_id, knowledge_source_version_id,
        section_or_clause, page_or_paragraph, derivation_notes,
        confidence_level, supporting_role
      ) VALUES ($1, $2, 'Clause 2', 'Paragraph 3', 'Step-level rationale', 'provisional', 'supporting')
    `, [step1.id, sourceVersion.id]);
  

    // ATM-001 M1 — a published version must be governed knowledge, so the
    // fixture is driven through the real governance state: safety explicitly
    // reviewed, and a review approval bound to the content being published.
    // The approver is a dedicated principal, distinct from the publisher.
    const { computeContentSha } = require('../src/services/knowledge-governance.service');

    const [governanceUser] = await conn.query(`
      INSERT INTO users (username, email, password_hash, full_name, role, is_active)
      VALUES (
        'gov-approver-' || floor(random() * 1000000000)::int::text,
        'gov-approver-' || floor(random() * 1000000000)::int::text || '@test.local',
        'hash', 'Governance Approver', 'supervisor', true
      )
      RETURNING id
    `);

    const [workingTemplate] = await conn.query(
      `SELECT * FROM task_templates WHERE id = $1`, [template.id]);
    const workingSteps = await conn.query(
      `SELECT * FROM task_template_steps WHERE task_template_id = $1 ORDER BY step_no`, [template.id]);
    const contentSha = computeContentSha(workingTemplate, workingSteps);

    await conn.query(`
      UPDATE task_templates
         SET review_state = 'approved',
             submitted_for_review_by_user_id = $2,
             submitted_for_review_at = NOW(),
             reviewer_user_id = $2,
             reviewed_at = NOW(),
             approver_user_id = $2,
             approved_at = NOW(),
             approved_content_sha = $3,
             safety_review_state = 'reviewed_controls_defined',
             safety_reviewed_by_user_id = $2,
             safety_reviewed_at = NOW()
       WHERE id = $1
    `, [template.id, governanceUser.id, contentSha]);

    return {
      template,
      stepIds: [step1.id, step2.id],
      safetyControlId: safetyControl.id,
      activityCodeId: activityCode.id,
      categoryId: template._categoryId,
      classId: template._classId,
      typeId: template._typeId
    };
  }

  it('publishes a template and freezes header, steps, safety controls, and evidence', async () => {
    const conn = await getConnection();
    try {
      const { TaskTemplate } = require('../src/models');
      const publisher = await ensureTestUser(conn);
      const { template, stepIds, safetyControlId, activityCodeId } = await createPublishableTemplate(conn);

      const result = await TaskTemplate.publishVersion(template.id, publisher.id, {
        publishedByOrganizationId: template.organization_id ?? null,
        changeRationale: 'Initial publication',
        aiAssisted: true,
        connection: conn
      });

      assert.ok(result.versionId > 0);
      assert.strictEqual(result.versionNumber, 1);
      assert.strictEqual(result.stepCount, 2);
      assert.strictEqual(result.safetyControlVersionCount, 1);
      assert.strictEqual(result.templateEvidenceCount, 1);
      assert.strictEqual(result.stepEvidenceCount, 1);

      // Verify header is sealed and published.
      const [version] = await conn.query(`
        SELECT * FROM task_template_versions WHERE id = $1
      `, [result.versionId]);
      assert.strictEqual(version.lifecycle_state_at_publish, 'published');
      assert.strictEqual(version.is_step_set_sealed, true);
      assert.strictEqual(version.task_template_id, template.id);
      assert.strictEqual(version.version_number, 1);
      assert.strictEqual(version.priority, 'high');
      assert.strictEqual(version.activity_code_id, activityCodeId);
      assert.strictEqual(version.ai_assisted, true);
      assert.strictEqual(version.change_rationale, 'Initial publication');

      // Verify step versions exist and preserve order/content.
      const stepVersions = await conn.query(`
        SELECT * FROM task_template_step_versions
        WHERE task_template_version_id = $1
        ORDER BY step_no
      `, [result.versionId]);
      assert.strictEqual(stepVersions.length, 2);
      assert.strictEqual(stepVersions[0].step_no, 1);
      assert.strictEqual(stepVersions[0].instruction, 'First step');
      assert.strictEqual(stepVersions[1].step_no, 2);
      assert.strictEqual(stepVersions[1].instruction, 'Second step');
      assert.ok(stepIds.includes(stepVersions[0].task_template_step_id));
      assert.ok(stepIds.includes(stepVersions[1].task_template_step_id));
      assert.strictEqual(stepVersions[0].activity_code_id, activityCodeId);
      assert.deepStrictEqual(stepVersions[0].options, { choices: ['option-a', 'option-b'] });
      assert.strictEqual(stepVersions[0].safety_note, 'Step 1 safety note');
      assert.strictEqual(stepVersions[0].is_visual_only, false);
      assert.strictEqual(stepVersions[0].requires_equipment_stopped, true);
      assert.strictEqual(stepVersions[0].prohibit_if_running, true);
      assert.strictEqual(stepVersions[0].prohibit_opening_covers, true);

      // Verify safety control version.
      const [scVersion] = await conn.query(`
        SELECT * FROM task_template_safety_control_versions
        WHERE task_template_version_id = $1
      `, [result.versionId]);
      assert.ok(scVersion);
      assert.strictEqual(scVersion.task_template_safety_control_id, safetyControlId);
      assert.strictEqual(scVersion.safety_type, 'lockout');
      assert.strictEqual(scVersion.is_mandatory, true);

      // Verify frozen provenance was copied and mapped correctly.
      const frozenEvidence = await conn.query(`
        SELECT e.*, sv.task_template_step_id AS source_step_id
        FROM knowledge_template_version_evidence e
        LEFT JOIN task_template_step_versions sv ON sv.id = e.task_template_step_version_id
        WHERE e.task_template_version_id = $1 OR sv.task_template_version_id = $1
      `, [result.versionId]);
      assert.strictEqual(frozenEvidence.length, 2);

      const templateLevel = frozenEvidence.find(ev => ev.task_template_version_id === result.versionId && ev.task_template_step_version_id === null);
      const stepLevel = frozenEvidence.find(ev => ev.task_template_step_version_id !== null);

      assert.ok(templateLevel);
      assert.strictEqual(templateLevel.section_or_clause, 'Section A');
      assert.strictEqual(templateLevel.confidence_level, 'established');
      assert.strictEqual(templateLevel.supporting_role, 'primary');

      assert.ok(stepLevel);
      assert.strictEqual(stepLevel.source_step_id, stepIds[0]);
      assert.strictEqual(stepLevel.section_or_clause, 'Clause 2');
      assert.strictEqual(stepLevel.confidence_level, 'provisional');
      assert.strictEqual(stepLevel.supporting_role, 'supporting');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('defaults ai_assisted to FALSE when not supplied', async () => {
    const conn = await getConnection();
    try {
      const { TaskTemplate } = require('../src/models');
      const publisher = await ensureTestUser(conn);
      const { template } = await createPublishableTemplate(conn);

      const result = await TaskTemplate.publishVersion(template.id, publisher.id, {
        publishedByOrganizationId: template.organization_id ?? null,
        connection: conn
      });

      const [version] = await conn.query(`
        SELECT ai_assisted FROM task_template_versions WHERE id = $1
      `, [result.versionId]);
      assert.strictEqual(version.ai_assisted, false);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects publication of a missing template', async () => {
    const { TaskTemplate } = require('../src/models');
    await assert.rejects(
      () => TaskTemplate.publishVersion(999999, 1, { publishedByOrganizationId: 1 }),
      /Task template not found/
    );
  });

  it('rejects publication when caller organization does not match tenant template', async () => {
    const conn = await getConnection();
    try {
      const { TaskTemplate } = require('../src/models');
      const publisher = await ensureTestUser(conn);
      const { template } = await createPublishableTemplate(conn);

      // Force template to be tenant-scoped.
      const [org] = await conn.query(`
        INSERT INTO organizations (organization_name) VALUES ('Pub Tenant') RETURNING id
      `);
      await conn.query(`UPDATE task_templates SET organization_id = $1 WHERE id = $2`, [org.id, template.id]);

      await assert.rejects(
        () => TaskTemplate.publishVersion(template.id, publisher.id, { publishedByOrganizationId: 999999, connection: conn }),
        /Access denied/
      );

      // Ensure no version leaked.
      const versions = await conn.query(`
        SELECT * FROM task_template_versions WHERE task_template_id = $1
      `, [template.id]);
      assert.strictEqual(versions.length, 0);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('rejects publication of a template with no steps', async () => {
    const conn = await getConnection();
    try {
      const { TaskTemplate } = require('../src/models');
      const publisher = await ensureTestUser(conn);
      const template = await createTestTemplate(conn);

      await assert.rejects(
        () => TaskTemplate.publishVersion(template.id, publisher.id, {
          publishedByOrganizationId: template.organization_id ?? null,
          connection: conn
        }),
        /Cannot publish template with no steps/
      );

      const versions = await conn.query(`
        SELECT * FROM task_template_versions WHERE task_template_id = $1
      `, [template.id]);
      assert.strictEqual(versions.length, 0);

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  it('concurrent publications receive distinct consecutive version numbers', async () => {
    const { TaskTemplate } = require('../src/models');

    let template;
    let fixtureIds = {};
    let publisherId;

    // Create a committed working template that both publishers will target.
    const setupConn = await getConnection();
    try {
      const publisher = await ensureTestUser(setupConn);
      publisherId = publisher.id;
      const fixture = await createPublishableTemplate(setupConn);
      template = fixture.template;
      fixtureIds = {
        activityCodeId: fixture.activityCodeId,
        categoryId: fixture.categoryId,
        classId: fixture.classId,
        typeId: fixture.typeId,
        publisherId
      };
      await setupConn.commit();
    } catch (err) {
      await setupConn.rollback();
      throw err;
    } finally {
      setupConn.release();
    }

    try {
      // Publish the same template simultaneously from two independent connections/
      // transactions. The advisory lock serializes them, so both receive distinct,
      // consecutive version numbers.
      const [first, second] = await Promise.all([
        TaskTemplate.publishVersion(template.id, publisherId, {
          publishedByOrganizationId: template.organization_id ?? null
        }),
        TaskTemplate.publishVersion(template.id, publisherId, {
          publishedByOrganizationId: template.organization_id ?? null
        })
      ]);

      const versionNumbers = new Set([first.versionNumber, second.versionNumber]);
      assert.deepStrictEqual(
        versionNumbers,
        new Set([1, 2]),
        'concurrent publications should receive version numbers 1 and 2'
      );

      // Verify both versions are complete and sealed.
      const verifyConn = await getConnection();
      try {
        const versions = await verifyConn.query(`
          SELECT id, version_number, is_step_set_sealed, lifecycle_state_at_publish
          FROM task_template_versions
          WHERE task_template_id = $1
          ORDER BY version_number
        `, [template.id]);
        assert.strictEqual(versions.length, 2, 'two published versions should exist');
        assert.deepStrictEqual(versions.map(v => v.version_number), [1, 2]);
        for (const v of versions) {
          assert.strictEqual(v.is_step_set_sealed, true, `version ${v.version_number} should be sealed`);
          assert.strictEqual(v.lifecycle_state_at_publish, 'published', `version ${v.version_number} should be published`);
        }

        for (const result of [first, second]) {
          const stepVersions = await verifyConn.query(`
            SELECT id FROM task_template_step_versions
            WHERE task_template_version_id = $1
          `, [result.versionId]);
          assert.strictEqual(stepVersions.length, 2, `version ${result.versionNumber} should have 2 step versions`);

          const safetyVersions = await verifyConn.query(`
            SELECT id FROM task_template_safety_control_versions
            WHERE task_template_version_id = $1
          `, [result.versionId]);
          assert.strictEqual(safetyVersions.length, 1, `version ${result.versionNumber} should have 1 safety control version`);
        }

        await verifyConn.rollback();
      } catch (err) {
        await verifyConn.rollback();
        throw err;
      } finally {
        verifyConn.release();
      }
    } finally {
      // Targeted teardown: temporarily lift the immutable-delete guards for
      // this test transaction, delete every fixture row in FK-safe order,
      // then restore the guards. This is the repository-approved test-only
      // mechanism; production immutability is not weakened because the change
      // lives only inside this test connection and is rolled back on failure.
      if (template) {
        const cleanupConn = await getConnection();
        try {
          await cleanupConn.query(`SET LOCAL session_replication_role = 'replica'`);

          // Frozen provenance and version children.
          await cleanupConn.query(`
            DELETE FROM knowledge_template_version_evidence e
            USING task_template_versions tv
            WHERE tv.id = e.task_template_version_id AND tv.task_template_id = $1
          `, [template.id]);
          await cleanupConn.query(`DELETE FROM task_template_safety_control_versions WHERE task_template_version_id IN (SELECT id FROM task_template_versions WHERE task_template_id = $1)`, [template.id]);
          await cleanupConn.query(`DELETE FROM task_template_step_versions WHERE task_template_version_id IN (SELECT id FROM task_template_versions WHERE task_template_id = $1)`, [template.id]);
          await cleanupConn.query(`DELETE FROM task_template_versions WHERE task_template_id = $1`, [template.id]);

          // Working provenance and children.
          await cleanupConn.query(`DELETE FROM knowledge_template_evidence WHERE task_template_id = $1`, [template.id]);
          await cleanupConn.query(`DELETE FROM knowledge_template_evidence WHERE task_template_step_id IN (SELECT id FROM task_template_steps WHERE task_template_id = $1)`, [template.id]);
          await cleanupConn.query(`DELETE FROM task_template_safety_controls WHERE task_template_id = $1`, [template.id]);
          await cleanupConn.query(`DELETE FROM task_template_steps WHERE task_template_id = $1`, [template.id]);

          // Working template, activity code, taxonomy, and publisher.
          await cleanupConn.query(`DELETE FROM task_templates WHERE id = $1`, [template.id]);
          await cleanupConn.query(`DELETE FROM activity_codes WHERE id = $1`, [fixtureIds.activityCodeId]);
          await cleanupConn.query(`DELETE FROM equipment_types WHERE id = $1`, [fixtureIds.typeId]);
          await cleanupConn.query(`DELETE FROM equipment_classes WHERE id = $1`, [fixtureIds.classId]);
          await cleanupConn.query(`DELETE FROM equipment_categories WHERE id = $1`, [fixtureIds.categoryId]);
          await cleanupConn.query(`DELETE FROM users WHERE id = $1`, [fixtureIds.publisherId]);

          await cleanupConn.query(`SET LOCAL session_replication_role = 'origin'`);
          await cleanupConn.commit();

          // Prove that the test's fixtures no longer exist.
          const verifyConn = await getConnection();
          try {
            const [remainingTemplate] = await verifyConn.query(`SELECT id FROM task_templates WHERE id = $1`, [template.id]);
            assert.strictEqual(remainingTemplate, undefined, 'template should be deleted');
            const [remainingVersion] = await verifyConn.query(`SELECT id FROM task_template_versions WHERE task_template_id = $1`, [template.id]);
            assert.strictEqual(remainingVersion, undefined, 'versions should be deleted');
            await verifyConn.rollback();
          } catch (err) {
            await verifyConn.rollback();
            throw err;
          } finally {
            verifyConn.release();
          }
        } catch (cleanupErr) {
          await cleanupConn.rollback();
          throw cleanupErr;
        } finally {
          cleanupConn.release();
        }
      }
    }
  });

  it('rolls back publication completely when a later constraint fails', async () => {
    const { TaskTemplate } = require('../src/models');
    const conn = await getConnection();
    try {
      // Ensure a publisher user exists to satisfy the version header FK.
      const [publisher] = await conn.query(`
        INSERT INTO users (username, email, password_hash, full_name, role, is_active)
        VALUES (
          'pub-user-' || floor(random() * 1000000000)::int::text,
          'pub-user-' || floor(random() * 1000000000)::int::text || '@test.local',
          'hash',
          'Publisher',
          'admin',
          true
        )
        RETURNING id
      `);
      const { template } = await createPublishableTemplate(conn);

      // Install a temporary trigger in the same transaction. It will be rolled
      // back with the test transaction, preventing cross-test pollution.
      await conn.query(`
        CREATE OR REPLACE FUNCTION fail_safety_control_version()
        RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'simulated mid-publication failure for rollback test';
        END;
        $$ LANGUAGE plpgsql;
      `);
      await conn.query(`
        DROP TRIGGER IF EXISTS trg_rollback_test_fail ON task_template_safety_control_versions;
        CREATE TRIGGER trg_rollback_test_fail
        BEFORE INSERT ON task_template_safety_control_versions
        FOR EACH ROW
        EXECUTE FUNCTION fail_safety_control_version();
      `);

      let threw = false;
      await conn.query('SAVEPOINT pub_test');
      try {
        await TaskTemplate.publishVersion(template.id, publisher.id, {
          publishedByOrganizationId: template.organization_id ?? null,
          connection: conn
        });
      } catch (err) {
        threw = true;
        assert.ok(/simulated mid-publication failure/.test(err.message));
        await conn.query('ROLLBACK TO SAVEPOINT pub_test');
      }
      assert.ok(threw, 'publication should have failed');

      // Drop the trigger so subsequent assertions in this transaction can run.
      await conn.query(`DROP TRIGGER IF EXISTS trg_rollback_test_fail ON task_template_safety_control_versions;`);

      // Verify nothing leaked.
      const versions = await conn.query(`
        SELECT * FROM task_template_versions WHERE task_template_id = $1
      `, [template.id]);
      assert.strictEqual(versions.length, 0, 'no version should remain after rollback');

      const stepVersions = await conn.query(`
        SELECT * FROM task_template_step_versions sv
        JOIN task_template_versions tv ON tv.id = sv.task_template_version_id
        WHERE tv.task_template_id = $1
      `, [template.id]);
      assert.strictEqual(stepVersions.length, 0, 'no step versions should remain after rollback');

      const safetyVersions = await conn.query(`
        SELECT * FROM task_template_safety_control_versions scv
        JOIN task_template_versions tv ON tv.id = scv.task_template_version_id
        WHERE tv.task_template_id = $1
      `, [template.id]);
      assert.strictEqual(safetyVersions.length, 0, 'no safety control versions should remain after rollback');

      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  });

  describe('Task Template Publish Controller Validation', () => {
    const { TaskTemplate } = require('../src/models');
    let originalPublishVersion;

    function buildResponse() {
      let statusCode;
      let jsonBody;
      return {
        status: (code) => {
          statusCode = code;
          return {
            json: (body) => {
              jsonBody = body;
            }
          };
        },
        _status: () => statusCode,
        _json: () => jsonBody
      };
    }

    function buildRequest(id, body = {}) {
      return {
        params: { id },
        user: { id: 1, organization_id: 1 },
        body
      };
    }

    // Stub the model so controller tests isolate validation from the database.
    before(() => {
      originalPublishVersion = TaskTemplate.publishVersion;
    });

    afterEach(() => {
      TaskTemplate.publishVersion = originalPublishVersion;
    });

    it('returns 400 for an invalid template route id', async () => {
      const res = buildResponse();
      const nextErrors = [];
      const req = buildRequest('abc');
      await taskTemplateController.publish(req, res, (err) => nextErrors.push(err));
      assert.strictEqual(res._status(), 400);
      assert.strictEqual(res._json().success, false);
      assert.ok(res._json().message.toLowerCase().includes('invalid template id'));
      assert.strictEqual(nextErrors.length, 0);
    });

    it('returns 400 when ai_assisted is not a boolean', async () => {
      const invalidValues = ['true', 1, 0, null, [], {}];
      for (const value of invalidValues) {
        const res = buildResponse();
        const req = buildRequest(1, { ai_assisted: value });
        await taskTemplateController.publish(req, res, () => {});
        assert.strictEqual(res._status(), 400, `ai_assisted=${JSON.stringify(value)} should be rejected`);
        assert.strictEqual(res._json().success, false);
        assert.ok(res._json().message.toLowerCase().includes('ai_assisted must be a boolean'));
      }
    });

    it('defaults omitted ai_assisted to false and passes it to the model', async () => {
      let receivedArgs;
      TaskTemplate.publishVersion = async (...args) => {
        receivedArgs = args;
        return { versionId: 1, versionNumber: 1 };
      };

      const res = buildResponse();
      await taskTemplateController.publish(buildRequest(42, {}), res, () => {});
      assert.strictEqual(res._status(), 201);
      assert.strictEqual(receivedArgs[0], 42);
      assert.strictEqual(receivedArgs[1], 1);
      assert.strictEqual(receivedArgs[2].aiAssisted, false);
    });

    it('passes ai_assisted true and false to the model unchanged', async () => {
      for (const value of [true, false]) {
        let receivedArgs;
        TaskTemplate.publishVersion = async (...args) => {
          receivedArgs = args;
          return { versionId: 1, versionNumber: 1 };
        };

        const res = buildResponse();
        await taskTemplateController.publish(buildRequest(42, { ai_assisted: value }), res, () => {});
        assert.strictEqual(res._status(), 201, `ai_assisted=${value} should reach the model`);
        assert.strictEqual(receivedArgs[2].aiAssisted, value, `ai_assisted=${value} should be passed unchanged`);
      }
    });

    it('returns 400 when ai_assistance_detail is not an object', async () => {
      const invalidValues = ['detail', 123, true, []];
      for (const value of invalidValues) {
        const res = buildResponse();
        const req = buildRequest(1, { ai_assistance_detail: value });
        await taskTemplateController.publish(req, res, () => {});
        assert.strictEqual(res._status(), 400, `ai_assistance_detail=${JSON.stringify(value)} should be rejected`);
        assert.strictEqual(res._json().success, false);
        assert.ok(res._json().message.toLowerCase().includes('ai_assistance_detail must be an object'));
      }
    });

    it('accepts omitted and explicit-null ai_assistance_detail and passes them to the model', async () => {
      for (const body of [{}, { ai_assistance_detail: null }]) {
        let receivedArgs;
        TaskTemplate.publishVersion = async (...args) => {
          receivedArgs = args;
          return { versionId: 1, versionNumber: 1 };
        };

        const res = buildResponse();
        await taskTemplateController.publish(buildRequest(42, body), res, () => {});
        assert.strictEqual(res._status(), 201);
        assert.deepStrictEqual(receivedArgs[2].aiAssistanceDetail, body.ai_assistance_detail);
      }
    });

    it('passes a plain-object ai_assistance_detail to the model unchanged', async () => {
      const detail = { model: 'gpt-4', prompt: 'hello' };
      let receivedArgs;
      TaskTemplate.publishVersion = async (...args) => {
        receivedArgs = args;
        return { versionId: 1, versionNumber: 1 };
      };

      const res = buildResponse();
      await taskTemplateController.publish(buildRequest(42, { ai_assistance_detail: detail }), res, () => {});
      assert.strictEqual(res._status(), 201);
      assert.deepStrictEqual(receivedArgs[2].aiAssistanceDetail, detail);
    });
  });

});
