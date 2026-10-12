/**
 * ATM-001 SEC — runtime execution evidence must fail CLOSED when the runner's
 * JUnit counters are absent (WP3-11).
 *
 * The defect: `runnerExecutedCount` returned null when `<!-- pass N -->` or
 * `<!-- fail N -->` was missing, which SKIPPED the WP3-09 (M-2) ceiling. A
 * reporter-emitted container `<testcase>` was then counted as EXECUTED, so a
 * suite that executed nothing passed the very check that exists to catch it.
 *
 * The correction treats a missing counter as a violation rather than as "no
 * ceiling". This suite exercises the two exported pure functions directly with a
 * counter-less document — something the real reporter cannot produce, which is
 * why the existing end-to-end coverage could not reach this case.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { runnerExecutedCount, parseJunit, isExecutionViolation } = require('../scripts/test-execution-evidence.js');

const EVIDENCE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'test-execution-evidence.js'),
  'utf8',
);

const SUITE = 'tests/conditional-suite.test.js';

/** A report whose only <testcase> is a container artefact, with the counters. */
const CONTAINER_WITH_COUNTERS = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
<testsuite name="Conditional Suite" tests="0" failures="0" errors="0" skipped="0" time="0.001">
<testcase name="Conditional Suite" time="0.000850" classname="test"/>
<!-- tests 0 -->
<!-- suites 1 -->
<!-- pass 0 -->
<!-- fail 0 -->
</testsuite>
</testsuites>`;

/** The same document with the pass/fail counter comments removed. */
const CONTAINER_NO_COUNTERS = CONTAINER_WITH_COUNTERS
  .replace(/<!-- pass 0 -->\n/, '')
  .replace(/<!-- fail 0 -->\n/, '');

/** A genuine leaf test that really ran. */
const LEAF_WITH_COUNTERS = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
<testsuite name="Real Suite" tests="1" failures="0" errors="0" skipped="0" time="0.001">
<testcase name="a real test case" time="0.000850" classname="test"/>
<!-- tests 1 -->
<!-- suites 1 -->
<!-- pass 1 -->
<!-- fail 0 -->
</testsuite>
</testsuites>`;

/** File-level artefact only (the runner counts the file as one passing test). */
const FILE_ARTEFACT_NO_COUNTERS = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
<testsuite name="Empty" tests="1" failures="0" errors="0" skipped="0" time="0.001">
<testcase name="conditional-suite.test.js" time="0.000850" classname="test"/>
</testsuite>
</testsuites>`;

const HEADER_ONLY = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
<testsuite name="Killed" tests="0" failures="0" errors="0" skipped="0" time="0.001">
</testsuite>
</testsuites>`;

// Exercise the REAL decision function that gates CI. A local re-implementation
// here would assert this file's own arithmetic and would keep passing even if the
// module regressed — which is precisely how the original defect escaped review.
const violates = (r, exempt = false) => isExecutionViolation({ ...r, exempt });

test('C1 — a present counter is still reconciled as a ceiling', () => {
  assert.strictEqual(runnerExecutedCount(CONTAINER_WITH_COUNTERS), 0);
  const r = parseJunit(CONTAINER_WITH_COUNTERS, SUITE);
  assert.strictEqual(r.countersMissing, false);
  assert.strictEqual(r.executed, 0, 'the container artefact must be clamped to the runner count');
  assert.strictEqual(violates(r), true, 'a container-only suite must fail closed');
});

test('C2 — FAIL-CLOSED (the fix): a missing counter is a violation, not "no ceiling"', () => {
  assert.strictEqual(runnerExecutedCount(CONTAINER_NO_COUNTERS), null, 'no counter => no ceiling');
  const r = parseJunit(CONTAINER_NO_COUNTERS, SUITE);
  assert.strictEqual(r.countersMissing, true, 'the absent counter must be reported');
  assert.strictEqual(violates(r), true, 'a counter-less report must FAIL, not pass');
});

test('C3 — a genuine executed test still passes', () => {
  const r = parseJunit(LEAF_WITH_COUNTERS, SUITE);
  assert.strictEqual(r.countersMissing, false);
  assert.strictEqual(r.executed, 1);
  assert.strictEqual(r.passed, 1);
  assert.strictEqual(violates(r), false, 'real execution must not be flagged');
});

test('C4 — an empty report fails closed', () => {
  const r = parseJunit('', SUITE);
  assert.strictEqual(violates(r), true);
});

test('C5 — a header-only (killed) report fails closed', () => {
  const r = parseJunit(HEADER_ONLY, SUITE);
  assert.strictEqual(r.executed, 0);
  assert.strictEqual(violates(r), true);
});

test('C6 — a file-level artefact without counters fails closed', () => {
  const r = parseJunit(FILE_ARTEFACT_NO_COUNTERS, SUITE);
  assert.strictEqual(r.executed, 0, 'the file artefact is not an executed case');
  assert.strictEqual(violates(r), true);
});

test('C7 — the documented legacy exemption is still exempt', () => {
  const r = parseJunit(CONTAINER_NO_COUNTERS, SUITE);
  assert.strictEqual(violates(r, true), false, 'exempt legacy suites stay exempt');
});

test('C8 — the CLI contract is preserved: requiring the module does not run it', () => {
  // require() succeeded at the top of this file without executing main(), which is
  // what makes these functions testable. Guard: the exports exist and are functions.
  assert.strictEqual(typeof runnerExecutedCount, 'function');
  assert.strictEqual(typeof parseJunit, 'function');
});

// ---------------------------------------------------------------------------
// WIRING PINS (VUDA-2 conditions 1 and 4).
//
// C1-C8 pin the PARSER and the DECISION. An independent reviewer showed that
// reverting only the CALL SITE — leaving `isExecutionViolation` correct but
// bypassing it — keeps every one of those assertions green while restoring the
// fail-open (mutation d2: counter-less report -> exit 0 / ok:true). The gate
// could therefore be fully reverted with the suite still passing. These tests
// pin the route, the exit code and the "ok" flag to the decision.
// ---------------------------------------------------------------------------

test('C9 — WIRING: the row verdict is routed THROUGH isExecutionViolation, unmodified', () => {
  // Anchored to the END of the statement on purpose. An unanchored match is not
  // sufficient: `r.violation = isExecutionViolation(r) && r.countersMissing !== true;`
  // still contains the bare call while re-enabling the countersMissing fail-open
  // (delta-review counterexample — all other assertions stayed green).
  assert.match(
    EVIDENCE_SRC,
    /^\s*r\.violation\s*=\s*isExecutionViolation\(r\);\s*$/m,
    'the row violation must be the unmodified result of isExecutionViolation',
  );
  assert.doesNotMatch(
    EVIDENCE_SRC,
    /r\.violation\s*=\s*r\.executed\s*===\s*0\s*&&\s*!r\.exempt/,
    'the pre-fix inline decision must not reappear (this is the d2 fail-open)',
  );
  // Exactly one assignment to r.violation, and no override/trailing expression.
  const assignments = [...EVIDENCE_SRC.matchAll(/r\.violation\s*[+\-*/%&|^]?=[^;]*/g)]
    .map((m) => m[0].replace(/\s+/g, ' ').trim());
  assert.strictEqual(
    assignments.length,
    1,
    `expected exactly one r.violation assignment, found ${assignments.length}: ${assignments.join(' | ')}`,
  );
  assert.strictEqual(
    assignments[0],
    'r.violation = isExecutionViolation(r)',
    'the assignment must not be compounded or overridden by a trailing expression',
  );
});

test('C10 — WIRING: the exit code and record.ok both derive from the violations set', () => {
  assert.match(EVIDENCE_SRC, /const violations = rows\.filter\(\(r\) => r\.violation\)/,
    'violations must be derived from the computed row verdicts');
  assert.match(EVIDENCE_SRC, /process\.exit\(violations\.length === 0 \? 0 : 1\)/,
    'the process must exit non-zero when any row is in violation');
  assert.match(EVIDENCE_SRC, /ok:\s*violations\.length === 0/,
    'the JSON record must report failure when any row is in violation');
});

test('C11 — WIRING: the human verdict column distinguishes absent counters', () => {
  assert.match(
    EVIDENCE_SRC,
    /countersMissing\s*\?\s*'\*\*\* NO RUNNER COUNTERS \*\*\*'/,
    'a counter-less suite must be visibly distinct from a clean pass',
  );
});
