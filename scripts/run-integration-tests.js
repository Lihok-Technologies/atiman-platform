/** Run destructive MySQL integration tests only against an explicitly named test database. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { partitionSuites, executesSharedDatabaseMigrationDdl } = require('./integration-suite-partition');

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
  'tests/observation-foundation.test.js',
  // ATM-002-I2C: trustworthy asset context — the single tenant-safe resolver and
  // the closure of the three legacy cross-tenant asset lookup defects.
  'tests/asset-context.test.js',
  // ATM-002-I2E: report / observation capture — the first real Atiman field
  // workflow, end to end, with a truthful confirmation.
  'tests/report-capture.test.js',
  // ATM-001-K3: knowledge accession authority — the four provenance mutation
  // routes require knowledge.author instead of the legacy TASKS.CREATE/UPDATE
  // matrix, so a grantable accession authority exists for the SME.
  'tests/knowledge-accession-authority.test.js',
  // ATM-001-K3-R1: provenance write scope — a tenant may read and cite global
  // shared reference provenance but may not author into it (MAJOR-1).
  'tests/provenance-write-scope.test.js',
  // ATM-001-SEC-00E: POST /api/invitations — supervisor and plain-administrator
  // administrator-invitation refusal, forged-flag and forged-tenant inertness,
  // preservation of the authorized invitation and acceptance flows, and the
  // D-2 seat-mask negative control.
  'tests/invitation-role-authority.test.js',
  // ATM-001-SEC-00G: GET /api/invitations — org.user_admin authorization,
  // token-free listing responses, tenant isolation, and the negative control
  // that the baseline disclosed raw enrollment tokens to operators.
  'tests/invitation-list-authorization.test.js',
  // ATM-001-KF-06: knowledge evidence deletion integrity — a definition deletion
  // may not destroy working provenance evidence as a cascade side effect, so
  // authorization covers the operation's effect and not merely its route.
  'tests/knowledge-evidence-deletion-integrity.test.js',
  // ATM-001-SEC-104 / ATM-001-SEC-104-R2: the five OWNER-approved V1 organization
  // security policies — administrative organization creation restricted to
  // platform.admin (the approved self-service POST /api/auth/organization-signup
  // is preserved), org.config_admin + strict tenant scope for profile updates,
  // subscription/capacity fields unreachable by a tenant administrator (extended
  // to the whole /api/subscriptions capability), tenant isolation for
  // reading/listing/statistics/logo including a body-addressed foreign tenant, and
  // fail-closed denial of direct organization deletion.
  'tests/organization-security-policies.test.js',
  // ATM-001-SEC-104-R3: live disposable-PostgreSQL evidence for the approved
  // self-service POST /api/auth/organization-signup — HTTP result, committed
  // organization / administrator / subscription row counts, transaction
  // behaviour, orphan-record behaviour and the security boundary. Pins defect
  // D-1 (the endpoint commits an orphan organization and answers HTTP 500); the
  // intended contract is carried as a `todo` test, never as a silent repair.
  'tests/organization-signup.integration.test.js',
  // ATM-001-SEC-LEGACY-01-R3: the reconciled single-user authorization lane —
  // GET / PUT / DELETE /api/users/:id tenant, ownership and facility scope, the
  // approved USERS.ASSIGN_FACILITY policy, and the reactivation/seat branch. The
  // three prior remediations (R1/PR #85, R2, 00B/PR #87) are one contract here.
  'tests/user-authorization-reconciliation.test.js',
  // ATM-001-SEC-00H: POST /api/invitations/:id/resend — org.user_admin
  // authorization, terminal-invitation refusal, stored-role integrity, and the
  // negative control that the baseline reissued dead administrator invitations.
  'tests/invitation-resend-authorization.test.js',
  // MISSION 3 / ATM-001-SEC-93: invitation security residuals A-D — cancellation
  // authority, acceptance single use (role/tenant taken solely from the persisted
  // row), credential redaction on every read path and in the administration view,
  // and the D-1/D-2 sequencing dependencies (asserted, not repaired).
  'tests/invitation-lifecycle-residuals.test.js',
  'tests/knowledge-evidence-deletion-integrity.test.js',
  // MISSION D-1: onboarding atomicity — organization signup and invitation
  // acceptance commit their whole write set or none of it, an unobservable INSERT
  // fails loudly, and a returned `SELECT *` row never discloses a credential.
  'tests/onboarding-atomicity.test.js',
  // ATM-001-SEC-106 blocker B-1: capability-grant authority. Resolves real
  // grants for the tenant-administrator principal shape, drives the real
  // org.user_admin-gated invitation routes and the org.config_admin
  // organization routes, and pins the OWNER policy that
  // `is_organization_admin` plus an UNRELATED explicit grant confers nothing.
  // Fixture residue is bounded to one stable, idempotent set (migration 022
  // makes a grant undeletable); see the suite header.
  'tests/atm-001-sec-106-b1-grant-authority.test.js'
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

/**
 * ATM-001 F-3 — shared-database migration-DDL isolation.
 *
 * Some contracted suites re-apply a migration artifact on the SHARED disposable
 * database, taking ACCESS EXCLUSIVE locks. Other suites take row locks on the
 * same relations. Executed concurrently against one database, PostgreSQL can
 * detect a lock cycle and abort one side with SQLSTATE 40P01. Two inversions of
 * this class have been identified (migrations 015 and 019).
 *
 * The whole CLASS is therefore run in its own sequential invocation rather than
 * a single instance: `spawnSync` is synchronous, so the groups cannot overlap.
 *
 * The declared contract list is NOT repartitioned. `scripts/assert-test-coverage.js`
 * parses SANCTIONED_POSTGRES_INTEGRATION_SUITES, and
 * `tests/database-test-guard.test.js` requires every `tests/*.test.js` literal in
 * this file to resolve to the same sanctioned set. Only execution topology changes.
 */
const SHARED_DATABASE_DDL_SUITES = Object.freeze([
  'tests/knowledge-versioning.test.js',
  'tests/knowledge-pack-publication-admission.test.js',
  'tests/taxonomy-identity-lifecycle.test.js',
  'tests/capability-grants.test.js'
]);

// Fail closed if a contracted suite starts applying migration DDL on the shared
// database without being listed for isolation above.
const undeclaredDdlSuites = SANCTIONED_POSTGRES_INTEGRATION_SUITES.filter((suite) => {
  if (SHARED_DATABASE_DDL_SUITES.includes(suite)) return false;
  let source;
  try {
    source = fs.readFileSync(path.join(__dirname, '..', suite), 'utf8');
  } catch {
    return false;
  }
  return executesSharedDatabaseMigrationDdl(source);
});

let status = 0;
let executionGroups;
try {
  if (undeclaredDdlSuites.length) {
    throw new Error(
      'contracted suite(s) apply migration DDL on the shared database without isolation: '
        + undeclaredDdlSuites.join(', ')
    );
  }
  const { ddlSuites, parallelSuites } = partitionSuites(
    SANCTIONED_POSTGRES_INTEGRATION_SUITES,
    SHARED_DATABASE_DDL_SUITES
  );
  // Sequential groups: the DDL class alone, then the remainder in parallel.
  executionGroups = [ddlSuites, parallelSuites];
} catch (error) {
  console.error(`Refusing to run: ${error.message}`);
  process.exit(1);
}

for (const group of executionGroups) {
  if (group.length === 0) continue;
  const result = spawnSync(process.execPath, ['--test', ...group], {
    stdio: 'inherit',
    env: disposableChildEnv()
  });
  if (result.status !== 0) status = result.status ?? 1;
}
process.exit(status);
