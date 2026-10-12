#!/usr/bin/env node
'use strict';

/**
 * ATM-001-SEC-CLOSURE-WP3-01 — test-inventory coverage enforcement.
 *
 * WHY THIS EXISTS
 *
 * `npm test` runs `node --test tests/*.test.js`, but a database-mutating suite
 * SKIPS ITSELF when the database-test gate is not satisfied. Such a suite
 * therefore executes NOTHING under `npm test`, and unless it is also registered
 * in `scripts/run-integration-tests.js` it executes nowhere at all — while CI
 * still reports green. That is the silent-omission hole this check closes.
 *
 * WHAT IT PROVES (no hardcoded counts; every relation is derived)
 *
 *   C1  the sanctioned contract in the runner is parseable and non-empty
 *   C2  every suite in the contract exists on disk (no stale registration)
 *   C3  every self-skipping suite is EITHER in the contract OR a documented
 *       superseded-legacy exemption  <-- the anti-omission invariant
 *   C4  the contract is a subset of the guard's database-mutating ledger
 *   C5  every database-mutating suite is either self-skipping, sanctioned, or
 *       a documented superseded-legacy exemption
 *   C6  the contract contains no duplicates
 *   C7  the repository `test` script still runs the whole discovery glob
 *   C8  no test file exists outside the glob the required commands execute
 *   C9  every required security-critical suite exists and is executed
 *
 * A new self-skipping suite that is not registered fails C3 automatically, so
 * the check stays effective as the inventory grows. Nothing here asserts a
 * fixed suite count.
 *
 * Usage:
 *   node scripts/assert-test-coverage.js            # exits 1 on any failure
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNNER_REL = 'scripts/run-integration-tests.js';
const GUARD_REL = 'tests/database-test-guard.test.js';
const PACKAGE_REL = 'package.json';

/** The glob the required `npm test` command executes. */
const REQUIRED_TEST_GLOB = 'tests/*.test.js';

/**
 * A suite is treated as SELF-SKIPPING when it both consults the database-test
 * gate and passes a `skip:` option — i.e. it will execute nothing unless the
 * gate is satisfied. Requiring BOTH constructs keeps the detector precise: a
 * suite that merely mentions the gate in an assertion is not flagged, so this
 * check cannot be satisfied (or tripped) by a comment.
 */
const GATE_CALL = 'isIntegrationTest(';
const SKIP_OPTION = /\bskip\s*:/;

/**
 * Documented, deliberate exemption.
 *
 * These five are superseded legacy ODM-CMMS suites (organization-owned taxonomy
 * via `org_id`, and tables removed by the PostgreSQL cutover). They are retained
 * as legacy evidence pending purpose-built Atiman replacement coverage, and are
 * NOT valid PostgreSQL acceptance suites for current Atiman — see the comment
 * block in `scripts/run-integration-tests.js` and ATM-013D.5D.
 *
 * They self-skip and are deliberately NOT in the integration contract. Naming
 * them here makes the exemption explicit and reviewable; any OTHER unaccounted
 * self-skipping suite is a failure.
 */
const SUPERSEDED_LEGACY_SUITES = Object.freeze([
  'step6-access-control.test.js',
  'step6-coverage-e2e.test.js',
  'step6-performance.test.js',
  'step6-regression.test.js',
  'step6-seed-migration.test.js'
]);

/**
 * Security-critical suites that MUST exist in the repository and MUST be
 * executed by the required commands (i.e. they must not self-skip).
 */
const SECURITY_CRITICAL_REQUIRED = Object.freeze([
  'database-test-guard.test.js',
  'runtime-security.test.js',
  'phase3-cutover-guard.test.js'
]);

/**
 * Security-critical suites that are conditionally present (they arrive with a
 * separate integration candidate). When present they must be accounted for by
 * C3 — a self-skipping invitation suite that is not registered fails.
 */
const SECURITY_CRITICAL_CONDITIONAL = Object.freeze([
  'invitation-role-authority.test.js',
  'invitation-list-authorization.test.js',
  'invitation-resend-authorization.test.js'
]);

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** All suites the required `npm test` glob discovers, as basenames. */
function discoverSuites(root) {
  const dir = path.join(root, 'tests');
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .sort();
}

/** Recursive scan, to detect suites the glob would NOT execute. */
function discoverSuitesDeep(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, r);
      else if (entry.name.endsWith('.test.js')) out.push(r);
    }
  };
  walk(path.join(root, 'tests'), '');
  return out.sort();
}

/**
 * Strip line comments so a commented-out entry can never satisfy (or trip) this
 * check. Line-comment stripping is safe here because the arrays under inspection
 * contain only quoted suite filenames.
 */
const stripLineComments = (text) => text
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

/**
 * Extract suite basenames from a source fragment. Both `'tests/x.test.js'` (the
 * runner contract) and bare `'x.test.js'` (the guard ledger) are accepted and
 * normalised to the basename, because set membership is what matters here.
 */
function extractSuiteBasenames(text) {
  return [...text.matchAll(/'([^'\n]*?([A-Za-z0-9_.-]+\.test\.js))'/g)].map((m) => m[2]);
}

/**
 * Strict, anchored extraction of a declared suite array from a source file.
 * Fails closed: a missing anchor or an empty result is an error, never a pass.
 */
function parseDeclaredArray(source, constName) {
  const anchor = new RegExp(`const\\s+${constName}\\s*=\\s*\\[`);
  const start = source.search(anchor);
  if (start === -1) {
    return { ok: false, reason: `could not locate \`const ${constName} = [\``, entries: [] };
  }
  const rest = source.slice(start);
  const end = rest.indexOf('\n];');
  if (end === -1) {
    return { ok: false, reason: `could not locate the end of the \`${constName}\` array`, entries: [] };
  }
  const body = stripLineComments(rest.slice(0, end));
  const rawEntries = extractSuiteBasenames(body);
  const entries = [...new Set(rawEntries)];
  if (entries.length === 0) {
    return { ok: false, reason: `\`${constName}\` parsed but contained no suite entries`, entries: [], rawEntries: [] };
  }
  return { ok: true, entries, rawEntries };
}

function analyse(options = {}) {
  const root = options.repoRoot || REPO_ROOT;
  const failures = [];
  const fail = (id, message) => failures.push({ id, message });

  const discovered = discoverSuites(root);
  const discoveredDeep = discoverSuitesDeep(root);

  const runnerSource = read(root, RUNNER_REL);
  const guardSource = read(root, GUARD_REL);
  const pkg = JSON.parse(read(root, PACKAGE_REL));

  // ---- C1: parser integrity ------------------------------------------------
  const contract = parseDeclaredArray(runnerSource, 'SANCTIONED_POSTGRES_INTEGRATION_SUITES');
  if (!contract.ok) fail('C1', `${RUNNER_REL}: ${contract.reason}`);

  const ledger = parseDeclaredArray(guardSource, 'DB_MUTATING_SUITES');
  if (!ledger.ok) fail('C1', `${GUARD_REL}: ${ledger.reason}`);

  const sanctioned = contract.entries;
  const declaredMutating = ledger.entries;
  const exempt = [...SUPERSEDED_LEGACY_SUITES];

  // ---- derived: which suites will skip themselves --------------------------
  const selfSkipping = discovered.filter((name) => {
    const src = fs.readFileSync(path.join(root, 'tests', name), 'utf8');
    return src.includes(GATE_CALL) && SKIP_OPTION.test(src);
  });

  // ---- C2: no stale registration ------------------------------------------
  for (const name of sanctioned) {
    if (!discovered.includes(name)) {
      fail('C2', `${RUNNER_REL} registers '${name}' but tests/${name} does not exist`);
    }
  }

  // ---- C3: the anti-omission invariant ------------------------------------
  for (const name of selfSkipping) {
    if (!sanctioned.includes(name) && !exempt.includes(name)) {
      fail('C3',
        `tests/${name} skips itself without the database-test gate and is NOT in the ` +
        `integration contract, so it executes nowhere. Register it in ${RUNNER_REL} ` +
        `or add it to the documented superseded-legacy exemption.`);
    }
  }

  // ---- C4: contract is a subset of the safety ledger ----------------------
  for (const name of sanctioned) {
    if (!declaredMutating.includes(name)) {
      fail('C4', `'${name}' is in the integration contract but not in DB_MUTATING_SUITES`);
    }
  }

  // ---- C5: every declared mutator is classified ---------------------------
  for (const name of declaredMutating) {
    if (!selfSkipping.includes(name) && !sanctioned.includes(name) && !exempt.includes(name)) {
      fail('C5',
        `'${name}' is declared database-mutating but neither self-skips under the gate, ` +
        `nor is contracted, nor is a documented superseded-legacy suite.`);
    }
  }

  // ---- C6: no duplicates in the contract ----------------------------------
  const rawContract = contract.ok ? contract.rawEntries : [];
  const dupes = rawContract.filter((n, i) => rawContract.indexOf(n) !== i);
  if (dupes.length) fail('C6', `${RUNNER_REL} lists duplicate suites: ${[...new Set(dupes)].join(', ')}`);

  // ---- C7: the test script still runs the whole glob ----------------------
  const testScript = (pkg.scripts || {}).test || '';
  if (!testScript.includes(REQUIRED_TEST_GLOB)) {
    fail('C7',
      `package.json "test" is \`${testScript}\` and no longer runs \`${REQUIRED_TEST_GLOB}\`; ` +
      `suites could be silently dropped from every required command.`);
  }

  // ---- C8: no suite outside the executed glob -----------------------------
  const coveredByGlob = new Set(discovered);
  for (const rel of discoveredDeep) {
    const base = rel.split('/').pop();
    if (rel.includes('/') && !coveredByGlob.has(base)) {
      fail('C8', `tests/${rel} is not matched by \`${REQUIRED_TEST_GLOB}\` and would never execute`);
    }
  }

  // ---- C9: required security-critical suites exist and execute ------------
  for (const name of SECURITY_CRITICAL_REQUIRED) {
    if (!discovered.includes(name)) {
      fail('C9', `required security-critical suite tests/${name} is missing`);
      continue;
    }
    if (selfSkipping.includes(name) && !sanctioned.includes(name)) {
      fail('C9', `required security-critical suite tests/${name} self-skips and is not contracted`);
    }
  }

  const conditionalPresent = SECURITY_CRITICAL_CONDITIONAL.filter((n) => discovered.includes(n));
  for (const name of conditionalPresent) {
    if (selfSkipping.includes(name) && !sanctioned.includes(name)) {
      fail('C9', `invitation suite tests/${name} self-skips and is not contracted`);
    }
  }

  // ---- report --------------------------------------------------------------
  const runsUnderNpmTest = discovered.filter(
    (n) => !selfSkipping.includes(n) && !exempt.includes(n) && !sanctioned.includes(n));
  const unaccounted = discovered.filter(
    (n) => !selfSkipping.includes(n) && !sanctioned.includes(n) && !exempt.includes(n)
        && !runsUnderNpmTest.includes(n));

  return {
    repoRoot: root,
    discovered,
    discoveredDeep,
    sanctioned,
    declaredMutating,
    selfSkipping,
    exempt,
    runsUnderNpmTest,
    securityCriticalRequired: SECURITY_CRITICAL_REQUIRED,
    securityCriticalConditionalPresent: conditionalPresent,
    unaccounted,
    testScript,
    failures
  };
}

function report(result) {
  const lines = [];
  lines.push('Test-inventory coverage — scripts/assert-test-coverage.js');
  lines.push(`  repository           : ${result.repoRoot}`);
  lines.push(`  discovered suites    : ${result.discovered.length}  (glob ${REQUIRED_TEST_GLOB})`);
  lines.push(`  integration contract : ${result.sanctioned.length}`);
  lines.push(`  self-skipping        : ${result.selfSkipping.length}`);
  lines.push(`  superseded legacy    : ${result.exempt.length}  (documented exemption)`);
  lines.push(`  run under npm test   : ${result.runsUnderNpmTest.length}`);
  lines.push(`  database-mutating    : ${result.declaredMutating.length}  (guard ledger)`);
  lines.push(`  unaccounted          : ${result.unaccounted.length}`);
  lines.push(`  test script          : ${result.testScript}`);
  lines.push('');
  lines.push('  security-critical required    : '
    + result.securityCriticalRequired.map((n) => (result.discovered.includes(n) ? `${n} OK` : `${n} MISSING`)).join(', '));
  lines.push('  security-critical conditional : '
    + (result.securityCriticalConditionalPresent.length
      ? result.securityCriticalConditionalPresent.join(', ')
      : '(none present in this tree)'));
  lines.push('');

  if (result.failures.length === 0) {
    lines.push(`PASS: ${result.discovered.length} suite(s) discovered and fully accounted for.`);
    return { text: lines.join('\n'), ok: true };
  }
  lines.push(`FAIL: ${result.failures.length} coverage problem(s):`);
  for (const f of result.failures) lines.push(`  [${f.id}] ${f.message}`);
  return { text: lines.join('\n'), ok: false };
}

if (require.main === module) {
  const result = analyse();
  const { text, ok } = report(result);
  console.log(text);
  process.exit(ok ? 0 : 1);
}

module.exports = { analyse, report, SUPERSEDED_LEGACY_SUITES, SECURITY_CRITICAL_REQUIRED, REQUIRED_TEST_GLOB };
