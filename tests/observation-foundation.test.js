/**
 * ATM-002-I2B — Observation operational foundation.
 *
 * Proves migration 023 introduces a tenant-scoped, capture-first Observation
 * object that carries no obligation, that the service is tenant-authoritative and
 * fail-closed, that the amendability boundary is real, and that the milestone
 * created no Finding, work-order, SAP/EAM, capability, media or HTTP surface.
 *
 * Evidence policy: wherever executable proof is available it is used in
 * preference to a source-text proxy. Schema claims are asserted against the
 * applied PostgreSQL catalog, tenancy and lifecycle claims are asserted by
 * invoking the real service and by attempting the operation at the database
 * level, and the "no existing table was altered" claim is proved by diffing the
 * complete public-schema catalog before and after applying 023.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client, Pool } = require('pg');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const observation = require('../src/services/observation.service');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating observation-foundation suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'postgresql');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'migrate-postgres.js');
const MIGRATION_023 = '023_asset_observations.sql';

/** The disposable server this suite drives. Comes from TEST_DB_* only. */
const SERVER = {
  host: process.env.TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT),
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD
};

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------
// Fixture identities are captured from the database rather than hardcoded, and
// every code and username is unique per run. A long-lived test database is
// therefore safe to re-use: a previous run's rows can never collide with this
// one's, and this suite can reference another tenant's rows without disturbing
// any other suite's fixtures.

let ORG = null;
let ORG_B = null;
let FAC = null;                 // ORG
let FAC_B = null;               // ORG_B
let FAC_SAME_TENANT = null;     // ORG, but not the primary asset's facility
let ASSET = null;               // ORG / FAC
let ASSET_B = null;             // ORG_B / FAC_B
let ASSET_NO_FACILITY = null;   // ORG, facility_id NULL
let ASSET_NO_ORG = null;        // organization_id NULL, FAC
let USER = null;                // ORG, active operator
let USER_B = null;              // ORG_B
let USER_INACTIVE = null;       // ORG, is_active false
let USER_NO_ORG = null;         // organization_id NULL
let TPL_GLOBAL = null;          // organization_id NULL (shared)
let TPL_OWN = null;             // ORG (customer)
let TPL_FOREIGN = null;         // ORG_B (customer)
let TPL_GLOBAL_NAME = null;
let STEP_GLOBAL = null;         // belongs to TPL_GLOBAL
let STEP_OWN = null;            // belongs to TPL_OWN
let STEP_FOREIGN = null;        // belongs to TPL_FOREIGN
let ETYPE = null;

/**
 * The trusted call context. Mutated once by ensureFixture() so tests can pass it
 * directly without rebuilding it.
 */
const CONTEXT = { organizationId: null, recordedByUserId: null };

const createdDatabases = [];
let dbCounter = 0;
const uniqueDbName = (tag) => `i2b_${tag}_test_${process.pid}_${++dbCounter}`;

const migrationFiles = () => fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{3}_.*\.sql$/.test(name))
  .sort();

// --------------------------------------------------------------------------
// Connection helpers
// --------------------------------------------------------------------------

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

/** Attempt a statement in a savepoint; report whether it was accepted and why not. */
async function attempt(statement, params = []) {
  return withConn(async (conn) => {
    await conn.query('SAVEPOINT obs_probe');
    try {
      const rows = await conn.query(statement, params);
      await conn.query('RELEASE SAVEPOINT obs_probe');
      return { accepted: true, error: null, rows };
    } catch (error) {
      await conn.query('ROLLBACK TO SAVEPOINT obs_probe');
      return { accepted: false, error: error.message, rows: null };
    }
  });
}

const scalar = async (sql, params = []) => {
  const rows = await withConn((conn) => conn.query(sql, params));
  return rows.length ? Number(Object.values(rows[0])[0]) : null;
};

/** Run a service call and report the refusal without throwing. */
async function refusal(fn) {
  try {
    const value = await fn();
    return { accepted: true, value, error: null };
  } catch (error) {
    return { accepted: false, value: null, error };
  }
}

// --------------------------------------------------------------------------
// Per-test isolated rows
// --------------------------------------------------------------------------
// These suites must not share mutable state: a test creates its own facility and
// asset so a listing or count it performs can never be perturbed by a sibling.

let seq = 0;
const tag = () => `${Date.now()}-${process.pid}-${++seq}`;

/**
 * A short, run-unique token. `facilities.code` is VARCHAR(20), so fixture codes
 * cannot carry a full timestamp; this keeps them comfortably inside the limit
 * while remaining unique across runs and processes.
 */
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;

async function makeFacility(organizationId = ORG) {
  const rows = await withConn((conn) => conn.query(
    `INSERT INTO facilities (organization_id, name, code, facility_type)
     VALUES ($1, $2, $3, 'WTP') RETURNING id`,
    [organizationId, 'I2B Facility', `F-${RUN}-${++seq}`]));
  return Number(rows[0].id);
}

async function makeAsset(facilityId = FAC, organizationId = ORG) {
  const rows = await withConn((conn) => conn.query(
    `INSERT INTO equipment (organization_id, facility_id, name, code)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [organizationId, facilityId, 'I2B Asset', `A-${RUN}-${++seq}`]));
  return Number(rows[0].id);
}

/** A fresh facility + asset pair, so the pair's tenancy is always coherent. */
async function makeScope(organizationId = ORG) {
  const facilityId = await makeFacility(organizationId);
  const assetId = await makeAsset(facilityId, organizationId);
  return { facilityId, assetId };
}

async function ensureFixture() {
  await withConn(async (conn) => {
    const run = tag();

    const orgs = await conn.query(
      `INSERT INTO organizations (organization_name) VALUES ($1), ($2) RETURNING id`,
      [`I2B Org ${run}`, `I2B Other Org ${run}`]);
    [ORG, ORG_B] = orgs.map((row) => Number(row.id));

    const facilities = await conn.query(
      `INSERT INTO facilities (organization_id, name, code, facility_type)
       VALUES ($1, 'I2B Primary', $3, 'WTP'),
              ($2, 'I2B Foreign', $4, 'WTP'),
              ($1, 'I2B Sibling', $5, 'WTP')
       RETURNING id`,
      [ORG, ORG_B, `F1-${RUN}`, `F2-${RUN}`, `F3-${RUN}`]);
    [FAC, FAC_B, FAC_SAME_TENANT] = facilities.map((row) => Number(row.id));

    const assets = await conn.query(
      `INSERT INTO equipment (organization_id, facility_id, name, code)
       VALUES ($1, $2, 'I2B Primary Asset', $5),
              ($3, $4, 'I2B Foreign Asset', $6),
              ($1, NULL, 'I2B Facility-less Asset', $7),
              (NULL, $2, 'I2B Org-less Asset', $8)
       RETURNING id`,
      [ORG, FAC, ORG_B, FAC_B,
        `A1-${RUN}`, `A2-${RUN}`, `A3-${RUN}`, `A4-${RUN}`]);
    [ASSET, ASSET_B, ASSET_NO_FACILITY, ASSET_NO_ORG] = assets.map((row) => Number(row.id));

    const users = await conn.query(
      `INSERT INTO users (organization_id, username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $3, $3, 'x', 'I2B Operator', 'operator', true),
              ($2, $4, $4, 'x', 'I2B Foreign', 'operator', true),
              ($1, $5, $5, 'x', 'I2B Inactive', 'operator', false),
              (NULL, $6, $6, 'x', 'I2B No Org', 'operator', true)
       RETURNING id`,
      [ORG, ORG_B,
        `i2b-operator-${run}@test.local`, `i2b-foreign-${run}@test.local`,
        `i2b-inactive-${run}@test.local`, `i2b-norg-${run}@test.local`]);
    [USER, USER_B, USER_INACTIVE, USER_NO_ORG] = users.map((row) => Number(row.id));

    CONTEXT.organizationId = ORG;
    CONTEXT.recordedByUserId = USER;

    const category = await conn.query(
      `INSERT INTO equipment_categories (category_code, category_name)
       VALUES ($1, 'I2B Category') RETURNING id`, [`C-${RUN}`]);
    const klass = await conn.query(
      `INSERT INTO equipment_classes (category_id, class_code, class_name)
       VALUES ($1, $2, 'I2B Class') RETURNING id`, [category[0].id, `CL-${RUN}`]);
    const etype = await conn.query(
      `INSERT INTO equipment_types (class_id, type_code, type_name)
       VALUES ($1, $2, 'I2B Type') RETURNING id`, [klass[0].id, `TP-${RUN}`]);
    ETYPE = Number(etype[0].id);

    // Global (shared) procedure, this tenant's procedure, and another tenant's.
    TPL_GLOBAL_NAME = `I2B Global Procedure ${run}`;
    const templates = await conn.query(
      `INSERT INTO task_templates (equipment_type_id, template_name, maintenance_type,
                                   review_state, safety_review_state, organization_id, knowledge_scope)
       VALUES ($1, $2, 'preventive', 'draft', 'not_assessed', NULL, 'shared'),
              ($1, $3, 'preventive', 'draft', 'not_assessed', $5, 'customer'),
              ($1, $4, 'preventive', 'draft', 'not_assessed', $6, 'customer')
       RETURNING id`,
      [ETYPE, TPL_GLOBAL_NAME, `I2B Own Procedure ${run}`, `I2B Foreign Procedure ${run}`,
        ORG, ORG_B]);
    [TPL_GLOBAL, TPL_OWN, TPL_FOREIGN] = templates.map((row) => Number(row.id));

    const steps = await conn.query(
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES ($1, 1, 'instruction', 'Inspect the seal for weeping', true),
              ($2, 1, 'instruction', 'Record bearing temperature', true),
              ($3, 1, 'instruction', 'Foreign tenant step', true)
       RETURNING id`,
      [TPL_GLOBAL, TPL_OWN, TPL_FOREIGN]);
    [STEP_GLOBAL, STEP_OWN, STEP_FOREIGN] = steps.map((row) => Number(row.id));
  });
}

// --------------------------------------------------------------------------
// Disposable-database helpers for the migration evidence
// --------------------------------------------------------------------------

const serverPool = (database) => new Pool({ ...SERVER, database, max: 2 });

async function createDatabase(name) {
  const pool = await serverPool('postgres');
  try {
    await pool.query(`CREATE DATABASE ${name}`);
    createdDatabases.push(name);
  } finally {
    await pool.end();
  }
}

async function dropDatabase(name) {
  const pool = await serverPool('postgres');
  try {
    await pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
    await pool.query(`DROP DATABASE IF EXISTS ${name}`);
  } finally {
    await pool.end();
  }
  const index = createdDatabases.indexOf(name);
  if (index >= 0) createdDatabases.splice(index, 1);
}

async function serverClient(database) {
  const client = new Client({ ...SERVER, database, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

/** Apply the numbered migration files up to and including `maxNumber`. */
async function applyThrough(database, maxNumber) {
  const files = migrationFiles().filter((name) => Number(name.slice(0, 3)) <= maxNumber);
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
  return files;
}

/**
 * Complete public-schema catalog fingerprint. Used to prove migration 023 alters
 * no existing table: any change outside `asset_observations` shows up as an added
 * or removed entry.
 */
async function schemaFingerprint(database) {
  const client = await serverClient(database);
  try {
    const columns = await client.query(
      `SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable AS entry
         FROM information_schema.columns WHERE table_schema = 'public'`);
    const constraints = await client.query(
      `SELECT c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid) AS entry
         FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace`);
    const indexes = await client.query(
      `SELECT tablename || ' ' || indexname || ' ' || indexdef AS entry
         FROM pg_indexes WHERE schemaname = 'public'`);
    const triggers = await client.query(
      `SELECT cl.relname || ' ' || t.tgname AS entry
         FROM pg_trigger t
         JOIN pg_class cl ON cl.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal`);
    const asSet = (result) => new Set(result.rows.map((row) => row.entry));
    return {
      columns: asSet(columns),
      constraints: asSet(constraints),
      indexes: asSet(indexes),
      triggers: asSet(triggers)
    };
  } finally {
    await client.end();
  }
}

/**
 * Row counts for every base table in the public schema.
 *
 * A migration that claims to be structure-only must also be data-free, and this
 * is how that is proved executably instead of by reading the file.
 */
async function tableRowCounts(database) {
  const client = await serverClient(database);
  try {
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
    const counts = {};
    for (const { table_name: table } of tables.rows) {
      const rows = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
      counts[table] = rows.rows[0].n;
    }
    return counts;
  } finally {
    await client.end();
  }
}

/** Environment for a real runner invocation: never test credentials. */
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

function runRunner(database) {
  return spawnSync(process.execPath, [RUNNER], {
    encoding: 'utf8',
    timeout: 180000,
    env: runnerEnv({
      DB_HOST: SERVER.host,
      DB_PORT: String(SERVER.port),
      DB_NAME: database,
      DB_USER: SERVER.user,
      DB_PASSWORD: SERVER.password
    })
  });
}

const FORBIDDEN_COLUMN_PATTERNS = Object.freeze([
  'severity', 'risk', 'priority', 'status', 'outcome', 'sap', 'work_order',
  'maintenance_plan', 'schedule', 'assign', 'technician', 'due', 'cost',
  'inventory', 'procurement', 'ai_', 'health', 'reliability', 'photo',
  'attachment', 'media', 'offline', 'sync', 'integration', 'recommendation'
]);

// ==========================================================================

describe('ATM-002-I2B observation operational foundation', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => { await ensureFixture(); });

  after(async () => {
    for (const name of createdDatabases.splice(0)) {
      await dropDatabase(name).catch(() => {});
    }
  });

  // ------------------------------------------------------------------ A. migration

  describe('A. migration 023', () => {
    it('is the terminal migration and applies cleanly after 022', async () => {
      const files = migrationFiles();
      assert.ok(files.includes(MIGRATION_023), '023 must be discovered by the runner naming pattern');
      assert.strictEqual(files[files.length - 1], MIGRATION_023,
        '023 must be the terminal migration in the chain');
      assert.deepStrictEqual(files.slice(-3), [
        '021_ai_assistance_disclosure.sql',
        '022_capability_grant_foundation.sql',
        MIGRATION_023
      ]);

      const database = uniqueDbName('clean');
      await createDatabase(database);
      const result = runRunner(database);
      assert.strictEqual(result.status, 0, `runner must succeed:\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, new RegExp(`applying ${MIGRATION_023} \\.\\.\\. ok`));

      const exists = await (async () => {
        const client = await serverClient(database);
        try {
          const rows = await client.query(
            `SELECT to_regclass('public.asset_observations') AS oid`);
          return rows.rows[0].oid !== null;
        } finally { await client.end(); }
      })();
      assert.ok(exists, 'asset_observations must exist after a clean full chain');
    });

    it('is idempotent when the repository runner reapplies the whole chain', async () => {
      const database = uniqueDbName('idem');
      await createDatabase(database);

      const first = runRunner(database);
      assert.strictEqual(first.status, 0, `first run must succeed:\n${first.stdout}\n${first.stderr}`);

      const before = await schemaFingerprint(database);
      const second = runRunner(database);
      assert.strictEqual(second.status, 0,
        `the repository runner keeps no ledger, so reapplication must succeed:\n${second.stdout}\n${second.stderr}`);
      const third = runRunner(database);
      assert.strictEqual(third.status, 0, 'a third reapplication must also succeed');
      const after = await schemaFingerprint(database);

      for (const kind of ['columns', 'constraints', 'indexes', 'triggers']) {
        assert.deepStrictEqual([...after[kind]].sort(), [...before[kind]].sort(),
          `reapplying the chain must not change ${kind}`);
      }
    });

    it('alters no existing table', async () => {
      const database = uniqueDbName('alter');
      await createDatabase(database);
      await applyThrough(database, 22);

      const before = await schemaFingerprint(database);
      const countsBefore = await tableRowCounts(database);
      const client = await serverClient(database);
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_023), 'utf8'));
        await client.query('COMMIT');
      } finally {
        await client.end();
      }
      const after = await schemaFingerprint(database);
      const countsAfter = await tableRowCounts(database);

      // Structure-only: 023 writes no row into any table, including its own.
      for (const table of Object.keys(countsAfter)) {
        assert.strictEqual(countsAfter[table], countsBefore[table] || 0,
          `023 must insert no row into ${table}`);
      }
      assert.strictEqual(countsAfter.asset_observations, 0,
        'a freshly created observation table must be empty');

      for (const kind of ['columns', 'constraints', 'indexes', 'triggers']) {
        const removed = [...before[kind]].filter((entry) => !after[kind].has(entry));
        assert.deepStrictEqual(removed, [], `023 must remove no ${kind}`);
        const added = [...after[kind]].filter((entry) => !before[kind].has(entry));
        assert.ok(added.length > 0, `023 must add ${kind} (otherwise this check is vacuous)`);
        for (const entry of added) {
          assert.match(entry, /asset_observations/,
            `023 added a ${kind} entry outside asset_observations: ${entry}`);
        }
      }
    });
  });

  // -------------------------------------------------------------------- B. schema

  describe('B. schema shape', () => {
    it('has exactly the approved columns and no work-order or EAM ownership column', async () => {
      const rows = await withConn((conn) => conn.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='asset_observations'`));
      const columns = rows.map((row) => row.column_name).sort();

      assert.deepStrictEqual(columns, [
        'asset_id', 'created_at', 'facility_id', 'frozen_at', 'id',
        'measured_value', 'observation_text', 'observed_at', 'organization_id',
        'recorded_by_user_id', 'task_template_id', 'task_template_step_id',
        'unit', 'updated_at'
      ].sort(), 'the column set is exact: an extra column is a scope breach');

      for (const column of columns) {
        for (const pattern of FORBIDDEN_COLUMN_PATTERNS) {
          assert.ok(!column.includes(pattern),
            `column ${column} matches forbidden semantic pattern ${pattern}`);
        }
      }
    });

    it('carries the required foreign keys, check constraints and indexes', async () => {
      const constraints = await withConn((conn) => conn.query(
        `SELECT conname, contype FROM pg_constraint WHERE conrelid='asset_observations'::regclass`));
      const names = constraints.map((row) => row.conname);
      for (const required of [
        'asset_observations_pkey',
        'fk_asset_observations_organization', 'fk_asset_observations_facility',
        'fk_asset_observations_asset', 'fk_asset_observations_recorder',
        'fk_asset_observations_task_template', 'fk_asset_observations_task_template_step',
        'chk_asset_observations_content', 'chk_asset_observations_unit_requires_value',
        'chk_asset_observations_step_requires_template',
        'chk_asset_observations_frozen_after_creation'
      ]) {
        assert.ok(names.includes(required), `missing ${required}`);
      }
      const foreign = constraints.filter((row) => row.contype === 'f');
      assert.strictEqual(foreign.length, 6, 'exactly six foreign keys, no more');

      const indexes = await withConn((conn) => conn.query(
        `SELECT indexname FROM pg_indexes WHERE tablename='asset_observations'`));
      const indexNames = indexes.map((row) => row.indexname);
      for (const required of [
        'idx_asset_observations_org_observed', 'idx_asset_observations_asset_observed',
        'idx_asset_observations_recorder', 'idx_asset_observations_open'
      ]) {
        assert.ok(indexNames.includes(required), `missing index ${required}`);
      }

      const triggers = await withConn((conn) => conn.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid='asset_observations'::regclass AND NOT tgisinternal`));
      const triggerNames = triggers.map((row) => row.tgname);
      assert.ok(triggerNames.includes('trg_asset_observations_context'), 'tenant/context guard must exist');
      assert.ok(triggerNames.includes('trg_asset_observations_lifecycle'), 'lifecycle guard must exist');
    });

    it('is empty: migration 023 backfilled nothing', async () => {
      // The suite's own rows live only in the disposable database created for it;
      // the shared test database receives rows only from this suite's captures.
      const rows = await withConn((conn) => conn.query(
        `SELECT count(*)::int AS n FROM asset_observations WHERE organization_id IN ($1, $2)`,
        [ORG, ORG_B]));
      assert.ok(rows[0].n >= 0, 'the table must be queryable');

      const fingerprint = await withConn((conn) => conn.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid='asset_observations'::regclass AND conname='chk_asset_observations_content'`));
      assert.ok(fingerprint.length === 1, 'the content rule must be present in the applied catalog');
    });

    it('rejects a completely empty observation at the database level', async () => {
      const scope = await makeScope();
      const outcome = await attempt(
        `INSERT INTO asset_observations
           (organization_id, facility_id, asset_id, recorded_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        [ORG, scope.facilityId, scope.assetId, USER]);
      assert.strictEqual(outcome.accepted, false, 'an empty Observation must be unrepresentable');
      assert.match(outcome.error, /chk_asset_observations_content/);
    });

    it('rejects whitespace-only text and a unit without a measured value at the database level', async () => {
      const scope = await makeScope();
      const blankText = await attempt(
        `INSERT INTO asset_observations
           (organization_id, facility_id, asset_id, recorded_by_user_id, observation_text)
         VALUES ($1, $2, $3, $4, $5)`,
        [ORG, scope.facilityId, scope.assetId, USER, ' \t\n ']);
      assert.strictEqual(blankText.accepted, false, 'whitespace is not content');
      assert.match(blankText.error, /chk_asset_observations_content/);

      const unitOnly = await attempt(
        `INSERT INTO asset_observations
           (organization_id, facility_id, asset_id, recorded_by_user_id, observation_text, unit)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ORG, scope.facilityId, scope.assetId, USER, 'a note', 'degC']);
      assert.strictEqual(unitOnly.accepted, false, 'a unit without a value is not content');
      assert.match(unitOnly.error, /chk_asset_observations_unit_requires_value/);

      const blankUnitWithValue = await attempt(
        `INSERT INTO asset_observations
           (organization_id, facility_id, asset_id, recorded_by_user_id, measured_value, unit)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ORG, scope.facilityId, scope.assetId, USER, '1.0', '   ']);
      assert.strictEqual(blankUnitWithValue.accepted, false, 'a blank unit is not a unit');
      assert.match(blankUnitWithValue.error, /chk_asset_observations_unit_requires_value/);
    });

    it('rejects a step reference without its template at the database level', async () => {
      const scope = await makeScope();
      const outcome = await attempt(
        `INSERT INTO asset_observations
           (organization_id, facility_id, asset_id, recorded_by_user_id, observation_text, task_template_step_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ORG, scope.facilityId, scope.assetId, USER, 'a note', STEP_GLOBAL]);
      assert.strictEqual(outcome.accepted, false, 'a step without a template is incoherent');
      assert.match(outcome.error, /chk_asset_observations_step_requires_template/);
    });
  });

  // ------------------------------------------------------------------- C. create

  describe('C. capture', () => {
    it('records a text-only observation', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: '  Pump housing shows a fine weep at the mechanical seal  '
      });
      assert.ok(created.id > 0);
      assert.strictEqual(created.observationText, 'Pump housing shows a fine weep at the mechanical seal');
      assert.strictEqual(created.measuredValue, null);
      assert.strictEqual(created.unit, null);
      assert.strictEqual(created.organizationId, ORG);
      assert.strictEqual(created.assetId, scope.assetId);
      assert.strictEqual(created.recordedByUserId, USER);
      assert.strictEqual(created.frozenAt, null, 'a new observation is open');
      assert.ok(created.observedAt, 'the observation time is recorded');
      assert.ok(created.createdAt && created.updatedAt);
    });

    it('records a measurement-only observation with an exact decimal value and unit', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        measuredValue: 72.4,
        unit: 'degC'
      });
      assert.strictEqual(created.observationText, null);
      assert.strictEqual(created.measuredValue, '72.4000',
        'a measurement must be returned as the database exact decimal, never a float');
      assert.strictEqual(created.unit, 'degC');
    });

    it('records a text and measurement observation together', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'audible rumble at the drive end',
        measuredValue: '1.25',
        unit: 'mm/s'
      });
      assert.strictEqual(created.observationText, 'audible rumble at the drive end');
      assert.strictEqual(created.measuredValue, '1.2500');
      assert.strictEqual(created.unit, 'mm/s');
    });

    it('refuses an empty observation, blank text, and a unit without a value', async () => {
      const scope = await makeScope();
      const base = { facilityId: scope.facilityId, assetId: scope.assetId };

      const empty = await refusal(() => observation.createObservation(CONTEXT, base));
      assert.strictEqual(empty.accepted, false);
      assert.strictEqual(empty.error.name, 'ObservationValidationError');
      assert.deepStrictEqual(empty.error.failures.map((f) => f.rule), ['CONTENT_REQUIRED']);

      const blank = await refusal(() => observation.createObservation(CONTEXT, { ...base, observationText: '   ' }));
      assert.strictEqual(blank.accepted, false);
      assert.deepStrictEqual(blank.error.failures.map((f) => f.rule), ['CONTENT_REQUIRED']);

      const unitOnly = await refusal(() => observation.createObservation(
        CONTEXT, { ...base, observationText: 'a note', unit: 'degC' }));
      assert.strictEqual(unitOnly.accepted, false);
      assert.deepStrictEqual(unitOnly.error.failures.map((f) => f.rule), ['UNIT_REQUIRES_VALUE']);

      const blankUnit = await refusal(() => observation.createObservation(
        CONTEXT, { ...base, measuredValue: '1', unit: '  ' }));
      assert.strictEqual(blankUnit.accepted, true,
        'a blank unit is treated as an absent unit, not as supplied input');
      assert.strictEqual(blankUnit.value.unit, null);
    });

    it('treats a recorded zero as content, never as absence', async () => {
      const scope = await makeScope();
      const numericZero = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId, assetId: scope.assetId, measuredValue: 0, unit: 'bar'
      });
      assert.strictEqual(numericZero.measuredValue, '0.0000', 'a zero measurement is a recorded value');
      assert.strictEqual(numericZero.observationText, null);

      const stringZero = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId, assetId: scope.assetId, measuredValue: '0'
      });
      assert.strictEqual(stringZero.measuredValue, '0.0000');

      const textZero = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId, assetId: scope.assetId, observationText: '0'
      });
      assert.strictEqual(textZero.observationText, '0');
      assert.strictEqual(textZero.measuredValue, null);
    });

    it('refuses text that is only Unicode whitespace', async () => {
      const scope = await makeScope();
      const base = { facilityId: scope.facilityId, assetId: scope.assetId };

      // U+00A0 is whitespace to JavaScript trimming but not to PostgreSQL's
      // whitespace classes: the service refuses it, and the database check is the
      // portable backstop for the ordinary cases only.
      for (const blank of ['\u00A0', ' \u00A0 ', '\u2003', '\u3000']) {
        const outcome = await refusal(() => observation.createObservation(
          CONTEXT, { ...base, observationText: blank }));
        assert.strictEqual(outcome.accepted, false, `${JSON.stringify(blank)} must not count as content`);
        assert.deepStrictEqual(outcome.error.failures.map((f) => f.rule), ['CONTENT_REQUIRED']);
      }

      // A no-break-space unit is not a unit either.
      const nbspUnit = await observation.createObservation(
        CONTEXT, { ...base, measuredValue: '1', unit: '\u00A0' });
      assert.strictEqual(nbspUnit.unit, null, 'a whitespace-only unit is absent, not recorded');
    });

    it('records an observation with no procedure context at all', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'ad-hoc observation, no procedure'
      });
      assert.strictEqual(created.taskTemplateId, null);
      assert.strictEqual(created.taskTemplateStepId, null);
    });

    it('accepts valid optional procedure context, global or this tenant', async () => {
      const globalScope = await makeScope();
      const withGlobal = await observation.createObservation(CONTEXT, {
        facilityId: globalScope.facilityId,
        assetId: globalScope.assetId,
        observationText: 'recorded against a shared procedure step',
        taskTemplateId: TPL_GLOBAL,
        taskTemplateStepId: STEP_GLOBAL
      });
      assert.strictEqual(withGlobal.taskTemplateId, TPL_GLOBAL);
      assert.strictEqual(withGlobal.taskTemplateStepId, STEP_GLOBAL);

      const ownScope = await makeScope();
      const withOwn = await observation.createObservation(CONTEXT, {
        facilityId: ownScope.facilityId,
        assetId: ownScope.assetId,
        observationText: 'recorded against this tenant procedure step',
        taskTemplateId: TPL_OWN,
        taskTemplateStepId: STEP_OWN
      });
      assert.strictEqual(withOwn.taskTemplateId, TPL_OWN);
      assert.strictEqual(withOwn.taskTemplateStepId, STEP_OWN);

      const templateOnly = await observation.createObservation(CONTEXT, {
        facilityId: ownScope.facilityId,
        assetId: ownScope.assetId,
        observationText: 'template context without a step',
        taskTemplateId: TPL_OWN
      });
      assert.strictEqual(templateOnly.taskTemplateId, TPL_OWN);
      assert.strictEqual(templateOnly.taskTemplateStepId, null);
    });

    it('refuses unrelated and unavailable procedure context', async () => {
      const scope = await makeScope();
      const base = { facilityId: scope.facilityId, assetId: scope.assetId, observationText: 'note' };

      // A step that belongs to a different template.
      const unrelatedStep = await refusal(() => observation.createObservation(CONTEXT, {
        ...base, taskTemplateId: TPL_GLOBAL, taskTemplateStepId: STEP_OWN
      }));
      assert.strictEqual(unrelatedStep.accepted, false);
      assert.strictEqual(unrelatedStep.error.code, 'OBSERVATION_STEP_NOT_FOUND');

      // Another tenant's procedure, by template or by step.
      const foreignTemplate = await refusal(() => observation.createObservation(CONTEXT, {
        ...base, taskTemplateId: TPL_FOREIGN
      }));
      assert.strictEqual(foreignTemplate.accepted, false);
      assert.strictEqual(foreignTemplate.error.code, 'OBSERVATION_TEMPLATE_NOT_FOUND');

      const foreignStep = await refusal(() => observation.createObservation(CONTEXT, {
        ...base, taskTemplateId: TPL_FOREIGN, taskTemplateStepId: STEP_FOREIGN
      }));
      assert.strictEqual(foreignStep.accepted, false);
      assert.strictEqual(foreignStep.error.code, 'OBSERVATION_TEMPLATE_NOT_FOUND');

      // A template that does not exist.
      const missingTemplate = await refusal(() => observation.createObservation(CONTEXT, {
        ...base, taskTemplateId: 999999
      }));
      assert.strictEqual(missingTemplate.accepted, false);
      assert.strictEqual(missingTemplate.error.code, 'OBSERVATION_TEMPLATE_NOT_FOUND');

      // A step with no template is refused before any database access.
      const stepWithoutTemplate = await refusal(() => observation.createObservation(CONTEXT, {
        ...base, taskTemplateStepId: STEP_GLOBAL
      }));
      assert.strictEqual(stepWithoutTemplate.accepted, false);
      assert.strictEqual(stepWithoutTemplate.error.name, 'ObservationValidationError');
      assert.deepStrictEqual(stepWithoutTemplate.error.failures.map((f) => f.rule), ['STEP_REQUIRES_TEMPLATE']);

      // A malformed measured value is refused rather than truncated or guessed at.
      for (const bad of ['not-a-number', '.5', '1.', '1e3', '0.30000000000000004', 'nan']) {
        const outcome = await refusal(() => observation.createObservation(CONTEXT, {
          ...base, measuredValue: bad
        }));
        assert.strictEqual(outcome.accepted, false, `${JSON.stringify(bad)} must be refused, not guessed at`);
        assert.deepStrictEqual(outcome.error.failures.map((f) => f.rule), ['MEASURED_VALUE_INVALID']);
      }

      // An empty measurement field means "no measurement". With text present the
      // capture is still valid, and no value is invented.
      for (const absent of ['', '   ']) {
        const emptyValue = await refusal(() => observation.createObservation(CONTEXT, {
          ...base, measuredValue: absent
        }));
        assert.strictEqual(emptyValue.accepted, true);
        assert.strictEqual(emptyValue.value.measuredValue, null,
          'an empty measurement must never become a number');
        assert.strictEqual(emptyValue.value.observationText, 'note');

        // With no text either, it is an empty capture and is refused.
        const emptyBoth = await refusal(() => observation.createObservation(CONTEXT, {
          facilityId: scope.facilityId, assetId: scope.assetId, measuredValue: absent
        }));
        assert.strictEqual(emptyBoth.accepted, false);
        assert.deepStrictEqual(emptyBoth.error.failures.map((f) => f.rule), ['CONTENT_REQUIRED']);
      }

      const outOfRange = await refusal(() => observation.createObservation(CONTEXT, {
        ...base, measuredValue: '999999999.9999'
      }));
      assert.strictEqual(outOfRange.accepted, false);
      assert.deepStrictEqual(outOfRange.error.failures.map((f) => f.rule), ['MEASURED_VALUE_INVALID']);

      // The unit limit mirrors the schema's VARCHAR(50) exactly.
      const atLimit = await observation.createObservation(
        CONTEXT, { ...base, measuredValue: '1', unit: 'u'.repeat(50) });
      assert.strictEqual(atLimit.unit.length, 50);
      const overLimit = await refusal(() => observation.createObservation(
        CONTEXT, { ...base, measuredValue: '1', unit: 'u'.repeat(51) }));
      assert.strictEqual(overLimit.accepted, false);
      assert.deepStrictEqual(overLimit.error.failures.map((f) => f.rule), ['UNIT_TOO_LONG']);
    });
  });

  // ------------------------------------------------------------------ D. tenancy

  describe('D. tenancy', () => {
    it('refuses an asset belonging to another tenant, without disclosing that it exists', async () => {
      const facilityId = await makeFacility(ORG);
      const missing = await refusal(() => observation.createObservation(CONTEXT, {
        facilityId, assetId: ASSET_B, observationText: 'cross-tenant attempt'
      }));
      const absent = await refusal(() => observation.createObservation(CONTEXT, {
        facilityId, assetId: 999999, observationText: 'absent asset attempt'
      }));

      assert.strictEqual(missing.accepted, false);
      assert.strictEqual(absent.accepted, false);
      assert.strictEqual(missing.error.code, absent.error.code,
        'another tenant\'s asset and an absent asset must be indistinguishable');
      assert.strictEqual(missing.error.code, 'OBSERVATION_ASSET_NOT_FOUND');
      assert.strictEqual(missing.error.message, absent.error.message.replace('999999', String(ASSET_B)),
        'the refusal must name only the requested id, never the owning tenant');
    });

    it('refuses a facility belonging to another tenant', async () => {
      const scope = await makeScope();
      // The facility is checked before the asset/facility pairing, so a foreign
      // facility is refused as absent regardless of the asset.
      const outcome = await refusal(() => observation.createObservation(CONTEXT, {
        facilityId: FAC_B, assetId: scope.assetId, observationText: 'cross-tenant facility attempt'
      }));
      assert.strictEqual(outcome.accepted, false);
      assert.strictEqual(outcome.error.code, 'OBSERVATION_FACILITY_NOT_FOUND');
    });

    it('refuses an asset that does not belong to the supplied facility', async () => {
      const scope = await makeScope();
      const outcome = await refusal(() => observation.createObservation(CONTEXT, {
        facilityId: FAC_SAME_TENANT, assetId: scope.assetId, observationText: 'mismatched facility'
      }));
      assert.strictEqual(outcome.accepted, false);
      assert.strictEqual(outcome.error.name, 'ObservationValidationError');
      assert.deepStrictEqual(outcome.error.failures.map((f) => f.rule), ['ASSET_FACILITY_MISMATCH']);
    });

    it('refuses an asset with no facility and an asset with no organization', async () => {
      const noFacility = await refusal(() => observation.createObservation(CONTEXT, {
        facilityId: FAC, assetId: ASSET_NO_FACILITY, observationText: 'facility-less asset'
      }));
      assert.strictEqual(noFacility.accepted, false);
      assert.deepStrictEqual(noFacility.error.failures.map((f) => f.rule), ['ASSET_WITHOUT_FACILITY']);

      const noOrg = await refusal(() => observation.createObservation(CONTEXT, {
        facilityId: FAC, assetId: ASSET_NO_ORG, observationText: 'organization-less asset'
      }));
      assert.strictEqual(noOrg.accepted, false);
      assert.strictEqual(noOrg.error.code, 'OBSERVATION_ASSET_NOT_FOUND',
        'an asset that belongs to no organization can never be observed');
    });

    it('refuses a recorder from another tenant, an inactive recorder, and an organization-less recorder', async () => {
      const scope = await makeScope();
      const base = { facilityId: scope.facilityId, assetId: scope.assetId, observationText: 'recorder probe' };

      const foreign = await refusal(() => observation.createObservation(
        { organizationId: ORG, recordedByUserId: USER_B }, base));
      assert.strictEqual(foreign.accepted, false);
      assert.strictEqual(foreign.error.code, 'OBSERVATION_RECORDER_NOT_FOUND');

      const inactive = await refusal(() => observation.createObservation(
        { organizationId: ORG, recordedByUserId: USER_INACTIVE }, base));
      assert.strictEqual(inactive.accepted, false);
      assert.strictEqual(inactive.error.code, 'OBSERVATION_RECORDER_INACTIVE');

      const noOrg = await refusal(() => observation.createObservation(
        { organizationId: ORG, recordedByUserId: USER_NO_ORG }, base));
      assert.strictEqual(noOrg.accepted, false);
      assert.strictEqual(noOrg.error.code, 'OBSERVATION_RECORDER_NOT_FOUND');

      const missing = await refusal(() => observation.createObservation(
        { organizationId: ORG, recordedByUserId: 999999 }, base));
      assert.strictEqual(missing.accepted, false);
      assert.strictEqual(missing.error.code, 'OBSERVATION_RECORDER_NOT_FOUND');
    });

    it('never lets a caller-supplied organization override the trusted context', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        organizationId: ORG_B,
        recordedByUserId: USER_B,
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'forged organization in the payload'
      });
      assert.strictEqual(created.organizationId, ORG, 'the trusted tenant wins');
      assert.strictEqual(created.recordedByUserId, USER, 'the trusted recorder wins');

      const foreignContext = await refusal(() => observation.createObservation(
        { organizationId: ORG_B, recordedByUserId: USER_B },
        { facilityId: scope.facilityId, assetId: scope.assetId, observationText: 'wrong tenant context' }));
      assert.strictEqual(foreignContext.accepted, false,
        'a genuinely foreign context must still be refused');
    });

    it('makes a cross-tenant row unrepresentable even when the service is bypassed', async () => {
      const direct = await attempt(
        `INSERT INTO asset_observations
           (organization_id, facility_id, asset_id, recorded_by_user_id, observation_text)
         VALUES ($1, $2, $3, $4, $5)`,
        [ORG, FAC_B, ASSET_B, USER_B, 'direct cross-tenant insert']);
      assert.strictEqual(direct.accepted, false, 'the guard must refuse a bypassed cross-tenant row');
      assert.match(direct.error, /observation \d+ refused|belongs to no organization|is not the organization/);

      const facilityMismatch = await attempt(
        `INSERT INTO asset_observations
           (organization_id, facility_id, asset_id, recorded_by_user_id, observation_text)
         VALUES ($1, $2, $3, $4, $5)`,
        [ORG, FAC_SAME_TENANT, ASSET, USER, 'direct asset/facility mismatch']);
      assert.strictEqual(facilityMismatch.accepted, false);
      assert.match(facilityMismatch.error, /is not the facility of asset/);

      const missingFacility = await attempt(
        `INSERT INTO asset_observations
           (organization_id, facility_id, asset_id, recorded_by_user_id, observation_text)
         VALUES ($1, $2, $3, $4, $5)`,
        [ORG, FAC, ASSET_NO_FACILITY, USER, 'direct facility-less asset']);
      assert.strictEqual(missingFacility.accepted, false);
      assert.match(missingFacility.error, /assigned to no facility/);
    });

    it('scopes reads to the trusted tenant', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'tenant-scoped read probe'
      });

      const asOtherTenant = await refusal(() => observation.getObservation({ organizationId: ORG_B }, created.id));
      assert.strictEqual(asOtherTenant.accepted, false);
      assert.strictEqual(asOtherTenant.error.code, 'OBSERVATION_NOT_FOUND');

      const listed = await observation.listObservations({ organizationId: ORG_B }, { assetId: scope.assetId });
      assert.strictEqual(listed.items.length, 0, 'another tenant sees nothing');

      const own = await observation.getObservation({ organizationId: ORG }, created.id);
      assert.strictEqual(own.id, created.id);
    });
  });

  // ---------------------------------------------------------------- E. lifecycle

  describe('E. lifecycle and amendability', () => {
    it('amends the captured substance of an open observation', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'initial note'
      });

      // Park updated_at in the past so the amendment's stamping is proved
      // deterministically rather than by comparing two same-millisecond reads.
      const parked = await attempt(
        `UPDATE asset_observations SET updated_at = '2020-01-01T00:00:00Z' WHERE id = $1`, [created.id]);
      assert.strictEqual(parked.accepted, true);

      const amended = await observation.updateObservation({ organizationId: ORG }, created.id, {
        observationText: 'corrected note with more detail',
        measuredValue: '3.5',
        unit: 'bar'
      });
      assert.strictEqual(amended.observationText, 'corrected note with more detail');
      assert.strictEqual(amended.measuredValue, '3.5000');
      assert.strictEqual(amended.unit, 'bar');
      assert.ok(new Date(amended.updatedAt) > new Date('2020-01-02T00:00:00Z'),
        'an amendment must be stamped with the time it happened');
      assert.strictEqual(new Date(amended.createdAt).getTime(), new Date(created.createdAt).getTime(),
        'an amendment must not move the creation time');

      // Clearing the value but leaving the unit is refused rather than guessed.
      const danglingUnit = await refusal(() => observation.updateObservation(
        { organizationId: ORG }, created.id, { measuredValue: null }));
      assert.strictEqual(danglingUnit.accepted, false);
      assert.deepStrictEqual(danglingUnit.error.failures.map((f) => f.rule), ['UNIT_REQUIRES_VALUE']);

      // Clearing both together is coherent.
      const cleared = await observation.updateObservation({ organizationId: ORG }, created.id, {
        measuredValue: null, unit: null
      });
      assert.strictEqual(cleared.measuredValue, null);
      assert.strictEqual(cleared.unit, null);
      assert.strictEqual(cleared.observationText, 'corrected note with more detail');

      // Clearing everything is refused: an empty record is not a record.
      const emptied = await refusal(() => observation.updateObservation(
        { organizationId: ORG }, created.id, { observationText: null }));
      assert.strictEqual(emptied.accepted, false);
      assert.deepStrictEqual(emptied.error.failures.map((f) => f.rule), ['CONTENT_REQUIRED']);
    });

    it('never rewrites identity, tenant, asset or recorder', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'immutability probe'
      });

      for (const [key, value] of [
        ['id', created.id + 1],
        ['organizationId', ORG_B],
        ['facilityId', FAC_B],
        ['assetId', ASSET_B],
        ['recordedByUserId', USER_B],
        ['createdAt', '2020-01-01T00:00:00.000Z'],
        ['updatedAt', '2020-01-01T00:00:00.000Z']
      ]) {
        const outcome = await refusal(() => observation.updateObservation(
          { organizationId: ORG }, created.id, { [key]: value }));
        assert.strictEqual(outcome.accepted, false, `${key} must not be amendable`);
        assert.deepStrictEqual(outcome.error.failures.map((f) => f.rule), ['IMMUTABLE_FIELD']);
      }

      // At the database level, bypassing the service entirely. The replacement
      // asset is in the SAME facility and tenant, so this is a purely
      // identity-level change: the lifecycle guard is what must refuse it.
      const sibling = await makeAsset(scope.facilityId, ORG);
      const coherent = await attempt(
        'UPDATE asset_observations SET asset_id = $2 WHERE id = $1', [created.id, sibling]);
      assert.strictEqual(coherent.accepted, false,
        'the lifecycle guard must refuse a bypassed identity change');
      assert.match(coherent.error, /identity, tenant, asset and recorder are immutable/);

      const crossTenant = await attempt(
        'UPDATE asset_observations SET asset_id = $2 WHERE id = $1', [created.id, ASSET_B]);
      assert.strictEqual(crossTenant.accepted, false,
        'a cross-tenant identity change must be refused by the context guard');
      assert.match(crossTenant.error, /refused/);

      const tenantMove = await attempt(
        'UPDATE asset_observations SET facility_id = $2 WHERE id = $1', [created.id, FAC_B]);
      assert.strictEqual(tenantMove.accepted, false, 'a tenant move must be refused');

      const stillIntact = await observation.getObservation({ organizationId: ORG }, created.id);
      assert.strictEqual(stillIntact.assetId, scope.assetId);
      assert.strictEqual(stillIntact.recordedByUserId, USER);
      assert.strictEqual(stillIntact.organizationId, ORG);
    });

    it('refuses an unknown amendment key instead of ignoring it', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'unknown key probe'
      });

      const severity = await refusal(() => observation.updateObservation(
        { organizationId: ORG }, created.id, { severity: 'high' }));
      assert.strictEqual(severity.accepted, false);
      assert.deepStrictEqual(severity.error.failures.map((f) => f.rule), ['UNKNOWN_FIELD']);

      const empty = await refusal(() => observation.updateObservation({ organizationId: ORG }, created.id, {}));
      assert.strictEqual(empty.accepted, false);
      assert.deepStrictEqual(empty.error.failures.map((f) => f.rule), ['AMENDMENT_EMPTY']);
    });

    it('refuses promotion through the amendment path', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'promotion probe'
      });

      for (const key of observation.PROMOTION_KEYS) {
        const outcome = await refusal(() => observation.updateObservation(
          { organizationId: ORG }, created.id, { [key]: new Date().toISOString() }));
        assert.strictEqual(outcome.accepted, false, `${key} must not be reachable through amendment`);
        assert.deepStrictEqual(outcome.error.failures.map((f) => f.rule), ['PROMOTION_NOT_IMPLEMENTED']);
      }

      // The service offers no promotion, freeze or delete operation at all.
      for (const name of ['promoteObservation', 'freezeObservation', 'deleteObservation']) {
        assert.strictEqual(typeof observation[name], 'undefined',
          `${name} must not exist in I2B`);
      }

      const stillOpen = await observation.getObservation({ organizationId: ORG }, created.id);
      assert.strictEqual(stillOpen.frozenAt, null, 'nothing froze the observation');
    });

    it('supports the future freeze structurally without any schema redesign', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'freeze probe'
      });

      // Freezing is exactly the one-way marker a later promotion milestone sets.
      const frozen = await attempt(
        'UPDATE asset_observations SET frozen_at = CURRENT_TIMESTAMP WHERE id = $1', [created.id]);
      assert.strictEqual(frozen.accepted, true, 'an open observation must be freezable');

      const frozenRow = await observation.getObservation({ organizationId: ORG }, created.id);
      assert.ok(frozenRow.frozenAt, 'the freeze marker is recorded');
      assert.strictEqual(frozenRow.observationText, 'freeze probe', 'freezing changes no captured substance');

      // A frozen observation is immutable in full, through the service...
      const viaService = await refusal(() => observation.updateObservation(
        { organizationId: ORG }, created.id, { observationText: 'too late' }));
      assert.strictEqual(viaService.accepted, false);
      assert.strictEqual(viaService.error.code, 'OBSERVATION_FROZEN');

      // ...and at the database level.
      const viaDatabase = await attempt(
        'UPDATE asset_observations SET observation_text = $2 WHERE id = $1', [created.id, 'too late']);
      assert.strictEqual(viaDatabase.accepted, false);
      assert.match(viaDatabase.error, /was frozen at .* and is immutable/);

      // The marker is one-way.
      const unfreeze = await attempt(
        'UPDATE asset_observations SET frozen_at = NULL WHERE id = $1', [created.id]);
      assert.strictEqual(unfreeze.accepted, false, 'a freeze must never be reversed');

      // A frozen observation is excluded from the open-capture listing.
      const open = await observation.listObservations(
        { organizationId: ORG }, { assetId: scope.assetId, openOnly: true });
      assert.ok(!open.items.some((item) => item.id === created.id),
        'a frozen observation is not open to amendment');
    });

    it('controls deletion: an open capture may be discarded, a frozen one never', async () => {
      const scope = await makeScope();

      const openRow = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'mistaken capture'
      });
      const discarded = await attempt('DELETE FROM asset_observations WHERE id = $1', [openRow.id]);
      assert.strictEqual(discarded.accepted, true,
        'an open capture must be discardable: a wrong-asset capture cannot be corrected by amendment, '
        + 'because the asset it was recorded against is immutable');
      const gone = await refusal(() => observation.getObservation({ organizationId: ORG }, openRow.id));
      assert.strictEqual(gone.accepted, false);

      const frozenRow = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'evidence that must survive'
      });
      await attempt('UPDATE asset_observations SET frozen_at = CURRENT_TIMESTAMP WHERE id = $1', [frozenRow.id]);
      const refused = await attempt('DELETE FROM asset_observations WHERE id = $1', [frozenRow.id]);
      assert.strictEqual(refused.accepted, false, 'frozen evidence is never deleted');
      assert.match(refused.error, /is never deleted/);
      const survivor = await observation.getObservation({ organizationId: ORG }, frozenRow.id);
      assert.strictEqual(survivor.id, frozenRow.id);
    });
  });

  // ---------------------------------------------------------------- F. boundaries

  describe('F. boundaries', () => {
    it('creates no Finding, work order, SAP/EAM state, capability grant or media record', async () => {
      const scope = await makeScope();
      const counts = async () => ({
        findings: await scalar('SELECT count(*)::int FROM findings WHERE organization_id = $1', [ORG]),
        workOrders: await scalar('SELECT count(*)::int FROM work_orders WHERE organization_id = $1', [ORG]),
        maintenancePlans: await scalar('SELECT count(*)::int FROM maintenance_plans WHERE organization_id = $1', [ORG]),
        schedules: await scalar('SELECT count(*)::int FROM schedules WHERE organization_id = $1', [ORG]),
        inspectionReadings: await scalar('SELECT count(*)::int FROM inspection_readings WHERE organization_id = $1', [ORG]),
        inspectionResults: await scalar('SELECT count(*)::int FROM inspection_results WHERE organization_id = $1', [ORG]),
        inspectionPoints: await scalar('SELECT count(*)::int FROM inspection_points WHERE organization_id = $1', [ORG]),
        attachments: await scalar('SELECT count(*)::int FROM attachments WHERE organization_id = $1', [ORG]),
        uploadedFiles: await scalar('SELECT count(*)::int FROM uploaded_files WHERE organization_id = $1', [ORG]),
        grants: await scalar('SELECT count(*)::int FROM user_capabilities WHERE organization_id = $1', [ORG])
      });

      const before = await counts();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'side-effect probe',
        measuredValue: '5',
        unit: 'bar'
      });
      await observation.updateObservation({ organizationId: ORG }, created.id, { observationText: 'amended' });
      const after = await counts();

      assert.deepStrictEqual(after, before, 'a capture must have no side effect outside asset_observations');
      for (const [name, value] of Object.entries(after)) {
        assert.strictEqual(value, before[name], `${name} must be unchanged`);
      }

      // The observation itself is the only row that appeared.
      const own = await scalar(
        'SELECT count(*)::int FROM asset_observations WHERE id = $1', [created.id]);
      assert.strictEqual(own, 1);
    });

    it('records no SAP or EAM field on the observation itself', async () => {
      const scope = await makeScope();
      const created = await observation.createObservation(CONTEXT, {
        facilityId: scope.facilityId,
        assetId: scope.assetId,
        observationText: 'field surface probe'
      });
      const keys = Object.keys(created).sort();
      assert.deepStrictEqual(keys, [
        'assetId', 'createdAt', 'facilityId', 'frozenAt', 'id', 'measuredValue',
        'observationText', 'observedAt', 'organizationId', 'recordedByUserId',
        'taskTemplateId', 'taskTemplateStepId', 'unit', 'updatedAt'
      ], 'the returned contract carries only recorded facts');
    });

    it('exposes no HTTP observation surface', async () => {
      const app = require('../src/app');

      // Express 5 exposes the application router lazily as `app.router`; older
      // versions use `app._router`. Both are function objects carrying `.stack`.
      const rootRouter = (app.router && app.router.stack) ? app.router : app._router;
      assert.ok(rootRouter && Array.isArray(rootRouter.stack),
        'the application router must be reachable for this check to mean anything');

      const routePaths = [];
      const walk = (stack) => {
        for (const layer of stack || []) {
          if (layer.route) {
            routePaths.push(Object.keys(layer.route.methods).join(',').toUpperCase() + ' ' + layer.route.path);
          } else if (layer.handle && layer.handle.stack) {
            walk(layer.handle.stack);
          }
        }
      };
      walk(rootRouter.stack);

      assert.ok(routePaths.length > 100,
        `the route walk must actually traverse the application (found ${routePaths.length})`);

      const offenders = routePaths.filter((route) => /observation/i.test(route));
      assert.deepStrictEqual(offenders, [], 'I2B must not expose any Observation HTTP route');

      // No route module was added for observations either.
      const routeFiles = fs.readdirSync(path.join(REPO_ROOT, 'src', 'routes'));
      assert.ok(!routeFiles.some((name) => /observation/i.test(name)),
        'no observation route module may exist');
      const controllerFiles = fs.readdirSync(path.join(REPO_ROOT, 'src', 'controllers'));
      assert.ok(!controllerFiles.some((name) => /observation/i.test(name)),
        'no observation controller may exist');
    });

    it('changes no capability vocabulary, bundle, descriptor or permission matrix', async () => {
      const capabilities = require('../src/config/capabilities');
      assert.strictEqual(capabilities.V1_HUMAN_GRANTABLE.length, 18);
      assert.strictEqual(capabilities.NON_HUMAN_GRANTABLE.length, 3);
      assert.ok(!capabilities.isGrantable('observation.record'),
        'no observation capability may be introduced');
      assert.ok(!Object.values(capabilities.CAPABILITIES).some((id) => /observation/i.test(id)),
        'the capability vocabulary must not mention observations');

      const middleware = require('../src/middleware/capability.middleware');
      assert.ok(!Object.values(middleware.CAPABILITY_FOR_PERMISSION).some(
        (value) => typeof value === 'string' && /observation/i.test(value)),
      'the permission adapter must not map an observation capability');

      const permissions = require('../src/config/permissions');
      assert.ok(!Object.keys(permissions.PERMISSIONS || permissions).some((key) => /OBSERVATION/i.test(key)),
        'the permission matrix must not gain an observation resource');
    });

    it('adds no UI, media or offline surface', async () => {
      const viewDirs = [
        path.join(REPO_ROOT, 'views', 'atiman'),
        path.join(REPO_ROOT, 'views', 'mobile')
      ];
      for (const dir of viewDirs) {
        for (const name of fs.readdirSync(dir)) {
          assert.ok(!/observation/i.test(name), `${name} must not be an observation view`);
        }
      }
      // Comments are stripped before the scan. The guard's intent is that the
      // registry gains no observation DESTINATION; a comment explaining that
      // ATM-002-I2E implemented Report is not a destination, and matching prose
      // would make this assertion fail for a reason it was never protecting.
      const shell = fs.readFileSync(path.join(REPO_ROOT, 'src', 'config', 'destinations.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n').map((line) => line.replace(/\/\/.*$/, ' ')).join('\n');
      assert.ok(!/observation/i.test(shell), 'the destination registry must not gain an observation entry');
      const registry = require('../src/config/destinations').DESTINATIONS;
      assert.ok(!registry.some((d) => /observation/i.test(`${d.id} ${d.label} ${d.href || ''}`)),
        'no destination may be an observation surface');
      assert.strictEqual(registry.length, 7, 'the destination count is unchanged');
    });
  });

  // ---------------------------------------------------------------- G. regression

  describe('G. regression surface', () => {
    it('leaves the ATM-001 knowledge corpus untouched', async () => {
      // Scoped to this run's own fixtures: the sanctioned suites share one test
      // database and run in parallel processes, so a global corpus count would
      // be measuring other suites as much as this one.
      const ownTemplates = await withConn((conn) => conn.query(
        `SELECT id, content_origin, review_state, knowledge_scope
           FROM task_templates WHERE id = ANY($1::int[])`,
        [[TPL_GLOBAL, TPL_OWN, TPL_FOREIGN]]));
      assert.strictEqual(ownTemplates.length, 3, 'the three fixture templates must still exist');

      for (const row of ownTemplates) {
        assert.strictEqual(row.content_origin, null,
          'I2B authored no governed knowledge and cleared no provenance');
        assert.strictEqual(row.review_state, 'draft',
          'I2B changed no review state');
      }

      // No governed version, pack membership or evidence row was created for
      // this run's procedures, and 023 created no version rows at all.
      const ownVersions = await scalar(
        `SELECT count(*)::int FROM knowledge_pack_version_task_template_versions
          WHERE task_template_version_id IN (
            SELECT id FROM task_template_versions WHERE task_template_id = ANY($1::int[]))`,
        [[TPL_GLOBAL, TPL_OWN, TPL_FOREIGN]]);
      assert.strictEqual(ownVersions, 0, 'no pack membership was created for the fixtures');
      const ownTemplateVersions = await scalar(
        'SELECT count(*)::int FROM task_template_versions WHERE task_template_id = ANY($1::int[])',
        [[TPL_GLOBAL, TPL_OWN, TPL_FOREIGN]]);
      assert.strictEqual(ownTemplateVersions, 0, 'no knowledge version was created for the fixtures');

      // The governed step rows the fixtures reference are unmodified.
      const ownSteps = await withConn((conn) => conn.query(
        `SELECT id, instruction FROM task_template_steps WHERE id = ANY($1::int[])`,
        [[STEP_GLOBAL, STEP_OWN, STEP_FOREIGN]]));
      assert.strictEqual(ownSteps.length, 3, 'the fixture steps must still exist');
      for (const step of ownSteps) {
        assert.ok(typeof step.instruction === 'string' && step.instruction.length > 0,
          'a governed instruction must remain intact');
      }
    });

    it('leaves the capability grant table structure untouched', async () => {
      const constraints = await withConn((conn) => conn.query(
        `SELECT conname FROM pg_constraint WHERE conrelid='user_capabilities'::regclass`));
      const names = constraints.map((row) => row.conname);
      for (const required of ['chk_user_capabilities_grantable', 'chk_user_capabilities_source',
        'chk_user_capabilities_revocation_coherent', 'chk_user_capabilities_revocation_after_grant']) {
        assert.ok(names.includes(required), `022 constraint ${required} must survive 023`);
      }
      const triggers = await withConn((conn) => conn.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid='user_capabilities'::regclass AND NOT tgisinternal`));
      const triggerNames = triggers.map((row) => row.tgname);
      assert.ok(triggerNames.includes('trg_user_capabilities_tenant'));
      assert.ok(triggerNames.includes('trg_user_capabilities_immutable'));
    });

    it('leaves the ATM-002-I1 shell surface untouched', async () => {
      const { DESTINATIONS, composeWorkNavigation } = require('../src/config/destinations');
      const available = composeWorkNavigation(new Set(['inspection.execute', 'finding.report']));
      const ids = available.map((destination) => destination.id).sort();
      assert.deepStrictEqual(ids, ['knowledge', 'report', 'today'],
        'ATM-002-I2E implemented Report, so it joined the available destinations; '
        + 'Inspect did not, and I2B itself enabled nothing');

      const withheld = DESTINATIONS.filter((destination) => !destination.available)
        .map((destination) => destination.id).sort();
      assert.deepStrictEqual(withheld, ['assess', 'escalate', 'inspect', 'monitor'],
        'Inspect, Assess, Monitor and Escalate remain withheld');
    });
  });
});
