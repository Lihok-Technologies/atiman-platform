#!/usr/bin/env node
'use strict';

/**
 * ATM-001-SEC-103 — CI EXECUTION ORACLE.
 *
 * WHY THIS EXISTS
 *
 * Eight independent adversarial rounds defeated every attempt to make
 * `scripts/test-execution-evidence.js` verify ITSELF. The verifier was its own
 * oracle: it selected the suites, executed them, counted them and printed the
 * result, so any control written against it could be defeated by editing the
 * verifier alone while `npm test`, `assert-test-coverage.js` and the focused
 * suites stayed green. The surviving escape classes were:
 *
 *   E-1  printed selection truncated            (`.slice(0, 1)` on the targets)
 *   E-2  selection conditional on `--json` / `--quiet`  (argv the tests pass, CI does not)
 *   E-3  selection conditional on a TEST-ONLY env marker the tests themselves introduce
 *        (`ATM001_SEC_SEL_REAL_REPO_DEPTH`): one production line reduced CI to 1 of 13
 *   E-4  PRINTED set != EXECUTED set: identities printed that never ran
 *   E-5  name-targeted exclusion (`.filter(f => f !== 'app.test.js')`) at target
 *        selection, or inside `discoverSuites()` in `assert-test-coverage.js`
 *   E-6  fabricated/zero rows presented as executed
 *
 * THIS ORACLE IS INDEPENDENT FOR THREE CONCRETE REASONS
 *
 * 1. EXPECTATIONS DO NOT COME FROM THE VERIFIER. The expected suite identities are
 *    derived here, by this file, from the filesystem (`tests/*.test.js`), from the
 *    integration registration ledger (`SANCTIONED_POSTGRES_INTEGRATION_SUITES` in
 *    scripts/run-integration-tests.js, parsed by this file's own scanner) and from
 *    a hardcoded, documented list of superseded legacy suites. `analyse()`,
 *    `classifySuite()`, `discoverSuites()` and any other function of the verifier
 *    are never imported or called. Hardcoding the legacy list is deliberate: an
 *    independent party writes the expectation down, not the code under test.
 *
 * 2. EXECUTION IS MEASURED BY RUNNING THE SUITES, NOT BY READING THE VERIFIER.
 *    Two independent measurements are taken:
 *      (a) this oracle runs every expected unit suite ITSELF, with the Node test
 *          runner's TAP reporter writing to a file in a directory it owns, and
 *          reads the runner's own `# pass` / `# fail` counters. This is the
 *          executed ground truth, produced without the verifier being involved;
 *      (b) it observes the CI command's own process tree through a `--require`
 *          preload (scripts/lib/ci-oracle-probe.cjs) that appends, to an
 *          append-only journal the verifier never writes to, which suite runners
 *          the command STARTED and which of them TERMINATED.
 *    The verifier's printed per-suite counts are then required to equal (a), and
 *    the identities it printed are required to equal (b). Nothing the verifier
 *    prints, counts, writes as JSON or places in a JUnit document is accepted as
 *    evidence of what ran. If the observation channel is stripped the journal is
 *    empty and the oracle fails closed: missing evidence is a failure, never a pass.
 *
 * 3. THE COMMANDS UNDER TEST ARE READ FROM THE WORKFLOWS. The exact `run:` strings
 *    are extracted from .github/workflows/*.yml and executed verbatim through a
 *    shell, so an edit that deletes or rewrites a CI step fails the oracle's
 *    command-integrity check instead of silently narrowing what is verified.
 *
 * WHY THE CHANNEL IS A PRELOAD AND NOT A REPORTER
 *   A custom `--test-reporter` REPLACES the runner's normal output and therefore
 *   perturbs what is observed: measured on this repository, injecting one made 93
 *   of 104 database-test-guard tests fail because that suite asserts on the output
 *   of the nested `node --test` probes it spawns. The observer must not change the
 *   observed system, so the channel records only what the runtime gives every
 *   process (pid, ppid, argv, exit code) and has no other effect. Measured:
 *   `npm test` under the preload is identical in outcome to `npm test` without it
 *   (237 pass, exit 0).
 *
 * WHAT IT CHECKS (the live list is in the report)
 *   C0  the five CI commands are still present verbatim in the two workflows
 *   C1  inventory: no suite outside the glob, ledger and legacy list are subsets of
 *       the filesystem inventory, and the three classes partition it
 *   C2  `node scripts/assert-test-coverage.js` passes and discovers the same count
 *   C3  the oracle's OWN run of every expected unit suite executes at least one test
 *   C5  the EXACT CI unit argv exits 0
 *   C6  the set it PRINTS is exactly the expected unit class
 *   C7  the suite runners it actually STARTS are exactly the expected unit class
 *   C7b every runner it started was reaped (an exit record exists)
 *   C8  every printed per-suite EXEC count equals the count this oracle measured
 *   C9  no legacy-exempt suite is printed, started or executed
 *   C10 the selection is INVARIANT when every test-only env marker is set
 *   C11 the printed set is unchanged when the observation channel is removed
 *   C12 PRINTED set == STARTED set (the 13-printed/fewer-executed class)
 *   C13 `npm test` executes the expected total and starts a runner for every suite
 *   C15 (integration scope) the integration arg prints and starts exactly the
 *       registered contract; execution is asserted only against a real disposable
 *       database and is otherwise ESCALATED, never silently weakened
 *
 * Usage:
 *   node scripts/ci-execution-oracle.js [--scope unit|integration|all]
 *                                       [--phases P0,P1,...] [--repo-root <path>]
 *                                       [--timeout-ms <n>] [--json <path>]
 *                                       [--keep-going]
 *
 * Exit codes: 0 every evaluated check passed (escalations are reported, not hidden),
 *             1 a check failed, 2 usage or setup error.
 *
 * NOTE ON THE OBSERVATION CHANNEL: the oracle introduces two environment names of
 * its own (ATM001_ORACLE_JOURNAL, ATM001_ORACLE_TOKEN) plus a NODE_OPTIONS
 * preload. No oracle-supplied variable is present in the CI steps it observes
 * other than through this channel, the channel is exercised in the same run in
 * which the verifier's behaviour is judged, and C11 re-runs the CI argv with no
 * channel at all and compares the printed selection.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Ground truth — written here, independently of the code under test.
// ---------------------------------------------------------------------------

const HERE = path.resolve(__dirname, '..');
const PROBE = path.join(__dirname, 'lib', 'ci-oracle-probe.cjs');

const VERIFIER = 'scripts/test-execution-evidence.js';
const LEDGER_REL = 'scripts/run-integration-tests.js';
const WORKFLOW_UNIT = '.github/workflows/ci-verification.yml';
const WORKFLOW_INTEGRATION = '.github/workflows/db-integration.yml';

/** The EXACT commands GitHub Actions runs, and where each must appear verbatim. */
const CI_COMMANDS = Object.freeze([
  { id: 'unit-tests', file: WORKFLOW_UNIT, command: 'npm test' },
  { id: 'unit-evidence', file: WORKFLOW_UNIT, command: `node ${VERIFIER} --mode unit` },
  { id: 'test-inventory', file: WORKFLOW_UNIT, command: 'node scripts/assert-test-coverage.js' },
  { id: 'integration-tests', file: WORKFLOW_INTEGRATION, command: 'npm run test:integration' },
  { id: 'integration-evidence', file: WORKFLOW_INTEGRATION, command: `node ${VERIFIER} --mode integration --concurrency 1` }
]);

/**
 * Superseded legacy ODM-CMMS suites: documented, deliberate exemptions from the
 * execution contract (see scripts/run-integration-tests.js, ATM-013D.5D). They are
 * gated, they are NOT in the integration contract, and they must never be printed,
 * started or observed as executed. An independent party writes this list down;
 * growing it is a decision, not a side effect of editing the verifier.
 */
const LEGACY_EXEMPT = Object.freeze([
  'step6-access-control.test.js',
  'step6-coverage-e2e.test.js',
  'step6-performance.test.js',
  'step6-regression.test.js',
  'step6-seed-migration.test.js'
]);

/** The glob `npm test` executes (package.json "test"). */
const REQUIRED_GLOB = 'tests/*.test.js';

/**
 * Environment names that are PRODUCTION configuration, not test-only markers.
 * They are excluded from the marker-invariance probe so that setting them cannot
 * be mistaken for the test-only marker class. Everything else a test file reads
 * from `process.env` is treated as a test-only marker.
 */
const PRODUCTION_ENV = Object.freeze(new Set([
  'NODE_ENV', 'RUN_DB_TESTS', 'TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME',
  'TEST_DB_USER', 'TEST_DB_PASSWORD', 'TEST_DB_SSL', 'JWT_SECRET', 'PORT', 'HOST',
  'REQUEST_BODY_LIMIT', 'CORS_ALLOWED_ORIGINS', 'ASSET_IMPORT_MAX_ROWS',
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL',
  'DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'
]));

/** Variables the unit CI job does not have, and which must not leak in. */
const DB_GATE_ENV = Object.freeze([
  'RUN_DB_TESTS', 'TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER',
  'TEST_DB_PASSWORD', 'TEST_DB_SSL'
]);

const LIBPQ_ENV = Object.freeze([
  'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGPASSFILE',
  'PGSSLMODE', 'PGCONNECT_TIMEOUT', 'PGSERVICE', 'DB_HOST', 'DB_PORT', 'DB_NAME',
  'DB_USER', 'DB_PASSWORD', 'DATABASE_URL'
]);

/** A gate that cannot reach any database: loopback port 1 is always refused. */
const UNREACHABLE_GATE = Object.freeze({
  TEST_DB_HOST: '127.0.0.1',
  TEST_DB_PORT: '1',
  TEST_DB_NAME: 'atiman_test',
  TEST_DB_USER: 'oracle-unreachable',
  TEST_DB_PASSWORD: 'oracle-unreachable'
});

const PHASE_IDS = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']);

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const flag = (name) => argv.includes(name);

const usage = () => console.error(
  'usage: node scripts/ci-execution-oracle.js [--scope unit|integration|all] '
  + '[--phases P0,P1,...] [--repo-root <path>] [--timeout-ms <n>] [--json <path>] [--keep-going]\n'
  + '       phases: P0 static, P1 own execution baseline, P2 CI unit argv, P3 marker invariance,\n'
  + '               P4 unchanneled control, P5 npm test, P6 integration. P1 is required with P2/P5.'
);

if (flag('--help') || flag('-h')) { usage(); process.exit(0); }

const SCOPE = opt('--scope', 'unit');
if (!['unit', 'integration', 'all'].includes(SCOPE)) {
  console.error(`unknown --scope ${JSON.stringify(SCOPE)}; expected unit, integration or all`);
  process.exit(2);
}
const onlyPhases = opt('--phases');
const selectedPhases = onlyPhases
  ? new Set(String(onlyPhases).split(',').map((s) => s.trim()))
  : null;
if (selectedPhases) {
  for (const p of selectedPhases) {
    if (!PHASE_IDS.includes(p)) {
      console.error(`unknown phase ${JSON.stringify(p)}; known phases: ${PHASE_IDS.join(', ')}`);
      process.exit(2);
    }
  }
}
const REPO_ROOT = path.resolve(opt('--repo-root', HERE));
const TIMEOUT_MS = Math.max(1000, Number.parseInt(opt('--timeout-ms', '1500000'), 10) || 1500000);
const OWN_TIMEOUT_MS = Math.max(1000, Number.parseInt(opt('--timeout-ms', '600000'), 10) || 600000);
const JSON_OUT = opt('--json');
const KEEP_GOING = flag('--keep-going');
const RUN_TOKEN = crypto.randomBytes(12).toString('hex');

// P2 compares the verifier's printed counts against P1's independent measurement,
// so a partial phase selection that omits P1 would compare against nothing.
if (selectedPhases && !selectedPhases.has('P1')
    && (selectedPhases.has('P2') || selectedPhases.has('P5'))) {
  console.error('--phases: P1 (the oracle\'s own execution baseline) must be included with P2 or P5');
  process.exit(2);
}

const checks = [];
const runs = [];
const escalations = [];
const artifacts = [];

const check = (id, phase, ok, detail) => {
  checks.push({ id, phase, ok: Boolean(ok), detail: String(detail) });
  return Boolean(ok);
};
const escalate = (id, reason) => escalations.push({ id, reason });

// ---------------------------------------------------------------------------
// Reading the repository — no verifier function is used anywhere below.
// ---------------------------------------------------------------------------

const abs = (rel) => path.join(REPO_ROOT, rel);
const readText = (rel) => fs.readFileSync(abs(rel), 'utf8');

/** Every `run:` scalar in a workflow, block scalars included. */
function workflowCommands(yaml) {
  const lines = yaml.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(?:-\s*)?run:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    let value = m[2].trim();
    if (/^[|>]/.test(value)) {
      const block = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        if (lines[j].trim() === '') { block.push(''); continue; }
        if (lines[j].match(/^\s*/)[0].length <= indent) break;
        block.push(lines[j].trim());
      }
      value = block.join('\n').trim();
      i = j - 1;
    } else {
      value = value.replace(/^['"]|['"]$/g, '');
    }
    if (value) out.push(value);
  }
  return out;
}

/** This file's own anchored scanner for a `const NAME = [ ... ];` suite list. */
function parseSuiteArray(source, constName) {
  const start = source.search(new RegExp(`const\\s+${constName}\\s*=\\s*\\[`));
  if (start === -1) return null;
  const end = source.indexOf('\n];', start);
  if (end === -1) return null;
  const body = source.slice(start, end).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const names = [...body.matchAll(/'([^'\n]+?\.test\.js)'/g)].map((m) => m[1].split('/').pop());
  return names.length ? [...new Set(names)] : null;
}

/** The filesystem inventory: exactly what `tests/*.test.js` matches. */
function inventory() {
  const dir = abs('tests');
  const flat = fs.readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort();
  const nested = [];
  const walk = (d, rel) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(d, entry.name), r);
      else if (entry.name.endsWith('.test.js')) nested.push(r);
    }
  };
  walk(dir, '');
  return { flat, nested: nested.filter((r) => r.includes('/')).sort() };
}

/** Test-only env markers: every env name a test file reads, minus production config. */
function discoverMarkers(files) {
  const names = new Set(['ATM001_SEC_SEL_REAL_REPO_DEPTH']);
  for (const f of files) {
    const src = fs.readFileSync(path.join(abs('tests'), f), 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]{3,})/g)) names.add(m[1]);
  }
  for (const k of PRODUCTION_ENV) names.delete(k);
  return [...names].sort();
}

/** The Node test runner's own counters, from a TAP document. */
function parseTapCounters(text) {
  const lines = String(text).split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^# tests (\d+)\s*$/);
    if (!m) continue;
    const block = { tests: Number(m[1]) };
    for (let j = i + 1; j < lines.length; j += 1) {
      const c = lines[j].match(/^# (pass|fail|skipped|cancelled|todo|suites) (\d+)\s*$/);
      if (!c) break;
      block[c[1]] = Number(c[2]);
    }
    blocks.push(block);
  }
  if (blocks.length === 0) return null;
  const last = blocks[blocks.length - 1];
  return {
    ...last,
    blocks: blocks.length,
    executed: (last.pass || 0) + (last.fail || 0)
  };
}

// ---------------------------------------------------------------------------
// Running a CI command while observing the process tree it creates.
// ---------------------------------------------------------------------------

/** The CI-shaped environment: GitHub Actions variables, no gate, no test markers. */
function ciEnv(markers, extra = {}) {
  const env = { ...process.env };
  env.CI = 'true';
  env.GITHUB_ACTIONS = 'true';
  env.GITHUB_WORKSPACE = REPO_ROOT;
  delete env.NODE_OPTIONS;
  for (const k of [...DB_GATE_ENV, ...LIBPQ_ENV]) delete env[k];
  for (const k of markers) delete env[k];
  delete env.ATM001_ORACLE_JOURNAL;
  delete env.ATM001_ORACLE_TOKEN;
  return { ...env, ...extra };
}

function runDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-oracle-'));
  artifacts.push(dir);
  fs.writeFileSync(path.join(dir, 'README.txt'), `${label}\n${new Date().toISOString()}\n`);
  return dir;
}

function observe(command, options = {}) {
  const dir = runDir(options.label || command);
  const env = ciEnv(options.markers || [], options.extraEnv || {});
  const record = {
    label: options.label || command,
    command,
    channel: Boolean(options.channel),
    env: {
      CI: env.CI,
      GITHUB_ACTIONS: env.GITHUB_ACTIONS,
      GITHUB_WORKSPACE: env.GITHUB_WORKSPACE,
      markers: (options.markers || []).length,
      gate: Boolean(options.extraEnv && options.extraEnv.TEST_DB_HOST)
    },
    artifacts: dir
  };

  let journal = null;
  if (options.channel) {
    journal = path.join(dir, 'journal.jsonl');
    fs.writeFileSync(journal, '');
    env.ATM001_ORACLE_JOURNAL = journal;
    env.ATM001_ORACLE_TOKEN = RUN_TOKEN;
    env.NODE_OPTIONS = `--require=${PROBE}`;
  }

  const started = Date.now();
  const res = spawnSync('/bin/sh', ['-c', command], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024
  });
  record.durationMs = Date.now() - started;
  record.status = res.status;
  record.signal = res.signal || null;
  record.timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
  record.error = res.error ? String(res.error.message || res.error) : null;
  record.stdout = res.stdout || '';
  record.stderr = res.stderr || '';

  record.journal = [];
  if (journal && fs.existsSync(journal)) {
    for (const line of fs.readFileSync(journal, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.token !== RUN_TOKEN) {
          record.forgedRecords = (record.forgedRecords || 0) + 1;
          continue;
        }
        record.journal.push(entry);
      } catch {
        record.corruptRecords = (record.corruptRecords || 0) + 1;
      }
    }
  }
  runs.push(record);
  return record;
}

// ---------------------------------------------------------------------------
// Attributing the observed process tree to the command the oracle actually ran.
//
// The journal is a whole-process-tree record, and the focused suites deliberately
// spawn nested verifier runs and fixture suites. Only the SHALLOWEST recorded
// process that is the command's own script (or a suite runner), and its DIRECT
// children, count as evidence: nested self-probes are excluded by construction.
// ---------------------------------------------------------------------------

function analyseObserved(run, files) {
  const processes = run.journal.filter((e) => e.kind === 'process');
  const exits = new Map();
  for (const e of run.journal.filter((x) => x.kind === 'exit')) exits.set(e.pid, e);
  const byPid = new Map();
  for (const p of processes) if (!byPid.has(p.pid)) byPid.set(p.pid, p);

  const depthOf = (pid) => {
    let depth = 0;
    let cur = pid;
    const seen = new Set();
    while (byPid.has(cur) && !seen.has(cur) && depth < 64) {
      seen.add(cur);
      const parent = byPid.get(cur).ppid;
      if (!byPid.has(parent)) break;
      cur = parent;
      depth += 1;
    }
    return depth;
  };

  const scriptNames = [...String(run.command).matchAll(/[\w.-]+\.js/g)].map((m) => path.basename(m[0]));
  const candidates = new Set();
  for (const p of processes) {
    if ((p.scripts || []).some((s) => scriptNames.includes(s))) candidates.add(p.pid);
    if ((p.suites || []).length) candidates.add(p.pid);
  }
  const ranked = [...candidates].filter((p) => Number.isInteger(p))
    .sort((a, b) => (depthOf(a) - depthOf(b)) || (a - b));
  const anchor = ranked.length ? ranked[0] : null;

  const inScope = (rec) => anchor !== null && (rec.pid === anchor || rec.ppid === anchor);
  const fileSet = new Set(files);
  const spawned = new Map();
  for (const p of processes.filter(inScope)) {
    for (const s of p.suites || []) {
      if (!fileSet.has(s) || spawned.has(s)) continue;
      const exitRecord = exits.get(p.pid);
      spawned.set(s, {
        pid: p.pid,
        argv: p.argv,
        exited: exits.has(p.pid),
        exitCode: exitRecord ? exitRecord.code : null
      });
    }
  }

  return {
    anchor,
    anchorDepth: anchor === null ? null : depthOf(anchor),
    spawned,
    spawnedSet: [...spawned.keys()].sort(),
    processRecords: processes.length,
    exitRecords: exits.size
  };
}

// ---------------------------------------------------------------------------
// Reading the verifier's PRINTED report. Parsing is fail-closed: an unparseable
// row is an error, never a silently ignored line.
// ---------------------------------------------------------------------------

function parsePrinted(stdout) {
  const lines = String(stdout).split('\n');
  const separator = lines.findIndex((l) => /^ {2}-{20,}/.test(l));
  const out = { rows: [], verified: null, violations: null, parseError: null };
  const verified = String(stdout).match(/suites verified\s*:\s*(\d+)/);
  const violations = String(stdout).match(/violations\s*:\s*(\d+)/);
  out.verified = verified ? Number(verified[1]) : null;
  out.violations = violations ? Number(violations[1]) : null;
  if (separator === -1) {
    out.parseError = 'the report contains no assessed-suite table separator';
    return out;
  }
  for (let i = separator + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') break;
    const m = line.match(
      /^ {2}(\S+\.test\.js)\s+(Y|-)\s+(Y|-)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/
    );
    if (!m) {
      out.parseError = `unparseable assessed-suite row: ${JSON.stringify(line)}`;
      return out;
    }
    out.rows.push({
      suite: m[1],
      exec: Number(m[4]),
      pass: Number(m[5]),
      fail: Number(m[6]),
      skip: Number(m[7]),
      cancel: Number(m[8]),
      verdict: m[9].trim()
    });
  }
  if (out.rows.length === 0) out.parseError = 'the assessed-suite table contains no rows';
  return out;
}

// ---------------------------------------------------------------------------
// Set helpers
// ---------------------------------------------------------------------------

const sorted = (iterable) => [...iterable].sort();
const eq = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const diff = (a, b) => sorted(a).filter((x) => !new Set(b).has(x));

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

const state = {};

function phaseStatic() {
  const inventoryResult = inventory();
  state.files = inventoryResult.flat;

  // C0 — the CI commands still exist verbatim.
  const missing = [];
  const present = [];
  const workflowText = new Map();
  for (const rel of [WORKFLOW_UNIT, WORKFLOW_INTEGRATION]) workflowText.set(rel, readText(rel));
  state.workflowCommands = {};
  for (const c of CI_COMMANDS) {
    const commands = workflowCommands(workflowText.get(c.file));
    state.workflowCommands[c.file] = commands;
    if (commands.includes(c.command)) present.push(c.id);
    else missing.push(`${c.id} (\`${c.command}\` not found as a run: step in ${c.file})`);
  }
  check('C0.workflow-commands', 'P0', missing.length === 0,
    missing.length === 0
      ? `${present.length}/${CI_COMMANDS.length} CI commands present verbatim: ${present.join(', ')}`
      : `MISSING FROM THE WORKFLOWS: ${missing.join('; ')}`);

  // C1 — inventory, ledger, legacy and the partition between them.
  const registered = parseSuiteArray(readText(LEDGER_REL), 'SANCTIONED_POSTGRES_INTEGRATION_SUITES');
  state.registered = registered;
  const problems = [];
  if (!registered) problems.push(`${LEDGER_REL}: could not parse SANCTIONED_POSTGRES_INTEGRATION_SUITES`);
  if (inventoryResult.nested.length) {
    problems.push(`suites matched by nothing: ${inventoryResult.nested.join(', ')} (not in ${REQUIRED_GLOB})`);
  }
  if (state.files.length === 0) problems.push('the tests/ inventory is empty');
  const reg = registered || [];
  const unknownReg = diff(reg, state.files);
  if (unknownReg.length) problems.push(`registered but absent from tests/: ${unknownReg.join(', ')}`);
  const unknownLegacy = diff(LEGACY_EXEMPT, state.files);
  if (unknownLegacy.length) problems.push(`legacy-exempt but absent from tests/: ${unknownLegacy.join(', ')}`);
  const both = sorted(reg.filter((f) => LEGACY_EXEMPT.includes(f)));
  if (both.length) problems.push(`both registered and legacy-exempt: ${both.join(', ')}`);
  state.expectedUnit = diff(state.files, [...reg, ...LEGACY_EXEMPT]);
  state.legacy = [...LEGACY_EXEMPT];
  check('C1.inventory', 'P0', problems.length === 0,
    problems.length === 0
      ? `${state.files.length} suites on disk = ${state.expectedUnit.length} unit + ${reg.length} registered + ${LEGACY_EXEMPT.length} legacy-exempt`
      : problems.join('; '));

  // C2 — the inventory command agrees with this oracle's own inventory.
  const inventoryRun = observe('node scripts/assert-test-coverage.js', { label: 'test-inventory' });
  const discovered = String(inventoryRun.stdout).match(/discovered suites\s*:\s*(\d+)/);
  const discoveredCount = discovered ? Number(discovered[1]) : null;
  check('C2.inventory-command', 'P0',
    inventoryRun.status === 0 && discoveredCount === state.files.length,
    `exit ${inventoryRun.status}, discovered ${discoveredCount}, oracle inventory ${state.files.length}`);

  state.markers = discoverMarkers(state.files);
  state.own = { counts: new Map(), total: 0 };
}

/**
 * P1 — the oracle's own execution of every expected unit suite, with the Node
 * test runner's TAP reporter writing into a directory the oracle owns. This is
 * the executed ground truth; the verifier is not involved.
 */
function phaseOwnBaseline() {
  const dir = runDir('P1 oracle own per-suite execution');
  const problems = [];
  const slow = [];
  for (const suite of state.expectedUnit) {
    const tapPath = path.join(dir, `${suite}.tap`);
    const env = ciEnv(state.markers, {});
    const started = Date.now();
    const res = spawnSync(process.execPath,
      ['--test', '--test-reporter=tap', `--test-reporter-destination=${tapPath}`, `tests/${suite}`],
      { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: OWN_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    const counters = fs.existsSync(tapPath) ? parseTapCounters(fs.readFileSync(tapPath, 'utf8')) : null;
    const record = {
      suite,
      status: res.status,
      durationMs: Date.now() - started,
      counters
    };
    state.own.counts.set(suite, record);
    state.own.total += counters ? counters.executed : 0;
    if (!counters) problems.push(`${suite}: no TAP counters produced (exit ${res.status})`);
    else if (counters.executed === 0) problems.push(`${suite}: executed 0 tests (exit ${res.status})`);
    if (counters && counters.executed > 0) slow.push(`${suite}=${counters.executed}`);
  }
  check('C3.own-execution', 'P1', problems.length === 0,
    problems.length === 0
      ? `all ${state.expectedUnit.length} expected unit suites executed tests when run directly: ${slow.join(', ')}`
      : `the expected unit class cannot be executed by the oracle itself: ${problems.join('; ')}`);
}

/** P2 — the EXACT CI unit argv, observed through the preload channel. */
function phaseGate() {
  const command = CI_COMMANDS.find((c) => c.id === 'unit-evidence').command;
  const run = observe(command, { channel: true, label: 'P2 unit-evidence (CI argv, no markers)' });
  const printed = parsePrinted(run.stdout);
  const observed = analyseObserved(run, state.files);
  state.gate = { run, printed, observed };
  const expected = state.expectedUnit;

  check('C5.gate-exit', 'P2', run.status === 0 && !run.timedOut,
    `\`${command}\` exit ${run.status}${run.timedOut ? ' TIMED OUT' : ''}`
    + (run.status === 0 ? '' : `; stderr tail: ${String(run.stderr).trim().split('\n').slice(-1)[0] || ''}`));

  check('C6.gate-printed-set', 'P2',
    printed.parseError === null && eq(printed.rows.map((r) => r.suite), expected) && printed.verified === expected.length,
    printed.parseError
      ? `FAIL-CLOSED PARSE ERROR: ${printed.parseError}`
      : `printed ${printed.rows.length} (stated total ${printed.verified}), expected ${expected.length}`
        + (eq(printed.rows.map((r) => r.suite), expected)
          ? ''
          : `; missing ${JSON.stringify(diff(expected, printed.rows.map((r) => r.suite)))}`
            + ` extra ${JSON.stringify(diff(printed.rows.map((r) => r.suite), expected))}`));

  check('C7.gate-started-set', 'P2', eq(observed.spawnedSet, expected),
    `started suite runners ${observed.spawnedSet.length} of ${expected.length}`
    + `; never started ${JSON.stringify(diff(expected, observed.spawnedSet))}`
    + `; unexpected ${JSON.stringify(diff(observed.spawnedSet, expected))}`
    + ` (anchor pid ${observed.anchor}, depth ${observed.anchorDepth},`
    + ` ${observed.processRecords} process records)`);

  const neverReaped = [...observed.spawned.entries()].filter(([, v]) => !v.exited).map(([k]) => k);
  check('C7b.every-started-runner-reaped', 'P2', neverReaped.length === 0,
    neverReaped.length === 0
      ? `every started runner produced an exit record (${observed.exitRecords} exit records)`
      : `started but never reaped: ${JSON.stringify(neverReaped)}`);

  // C8 — the verifier's printed counts must equal the oracle's own measurement.
  const countProblems = [];
  for (const row of printed.rows) {
    const own = state.own.counts.get(row.suite);
    const actual = own && own.counters ? own.counters.executed : 0;
    if (actual !== row.exec) countProblems.push(`${row.suite}: printed EXEC ${row.exec}, oracle measured ${actual}`);
  }
  check('C8.printed-vs-measured-counts', 'P2', countProblems.length === 0,
    countProblems.length === 0
      ? `all ${printed.rows.length} printed EXEC counts equal the oracle's own measurement`
      : `PRINTED COUNTS NOT BACKED BY EXECUTION: ${countProblems.join('; ')}`);

  // C9 — legacy-exempt suites are never printed, started or executed.
  const legacyPrinted = printed.rows.filter((r) => state.legacy.includes(r.suite)).map((r) => r.suite);
  const legacyStarted = observed.spawnedSet.filter((f) => state.legacy.includes(f));
  check('C9.legacy-never-executed', 'P2', legacyPrinted.length === 0 && legacyStarted.length === 0,
    legacyPrinted.length || legacyStarted.length
      ? `legacy-exempt suites printed/started: ${JSON.stringify([...legacyPrinted, ...legacyStarted])}`
      : `no legacy-exempt suite printed or started as executed (${state.legacy.length} exempt)`);

  // C12 — printed identities vs runners actually started.
  const printedSet = printed.rows.map((r) => r.suite);
  check('C12.printed-equals-started', 'P2', eq(printedSet, observed.spawnedSet),
    `printed ${printedSet.length} identities, started ${observed.spawnedSet.length} runners`
    + `; printed-but-not-started ${JSON.stringify(diff(printedSet, observed.spawnedSet))}`
    + `; started-but-not-printed ${JSON.stringify(diff(observed.spawnedSet, printedSet))}`);

  check('C12b.channel-integrity', 'P2', !run.forgedRecords && !run.corruptRecords,
    `forged records ${run.forgedRecords || 0}, corrupt records ${run.corruptRecords || 0}`
    + `, journal entries ${run.journal.length}`);
}

/** P3 — selection must not depend on any test-only env marker. */
function phaseMarkers() {
  const command = CI_COMMANDS.find((c) => c.id === 'unit-evidence').command;
  const markers = state.markers;
  const run = observe(command, { channel: true, markers, label: 'P3 unit-evidence (all test-only markers set)' });
  const printed = parsePrinted(run.stdout);
  const observed = analyseObserved(run, state.files);
  state.markerRun = { run, printed, observed };

  const baselinePrinted = state.gate.printed.rows.map((r) => r.suite);
  const baselineStarted = state.gate.observed.spawnedSet;
  const problems = [];
  if (printed.parseError) problems.push(`parse error: ${printed.parseError}`);
  if (!eq(printed.rows.map((r) => r.suite), baselinePrinted)) {
    problems.push(`printed selection changed: ${JSON.stringify(diff(baselinePrinted, printed.rows.map((r) => r.suite)))}`
      + ` -> ${JSON.stringify(diff(printed.rows.map((r) => r.suite), baselinePrinted))}`);
  }
  if (!eq(observed.spawnedSet, baselineStarted)) {
    problems.push(`started selection changed: missing ${JSON.stringify(diff(baselineStarted, observed.spawnedSet))}`
      + `, unexpected ${JSON.stringify(diff(observed.spawnedSet, baselineStarted))}`);
  }
  check('C10.marker-invariance', 'P3', problems.length === 0,
    problems.length === 0
      ? `selection unchanged with ${markers.length} test-only marker(s) set: ${markers.join(', ')}`
      : `SELECTION DEPENDS ON A TEST-ONLY MARKER (${markers.join(', ')}): ${problems.join('; ')}`
      + ` [the marker run exit code is not asserted: the marker set includes test-local fixture switches`
      + ` that legitimately drive the focused suites' own self-probes]`);
}

/** P4 — the same CI argv with no observation channel at all. */
function phaseUnchanneled() {
  const command = CI_COMMANDS.find((c) => c.id === 'unit-evidence').command;
  const run = observe(command, { channel: false, label: 'P4 unit-evidence (no observation channel)' });
  const printed = parsePrinted(run.stdout);
  const baseline = state.gate.printed.rows.map((r) => r.suite);
  const ok = run.status === 0 && !printed.parseError && eq(printed.rows.map((r) => r.suite), baseline);
  check('C11.unchanneled-selection', 'P4', ok,
    printed.parseError
      ? `FAIL-CLOSED PARSE ERROR: ${printed.parseError}`
      : `exit ${run.status}; printed ${printed.rows.length} identities against ${baseline.length} baseline`
        + (eq(printed.rows.map((r) => r.suite), baseline)
          ? ' (identical)'
          : `; CHANGED: ${JSON.stringify(diff(baseline, printed.rows.map((r) => r.suite)))}`));
}

/** P5 — `npm test`, the other command the unit CI job runs. */
function phaseNpmTest() {
  const command = CI_COMMANDS.find((c) => c.id === 'unit-tests').command;
  const run = observe(command, { channel: true, label: 'P5 npm test (CI argv)' });
  const observed = analyseObserved(run, state.files);
  const counters = parseTapCounters(run.stdout);
  state.npmTest = { run, observed, counters };

  check('C13.npm-test-executes-expected-total', 'P5',
    run.status === 0 && !run.timedOut && counters !== null
      && counters.executed === state.own.total && counters.fail === 0,
    `\`${command}\` exit ${run.status}`
    + `; runner counters executed ${counters ? counters.executed : 'none'} (pass ${counters ? counters.pass : '?'},`
    + ` fail ${counters ? counters.fail : '?'}) against the oracle's own total ${state.own.total}`
    + ` [blocks ${counters ? counters.blocks : 0}; the LAST TAP summary is the outer runner]`);

  const missing = diff(state.files, observed.spawnedSet);
  const extra = diff(observed.spawnedSet, state.files);
  check('C14.npm-test-starts-every-suite', 'P5', missing.length === 0 && extra.length === 0,
    `started ${observed.spawnedSet.length} of ${state.files.length} suites on disk`
    + `; never started ${JSON.stringify(missing)}; unexpected ${JSON.stringify(extra)}`);
}

/** P6 — the integration arg (selection always; execution only with a real database). */
function phaseIntegration() {
  const spec = CI_COMMANDS.find((c) => c.id === 'integration-evidence');
  const dbVars = ['TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD'];
  const hasDb = dbVars.every((k) => process.env[k]);
  // ciEnv() strips the gate, so a real disposable database must be re-supplied
  // explicitly; without one the gate is pointed at an unreachable port so that
  // SELECTION can still be observed without any possibility of touching a database.
  const gateEnv = hasDb
    ? Object.fromEntries(dbVars.map((k) => [k, process.env[k]]))
    : { ...UNREACHABLE_GATE };
  const run = observe(spec.command, {
    channel: true,
    extraEnv: gateEnv,
    label: `P6 integration-evidence (${hasDb ? 'ambient disposable database' : 'unreachable gate: selection evidence only'})`
  });
  const printed = parsePrinted(run.stdout);
  const observed = analyseObserved(run, state.files);
  state.integration = { run, printed, observed, hasDb };
  const registered = state.registered || [];

  check('C15a.integration-printed-set', 'P6',
    printed.parseError === null && eq(printed.rows.map((r) => r.suite), registered),
    printed.parseError
      ? `FAIL-CLOSED PARSE ERROR: ${printed.parseError}`
      : `printed ${printed.rows.length} of ${registered.length} registered`
        + `; missing ${JSON.stringify(diff(registered, printed.rows.map((r) => r.suite)))}`
        + `; extra ${JSON.stringify(diff(printed.rows.map((r) => r.suite), registered))}`);

  check('C15b.integration-started-set', 'P6', eq(observed.spawnedSet, registered),
    `started ${observed.spawnedSet.length} of ${registered.length} registered runners`
    + `; never started ${JSON.stringify(diff(registered, observed.spawnedSet))}`
    + `; unexpected ${JSON.stringify(diff(observed.spawnedSet, registered))}`);

  if (hasDb) {
    check('C15c.integration-executed-set', 'P6',
      run.status === 0 && eq(observed.spawnedSet, registered)
      && printed.rows.every((r) => r.exec > 0),
      `exit ${run.status}; every printed suite executed > 0: `
      + `${printed.rows.filter((r) => r.exec === 0).map((r) => r.suite).join(', ') || 'yes'}`);
  } else {
    escalate('C15c.integration-executed-set',
      'no disposable TEST_DB_* in this environment: the integration command cannot be observed '
      + 'EXECUTING tests here (the gate points at an unreachable database, so every gated suite is '
      + 'cancelled). Selection and runner identity are asserted (C15a/C15b); the EXECUTED assertion is '
      + 'discharged only where a real disposable database exists — the db-integration CI job, or a '
      + 'local postgres:17 — and is NOT substituted by a weaker control here.');
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function report() {
  const lines = [];
  const failed = checks.filter((c) => !c.ok);
  lines.push('CI EXECUTION ORACLE — scripts/ci-execution-oracle.js');
  lines.push(`  repository   : ${REPO_ROOT}`);
  lines.push(`  node         : ${process.version}${process.version.startsWith('v22.') ? '  (CI pins Node 22)' : '  WARNING: CI pins Node 22'}`);
  lines.push(`  scope        : ${SCOPE}${selectedPhases ? `  phases: ${[...selectedPhases].join(',')}` : ''}`);
  lines.push('  environment  : CI=true GITHUB_ACTIONS=true GITHUB_WORKSPACE=<repo>, database gate removed,');
  lines.push('                 test-only markers removed, NODE_OPTIONS cleared so the channel is the only preload');
  lines.push(`  artifacts    : ${artifacts.length ? artifacts[0] : '(none)'}`);
  lines.push('  observation  : NODE_OPTIONS --require=scripts/lib/ci-oracle-probe.cjs (preload only; the');
  lines.push('                 runner\'s own output is untouched, so the observed system is unperturbed)');
  lines.push('');
  lines.push('  CI COMMANDS READ FROM THE WORKFLOWS');
  for (const [file, commands] of Object.entries(state.workflowCommands || {})) {
    for (const c of commands) lines.push(`    ${file.padEnd(42)} ${c.split('\n')[0]}`);
  }
  lines.push('');
  lines.push('  RUNS');
  for (const r of runs) {
    const proc = r.journal.filter((e) => e.kind === 'process').length;
    lines.push(`    ${r.label}`);
    lines.push(`      command : ${r.command}`);
    lines.push(`      exit    : ${r.status}${r.timedOut ? ' (TIMED OUT)' : ''}`
      + `   duration: ${(r.durationMs / 1000).toFixed(1)}s   channel: ${r.channel ? 'on' : 'off'}`
      + `   observed process records: ${proc}`);
  }
  if (state.gate) {
    lines.push('');
    lines.push('  PRINTED vs INDEPENDENTLY MEASURED EXECUTION (the CI unit argv)');
    lines.push('    SUITE                                        PRINTED-EXEC  ORACLE-MEASURED  PRINTED-PASS  MEASURED-PASS');
    for (const row of state.gate.printed.rows) {
      const own = state.own.counts.get(row.suite);
      const c = own && own.counters ? own.counters : {};
      const flag = (c.executed === row.exec) ? ' ' : ' <-- MISMATCH';
      lines.push(`    ${row.suite.padEnd(44)} ${String(row.exec).padStart(6)} ${String(c.executed === undefined ? '-' : c.executed).padStart(15)}`
        + ` ${String(row.pass).padStart(13)} ${String(c.pass === undefined ? '-' : c.pass).padStart(13)}${flag}`);
    }
    lines.push(`    ${'TOTAL'.padEnd(44)} ${String(state.gate.printed.rows.reduce((a, r) => a + r.exec, 0)).padStart(6)}`
      + ` ${String(state.own.total).padStart(15)}`);
  }
  lines.push('');
  lines.push('  CHECKS');
  for (const c of checks) {
    lines.push(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.id}  (${c.phase})`);
    lines.push(`          ${c.detail}`);
  }
  if (escalations.length) {
    lines.push('');
    lines.push('  ESCALATED — a required property could not be evaluated in this environment:');
    for (const e of escalations) lines.push(`    ${e.id}: ${e.reason}`);
  }
  lines.push('');
  if (failed.length === 0) {
    lines.push(`ORACLE VERDICT: PASS — ${checks.length} check(s) passed`
      + (escalations.length ? `, ${escalations.length} escalation(s) reported above` : ''));
  } else {
    lines.push(`ORACLE VERDICT: FAIL — ${failed.length} of ${checks.length} check(s) failed:`);
    for (const c of failed) lines.push(`    - ${c.id}: ${c.detail}`);
  }
  return { text: lines.join('\n'), failed };
}

// ---------------------------------------------------------------------------

const order = [
  { id: 'P0', fn: phaseStatic, scope: ['unit', 'integration', 'all'] },
  { id: 'P1', fn: phaseOwnBaseline, scope: ['unit', 'all'] },
  { id: 'P2', fn: phaseGate, scope: ['unit', 'all'] },
  { id: 'P3', fn: phaseMarkers, scope: ['unit', 'all'] },
  { id: 'P4', fn: phaseUnchanneled, scope: ['unit', 'all'] },
  { id: 'P5', fn: phaseNpmTest, scope: ['unit', 'all'] },
  { id: 'P6', fn: phaseIntegration, scope: ['integration', 'all'] }
];

const main = () => {
  for (const phase of order) {
    if (!phase.scope.includes(SCOPE)) continue;
    if (selectedPhases && !selectedPhases.has(phase.id)) continue;
    phase.fn();
    // Fail fast on the first phase that reports a failure: every mutation class
    // this oracle exists to catch is visible in the phase it attacks, and stopping
    // keeps the cost of later runs off the failure path.
    if (checks.some((c) => !c.ok) && !KEEP_GOING) break;
  }

  const { text, failed } = report();
  const ownCounts = {};
  for (const [suite, rec] of state.own.counts) ownCounts[suite] = rec.counters ? rec.counters.executed : null;
  const record = {
    capturedAtUtc: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    scope: SCOPE,
    node: process.version,
    files: state.files || [],
    expectedUnit: state.expectedUnit || [],
    registered: state.registered || null,
    legacyExempt: state.legacy || [],
    testOnlyMarkers: state.markers || [],
    oracleMeasuredExecuted: ownCounts,
    oracleMeasuredTotal: state.own.total,
    checks,
    escalations,
    runs: runs.map((r) => ({
      label: r.label,
      command: r.command,
      status: r.status,
      channel: r.channel,
      durationMs: r.durationMs,
      timedOut: r.timedOut,
      printed: parsePrinted(r.stdout).rows.map((x) => ({ suite: x.suite, exec: x.exec })),
      started: analyseObserved(r, state.files || []).spawnedSet
    })),
    ok: failed.length === 0
  };
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(record, null, 2));
  console.log(text);
  process.exit(failed.length === 0 ? 0 : 1);
};

try {
  main();
} catch (e) {
  console.error('ci-execution-oracle failed:', e && e.stack ? e.stack : e);
  process.exit(2);
}
