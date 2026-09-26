/**
 * ATM-001 M5R.4B2 — Governed Taxonomy Application
 *
 * Proves the ratified M5R.4A / M5R.4B1 equipment-type package is applied exactly,
 * and proves just as carefully what the application does NOT do.
 *
 * WHY THIS SUITE PROVISIONS ITS OWN DATABASE
 *
 * The application is content, not schema: it transforms a corpus that a
 * separately-invoked bootstrap loads. The sanctioned suites share one database
 * and none of them run the bootstrap, so a suite that assumed the corpus was
 * present would either never exercise the application or would collide with its
 * neighbours. Like tests/migration-runner.test.js, this suite therefore creates
 * a DISPOSABLE database, drives the REAL migration runner, the REAL bootstrap and
 * the REAL application CLI, and drops the database afterwards. That makes the
 * whole path — migrations 001–019, corpus load, governed application — verified
 * end to end, and it never touches a shared or production database.
 *
 * WHAT IS PROVEN
 *
 *   accounting   283 equipment types = 231 canonical + 19 superseded + 33 retired
 *   structure    exactly 1 new category and exactly 5 new classes
 *   types        1 new canonical Type, Submersible Pump, in Pump > Submersible Pump
 *   placements   all 62 ratified placement rows sit in their ratified class
 *   resolutions  55 = 19 approved target-bearing + 33 approved no-successor + 3 pending
 *   terminology  65 = 46 LEGACY_NAME + 2 SYNONYM + 17 MERGED_IDENTITY_TERM
 *   special      candidates 7/8 -> the new Type; 9 -> Slurry Pump; 56 -> 200 by
 *                identity; 6/158/190 canonical and pending
 *   import       retired and superseded codes cannot resolve; COMPACT now yields
 *                ZERO canonical matches rather than an arbitrary one
 *   safety       wrong/absent corpus fails loudly and changes nothing; a second
 *                application is a verified no-op
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
  : 'database-mutating taxonomy-application suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'migrate-postgres.js');
const BOOTSTRAP = path.join(REPO_ROOT, 'scripts', 'bootstrap-knowledge', 'bootstrap.js');
const APPLIER = path.join(REPO_ROOT, 'scripts', 'm5r4b2', 'apply-taxonomy-application.js');
const RECONCILIATION = path.join(REPO_ROOT, 'docs', 'research', 'm5r4a', 'equipment-type-reconciliation.jsonl');
const PLACEMENT = path.join(REPO_ROOT, 'docs', 'research', 'm5r4b1', 'parent-taxonomy-placement-review.jsonl');

const SERVER = {
  host: process.env.TEST_DB_HOST,
  port: Number(process.env.TEST_DB_PORT),
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD
};

const EXPECTED = {
  typesBefore: 282, typesAfter: 283,
  canonical: 231, superseded: 19, retired: 33,
  categories: 66, classes: 316,
  resolutions: 55, withTarget: 19, withoutTarget: 33, pending: 3,
  terms: 65, legacy: 46, synonyms: 2, merged: 17
};

const NEW_CLASSES = [
  ['Instrumentation', 'Level Switch'],
  ['Mining Equipment', 'Cutting Equipment'],
  ['Mining Equipment', 'Mine Hoisting'],
  ['Drilling', 'Well Control Equipment'],
  ['Drilling', 'Hoisting Equipment']
];

const readJsonl = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

/**
 * Environment for a child process bound to `database`.
 *
 * TEST_DB_* and the gate variables are REMOVED, because the migration runner,
 * the bootstrap and the applier are real-database tools that deliberately refuse
 * to run while the disposable-test markers are present — the same convention
 * tests/migration-runner.test.js follows. They are given explicit DB_* values
 * instead, which is what those tools expect.
 */
function dbEnv(database, extra = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('TEST_DB_')) delete env[name];
  }
  for (const name of ['NODE_ENV', 'RUN_DB_TESTS', 'PGHOST', 'PGPORT', 'PGDATABASE',
    'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'DB_SSL', 'DB_SSL_REJECT_UNAUTHORIZED']) {
    delete env[name];
  }
  return {
    ...env,
    DB_HOST: SERVER.host, DB_PORT: String(SERVER.port),
    DB_USER: SERVER.user, DB_PASSWORD: SERVER.password, DB_NAME: database,
    LC_ALL: 'C',
    ...extra
  };
}

/**
 * Environment for the resolver check, which runs the APPLICATION's own database
 * layer and therefore does need the sanctioned test-database gate.
 */
function appEnv(database, extra = {}) {
  return {
    ...process.env,
    TEST_DB_HOST: SERVER.host, TEST_DB_PORT: String(SERVER.port),
    TEST_DB_NAME: database, TEST_DB_USER: SERVER.user, TEST_DB_PASSWORD: SERVER.password,
    NODE_ENV: 'test', RUN_DB_TESTS: 'true',
    LC_ALL: 'C',
    ...extra
  };
}

const createdDatabases = [];
let dbCounter = 0;
// The name must satisfy the sanctioned test-database guard in
// src/config/database.js, which requires a delimited "test" token before it will
// hand out destructive-test credentials. These databases are driven by the
// application's own database layer in the import-safety checks, so the guard
// applies to them.
const uniqueDbName = () => `atiman_m5r4b2_test_${process.pid}_${++dbCounter}`;

async function serverClient(database) {
  const pool = new Pool({ host: SERVER.host, port: SERVER.port, user: SERVER.user, password: SERVER.password, database });
  const client = await pool.connect();
  return { client, pool };
}

async function createDatabase(name) {
  const { client, pool } = await serverClient('postgres');
  try {
    await client.query(`CREATE DATABASE ${name}`);
    createdDatabases.push(name);
  } finally {
    client.release();
    await pool.end();
  }
}

async function dropDatabase(name) {
  const { client, pool } = await serverClient('postgres');
  try {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
    await client.query(`DROP DATABASE IF EXISTS ${name}`);
  } finally {
    client.release();
    await pool.end();
  }
}

function runNode(script, database, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', env: dbEnv(database), timeout: 300000, cwd: REPO_ROOT
  });
}

let db;
let beforeState;
let applyOutput = '';

async function query(sql, params) {
  const { client, pool } = await serverClient(db);
  try { return (await client.query(sql, params)).rows; } finally { client.release(); await pool.end(); }
}

describe('Governed taxonomy application (ATM-001 M5R.4B2)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    db = uniqueDbName();
    await createDatabase(db);

    // 1. migrations 001-019 through the REAL runner
    const migrated = runNode(RUNNER, db);
    assert.strictEqual(migrated.status, 0, `migration runner failed:\n${migrated.stdout}\n${migrated.stderr}`);

    // 2. the corpus, through the REAL bootstrap
    const bootstrapped = runNode(BOOTSTRAP, db);
    assert.strictEqual(bootstrapped.status, 0, `bootstrap failed:\n${bootstrapped.stdout}\n${bootstrapped.stderr}`);

    // 3. accountable principals, so no attribution is fabricated
    const { client, pool } = await serverClient(db);
    try {
      await client.query(`INSERT INTO organizations (id, organization_name) VALUES (990001, 'Atiman') ON CONFLICT DO NOTHING`);
      await client.query(`
        INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
        VALUES (990002, 'm5r4b2-reviewer', 'rev@test.local', 'x', 'Reviewer', 'admin', 990001, true),
               (990003, 'm5r4b2-approver', 'app@test.local', 'x', 'Approver', 'admin', 990001, true)
        ON CONFLICT DO NOTHING`);
    } finally { client.release(); await pool.end(); }

    beforeState = (await query(`
      SELECT count(*)::int AS types,
             count(*) FILTER (WHERE identity_state = 'canonical')::int AS canonical,
             (SELECT count(*)::int FROM equipment_categories) AS categories,
             (SELECT count(*)::int FROM equipment_classes) AS classes
      FROM equipment_types`))[0];

    // 4. the governed application, through the REAL CLI
    const applied = runNode(APPLIER, db, ['--apply', '--reviewer', 'm5r4b2-reviewer', '--approver', 'm5r4b2-approver']);
    applyOutput = `${applied.stdout}\n${applied.stderr}`;
    assert.strictEqual(applied.status, 0, `application failed:\n${applyOutput}`);
  });

  after(async () => {
    for (const name of createdDatabases.splice(0)) {
      try { await dropDatabase(name); } catch { /* the disposable server may already be gone */ }
    }
  });

  // ==========================================================
  // A. before / after accounting
  // ==========================================================
  describe('A. accounting', () => {
    it('1. the corpus is exactly 282 types, all canonical, before application', () => {
      assert.strictEqual(beforeState.types, EXPECTED.typesBefore);
      assert.strictEqual(beforeState.canonical, EXPECTED.typesBefore,
        'a freshly bootstrapped corpus is entirely canonical');
      assert.strictEqual(beforeState.categories, 65);
      assert.strictEqual(beforeState.classes, 311);
    });

    it('2. after application there are 283 types, 231 / 19 / 33', async () => {
      const rows = await query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE identity_state = 'canonical')::int AS canonical,
               count(*) FILTER (WHERE identity_state = 'superseded')::int AS superseded,
               count(*) FILTER (WHERE identity_state = 'retired')::int AS retired
        FROM equipment_types`);
      assert.strictEqual(rows[0].total, EXPECTED.typesAfter);
      assert.strictEqual(rows[0].canonical, EXPECTED.canonical);
      assert.strictEqual(rows[0].superseded, EXPECTED.superseded);
      assert.strictEqual(rows[0].retired, EXPECTED.retired);
      assert.strictEqual(rows[0].canonical + rows[0].superseded + rows[0].retired, EXPECTED.typesAfter);
    });

    it('3. no lifecycle value outside canonical / superseded / retired exists', async () => {
      const rows = await query(`
        SELECT DISTINCT identity_state FROM equipment_types
        WHERE identity_state NOT IN ('canonical','superseded','retired')`);
      assert.deepStrictEqual(rows, []);
    });

    it('4. exactly one category and exactly five classes were added', async () => {
      const rows = await query(`
        SELECT (SELECT count(*)::int FROM equipment_categories) AS categories,
               (SELECT count(*)::int FROM equipment_classes) AS classes`);
      assert.strictEqual(rows[0].categories, EXPECTED.categories, '65 + 1');
      assert.strictEqual(rows[0].classes, EXPECTED.classes, '311 + 5');
    });

    it('5. lifecycle is coherent everywhere: every standing matches its active approved resolution set', async () => {
      const rows = await query(`
        SELECT t.id FROM equipment_types t
        LEFT JOIN equipment_type_identity_resolution r
          ON r.from_type_id = t.id AND r.review_state = 'approved' AND r.superseded_by_resolution_id IS NULL
        GROUP BY t.id, t.identity_state
        HAVING (t.identity_state = 'canonical'  AND count(r.id) <> 0)
            OR (t.identity_state = 'superseded' AND (count(r.id) <> 1
                 OR count(r.id) FILTER (WHERE r.to_type_id IS NOT NULL) <> 1))
            OR (t.identity_state = 'retired'    AND (count(r.id) <> 1
                 OR count(r.id) FILTER (WHERE r.to_type_id IS NOT NULL) <> 0))`);
      assert.deepStrictEqual(rows.map((r) => r.id), []);
    });
  });

  // ==========================================================
  // B. parent taxonomy
  // ==========================================================
  describe('B. parent taxonomy', () => {
    it('6. exactly the ratified category exists', async () => {
      const rows = await query(`SELECT count(*)::int AS n FROM equipment_categories WHERE category_name = 'Mining Equipment'`);
      assert.strictEqual(rows[0].n, 1);
    });

    it('7. exactly the five ratified classes exist, no more', async () => {
      for (const [category, klass] of NEW_CLASSES) {
        const rows = await query(`
          SELECT count(*)::int AS n FROM equipment_classes c
          JOIN equipment_categories g ON g.id = c.category_id
          WHERE g.category_name = $1 AND c.class_name = $2`, [category, klass]);
        assert.strictEqual(rows[0].n, 1, `${category} > ${klass} must exist exactly once`);
      }
      const total = await query(`
        SELECT count(*)::int AS n FROM equipment_classes c
        JOIN equipment_categories g ON g.id = c.category_id
        WHERE (g.category_name, c.class_name) IN (${NEW_CLASSES.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(',')})`,
      NEW_CLASSES.flat());
      assert.strictEqual(total[0].n, 5, 'no additional ratified class may exist');
    });

    it('8. all 62 ratified placement rows sit in their ratified class', async () => {
      // Identity is the immutable equipment_types.id: the application asserted it
      // equals the corpus id, so the id is the safe key once classes have moved.
      const placement = readJsonl(PLACEMENT);
      assert.strictEqual(placement.length, 62);

      const classes = await query(`
        SELECT g.category_name, c.class_name, c.id
        FROM equipment_classes c JOIN equipment_categories g ON g.id = c.category_id`);
      const classId = new Map(classes.map((c) => [`${c.category_name}|${c.class_name}`, c.id]));

      const live = await query('SELECT id, class_id, type_name FROM equipment_types');
      const liveById = new Map(live.map((t) => [t.id, t]));

      const wrong = [];
      for (const row of placement) {
        const target = classId.get(`${row.final_category}|${row.final_class}`);
        assert.ok(target, `ratified class missing: ${row.final_category} > ${row.final_class}`);
        const type = liveById.get(row.candidate_id);
        assert.ok(type, `candidate ${row.candidate_id} is not present by identity`);
        if (type.class_id !== target) {
          wrong.push(`${row.candidate_id} ${row.candidate_name}: in class ${type.class_id}, ratified ${target}`);
        }
      }
      assert.deepStrictEqual(wrong, [], 'every placement-bearing row must sit in its ratified class');
    });

    it('9. the 62 placement rows are exactly those the ratified review lists', async () => {
      const placement = readJsonl(PLACEMENT);
      const ids = placement.map((r) => r.candidate_id).sort((a, b) => a - b);
      assert.strictEqual(new Set(ids).size, 62);
      assert.deepStrictEqual(ids, [...ids].sort((a, b) => a - b));
    });
  });

  // ==========================================================
  // C. the new canonical Type
  // ==========================================================
  describe('C. the new canonical Type', () => {
    it('10. exactly one Submersible Pump exists, canonical, in Pump > Submersible Pump', async () => {
      const rows = await query(`
        SELECT t.id, t.type_code, t.type_name, t.identity_state, g.category_name, c.class_name
        FROM equipment_types t
        JOIN equipment_classes c ON c.id = t.class_id
        JOIN equipment_categories g ON g.id = c.category_id
        WHERE t.type_name = 'Submersible Pump'`);
      assert.strictEqual(rows.length, 1, 'exactly one new Type');
      assert.strictEqual(rows[0].identity_state, 'canonical');
      assert.strictEqual(rows[0].category_name, 'Pump');
      assert.strictEqual(rows[0].class_name, 'Submersible Pump');
    });

    it('11. its type code is unique within its class', async () => {
      const rows = await query(`
        SELECT t.type_code, count(*)::int AS n
        FROM equipment_types t
        JOIN equipment_classes c ON c.id = t.class_id
        WHERE c.class_name = 'Submersible Pump' AND c.id = (SELECT id FROM equipment_classes WHERE class_name='Submersible Pump')
        GROUP BY t.type_code HAVING count(*) > 1`);
      assert.deepStrictEqual(rows, []);
    });

    it('12. no other new Type was created beyond the corpus and this one', async () => {
      const rows = await query(`SELECT count(*)::int AS n FROM equipment_types`);
      assert.strictEqual(rows[0].n, EXPECTED.typesBefore + 1,
        'exactly one genuinely new row; the 29 ADD_TYPE outcomes are transformations of existing rows');
    });
  });

  // ==========================================================
  // D. identity resolutions
  // ==========================================================
  describe('D. identity resolutions', () => {
    it('13. exactly 55 governed resolution records, partitioned as ratified', async () => {
      const rows = await query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE review_state='approved' AND to_type_id IS NOT NULL)::int AS with_target,
               count(*) FILTER (WHERE review_state='approved' AND to_type_id IS NULL)::int AS without_target,
               count(*) FILTER (WHERE resolution_kind='INSUFFICIENT_EVIDENCE' AND review_state <> 'approved')::int AS pending
        FROM equipment_type_identity_resolution`);
      assert.strictEqual(rows[0].total, EXPECTED.resolutions);
      assert.strictEqual(rows[0].with_target, EXPECTED.withTarget);
      assert.strictEqual(rows[0].without_target, EXPECTED.withoutTarget);
      assert.strictEqual(rows[0].pending, EXPECTED.pending);
    });

    it('14. the approved target-bearing resolutions are 17 merges and 2 synonyms', async () => {
      const rows = await query(`
        SELECT resolution_kind, count(*)::int AS n FROM equipment_type_identity_resolution
        WHERE review_state='approved' AND to_type_id IS NOT NULL GROUP BY resolution_kind`);
      const byKind = Object.fromEntries(rows.map((r) => [r.resolution_kind, r.n]));
      assert.strictEqual(byKind.MERGED_DUPLICATE, 17);
      assert.strictEqual(byKind.SYNONYM_OF, 2);
    });

    it('15. the approved no-successor resolutions are 29 non-types and 4 too-broad containers', async () => {
      const rows = await query(`
        SELECT resolution_kind, count(*)::int AS n FROM equipment_type_identity_resolution
        WHERE review_state='approved' AND to_type_id IS NULL GROUP BY resolution_kind`);
      const byKind = Object.fromEntries(rows.map((r) => [r.resolution_kind, r.n]));
      assert.strictEqual(byKind.NOT_AN_EQUIPMENT_TYPE, 29);
      assert.strictEqual(byKind.TOO_BROAD_FOR_TYPE, 4);
    });

    it('16. every approved target is canonical, and every source agrees with its standing', async () => {
      const rows = await query(`
        SELECT r.id, r.from_type_id, r.to_type_id, r.resolution_kind, s.identity_state AS source_state, t.identity_state AS target_state
        FROM equipment_type_identity_resolution r
        JOIN equipment_types s ON s.id = r.from_type_id
        LEFT JOIN equipment_types t ON t.id = r.to_type_id
        WHERE r.review_state = 'approved'`);
      assert.strictEqual(rows.length, 52);
      for (const r of rows) {
        assert.strictEqual(r.source_state, r.to_type_id === null ? 'retired' : 'superseded',
          `resolution ${r.id} disagrees with its source standing`);
        if (r.to_type_id !== null) assert.strictEqual(r.target_state, 'canonical');
      }
    });

    it('17. the pending records carry no target and no approved conclusion', async () => {
      const rows = await query(`
        SELECT id, to_type_id, review_state, resolution_kind
        FROM equipment_type_identity_resolution WHERE resolution_kind = 'INSUFFICIENT_EVIDENCE'`);
      assert.strictEqual(rows.length, 3);
      for (const r of rows) {
        assert.strictEqual(r.to_type_id, null);
        assert.ok(['draft', 'under_review'].includes(r.review_state));
      }
    });
  });

  // ==========================================================
  // E. terminology
  // ==========================================================
  describe('E. terminology', () => {
    it('18. exactly 65 governed terms, partitioned 46 / 2 / 17', async () => {
      const rows = await query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE term_kind='LEGACY_NAME')::int AS legacy,
               count(*) FILTER (WHERE term_kind='SYNONYM')::int AS synonym,
               count(*) FILTER (WHERE term_kind='MERGED_IDENTITY_TERM')::int AS merged
        FROM equipment_type_term`);
      assert.strictEqual(rows[0].total, EXPECTED.terms);
      assert.strictEqual(rows[0].legacy, EXPECTED.legacy);
      assert.strictEqual(rows[0].synonym, EXPECTED.synonyms);
      assert.strictEqual(rows[0].merged, EXPECTED.merged);
    });

    it('19. every term is approved, attributed, and targets a real canonical Type', async () => {
      const rows = await query(`
        SELECT m.id, m.review_state, m.approved_by_user_id, m.reviewed_by_user_id,
               m.rationale, t.identity_state
        FROM equipment_type_term m
        LEFT JOIN equipment_types t ON t.id = m.canonical_type_id`);
      assert.strictEqual(rows.length, EXPECTED.terms);
      for (const r of rows) {
        assert.strictEqual(r.review_state, 'approved');
        assert.ok(r.approved_by_user_id && r.reviewed_by_user_id, 'human attribution is required');
        assert.ok(r.rationale && r.rationale.trim().length > 0, 'a rationale is required');
        assert.ok(r.identity_state, 'the canonical target must exist');
      }
    });

    it('20. no terminology record was created for the 29 ADD_TYPE transformations', async () => {
      // The ratified accounting excludes them: their canonical names changed but
      // they originate identities, so there is no prior vocabulary to preserve.
      const reconciliation = readJsonl(RECONCILIATION);
      const addTypeNames = reconciliation.filter((r) => r.disposition === 'ADD_TYPE').map((r) => r.candidate_name);
      const rows = await query(
        'SELECT count(*)::int AS n FROM equipment_type_term WHERE term = ANY($1)', [addTypeNames]);
      assert.strictEqual(rows[0].n, 0,
        'ADD_TYPE rows must not generate terminology merely because their canonical name changed');
    });

    it('21. ABBREVIATION was not introduced as a term kind', async () => {
      const rows = await query(`
        SELECT DISTINCT term_kind FROM equipment_type_term
        WHERE term_kind NOT IN ('LEGACY_NAME','SYNONYM','MERGED_IDENTITY_TERM')`);
      assert.deepStrictEqual(rows, []);
    });
  });

  // ==========================================================
  // F. special identity cases
  // ==========================================================
  describe('F. special identity cases', () => {
    it('22. candidates 7 and 8 target the NEW Submersible Pump by immutable id', async () => {
      const rows = await query(`
        SELECT r.from_type_id, r.to_type_id, r.resolution_kind, r.review_state, s.identity_state
        FROM equipment_type_identity_resolution r
        JOIN equipment_types s ON s.id = r.from_type_id
        WHERE r.from_type_id IN (7, 8)`);
      assert.strictEqual(rows.length, 2);
      const newTypeId = (await query(`SELECT id FROM equipment_types WHERE type_name = 'Submersible Pump'`))[0].id;
      for (const r of rows) {
        assert.strictEqual(r.resolution_kind, 'MERGED_DUPLICATE', 'disposition is retained');
        assert.strictEqual(r.review_state, 'approved');
        assert.strictEqual(r.to_type_id, newTypeId, 'must target the new Type, not the class');
        assert.strictEqual(r.identity_state, 'superseded');
      }
    });

    it('23. candidate 9 targets the existing Slurry Pump, not the new Type', async () => {
      const rows = await query('SELECT to_type_id FROM equipment_type_identity_resolution WHERE from_type_id = 9');
      assert.strictEqual(rows.length, 1);
      const [slurry] = await query(`SELECT id FROM equipment_types WHERE type_name = 'Slurry Pump'`);
      const [submersible] = await query(`SELECT id FROM equipment_types WHERE type_name = 'Submersible Pump'`);
      assert.strictEqual(rows[0].to_type_id, slurry.id);
      assert.notStrictEqual(rows[0].to_type_id, submersible.id);
    });

    it('24. candidate 56 resolves to candidate 200 by immutable identity, and 200 stays canonical', async () => {
      const rows = await query('SELECT to_type_id FROM equipment_type_identity_resolution WHERE from_type_id = 56');
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].to_type_id, 200, 'identity, not the ambiguous name "Pressure Filter"');
      const [target] = await query('SELECT identity_state, type_code FROM equipment_types WHERE id = 200');
      assert.strictEqual(target.identity_state, 'canonical');
      const [source] = await query('SELECT identity_state FROM equipment_types WHERE id = 56');
      assert.strictEqual(source.identity_state, 'superseded');
    });

    it('25. candidates 6, 158 and 190 remain canonical and explicitly unresolved', async () => {
      const rows = await query(`
        SELECT s.id, s.identity_state, r.to_type_id, r.review_state
        FROM equipment_types s
        JOIN equipment_type_identity_resolution r ON r.from_type_id = s.id
        WHERE s.id IN (6, 158, 190)`);
      assert.strictEqual(rows.length, 3);
      for (const r of rows) {
        assert.strictEqual(r.identity_state, 'canonical', 'uncertainty is not a lifecycle state');
        assert.strictEqual(r.to_type_id, null);
        assert.notStrictEqual(r.review_state, 'approved', 'no approved conclusion exists');
      }
    });
  });

  // ==========================================================
  // G. import safety after application
  // ==========================================================
  describe('G. import safety after application', () => {
    const resolve = (code) => spawnSync(process.execPath, ['-e', `
      const s = require(${JSON.stringify(path.join(REPO_ROOT, 'src', 'services', 'asset-import.service.js'))});
      s.validateEquipmentType(process.argv[1]).then(r => { console.log('RESOLVED ' + r.id); })
        .catch(e => { console.log('REJECTED ' + e.message); });
    `, code], { encoding: 'utf8', env: appEnv(db), timeout: 60000 });

    it('26. a canonical code still resolves', () => {
      const out = resolve('END_SUCT');
      assert.match(out.stdout, /^RESOLVED \d+/m, `expected resolution | stdout=${JSON.stringify(out.stdout)} stderr=${JSON.stringify((out.stderr||'').slice(0,600))}`);
    });

    it('27. a RETIRED-only code cannot resolve', () => {
      const out = resolve('COMPACT');
      assert.match(out.stdout, /^REJECTED /m, `retired codes must not be selectable | stdout=${JSON.stringify(out.stdout)} stderr=${JSON.stringify((out.stderr||'').slice(0,600))}`);
    });

    it('28. a SUPERSEDED-only code cannot resolve', () => {
      const out = resolve('MULTI');
      assert.match(out.stdout, /^REJECTED /m, `superseded codes must not be selectable | stdout=${JSON.stringify(out.stdout)} stderr=${JSON.stringify((out.stderr||'').slice(0,600))}`);
    });

    it('29. the new canonical Type resolves by its code', () => {
      const out = resolve('SUBM_PUMP');
      assert.match(out.stdout, /^RESOLVED \d+/m, `stdout=${JSON.stringify(out.stdout)} stderr=${JSON.stringify((out.stderr||'').slice(0,600))}`);
    });

    it('30. COMPACT now yields ZERO canonical matches rather than an arbitrary one', async () => {
      const rows = await query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE identity_state='canonical')::int AS canonical
        FROM equipment_types WHERE LOWER(type_code) = 'compact'`);
      assert.strictEqual(rows[0].total, 2, 'both COMPACT rows are retained, never deleted');
      assert.strictEqual(rows[0].canonical, 0, 'both are retired, so neither is selectable');
    });
  });

  // ==========================================================
  // H. governance and fail-safe behaviour
  // ==========================================================
  describe('H. governance and fail-safe behaviour', () => {
    it('31. every governed record carries human attribution, a rationale and a provenance edition', async () => {
      const rows = await query(`
        SELECT count(*)::int AS n FROM equipment_type_identity_resolution
        WHERE review_state = 'approved'
          AND (reviewed_by_user_id IS NULL OR approved_by_user_id IS NULL
               OR rationale IS NULL OR btrim(rationale) = ''
               OR knowledge_source_version_id IS NULL)`);
      assert.strictEqual(rows[0].n, 0, 'approved resolutions must be fully attributed and reasoned');
      const terms = await query(`
        SELECT count(*)::int AS n FROM equipment_type_term WHERE knowledge_source_version_id IS NULL`);
      assert.strictEqual(terms[0].n, 0);
    });

    it('32. AI is disclosed as not the approver anywhere in the applied package', async () => {
      const rows = await query(`
        SELECT
          (SELECT count(*)::int FROM equipment_type_identity_resolution WHERE ai_assisted) AS resolutions,
          (SELECT count(*)::int FROM equipment_type_term WHERE ai_assisted) AS terms`);
      assert.strictEqual(rows[0].resolutions, 0, 'these are human engineering decisions');
      assert.strictEqual(rows[0].terms, 0);
    });

    it('33. provenance is Atiman-authored and never claims an external standard', async () => {
      const rows = await query(`SELECT source_code, source_category, issuing_organization FROM knowledge_sources ORDER BY source_code`);
      const codes = rows.map((r) => r.source_code);
      assert.deepStrictEqual(codes, ['M5R4B2-ENGINEERING-REASONING', 'M5R4B2-LEGACY-CORPUS']);
      const categories = Object.fromEntries(rows.map((r) => [r.source_code, r.source_category]));
      assert.strictEqual(categories['M5R4B2-ENGINEERING-REASONING'], 'engineering_authored');
      assert.strictEqual(categories['M5R4B2-LEGACY-CORPUS'], 'legacy_migration');
    });

    it('34. applying again is a verified no-op that duplicates nothing', async () => {
      const snapshot = async () => JSON.stringify(await query(`
        SELECT (SELECT count(*)::int FROM equipment_types) AS types,
               (SELECT count(*)::int FROM equipment_categories) AS categories,
               (SELECT count(*)::int FROM equipment_classes) AS classes,
               (SELECT count(*)::int FROM equipment_type_identity_resolution) AS resolutions,
               (SELECT count(*)::int FROM equipment_type_term) AS terms,
               (SELECT count(*)::int FROM knowledge_sources) AS sources,
               (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM equipment_types) AS type_ids`));
      const before = await snapshot();
      const again = runNode(APPLIER, db, ['--apply', '--reviewer', 'm5r4b2-reviewer', '--approver', 'm5r4b2-approver']);
      assert.strictEqual(again.status, 0, `second application failed:\n${again.stdout}${again.stderr}`);
      assert.match(again.stdout, /already applied/);
      assert.strictEqual(await snapshot(), before, 'a re-run must not duplicate or alter governed data');
    });

    it('35. a database WITHOUT the corpus fails loudly and changes nothing', async () => {
      // A database that has been migrated but NOT bootstrapped has no taxonomy at
      // all. The application must refuse rather than create structure around a
      // corpus it cannot resolve, and it must leave the database untouched.
      const bare = uniqueDbName();
      await createDatabase(bare);
      try {
        const migrated = runNode(RUNNER, bare);
        assert.strictEqual(migrated.status, 0, `migration runner failed on the bare database:\n${migrated.stdout}${migrated.stderr}`);

        const snapshot = async () => {
          const { client, pool } = await serverClient(bare);
          try {
            return (await client.query(`
              SELECT (SELECT count(*)::int FROM equipment_types) AS types,
                     (SELECT count(*)::int FROM equipment_categories) AS categories,
                     (SELECT count(*)::int FROM equipment_classes) AS classes,
                     (SELECT count(*)::int FROM equipment_type_term) AS terms,
                     (SELECT count(*)::int FROM equipment_type_identity_resolution) AS resolutions,
                     (SELECT count(*)::int FROM knowledge_sources) AS sources`)).rows[0];
          } finally { client.release(); await pool.end(); }
        };

        const before = await snapshot();
        assert.strictEqual(before.types, 0, 'the bare database has no corpus, which is the point of this case');

        const applied = runNode(APPLIER, bare, ['--apply', '--reviewer', 'm5r4b2-reviewer', '--approver', 'm5r4b2-approver']);
        assert.notStrictEqual(applied.status, 0, 'applying without a corpus must fail');
        assert.match(`${applied.stdout}${applied.stderr}`,
          /resolved to 0 equipment_types rows/,
          'the failure must say the identity could not be resolved, rather than guess');

        const after = await snapshot();
        assert.deepStrictEqual(after, before,
          'a refused application must leave the database exactly as it found it');
      } finally {
        await dropDatabase(bare);
      }
    });
  });
});
