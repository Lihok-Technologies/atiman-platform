/**
 * ATM-001 F-3 — sanctioned integration runner: shared-database DDL isolation.
 *
 * The sanctioned runner used to execute all contracted suites in ONE
 * `node --test` invocation against ONE shared disposable database. Two of those
 * suites take incompatible lock orders on the same relations:
 *
 *   - `tests/knowledge-pack-publication-admission.test.js` re-applies migration
 *     015 in a single transaction on the shared database: ACCESS EXCLUSIVE on
 *     `knowledge_pack_versions`, then ACCESS EXCLUSIVE on
 *     `knowledge_pack_version_task_template_versions` (at its DROP TRIGGER).
 *   - `tests/knowledge-pack-membership.test.js` inserts into
 *     `knowledge_pack_version_task_template_versions` (ROW EXCLUSIVE) and the
 *     BEFORE INSERT membership guard then requests ROW SHARE on
 *     `knowledge_pack_versions` (015:203-206).
 *
 * Scheduled concurrently, PostgreSQL detects the cycle and aborts one side with
 * SQLSTATE 40P01 — an intermittent 914/915 failure.
 *
 * The correction isolates the DDL-taking suite into its own sequential
 * invocation. This suite is the focused test for that correction: it asserts the
 * isolation is declared, that it does NOT repartition the declared contract
 * list, and that the runner still fails closed.
 *
 * This suite does not gate on the database-test gate: it reads source only and
 * therefore runs under `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const RUNNER_PATH = path.join(REPO_ROOT, 'scripts', 'run-integration-tests.js');
const source = fs.readFileSync(RUNNER_PATH, 'utf8');

/**
 * Parse a single-quoted string-array literal declared as:
 *   const NAME = [ ... ];
 *   const NAME = Object.freeze([ ... ]);
 * Bracket-matches from the opening `[` so a wrapped literal, a nested `]` in a
 * string, or a later array cannot bleed into the result. Line comments are
 * skipped so an apostrophe in prose cannot open a phantom string.
 */
function parseDeclaredArray(src, name) {
  const anchor = new RegExp(`const\\s+${name}\\s*=\\s*(?:Object\\.freeze\\(\\s*)?\\[`);
  const match = anchor.exec(src);
  if (!match) return null;
  const start = src.indexOf('[', match.index);
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === "'") { inString = true; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  return [...src.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const sanctioned = parseDeclaredArray(source, 'SANCTIONED_POSTGRES_INTEGRATION_SUITES');
const isolated = parseDeclaredArray(source, 'SHARED_DATABASE_DDL_SUITES');

const DDL_SUITE = 'tests/knowledge-pack-publication-admission.test.js';
const ROW_LOCK_SUITE = 'tests/knowledge-pack-membership.test.js';

test('C1 — both the sanctioned contract list and the isolation list are declared', () => {
  assert.ok(Array.isArray(sanctioned), 'SANCTIONED_POSTGRES_INTEGRATION_SUITES must parse as an array');
  assert.ok(sanctioned.length > 2, `expected a populated sanctioned list, got ${sanctioned?.length}`);
  assert.ok(Array.isArray(isolated), 'SHARED_DATABASE_DDL_SUITES must be declared');
  assert.ok(isolated.length > 0, 'the DDL isolation list must not be empty');
});

test('C2 — the isolation list does NOT repartition the declared contract list', () => {
  // Both suites must still be members of the single declared contract array.
  assert.ok(sanctioned.includes(DDL_SUITE), `${DDL_SUITE} must remain in the sanctioned contract`);
  assert.ok(sanctioned.includes(ROW_LOCK_SUITE), `${ROW_LOCK_SUITE} must remain in the sanctioned contract`);

  // Every isolated suite must be a member — never a separate, unlisted registry.
  const unlisted = isolated.filter((suite) => !sanctioned.includes(suite));
  assert.deepStrictEqual(
    unlisted,
    [],
    `isolation entries must be a subset of the sanctioned contract; unlisted: ${unlisted.join(', ')}`
  );
});

test('C3 — the lock-inverting suite is the one that is isolated', () => {
  assert.ok(
    isolated.includes(DDL_SUITE),
    `the shared-database DDL suite must be isolated: ${DDL_SUITE}`
  );
  assert.ok(
    !isolated.includes(ROW_LOCK_SUITE),
    `${ROW_LOCK_SUITE} is the row-lock side and must not be treated as a DDL suite`
  );
});

test('C4 — the whole sanctioned list is no longer executed in a single invocation', () => {
  // The defect shape: one spawnSync over the entire declared array.
  assert.doesNotMatch(
    source,
    /\['--test',\s*\.\.\.SANCTIONED_POSTGRES_INTEGRATION_SUITES\]/,
    'the runner must not pass the entire sanctioned list to one node --test invocation'
  );
  // The corrected shape: groups are executed one at a time.
  assert.match(
    source,
    /\['--test',\s*\.\.\.group\]/,
    'the runner must execute each partition group in its own invocation'
  );
  assert.match(
    source,
    /for\s*\(\s*const\s+group\s+of\s+EXECUTION_GROUPS\s*\)/,
    'the groups must be executed sequentially (spawnSync is synchronous)'
  );
});

test('C5 — the runner still fails closed on any non-zero group', () => {
  assert.match(
    source,
    /if\s*\(\s*result\.status\s*!==\s*0\s*\)\s*status\s*=\s*result\.status\s*\?\?\s*1/,
    'a failing group must be recorded'
  );
  assert.match(source, /process\.exit\(status\)/, 'the aggregate status must determine the exit code');
  // A non-zero exit is only meaningful if it is not swallowed by a plain exit(0).
  assert.doesNotMatch(source, /process\.exit\(0\)\s*;?\s*$/);
});

test('C6 — an out-of-contract isolation entry refuses to run', () => {
  assert.match(
    source,
    /unlistedIsolationSuites\.length/,
    'the runner must fail closed when an isolation entry is not in the sanctioned contract'
  );
  assert.match(
    source,
    /Refusing to run: shared-database DDL suite/,
    'the refusal must be explicit'
  );
});

test('C7 — the database-test gate and libpq env scrubbing are preserved', () => {
  assert.match(source, /RUN_DB_TESTS:\s*'true'/, 'the child gate must still be forced');
  assert.match(source, /NODE_ENV:\s*'test'/, 'NODE_ENV=test must still be forced');
  assert.match(source, /LIBPQ_ENV_NAMES/, 'libpq env scrubbing must be preserved');
  assert.doesNotMatch(
    source,
    /TEST_DB_PASSWORD\s*=\s*'/,
    'no disposable credential literal may be introduced into the runner'
  );
});
