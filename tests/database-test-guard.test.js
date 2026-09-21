const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDatabaseConfig, isIntegrationTest } = require('../src/config/database');

const save = (names) => Object.fromEntries(names.map((name) => [name, process.env[name]]));
const restore = (values) => Object.entries(values).forEach(([name, value]) => {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
});

describe('integration database safety guard', () => {
  const names = ['NODE_ENV', 'RUN_DB_TESTS', 'TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD'];

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

  // Proves the actual safety property: the database-mutating knowledge-versioning
  // suite must not execute through the default test command when the gate is not
  // satisfied. Run in a subprocess with every database variable stripped so the
  // result cannot depend on this process's environment.
  it('skips the database-mutating knowledge-versioning suite without the database-test gate', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const childEnv = { ...process.env };
    for (const name of [
      ...names, 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
      'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE',
      // Set by the parent test runner; must be cleared or the child refuses to
      // run files at all ("node:test run() is being called recursively").
      'NODE_TEST_CONTEXT'
    ]) {
      delete childEnv[name];
    }

    const result = spawnSync(
      process.execPath,
      ['--test', path.join('tests', 'knowledge-versioning.test.js')],
      { cwd: repoRoot, env: childEnv, encoding: 'utf8' }
    );

    const output = `${result.stdout || ''}${result.stderr || ''}`;
    assert.strictEqual(result.status, 0, `expected a clean run, got:\n${output}`);
    // No test body may execute: node reports the suite as skipped with `tests 0`.
    assert.match(output, /tests 0/, `expected zero executed tests:\n${output}`);
    assert.match(output, /fail 0/, `expected no failing tests:\n${output}`);
    assert.match(
      output,
      /database-mutating knowledge-versioning suite requires the sanctioned/,
      `expected the gate reason to be reported:\n${output}`
    );
  });
});
