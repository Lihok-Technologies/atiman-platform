const { describe, it } = require('node:test');
const assert = require('node:assert');
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

// Suites that perform database mutations. Each must be gated on
// isIntegrationTest() so that "may this suite execute?" and "are TEST_DB_*
// credentials selected?" are the same question. A suite gated on anything
// weaker (for example RUN_DB_TESTS alone) runs while getDatabaseConfig() still
// resolves runtime DB_*/PG* credentials - production in a configured
// environment.
const DB_MUTATING_SUITES = [
  'knowledge-versioning.test.js',
  'step6-access-control.test.js',
  'step6-coverage-e2e.test.js',
  'step6-performance.test.js',
  'step6-regression.test.js',
  'step6-seed-migration.test.js'
];

const REPO_ROOT = path.resolve(__dirname, '..');

const save = (names) => Object.fromEntries(names.map((name) => [name, process.env[name]]));
const restore = (values) => Object.entries(values).forEach(([name, value]) => {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
});

// Run one suite in a subprocess with a controlled database environment.
const runSuite = (suiteFile, overrides = {}) => {
  const childEnv = { ...process.env };
  for (const name of DATABASE_ENV_NAMES) delete childEnv[name];
  Object.assign(childEnv, overrides);

  const result = spawnSync(
    process.execPath,
    ['--test', path.join('tests', suiteFile)],
    { cwd: REPO_ROOT, env: childEnv, encoding: 'utf8' }
  );
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
};

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
