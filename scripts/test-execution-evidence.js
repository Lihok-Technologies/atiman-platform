#!/usr/bin/env node
'use strict';

/**
 * ATM-001-SEC-CLOSURE-WP3-05 — runtime execution evidence.
 *
 * WHY THIS EXISTS
 *
 * `assert-test-coverage.js` classifies suites by reading their source. That is
 * inventory evidence, not execution evidence. WP3-04 demonstrated three cases
 * where a suite was ACCEPTED while executing zero tests, because the static
 * classification could not see runtime behaviour:
 *
 *   F-1  an unrelated `isIntegrationTest()` call plus `{ skip: true }`
 *   F-2  `describe['skip'](...)` (computed property)
 *   F-3  the only test definition inside unreachable code, e.g. `if (false) {}`
 *
 * This script supplies the missing evidence. Every suite in the selected class
 * is EXECUTED, one process per suite, and its results are read from the Node
 * test runner's JUnit output. A suite counts as EXECUTED only when at least one
 * real test case actually ran.
 *
 * WHY JUNIT, AND WHY THE RUNNER'S OWN COUNTERS ARE ALSO READ
 *
 * Measured on Node 22.23.2, an isolated suite that defines NO tests reports:
 *
 *     # tests 1   # pass 1        <-- the FILE is counted as one passing test
 *
 * so `# pass > 0` does NOT prove that a test body ran. The JUnit reporter is
 * more precise for the cases it marks explicitly:
 *
 *   a real test              -> <testcase name="a test name" .../>
 *   no definitions at all    -> a single <testcase name="tests/x.test.js">
 *   skipped                  -> <testcase ...><skipped/></testcase>
 *   cancelled                -> <testcase ... failure type="cancelledByParent">
 *   todo                     -> <testcase ...><skipped type="todo"/></testcase>
 *
 * BUT A <testcase> ELEMENT IS NOT BY ITSELF PROOF THAT A TEST RAN. WP3-09 (M-2):
 * measured on the same runner, a suite whose only content is an empty
 * `describe()` — or a `describe()` whose only children are conditionally
 * unreachable — emits the container as a bare <testcase> while the same
 * document reports:
 *
 *     <!-- tests 0 --> <!-- pass 0 --> <!-- fail 0 --> <!-- suites 1 -->
 *
 * That element is a reporter artefact of a container that registered no test,
 * and it is indistinguishable by shape from a genuine top-level test(). The
 * runner's counters are therefore authoritative: `pass + fail` is the number of
 * cases that actually ran to a conclusion, and the enumerated case count is
 * reconciled against it.
 *
 * SKIPPED, CANCELLED AND TODO ARE NEVER COUNTED AS EXECUTED.
 *
 * Usage:
 *   node scripts/test-execution-evidence.js --mode unit
 *   node scripts/test-execution-evidence.js --mode integration
 *   node scripts/test-execution-evidence.js --suite tests/foo.test.js
 *
 * Options:
 *   --mode <unit|integration>  suite class to verify (required unless --suite)
 *   --suite <path>             verify one suite (repeatable)
 *   --repo-root <path>         repository root (default: parent of this script)
 *   --json <path>              write the full evidence record as JSON
 *   --concurrency <n>          suites to execute at once (default 1)
 *   --quiet                    suppress the per-suite table
 *
 * Exit codes: 0 all verified, 1 an execution-evidence violation, 2 usage error.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HERE = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const flag = (name) => argv.includes(name);

const MODE = opt('--mode');
const REPO_ROOT = path.resolve(opt('--repo-root', HERE));
const JSON_OUT = opt('--json');
const QUIET = flag('--quiet');
const CONCURRENCY = Math.max(1, Number.parseInt(opt('--concurrency', '1'), 10) || 1);
const SUITES = argv.reduce((acc, a, i) => (a === '--suite' ? acc.concat(argv[i + 1]) : acc), []);

// Usage errors belong to the CLI. Guarding on require.main keeps the CLI contract
// identical while allowing the pure functions below to be imported by tests.
if (require.main === module && !MODE && SUITES.length === 0) {
  console.error('usage: node scripts/test-execution-evidence.js --mode <unit|integration> [--suite <path>]');
  process.exit(2);
}

const { analyse } = require(path.join(REPO_ROOT, 'scripts', 'assert-test-coverage.js'));

/** Environment for a run: the gate is enabled only in integration mode. */
function envFor(mode) {
  const env = { ...process.env, NODE_ENV: 'test' };

  // The parent may itself be a test process, in which case Node has exported
  // NODE_TEST_CONTEXT. An inherited value makes the spawned runner behave as a
  // nested test context and it emits no reporter output at all — which would
  // silently look like "zero tests executed". The sanctioned integration runner
  // strips this variable for the same reason.
  delete env.NODE_TEST_CONTEXT;
  if (mode === 'integration') {
    env.RUN_DB_TESTS = 'true';
    for (const k of ['TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD']) {
      if (!process.env[k]) {
        console.error(`integration mode requires ${k} (the database-test gate)`);
        process.exit(2);
      }
      env[k] = process.env[k];
    }
  } else {
    for (const k of ['RUN_DB_TESTS', 'TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD']) {
      delete env[k];
    }
  }
  return env;
}

/**
 * WP3-09 (M-2) — the runner's own counts, read from the JUnit document.
 *
 * A <testcase> element is NOT by itself proof that a test ran. Measured on Node
 * 22.23.2/22.23.3, a suite whose only content is an empty `describe()`, or a
 * `describe()` whose only children are conditionally unreachable, emits the
 * container as a bare <testcase> while the same document reports:
 *
 *     <!-- tests 0 --> <!-- pass 0 --> <!-- fail 0 --> <!-- suites 1 -->
 *
 * `pass + fail` is the runner's count of cases that actually ran to a
 * conclusion, so it is an authoritative CEILING on the enumerated case count.
 * It is a ceiling and not an equality because a test that groups subtests is
 * counted by the runner but omitted from the report (measured: tests=3,
 * pass=3, and only the two leaf <testcase> elements are emitted).
 *
 * Returns null when either counter is absent, in which case the enumerated
 * count is left as it is.
 */
function runnerExecutedCount(xml) {
  const counter = (name) => {
    const m = xml.match(new RegExp(`<!-- ${name} (\\d+) -->`));
    return m ? Number(m[1]) : null;
  };
  const pass = counter('pass');
  const fail = counter('fail');
  return pass === null || fail === null ? null : pass + fail;
}

/**
 * Parse the JUnit report for one suite and classify each test case.
 * Deliberately a small, dependency-free scan of the reporter's own output.
 */
function parseJunit(xml, suitePath) {
  const cases = [...xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)];
  const suiteFile = suitePath.split('/').pop();
  let executed = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let cancelled = 0;
  for (const c of cases) {
    const body = c[3] || '';
    const name = (c[1].match(/\bname="([^"]*)"/) || [, ''])[1];
    const isFileArtifact = name === suitePath || name === suiteFile || /\.test\.js$/.test(name);
    const isSkipped = /<skipped\b/.test(body);
    const isCancelled = /cancelledByParent|test did not finish before its parent/.test(body);
    if (isFileArtifact) continue;
    if (isSkipped || isCancelled) {
      if (isCancelled) cancelled += 1; else skipped += 1;
      continue;
    }
    executed += 1;
    if (/<failure\b/.test(body) || /<error\b/.test(body)) failed += 1; else passed += 1;
  }

  // WP3-09 (M-2): never report more executed cases than the runner counted. A
  // container that registered no leaf test is emitted as a bare <testcase> that
  // is indistinguishable by shape from a real top-level test(), so the
  // enumerated count is reconciled against the runner's own evidence. The
  // surplus cases are artefacts and are always counted as passed, so the
  // pass/fail split is rebalanced from `executed` downwards.
  //
  // WP3-11 (fail-closed): absence of either counter is NOT "no ceiling". The
  // runner's counters are the only independent evidence that a case really ran,
  // so a report that omits them cannot be reconciled at all and must fail
  // closed. Without this, a container <testcase> alone is counted as EXECUTED
  // and the suite passes while executing nothing — the exact M-2 failure this
  // reconciliation exists to catch.
  const reported = runnerExecutedCount(xml);
  const countersMissing = reported === null;
  if (!countersMissing && executed > reported) {
    executed = reported;
    if (passed > executed - failed) passed = Math.max(0, executed - failed);
  }

  return { executed, passed, failed, skipped, cancelled, countersMissing };
}

/**
 * The single decision that makes this contract fail closed.
 *
 * A suite is in violation when it executed nothing, OR when the runner's counters
 * are absent so execution cannot be reconciled at all. Exported so the decision
 * itself can be tested directly — a test that re-implements this predicate would
 * assert its own copy rather than the behaviour that actually gates CI.
 */
function isExecutionViolation(row) {
  return (row.executed === 0 || row.countersMissing === true) && !row.exempt;
}

/**
 * The exported aggregation: rows -> { violations, exitCode, ok }.
 *
 * The violation decision lives HERE, not at a call site, so there is no single
 * assignment that can be reverted or neutered while leaving the tests green.
 * Text pins on a call site are an unbounded obligation — an independent reviewer
 * defeated them with five one-line edits (`r.exempt = r.exempt || r.countersMissing`,
 * `violations.length = 0`, `r['violation'] = false`, and others). Testing this
 * function behaviourally is the closure.
 */
function summarise(rows) {
  for (const row of rows) row.violation = isExecutionViolation(row);
  const violations = rows.filter((row) => row.violation);
  return {
    violations,
    exitCode: violations.length === 0 ? 0 : 1,
    ok: violations.length === 0
  };
}

/**
 * Execute one suite in its own process and read its JUnit report.
 *
 * Spawned asynchronously so the caller can bound how many run at once: the
 * database-gated suites take ~900 s serially, which is not viable inside a CI
 * job, while the same set runs in a few minutes with modest parallelism — the
 * same execution model the sanctioned integration runner already uses.
 */
function runSuite(suite, mode) {
  return new Promise((resolve) => {
    const junitPath = path.join(os.tmpdir(), `wp305-junit-${process.pid}-${Math.random().toString(36).slice(2)}.xml`);
    const args = ['--test', '--test-reporter=junit', `--test-reporter-destination=${junitPath}`, suite];
    const finish = (exitCode, error) => {
      let xml = '';
      try { xml = fs.readFileSync(junitPath, 'utf8'); } catch { /* no output */ }
      try { fs.unlinkSync(junitPath); } catch { /* already gone */ }
      const counters = parseJunit(xml, suite);
      const m = xml.match(/<!-- tests (\d+) -->/) || [];
      resolve({
        suite,
        exitCode,
        tests: m[1] !== undefined ? Number(m[1]) : null,
        ...counters,
        error: error || null
      });
    };
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env: envFor(mode), stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 900000);
    child.on('error', (e) => { clearTimeout(timer); finish(null, e.message); });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code, code === 0 ? null : (stderr.trim().split('\n').slice(-1)[0] || null));
    });
  });
}

// ---------------------------------------------------------------------------

const analysis = analyse({ repoRoot: REPO_ROOT });
const discovered = analysis.discovered;
const exempt = analysis.exempt;
const contracted = analysis.sanctioned;

let targets;
if (SUITES.length > 0) {
  targets = SUITES.map((s) => (s.startsWith('tests/') ? s : path.join('tests', s)));
} else if (MODE === 'integration') {
  targets = analysis.gated.filter((f) => contracted.includes(f)).map((f) => path.join('tests', f));
} else {
  targets = analysis.runsUnderNpmTest.map((f) => path.join('tests', f));
}

if (targets.length === 0) {
  console.error(`no suites selected for mode=${MODE}`);
  process.exit(2);
}

async function main() {
const rows = [];
{
  const results = new Array(targets.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      results[i] = await runSuite(targets[i], MODE || 'unit');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  for (const r of results) {
    r.discovered = discovered.includes(path.basename(r.suite));
    r.registered = contracted.includes(path.basename(r.suite));
    r.exempt = exempt.includes(path.basename(r.suite));
    rows.push(r);
  }
}

const lines = [];
lines.push('Runtime execution evidence — scripts/test-execution-evidence.js');
lines.push(`  repository : ${REPO_ROOT}`);
lines.push(`  mode       : ${MODE || 'explicit suites'}`);
lines.push(`  node       : ${process.version}`);
lines.push(`  gate       : ${MODE === 'integration' ? 'ENABLED (disposable database)' : 'disabled'}`);
lines.push(`  concurrency: ${CONCURRENCY}`);
lines.push('');
lines.push('  EXECUTED counts only real test cases that ran; SKIPPED, CANCELLED and');
lines.push('  TODO are never counted as executed. A suite that defines no tests, or whose');
lines.push('  only definitions are unreachable, reports EXECUTED 0.');
lines.push('');
lines.push('  SUITE                                        DISC REG  EXEC  PASS  FAIL  SKIP  CANC  VERDICT');
lines.push('  -------------------------------------------- ---- --- ----- ----- ----- ----- ----- --------------------');
for (const r of rows) {
  const verdict = r.exempt ? 'EXEMPT (legacy)'
    : r.countersMissing ? '*** NO RUNNER COUNTERS ***'
      : r.violation ? '*** ZERO EXECUTED ***' : 'executed';
  lines.push(`  ${path.basename(r.suite).padEnd(44)} ${r.discovered ? ' Y ' : ' - '} ${r.registered ? ' Y ' : ' - '} `
    + `${String(r.executed).padStart(5)} ${String(r.passed).padStart(5)} ${String(r.failed).padStart(5)} `
    + `${String(r.skipped).padStart(5)} ${String(r.cancelled).padStart(5)}  ${verdict}`);
}

const { violations, exitCode, ok } = summarise(rows);
const totals = rows.reduce((a, r) => ({
  executed: a.executed + r.executed, passed: a.passed + r.passed, failed: a.failed + r.failed,
  skipped: a.skipped + r.skipped, cancelled: a.cancelled + r.cancelled
}), { executed: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0 });

lines.push('');
lines.push(`  suites verified : ${rows.length}`);
lines.push(`  EXECUTED (tests): ${totals.executed}   PASSED: ${totals.passed}   FAILED: ${totals.failed}`
  + `   SKIPPED: ${totals.skipped}   CANCELLED: ${totals.cancelled}`);
lines.push(`  exempt (legacy) : ${exempt.length}`);
lines.push(`  violations      : ${violations.length}`);
lines.push('');
lines.push('  EXEMPT — documented superseded legacy suites. These are deliberately');
lines.push('  excluded from the execution contract, are NOT executed by this evidence');
lines.push('  pass, and must never be reported as executed or passed:');
for (const name of exempt) lines.push(`    - ${name}`);

if (violations.length) {
  lines.push('');
  lines.push('FAIL: the following suites executed ZERO tests but are required to execute:');
  for (const v of violations) lines.push(`  - ${v.suite}`);
  lines.push('  A suite with no demonstrable execution must not satisfy the coverage contract.');
}

const record = {
  capturedAtUtc: new Date().toISOString(),
  repoRoot: REPO_ROOT,
  mode: MODE || 'explicit',
  node: process.version,
  rows, totals, violations: violations.map((v) => v.suite),
  exemptSuites: exempt,
  ok
};
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(record, null, 2));

if (!QUIET) console.log(lines.join('\n'));
else if (violations.length) console.log(lines.slice(-3 - violations.length).join('\n'));

process.exit(exitCode);
}

// Run only when invoked as a script. This keeps the CLI behaviour identical while
// exposing the two pure functions so the absent-counter case can be tested with a
// counter-less JUnit document — something the real reporter cannot produce.
if (require.main === module) {
  main().catch((e) => {
    console.error('test-execution-evidence failed:', e && e.stack ? e.stack : e);
    process.exit(2);
  });
}

module.exports = { runnerExecutedCount, parseJunit, isExecutionViolation, summarise };
