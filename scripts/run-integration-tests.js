/** Run destructive MySQL integration tests only against an explicitly named test database. */
const { spawnSync } = require('child_process');

const required = ['TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || !/(?:^|[_-])test(?:$|[_-])/i.test(process.env.TEST_DB_NAME || '')) {
  console.error('Refusing integration tests. Set TEST_DB_HOST, TEST_DB_PORT, TEST_DB_NAME, TEST_DB_USER, and TEST_DB_PASSWORD; TEST_DB_NAME must clearly identify a disposable test database (for example odm_cmms_test).');
  process.exit(1);
}

// Suites sanctioned for PostgreSQL integration execution. This is the Atiman
// PostgreSQL acceptance contract, deliberately narrower than the set of
// database-mutating suites.
//
// The five tests/step6-*.test.js suites are legacy ODM-CMMS suites that encode
// superseded architecture (organization-owned taxonomy via `org_id`, plus the
// removed tables equipment_type_mappings, smp_templates, seed_tracking and
// template_steps). They are retained as legacy evidence pending purpose-built
// Atiman replacement coverage, but they are NOT valid PostgreSQL acceptance
// suites for current Atiman. See ATM-013D.5D.
const SANCTIONED_POSTGRES_INTEGRATION_SUITES = [
  'tests/knowledge-versioning.test.js',
  'tests/knowledge-publication-admission.test.js',
  // Production migration safety: drives scripts/migrate-postgres.js and the
  // schema-readiness gate against disposable PostgreSQL databases.
  'tests/migration-runner.test.js',
  // ATM-001 M2: immutable knowledge pack membership.
  'tests/knowledge-pack-membership.test.js',
  // ATM-001 M3: governed provenance authoring.
  'tests/knowledge-provenance-authoring.test.js'
];

const result = spawnSync(process.execPath, ['--test', ...SANCTIONED_POSTGRES_INTEGRATION_SUITES], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test', RUN_DB_TESTS: 'true' }
});
process.exit(result.status ?? 1);
