/** Run destructive MySQL integration tests only against an explicitly named test database. */
const { spawnSync } = require('child_process');

const required = ['TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || !/(?:^|[_-])test(?:$|[_-])/i.test(process.env.TEST_DB_NAME || '')) {
  console.error('Refusing integration tests. Set TEST_DB_HOST, TEST_DB_PORT, TEST_DB_NAME, TEST_DB_USER, and TEST_DB_PASSWORD; TEST_DB_NAME must clearly identify a disposable test database (for example odm_cmms_test).');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', 'tests/knowledge-versioning.test.js', 'tests/step6-access-control.test.js', 'tests/step6-coverage-e2e.test.js', 'tests/step6-performance.test.js', 'tests/step6-regression.test.js', 'tests/step6-seed-migration.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', RUN_DB_TESTS: 'true' }
});
process.exit(result.status ?? 1);
