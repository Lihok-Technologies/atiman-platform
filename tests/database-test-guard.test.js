const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDatabaseConfig, isIntegrationTest } = require('../src/config/database');

const ENV_NAMES = ['NODE_ENV', 'RUN_DB_TESTS', 'TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD'];

// Every environment variable that could point a test run at a database. Cleared
// for subprocess runs so a result can never depend on this process's environment.
const DATABASE_ENV_NAMES = [
  ...ENV_NAMES,
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL',
  'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE',
  // Set by the parent test runner; must be cleared or the child refuses to run
  // files at all ("node:test run() is being called recursively").
  'NODE_TEST_CONTEXT'
];

// Every suite known to mutate a database. Each must be gated on
// isIntegrationTest() so that "may this suite execute?" and "are TEST_DB_*
// credentials selected?" are the same question. A suite gated on anything
// weaker (for example RUN_DB_TESTS alone) runs while getDatabaseConfig() still
// resolves runtime DB_*/PG* credentials - production in a configured
// environment.
//
// Membership here is about SAFETY (which files can mutate a database), not about
// which suites CI should run. The five step6-* files are legacy ODM-CMMS suites
// that are no longer part of the sanctioned PostgreSQL acceptance path, but they
// remain database-mutating files, so they stay in this list.
const DB_MUTATING_SUITES = [
  'knowledge-versioning.test.js',
  'knowledge-publication-admission.test.js',
  // Creates and drops disposable databases on the test server, so it mutates
  // databases just as surely as the suites above.
  'migration-runner.test.js',
  'knowledge-pack-membership.test.js',
  'knowledge-provenance-authoring.test.js',
  // ATM-001 M4: drives migration 015 and the governed pack publication path.
  'knowledge-pack-publication-admission.test.js',
  // ATM-001 M5R.3A: external authority/edition groundwork.
  'external-authority-edition-groundwork.test.js',
  // ATM-001 M5R.3B: external classification foundation (migration 016).
  'external-classification-foundation.test.js',
  // ATM-001 M5R.3C: governed crosswalk (migration 017).
  'external-classification-crosswalk.test.js',
  // ATM-001 M5R.3D: crosswalk evidence foundation (migration 018).
  'external-classification-crosswalk-evidence.test.js',
  'step6-access-control.test.js',
  'step6-coverage-e2e.test.js',
  'step6-performance.test.js',
  'step6-regression.test.js',
  'step6-seed-migration.test.js'
];

// Suites the sanctioned PostgreSQL runner is expected to execute. Membership
// here is about CONTRACT (which suites represent current Atiman PostgreSQL
// architecture), not about safety. This must stay in step with
// SANCTIONED_POSTGRES_INTEGRATION_SUITES in scripts/run-integration-tests.js.
const SANCTIONED_POSTGRES_INTEGRATION_SUITES = [
  'knowledge-versioning.test.js',
  'knowledge-publication-admission.test.js',
  'migration-runner.test.js',
  'knowledge-pack-membership.test.js',
  'knowledge-provenance-authoring.test.js',
  'knowledge-pack-publication-admission.test.js',
  'external-authority-edition-groundwork.test.js',
  'external-classification-foundation.test.js',
  'external-classification-crosswalk.test.js',
  'external-classification-crosswalk-evidence.test.js'
];

const REPO_ROOT = path.resolve(__dirname, '..');

const save = (names) => Object.fromEntries(names.map((name) => [name, process.env[name]]));
const restore = (values) => Object.entries(values).forEach(([name, value]) => {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
});

// Run a node entry point in a subprocess with a controlled database environment.
const runNode = (args, overrides = {}) => {
  const childEnv = { ...process.env };
  for (const name of DATABASE_ENV_NAMES) delete childEnv[name];
  Object.assign(childEnv, overrides);

  const result = spawnSync(
    process.execPath,
    args,
    { cwd: REPO_ROOT, env: childEnv, encoding: 'utf8' }
  );
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
};

const runSuite = (suiteFile, overrides) =>
  runNode(['--test', path.join('tests', suiteFile)], overrides);

describe('integration database safety guard', () => {
  const names = ENV_NAMES;

  it('refuses destructive test mode without an explicitly named test database', () => {
    const original = save(names);
    try {
      Object.assign(process.env, { NODE_ENV: 'test', RUN_DB_TESTS: 'true' });
      delete process.env.TEST_DB_NAME;
      assert.throws(() => getDatabaseConfig(), /Refusing destructive integration tests/);
      Object.assign(process.env, {
        TEST_DB_HOST: '127.0.0.1', TEST_DB_PORT: '3306', TEST_DB_NAME: 'odm_cmms_test', TEST_DB_USER: 'test', TEST_DB_PASSWORD: 'test-password'
      });
      assert.deepStrictEqual(getDatabaseConfig(), {
        host: '127.0.0.1', port: 3306, database: 'odm_cmms_test', user: 'test', password: 'test-password', ssl: false
      });
    } finally {
      restore(original);
    }
  });

  // RUN_DB_TESTS alone is NOT a sufficient gate: src/config/database.js only
  // switches to TEST_DB_* when NODE_ENV is also 'test'. With RUN_DB_TESTS set
  // and NODE_ENV unset, the pool still uses the runtime DB_* credentials, so any
  // suite gating on RUN_DB_TESTS alone would mutate the runtime database.
  it('treats RUN_DB_TESTS without NODE_ENV=test as NOT enabled for database tests', () => {
    const original = save(names);
    try {
      Object.assign(process.env, { RUN_DB_TESTS: 'true' });
      delete process.env.NODE_ENV;
      assert.strictEqual(isIntegrationTest(), false);

      const config = getDatabaseConfig();
      assert.notStrictEqual(
        config.database,
        process.env.TEST_DB_NAME,
        'must not select TEST_DB_* while the integration-test predicate is false'
      );
    } finally {
      restore(original);
    }
  });
});

// End-to-end proof of the safety invariant, one row per database-mutating suite.
describe('database-mutating suites cannot execute without the database-test gate', () => {
  for (const suiteFile of DB_MUTATING_SUITES) {
    it(`${suiteFile} executes zero tests with no database-test opt-in`, () => {
      const { status, output } = runSuite(suiteFile);
      assert.strictEqual(status, 0, `expected a clean skip run:\n${output}`);
      assert.match(output, /tests 0/, `expected zero executed tests:\n${output}`);
      assert.match(output, /fail 0/, `expected no failing tests:\n${output}`);
    });

    it(`${suiteFile} executes zero tests with RUN_DB_TESTS=true while NODE_ENV is not test`, () => {
      const { status, output } = runSuite(suiteFile, { RUN_DB_TESTS: 'true' });
      assert.strictEqual(status, 0, `expected a clean skip run:\n${output}`);
      assert.match(output, /tests 0/, `expected zero executed tests:\n${output}`);
      assert.match(output, /fail 0/, `expected no failing tests:\n${output}`);
    });

    it(`${suiteFile} fails closed when TEST_DB_* is missing under full opt-in`, () => {
      const { status, output } = runSuite(suiteFile, { NODE_ENV: 'test', RUN_DB_TESTS: 'true' });
      assert.notStrictEqual(status, 0, `expected a fail-closed run:\n${output}`);
      assert.match(
        output,
        /Refusing destructive integration tests/,
        `expected the guard to refuse rather than fall back to runtime credentials:\n${output}`
      );
    });
  }
});

// tests/step6-runner.js spawns the destructive Step 6 suites, so it must
// establish the gate itself and must refuse to run unless TEST_DB_* has already
// passed the repository's sanctioned validation. Every scenario below is one
// that must never reach a database.
describe('integration runner refuses to run without a sanctioned test database', () => {
  const RUNNER = path.join('tests', 'step6-runner.js');

  const completeTestDb = {
    TEST_DB_HOST: '127.0.0.1',
    TEST_DB_PORT: '5432',
    TEST_DB_USER: 'test',
    TEST_DB_PASSWORD: 'test-password'
  };

  const SCENARIOS = [
    ['no database-test configuration at all', {}],
    ['runtime DB_* credentials only', { DB_HOST: '127.0.0.1', DB_NAME: 'odm_cmms', DB_USER: 'postgres', DB_PASSWORD: 'runtime-password' }],
    ['runtime PG* credentials only', { PGHOST: '127.0.0.1', PGDATABASE: 'odm_cmms', PGUSER: 'postgres', PGPASSWORD: 'runtime-password' }],
    ['the partial gate RUN_DB_TESTS=true alone', { RUN_DB_TESTS: 'true' }],
    ['the partial gate NODE_ENV=test alone', { NODE_ENV: 'test' }],
    ['a full gate whose TEST_DB_NAME does not identify a test database', {
      NODE_ENV: 'test', RUN_DB_TESTS: 'true', ...completeTestDb, TEST_DB_NAME: 'production'
    }],
    ['a full gate with TEST_DB_* incomplete', {
      NODE_ENV: 'test', RUN_DB_TESTS: 'true', TEST_DB_HOST: '127.0.0.1'
    }]
  ];

  for (const [label, env] of SCENARIOS) {
    it(`refuses to execute suites with ${label}`, () => {
      const { status, output } = runNode([RUNNER], env);
      assert.notStrictEqual(status, 0, `expected the runner to refuse:\n${output}`);
      assert.match(
        output,
        /Refusing (to run Step 6 database suites|destructive integration tests)/,
        `expected a refusal rather than a database connection attempt:\n${output}`
      );
      assert.ok(
        !/Running: step6-/.test(output),
        `runner must not reach the point of spawning suites:\n${output}`
      );
    });
  }
});

// The sanctioned integration runner defines which suites count as Atiman's
// PostgreSQL acceptance evidence, so its list must not drift silently - either
// by losing a sanctioned suite, or by a legacy suite being re-added without an
// architectural decision. The runner cannot be required for inspection because
// it validates and then exits at module load, so its source is parsed.
describe('sanctioned integration runner matches the PostgreSQL acceptance contract', () => {
  it('invokes exactly the sanctioned PostgreSQL integration suites', () => {
    const runnerSource = fs.readFileSync(
      path.join(REPO_ROOT, 'scripts', 'run-integration-tests.js'),
      'utf8'
    );
    const listed = [...runnerSource.matchAll(/'tests\/([A-Za-z0-9_.-]+\.test\.js)'/g)]
      .map((match) => match[1]);

    assert.deepStrictEqual(
      [...new Set(listed)].sort(),
      [...SANCTIONED_POSTGRES_INTEGRATION_SUITES].sort(),
      'scripts/run-integration-tests.js must invoke exactly the sanctioned PostgreSQL integration suites'
    );
  });

  it('keeps the sanctioned set a subset of the known database-mutating suites', () => {
    const unsanctionedMutators = SANCTIONED_POSTGRES_INTEGRATION_SUITES
      .filter((suiteFile) => !DB_MUTATING_SUITES.includes(suiteFile));

    assert.deepStrictEqual(
      unsanctionedMutators,
      [],
      'every sanctioned integration suite must also be tracked as database-mutating'
    );
  });
});
