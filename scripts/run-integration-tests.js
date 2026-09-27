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
  'tests/knowledge-provenance-authoring.test.js',
  // ATM-001 M4: knowledge pack publication admission and migration 015.
  'tests/knowledge-pack-publication-admission.test.js',
  // ATM-001 M5R.3A: external authority/edition groundwork (no schema change).
  'tests/external-authority-edition-groundwork.test.js',
  // ATM-001 M5R.3B: external classification foundation (migration 016).
  'tests/external-classification-foundation.test.js',
  // ATM-001 M5R.3C: governed crosswalk (migration 017).
  'tests/external-classification-crosswalk.test.js',
  // ATM-001 M5R.3D: crosswalk evidence foundation (migration 018).
  'tests/external-classification-crosswalk-evidence.test.js',
  // ATM-001 M5R.3E: governed crosswalk application layer (no migration).
  'tests/knowledge-crosswalk-application.test.js',
  // ATM-001 M5R.4B: governed taxonomy identity lifecycle mechanism (migration 019).
  'tests/taxonomy-identity-lifecycle.test.js',
  // ATM-001 M5R.4B2 prerequisite: canonical-only import resolution, ambiguity refused.
  'tests/asset-import-resolver-safety.test.js',
  // ATM-001 M5R.4B2: governed taxonomy application (disposable database).
  'tests/taxonomy-application.test.js',
  // ATM-001 M6.3: governed knowledge foundation (migration 020, disposable databases).
  'tests/governed-knowledge-foundation.test.js',
  // ATM-001 M6.3 VUDA R1: remediation regression coverage (cross-tenant pack
  // access, approval identity, frozen applicability, member scope, pack ownership).
  'tests/m6r3-r1-remediation.test.js',
  // ATM-001 M6.4: governed draft authoring primitive (draft-only authoring seam).
  'tests/knowledge-authoring.test.js',
  // ATM-001 M6.4 Step 3B-B: AI-assistance disclosure (migration 021) across the
  // schema, authoring, approval, publication and legacy-exemption boundaries.
  'tests/ai-assistance-disclosure.test.js',
  // ATM-003 capability grant foundation (migration 022): tenant-scoped,
  // attributed, revocable grant storage with no authority backfill.
  'tests/capability-grants.test.js',
  // ATM-002-I1: Atiman application shell, capability-composed work navigation
  // and the canonical Today entry.
  'tests/atiman-shell.test.js',
  // ATM-002-I2B: observation operational foundation (migration 023) — the
  // capture-before-obligation primitive, tenant-authoritative and fail-closed.
  'tests/observation-foundation.test.js'
];

/**
 * Build the environment for the disposable test processes.
 *
 * ATM-001 M6.3 R1 finding: nested processes (the migration runner, the knowledge
 * bootstrap, and anything else a suite spawns) resolve connection configuration
 * with libpq-style PG* variables taking precedence over DB_*. An inherited
 * PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD therefore silently overrides the
 * disposable database a suite intended to use — and the bootstrap is destructive.
 *
 * Every libpq connection variable is stripped here, at the boundary where
 * disposable processes are launched, so no ambient value can redirect a
 * destructive test. The TEST_DB_* gate above is unchanged and remains the only
 * source of disposable connection configuration.
 */
const LIBPQ_ENV_NAMES = [
  'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGPASSFILE',
  'PGSSLMODE', 'PGSSLROOTCERT', 'PGSSLCERT', 'PGSSLKEY', 'PGOPTIONS',
  'PGSERVICE', 'PGSERVICEFILE', 'PGCONNECT_TIMEOUT', 'PGAPPNAME', 'PGCLIENTENCODING',
  'PGTARGETSESSIONATTRS', 'PGREQUIRESSL', 'PGKRBSRVNAME', 'PGGSSLIB', 'PGCHANNELBINDING',
  // Non-test connection configuration must not leak into disposable processes
  // either: a suite that spawns a child without the test gate would otherwise
  // fall through to DB_* and reach a real database.
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL',
  'DB_SSL_REJECT_UNAUTHORIZED', 'DATABASE_URL', 'PGURL', 'POSTGRES_URL'
];

function disposableChildEnv() {
  const env = { ...process.env };
  for (const name of LIBPQ_ENV_NAMES) delete env[name];
  delete env.NODE_TEST_CONTEXT;
  return { ...env, NODE_ENV: 'test', RUN_DB_TESTS: 'true' };
}

const result = spawnSync(process.execPath, ['--test', ...SANCTIONED_POSTGRES_INTEGRATION_SUITES], {
  stdio: 'inherit',
  env: disposableChildEnv()
});
process.exit(result.status ?? 1);
