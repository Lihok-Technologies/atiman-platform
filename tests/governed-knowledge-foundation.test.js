/**
 * ATM-001 M6.3 — Governed Knowledge Foundation (migration 020)
 *
 * Proves that migration 020 implements the ratified M6.3 schema and governance
 * mechanism exactly, and proves just as carefully what it refuses to do.
 *
 * WHY THIS SUITE PROVISIONS ITS OWN DATABASES
 *
 * Migration 020's legacy-corpus classification is a data-dependent path: it
 * behaves differently when the reconciled corpus is present, absent, partial or
 * inconsistent. The sanctioned suites share one database and none of them runs
 * the knowledge bootstrap, so a suite that assumed the corpus was present would
 * either never exercise classification or would collide with its neighbours.
 * Like tests/taxonomy-application.test.js and tests/migration-runner.test.js this
 * suite therefore creates DISPOSABLE databases, drives the REAL migration runner,
 * the REAL bootstrap, the REAL migration file and the REAL constraint triggers,
 * and drops every database afterwards.
 *
 * WHAT IS PROVEN
 *
 *   manifest      the 846 frozen identities in 020 equal the accepted M6.1
 *                 reconciliation artifact exactly (id and code)
 *   migration     fresh 001->020 applies; the chain is safe on a second run;
 *                 019 + corpus -> 020 classifies; statement-by-statement
 *                 application behaves identically to batch application
 *   fail-closed   absent corpus is an allowed no-op; partial and inconsistent
 *                 corpora FAIL and classify nothing; unrelated rows stay
 *                 unclassified; a second application mutates nothing
 *   governance    publication is refused without explicit scope, explicit origin,
 *                 legacy clearance, frozen evidence, safety reviewer attestation
 *                 or applicability - by direct SQL, so the invariants cannot be
 *                 bypassed by a caller that skips the service layer
 *   origin        content_origin is immutable once established and legacy
 *                 clearance never mutates it
 *   trigger       the four mechanisms are structurally distinct and a malformed
 *                 recommendation is unrepresentable; no date can be expressed
 *   scope         shared requires no organization, customer requires one,
 *                 marketplace is represented but non-assignable
 *   applicability several Equipment Types are explicit, and a published version's
 *                 frozen set does not move when the working set changes
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { isIntegrationTest } = require('../src/config/database');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating governed-knowledge-foundation suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'postgresql');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'migrate-postgres.js');
const BOOTSTRAP = path.join(REPO_ROOT, 'scripts', 'bootstrap-knowledge', 'bootstrap.js');
const MIGRATION_020 = path.join(MIGRATIONS_DIR, '020_governed_knowledge_foundation.sql');
const RECONCILIATION = path.join(
  REPO_ROOT, 'docs', 'research', 'm6r1', 'maintenance-procedure-reconciliation.jsonl');

const SERVER = {
  host: process.env.TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT),
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD
};

const EXPECTED = { manifest: 846, steps: 3099, minId: 1100, maxId: 1945 };

let dbCounter = 0;
const createdDatabases = [];
const uniqueDbName = () => `atiman_m6r3_test_${process.pid}_${++dbCounter}`;

function serverClient(database) {
  const pool = new Pool({ ...SERVER, database, max: 2 });
  return { pool, client: pool };
}

function dbEnv(database, extra = {}) {
  const env = { ...process.env, ...extra };
  // The migration runner and the bootstrap must never see test credentials.
  for (const key of ['TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER',
    'TEST_DB_PASSWORD', 'NODE_ENV', 'RUN_DB_TESTS']) {
    delete env[key];
  }
  // ATM-001 M6.3 R1 finding: the migration runner and the bootstrap resolve
  // connection configuration with libpq-style PG* variables taking precedence
  // over DB_*. An inherited PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD therefore
  // silently redirects these disposable subprocesses — and the bootstrap is
  // destructive — away from the database named here. Every libpq variable is
  // stripped so that DB_* below is unambiguous, and non-test connection
  // variables are stripped too so nothing ambient can leak through.
  for (const key of [
    'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGPASSFILE',
    'PGSSLMODE', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY', 'PGOPTIONS',
    'PGSERVICE', 'PGSERVICEFILE', 'PGCONNECT_TIMEOUT', 'PGAPPNAME', 'PGCLIENTENCODING',
    'DB_SSL', 'DB_SSL_REJECT_UNAUTHORIZED', 'DATABASE_URL', 'PGURL', 'POSTGRES_URL'
  ]) {
    delete env[key];
  }
  return {
    ...env,
    DB_HOST: SERVER.host, DB_PORT: String(SERVER.port), DB_NAME: database,
    DB_USER: SERVER.user, DB_PASSWORD: SERVER.password, PGSSL: 'false'
  };
}

async function createDatabase(name) {
  const { pool } = serverClient('postgres');
  try {
    await pool.query(`CREATE DATABASE ${name}`);
    createdDatabases.push(name);
  } finally {
    await pool.end();
  }
}

async function dropDatabase(name) {
  const { pool } = serverClient('postgres');
  try {
    await pool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [name]);
    await pool.query(`DROP DATABASE IF EXISTS ${name}`);
  } finally {
    await pool.end();
  }
}

async function dropAllCreated() {
  for (const name of createdDatabases.splice(0)) {
    try { await dropDatabase(name); } catch { /* best effort */ }
  }
}

function runRunner(database) {
  return spawnSync(process.execPath, [RUNNER], {
    cwd: REPO_ROOT, env: dbEnv(database), encoding: 'utf8', timeout: 300000
  });
}

function runBootstrap(database) {
  return spawnSync(process.execPath, [BOOTSTRAP], {
    cwd: REPO_ROOT, env: dbEnv(database), encoding: 'utf8', timeout: 300000
  });
}

const migrationFiles = () => fs.readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();

/** Apply every migration file up to and including `lastPrefix` (e.g. '019'). */
async function applyMigrationsThrough(pool, lastPrefix) {
  for (const file of migrationFiles()) {
    if (file.slice(0, 3) > lastPrefix) continue;
    await pool.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
}

/** Apply migration 020 exactly as committed, one statement batch per call. */
async function apply020(pool) {
  await pool.query(fs.readFileSync(MIGRATION_020, 'utf8'));
}

/** 001..019 plus the reconciled corpus, i.e. the pre-020 production shape. */
async function provisionPre020(name) {
  await createDatabase(name);
  const pool = new Pool({ ...SERVER, database: name, max: 4 });
  await applyMigrationsThrough(pool, '019');
  const boot = runBootstrap(name);
  assert.strictEqual(boot.status, 0, `bootstrap must succeed:\n${boot.stderr}`);
  return pool;
}

/** 001..019 with NO corpus loaded, i.e. a database where the corpus is absent. */
async function provisionBare019(name) {
  await createDatabase(name);
  const pool = new Pool({ ...SERVER, database: name, max: 4 });
  await applyMigrationsThrough(pool, '019');
  return pool;
}

/** The 846 (id, code) pairs frozen in migration 020's manifest literal. */
function manifestFromMigration() {
  const sql = fs.readFileSync(MIGRATION_020, 'utf8');
  const pairs = [];
  for (const line of sql.split('\n')) {
    const m = line.match(/^\s*'(\d+):([A-Z0-9_]+),?'\s*;?\s*$/);
    if (m) pairs.push([Number(m[1]), m[2]]);
  }
  return pairs;
}

/** The same identity set as accepted in the M6.1 reconciliation artifact. */
function manifestFromArtifact() {
  return fs.readFileSync(RECONCILIATION, 'utf8').trim().split('\n')
    .filter(Boolean).map((l) => JSON.parse(l))
    .map((r) => [r.template_id, r.template_code])
    .sort((a, b) => a[0] - b[0]);
}

/* -------------------------------------------------------------------------- */
/* Governed-publication fixture                                                */
/* -------------------------------------------------------------------------- */

const SEED_SQL = `
  INSERT INTO users (id, username, email, password_hash, full_name, role, status, is_active)
  VALUES (1,'m6r3_reviewer','r@example.test','x','Reviewer','admin','active',TRUE),
         (2,'m6r3_approver','a@example.test','x','Approver','admin','active',TRUE),
         (3,'m6r3_publisher','p@example.test','x','Publisher','admin','active',TRUE),
         (4,'m6r3_safety','s@example.test','x','Safety','admin','active',TRUE)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO organizations (id, organization_name) VALUES (1,'M6R3 Tenant') ON CONFLICT (id) DO NOTHING;
  INSERT INTO equipment_categories (id, category_code, category_name) VALUES (1,'M6R3CAT','M6R3 Cat') ON CONFLICT (id) DO NOTHING;
  INSERT INTO equipment_classes (id, category_id, class_code, class_name) VALUES (1,1,'M6R3CLS','M6R3 Class') ON CONFLICT (id) DO NOTHING;
  INSERT INTO equipment_types (id, class_id, type_code, type_name) VALUES (1,1,'M6R3TYPE','M6R3 Type'),
                                                                        (2,1,'M6R3TYPE2','M6R3 Type 2')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO knowledge_sources (id, source_code, source_category, default_title)
  VALUES (1,'M6R3-SRC','engineering_authored','M6R3 source') ON CONFLICT (id) DO NOTHING;
  INSERT INTO knowledge_source_versions (id, knowledge_source_id, version_designation, title)
  VALUES (1,1,'v1','M6R3 source v1') ON CONFLICT (id) DO NOTHING;
`;

const idOf = async (pool, table, code) => {
  const col = table === 'knowledge_types' ? 'type_code' : 'family_code';
  const { rows } = await pool.query(`SELECT id FROM ${table} WHERE ${col} = $1`, [code]);
  assert.strictEqual(rows.length, 1, `${table}.${code} must be seeded by migration 020`);
  return rows[0].id;
};

/**
 * Build a fully governed, publishable Maintenance Procedure.
 * Any piece named in `omit` is deliberately left out so the admission rules can
 * be falsified one at a time. Fixture ids start at 100 to stay clear of the
 * reconciled legacy corpus (1100..1945).
 */
async function seedGoverned(pool, omit = [], seq = 0, opts = {}) {
  await pool.query(SEED_SQL);
  const typeId = await idOf(pool, 'knowledge_types', 'MAINTENANCE_PROCEDURE');
  const familyId = await idOf(pool, 'task_families', 'inspect');
  const has = (k) => !omit.includes(k);
  // Origin and publisher must be chosen at creation: content_origin is immutable
  // once established, and published versions cannot be updated.
  const origin = opts.origin === undefined ? 'authored' : opts.origin;
  const publisherUserId = opts.publisher === undefined ? 3 : opts.publisher;

  // Published versions are immutable and cannot be deleted (pre-existing 009
  // trigger), so each invocation uses a fresh id block rather than cleaning up.
  const templateId = 100 + (seq * 10);
  const versionId = 200 + (seq * 10);
  const stepId = 9001 + seq;

  const cols = ['id', 'equipment_type_id', 'template_code', 'template_name', 'maintenance_type',
    'review_state', 'submitted_for_review_by_user_id', 'submitted_for_review_at',
    'reviewed_at', 'reviewer_user_id', 'approver_user_id', 'approved_at',
    'approved_content_sha', 'content_origin'];
  const vals = [templateId, 1, 'M6R3_GOVERNED', 'M6R3 Governed Procedure', 'preventive',
    'approved', 1, new Date(),
    new Date(), 1, 2, new Date(), 'sha-m6r3', origin];
  const add = (c, v) => { cols.push(c); vals.push(v); };

  if (has('knowledge_type')) add('knowledge_type_id', typeId);
  if (has('task_family')) add('task_family_id', familyId);
  if (has('strategy')) add('maintenance_strategy', 'preventive');
  if (has('trigger')) { add('trigger_mechanism', 'calendar'); add('frequency_value', 1); add('frequency_unit', 'month'); }
  if (has('trigger_basis')) add('trigger_basis_source_version_id', 1);
  if (has('scope')) add('knowledge_scope', 'shared');
  if (opts.clearance) {
    add('legacy_clearance_by_user_id', 1);
    add('legacy_clearance_at', new Date());
    add('legacy_clearance_rationale', 'reviewed and accepted');
  }

  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await pool.query(`INSERT INTO task_templates (${cols.join(', ')}) VALUES (${placeholders})`, vals);

  // The frozen step version references a working step row, so the working step
  // must exist first (pre-existing 009 foreign key).
  await pool.query(`INSERT INTO task_template_steps
    (id, task_template_id, step_no, step_type, instruction)
    VALUES ($2, $1, 1, 'instruction', 'M6R3 working step')`, [templateId, stepId]);

  if (has('applicability')) {
    await pool.query(
      'INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary) VALUES ($1,$2,TRUE)',
      [templateId, 1]);
  }

  // The version must be assembled unsealed, given a step version, then sealed -
  // the pre-existing 009 seal model.
  await pool.query(`
    INSERT INTO task_template_versions
      (id, task_template_id, version_number, equipment_type_id, template_name, maintenance_type,
       lifecycle_state_at_publish, published_by_user_id, published_at,
       knowledge_type_id, task_family_id, maintenance_strategy, trigger_mechanism,
       trigger_condition_parameter, trigger_condition_operator, trigger_condition_value,
       trigger_condition_unit, trigger_event_description, trigger_condition_context,
       frequency_value, frequency_unit, trigger_basis_source_version_id,
       knowledge_scope, organization_id,
       reviewer_user_id, reviewed_at, approver_user_id, approved_at, approved_content_sha,
       safety_review_state, safety_reviewed_by_user_id, safety_reviewed_at)
    VALUES ($1,$2,1,1,'M6R3 Governed Procedure','preventive','published',$18,CURRENT_TIMESTAMP,
            $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
            1,CURRENT_TIMESTAMP,2,CURRENT_TIMESTAMP,'sha-m6r3',
            'reviewed_no_control_required',4,CURRENT_TIMESTAMP)`,
  [versionId, templateId,
    has('knowledge_type') ? typeId : null,
    has('task_family') ? familyId : null,
    has('strategy') ? 'preventive' : null,
    has('trigger') ? 'calendar' : null,
    null, null, null, null, null, null,
    has('trigger') ? 1 : null,
    has('trigger') ? 'month' : null,
    has('trigger_basis') ? 1 : null,
    has('scope') ? 'shared' : null,
    null, publisherUserId]);

  // The frozen applicability is part of the published snapshot, exactly as the
  // frozen step set is; publication records it at the same atomic boundary.
  if (has('applicability')) {
    await pool.query(`INSERT INTO task_template_version_equipment_types
      (task_template_version_id, equipment_type_id, is_primary) VALUES ($1,1,TRUE)`, [versionId]);
  }

  await pool.query(`
    INSERT INTO task_template_step_versions
      (id, task_template_version_id, step_no, task_template_step_id, step_type, instruction)
    VALUES ($2,$1,1,$3,'instruction','M6R3 governed step')`, [versionId, 300 + (seq * 10), stepId]);

  if (opts.safetyControl) {
    const sc = await pool.query(`INSERT INTO task_template_safety_controls
      (task_template_id, safety_type, description) VALUES ($1,'PPE','generic control') RETURNING id`,
      [templateId]);
    await pool.query(`INSERT INTO task_template_safety_control_versions
      (task_template_version_id, task_template_safety_control_id, safety_type, description)
      VALUES ($1,$2,'PPE','generic control')`, [versionId, sc.rows[0].id]);
  }

  if (has('evidence')) {
    await pool.query(`
      INSERT INTO knowledge_template_version_evidence
        (task_template_version_id, knowledge_source_version_id, supporting_role)
      VALUES ($1,1,'primary')`, [versionId]);
  }

  await pool.query('UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1', [versionId]);
  return { templateId, versionId, typeId, familyId };
}

const messageOf = (err) => String(err && err.message ? err.message : err);

/**
 * Build and COMMIT a complete governed fixture in a single transaction.
 * Publication admission is a deferred constraint trigger, so assembling the
 * fixture across autocommitted statements would be judged prematurely.
 */
async function commitGovernedFixture(pool, omit = [], seq = 0, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = await seedGoverned(client, omit, seq, opts);
    await client.query('COMMIT');
    return ids;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Replace any existing fixture rows with a fresh governed fixture. */
async function resetGovernedFixture(pool, omit = [], seq = 0) {
  await pool.query('DELETE FROM task_template_versions WHERE task_template_id = 100');
  await pool.query('DELETE FROM task_template_equipment_types WHERE task_template_id = 100');
  await pool.query('DELETE FROM task_templates WHERE id = 100');
  return commitGovernedFixture(pool, omit, seq);
}

/* -------------------------------------------------------------------------- */

describe('Governed knowledge foundation (ATM-001 M6.3, migration 020)',
  { skip: DB_TEST_SKIP_REASON }, () => {
    after(async () => { await dropAllCreated(); });

    /* ---------------- manifest ---------------- */

    describe('frozen legacy manifest', () => {
      it('contains exactly the 846 identities accepted in the M6.1 artifact', () => {
        const fromMigration = manifestFromMigration().sort((a, b) => a[0] - b[0]);
        const fromArtifact = manifestFromArtifact();
        assert.strictEqual(fromMigration.length, EXPECTED.manifest,
          'the migration must freeze exactly 846 identities');
        assert.strictEqual(fromArtifact.length, EXPECTED.manifest,
          'the accepted M6.1 artifact must carry exactly 846 records');
        assert.deepStrictEqual(fromMigration, fromArtifact,
          'every (id, code) pair in the migration must equal the artifact');
        assert.strictEqual(new Set(fromMigration.map((p) => p[0])).size, EXPECTED.manifest,
          'identities must be unique');
      });

      it('is the contiguous ratified interval and uses no proxy predicate', () => {
        const ids = manifestFromMigration().map((p) => p[0]).sort((a, b) => a - b);
        assert.strictEqual(ids[0], EXPECTED.minId);
        assert.strictEqual(ids[ids.length - 1], EXPECTED.maxId);
        const sql = fs.readFileSync(MIGRATION_020, 'utf8');
        const classification = sql.slice(sql.indexOf('PART 10'));
        // Strip comment lines, then prove no rejected proxy appears in executable SQL.
        const executable = classification.split('\n')
          .filter((l) => !l.trim().startsWith('--')).join('\n');
        for (const banned of ['created_at', 'created_by', 'seed_batch_id', 'is_system',
          'LIKE']) {
          assert.ok(!executable.includes(banned),
            `classification executable SQL must not use the ${banned} proxy`);
        }
      });
    });

    /* ---------------- migration application ---------------- */

    describe('migration application', () => {
      it('applies 001 -> 020 on a fresh database and seeds the vocabularies', async () => {
        const name = uniqueDbName();
        await createDatabase(name);
        const pool = new Pool({ ...SERVER, database: name, max: 4 });
        try {
          const run = runRunner(name);
          assert.strictEqual(run.status, 0, `fresh chain must succeed:\n${run.stdout}\n${run.stderr}`);
          assert.match(run.stdout, /SUCCESS: 20\/20 migration\(s\) applied\./);

          const tables = await pool.query(
            `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN
             ('knowledge_types','task_families','task_template_equipment_types',
              'task_template_version_equipment_types')`);
          assert.strictEqual(tables.rowCount, 4, 'all four M6.3 tables must exist');

          const types = await pool.query('SELECT type_code FROM knowledge_types ORDER BY id');
          assert.deepStrictEqual(types.rows.map((r) => r.type_code),
            ['MAINTENANCE_PROCEDURE', 'INSPECTION_TEMPLATE']);

          const families = await pool.query('SELECT family_code FROM task_families ORDER BY sort_order');
          assert.deepStrictEqual(families.rows.map((r) => r.family_code),
            ['inspect', 'verify_safety', 'test_measure', 'lubricate', 'clean', 'adjust', 'replace']);
        } finally {
          await pool.end();
        }
      });

      it('is safe to run twice, and running twice mutates nothing', async () => {
        const name = uniqueDbName();
        await createDatabase(name);
        const pool = new Pool({ ...SERVER, database: name, max: 4 });
        try {
          assert.strictEqual(runRunner(name).status, 0);
          const before = await pool.query(
            `SELECT (SELECT count(*) FROM knowledge_types) t, (SELECT count(*) FROM task_families) f,
                    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) g,
                    (SELECT count(*) FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace) c`);
          const second = runRunner(name);
          assert.strictEqual(second.status, 0, `second chain run must succeed:\n${second.stderr}`);
          const after = await pool.query(
            `SELECT (SELECT count(*) FROM knowledge_types) t, (SELECT count(*) FROM task_families) f,
                    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) g,
                    (SELECT count(*) FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace) c`);
          assert.deepStrictEqual(after.rows[0], before.rows[0],
            'a second run must not create duplicate vocabulary rows, triggers or constraints');
        } finally {
          await pool.end();
        }
      });

      it('treats an absent corpus as an allowed no-op', async () => {
        const name = uniqueDbName();
        const pool = await provisionBare019(name);
        try {
          await apply020(pool);
          const r = await pool.query(
            `SELECT (SELECT count(*) FROM task_templates WHERE content_origin IS NOT NULL) classified,
                    (SELECT count(*) FROM task_template_equipment_types) junction`);
          assert.strictEqual(Number(r.rows[0].classified), 0,
            'an absent corpus must classify nothing and must not fail');
          assert.strictEqual(Number(r.rows[0].junction), 0);
        } finally {
          await pool.end();
        }
      });
    });

    /* ---------------- classification ---------------- */

    describe('legacy corpus classification', () => {
      it('classifies exactly the 846 reconciled identities and nothing else', async () => {
        const name = uniqueDbName();
        const pool = await provisionPre020(name);
        try {
          await apply020(pool);
          const r = await pool.query(`
            SELECT (SELECT count(*) FROM task_templates) total,
                   (SELECT count(*) FROM task_templates WHERE content_origin='legacy_generated') legacy,
                   (SELECT count(*) FROM task_templates WHERE content_origin IS NULL) unclassified,
                   (SELECT count(*) FROM task_templates WHERE content_origin='authored') authored,
                   (SELECT count(*) FROM task_templates
                     WHERE content_origin='legacy_generated' AND id BETWEEN $1 AND $2) in_interval`,
          [EXPECTED.minId, EXPECTED.maxId]);
          const row = r.rows[0];
          assert.strictEqual(Number(row.total), EXPECTED.manifest);
          assert.strictEqual(Number(row.legacy), EXPECTED.manifest);
          assert.strictEqual(Number(row.unclassified), 0);
          assert.strictEqual(Number(row.authored), 0);
          assert.strictEqual(Number(row.in_interval), EXPECTED.manifest);
        } finally {
          await pool.end();
        }
      });

      it('never silently assigns ownership scope, knowledge type, family or trigger', async () => {
        const name = uniqueDbName();
        const pool = await provisionPre020(name);
        try {
          await apply020(pool);
          const r = await pool.query(`
            SELECT count(*)::int n FROM task_templates
             WHERE knowledge_scope IS NULL AND knowledge_type_id IS NULL
               AND task_family_id IS NULL AND trigger_mechanism IS NULL`);
          assert.strictEqual(r.rows[0].n, EXPECTED.manifest,
            'absence of a scope must not become a shared classification, and absence of '
            + 'provenance must not become an authorship claim');
        } finally {
          await pool.end();
        }
      });

      it('backfills applicability from the declared Equipment Type without remapping', async () => {
        const name = uniqueDbName();
        const pool = await provisionPre020(name);
        try {
          await apply020(pool);
          const r = await pool.query(`
            SELECT (SELECT count(*) FROM task_template_equipment_types) junction,
                   (SELECT count(*) FROM task_template_equipment_types WHERE is_primary) primary_count,
                   (SELECT count(*) FROM task_template_equipment_types x
                      JOIN task_templates t ON t.id = x.task_template_id
                     WHERE x.is_primary AND x.equipment_type_id = t.equipment_type_id) matches,
                   (SELECT count(DISTINCT equipment_type_id) FROM task_template_equipment_types) types`);
          const row = r.rows[0];
          assert.strictEqual(Number(row.junction), EXPECTED.manifest);
          assert.strictEqual(Number(row.primary_count), EXPECTED.manifest,
            'exactly one primary anchor per definition');
          assert.strictEqual(Number(row.matches), EXPECTED.manifest,
            'declared applicability must be copied verbatim, never resolved');
          assert.ok(Number(row.types) > 1, 'the corpus spans many Equipment Types');
        } finally {
          await pool.end();
        }
      });

      it('preserves 846 definitions, 3,099 steps and every legacy content field', async () => {
        const name = uniqueDbName();
        const pool = await provisionPre020(name);
        try {
          const before = await pool.query(`
            SELECT (SELECT count(*)::int FROM task_templates) templates, (SELECT count(*)::int FROM task_template_steps) steps,
                   (SELECT count(*)::int FROM task_templates WHERE frequency_type='monthly') freq,
                   (SELECT count(*)::int FROM task_templates WHERE start_date IS NOT NULL) start_date,
                   (SELECT count(*)::int FROM task_templates WHERE maintenance_type='preventive') maint,
                   (SELECT md5(string_agg(id::text || template_name || maintenance_type, '|' ORDER BY id))
                      FROM task_templates) fingerprint`);
          await apply020(pool);
          const after = await pool.query(`
            SELECT (SELECT count(*)::int FROM task_templates) templates, (SELECT count(*)::int FROM task_template_steps) steps,
                   (SELECT count(*)::int FROM task_templates WHERE frequency_type='monthly') freq,
                   (SELECT count(*)::int FROM task_templates WHERE start_date IS NOT NULL) start_date,
                   (SELECT count(*)::int FROM task_templates WHERE maintenance_type='preventive') maint,
                   (SELECT md5(string_agg(id::text || template_name || maintenance_type, '|' ORDER BY id))
                      FROM task_templates) fingerprint`);
          assert.deepStrictEqual(after.rows[0], before.rows[0],
            'migration 020 must not delete, rewrite or reclassify legacy content');
          assert.strictEqual(Number(after.rows[0].steps), EXPECTED.steps);
          assert.strictEqual(Number(after.rows[0].templates), EXPECTED.manifest);
        } finally {
          await pool.end();
        }
      });

      it('fails closed and classifies nothing when the corpus is PARTIAL', async () => {
        const name = uniqueDbName();
        const pool = await provisionPre020(name);
        try {
          await pool.query('DELETE FROM task_templates WHERE id = 1400');
          await assert.rejects(() => apply020(pool), (err) => {
            assert.match(messageOf(err), /PARTIAL or INCONSISTENT/);
            return true;
          });
          // The whole file is one transaction, so a failed classification must leave
          // the schema exactly as it was: no new column, and therefore nothing
          // partially classified.
          const r = await pool.query(`
            SELECT (SELECT count(*)::int FROM information_schema.columns
                     WHERE table_name='task_templates' AND column_name='content_origin') col,
                   (SELECT count(*)::int FROM task_templates) templates`);
          assert.strictEqual(r.rows[0].col, 0,
            'a failed classification must roll back the schema change entirely');
          assert.strictEqual(r.rows[0].templates, 845,
            'the corpus itself must be untouched by a refused classification');
        } finally {
          await pool.end();
        }
      });

      it('fails closed when an identity is INCONSISTENT (id present, code altered)', async () => {
        const name = uniqueDbName();
        const pool = await provisionPre020(name);
        try {
          await pool.query("UPDATE task_templates SET template_code = 'TAMPERED' WHERE id = 1600");
          await assert.rejects(() => apply020(pool), (err) => {
            // R1 remediation made the message precise: one reserved identity is
            // present but does not match exactly, which is distinct from a partial
            // corpus. The invariant under test — refuse and classify nothing — is
            // unchanged.
            assert.match(messageOf(err), /INCONSISTENT/);
            return true;
          });
          const r = await pool.query(`
            SELECT (SELECT count(*)::int FROM information_schema.columns
                     WHERE table_name='task_templates' AND column_name='content_origin') col,
                   (SELECT count(*)::int FROM task_templates) templates`);
          assert.strictEqual(r.rows[0].col, 0,
            'a failed classification must roll back the schema change entirely');
          assert.strictEqual(r.rows[0].templates, 846,
            'the corpus itself must be untouched by a refused classification');
        } finally {
          await pool.end();
        }
      });

      it('leaves unrelated authored rows unclassified when the corpus is absent', async () => {
        const name = uniqueDbName();
        const pool = await provisionBare019(name);
        try {
          await pool.query(SEED_SQL);
          await pool.query(`
            INSERT INTO task_templates (id, equipment_type_id, template_name, maintenance_type, task_kind)
            VALUES (9001, 1, 'Unrelated authored draft', 'preventive', 'inspection')`);
          await apply020(pool);
          const r = await pool.query(`
            SELECT (SELECT count(*)::int FROM task_templates WHERE id = 9001
                      AND content_origin IS NULL) unclassified,
                   (SELECT count(*)::int FROM task_templates WHERE content_origin='legacy_generated') legacy,
                   (SELECT count(*)::int FROM task_template_equipment_types) junction`);
          assert.strictEqual(r.rows[0].unclassified, 1,
            'an unrelated row must never be marked as legacy-generated');
          assert.strictEqual(r.rows[0].legacy, 0);
          assert.strictEqual(r.rows[0].junction, 0);
        } finally {
          await pool.end();
        }
      });

      it('fails closed when a frozen identity is present with a non-ratified code and nothing matches exactly', async () => {
        // ATM-001 M6.3 VUDA R1 finding: presence used to be decided by the count
        // of EXACT (id, code) matches. A corpus consisting of a reserved identity
        // whose code had been altered therefore produced an exact-match count of
        // zero, which was indistinguishable from a genuinely absent corpus — so
        // the migration reported success, classified nothing, and backfilled no
        // applicability. Presence is now decided by identity id, and exactness by
        // the full identity, so this case fails closed.
        const name = uniqueDbName();
        const pool = await provisionBare019(name);
        try {
          await pool.query(SEED_SQL);
          const [[firstId]] = manifestFromMigration();

          // Exactly one frozen identity, with a code that is not its ratified one.
          await pool.query(
            `INSERT INTO task_templates (id, equipment_type_id, template_code, template_name,
               maintenance_type, task_kind)
             VALUES ($1, 1, 'NOT_THE_RATIFIED_CODE', 'Tampered reserved identity',
               'preventive', 'inspection')`, [firstId]);

          await assert.rejects(() => apply020(pool), (err) => {
            assert.match(messageOf(err), /INCONSISTENT/);
            assert.match(messageOf(err), /reserved identity carries a non-ratified code/);
            return true;
          });

          // Rollback: the whole file is one transaction, so a refused
          // classification must leave the schema and the corpus exactly as they
          // were. The column check comes first and on its own: `content_origin` not
          // existing IS the rollback proof, so it cannot be referenced in the same
          // statement that asserts its absence.
          const col = await pool.query(`
            SELECT count(*)::int AS n FROM information_schema.columns
             WHERE table_name='task_templates' AND column_name='content_origin'`);
          assert.strictEqual(col.rows[0].n, 0,
            'a refused classification must roll back the schema change entirely');

          const corpus = await pool.query(`SELECT count(*)::int AS n FROM task_templates`);
          assert.strictEqual(corpus.rows[0].n, 1,
            'the corpus itself must be untouched by a refused classification');
        } finally {
          await pool.end();
        }
      });

      it('fails closed when every present identity carries a non-ratified code', async () => {
        // The systemic form of the same defect: a corpus that sits entirely on
        // reserved identities whose codes were all altered. An exact-match-only
        // presence test would again see zero and silently no-op.
        const name = uniqueDbName();
        const pool = await provisionPre020(name);
        try {
          await pool.query(
            `UPDATE task_templates SET template_code = template_code || '_ALTERED'`);

          await assert.rejects(() => apply020(pool), (err) => {
            assert.match(messageOf(err), /INCONSISTENT|PARTIAL or INCONSISTENT/);
            return true;
          });

          const r = await pool.query(`
            SELECT (SELECT count(*)::int FROM information_schema.columns
                     WHERE table_name='task_templates' AND column_name='content_origin') col,
                   (SELECT count(*)::int FROM task_templates) templates`);
          assert.strictEqual(r.rows[0].col, 0, 'the schema change must roll back entirely');
          assert.strictEqual(r.rows[0].templates, EXPECTED.manifest,
            'the corpus must be untouched by a refused classification');
        } finally {
          await pool.end();
        }
      });

      it('still treats a genuinely absent corpus as an allowed no-op', async () => {
        // The counterpart of the two tests above: the absent-corpus no-op must
        // remain valid, so the fix distinguishes absence from inconsistency rather
        // than refusing everything that is not a complete corpus.
        const name = uniqueDbName();
        const pool = await provisionBare019(name);
        try {
          await pool.query(SEED_SQL);
          await apply020(pool);

          const r = await pool.query(`
            SELECT (SELECT count(*)::int FROM task_templates) templates,
                   (SELECT count(*)::int FROM task_template_equipment_types) junction`);
          assert.strictEqual(r.rows[0].templates, 0, 'no corpus was present');
          assert.strictEqual(r.rows[0].junction, 0, 'no applicability may be backfilled');
        } finally {
          await pool.end();
        }
      });

      it('does not let inherited libpq configuration redirect disposable subprocesses', async () => {
        // ATM-001 M6.3 VUDA R1 finding: the migration runner and the knowledge
        // bootstrap resolve configuration with PG* taking precedence over DB_*.
        // An inherited PGDATABASE therefore redirected these disposable
        // subprocesses — and the bootstrap is destructive — away from the database
        // they were given.
        //
        // A canary database stands in for the ambient target. The test proves the
        // canary is never touched, so no hostile target is ever contacted in
        // effect: the assertion is that its contents are unchanged.
        const canary = uniqueDbName();
        await createDatabase(canary);
        const canaryPool = new Pool({ ...SERVER, database: canary, max: 1 });
        const canaryBefore = await canaryPool.query(`
          SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`);
        await canaryPool.end();

        const hostile = {
          PGHOST: SERVER.host,
          PGPORT: String(SERVER.port),
          PGDATABASE: canary,
          PGUSER: SERVER.user,
          PGPASSWORD: SERVER.password
        };
        const saved = {};
        for (const key of Object.keys(hostile)) saved[key] = process.env[key];

        try {
          Object.assign(process.env, hostile);

          // 1. Structural: the disposable environment carries no libpq variable,
          //    so DB_* below is unambiguous.
          const env = dbEnv('some_intended_database');
          for (const key of Object.keys(hostile)) {
            assert.strictEqual(env[key], undefined,
              `${key} must not be inherited by a disposable subprocess`);
          }
          assert.strictEqual(env.DB_NAME, 'some_intended_database');

          // 2. Functional: a spawned runner still targets the database it was
          //    given, and the ambient target is left untouched.
          const intended = uniqueDbName();
          await createDatabase(intended);
          const result = runRunner(intended);
          assert.strictEqual(result.status, 0,
            `the runner must succeed against the database it was given:\n${result.stderr}`);

          const check = new Pool({ ...SERVER, database: canary, max: 1 });
          const canaryAfter = await check.query(`
            SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`);
          await check.end();
          assert.strictEqual(canaryAfter.rows[0].n, canaryBefore.rows[0].n,
            'inherited libpq configuration must not redirect a disposable subprocess');

          // 3. And the intended database really was migrated, so the run above is
          //    not a vacuous success.
          const intendedCheck = new Pool({ ...SERVER, database: intended, max: 1 });
          const migrated = await intendedCheck.query(`
            SELECT count(*)::int AS n FROM information_schema.columns
             WHERE table_name='task_templates' AND column_name='content_origin'`);
          await intendedCheck.end();
          assert.strictEqual(migrated.rows[0].n, 1,
            'the intended disposable database must have received the migration');
        } finally {
          for (const key of Object.keys(hostile)) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
          }
        }
      });

      it('re-applying over a complete corpus mutates no classification', async () => {
        const name = uniqueDbName();
        const pool = await provisionPre020(name);
        try {
          await apply020(pool);
          await apply020(pool);
          const r = await pool.query(`
            SELECT (SELECT count(*)::int FROM task_templates WHERE content_origin='legacy_generated') legacy,
                   (SELECT count(*)::int FROM task_template_equipment_types) junction,
                   (SELECT count(*)::int FROM task_template_steps) steps`);
          assert.strictEqual(r.rows[0].legacy, EXPECTED.manifest);
          assert.strictEqual(r.rows[0].junction, EXPECTED.manifest);
          assert.strictEqual(r.rows[0].steps, EXPECTED.steps);
        } finally {
          await pool.end();
        }
      });
    });

    /* ---------------- governance ---------------- */

    describe('publication admission is enforced in the database', () => {
      let pool;
      let seq = 0;

      before(async () => {
        const name = uniqueDbName();
        const p = await provisionPre020(name);
        await apply020(p);
        await p.query(SEED_SQL);
        pool = p;
      });
      after(async () => { if (pool) await pool.end(); });

      // Every case gets a fresh, committed, fully governed fixture. Published
      // versions are immutable and cannot be deleted, so cases never clean up.
      const fresh = async () => { seq += 1; return commitGovernedFixture(pool, [], seq); };

      /** Expect a refusal whose message matches `pattern`. */
      const expectRefusal = async (label, omit, pattern) => {
        seq += 1;
        await assert.rejects(
          () => commitGovernedFixture(pool, omit, seq),
          (err) => {
            assert.match(messageOf(err), pattern,
              `unexpected refusal reason for ${label}: ${messageOf(err)}`);
            return true;
          });
      };

      it('admits a fully governed version (control case)', async () => {
        const ids = await fresh();
        const r = await pool.query(`
          SELECT v.knowledge_type_id, v.task_family_id, v.maintenance_strategy,
                 v.trigger_mechanism, v.knowledge_scope, v.is_step_set_sealed,
                 (SELECT count(*)::int FROM task_template_version_equipment_types x
                   WHERE x.task_template_version_id = v.id) applicability,
                 (SELECT count(*)::int FROM knowledge_template_version_evidence e
                   WHERE e.task_template_version_id = v.id) evidence
            FROM task_template_versions v WHERE v.id = $1`, [ids.versionId]);
        const row = r.rows[0];
        assert.ok(row.knowledge_type_id && row.task_family_id && row.maintenance_strategy);
        assert.strictEqual(row.trigger_mechanism, 'calendar');
        assert.strictEqual(row.knowledge_scope, 'shared');
        assert.strictEqual(row.is_step_set_sealed, true);
        assert.strictEqual(row.applicability, 1);
        assert.strictEqual(row.evidence, 1);
      });

      it('refuses publication without an explicit knowledge scope', async () => {
        await expectRefusal('explicit scope', ['scope'], /governed_knowledge_required|scope/);
      });
      it('refuses publication without an explicit knowledge type', async () => {
        await expectRefusal('explicit knowledge type', ['knowledge_type'],
          /governed_knowledge_required|knowledge_type/);
      });
      it('refuses publication without an explicit task family', async () => {
        await expectRefusal('explicit task family', ['task_family'],
          /governed_knowledge_required|task_family/);
      });
      it('refuses publication when frozen evidence is absent', async () => {
        await expectRefusal('frozen evidence', ['evidence'], /frozen evidence/);
      });
      it('refuses publication when applicability is absent', async () => {
        await expectRefusal('applicability', ['applicability'], /applicability/);
      });
      it('refuses publication without a trigger basis when a trigger is asserted', async () => {
        await expectRefusal('trigger basis', ['trigger_basis'],
          /trigger_basis_required|trigger_basis/);
      });
      it('refuses publication when the parent origin is not established', async () => {
        seq += 1;
        await assert.rejects(
          () => commitGovernedFixture(pool, [], seq, { origin: null }),
          (err) => {
            assert.match(messageOf(err), /origin is not established|content_origin/,
              `unexpected refusal: ${messageOf(err)}`);
            return true;
          });
      });
      it('refuses publication when the parent is uncleared legacy-generated content', async () => {
        seq += 1;
        await assert.rejects(
          () => commitGovernedFixture(pool, [], seq, { origin: 'legacy_generated' }),
          (err) => {
            assert.match(messageOf(err), /clearance|origin_requires_authorship/,
              `unexpected refusal: ${messageOf(err)}`);
            return true;
          });
      });
      it('allows a legacy-generated candidate once an accountable clearance is recorded', async () => {
        seq += 1;
        const ids = await commitGovernedFixture(pool, [], seq,
          { origin: 'legacy_generated', clearance: true });
        const r = await pool.query(
          'SELECT content_origin, legacy_clearance_by_user_id FROM task_templates WHERE id = $1',
          [ids.templateId]);
        assert.strictEqual(r.rows[0].content_origin, 'legacy_generated',
          'clearance must never mutate the recorded origin');
        assert.strictEqual(r.rows[0].legacy_clearance_by_user_id, 1,
          'clearance must remain attributable to an accountable principal');
      });
      it('refuses a safety-control set that is not attested as defined', async () => {
        seq += 1;
        // The version carries a safety control while the safety reviewer attested
        // only that no control was required. The attestation is a single statement
        // over the control set; it does not assert per-control provenance.
        await assert.rejects(
          () => commitGovernedFixture(pool, [], seq, { safetyControl: true }),
          (err) => {
            assert.match(messageOf(err), /safety_review_state|attestation/,
              `unexpected refusal: ${messageOf(err)}`);
            return true;
          });
      });
      it('preserves the pre-existing approver/publisher segregation', async () => {
        seq += 1;
        // approver is user 2; publishing as the same principal must be refused
        await assert.rejects(
          () => commitGovernedFixture(pool, [], seq, { publisher: 2 }),
          (err) => {
            assert.match(messageOf(err), /approver|publisher/i,
              `unexpected refusal: ${messageOf(err)}`);
            return true;
          });
      });
    });

    /* ---------------- origin immutability ---------------- */

    describe('content origin', () => {
      let pool;
      before(async () => {
        const name = uniqueDbName();
        const p = await provisionPre020(name);
        await apply020(p);
        pool = p;
      });
      after(async () => { if (pool) await pool.end(); });

      it('cannot be changed once established', async () => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await seedGoverned(c, []);
          await c.query('COMMIT');
        } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }

        await assert.rejects(
          () => pool.query("UPDATE task_templates SET content_origin='legacy_generated' WHERE id=100"),
          (err) => { assert.match(messageOf(err), /immutable/); return true; });
      });

      it('rejects an origin value outside the permitted vocabulary', async () => {
        await assert.rejects(
          () => pool.query("UPDATE task_templates SET content_origin='synthetic' WHERE id=100"),
          (err) => { assert.match(messageOf(err), /content_origin|immutable/); return true; });
      });
    });

    /* ---------------- trigger model ---------------- */

    describe('trigger recommendation model', () => {
      let pool;
      before(async () => {
        const name = uniqueDbName();
        const p = await provisionPre020(name);
        await apply020(p);
        pool = p;
      });
      after(async () => { if (pool) await pool.end(); });

      const insertDraft = (cols) => {
        const base = `INSERT INTO task_templates
          (id, equipment_type_id, template_name, maintenance_type, content_origin`;
        const values = [900, 1, 'trigger probe', 'preventive', 'authored'];
        const keys = Object.keys(cols);
        keys.forEach((k) => { base.concat(); });
        const sql = `${base}${keys.length ? ', ' + keys.join(', ') : ''})
          VALUES ($1,$2,$3,$4,$5${keys.map((_, i) => `,$${i + 6}`).join('')})`;
        return pool.query(sql, [...values, ...keys.map((k) => cols[k])]);
      };
      const clear = () => pool.query('DELETE FROM task_templates WHERE id = 900');

      it('accepts calendar/runtime magnitude + unit', async () => {
        await clear();
        await insertDraft({ trigger_mechanism: 'calendar', frequency_value: 1, frequency_unit: 'month' });
      });
      it('accepts a structured condition criterion', async () => {
        await clear();
        await insertDraft({ trigger_mechanism: 'condition_based', trigger_condition_parameter: 'parameter',
          trigger_condition_operator: 'gt', trigger_condition_value: 1, trigger_condition_unit: 'unit' });
      });
      it('accepts an event description', async () => {
        await clear();
        await insertDraft({ trigger_mechanism: 'event', trigger_event_description: 'after an occurrence' });
      });
      it('accepts the explicit absence of a fixed interval', async () => {
        await clear();
        await insertDraft({ trigger_mechanism: 'no_fixed_interval' });
      });
      it('rejects a condition trigger without a structured criterion', async () => {
        await clear();
        await assert.rejects(() => insertDraft({ trigger_mechanism: 'condition_based' }),
          (err) => { assert.match(messageOf(err), /trigger|check/i); return true; });
      });
      it('rejects an interval trigger without a magnitude', async () => {
        await clear();
        await assert.rejects(() => insertDraft({ trigger_mechanism: 'calendar' }),
          (err) => { assert.match(messageOf(err), /trigger|check/i); return true; });
      });
      it('rejects an event trigger that carries a criterion', async () => {
        await clear();
        await assert.rejects(() => insertDraft({ trigger_mechanism: 'event',
          trigger_event_description: 'x', trigger_condition_parameter: 'p' }),
        (err) => { assert.match(messageOf(err), /trigger|check/i); return true; });
      });
      it('adds no date, due-date or scheduled-occurrence column to any knowledge table', async () => {
        const r = await pool.query(`
          SELECT table_name, column_name, data_type FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name IN ('task_templates','task_template_versions',
                                'task_template_equipment_types','task_template_version_equipment_types',
                                'task_template_steps','task_template_safety_controls')
             AND data_type IN ('date','timestamp with time zone','timestamp without time zone')
             AND column_name NOT IN ('created_at','updated_at','start_date',
                                       'submitted_for_review_at','reviewed_at','approved_at',
                                       'safety_reviewed_at','published_at','legacy_clearance_at')`);
        // Every permitted timestamp above is an audit instant for a governance event
        // (submission, review, approval, safety review, publication, legacy clearance),
        // or the deprecated legacy start_date. None is a due date, next-due date or
        // scheduled occurrence, and 020 adds no new one.
        assert.strictEqual(r.rowCount, 0,
          `migration 020 may not add a scheduling date to a knowledge table: ${JSON.stringify(r.rows)}`);
      });
    });

    /* ---------------- scope ---------------- */

    describe('knowledge scope', () => {
      let pool;
      before(async () => {
        const name = uniqueDbName();
        const p = await provisionPre020(name);
        await apply020(p);
        await p.query(SEED_SQL);
        pool = p;
      });
      after(async () => { if (pool) await pool.end(); });

      const insertScoped = (scope, orgId) => pool.query(
        `INSERT INTO task_templates
           (id, equipment_type_id, template_name, maintenance_type, content_origin, knowledge_scope, organization_id)
         VALUES (901,1,'scope probe','preventive','authored',$1,$2)`, [scope, orgId]);

      it('requires shared to carry no organization', async () => {
        await pool.query('DELETE FROM task_templates WHERE id = 901');
        await assert.rejects(() => insertScoped('shared', 1),
          (err) => { assert.match(messageOf(err), /scope|check/i); return true; });
      });
      it('requires customer to carry an organization', async () => {
        await pool.query('DELETE FROM task_templates WHERE id = 901');
        await assert.rejects(() => insertScoped('customer', null),
          (err) => { assert.match(messageOf(err), /scope|check/i); return true; });
      });
      it('accepts an intentionally selected shared scope with no organization', async () => {
        await pool.query('DELETE FROM task_templates WHERE id = 901');
        await insertScoped('shared', null);
      });
      it('accepts customer scope bound to an organization', async () => {
        await pool.query('DELETE FROM task_templates WHERE id = 901');
        await insertScoped('customer', 1);
      });
      it('keeps marketplace represented in the vocabulary but non-assignable', async () => {
        await pool.query('DELETE FROM task_templates WHERE id = 901');
        await assert.rejects(() => insertScoped('marketplace', null),
          (err) => { assert.match(messageOf(err), /marketplace|scope|check/i); return true; });
      });
      it('declares no database default for knowledge scope or content origin', async () => {
        const r = await pool.query(`
          SELECT table_name, column_name, column_default FROM information_schema.columns
           WHERE table_schema='public'
             AND ((column_name='knowledge_scope' AND table_name IN
                     ('task_templates','task_template_versions','knowledge_packs','knowledge_pack_versions'))
               OR (column_name='content_origin' AND table_name='task_templates'))
             AND column_default IS NOT NULL`);
        assert.strictEqual(r.rowCount, 0,
          `a scope or origin default would silently classify an omission: ${JSON.stringify(r.rows)}`);
      });
    });

    /* ---------------- applicability ---------------- */

    describe('equipment-type applicability', () => {
      let pool;
      before(async () => {
        const name = uniqueDbName();
        const p = await provisionPre020(name);
        await apply020(p);
        await p.query(SEED_SQL);
        await commitGovernedFixture(p, []);
        pool = p;
      });
      after(async () => { if (pool) await pool.end(); });

      it('represents several Equipment Types explicitly, with one primary anchor', async () => {
        await pool.query(`INSERT INTO task_template_equipment_types
          (task_template_id, equipment_type_id, is_primary) VALUES (100,2,FALSE)`);
        const r = await pool.query(
          'SELECT count(*)::int n FROM task_template_equipment_types WHERE task_template_id = 100');
        assert.strictEqual(r.rows[0].n, 2,
          'a second Equipment Type must be representable as an explicit additional row');
        const prim = await pool.query(
          'SELECT count(*)::int n FROM task_template_equipment_types WHERE task_template_id = 100 AND is_primary');
        assert.strictEqual(prim.rows[0].n, 1, 'exactly one primary anchor is permitted');
        const types = await pool.query(
          'SELECT equipment_type_id FROM task_template_equipment_types WHERE task_template_id = 100 ORDER BY equipment_type_id');
        assert.deepStrictEqual(types.rows.map((x) => x.equipment_type_id), [1, 2],
          'applicability must be explicit - no class or category inference');
      });

      it('forbids a second primary anchor', async () => {
        await assert.rejects(
          () => pool.query(`INSERT INTO task_template_equipment_types
            (task_template_id, equipment_type_id, is_primary) VALUES (100,1,TRUE)`),
          (err) => { assert.match(messageOf(err), /duplicate|unique/i); return true; });
      });

      it('keeps a published version frozen when the working applicability changes', async () => {
        const before = await pool.query(
          'SELECT count(*)::int n FROM task_template_version_equipment_types WHERE task_template_version_id = 200');
        await pool.query('DELETE FROM task_template_equipment_types WHERE task_template_id = 100');
        const after = await pool.query(
          'SELECT count(*)::int n FROM task_template_version_equipment_types WHERE task_template_version_id = 200');
        assert.deepStrictEqual(after.rows[0], before.rows[0],
          'the frozen applicability of a published version must not follow the working set');
      });
    });
  });
