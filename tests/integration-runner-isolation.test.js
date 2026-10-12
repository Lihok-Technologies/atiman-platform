/**
 * ATM-001 F-3 — sanctioned integration runner: shared-database migration-DDL isolation.
 *
 * The runner used to execute all contracted suites in ONE `node --test` invocation
 * against ONE shared disposable database. Suites that re-apply a migration artifact
 * on that database take ACCESS EXCLUSIVE locks, while other suites take row locks on
 * the same relations. Scheduled concurrently, PostgreSQL can resolve the cycle with
 * SQLSTATE 40P01 (observed intermittently as 914/915).
 *
 * The correction isolates the whole DDL CLASS into its own sequential invocation.
 * This suite is the focused test for that correction. It asserts the partition
 * BEHAVIOURALLY (through the same pure module the runner uses) and asserts that the
 * isolation list is COMPLETE with respect to the declared DDL idiom — so a suite that
 * starts applying migration DDL on the shared database without being isolated fails
 * here rather than silently reintroducing the hazard.
 *
 * Source-only: no database gate, so it runs under `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { partitionSuites, executesSharedDatabaseMigrationDdl } = require('../scripts/integration-suite-partition');

const REPO_ROOT = path.join(__dirname, '..');
const RUNNER_PATH = path.join(REPO_ROOT, 'scripts', 'run-integration-tests.js');
const source = fs.readFileSync(RUNNER_PATH, 'utf8');

/**
 * The declared contract list, extracted from the region BEFORE the isolation
 * declaration. Scoping to that region matters: scanning the whole file would also
 * pick up the isolation list's own literals, which makes the "every isolated suite
 * is contracted" assertion vacuously true for a suite added only to the isolation
 * list (independent reviewer round-2 finding F1).
 *
 * Deduplicated `tests/*.test.js` literals — the same technique
 * `tests/database-test-guard.test.js` uses. Robust against apostrophes in prose
 * comments, which defeat a naive bracket parse.
 */
const isolationDeclaration = source.indexOf('const SHARED_DATABASE_DDL_SUITES');
assert.ok(isolationDeclaration > 0, 'the isolation list must be declared after the contract list');
const contractLiterals = [
  ...new Set(
    [...source.slice(0, isolationDeclaration).matchAll(/'(tests\/[^']+\.test\.js)'/g)].map((m) => m[1])
  )
];

/** Parse `const NAME = Object.freeze([ ... ]);` */
function parseFrozenArray(src, name) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`).exec(src);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const isolated = parseFrozenArray(source, 'SHARED_DATABASE_DDL_SUITES');

test('C1 — the runner declares a non-empty shared-database DDL isolation list', () => {
  assert.ok(Array.isArray(isolated), 'SHARED_DATABASE_DDL_SUITES must be declared via Object.freeze([...])');
  assert.ok(isolated.length > 0, 'the isolation list must not be empty');
  assert.ok(contractLiterals.length > 1, `expected the sanctioned ledger, got ${contractLiterals.length}`);
});

test('C2 — every isolated suite is a member of the declared contract list (no repartitioning)', () => {
  const unlisted = isolated.filter((suite) => !contractLiterals.includes(suite));
  assert.deepStrictEqual(
    unlisted,
    [],
    `isolation entries must be members of the sanctioned contract; unlisted: ${unlisted.join(', ')}`
  );
});

test('C3 — COMPLETENESS: every suite that applies migration DDL on the shared database is isolated', () => {
  // This is the assertion that catches an unidentified second inversion: a contracted
  // suite matching the DDL idiom but left in the parallel group fails here.
  //
  // STATED LIMIT: completeness is only as strong as the detector idiom
  // (`executesSharedDatabaseMigrationDdl`). A suite that applies shared-database
  // migration DDL through a shape that idiom does not recognise would not be flagged
  // here, by the runner's own guard, or by anything else. No current contracted suite
  // does so; any new contracted suite must be reviewed for this by hand.
  const undeclared = contractLiterals.filter((suite) => {
    if (isolated.includes(suite)) return false;
    const file = path.join(REPO_ROOT, suite);
    if (!fs.existsSync(file)) return false;
    return executesSharedDatabaseMigrationDdl(fs.readFileSync(file, 'utf8'));
  });
  assert.deepStrictEqual(
    undeclared,
    [],
    'these contracted suites apply migration DDL on the shared database but are not isolated '
      + `(they would run concurrently with row-locking suites): ${undeclared.join(', ')}`
  );
});

test('C4 — the partition accounts for every suite exactly once and the groups are disjoint', () => {
  const { ddlSuites, parallelSuites } = partitionSuites(contractLiterals, isolated);
  assert.deepStrictEqual(
    ddlSuites.filter((s) => !contractLiterals.includes(s)),
    [],
    'the DDL group must contain only contracted suites'
  );
  assert.strictEqual(
    ddlSuites.length + parallelSuites.length,
    contractLiterals.length,
    'the groups must account for every contracted suite exactly once'
  );
  assert.strictEqual(ddlSuites.length, isolated.length, 'every isolated suite must land in the DDL group');
  assert.deepStrictEqual(
    parallelSuites.filter((s) => isolated.includes(s)),
    [],
    'no isolated suite may remain in the parallel group'
  );
  assert.strictEqual(
    new Set([...ddlSuites, ...parallelSuites]).size,
    contractLiterals.length,
    'no suite may appear in both groups'
  );
});

test('C5 — a contracted suite cannot be silently dropped by the partition', () => {
  const { ddlSuites, parallelSuites } = partitionSuites(contractLiterals, isolated);
  const union = [...ddlSuites, ...parallelSuites].sort();
  assert.deepStrictEqual(union, [...contractLiterals].sort(), 'the union must equal the contracted list');
});

test('C6 — the runner actually USES the partition (isolation cannot be declared and ignored)', () => {
  // Guards against the mutation "declare the list, then execute everything in one
  // group": the DDL decision must flow from partitionSuites into the executed groups.
  assert.match(
    source,
    /partitionSuites\(\s*SANCTIONED_POSTGRES_INTEGRATION_SUITES\s*,\s*SHARED_DATABASE_DDL_SUITES\s*\)/,
    'the runner must partition the declared contract list by the declared isolation list'
  );
  assert.match(
    source,
    /executionGroups\s*=\s*\[\s*ddlSuites\s*,\s*parallelSuites\s*\]/,
    'the executed groups must be the partition result (DDL group, then the remainder)'
  );
  assert.doesNotMatch(
    source,
    /\['--test',\s*\.\.\.SANCTIONED_POSTGRES_INTEGRATION_SUITES\]/,
    'the runner must never pass the whole contract list to a single invocation'
  );
  assert.match(
    source,
    /for\s*\(\s*const\s+group\s+of\s+executionGroups\s*\)/,
    'the groups must be executed sequentially (spawnSync is synchronous)'
  );
});

test('C7 — the runner still fails closed', () => {
  assert.match(
    source,
    /if\s*\(\s*result\.status\s*!==\s*0\s*\)\s*status\s*=\s*result\.status\s*\?\?\s*1/,
    'a failing group must be recorded'
  );
  assert.match(source, /process\.exit\(status\)/, 'the aggregate status must determine the exit code');
  assert.match(
    source,
    /undeclaredDdlSuites/,
    'an undeclared DDL suite must be detected'
  );
  assert.match(
    source,
    /process\.exit\(1\)/,
    'an invalid partition must refuse to run'
  );
});

test('C8 — the partition function itself fails closed on an invalid list', () => {
  assert.throws(() => partitionSuites(['a', 'b'], ['c']), /not part of the sanctioned contract/);
  assert.throws(() => partitionSuites(['a', 'b'], []), /must not be empty/);
  assert.throws(() => partitionSuites(['a', 'b'], ['a', 'a']), /duplicate isolation entries/);
  assert.throws(() => partitionSuites('nope', ['a']), /must both be arrays/);
  // A valid partition is complete and disjoint.
  const ok = partitionSuites(['a', 'b', 'c'], ['b']);
  assert.deepStrictEqual(ok, { ddlSuites: ['b'], parallelSuites: ['a', 'c'] });
});

test('C9 — the database-test gate and libpq env scrubbing are preserved', () => {
  assert.match(source, /RUN_DB_TESTS:\s*'true'/, 'the child gate must still be forced');
  assert.match(source, /NODE_ENV:\s*'test'/, 'NODE_ENV=test must still be forced');
  assert.match(source, /LIBPQ_ENV_NAMES/, 'libpq env scrubbing must be preserved');
  assert.doesNotMatch(
    source,
    /TEST_DB_PASSWORD\s*=\s*'/,
    'no disposable credential literal may be introduced into the runner'
  );
});
