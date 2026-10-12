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

The first three live in `.github/workflows/ci-verification.yml`; the fourth is the pre-existing
`.github/workflows/db-integration.yml`, unchanged except that its actions are now pinned to full
commit SHAs.

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
  unreachable-code pattern would require a parser. The runtime pass observes `EXECUTED 0` and fails.
  **Stated limit:** this catches unreachable definitions at runtime, but a suite that is unreachable
  only under some conditions may still execute in others.

## 5. Checks to require on `main`

Recommended required status checks, by exact job name:

```
Unit tests (npm test)
Test inventory coverage
Disposable PostgreSQL integration
```

`Dependency security audit` should be added to the required set **once WP5 remediates the known
advisories**. Requiring it before then would block every merge on a known, already-documented
condition.

> Enabling branch protection / rulesets is **not** part of this change and is not authorized here.
> See ATM-001-SEC-CLOSURE-MASTER-01 (WP2).

## 6. Scope

This contract changes CI configuration, a coverage-verification script and its focused tests, and
this document. It changes **no** application logic, business rule, schema, migration, dependency,
lockfile, or deployment configuration.
