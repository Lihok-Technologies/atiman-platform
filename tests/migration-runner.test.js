/**
 * PostgreSQL migration runner safety tests
 *
 * Proves the production migration path is safe BEFORE it is ever pointed at a
 * real database. Every case here runs the real `scripts/migrate-postgres.js`
 * as a subprocess against a disposable PostgreSQL 17 server, using databases
 * this suite creates and drops.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 *
 * IMPORTANT: the migration runner deliberately REFUSES to run when TEST_DB_* is
 * present, when NODE_ENV=test, or when RUN_DB_TESTS=true. This suite therefore
 * builds a clean child environment for every runner invocation, which is also
 * what proves those refusals work.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { isIntegrationTest } = require('../src/config/database');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'migrate-postgres.js');
const SMOKE_TEST = path.join(REPO_ROOT, 'scripts', 'smoke-test-pg.js');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'postgresql');

// Schema fingerprint after the complete migration chain. This is an intentional
// drift detector, so it must be updated deliberately whenever the chain adds or
// removes a table — a mismatch here means the applied schema is not the schema
// the repository describes.
const EXPECTED_BASE_TABLES = 81;   // 75 through migration 013, +1 in 014 (pack membership),
                                   // +1 in 016 (external_classification, ATM-001 M5R.3B),
                                   // +1 in 017 (crosswalk, ATM-001 M5R.3C),
                                   // +1 in 018 (crosswalk evidence, ATM-001 M5R.3D),
                                   // +2 in 019 (identity resolution + governed terminology,
                                   //           ATM-001 M5R.4B — mechanism only, no rows)
const EXPECTED_VIEWS = 6;

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating migration-runner suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// The disposable server this suite drives. Comes from TEST_DB_* only.
const SERVER = {
  host: process.env.TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT),
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD
};

const CREATED_DATABASES = [];

/** Connect to the disposable server (never to a specific migrated database). */
async function serverClient(database) {
  const client = new Client({ ...SERVER, database, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

/**
 * Build a clean environment for a runner invocation.
 *
 * The runner must never be driven by test credentials, so TEST_DB_* and the
 * test opt-ins are explicitly removed and the DB_* aliases are provided
 * instead. This is intentional: it is what a real deployment does.
 */
function runnerEnv(overrides = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('TEST_DB_')) delete env[name];
  }
  delete env.NODE_ENV;
  delete env.RUN_DB_TESTS;
  delete env.PGHOST; delete env.PGPORT; delete env.PGDATABASE;
  delete env.PGUSER; delete env.PGPASSWORD; delete env.PGSSLMODE;
  delete env.DB_SSL; delete env.DB_SSL_REJECT_UNAUTHORIZED;
  return { ...env, ...overrides };
}

function runRunner(database, extraEnv = {}) {
  return spawnSync(process.execPath, [RUNNER], {
    encoding: 'utf8',
    env: runnerEnv({
      DB_HOST: SERVER.host,
      DB_PORT: String(SERVER.port),
      DB_NAME: database,
      DB_USER: SERVER.user,
      DB_PASSWORD: SERVER.password,
      ...extraEnv
    }),
    timeout: 300000
  });
}

/**
 * Asynchronously spawn the runner and resolve with its result.
 *
 * `spawnSync` cannot express concurrency — it blocks the event loop — so the
 * concurrency test needs a real async spawn to have two processes alive at once.
 */
function spawnRunnerAsync(database) {
  const { spawn } = require('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUNNER], {
      env: runnerEnv({
        DB_HOST: SERVER.host,
        DB_PORT: String(SERVER.port),
        DB_NAME: database,
        DB_USER: SERVER.user,
        DB_PASSWORD: SERVER.password
      })
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.on('error', (error) => resolve({ status: -1, stdout, stderr: `${stderr}\n${error.message}` }));
  });
}

function runSmokeTest(database, extraEnv = {}) {
  return spawnSync(process.execPath, [SMOKE_TEST], {
    encoding: 'utf8',
    env: runnerEnv({
      DB_HOST: SERVER.host,
      DB_PORT: String(SERVER.port),
      DB_NAME: database,
      DB_USER: SERVER.user,
      DB_PASSWORD: SERVER.password,
      ...extraEnv
    }),
    timeout: 120000
  });
}

let dbCounter = 0;
const uniqueDbName = () => `atiman_migration_safety_${process.pid}_${++dbCounter}`;

async function createDatabase(name) {
  const admin = await serverClient('postgres');
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    CREATED_DATABASES.push(name);
  } finally {
    await admin.end();
  }
}

async function dropDatabase(name) {
  const admin = await serverClient('postgres');
  try {
    // Terminate leftovers so DROP cannot be blocked by an idle connection.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name]
    );
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  } finally {
    await admin.end();
  }
}

/** Fresh empty database, ready for migration. */
async function freshDatabase() {
  const name = uniqueDbName();
  await createDatabase(name);
  return name;
}

async function queryOne(database, sql, params = []) {
  const client = await serverClient(database);
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function scalar(database, sql, params = []) {
  const rows = await queryOne(database, sql, params);
  return rows.length ? Object.values(rows[0])[0] : null;
}

/** Apply migrations 001..012 only, to simulate the pre-M1 production state. */
async function applyThrough012(database) {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.*\.sql$/.test(name))
    .filter((name) => Number(name.slice(0, 3)) <= 12)
    .sort();
  assert.strictEqual(files.length, 12, 'expected 12 migrations at or below 012');

  const client = await serverClient(database);
  try {
    for (const file of files) {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/** Minimum legacy state equivalent to the production corpus assumptions. */
async function seedLegacyTemplate(database) {
  const client = await serverClient(database);
  try {
    await client.query(`
      INSERT INTO equipment_categories (id, category_code, category_name)
      VALUES (991001, 'LEGCAT', 'Legacy Category') ON CONFLICT (id) DO NOTHING;
      INSERT INTO equipment_classes (id, category_id, class_code, class_name)
      VALUES (991002, 991001, 'LEGCLS', 'Legacy Class') ON CONFLICT (id) DO NOTHING;
      INSERT INTO equipment_types (id, class_id, type_code, type_name)
      VALUES (991003, 991002, 'LEGTP', 'Legacy Type') ON CONFLICT (id) DO NOTHING;
      INSERT INTO task_templates (id, equipment_type_id, template_code, template_name, maintenance_type,
        frequency_value, frequency_unit, priority)
      VALUES (991004, 991003, 'LEG-T1', 'Legacy Candidate Template', 'preventive', 1, 'month', 'medium')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO task_template_steps (id, task_template_id, step_no, step_type, instruction, is_required)
      VALUES (991005, 991004, 1, 'instruction', 'Legacy step', true) ON CONFLICT (id) DO NOTHING;
    `);
  } finally {
    await client.end();
  }
}

describe('PostgreSQL migration runner safety', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    // Fail loudly rather than silently skipping if the disposable server is not
    // actually reachable through TEST_DB_*.
    const client = await serverClient(process.env.TEST_DB_NAME);
    try {
      await client.query('SELECT 1');
    } finally {
      await client.end();
    }
  });

  after(async () => {
    for (const name of CREATED_DATABASES) {
      await dropDatabase(name).catch(() => {});
    }
  });

  // ------------------------------------------------------- A. fresh database
  describe('A. fresh database', () => {
    it('applies every discovered migration to a fresh PostgreSQL 17 database', async () => {
      const db = await freshDatabase();
      const result = runRunner(db);

      assert.strictEqual(result.status, 0, `runner failed:\n${result.stdout}\n${result.stderr}`);

      const discovered = fs.readdirSync(MIGRATIONS_DIR)
        .filter((name) => /^\d{3}_.*\.sql$/.test(name)).length;
      assert.ok(
        result.stdout.includes(`discovered : ${discovered} migration(s)`),
        `expected ${discovered} migrations to be discovered`
      );
      assert.ok(result.stdout.includes(`SUCCESS: ${discovered}/${discovered} migration(s) applied.`));

      // Expected final fingerprint, proven from catalog objects rather than a count alone.
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'`), EXPECTED_BASE_TABLES);
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM information_schema.views WHERE table_schema='public'`), EXPECTED_VIEWS);
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname='chk_task_template_versions_requires_governance'`), 1);
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname='chk_task_template_versions_approver_not_publisher'`), 1);
    });

    it('applies migrations in ascending filename order', async () => {
      const db = await freshDatabase();
      const result = runRunner(db);
      assert.strictEqual(result.status, 0, result.stderr);

      const order = [...result.stdout.matchAll(/applying (\d{3}_[^\s]+\.sql)/g)].map((m) => m[1]);
      const sorted = [...order].sort();
      assert.deepStrictEqual(order, sorted, 'migrations were not applied in ascending filename order');
      assert.ok(order.length > 0, 'no migrations were reported as applied');
    });
  });

  // --------------------------------------------------- B. re-application
  describe('B. re-application', () => {
    it('re-applies the whole chain successfully and leaves the schema coherent', async () => {
      const db = await freshDatabase();
      assert.strictEqual(runRunner(db).status, 0);

      const second = runRunner(db);
      assert.strictEqual(second.status, 0, `re-application failed:\n${second.stdout}\n${second.stderr}`);
      assert.ok(second.stdout.includes('SUCCESS:'), 'expected a success summary on re-application');

      // No duplicate-object failure, and the fingerprint is unchanged.
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'`), EXPECTED_BASE_TABLES);
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname='chk_task_template_versions_requires_governance'`), 1);
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname='fk_task_template_versions_published_by'`), 1);
    });
  });

  // ------------------------------------------------------ C. atomic failure
  describe('C. atomic failure', () => {
    it('rolls migration 013 back and leaves no partial convergence when it fails', async () => {
      const db = await freshDatabase();
      await applyThrough012(db);

      // The authentic 013 failure mode: a database still at 012 that already
      // contains a published template version created by the pre-M1 code path.
      // 013 adds the governance columns (all NULL for existing rows) and then
      // validates them, so such a row is rejected and the migration must fail
      // closed rather than publish ungoverned knowledge.
      //
      // The governance columns do not exist at 012, which is the point: this is
      // a legacy published row, not a governed one.
      const client = await serverClient(db);
      try {
        await client.query(`
          INSERT INTO organizations (id, organization_name) VALUES (991100, 'Migration Safety Org') ON CONFLICT DO NOTHING;
          INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
          VALUES (991101, 'mig-safety-legacy', 'mig-safety-legacy@test.local', 'x', 'Legacy Publisher', 'admin', 991100, true)
          ON CONFLICT (id) DO NOTHING;
          INSERT INTO equipment_categories (id, category_code, category_name) VALUES (991201, 'MSCAT', 'MS Cat') ON CONFLICT DO NOTHING;
          INSERT INTO equipment_classes (id, category_id, class_code, class_name) VALUES (991202, 991201, 'MSCLS', 'MS Cls') ON CONFLICT DO NOTHING;
          INSERT INTO equipment_types (id, class_id, type_code, type_name) VALUES (991203, 991202, 'MSTP', 'MS Type') ON CONFLICT DO NOTHING;
          INSERT INTO task_templates (id, equipment_type_id, organization_id, template_code, template_name, maintenance_type, frequency_value, frequency_unit, priority)
          VALUES (991301, 991203, 991100, 'MS-T1', 'MS Template', 'preventive', 1, 'month', 'medium') ON CONFLICT DO NOTHING;
          INSERT INTO task_template_steps (id, task_template_id, step_no, step_type, instruction, is_required)
          VALUES (991302, 991301, 1, 'instruction', 'step', true) ON CONFLICT DO NOTHING;
        `);

        // A published version at schema level 012: no governance attribution
        // columns exist yet. Assembled unsealed, step version added, then sealed
        // in one transaction, as migrations 009's triggers require.
        await client.query('BEGIN');
        const version = await client.query(`
          INSERT INTO task_template_versions (
            task_template_id, version_number, equipment_type_id, template_name, maintenance_type,
            lifecycle_state_at_publish, is_step_set_sealed, published_by_user_id, published_at)
          VALUES (991301, 1, 991203, 'Legacy published version', 'preventive', 'published', FALSE, 991101, NOW())
          RETURNING id
        `);
        await client.query(`
          INSERT INTO task_template_step_versions (task_template_version_id, step_no, task_template_step_id, step_type, instruction)
          VALUES ($1, 1, 991302, 'instruction', 'legacy step version')
        `, [version.rows[0].id]);
        await client.query(`UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = $1`, [version.rows[0].id]);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }

      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM task_template_versions WHERE lifecycle_state_at_publish='published'`), 1,
        'fixture must contain one legacy published version');

      const result = runRunner(db);

      // Fail closed.
      assert.notStrictEqual(result.status, 0, 'runner must exit non-zero when a migration fails');
      assert.ok(
        result.stderr.includes('013_knowledge_governance_admission.sql'),
        `expected the failing file to be named:\n${result.stderr}`
      );
      assert.ok(
        result.stderr.includes('transaction rolled back'),
        `expected an explicit rollback report:\n${result.stderr}`
      );
      assert.ok(
        result.stderr.includes('Later migrations were NOT attempted.'),
        'runner must stop rather than continue past a failure'
      );

      // No partial migration-013 convergence. These are the additive objects
      // 013 would have created inside its transaction; none may survive.
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM information_schema.columns
        WHERE table_schema='public' AND table_name='task_templates' AND column_name='review_state'`), 0,
        'migration 013 left a partial effect: task_templates.review_state exists after a failed run');
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM information_schema.columns
        WHERE table_schema='public' AND table_name='task_template_versions' AND column_name='approver_user_id'`), 0,
        'migration 013 left a partial effect on task_template_versions');
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname='chk_task_template_versions_requires_governance'`), 0,
        'migration 013 left a partial constraint behind');
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname='fk_task_template_versions_published_by'`), 1,
        'the pre-existing publisher FK must be untouched by the rolled-back run');

      // Migrations before the failure remain applied, and existing data is intact.
      assert.strictEqual(result.stderr.includes('Applied before this failure: none'), false,
        'expected the earlier migrations to be reported as applied');
      assert.strictEqual(await scalar(db, `SELECT COUNT(*)::int FROM task_template_versions`), 1,
        'pre-existing data must be preserved by a failed migration run');
    });
  });

  // ---------------------------------------- D. production-like 012 -> 013
  describe('D. production-like existing state (012 -> 013)', () => {
    it('applies 013 over an existing 012 schema and preserves legacy template data', async () => {
      const db = await freshDatabase();
      await applyThrough012(db);
      await seedLegacyTemplate(db);

      const before = await scalar(db, `SELECT COUNT(*)::int FROM task_templates`);
      assert.strictEqual(before, 1);

      const result = runRunner(db);
      assert.strictEqual(result.status, 0, `runner failed:\n${result.stdout}\n${result.stderr}`);

      // Legacy data preserved.
      assert.strictEqual(await scalar(db, `SELECT COUNT(*)::int FROM task_templates`), before,
        'existing template data must be preserved');
      assert.strictEqual(await scalar(db, `SELECT COUNT(*)::int FROM task_template_steps`), 1);

      // Governance defaults applied to the pre-existing row.
      const row = (await queryOne(db, `
        SELECT review_state, safety_review_state FROM task_templates WHERE id = 991004`))[0];
      assert.strictEqual(row.review_state, 'draft',
        'legacy templates must enter the draft governance state, not an approved one');
      assert.strictEqual(row.safety_review_state, 'not_assessed',
        'legacy templates must enter the not_assessed safety state, not a reviewed one');

      // M1 objects present.
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname='chk_task_template_versions_requires_governance'`), 1);
    });
  });

  // ------------------------------------------------------- E. FK convergence
  describe('E. publisher FK convergence', () => {
    it('converges the publisher FK to ON DELETE RESTRICT while preserving data', async () => {
      const db = await freshDatabase();
      await applyThrough012(db);
      await seedLegacyTemplate(db);

      // Simulate a pre-013 database whose publisher FK is still SET NULL, with a
      // governed version row already present.
      const client = await serverClient(db);
      try {
        await client.query('BEGIN');
        await client.query(`ALTER TABLE task_template_versions DROP CONSTRAINT fk_task_template_versions_published_by`);
        await client.query(`
          ALTER TABLE task_template_versions ADD CONSTRAINT fk_task_template_versions_published_by
          FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE SET NULL`);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }

      assert.strictEqual(await scalar(db, `
        SELECT confdeltype::text FROM pg_constraint WHERE conname='fk_task_template_versions_published_by'`), 'n',
        'fixture should start in the SET NULL state');

      const result = runRunner(db);
      assert.strictEqual(result.status, 0, `runner failed:\n${result.stdout}\n${result.stderr}`);

      assert.strictEqual(await scalar(db, `
        SELECT confdeltype::text FROM pg_constraint WHERE conname='fk_task_template_versions_published_by'`), 'r',
        'publisher FK must converge to RESTRICT');
      assert.strictEqual(await scalar(db, `SELECT COUNT(*)::int FROM task_templates`), 1,
        'convergence must preserve existing data');
    });
  });

  // ---------------------------------------------------------- F. refusal tests
  describe('F. configuration refusal (fail before connecting)', () => {
    it('refuses with no configuration at all', async () => {
      const env = runnerEnv();
      delete env.DB_HOST; delete env.DB_NAME; delete env.DB_USER; delete env.DB_PASSWORD;
      const result = spawnSync(process.execPath, [RUNNER], { encoding: 'utf8', env, timeout: 30000 });
      assert.strictEqual(result.status, 2, 'expected exit code 2 (configuration refused)');
      assert.ok(/missing required PostgreSQL configuration/.test(result.stderr));
    });

    it('refuses when TEST_DB_* is present, even with valid DB_* configuration', async () => {
      const result = runRunner('atiman_migration_safety_never_created', {
        TEST_DB_HOST: SERVER.host,
        TEST_DB_NAME: 'atiman_test',
        TEST_DB_USER: SERVER.user,
        TEST_DB_PASSWORD: SERVER.password
      });
      assert.strictEqual(result.status, 2, 'TEST_DB_* must prevent execution entirely');
      assert.ok(/TEST_DB_\* configuration is present/.test(result.stderr));
    });

    it('refuses when NODE_ENV=test', async () => {
      const result = runRunner('atiman_migration_safety_never_created', { NODE_ENV: 'test' });
      assert.strictEqual(result.status, 2);
      assert.ok(/NODE_ENV=test/.test(result.stderr));
    });

    it('refuses when RUN_DB_TESTS=true', async () => {
      const result = runRunner('atiman_migration_safety_never_created', { RUN_DB_TESTS: 'true' });
      assert.strictEqual(result.status, 2);
      assert.ok(/RUN_DB_TESTS=true/.test(result.stderr));
    });

    it('never falls back to a default host, database, or user', async () => {
      const env = runnerEnv({ DB_PASSWORD: 'x' });
      delete env.DB_HOST; delete env.DB_NAME; delete env.DB_USER;
      const result = spawnSync(process.execPath, [RUNNER], { encoding: 'utf8', env, timeout: 30000 });
      assert.strictEqual(result.status, 2);
      assert.ok(!/localhost/.test(result.stdout + result.stderr), 'must not default to localhost');
      assert.ok(!/odm_cmms/.test(result.stdout + result.stderr), 'must not default to odm_cmms');
    });

    it('never reads database/migrations (legacy MySQL directory)', async () => {
      const source = fs.readFileSync(RUNNER, 'utf8');
      // The runner may only reference database/postgresql.
      assert.ok(!/require\([^)]*database\/migrations/.test(source));
      assert.ok(!/readdirSync\([^)]*database['"]\s*,\s*['"]migrations/.test(source));

      const db = await freshDatabase();
      const result = runRunner(db);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(!/mysql/i.test(result.stdout), 'runner output must not mention MySQL tooling');

      // No legacy MySQL-era artifact leaked into the PostgreSQL schema.
      assert.strictEqual(await scalar(db, `SELECT COUNT(*)::int FROM information_schema.tables
        WHERE table_schema='public' AND table_name='seed_tracking'`), 0);
      assert.strictEqual(await scalar(db, `SELECT COUNT(*)::int FROM information_schema.tables
        WHERE table_schema='public' AND table_name='schema_migrations'`), 0,
        'no migration tracking table must be introduced');
    });
  });

  // ------------------------------------------------------ G. concurrent execution
  describe('G. concurrent execution', () => {
    it('serializes two concurrent runs against the same database without error', async () => {
      const db = await freshDatabase();

      // Genuinely concurrent: both child processes are started before either
      // exit is awaited, so the advisory lock is exercised for real.
      const [first, second] = await Promise.all([
        spawnRunnerAsync(db),
        spawnRunnerAsync(db)
      ]);

      assert.strictEqual(first.status, 0, `first concurrent run failed:\n${first.stdout}\n${first.stderr}`);
      assert.strictEqual(second.status, 0, `second concurrent run failed:\n${second.stdout}\n${second.stderr}`);

      // The schema is coherent afterwards: exactly one of each converged object.
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname='chk_task_template_versions_requires_governance'`), 1);
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM pg_constraint
        WHERE conname='fk_task_template_versions_published_by'`), 1);
      assert.strictEqual(await scalar(db, `
        SELECT COUNT(*)::int FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'`), EXPECTED_BASE_TABLES);
    });
  });

  // ------------------------------------------------------ H. stale schema
  describe('H. stale schema detection', () => {
    it('rejects an 008-level schema when migration execution is skipped', async () => {
      const db = await freshDatabase();

      // Apply only 001-008, the level the original deploy helper reached.
      const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter((name) => /^\d{3}_.*\.sql$/.test(name))
        .filter((name) => Number(name.slice(0, 3)) <= 8)
        .sort();
      const client = await serverClient(db);
      try {
        for (const file of files) {
          await client.query('BEGIN');
          await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
          await client.query('COMMIT');
        }
      } finally {
        await client.end();
      }

      const result = runSmokeTest(db);

      assert.notStrictEqual(result.status, 0,
        'a migration-008 schema must NOT pass the readiness gate');
      assert.ok(
        /schema readiness FAILED/i.test(result.stdout + result.stderr),
        `expected a readiness failure:\n${result.stdout}\n${result.stderr}`
      );
      // Name the M1 objects it is missing, rather than only a table count.
      assert.ok(/knowledge_packs|task_template_versions|requires_governance/.test(result.stdout + result.stderr));
    });

    it('passes the readiness gate on a fully migrated database', async () => {
      const db = await freshDatabase();
      assert.strictEqual(runRunner(db).status, 0);

      const result = runSmokeTest(db);
      assert.strictEqual(result.status, 0, `smoke test failed:\n${result.stdout}\n${result.stderr}`);
      assert.ok(/Schema readiness:/.test(result.stdout));
      assert.ok(/PostgreSQL smoke test PASSED/.test(result.stdout));
    });

    it('is read-only: the readiness gate cannot mutate the database', async () => {
      const db = await freshDatabase();
      assert.strictEqual(runRunner(db).status, 0);

      const before = await scalar(db, `
        SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public'`);
      const result = runSmokeTest(db);
      assert.strictEqual(result.status, 0);
      const after = await scalar(db, `
        SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public'`);
      assert.strictEqual(after, before);
    });
  });
});
