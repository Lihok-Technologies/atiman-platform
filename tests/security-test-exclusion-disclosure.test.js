'use strict';

/**
 * ATM-001-SEC-107-T3 — database-backed security-test exclusion disclosure.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The default lane (`npm test` -> `node --test tests/*.test.js`) is green while a
 * large part of the repository's security coverage does not execute at all: every
 * database-backed suite is gated on the sanctioned database-test predicate
 * (`NODE_ENV=test`, `RUN_DB_TESTS=true`, `TEST_DB_*`) and therefore executes ZERO
 * tests without it. The exclusion is real and deliberate, but it was INVISIBLE —
 * a green `npm test` read as security coverage that had not been established.
 *
 * T-3 (Alternative 1, "Qualified Green", selected by the owner for this mission)
 * keeps the existing exit-code contract: `npm test` stays green. This file adds the
 * missing DISCLOSURE, and makes the disclosure an ASSERTED property of the lane, so
 * it cannot be emptied, trimmed or reworded into a badge while the lane stays green.
 *
 * WHAT IT DOES
 * ------------
 *   1. reads the DECLARED inventory statically — `DB_MUTATING_SUITES` and
 *      `SANCTIONED_POSTGRES_INTEGRATION_SUITES` in tests/database-test-guard.test.js,
 *      plus the `tests/*.test.js` literals in scripts/run-integration-tests.js;
 *   2. renders a declaration-and-observation record carrying the three required
 *      statements and one line per declared excluded suite;
 *   3. writes that record to the runner's own output channel;
 *   4. asserts the record — every required statement, every declared entry, and the
 *      absence of any security verdict;
 *   5. proves (4) is not vacuous with negative controls in the TA06 anti-vacuity
 *      style, and proves the record is really EMITTED (not merely constructed) by
 *      spawning this file in an emitting-only probe and inspecting what it wrote.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *   * it never `require()`s a suite module and never spawns a suite to observe
 *     `tests 0`: the inventory is read as SOURCE TEXT only, so no pool is created,
 *     no repository `.env` is read and no database module is loaded;
 *   * it opens no connection and handles no credential: the names `TEST_DB_*`,
 *     `DB_*` and `PG*` are only ever DELETED from the environment this file builds
 *     for its own probe;
 *   * it touches no gate: the database-test predicate, the guard's `tests 0`
 *     invariant, the `SANCTIONED` subset of `DB_MUTATING` containment and the
 *     runner's fail-closed validation are unchanged, and are re-derived here only
 *     as an observation for the disclosure's own completeness;
 *   * it adds no lane, no script and no `package.json` entry: the existing
 *     `npm run test:integration` lane is NAMED in the record and nothing else.
 *
 * LIMITS (stated, not hidden)
 * ---------------------------
 *   * this is a SCOPE record (which declared suites do not run here), not a
 *     coverage metric and not a verdict;
 *   * its completeness is exactly the completeness of the two declared lists in
 *     `tests/database-test-guard.test.js`. A database-backed suite in neither list
 *     is outside this record's reach; the guard's own fail-closed checks are the
 *     control for that, not this file;
 *   * the assertions live in the file they assert. Stated limit: removing the
 *     ENTIRE file (rather than emptying, trimming or silencing it) is not
 *     detectable from inside the default lane, and deleting the assertion block
 *     while leaving the record is a review control, not a runtime one. Every
 *     content mutation listed above is caught; file removal is an LCQE matter.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SELF_FILE = path.basename(__filename);
const GUARD_FILE = path.join('tests', 'database-test-guard.test.js');
const RUNNER_FILE = path.join('scripts', 'run-integration-tests.js');
const INTEGRATION_LANE = 'npm run test:integration';
const DEFAULT_LANE = 'npm test  (node --test tests/*.test.js)';
const EMIT_PROBE_ENV = 'ATM001_SEC107_T3_DISCLOSURE_EMIT_ONLY';

// ===========================================================================
// 1. The disclosure itself — one source of truth, stated as REQUIREMENTS.
// ===========================================================================

const STATEMENT_NOT_RUN =
  'DATABASE-BACKED SECURITY TESTS: NOT RUN in this lane.';
const STATEMENT_AUTHORIZATION =
  'DATABASE AUTHORIZATION IS REQUIRED to execute them: they run only through the existing '
  + INTEGRATION_LANE + ' lane, under the sanctioned TEST_DB_* gate.';
const STATEMENT_NOT_COVERAGE =
  'THE DEFAULT PASS DOES NOT ESTABLISH COMPLETE SECURITY COVERAGE.';

const REQUIRED_STATEMENTS = Object.freeze([
  STATEMENT_NOT_RUN,
  STATEMENT_AUTHORIZATION,
  STATEMENT_NOT_COVERAGE
]);

/**
 * The SAME requirements, stated independently of the renderer's constants — the
 * technique `tests/user-profile-projection.test.js` uses for its served-profile
 * contract. A constant emptied at the source therefore fails the assertion instead
 * of moving the expectation with it (an emptied constant would also make a
 * "remove the statement" control vacuously true).
 */
const REQUIRED_STATEMENT_LITERALS = Object.freeze([
  'DATABASE-BACKED SECURITY TESTS: NOT RUN',
  'DATABASE AUTHORIZATION IS REQUIRED',
  'DOES NOT ESTABLISH COMPLETE SECURITY COVERAGE'
]);

// The record may never carry a security verdict or a badge. This is what makes
// "word the record as a PASS" a lane failure instead of a wording preference.
const FORBIDDEN_VERDICT_LINE =
  /\bSECURITY\b[^\n]*\b(?:PASS|PASSED|PASSING|GREEN|VERIFIED|APPROVED|CERTIFIED|CLEARED|COMPLETE|FULL|OK)\b/i;
const FORBIDDEN_VERDICT_PHRASES = Object.freeze([
  /\bALL TESTS PASSED\b/i,
  /\bPRODUCTION READY\b/i
]);

// ===========================================================================
// 2. Static inventory — source text only, never a suite module.
// ===========================================================================

const guardSource = fs.readFileSync(path.join(REPO_ROOT, GUARD_FILE), 'utf8');
const runnerSource = fs.readFileSync(path.join(REPO_ROOT, RUNNER_FILE), 'utf8');

/**
 * Parse a declared suite list (`const NAME = [ ... ];`, optionally wrapped in
 * `Object.freeze`). Entry lines carry prose comments that themselves contain
 * apostrophes, so comments are stripped per line BEFORE the string entries are
 * read — the same reason `tests/integration-runner-isolation.test.js` prefers
 * deduplicated literals over a naive bracket parse. Fails closed at module load.
 */
const readDeclaredSuiteList = (source, sourceLabel, constName) => {
  const anchor = new RegExp(`const\\s+${constName}\\s*=\\s*(?:Object\\.freeze\\(\\s*)?\\[`);
  const found = anchor.exec(source);
  assert.ok(found, `${sourceLabel} must declare ${constName} as an array literal`);

  const open = source.indexOf('[', found.index);
  const close = source.indexOf('];', open);
  assert.ok(close > open, `${sourceLabel} ${constName} array literal must be terminated`);

  const body = source.slice(open + 1, close)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  const entries = [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(entries.length > 0, `${sourceLabel} ${constName} must not be empty`);

  for (const entry of entries) {
    assert.match(entry, /^[A-Za-z0-9_.-]+\.test\.js$/,
      `${sourceLabel} ${constName} must list bare suite filenames, got: ${entry}`);
  }
  return Object.freeze([...new Set(entries)]);
};

/** Every suite declared database-mutating — the set this lane does NOT run. */
const EXCLUDED_SUITES = readDeclaredSuiteList(guardSource, GUARD_FILE, 'DB_MUTATING_SUITES');

/** The sanctioned PostgreSQL acceptance contract, as declared in the guard. */
const GUARD_SANCTIONED = readDeclaredSuiteList(
  guardSource, GUARD_FILE, 'SANCTIONED_POSTGRES_INTEGRATION_SUITES'
);

/**
 * The runner cannot be required for inspection (it validates and exits at module
 * load), so its contract is read the way the guard already reads it: deduplicated
 * `tests/*.test.js` literals.
 */
const RUNNER_SANCTIONED = Object.freeze([...new Set(
  [...runnerSource.matchAll(/'tests\/([A-Za-z0-9_.-]+\.test\.js)'/g)].map((match) => match[1])
)]);
assert.ok(RUNNER_SANCTIONED.length > 0,
  `${RUNNER_FILE} must declare its sanctioned integration suites as tests/*.test.js literals`);

const sortedCopy = (list) => [...list].sort();

// ===========================================================================
// 3. The record — rendered, then written to the runner's output channel.
// ===========================================================================

/** One assertion-stable disclosure line per declared excluded suite. */
const recordEntry = (suiteFile) => {
  const tags = RUNNER_SANCTIONED.includes(suiteFile)
    ? 'database-mutating, sanctioned-integration'
    : 'database-mutating';
  return `EXCLUDED tests/${suiteFile} [${tags}]`;
};

const EXCLUDED_INVENTORY_HEADER =
  `EXCLUDED INVENTORY - ${EXCLUDED_SUITES.length} declared database-backed suites not run in this lane:`;

const renderRecord = () => {
  const rule = '='.repeat(76);
  const lines = [
    rule,
    'DATABASE-BACKED SECURITY-TEST EXCLUSION - DECLARATION AND OBSERVATION RECORD',
    `ATM-001-SEC-107-T3 | lane: ${DEFAULT_LANE}`,
    rule,
    '',
    STATEMENT_NOT_RUN,
    STATEMENT_AUTHORIZATION,
    STATEMENT_NOT_COVERAGE,
    '',
    'This is a scope record and an observation. It is not a security verdict.',
    '',
    'Declared inventory read statically (no suite module was required, no pool was opened):',
    `  ${GUARD_FILE} :: DB_MUTATING_SUITES ................... ${EXCLUDED_SUITES.length}`,
    `  ${GUARD_FILE} :: SANCTIONED_POSTGRES_INTEGRATION_SUITES .. ${GUARD_SANCTIONED.length}`,
    `  ${RUNNER_FILE} :: sanctioned tests/*.test.js literals ... ${RUNNER_SANCTIONED.length}`,
    '',
    EXCLUDED_INVENTORY_HEADER
  ];

  EXCLUDED_SUITES.forEach((suiteFile, index) => {
    lines.push(`  ${String(index + 1).padStart(3, ' ')}. ${recordEntry(suiteFile)}`);
  });

  lines.push(
    '',
    `The database-backed security lane already exists and is unchanged: ${INTEGRATION_LANE}`,
    'This record introduces no lane, no script and no gate, and it changes no exit-code policy.',
    rule
  );
  return lines.join('\n');
};

const RECORD = renderRecord();

// The disclosure is written to the runner's own channel at module load, so it is
// visible in a plain `npm test` run and is not conditional on a test outcome.
process.stdout.write(`${RECORD}\n`);

/**
 * The verifier. Returns every violation found in a candidate record text; an
 * empty array means the text satisfies all three requirements. Used both on the
 * real record (positive control) and on mutated copies (negative controls), so
 * "the disclosure is asserted" is itself demonstrated rather than asserted.
 */
const verifyRecord = (text) => {
  const violations = [];

  for (const literal of REQUIRED_STATEMENT_LITERALS) {
    if (!text.includes(literal)) violations.push(`missing required statement: ${literal}`);
  }

  for (const statement of REQUIRED_STATEMENTS) {
    if (!statement.trim()) violations.push('a required statement constant is empty');
    else if (!text.includes(statement)) violations.push(`missing required statement text: ${statement}`);
  }

  for (const suiteFile of EXCLUDED_SUITES) {
    const entry = recordEntry(suiteFile);
    if (!text.includes(entry)) violations.push(`missing disclosed inventory entry: ${entry}`);
  }

  if (!text.includes(EXCLUDED_INVENTORY_HEADER)) {
    violations.push(`missing or wrong excluded-inventory count line: ${EXCLUDED_INVENTORY_HEADER}`);
  }

  for (const line of text.split('\n')) {
    if (FORBIDDEN_VERDICT_LINE.test(line)) violations.push(`security verdict claim: ${line.trim()}`);
    for (const phrase of FORBIDDEN_VERDICT_PHRASES) {
      if (phrase.test(line)) violations.push(`security verdict claim: ${line.trim()}`);
    }
  }

  return violations;
};

/**
 * Spawn this file in emitting-only mode and return what it wrote. The probe runs
 * the SAME module-load emission the default lane runs; the only difference is that
 * it registers no tests, so nothing is asserted twice and no recursion occurs.
 */
const DATABASE_ENV_NAMES = Object.freeze([
  'NODE_TEST_CONTEXT',
  'NODE_ENV', 'RUN_DB_TESTS',
  'TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD',
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL',
  'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE'
]);

const runEmitProbe = () => {
  const childEnv = { ...process.env, [EMIT_PROBE_ENV]: '1' };
  for (const name of DATABASE_ENV_NAMES) delete childEnv[name];

  const result = spawnSync(process.execPath, [path.join('tests', SELF_FILE)], {
    cwd: REPO_ROOT, env: childEnv, encoding: 'utf8'
  });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
};

// ===========================================================================
// 4. Assertions. Only the emitting probe skips them, and only to avoid recursion.
// ===========================================================================

if (process.env[EMIT_PROBE_ENV] !== '1') {
  describe('ATM-001-SEC-107-T3 database-backed security-test exclusion disclosure', () => {
    it('T1 - the published record satisfies every disclosure requirement', () => {
      assert.deepStrictEqual(
        verifyRecord(RECORD),
        [],
        'the disclosure must carry the three statements, every declared excluded suite, and no verdict'
      );

      // Stated independently of the renderer, so editing the renderer cannot move
      // the expectation with it.
      for (const literal of REQUIRED_STATEMENT_LITERALS) {
        assert.ok(RECORD.includes(literal),
          `the published record must carry the statement literal: ${literal}`);
      }
      assert.ok(RECORD.includes(EXCLUDED_INVENTORY_HEADER));
      assert.ok(RECORD.includes(INTEGRATION_LANE));
      assert.ok(EXCLUDED_SUITES.length > 10, 'expected a populated declared inventory');
    });

    it('T2 - negative controls: emptying or trimming the disclosure fails the lane', () => {
      // Positive control first: the detector is not vacuously failing.
      assert.deepStrictEqual(verifyRecord(RECORD), [], 'the real record must be clean');

      // (a) drop ONE disclosed inventory entry.
      const firstEntry = recordEntry(EXCLUDED_SUITES[0]);
      assert.ok(RECORD.includes(firstEntry), 'the first declared suite must be disclosed');
      assert.ok(
        verifyRecord(RECORD.replace(firstEntry, '')).length > 0,
        'removing a disclosed suite from the record must fail the lane'
      );

      // (b) drop the NOT-RUN disclaimer, and each of the other two statements. The
      //     published record is checked FIRST, so the control stays non-vacuous even
      //     if the statement constant itself is emptied at the source.
      for (const literal of REQUIRED_STATEMENT_LITERALS) {
        assert.ok(RECORD.includes(literal), `the published record must carry "${literal}"`);
        assert.ok(
          verifyRecord(RECORD.replace(literal, '')).length > 0,
          `removing the statement "${literal}" must fail the lane`
        );
      }

      // (c) claim a security verdict.
      const passClaim = `${RECORD}\nSECURITY PASS: every database-backed suite was verified.\n`;
      assert.ok(
        verifyRecord(passClaim).length > 0,
        'a security PASS claim must fail the lane'
      );

      // (d) drop the count line, so an inventory that is present but undersized
      //     still fails.
      assert.ok(
        verifyRecord(RECORD.replace(EXCLUDED_INVENTORY_HEADER, 'EXCLUDED INVENTORY:')).length > 0,
        'mislabelling the excluded-inventory count must fail the lane'
      );
    });

    it('T3 - the record is actually EMITTED on the runner channel, not merely built', () => {
      const probe = runEmitProbe();
      assert.strictEqual(probe.status, 0, `the emitting probe must exit 0:\n${probe.output}`);
      assert.deepStrictEqual(
        verifyRecord(probe.output),
        [],
        `what the runner channel actually carries must satisfy every requirement:\n${probe.output}`
      );
      for (const literal of REQUIRED_STATEMENT_LITERALS) {
        assert.ok(probe.output.includes(literal),
          `the emitted record lost the statement: ${literal}`);
      }
      assert.ok(probe.output.includes(recordEntry(EXCLUDED_SUITES[0])),
        'the emitted record lost its first inventory entry');
    });

    it('T4 - the disclosure observes the preserved invariants and redefines none of them', () => {
      // OBSERVATION ONLY. These are the guard's contracts, re-read statically so the
      // record's completeness claim ("database-backed security tests NOT RUN") is
      // shown to cover the whole sanctioned security lane. Nothing here is a new
      // gate and nothing here modifies an existing one.
      assert.deepStrictEqual(
        sortedCopy(RUNNER_SANCTIONED),
        sortedCopy(GUARD_SANCTIONED),
        'the runner and the guard must declare the same sanctioned PostgreSQL set'
      );

      const unsanctionedMutators = GUARD_SANCTIONED
        .filter((suiteFile) => !EXCLUDED_SUITES.includes(suiteFile));
      assert.deepStrictEqual(
        unsanctionedMutators,
        [],
        'every sanctioned integration suite must be declared database-mutating, so the exclusion '
          + 'disclosure covers the security lane'
      );
    });
  });
}
