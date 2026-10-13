# CI Verification Contract

**Owner:** ATM-001-SEC-CLOSURE-WP3-01 · **Status:** implemented on branch
`atm-001-sec-closure-wp3-01-ci-completeness`

This document records the required CI verification contract for `atiman-platform`: which checks
exist, what each one proves, and what a required GitHub status check is named.

---

## 1. Why the contract exists

Before this change, CI ran one job (`Disposable PostgreSQL integration`) which executed the 26
sanctioned PostgreSQL integration suites. It did **not** run `npm test`, and it performed **no**
dependency-security check.

The consequence was a silent gap. A database-mutating suite **skips itself** unless the
database-test gate (`NODE_ENV=test`, `RUN_DB_TESTS=true`, `TEST_DB_*`) is satisfied. Such a suite
therefore executes **nothing** under `npm test`, and unless it is also registered in
`scripts/run-integration-tests.js` it executes **nowhere** — while CI still reports green.

## 2. Jobs

| Job name (required status check) | Command | Proves |
|---|---|---|
| `Unit tests (npm test)` | `npm test` | the complete `tests/*.test.js` inventory runs, and any failure fails the job |
| `Test inventory coverage` | `node scripts/assert-test-coverage.js` | no suite is unaccounted for; no registration is stale; the executed glob has not been narrowed; the contract parses |
| `Dependency security audit` | `npm audit --omit=dev --audit-level=high` | no high or critical **production**-dependency advisory is present |
| `Disposable PostgreSQL integration` | `npm run test:integration` | the sanctioned PostgreSQL acceptance suites pass against a disposable database |
| `Independent execution oracle (unit)` | `node scripts/ci-execution-oracle.js --scope unit` | the verifier's printed set, its actually-started suite runners and the counts it prints all agree with expectations derived **outside** the verifier — see §4.3 |

The first three live in `.github/workflows/ci-verification.yml`; the fourth is the pre-existing
`.github/workflows/db-integration.yml`, unchanged except that its actions are now pinned to full
commit SHAs. The fifth (ATM-001-SEC-103) is added to `.github/workflows/ci-verification.yml` by that
change.

## 3. Known blocker — `Dependency security audit` is expected to FAIL

`npm audit --omit=dev --audit-level=high` currently exits non-zero. There are **5 production
advisories: 1 critical, 3 high, 1 moderate**. This job is deliberately **not** suppressed and the
severity threshold is deliberately **not** downgraded: the failure is the signal, and hiding it
would defeat the purpose of the gate.

Remediation is tracked separately (WP5 — Dependency Security). Until it lands, expect this job to be
red. **Do not add suppressions, and do not lower `--audit-level`, to obtain a green run.**

## 4. Adding a test suite

`scripts/assert-test-coverage.js` derives the contract from source; it contains no fixed suite count
and no per-suite allowlist other than the documented legacy exemption.

* **A suite that does not gate itself on the database-test gate** is executed by `npm test`. Nothing
  further is required.
* **A suite that skips itself without the gate** must be registered in
  `SANCTIONED_POSTGRES_INTEGRATION_SUITES` in `scripts/run-integration-tests.js` **and** added to
  `DB_MUTATING_SUITES` in `tests/database-test-guard.test.js`. If it is not, the coverage check fails
  and names it.

The only exemption is `SUPERSEDED_LEGACY_SUITES` in
`scripts/assert-test-coverage.js` — the five superseded ODM-CMMS `step6-*` suites, retained as legacy
evidence and deliberately excluded from the PostgreSQL acceptance contract. Any other unaccounted
self-skipping suite is a failure.

### 4.1 Classification is fail-closed

Every suite must be **positively** classified into one supported execution mechanism:

| Class | Meaning |
|---|---|
| `UNCONDITIONAL` | no conditional-execution construct; executed by `npm test` |
| `GATED` | uses the recognised gate idiom (`{ skip: <reason> }` derived from `isIntegrationTest()`) **and** is registered, so the gate genuinely runs it |
| legacy exemption | one of the five documented `step6-*` suites |

Anything else **fails**. In particular:

* **Unsupported conditional-execution constructs are rejected** — `describe.skip`, `it.skip`,
  `test.skip`, `suite.skip`, `skipIf`, `.todo`, `.only` and `runOnly`. Each can stop tests from
  running without the contract noticing, so none is assumed safe. Use the recognised gate idiom
  instead, or remove the construct.
* **A `skip:` option with no recognised gate is rejected** — it may skip unconditionally, so
  execution cannot be demonstrated.
* **A suite that defines no test is rejected** — importing a test framework is not evidence that
  anything runs.
* **A container alone is not a test** — `describe`, `suite` and `context` group tests; they do not
  register one. C11 requires at least one **leaf** definition (`test`, `it` or `specify`), so a suite
  whose only content is an empty `describe('x', () => {})` is rejected.

> **WP3-07 (M-1).** Containers were previously accepted as test definitions, so a suite containing
> only an empty `describe()` satisfied C11 while executing nothing — and it then also passed the
> runtime evidence pass (the reporter emits the container as a bare `<testcase>`) and `npm test`.
> Requiring a leaf definition closes that path in the fail-closed direction.
>
> **WP3-09 (M-2).** C11 alone was not sufficient. A `describe()` whose only leaf was *present in
> source but unreachable at runtime* still satisfied C11, and the runtime pass still counted the bare
> container `<testcase>` — so a suite executing zero leaf tests passed all three layers. The runtime
> evidence now reconciles the enumerated cases against the runner's own counters, so such a container
> is observed as `EXECUTED 0`. See §4.2.

The analysis is **lexical, not interpretive**. Comments and string/template literals are blanked
before matching, so:
* a construct named only in a **comment** or a **string** is not treated as executable; and
* a **commented-out registration** does not satisfy the contract.

> **WP3-03.** This fail-closed direction replaced an earlier positive-detection design in which a
> suite using `const gated = isIntegrationTest() ? describe : describe.skip;` executed zero tests but
> was silently treated as covered. That bypass is now a `C10` failure.

### 4.2 Runtime execution evidence

**Static classification is inventory evidence, not execution evidence.** `assert-test-coverage.js`
reads source; it cannot see whether a test body ran. `scripts/test-execution-evidence.js` supplies the
missing half: it **executes** each suite, one process per suite, and reads the Node test runner's
**JUnit** report.

A test case counts as `EXECUTED` only when it really ran. `SKIPPED`, `CANCELLED` and `TODO` are
**never** counted as executed.

> **Why not `# pass`?** Measured on Node 22.23.2, an isolated suite that defines **no tests at all**
> reports `# tests 1 / # pass 1` — the *file* is counted as one passing test. `# pass > 0` therefore
> does not prove that anything ran. The JUnit report distinguishes the file-level artefact from a real
> `<testcase>`, and marks skipped and cancelled cases explicitly.

**A `<testcase>` element is not by itself proof that a test ran.** Measured on Node 22.23.2/22.23.3,
a suite whose only content is an empty `describe()` — or a `describe()` whose only children are
conditionally unreachable — emits the container as a bare `<testcase>` that is **indistinguishable by
shape** from a genuine top-level `test()`, while the same document reports
`<!-- tests 0 --> <!-- pass 0 --> <!-- fail 0 --> <!-- suites 1 -->`. That element is a reporter
artefact of a container that registered no test.

The runner's own counters are therefore authoritative, and the enumerated case count is reconciled
against them: `pass + fail` is the number of cases that actually ran to a conclusion, so it is a
**ceiling** on `EXECUTED`. A count above that ceiling is artefact, and is not counted.

> **Why a ceiling and not an equality?** A test that groups subtests is counted by the runner but
> omitted from the report (measured: `tests=3`, `pass=3`, and only the two leaf `<testcase>` elements
> are emitted), so the JUnit `tests` counter alone is not a safe bound in the other direction.

> **Absent counters FAIL CLOSED (WP3-11).** A report that omits `<!-- pass N -->` or
> `<!-- fail N -->` cannot be reconciled at all, so the suite is a **violation** — not an
> unverifiable pass. The counters are the only independent evidence that a case really ran; treating
> their absence as "no ceiling" would let a reporter-emitted container `<testcase>` be counted as
> `EXECUTED`, which is exactly the M-2 failure this reconciliation exists to catch. `isExecutionViolation`
> in `scripts/test-execution-evidence.js` is the single decision point, and
> `tests/ci-failclosed-counter.test.js` exercises it directly with a counter-less document (the real
> reporter cannot emit one). On the Node versions measured (22.23.2, 22.23.3, 26.8.2) the counter
> block is always emitted on normal completion, so this branch is a latent-format guard rather than
> an expected path; `node-version` is pinned only to a major, so a reporter format change would now
> fail loudly instead of silently disabling the ceiling.

This also reconciles the two totals: the runner's `# tests` for the contracted integration suites
(915) exceeds the evidence pass total because the difference is the parent/suite entries the reporter
does not emit, not unexecuted tests.

The two passes:

| Mode | Suites | Command | Job |
|---|---|---|---|
| `unit` | the unconditional suites | `node scripts/test-execution-evidence.js --mode unit` | `Unit tests (npm test)` |
| `integration` | the contracted database-gated suites | `node scripts/test-execution-evidence.js --mode integration` | `Disposable PostgreSQL integration` |

Both run under the same gates as the suites they verify — no production credentials, and the
disposable-database test gate is unchanged.

**Reported classes:** `DISCOVERED` (exists on disk) · `REGISTERED` (in the integration contract) ·
`EXECUTED` (a test case ran) · `PASSED` · `SKIPPED` · `CANCELLED` · `EXEMPT` (the five documented
legacy suites, which are **not** reported as executed or passed).

**Consequences for the two defects this closes:**

* **F-1 (gate-to-skip derivation).** Statically, a `skip:` value that does not trace back to the gate
  is now rejected (`C10`). At runtime, a suite that skips anyway is observed to execute **zero** tests.
  A gate call elsewhere in the file no longer makes a skip conditional.
* **F-2 (computed-property skip).** `describe['skip'](...)` is string content, so it cannot be matched
  against blanked text. It is now matched on the raw source and accepted only when the receiver
  survived blanking — i.e. it is real code, not text inside a string or comment.
* **F-3 (unreachable definitions).** Deliberately **not** addressed statically: recognising every
  unreachable-code pattern would require a parser. The runtime pass observes `EXECUTED 0` and fails —
  including when the unreachable leaf sits inside a container, which the WP3-09 (M-2) reconciliation
  in §4.2 is what makes reliable. **Stated limit:** this catches unreachable definitions at runtime,
  but a suite that is unreachable only under some conditions may still execute in others.

### 4.3 Independent execution oracle (ATM-001-SEC-103)

**The problem.** Every control in §4.1 and §4.2 that runs inside `npm test` asserts the verifier's
**own** behaviour: the verifier selects the suites, executes them, counts them and prints the result.
Eight independent adversarial rounds defeated that arrangement by editing the verifier alone — a
`.slice(0, 1)` on its targets, a selection conditional on `--json`/`--quiet` (argv the tests pass and
CI does not), a selection keyed on a **test-only** marker the tests themselves introduce
(`ATM001_SEC_SEL_REAL_REPO_DEPTH`), a name-targeted exclusion, and printed identities that never ran.
The gate was its own oracle, so any control written against it was inside the same trust boundary.

**The oracle.** `scripts/ci-execution-oracle.js` (with `scripts/lib/ci-oracle-probe.cjs`) is a separate
required job that asserts the verifier from **outside** it:

1. **Expectations come from the repository, not the verifier.** The expected unit class is derived
   from the filesystem (`tests/*.test.js`), from the integration ledger
   (`SANCTIONED_POSTGRES_INTEGRATION_SUITES` in `scripts/run-integration-tests.js`, parsed by the
   oracle's own scanner) and from a hardcoded, documented legacy list. `analyse()`,
   `classifySuite()` and `discoverSuites()` are never imported or called. The exact commands under
   test are read **verbatim from the workflow files**, so deleting or rewriting a CI step fails
   check `C0`.
2. **Execution is measured, not read.** The oracle runs every expected unit suite **itself**, with the
   TAP reporter writing into a directory it owns, and reads the Node runner's own `# pass` / `# fail`
   counters (`C3`). It then runs the exact CI argv and compares the counts the verifier prints with
   that measurement (`C8`).
3. **The verifier's own process tree is observed.** A `--require` preload
   (`scripts/lib/ci-oracle-probe.cjs`) appends to an append-only journal, in a per-run directory the
   verifier never writes to, which suite runners the verifier **started** and which of them
   **terminated** (`C7`, `C7b`). Only the outer command's direct children count as evidence, so the
   nested self-probes the focused suites deliberately spawn are excluded by construction.
4. **The CI environment is reproduced**: `CI=true`, `GITHUB_ACTIONS=true`, `GITHUB_WORKSPACE=<repo>`,
   no database gate, and **no test-only marker** — then the same command is re-run with every
   test-only marker set to assert the selection is unchanged (`C10`), and once more with **no
   observation channel** at all (`C11`).

Checks: `C0` commands present · `C1` inventory partition · `C2` inventory command agrees · `C3` the
oracle's own execution of the expected class · `C5` exit code · `C6` printed set · `C7`/`C7b` started
and reaped runners · `C8` printed counts vs measured counts · `C9` legacy-exempt suites never printed
or started · `C10` marker invariance · `C11` unchanneled selection · `C12` printed set == started set ·
`C13`/`C14` `npm test` total and per-suite starts · `C15a`–`C15c` the integration arg.

**Why a preload and not a reporter.** A custom `--test-reporter` *replaces* the runner's normal output
and therefore perturbs what is observed: measured on this repository, injecting one made 93 of 104
`database-test-guard` tests fail, because that suite asserts on the output of the nested
`node --test` probes it spawns. The observer must not change the observed system, so the channel
records only what the runtime gives every process (pid, ppid, argv, exit code). Measured: `npm test`
under the preload is identical in outcome to `npm test` without it (237 pass, exit 0).

**Scope and limits.**

* `--scope unit` is the job wired into `ci-verification.yml`. It re-runs `npm test` and the unit
  evidence command under observation, so it is a second, independent execution of the same commands.
  Measured budget (Node 22.23.2): ~7 minutes; the job limit is 45 minutes and the oracle also applies
  its own per-command timeout.
* `--scope integration` asserts that the integration arg prints and starts exactly the 26 registered
  suites (`C15a`, `C15b`). Its execution assertion (`C15c`) requires a reachable disposable database
  and is **escalated, not weakened**, when none is present — the gate is then pointed at an
  unreachable port so selection can be observed without any possibility of touching a database. It is
  **not** wired into `db-integration.yml`: the serial evidence pass there is already estimated at ~15
  minutes inside a 45-minute job, and adding a second full pass risks the job budget. Wiring it is a
  separate decision.
* **Residual limit.** The observation channel introduces two environment names of its own
  (`ATM001_ORACLE_JOURNAL`, `ATM001_ORACLE_TOKEN`) plus a `NODE_OPTIONS` preload. A production edit
  that keys its behaviour on *those exact names* could in principle behave correctly only under
  observation. `C11` re-runs the CI argv with no channel and compares the printed selection, which
  bounds the class but does not eliminate it; the names are documented here so a reviewer can see them.
* **Node version.** CI pins Node 22; the oracle reports the runtime it used and warns if it is not
  Node 22. Execution counts are the Node test runner's own, so they are version-sensitive in principle
  and the oracle's comparisons are always made within a single run.

## 5. Checks to require on `main`

Recommended required status checks, by exact job name:

```
Unit tests (npm test)
Test inventory coverage
Disposable PostgreSQL integration
Independent execution oracle (unit)
```

`Dependency security audit` should be added to the required set **once WP5 remediates the known
advisories**. Requiring it before then would block every merge on a known, already-documented
condition.

> Enabling branch protection / rulesets is **not** part of this change and is not authorized here.
> See ATM-001-SEC-CLOSURE-MASTER-01 (WP2). Naming the oracle job above is a recommendation; requiring
> it is likewise not part of this change.

## 6. Scope

This contract changes CI configuration, a coverage-verification script and its focused tests, and
this document. It changes **no** application logic, business rule, schema, migration, dependency,
lockfile, or deployment configuration.

ATM-001-SEC-103 (§4.3) adds one CI job, the oracle script and its preload probe, and the §4.3 text. It
changes no existing step, no suite, and no application logic, and it does not touch branch protection
or rulesets.
