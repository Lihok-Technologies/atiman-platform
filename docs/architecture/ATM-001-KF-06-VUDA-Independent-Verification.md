# ATIMAN-KF-06-VUDA — Independent Adversarial Verification Report

> **Repository provenance.** This report is the output of the OWNER-authorised independent adversarial
> verification mission for ATM-001-KF-06. It was produced by a reviewer that did not implement KF-06,
> in a separate context, on its own disposable PostgreSQL cluster and with its own fixtures. It is
> committed here so the evidence the V1 acceptance register cites for requirement 5 is traceable from
> the repository alone. **It is an independent review of one milestone only**: it does not discharge
> whole-ATM-001 independent acceptance (requirement 16, G-16) and it is not production acceptance.
> Committed by the ATM-001-KF-FINAL record-accuracy workstream; the report body below is unaltered.

**Mission:** ATIMAN-KF-06-VUDA — Independent Adversarial Verification (Evidence Integrity)
**Mode:** Independent review / read-only
**Repository:** Lihok-Technologies/atiman-platform
**Frozen candidate:** PR #80, head `eb373e830c08fd88f28b60324d55b14c602fe548`
**Base main:** `988fbb99f31737dbc8f6050511964091e7962ce0`
**Date:** 2026-10-10
**Verdict:** **PASS_WITH_MINOR_FINDINGS**

---

## A. Reviewer independence statement

I am the independent adversarial reviewer. I did not implement KF-06. I did not author the PR, its
production code, its suite, or its architecture record. I ran in a fresh reviewer context with its own
fixtures and its own disposable PostgreSQL 16 cluster (port 55432, data dir `/tmp/kf06-vuda-pgdata`),
separate from the developer's database and from production. Every implementer claim — the PR
description, the KF-06 architecture record, and the implementer's test conclusions — was treated as a
hypothesis and independently re-derived. Where a claim could not be reproduced, it is reported as such.

The pre-existing dev cluster on port 5432 was never connected to and was left running untouched.

## B. Frozen candidate identity

| Item | Observed | Expected | Result |
|---|---|---|---|
| Repository | `https://github.com/Lihok-Technologies/atiman-platform.git` | same | match |
| PR #80 state | `OPEN`, `MERGEABLE`, not draft | reviewable | match |
| PR head SHA | `eb373e830c08fd88f28b60324d55b14c602fe548` | same | match |
| PR base SHA | `988fbb99f31737dbc8f6050511964091e7962ce0` | same | match |
| `origin/main` | `988fbb99f31737dbc8f6050511964091e7962ce0` | same | match |
| Merge base of head and origin/main | `988fbb99f31737dbc8f6050511964091e7962ce0` | same | match |
| Working tree | empty `git status --porcelain` | clean | match |
| Local commits | single commit `eb373e8` on top of base | frozen | match |
| Head tree | `7882698bbadb400fa10afd0e14d193c49bb871e7` | — | recorded |

The frozen candidate had not changed at any point during the mission. Final re-check after all
mutating-by-copy work: HEAD unchanged, tree still clean.

## C. Actual diff review

Single commit, 6 files, +1125 / −4 (`git diff --stat 988fbb99..eb373e83`):

| File | +/- | Assessment |
|---|---|---|
| `docs/architecture/ATM-001-KF-06-Knowledge-Evidence-Deletion-Integrity.md` | +240 | architecture record |
| `tests/knowledge-evidence-deletion-integrity.test.js` | +774 | new suite A–J, R12, R13, R14 |
| `src/models/task-template.model.js` | +89/−2 | `countWorkingEvidence` + guarded `deleteIfEditable` |
| `src/controllers/task-template.controller.js` | +11 | maps `EVIDENCE_PRESENT` → HTTP 409 |
| `scripts/run-integration-tests.js` | +5/−1 | registers suite in sanctioned runner |
| `tests/database-test-guard.test.js` | +6/−1 | registers suite in DB-mutating guard |

Confirmed **absent** from the diff (i.e. unchanged): `src/config/` (capability vocabulary and legacy
bundles), `src/routes/` (the `DELETE /api/task-templates/:id` guard is still
`requireCapability('knowledge.author')`), `database/postgresql/` (no migration, no schema change), and
`database/migrations/`. No capability, bundle, migration, or schema change exists.

The production change is exactly: within `deleteIfEditable`, open one transaction; `SELECT … FOR UPDATE`
the definition row; `SELECT … FOR UPDATE` its step rows; count working evidence bound directly or via a
step; refuse with `code='EVIDENCE_PRESENT'` if any exists; otherwise `DELETE` and commit.

## D. Independent reproduction results

Fresh fixtures (`88xxxx` id block) on `kf06_adv_test`. 26/26 independent checks passed
(`/tmp/kf06-vuda/independent-harness.js`).

| # | Claim | Independent result |
|---|---|---|
| 1 | Direct detach denied without `evidence.attach` | 403 for legacy supervisor **and** for explicit `knowledge.author`-only; row count unchanged |
| 2 | Parent deletion denied while working evidence exists | 409 `EVIDENCE_PRESENT`; template, steps, applicability and evidence all preserved |
| 3 | Step-level evidence equally protected | Evidence inserted out-of-band at step level; deletion 409; step + evidence preserved |
| 4 | Denied deletion preserves all affected rows | Verified for template-level-only, step-level-only, and both; no partial mutation |
| 5 | Evidence-free draft deletion still functional | 200 and row gone; also 200 with child steps present |
| 6 | Authorized detach then legitimate deletion | pre-delete 409 → detach 200 → delete 200; evidence 0 |
| 7 | No unauthorized capability escalation | `evidence.attach`-only cannot delete template (403); `knowledge.author`-only cannot attach or detach (403) |

**Base-vs-head falsification probe** (read-only `git archive` of base, run against the same schema):
the defect is real and the fix closes it — not a phantom.

| Scenario | Base `988fbb99` | Frozen head `eb373e83` |
|---|---|---|
| Supervisor deletes draft with template-level evidence | **200**, evidence 0, template gone | **409**, evidence 1, template intact |
| Supervisor deletes draft with step-level evidence | **200**, evidence 0, template gone | **409**, evidence 1, template intact |

## E. Concurrency findings

- **Template-level attach racing deletion**: an uncommitted attachment holds `FOR KEY SHARE` on the
  definition; the guarded delete blocks on its `FOR UPDATE` and, after the attachment commits, returns
  409 with evidence intact. Reproduced.
- **Step-level attach racing deletion**: same, via the step-row lock — 409, step and evidence intact.
- **Deletion wins**: a later attach answers 404 and creates **no orphaned evidence**; template gone.
- **Concurrent duplicate deletion**: exactly one row removed; second request 404 (and 200 in the R-6
  interleaving, reproduced deterministically below). No corruption.
- **8-way contention stress**: all eight interleavings returned 409 with definition live and evidence
  intact — no deadlock, no cascade loss, no orphan rows.
- **Lock ordering**: verified that a step-row `FOR UPDATE` conflicts with an attaching transaction
  (probe timed out under `lock_timeout`), confirming the step lock is a real serialization point.
- **No deadlock** involving `task_templates`, `task_template_steps` or `knowledge_template_evidence`
  was observed in any run.

Deterministically reproduced residuals (see §J): the losing concurrent attach surfaces as HTTP **500**
with a raw FK constraint message and creates nothing (R-4); a definition that vanishes between the
controller read and the guarded delete answers **200** "deleted successfully" (R-6).

## F. Authorization findings

| Boundary | Result |
|---|---|
| Cross-tenant deletion (foreign admin and foreign supervisor) | 403, nothing removed |
| Body-based tenant spoofing (`organization_id` in JSON body) | ineffective — tenant comes from `req.user.organization_id`; own-tenant delete 200, foreign 403 |
| Query-string tenant spoofing | ineffective — own-tenant guard still returns 409 |
| Global (NULL-org) source mutation | refused 409 `SOURCE_NOT_TENANT_WRITABLE` |
| Capability combinations | no escalation; each capability independent |
| Published-definition deletion | refused (HTTP 500, R-3), immutable version and frozen rows survive |
| Frozen-version provenance mutation | detach of working evidence copied into a published version refused 409 `EVIDENCE_FROZEN` |
| Indirect routes (PUT, clone, publish, submit-for-review, source authoring) | none removed working evidence |
| Separation of duties | publish / submit / approve / safety-review still 403 without the respective capability; `approver ≠ publisher` constraint intact |
| Organization deletion (admin authority) | refused at the database layer (SQLSTATE 42501); no cascade to evidence |
| Nonexistent definition | 404 via the controller |

## G. Architectural compliance

- **Authority is grounded, not invented.** M3 makes the tenant-scoped detach the sanctioned removal path
  for working evidence and refuses generic model delete/update on provenance models; K3-G2 §5.2/§6
  states explicitly that `evidence.attach` *governs the working-evidence citation lifecycle, including
  detachment*; ATM-003-R1 §3.1 defines `evidence.attach`; M6.4 treats evidence as not silently removed;
  ATM-000 states customer data is isolated and shared knowledge immutable to tenants. Applying that
  authority to the *effect* of a definition deletion is consistent with these records.
- **No new capability, bundle, migration or schema change** — proven by the diff.
- **No route guard change** — `DELETE /api/task-templates/:id` remains `knowledge.author`.
- **No provenance immutability weakening** — the change only adds a refusal.
- **Judgment on "new business rule".** The change is best characterised as making an existing
  authorization rule *effect-complete* rather than as new policy; it grants and removes no capability.
  It does change observable behaviour in one case (a previously-200 deletion now 409), which is the
  intended, documented remediation. This is an interpretive step, and I state it explicitly rather than
  inferring correctness from passing tests.
- **Placement.** Guarding the model operation covers all callers and is the strongest placement
  available without a schema change. `BaseModel.delete` remains inherited on `TaskTemplate`, so a
  future in-process caller could bypass the guard; no such caller exists today (R-2).

## H. Regression test results

Environment: disposable PostgreSQL 16 cluster (port 55432), canonical runner applied 23/23 migrations.

| Suite | Result | Exit |
|---|---|---|
| KF-06 focused (`knowledge-evidence-deletion-integrity.test.js`) | 17/17 pass, 0 fail | 0 |
| `npm test` (non-destructive) | **162/162 pass**, 53 suites, 0 skip | 0 |
| Sanctioned integration run 1 (26 suites) | **914/915 pass, 1 fail** | 1 |
| Sanctioned integration run 2 (identical tree) | **915/915 pass, 0 fail** | 0 |
| `knowledge-pack-membership.test.js` in isolation | 20/20 pass | 0 |

Per-area suites inside the sanctioned run (all pass in both runs except the run-1 flake):
knowledge-versioning, knowledge-publication-admission, knowledge-provenance-authoring,
provenance-write-scope, knowledge-authoring, capability-grants, knowledge-accession-authority,
m6r3-r1-remediation, asset-context, knowledge-crosswalk-application, knowledge-pack-membership,
knowledge-pack-publication-admission, migration-runner, observation/report/asset-import/taxonomy suites.

**Run-1 failure is pre-existing and candidate-unrelated — evidenced, not assumed:**
- The single failure was `knowledge-pack-membership` → "allows INSERT while the pack version is draft",
  error `40P01 deadlock detected`.
- The server-reported cycle is `knowledge_pack_membership_guard()` awaiting `RowShareLock` on
  `knowledge_pack_versions` (OID 18334) vs a concurrent `AccessExclusiveLock` on
  `knowledge_pack_version_task_template_versions` (OID 18720) — **neither relation is a KF-06 table**
  (KF-06 tables are `task_templates` OID 17015 and `task_template_steps` OID 17039).
- The failing suite and the migration/DDL suites are unchanged by the PR.
- The suite passes 20/20 in isolation, and run 2 was 915/915.
- This matches the pre-existing parallel-execution hazard already recorded as KF-01 finding F-3.

The PR's own CI check ("Disposable PostgreSQL integration") also reports **pass** (6m45s).

## I. Mutation test results

Mutations applied only to disposable copies under `/tmp/kf06-vuda/`; the frozen candidate was never
modified. The KF-06 suite was run unchanged against each mutant.

| Mutant | Mutation | Suite result | Behavioural tests that detect it |
|---|---|---|---|
| M1 | definition-row `FOR UPDATE` removed | 15/17, exit 1 | **R13** — "got 200 … deleted successfully" ⇒ concurrent attachment cascaded away; plus static J |
| M2 | step-row `FOR UPDATE` removed | 15/17, exit 1 | **R14** — "got 200 … deleted successfully" ⇒ concurrent step attachment cascaded away; plus static J |
| M3 | evidence-existence check neutered | 9/17, exit 1 | B, B2, B3, C, G2, R13, R14 — all "expected 409, got 200" ⇒ evidence destroyed; plus J |
| M4 | transaction + guard removed (pre-fix shape) | 9/17, exit 1 | B, B2, B3, C, G2, R13, R14; plus J |

The suite is non-vacuous: both locks are independently load-bearing, and the evidence check is
load-bearing. Removing each control produces a detectable, reproducible vulnerability.

## J. Residual-risk classification

| # | Residual | Independent finding | Classification |
|---|---|---|---|
| R-2 | Application-layer guard; raw SQL / CLI bypass | **Confirmed** — raw `DELETE FROM task_templates` destroys evidence; not HTTP-reachable; a `BEFORE DELETE` trigger remains an option | Bounded follow-up / informational (not a blocker) |
| R-3 | Published-only deletion returns HTTP 500 | **Confirmed** — 500 with raw trigger message; nothing destroyed; version survives | Bounded follow-up (NIT, pre-existing) |
| R-4 | Losing concurrent attach returns HTTP 500 | **Confirmed deterministically** — 500 with raw FK constraint name; **no evidence created** | Bounded follow-up (MINOR error-contract, pre-existing) |
| R-5 | Source-version FK uses `ON DELETE CASCADE` | **Correction to the record.** The FK is CASCADE at constraint level, but a `BEFORE DELETE` trigger `trg_knowledge_source_versions_immutable` (`immutable_source_version_check`) raises SQLSTATE 23503 before the cascade; evidence survives. The residual is safer than the record states, and the record's "unreachable" rationale is incomplete | Documentation precision finding (MINOR-F1); risk downgraded |
| R-6 | Nonexistent/vanished definition returns success | **Confirmed deterministically** — 200 "deleted successfully" for a row deleted mid-flight; no unauthorized destruction | Bounded follow-up (NIT) |

No residual is an immediate security blocker. R-2 is the only one that could become relevant if a new
in-process or CLI deletion path is ever added; R-3/R-4/R-6 are error-contract quality issues.

**Minor findings (non-blocking):**
- **MINOR-F1** — §J/R-5 record precision: the DB trigger, not merely route-unreachability, is what
  protects source-version deletion. The record should be corrected.
- **MINOR-F2** — KF-06 record §8.0 attributes the parallel deadlock's DDL lock to
  `task_template_versions`; the observed relation was `knowledge_pack_version_task_template_versions`.
  Conclusion (KF-06 unrelated) is unaffected.
- **MINOR-F3** — the pre-existing parallel-suite deadlock (F-3) reproduces intermittently (1 of 2 full
  runs). It is unrelated to this candidate but confirms the CI-determinism review already recommended.

## K. Final verdict

**PASS_WITH_MINOR_FINDINGS**

Justification against the mission's PASS criteria:
- No unresolved critical or major security issue — **met** (F-1 closed; base-vs-head probe proves the
  defect existed and is closed).
- Authorization boundaries preserved — **met** (cross-tenant, spoofing, global, capability combinations,
  separation of duties, immutability all re-verified independently).
- Evidence integrity preserved — **met** (evidence survives every denied path; nothing partially mutates).
- Concurrency protection demonstrated — **met** (locks independently reproduced as load-bearing; no
  deadlock or orphan in stress; residuals bounded).
- No unauthorized business-rule change — **met** (no capability/bundle/schema/migration change; authority
  grounded in M3/K3-G2; behavior change documented and intended).
- Reproducible validation evidence — **met** (26/26 independent checks, 3/3 residual checks, 4 mutants,
  2 full sanctioned runs, all recorded).

The verdict is not a bare PASS because residual-risk record precision (R-5) and error-contract quality
(R-3/R-4/R-6) remain open as bounded, non-security follow-ups.

## L. Merge recommendation

From an **evidence-integrity and authorization-integrity standpoint the change is sound and I recommend
it as safe to merge** — no change requested before merge. Merge remains subject to architectural review
and OWNER authorization; this mission does not authorize merge and did not perform one. Recommended
bounded follow-ups (not merge prerequisites):

1. Correct the KF-06 record's R-5 statement to credit the existing source-version immutability trigger.
2. Correct §8.0's deadlock relation attribution.
3. Map foreign-key/trigger refusals on the provenance attach and published-deletion paths to clean 4xx
   responses (R-3/R-4) and reconcile the optimistic 200 (R-6), as a separate bounded mission.
4. Consider a defensive `BEFORE DELETE` trigger on `task_templates` or an explicit override of
   `BaseModel.delete` on `TaskTemplate` to close R-2 at the database layer.

## M. Explicit non-actions

- No implementation modification — the frozen candidate was never edited. All mutations were performed
  on disposable `/tmp` copies, and all new tests/fixtures live outside the repository.
- No commit.
- No push.
- No merge — PR #80 remains `OPEN`.
- No deployment.
- No production mutation — work was confined to an isolated disposable PostgreSQL 16 cluster on port
  55432; the pre-existing developer cluster on port 5432 was untouched and left running.
- The disposable cluster was stopped after verification; the repository working tree is clean at
  `eb373e830c08fd88f28b60324d55b14c602fe548`.

**STOP — awaiting architectural review and OWNER authorization.**
