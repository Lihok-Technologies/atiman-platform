/**
 * AI-Assistance Disclosure Integration Tests
 *
 * ATM-001 M6.4 Step 3B-B — proves the governed AI-assistance disclosure regime
 * end to end: the schema coherence of the working definition, the authoring
 * declaration, its participation in approval, its freezing at publication, and
 * the deliberate exemption of legacy-generated knowledge.
 *
 * Ratified semantics under test:
 *   - `ai_assisted = TRUE`  means AI materially helped produce or modify the
 *     knowledge content. Spell-checking, formatting, navigation, search and
 *     deterministic validation do not count.
 *   - `content_origin = 'authored'` means a human is accountable for the content.
 *     It does NOT mean "AI was never involved", and it is never rewritten because
 *     of an AI disclosure.
 *   - `NULL` is NOT `FALSE`. NULL means "not captured under this regime" and is
 *     the truthful state for knowledge that predates it. Nothing backfills it.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { TaskTemplate } = require('../src/models');
const authoring = require('../src/services/knowledge-authoring.service');
const {
  computeContentSha,
  validatePublicationAdmission,
  MATERIAL_TEMPLATE_FIELDS
} = require('../src/services/knowledge-governance.service');
const {
  KnowledgeSource,
  KnowledgeSourceVersion,
  KnowledgeTemplateEvidence
} = require('../src/models/knowledge-provenance.model');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating AI-assistance disclosure suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const ORG = 999001;
const ORG_B = 999002;
const ACTOR = 999101;      // accountable author, member of ORG
const REVIEWER = 999102;   // safety reviewer
const APPROVER = 999103;   // approver (never the publisher)
const PUBLISHER = 999104;  // publisher, member of ORG
const CATEGORY = 999201;
const CLASS = 999202;
const EQUIPMENT_TYPE = 999203;

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'postgresql');
const MIGRATION_021 = path.join(MIGRATIONS_DIR, '021_ai_assistance_disclosure.sql');

/**
 * Disposable-database plumbing for the executable upgrade-path test.
 *
 * The upgrade test must observe a database that is genuinely at migration 020
 * before migration 021 runs, so it cannot use the shared suite database (already
 * migrated). It creates and drops its own database on the sanctioned test server,
 * using only the TEST_DB_* credentials — the same technique the governed
 * foundation suite uses for its own disposable databases.
 */
const SERVER = {
  host: process.env.TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT),
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD
};

let upgradeDbCounter = 0;
const createdDatabases = [];
const uniqueUpgradeDbName = () => `atiman_3bb_upgrade_${process.pid}_${++upgradeDbCounter}`;

const migrationFiles = () => fs.readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();

async function serverPool(database) {
  return new Pool({ ...SERVER, database, max: 2 });
}

async function createUpgradeDatabase(name) {
  const pool = await serverPool('postgres');
  try {
    await pool.query(`CREATE DATABASE ${name}`);
    createdDatabases.push(name);
  } finally {
    await pool.end();
  }
}

async function dropUpgradeDatabase(name) {
  const pool = await serverPool('postgres');
  try {
    await pool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [name]);
    await pool.query(`DROP DATABASE IF EXISTS ${name}`);
  } finally {
    await pool.end();
  }
}

let knowledgeTypeId;
let taskFamilyId;
let seq = 0;
const uniq = (prefix) => `${prefix}-${Date.now()}-${++seq}`;

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

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG, 'AI Disclosure Org'], [ORG_B, 'AI Disclosure Foreign Org']]) {
      await conn.query(
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [id, name]
      );
    }
    for (const [id, username, role, orgId] of [
      [ACTOR, 'ai-disclosure-author', 'admin', ORG],
      [REVIEWER, 'ai-disclosure-reviewer', 'supervisor', ORG],
      [APPROVER, 'ai-disclosure-approver', 'supervisor', ORG],
      [PUBLISHER, 'ai-disclosure-publisher', 'admin', ORG]
    ]) {
      await conn.query(
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'AI Disclosure Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, orgId]
      );
    }
    await conn.query(
      `INSERT INTO equipment_categories (id, category_code, category_name)
       VALUES (?, 'AIDCAT', 'AI Disclosure Category') ON CONFLICT (id) DO NOTHING`,
      [CATEGORY]
    );
    await conn.query(
      `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
       VALUES (?, ?, 'AIDCLS', 'AI Disclosure Class') ON CONFLICT (id) DO NOTHING`,
      [CLASS, CATEGORY]
    );
    await conn.query(
      `INSERT INTO equipment_types (id, class_id, type_code, type_name)
       VALUES (?, ?, 'AIDTYPE', 'AI Disclosure Equipment Type') ON CONFLICT (id) DO NOTHING`,
      [EQUIPMENT_TYPE, CLASS]
    );

    const [kt] = await conn.query(
      `SELECT id FROM knowledge_types WHERE type_code = 'MAINTENANCE_PROCEDURE'`
    );
    const [tf] = await conn.query(
      `SELECT id FROM task_families WHERE family_code = 'inspect'`
    );
    knowledgeTypeId = kt.id;
    taskFamilyId = tf.id;
  });
}

/**
 * A complete, explicitly-governed authored definition. Nothing is inferred, and
 * the disclosure is stated only when the caller states it — the fixture never
 * supplies a default, so tests can observe what the primitive does with an
 * undeclared disclosure.
 */
function authoredInput(overrides = {}, stepCount = 1) {
  const steps = [];
  for (let stepNo = 1; stepNo <= stepCount; stepNo += 1) {
    steps.push({
      step_no: stepNo,
      step_type: 'instruction',
      instruction: `Synthetic disclosure step ${stepNo}`
    });
  }
  return {
    templateName: 'AI Disclosure Fixture',
    templateCode: uniq('AID'),
    description: 'Synthetic definition for the AI-assistance disclosure suite',
    maintenanceType: 'preventive',
    priority: 'medium',
    equipmentTypeId: EQUIPMENT_TYPE,
    knowledgeTypeId,
    taskFamilyId,
    maintenanceStrategy: 'preventive',
    triggerMechanism: 'no_fixed_interval',
    knowledgeScope: 'customer',
    organizationId: ORG,
    steps,
    safetyControls: [],
    applicability: [{ equipment_type_id: EQUIPMENT_TYPE, is_primary: true }],
    ...overrides
  };
}

/**
 * Create a definition. `stepCount` controls the fixture's step set, so the
 * freezing tests can prove "EVERY step version" on a genuinely multi-step
 * definition rather than inferring it from a one-step case.
 */
async function createDefinition(overrides = {}, stepCount = 1) {
  return authoring.createAuthoredDefinition(authoredInput(overrides, stepCount),
    { actorUserId: ACTOR, organizationId: ORG });
}

async function rawDefinitionRow(templateId) {
  return withConn(async (conn) => {
    const [row] = await conn.query(
      `SELECT content_origin, ai_assisted, ai_assistance_detail FROM task_templates WHERE id = ?`,
      [templateId]
    );
    return row;
  });
}

/** Attach one immutable source version as step evidence, as publication requires. */
async function attachEvidence(templateId) {
  const steps = await withConn((conn) => conn.query(
    `SELECT id FROM task_template_steps WHERE task_template_id = ? ORDER BY step_no`,
    [templateId]
  ));
  const source = await KnowledgeSource.createSource(
    { sourceCode: uniq('AID-SRC'), sourceCategory: 'engineering_authored', defaultTitle: 'AI disclosure fixture source' },
    { organizationId: ORG, userId: ACTOR }
  );
  const version = await KnowledgeSourceVersion.createVersion(
    source.id,
    { versionDesignation: '1.0', title: 'AI disclosure fixture source v1' },
    { organizationId: ORG, userId: ACTOR }
  );
  await KnowledgeTemplateEvidence.attachEvidence(
    { taskTemplateStepId: steps[0].id },
    {
      knowledgeSourceVersionId: version.id,
      sectionOrClause: 'S1',
      confidenceLevel: 'provisional',
      supportingRole: 'primary'
    },
    { organizationId: ORG, userId: ACTOR }
  );
  return version.id;
}

/** Drive a definition through the real governance state to approved. */
async function approveDefinition(templateId) {
  await TaskTemplate.recordSafetyReview(templateId, REVIEWER, ORG, 'reviewed_no_control_required');
  await TaskTemplate.submitForReview(templateId, REVIEWER, ORG);
  await TaskTemplate.approveTemplate(templateId, APPROVER, ORG);
}

async function publishDefinition(templateId) {
  return TaskTemplate.publishVersion(templateId, PUBLISHER, { publishedByOrganizationId: ORG });
}

async function frozenDisclosure(versionId) {
  return withConn(async (conn) => {
    const [header] = await conn.query(
      `SELECT ai_assisted, ai_assistance_detail FROM task_template_versions WHERE id = ?`,
      [versionId]
    );
    const steps = await conn.query(
      `SELECT step_no, ai_assisted, ai_assistance_detail FROM task_template_step_versions
        WHERE task_template_version_id = ? ORDER BY step_no`,
      [versionId]
    );
    return { header, steps };
  });
}

/**
 * Construct a genuine legacy_generated definition without going through the
 * authoring primitive.
 *
 * This is the production shape: the row is created unclassified (as the legacy
 * corpus was), then classified exactly once with the accountable clearance that
 * classification requires, which is the only way `content_origin` may become
 * `legacy_generated`. It exists so the legacy compatibility boundary can be proven
 * by an actual publication rather than by a synthesized admission snapshot.
 */
async function createLegacyDefinition({ stepCount = 2 } = {}) {
  return withConn(async (conn) => {
    const [row] = await conn.query(
      `INSERT INTO task_templates (equipment_type_id, template_code, template_name,
         maintenance_type, task_kind, priority, knowledge_type_id, task_family_id,
         maintenance_strategy, trigger_mechanism, knowledge_scope, organization_id, content_origin)
       VALUES (?, ?, ?, 'preventive', 'inspection', 'medium', ?, ?, 'preventive',
               'no_fixed_interval', 'customer', ?, NULL)
       RETURNING id`,
      [EQUIPMENT_TYPE, uniq('AID-LEG'), 'Legacy-generated disclosure fixture',
        knowledgeTypeId, taskFamilyId, ORG]
    );
    await conn.query(
      `UPDATE task_templates
          SET content_origin = 'legacy_generated',
              legacy_clearance_by_user_id = ?,
              legacy_clearance_at = NOW(),
              legacy_clearance_rationale = 'AI-disclosure suite legacy fixture clearance'
        WHERE id = ?`,
      [REVIEWER, row.id]
    );
    for (let stepNo = 1; stepNo <= stepCount; stepNo += 1) {
      await conn.query(
        `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
         VALUES (?, ?, 'instruction', ?, true)`,
        [row.id, stepNo, `Legacy step ${stepNo}`]
      );
    }
    await conn.query(
      `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary, added_by_user_id)
       VALUES (?, ?, true, ?)`,
      [row.id, EQUIPMENT_TYPE, ACTOR]
    );
    return row.id;
  });
}

/** The rules an authoring rejection reported. */
function rulesOf(error) {
  return (error.failures || []).map((f) => f.rule);
}

/** Publish and return the admission rules it failed with, or null when published. */
async function refusalRules(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    if (Array.isArray(error.failures)) return error.failures.map((f) => f.rule);
    throw error;
  }
}

/** Run `statement` inside a savepoint so a rejected write leaves the tx usable. */
async function attemptWrite(conn, statement, params = []) {
  await conn.query('SAVEPOINT disclosure_probe');
  try {
    await conn.query(statement, params);
    await conn.query('RELEASE SAVEPOINT disclosure_probe');
    return { accepted: true, rule: null };
  } catch (error) {
    await conn.query('ROLLBACK TO SAVEPOINT disclosure_probe');
    return {
      accepted: false,
      rule: /check_violation|chk_task_templates_ai_assistance_coherence/i.test(error.message || '')
        ? 'chk_task_templates_ai_assistance_coherence'
        : error.message
    };
  }
}

describe('AI Assistance Disclosure (ATM-001 M6.4 Step 3B-B)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  // The executable upgrade-path test creates its own disposable database; drop it
  // even when the test fails, so a red run leaves no residue behind.
  after(async () => {
    for (const name of createdDatabases.splice(0)) {
      try { await dropUpgradeDatabase(name); } catch { /* best effort */ }
    }
  });

  // -------------------------------------------------------------------------
  describe('DATABASE — schema coherence of the working definition', () => {
    it('adds both disclosure columns to the working definition, nullable and defaultless', async () => {
      const columns = await withConn((conn) => conn.query(
        `SELECT column_name, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'task_templates'
            AND column_name IN ('ai_assisted', 'ai_assistance_detail')
          ORDER BY column_name`
      ));

      assert.deepStrictEqual(
        columns.map((c) => c.column_name),
        ['ai_assistance_detail', 'ai_assisted']
      );
      for (const column of columns) {
        assert.strictEqual(column.is_nullable, 'YES', `${column.column_name} must be nullable`);
        // No default is the structural form of "never fabricate a disclosure":
        // an omitted declaration must be NULL, and FALSE can never appear by
        // accident.
        assert.strictEqual(column.column_default, null,
          `${column.column_name} must carry no default`);
      }
    });

    it('keeps the frozen version tables carrying the disclosure', async () => {
      const columns = await withConn((conn) => conn.query(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name IN ('ai_assisted', 'ai_assistance_detail')
          ORDER BY table_name, column_name`
      ));
      const tables = new Set(columns.map((c) => c.table_name));
      for (const table of ['task_templates', 'task_template_versions', 'task_template_step_versions']) {
        assert.ok(tables.has(table), `${table} must carry the disclosure`);
      }
    });

    it('carries the coherence constraint', async () => {
      const [constraint] = await withConn((conn) => conn.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conname = 'chk_task_templates_ai_assistance_coherence'`
      ));
      assert.ok(constraint, 'the coherence constraint must exist');
      assert.strictEqual(constraint.conname, 'chk_task_templates_ai_assistance_coherence');
    });

    it('refuses every incoherent disclosure shape at the schema boundary', async () => {
      const definition = await createDefinition();
      const id = definition.id;

      await withConn(async (conn) => {
        const incoherent = [
          [`TRUE with no detail`, `UPDATE task_templates SET ai_assisted = TRUE WHERE id = ?`, [id]],
          [`TRUE with an empty object`, `UPDATE task_templates SET ai_assisted = TRUE, ai_assistance_detail = '{}'::jsonb WHERE id = ?`, [id]],
          [`TRUE with JSON null`, `UPDATE task_templates SET ai_assisted = TRUE, ai_assistance_detail = 'null'::jsonb WHERE id = ?`, [id]],
          [`FALSE with a detail`, `UPDATE task_templates SET ai_assisted = FALSE, ai_assistance_detail = '{"assisted":"x"}'::jsonb WHERE id = ?`, [id]],
          [`NULL with a detail`, `UPDATE task_templates SET ai_assisted = NULL, ai_assistance_detail = '{"assisted":"x"}'::jsonb WHERE id = ?`, [id]]
        ];
        for (const [label, statement, params] of incoherent) {
          const outcome = await attemptWrite(conn, statement, params);
          assert.strictEqual(outcome.accepted, false, `${label} must be refused by the schema`);
          assert.strictEqual(outcome.rule, 'chk_task_templates_ai_assistance_coherence',
            `${label} must be refused by the coherence constraint`);
        }

        const coherent = [
          [`TRUE with a record`, `UPDATE task_templates SET ai_assisted = TRUE, ai_assistance_detail = '{"assisted":"x"}'::jsonb WHERE id = ?`, [id]],
          [`FALSE with NULL`, `UPDATE task_templates SET ai_assisted = FALSE, ai_assistance_detail = NULL WHERE id = ?`, [id]],
          [`NULL with NULL`, `UPDATE task_templates SET ai_assisted = NULL, ai_assistance_detail = NULL WHERE id = ?`, [id]]
        ];
        for (const [label, statement, params] of coherent) {
          const outcome = await attemptWrite(conn, statement, params);
          assert.strictEqual(outcome.accepted, true, `${label} must be accepted (${outcome.rule})`);
        }
      });
    });

    it('leaves pre-existing rows at NULL across the 020 -> 021 upgrade, and never backfills FALSE', async () => {
      // Executable upgrade-path evidence, replacing source-text-only confidence.
      // A database is built to exactly migration 020, representative rows are
      // inserted, and only then is migration 021 applied. This is the only test
      // that can prove the ratified claim "legacy rows backfill NULL, never FALSE"
      // against real pre-existing data rather than against the migration file.
      const name = uniqueUpgradeDbName();
      await createUpgradeDatabase(name);
      const pool = await serverPool(name);
      try {
        const chain = migrationFiles();
        const before021 = chain.filter((file) => file.slice(0, 3) < '021');
        assert.ok(before021.length >= 20, 'the chain below 021 must be discoverable');

        // 1. database at migration 020 — and, first, the fact the M6.3 correction
        //    records: the working definition has no AI disclosure column yet.
        for (const file of before021) {
          await pool.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
        }
        const preColumns = await pool.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'task_templates'
              AND column_name IN ('ai_assisted', 'ai_assistance_detail')`
        );
        assert.strictEqual(preColumns.rowCount, 0,
          'before migration 021 the working definition carries no AI disclosure column');

        // 2. representative existing rows, in the shapes the corpus actually holds:
        //    a legacy row that predates the origin regime, a classified
        //    legacy_generated row with accountable clearance, and an authored row.
        await pool.query(
          `INSERT INTO equipment_categories (id, category_code, category_name)
           VALUES (9998011, 'UPGCAT', 'Upgrade Category')`);
        await pool.query(
          `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
           VALUES (9998012, 9998011, 'UPGCLS', 'Upgrade Class')`);
        await pool.query(
          `INSERT INTO equipment_types (id, class_id, type_code, type_name)
           VALUES (9998013, 9998012, 'UPGTYPE', 'Upgrade Type')`);
        await pool.query(
          `INSERT INTO task_templates (id, equipment_type_id, template_code, template_name,
             maintenance_type, knowledge_type_id, task_family_id, maintenance_strategy,
             trigger_mechanism, knowledge_scope, content_origin)
           SELECT 9998021, 9998013, 'UPG-UNCLASSIFIED', 'Pre-origin legacy definition',
             'preventive', (SELECT id FROM knowledge_types WHERE type_code = 'MAINTENANCE_PROCEDURE'),
             (SELECT id FROM task_families WHERE family_code = 'inspect'),
             'preventive', 'no_fixed_interval', 'shared', NULL`);
        await pool.query(
          `INSERT INTO users (id, username, email, password_hash, full_name, role, is_active)
           VALUES (9998091, 'upgrade-clearer', 'upgrade-clearer@test.local', 'x',
                   'Upgrade Clearer', 'supervisor', true)`);
        await pool.query(
          `INSERT INTO task_templates (id, equipment_type_id, template_code, template_name,
             maintenance_type, knowledge_type_id, task_family_id, maintenance_strategy,
             trigger_mechanism, knowledge_scope, content_origin)
           SELECT 9998022, 9998013, 'UPG-AUTHORED', 'Pre-021 authored definition',
             'preventive', (SELECT id FROM knowledge_types WHERE type_code = 'MAINTENANCE_PROCEDURE'),
             (SELECT id FROM task_families WHERE family_code = 'inspect'),
             'preventive', 'no_fixed_interval', 'shared', 'authored'`);
        await pool.query(
          `INSERT INTO task_templates (id, equipment_type_id, template_code, template_name,
             maintenance_type, knowledge_type_id, task_family_id, maintenance_strategy,
             trigger_mechanism, knowledge_scope, content_origin,
             legacy_clearance_by_user_id, legacy_clearance_at, legacy_clearance_rationale)
           SELECT 9998023, 9998013, 'UPG-LEGACY', 'Pre-021 cleared legacy definition',
             'preventive', (SELECT id FROM knowledge_types WHERE type_code = 'MAINTENANCE_PROCEDURE'),
             (SELECT id FROM task_families WHERE family_code = 'inspect'),
             'preventive', 'no_fixed_interval', 'shared', 'legacy_generated',
             9998091, NOW(), 'upgrade-path fixture clearance'`);
        const before = await pool.query(
          `SELECT id FROM task_templates WHERE id IN (9998021, 9998022, 9998023) ORDER BY id`);
        assert.strictEqual(before.rowCount, 3, 'all three representative rows must exist before 021');

        // 3. apply migration 021 exactly as committed, then re-apply it twice: the
        //    runner keeps no applied-migrations ledger, so re-application is the
        //    normal case rather than an edge case.
        const sql021 = fs.readFileSync(MIGRATION_021, 'utf8');
        for (let application = 1; application <= 3; application += 1) {
          await pool.query(sql021);

          // 4. every pre-existing row still carries NULL/NULL …
          const rows = await pool.query(
            `SELECT id, ai_assisted, ai_assistance_detail FROM task_templates
              WHERE id IN (9998021, 9998022, 9998023) ORDER BY id`);
          assert.strictEqual(rows.rowCount, 3);
          for (const row of rows.rows) {
            assert.strictEqual(row.ai_assisted, null,
              `row ${row.id} must stay NULL after application ${application}`);
            assert.strictEqual(row.ai_assistance_detail, null,
              `row ${row.id} must have no detail after application ${application}`);
          }

          // 5. and NOT ONE historical row anywhere became FALSE.
          const falsified = await pool.query(
            `SELECT count(*)::int AS count FROM task_templates WHERE ai_assisted IS FALSE`);
          assert.strictEqual(falsified.rows[0].count, 0,
            `application ${application} must not fabricate a single FALSE declaration`);

          // 6. re-application remains safe and does not duplicate the constraint.
          const constraints = await pool.query(
            `SELECT count(*)::int AS count FROM pg_constraint
              WHERE conname = 'chk_task_templates_ai_assistance_coherence'`);
          assert.strictEqual(constraints.rows[0].count, 1,
            `application ${application} must leave exactly one coherence constraint`);
        }

        // The coherence rule the upgrade installed is live on the upgraded rows.
        const coerced = await pool.query(
          `UPDATE task_templates SET ai_assisted = TRUE WHERE id = 9998021`)
          .then(() => null, (error) => error);
        assert.ok(coerced, 'the constraint must be enforced on rows that predate it');
        assert.match(coerced.message, /chk_task_templates_ai_assistance_coherence/);
      } finally {
        await pool.end();
        await dropUpgradeDatabase(name);
        const index = createdDatabases.indexOf(name);
        if (index >= 0) createdDatabases.splice(index, 1);
      }
    });

    it('migration 021 is guarded, backfills nothing, and rewrites no content origin', async () => {
      const sql = fs.readFileSync(MIGRATION_021, 'utf8');
      // Comments explain the intent (and quote the columns); the structural claims
      // below are about executable statements, so comment text is stripped first.
      const statements = sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n');

      assert.match(path.basename(MIGRATION_021), /^\d{3}_.*\.sql$/,
        'the migration must match the runner discovery pattern');
      assert.strictEqual(
        (sql.match(/ADD COLUMN IF NOT EXISTS/gi) || []).length >= 2, true,
        'both columns must be added with a re-application-safe guard');
      assert.ok(/pg_constraint/.test(sql),
        'the constraint addition must be guarded by an existence check');
      // The runner keeps no applied-migrations ledger, so every file is re-applied
      // on every run; these assertions protect the two properties that make 021
      // safe to re-apply and truthful about history.
      assert.ok(!/UPDATE\s+task_templates/i.test(statements),
        'migration 021 must not update any existing definition');
      assert.ok(!/SET\s+ai_assisted/i.test(statements),
        'migration 021 must not set a disclosure value on any row');
      assert.ok(!/content_origin/i.test(statements),
        'migration 021 must not touch content origin');
    });
  });

  // -------------------------------------------------------------------------
  describe('AUTHORING — the accountable author declares', () => {
    it('accepts a coherent AI-assisted declaration and records the detail verbatim', async () => {
      const detail = { model: 'synthetic', assisted: ['drafted the step text', 'proposed the safety note'] };
      const created = await createDefinition({ aiAssisted: true, aiAssistanceDetail: detail });

      assert.deepStrictEqual(created.ai_assistance, { assisted: true, detail });

      const row = await rawDefinitionRow(created.id);
      assert.strictEqual(row.ai_assisted, true);
      assert.deepStrictEqual(row.ai_assistance_detail, detail);
    });

    it('accepts an explicit human declaration and an undeclared NULL, and never invents FALSE', async () => {
      const human = await createDefinition({ aiAssisted: false });
      assert.deepStrictEqual(human.ai_assistance, { assisted: false, detail: null });
      const humanRow = await rawDefinitionRow(human.id);
      assert.strictEqual(humanRow.ai_assisted, false);
      assert.strictEqual(humanRow.ai_assistance_detail, null);

      // No declaration at all: the primitive reports NULL and stores NULL. It does
      // not decide on the author's behalf, and NULL is not FALSE.
      const undeclared = await createDefinition();
      assert.deepStrictEqual(undeclared.ai_assistance, { assisted: null, detail: null });
      const undeclaredRow = await rawDefinitionRow(undeclared.id);
      assert.strictEqual(undeclaredRow.ai_assisted, null);
      assert.strictEqual(undeclaredRow.ai_assistance_detail, null);

      // An explicitly undefined declaration (a body field that was simply absent)
      // is also NULL, not a driver-level parameter error.
      const explicitUndefined = await createDefinition({ aiAssisted: undefined });
      assert.deepStrictEqual(explicitUndefined.ai_assistance, { assisted: null, detail: null });
    });

    it('refuses to disclose assistance without recording what was assisted', async () => {
      const shapes = [
        ['no detail', { aiAssisted: true }],
        ['empty object', { aiAssisted: true, aiAssistanceDetail: {} }],
        ['blank values', { aiAssisted: true, aiAssistanceDetail: { note: '   ', other: null } }],
        ['empty array value', { aiAssisted: true, aiAssistanceDetail: { assisted: [] } }],
        ['explicit null', { aiAssisted: true, aiAssistanceDetail: null }]
      ];
      for (const [label, overrides] of shapes) {
        await assert.rejects(
          () => createDefinition(overrides),
          (error) => {
            assert.deepStrictEqual(rulesOf(error), ['AI_ASSISTANCE_DETAIL_REQUIRED'],
              `${label} must be refused as a missing record`);
            return true;
          }
        );
      }
    });

    it('refuses a disclosure detail without an explicit TRUE', async () => {
      for (const overrides of [
        { aiAssisted: false, aiAssistanceDetail: { assisted: 'x' } },
        { aiAssistanceDetail: { assisted: 'x' } }
      ]) {
        await assert.rejects(
          () => createDefinition(overrides),
          (error) => {
            assert.deepStrictEqual(rulesOf(error), ['AI_ASSISTANCE_DETAIL_NOT_ALLOWED']);
            return true;
          }
        );
      }
    });

    it('refuses a detail that is not a record', async () => {
      // Stricter than the schema, which only refuses an EMPTY value: the governed
      // coherence rule requires the disclosure to be a record, mirroring the
      // crosswalk rule that aiAssistanceDetail must be an object.
      for (const detail of [['a'], 'a prose note', 42, true]) {
        await assert.rejects(
          () => createDefinition({ aiAssisted: true, aiAssistanceDetail: detail }),
          (error) => {
            assert.deepStrictEqual(rulesOf(error), ['AI_ASSISTANCE_DETAIL_INVALID'],
              `${JSON.stringify(detail)} must be refused as not a record`);
            return true;
          }
        );
      }
    });

    it('refuses a non-boolean aiAssisted', async () => {
      for (const value of ['true', 1, 0, {}]) {
        await assert.rejects(
          () => createDefinition({ aiAssisted: value }),
          (error) => {
            assert.deepStrictEqual(rulesOf(error), ['AI_ASSISTED_INVALID'],
              `aiAssisted=${JSON.stringify(value)} must be refused`);
            return true;
          }
        );
      }
    });

    it('lets the author change and clear the declaration on a draft', async () => {
      const created = await createDefinition({ aiAssisted: false });

      await authoring.updateGovernedDraft(created.id, {
        aiAssisted: true,
        aiAssistanceDetail: { assisted: 'rewrote the instruction' }
      }, { actorUserId: ACTOR, organizationId: ORG });
      const assisted = await authoring.loadAuthoredDefinition(created.id, { organizationId: ORG });
      assert.deepStrictEqual(assisted.ai_assistance, {
        assisted: true,
        detail: { assisted: 'rewrote the instruction' }
      });

      // Clearing back to FALSE states the pair together: the detail is not cleared
      // silently, and a lone FALSE against an existing detail is refused because the
      // pair is a single attribution fact (see the partial-update test below).
      await authoring.updateGovernedDraft(created.id, { aiAssisted: false, aiAssistanceDetail: null },
        { actorUserId: ACTOR, organizationId: ORG });
      const cleared = await authoring.loadAuthoredDefinition(created.id, { organizationId: ORG });
      assert.deepStrictEqual(cleared.ai_assistance, { assisted: false, detail: null });
    });

    it('does not let a partial update leave the pair incoherent', async () => {
      const created = await createDefinition({ aiAssisted: true, aiAssistanceDetail: { assisted: 'x' } });
      await assert.rejects(
        () => authoring.updateGovernedDraft(created.id, { aiAssisted: false }, { actorUserId: ACTOR, organizationId: ORG }),
        (error) => {
          assert.deepStrictEqual(rulesOf(error), ['AI_ASSISTANCE_DETAIL_NOT_ALLOWED']);
          return true;
        }
      );
      const unchanged = await authoring.loadAuthoredDefinition(created.id, { organizationId: ORG });
      assert.deepStrictEqual(unchanged.ai_assistance, { assisted: true, detail: { assisted: 'x' } });
    });

    it('reports an undeclared disclosure as draft incompleteness', async () => {
      const undeclared = await createDefinition();
      assert.ok(undeclared.completeness.missing.includes('ai_assistance_disclosure'),
        'an authored draft with no declaration must be reported incomplete');

      const declared = await createDefinition({ aiAssisted: false });
      assert.ok(!declared.completeness.missing.includes('ai_assistance_disclosure'),
        'a declared draft must not be reported incomplete for disclosure');
    });
  });

  // -------------------------------------------------------------------------
  describe('APPROVAL — the disclosure is governed semantic state', () => {
    it('binds the approval fingerprint to the disclosure', async () => {
      assert.ok(MATERIAL_TEMPLATE_FIELDS.includes('ai_assisted'),
        'ai_assisted must be a material template field');
      assert.ok(MATERIAL_TEMPLATE_FIELDS.includes('ai_assistance_detail'),
        'ai_assistance_detail must be a material template field');

      const created = await createDefinition({ aiAssisted: false });
      const snapshot = await withConn(async (conn) => {
        const [template] = await conn.query(`SELECT * FROM task_templates WHERE id = ?`, [created.id]);
        const steps = await conn.query(
          `SELECT * FROM task_template_steps WHERE task_template_id = ? ORDER BY step_no`, [created.id]);
        const applicability = await conn.query(
          `SELECT equipment_type_id, is_primary FROM task_template_equipment_types
            WHERE task_template_id = ? ORDER BY equipment_type_id`, [created.id]);
        return { template, steps, applicability };
      });

      const base = computeContentSha(snapshot.template, snapshot.steps, snapshot.applicability);
      const sameAgain = computeContentSha(snapshot.template, snapshot.steps, snapshot.applicability);
      assert.strictEqual(base, sameAgain, 'an unchanged definition must fingerprint identically');

      const declared = {
        ...snapshot.template,
        ai_assisted: true,
        ai_assistance_detail: { assisted: 'x' }
      };
      assert.notStrictEqual(
        computeContentSha(declared, snapshot.steps, snapshot.applicability), base,
        'declaring AI assistance must change what the approver endorsed'
      );

      // The detail alone is material, not merely the flag: two AI-assisted
      // definitions that record different assistance are different claims.
      const otherDetail = { ...declared, ai_assistance_detail: { assisted: 'y' } };
      assert.notStrictEqual(
        computeContentSha(otherDetail, snapshot.steps, snapshot.applicability),
        computeContentSha(declared, snapshot.steps, snapshot.applicability),
        'changing what was assisted must change the fingerprint'
      );
    });

    it('stales an approval when the disclosure changes afterwards', async () => {
      const created = await createDefinition({ aiAssisted: false });
      await attachEvidence(created.id);
      await approveDefinition(created.id);

      const before = await rawDefinitionRow(created.id);
      assert.strictEqual(before.ai_assisted, false);

      // The authoring primitive correctly refuses to edit an approved record, so
      // the post-approval change is written directly. What is under test is that
      // PUBLICATION refuses to freeze a claim the approver never saw — admission,
      // not the editor, is the backstop.
      await withConn((conn) => conn.query(
        `UPDATE task_templates
            SET ai_assisted = TRUE, ai_assistance_detail = '{"assisted":"rewritten after approval"}'::jsonb
          WHERE id = ?`,
        [created.id]
      ));

      const rules = await refusalRules(() => publishDefinition(created.id));
      assert.deepStrictEqual(rules, ['APPROVAL_STALE'],
        'a disclosure changed after approval must stale the approval');

      const versions = await withConn((conn) => conn.query(
        `SELECT count(*)::int AS count FROM task_template_versions WHERE task_template_id = ?`,
        [created.id]
      ));
      assert.strictEqual(versions[0].count, 0, 'a refused publication writes no version');
    });
  });

  // -------------------------------------------------------------------------
  describe('PUBLICATION — admission and freezing', () => {
    it('refuses authored knowledge whose disclosure was never declared', async () => {
      const created = await createDefinition();
      await attachEvidence(created.id);
      await approveDefinition(created.id);

      const rules = await refusalRules(() => publishDefinition(created.id));
      assert.ok(rules, 'an undeclared authored definition must not publish');
      assert.strictEqual(rules.filter((r) => r === 'AI_DISCLOSURE_MISSING').length, 1,
        'exactly one AI_DISCLOSURE_MISSING failure must be raised');

      const versions = await withConn((conn) => conn.query(
        `SELECT count(*)::int AS count FROM task_template_versions WHERE task_template_id = ?`,
        [created.id]
      ));
      assert.strictEqual(versions[0].count, 0, 'a refused publication writes no version');
    });

    it('freezes an AI-assisted declaration into the version header and EVERY step version', async () => {
      // Three steps on purpose: "every step version carries the disclosure" cannot
      // be proven by a one-step fixture, which passes even if the loop only ever
      // handled its first iteration.
      const detail = { model: 'synthetic', assisted: 'drafted all three steps' };
      const created = await createDefinition({ aiAssisted: true, aiAssistanceDetail: detail }, 3);
      await attachEvidence(created.id);
      await approveDefinition(created.id);

      const result = await publishDefinition(created.id);
      const frozen = await frozenDisclosure(result.versionId);

      assert.strictEqual(frozen.header.ai_assisted, true);
      assert.deepStrictEqual(frozen.header.ai_assistance_detail, detail);
      assert.strictEqual(frozen.steps.length, 3, 'all three step versions must be frozen');
      assert.deepStrictEqual(frozen.steps.map((s) => s.step_no), [1, 2, 3]);
      for (const step of frozen.steps) {
        assert.strictEqual(step.ai_assisted, true, `step ${step.step_no} must disclose assistance`);
        assert.deepStrictEqual(step.ai_assistance_detail, detail,
          `step ${step.step_no} must carry the approved detail verbatim`);
      }
    });

    it('freezes a human declaration as FALSE with no detail, on every step version', async () => {
      const created = await createDefinition({ aiAssisted: false }, 2);
      await attachEvidence(created.id);
      await approveDefinition(created.id);

      const result = await publishDefinition(created.id);
      const frozen = await frozenDisclosure(result.versionId);

      assert.strictEqual(frozen.header.ai_assisted, false);
      assert.strictEqual(frozen.header.ai_assistance_detail, null);
      assert.strictEqual(frozen.steps.length, 2);
      for (const step of frozen.steps) {
        assert.strictEqual(step.ai_assisted, false, `step ${step.step_no} must carry FALSE`);
        assert.strictEqual(step.ai_assistance_detail, null);
      }
    });

    it('never lets a publisher assert a disclosure the approver did not see', async () => {
      const created = await createDefinition({ aiAssisted: false });
      await attachEvidence(created.id);
      await approveDefinition(created.id);

      // The retired publish-body AI parameters are inert at the model boundary.
      // The HTTP boundary refuses them outright (proved in the versioning suite),
      // so no path can attribute AI assistance to an approved human declaration.
      const result = await TaskTemplate.publishVersion(created.id, PUBLISHER, {
        publishedByOrganizationId: ORG,
        aiAssisted: true,
        aiAssistanceDetail: { model: 'inert' }
      });

      const frozen = await frozenDisclosure(result.versionId);
      assert.strictEqual(frozen.header.ai_assisted, false,
        'the frozen disclosure is the definition declaration, not the caller claim');
      assert.strictEqual(frozen.header.ai_assistance_detail, null);
    });

    it('leaves the content origin untouched by the disclosure', async () => {
      const created = await createDefinition({
        aiAssisted: true,
        aiAssistanceDetail: { assisted: 'drafted the step text' }
      });
      const definition = await authoring.loadAuthoredDefinition(created.id, { organizationId: ORG });
      assert.strictEqual(definition.content_origin, 'authored',
        'AI involvement never rewrites content origin: a human remains accountable');
      // `content_origin` is not writable through the authoring primitive either.
      await assert.rejects(
        () => authoring.updateGovernedDraft(created.id, { contentOrigin: 'ai_generated' }, { actorUserId: ACTOR, organizationId: ORG }),
        (error) => {
          assert.deepStrictEqual(error.failures.map((f) => f.rule), ['NO_WRITABLE_FIELDS']);
          return true;
        }
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('LEGACY — NULL is not FALSE', () => {
    /** The real admission input for a definition, exactly as publication assembles it. */
    async function admissionInput(templateId, overrides = {}) {
      return withConn(async (conn) => {
        const [template] = await conn.query(`SELECT * FROM task_templates WHERE id = ?`, [templateId]);
        const steps = await conn.query(
          `SELECT * FROM task_template_steps WHERE task_template_id = ? ORDER BY step_no`, [templateId]);
        const safetyControls = await conn.query(
          `SELECT * FROM task_template_safety_controls WHERE task_template_id = ?`, [templateId]);
        const applicability = await conn.query(
          `SELECT equipment_type_id, is_primary FROM task_template_equipment_types
            WHERE task_template_id = ? ORDER BY equipment_type_id`, [templateId]);
        const evidence = await conn.query(
          `SELECT * FROM knowledge_template_evidence
            WHERE task_template_id = ?
               OR task_template_step_id IN (SELECT id FROM task_template_steps WHERE task_template_id = ?)`,
          [templateId, templateId]);
        return {
          template: { ...template, ...overrides },
          steps,
          safetyControls,
          applicability,
          evidence,
          publisherUserId: PUBLISHER
        };
      });
    }

    it('exempts legacy-generated knowledge at the admission rule, and never fabricates its declaration', async () => {
      const created = await createDefinition({ aiAssisted: false });
      await attachEvidence(created.id);

      const legacyNull = await admissionInput(created.id, {
        content_origin: 'legacy_generated',
        ai_assisted: null,
        ai_assistance_detail: null
      });
      const legacyRules = validatePublicationAdmission(legacyNull).map((f) => f.rule);
      assert.ok(!legacyRules.includes('AI_DISCLOSURE_MISSING'),
        'legacy-generated knowledge is exempt: its NULL means "not captured", not "no AI"');

      // The exemption is narrow. The same snapshot as authored knowledge is refused,
      // and it is refused exactly once.
      const authoredNull = await admissionInput(created.id, {
        content_origin: 'authored',
        ai_assisted: null,
        ai_assistance_detail: null
      });
      const authoredRules = validatePublicationAdmission(authoredNull).map((f) => f.rule);
      assert.strictEqual(authoredRules.filter((r) => r === 'AI_DISCLOSURE_MISSING').length, 1,
        'authored knowledge without a declaration must be refused exactly once');

      // A legacy row that DOES carry a declaration is honoured, not overridden.
      const legacyDeclared = await admissionInput(created.id, {
        content_origin: 'legacy_generated',
        ai_assisted: false,
        ai_assistance_detail: null
      });
      const declaredRules = validatePublicationAdmission(legacyDeclared).map((f) => f.rule);
      assert.ok(!declaredRules.includes('AI_DISCLOSURE_MISSING'),
        'a truthful legacy declaration is not second-guessed');
    });

    it('publishes a genuine legacy_generated definition with NULL disclosure, frozen as NULL on every step', async () => {
      // End-to-end proof of the compatibility boundary. The rule-level test above
      // shows what admission decides about a snapshot; this one shows what the
      // governed publication path actually writes for a real legacy-classified
      // definition: NULL stays NULL — never FALSE — in the header and in EVERY
      // step version, and no AI_DISCLOSURE_MISSING is raised.
      const templateId = await createLegacyDefinition({ stepCount: 3 });
      const atRest = await rawDefinitionRow(templateId);
      // State the premise instead of leaving it inferable: this really is
      // legacy-generated knowledge, and it really is undeclared at rest.
      assert.strictEqual(atRest.content_origin, 'legacy_generated');
      assert.strictEqual(atRest.ai_assisted, null);
      assert.strictEqual(atRest.ai_assistance_detail, null);

      await attachEvidence(templateId);
      await approveDefinition(templateId);

      const result = await publishDefinition(templateId);
      const frozen = await frozenDisclosure(result.versionId);

      assert.strictEqual(frozen.header.ai_assisted, null,
        'legacy publication must not fabricate a disclosure');
      assert.strictEqual(frozen.header.ai_assistance_detail, null);
      assert.strictEqual(frozen.steps.length, 3, 'all legacy step versions must be frozen');
      for (const step of frozen.steps) {
        assert.strictEqual(step.ai_assisted, null,
          `legacy step ${step.step_no} must stay NULL, not FALSE`);
        assert.strictEqual(step.ai_assistance_detail, null);
      }

      const fabricated = await withConn((conn) => conn.query(
        `SELECT
           (SELECT count(*)::int FROM task_template_versions
             WHERE id = ? AND ai_assisted IS FALSE) AS header_false,
           (SELECT count(*)::int FROM task_template_step_versions
             WHERE task_template_version_id = ? AND ai_assisted IS FALSE) AS step_false`,
        [result.versionId, result.versionId]
      ));
      assert.strictEqual(fabricated[0].header_false, 0,
        'the frozen legacy header must not carry a fabricated FALSE');
      assert.strictEqual(fabricated[0].step_false, 0,
        'no frozen legacy step version may carry a fabricated FALSE');
    });

    it('raises no disclosure failure for any declared definition', async () => {
      const assisted = await createDefinition({
        aiAssisted: true,
        aiAssistanceDetail: { assisted: 'drafted the step text' }
      });
      await attachEvidence(assisted.id);
      const assistedRules = validatePublicationAdmission(await admissionInput(assisted.id)).map((f) => f.rule);
      assert.ok(!assistedRules.includes('AI_DISCLOSURE_MISSING'));

      const human = await createDefinition({ aiAssisted: false });
      await attachEvidence(human.id);
      const humanRules = validatePublicationAdmission(await admissionInput(human.id)).map((f) => f.rule);
      assert.ok(!humanRules.includes('AI_DISCLOSURE_MISSING'));
    });
  });
});
