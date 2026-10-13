#!/usr/bin/env node
'use strict';

/**
 * ATM-001-SEC-103 — observation probe for scripts/ci-execution-oracle.js.
 *
 * This file is the ONLY part of the oracle that runs inside the process tree it
 * observes. The oracle injects it through NODE_OPTIONS as a preload:
 *
 *   --require=<this file>
 *
 * WHY IT IS AN INDEPENDENT CHANNEL
 *
 * The verifier under test (scripts/test-execution-evidence.js) is the thing being
 * checked, so nothing it prints, counts, writes as JSON or places in a JUnit
 * document can be trusted as evidence of what actually ran. This probe is loaded
 * by the Node runtime itself, outside the verifier's control, and appends records
 * to a journal file whose path the oracle chooses at run time:
 *
 *   kind=process  every Node process the CI command starts, with pid/ppid/argv
 *   kind=exit     the exit code of every such process that terminates normally
 *
 * From those two records the oracle can prove, for the command it actually ran:
 * which suite runners were STARTED (and with exactly which argument vector), and
 * which of them TERMINATED. A runner that is never started, or started with an
 * execution-filtering flag, or started and never reaped, is visible here and
 * nowhere in the verifier's own output.
 *
 * WHY IT IS A PRELOAD AND NOT A REPORTER
 *
 * A custom `--test-reporter` REPLACES the runner's normal output. That perturbs
 * the suites under observation: several suites spawn nested `node --test` probes
 * and assert on the child's output, so injecting a reporter made 93 of 104
 * database-test-guard tests fail — the observer was changing what it observed.
 * A `--require` preload with no other effect cannot do that: measured on this
 * repository, `npm test` under this hook is byte-identical in outcome to
 * `npm test` without it (237 pass, exit 0).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not import, patch, wrap or read the verifier, and it writes nothing to
 * stdout or stderr. It records only facts the runtime gives every process: its own
 * pid, its parent's pid, its own argv, and its exit code. The per-suite executed
 * counts the oracle needs are measured separately, by running the expected suites
 * itself with a TAP reporter into a directory it owns.
 *
 * Environment (set by the oracle, never by the verifier):
 *   ATM001_ORACLE_JOURNAL  append-only JSONL path (absent => probe is inert)
 *   ATM001_ORACLE_TOKEN    per-run nonce, echoed in every record
 */

const fs = require('fs');

const JOURNAL = process.env.ATM001_ORACLE_JOURNAL;
const TOKEN = process.env.ATM001_ORACLE_TOKEN || null;

function record(entry) {
  if (!JOURNAL) return;
  try {
    fs.appendFileSync(JOURNAL, `${JSON.stringify({ token: TOKEN, at: Date.now(), ...entry })}\n`);
  } catch {
    // Deliberately silent: a lost record is observed by the oracle as missing
    // evidence and fails closed. A throw here would abort the process under test
    // and convert an observation failure into a test failure.
  }
}

const base = (p) => String(p).split(/[\\/]/).pop();

(function hook() {
  if (!JOURNAL) return;
  const argvRest = process.argv.slice(1);
  record({
    kind: 'process',
    pid: process.pid,
    ppid: process.ppid,
    argv: argvRest,
    scripts: argvRest.filter((a) => /\.(?:js|cjs|mjs)$/.test(a)).map(base),
    suites: argvRest.filter((a) => /\.test\.js$/.test(a)).map(base),
    node: process.version
  });
  process.on('exit', (code) => record({ kind: 'exit', pid: process.pid, code }));
})();
