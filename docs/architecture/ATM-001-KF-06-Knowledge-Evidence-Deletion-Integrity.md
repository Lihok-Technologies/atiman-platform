# ATM-001-KF-06 — Knowledge Evidence Deletion Integrity

**Document ID:** ATM-001-KF-06
**Title:** Knowledge Evidence Deletion Integrity — indirect-destruction remediation
**Status:** Implemented on the KF-06 branch, pending review and merge. **This record authorises no merge and no deployment.**
**Baseline:** `origin/main` = `988fbb99f31737dbc8f6050511964091e7962ce0`
**Remediates:** ATIMAN-KF-01/02 finding **F-1** (`ATM-001-KF-01-Post-Merge-Verification-and-Closure-Reconciliation.md` §4.1)
**Authority:** ATM-001 M3 (governed provenance authoring), ATM-001 K3‑G2 (provenance authorization mapping), ATM-003‑R1 §3.1 / ATM-003‑R3 (capability vocabulary and bundles), ATM-001 M6.4 §4 (evidence governance)

---

## 1. Purpose

KF-01 established that the OWNER-approved provenance authorization mapping was **route-complete
but not effect-complete**: a principal deliberately denied `evidence.attach` could still destroy the
same working provenance evidence by deleting the parent draft definition, because the evidence foreign
keys cascade.

This record states the ratified basis for the correction, the exact rule implemented, the behaviour
that changes, what deliberately does **not** change, the alternatives rejected, and the residual risk
that remains. It introduces **no new capability, no bundle change, no migration and no schema change**.

---

## 2. Root cause

| Element | Fact |
|---|---|
| Reachable path | `DELETE /api/task-templates/:id` → `requireCapability('knowledge.author')` → `taskTemplateController.remove` → `TaskTemplate.deleteIfEditable(id)` → `BaseModel.delete(id)` → `DELETE FROM task_templates WHERE id = ?` |
| Effect | `fk_knowledge_template_evidence_template` and `fk_knowledge_template_evidence_step` are `ON DELETE CASCADE` (migration `011`), so the definition deletion also deletes every **working** evidence row bound to the definition or to any of its steps |
| Guard present | The direct detach route (`DELETE /api/knowledge-provenance/templates/:templateId/evidence/:evidenceId`) requires `evidence.attach` and correctly refused with **403** |
| Guard missing | Nothing refused the *indirect* removal. `deleteIfEditable` checked only "is this a system template" |
| Consequence | A legacy supervisor (bundle: `knowledge.author`, deliberately **no** `evidence.attach` — ATM-003‑R3 §3/§4) was refused the detach route and then destroyed the same evidence through the definition deletion, which returned **200** |

Reproduction (recorded in KF‑01 §4.1 and re-verified during this mission):

```
supervisor → DELETE /api/knowledge-provenance/templates/:id/evidence/:evidenceId  → 403 (nothing removed)
supervisor → DELETE /api/task-templates/:id                                      → 200
working evidence rows for that definition                                        → 1 → 0
operator   → DELETE /api/task-templates/:id                                      → 403 (fail-closed control)
```

**Classification.** A pre-existing guard-completeness defect: the capability model governed the
*route*, while the cascade performed the *act*. It was not a regression introduced by PR #78.

---

## 3. Ratified authority for the correction

The remedy is not a new policy. It applies an already-ratified rule to one more operation:

| Source | What it establishes |
|---|---|
| **ATM-001 M3** — "Model mutation surface" | `BaseModel` supplies generic `update()`/`delete()` helpers; *"Inheriting them would advertise mutations the database forbids"* — and the sanctioned removal path for working evidence is the **tenant-scoped detach operation**, not an incidental cascade |
| **ATM-001 M3** — "Frozen evidence boundary" | Working evidence is *"mutable while working"* and reachable **only** through attach / list / **detach**; detach is permitted only while the evidence is unfrozen |
| **ATM-001 K3‑G2** §5.2 / §6 | `evidence.attach` governs the **working-evidence citation lifecycle, including detachment**; the legacy supervisor is **denied** the evidence acts (route-accurate) |
| **ATM-003‑R1 §3.1** | `evidence.attach` — *"Attach provenance evidence to a definition or step"* — is a distinct accountable act with its own attribution column (`added_by_user_id`) |
| **Existing implementation precedent** | The governed authoring primitive already refuses a step-set replacement over attached evidence with `STEP_EVIDENCE_PRESENT`: *"detach that evidence explicitly before replacing the step set, so provenance is never removed silently"* (`src/services/knowledge-authoring.service.js`) |

The correction is therefore the **same rule, applied to whole-definition deletion**: working evidence is
never removed silently, and the only sanctioned removal path is the one governed by `evidence.attach`.

**No new capability, role bundle, migration or business rule is introduced.**

---

## 4. The implemented rule

> **A definition deletion is refused while working provenance evidence is attached to the definition or
> to any of its steps. The caller must detach that evidence explicitly first, which requires
> `evidence.attach`. A `knowledge.author`-only principal therefore cannot destroy provenance.**

| Change | File |
|---|---|
| `TaskTemplate.countWorkingEvidence(templateId)` — counts working evidence bound directly to the definition **or** to any of its steps | `src/models/task-template.model.js` |
| `TaskTemplate.deleteIfEditable(id)` — locks the definition row **and its step rows** (`SELECT … FOR UPDATE` each), counts, then deletes **in one transaction**, refusing with `code = 'EVIDENCE_PRESENT'` before any mutation | `src/models/task-template.model.js` |
| Controller maps the refusal to **HTTP 409** `{ success: false, code: 'EVIDENCE_PRESENT', message }` | `src/controllers/task-template.controller.js` |
| New security suite A–J, R12 | `tests/knowledge-evidence-deletion-integrity.test.js` |
| Suite registration in the sanctioned runner and the database-test safety guard | `scripts/run-integration-tests.js`, `tests/database-test-guard.test.js` |

The guard sits at the **model operation**, not at the route, so authorization covers the operation's
effect. It mirrors the existing `STEP_EVIDENCE_PRESENT` precedent in both placement and intent.

The guard, the count and the deletion are **one atomic unit**, using the repository's existing
`getConnection()` transaction idiom (the same pattern the crosswalk model uses so that "their validation
and their write are one atomic unit"). The transaction locks **every subject the guard counts**: the
definition row *and* the rows of its steps. Each `SELECT … FOR UPDATE` conflicts with the `FOR KEY
SHARE` lock an attaching transaction takes for its own foreign-key check, so a concurrent
`evidence.attach` either commits before the count (and is seen, refusing the deletion) or blocks until
after the deletion (and then fails its own foreign key).

Both subjects are required: a template-level attachment locks the *definition* row, while a step-level
attachment locks the *step* row — so a definition-only lock would leave step-level evidence
unserialised. A count-then-delete with no lock at all was demonstrated during this mission to cascade a
concurrently-committed attachment away; the definition lock closed the template-level case, and an
independent adversarial review then falsified the narrower step-level case (finding F‑ADV‑1), which the
step-row lock closes. Both are now regression-protected (§7 R‑1, §8).

### 4.1 Behaviour change

| Operation | Before | After |
|---|---|---|
| Delete an **evidence-free** draft definition | 200 | **200 (unchanged)** |
| Delete a draft definition **with working evidence**, caller holds `knowledge.author` only | 200, evidence destroyed by cascade | **409 `EVIDENCE_PRESENT`**, nothing mutated |
| Delete a draft definition with working evidence, caller holds **both** capabilities | 200, evidence destroyed by cascade | **200 after an explicit detach** (detach requires `evidence.attach`) |
| Direct evidence detach without `evidence.attach` | 403 | **403 (unchanged)** |

The change is a **sequence requirement on a destructive operation**, not a new permission: no principal
gains or loses a capability, and every capability'd workflow is still completable by a principal that
holds the capabilities the ratified architecture assigns to it. The extra step (detach, then delete) is
exactly the step the codebase already requires for step-set replacement.

---

### 4.2 Complete deletion-surface enumeration

Every `DELETE` statement in `src/` that touches a knowledge definition, its steps or its evidence —
verified by exhaustive search, not by assumption:

| # | Statement | Can it remove working evidence? | Authorization |
|---|---|---|---|
| 1 | `DELETE FROM knowledge_template_evidence` — `src/models/knowledge-provenance.model.js` | **Yes, by design** — this *is* the detach | `evidence.attach` (route guard) + tenant/template binding (model) |
| 2 | `DELETE FROM task_templates` — `src/models/task-template.model.js` | **Yes, by cascade** — the F‑1 path | `knowledge.author` + the new atomic evidence guard (§4) |
| 3 | `DELETE FROM task_template_steps` — `src/services/knowledge-authoring.service.js` | **Yes, by cascade** — but refused when attached evidence exists (`STEP_EVIDENCE_PRESENT`) | Not HTTP-exposed (test-only authoring primitive); guard already present |
| 4 | `DELETE FROM knowledge_pack_version_task_template_versions` — `src/models/knowledge-pack.model.js` | **No** — removes a pack membership row; the dependency runs the other way (`membership → task_template_versions`), so no version or evidence is deleted | `TASKS.UPDATE` (pack draft surface) |
| 5 | `DELETE FROM task_template_safety_controls` — `src/services/knowledge-authoring.service.js` | **No** — no evidence foreign key references safety controls (M6.4 §11 **G2**) | Not HTTP-exposed |
| 6 | `DELETE FROM task_template_equipment_types` — `src/services/knowledge-authoring.service.js` | **No** — applicability carries no evidence row (G2) | Not HTTP-exposed |

Crosswalk evidence (`equipment_type_external_classification_evidence`) is a **different table** in a
different domain and cannot remove provenance evidence; it is noted separately as an unmapped
capability seam (KF‑01 finding F‑8), not as a bypass of this boundary.

**Conclusion:** after this change, the only reachable paths that can remove working provenance evidence
are the governed detach (path 1) and a definition deletion (path 2) — and path 2 is now governed by the
same `evidence.attach` authority because it refuses while evidence is attached.

## 5. What deliberately does not change

- **Capability vocabulary** (21) and **human-grantable set** (18) — unchanged.
- **Legacy bundles** operator 2 / supervisor 14 / admin 16 — unchanged; `knowledge.author` still does
  **not** imply `evidence.attach`, and `evidence.attach` remains admin-only by bundle.
- **No migration, no schema change**: the cascade foreign keys are untouched. Removing or relaxing
  `ON DELETE CASCADE` was explicitly considered and rejected (§6).
- **Tenant isolation** and **global write protection** — unchanged and re-verified.
- **Published/frozen immutability** — unchanged; frozen evidence remains protected by its immutability
  trigger and the `copied_from` `ON DELETE RESTRICT` linkage.
- **Approval / publication separation of duties** — unchanged.
- **Route guard** `DELETE /api/task-templates/:id` remains `requireCapability('knowledge.author')`; the
  route is not re-guarded, because deleting a definition is an authoring act.

---

## 6. Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| **Change the evidence foreign keys to `ON DELETE RESTRICT`** | Requires a **migration** (schema change) and alters the deletion semantics of every dependent table. The database already protects frozen data; the gap was the application's failure to apply the ratified detach rule, so the smallest architecture-correct fix is in the operation, not the schema |
| **Add `evidence.attach` to the template-delete route guard** | Would prevent a `knowledge.author` principal from deleting **any** draft, including evidence-free ones, changing approved authoring semantics (definition deletion is an authoring act). It also cannot express "only when evidence exists" |
| **Delete the evidence rows inside the delete operation instead** | Directly contrary to M3: the only sanctioned removal path is the tenant-scoped detach operation, which carries attribution and the tenant/template binding |
| **Add it to each legacy bundle** | Contradicts ATM-003‑R3 §3/§4 and the OWNER adjudication of 2026‑09‑27 §7 ("do not silently grant an existing role an action it could not previously perform") |
| **Guard without a transaction (count, then delete)** | Leaves a demonstrated concurrency window in which a concurrent attachment commit is cascaded away after the count (§7 R‑1). Rejected once the window was reproduced; the row lock closes it without a migration |
| **Do nothing / document only** | Leaves a reproducible authorization bypass of a deliberately withheld capability |

---

## 7. Residual risk (recorded, not hidden)

| # | Residual | Assessment | Disposition |
|---|---|---|---|
| R‑1 | **Concurrency window (TOCTOU)** — *closed for both subjects* | Two variants were demonstrated against earlier revisions: (a) a concurrently-committed **template-level** attachment was cascaded away after the guard counted zero (HTTP 200, evidence destroyed); (b) after the definition lock was added, an independent adversarial review falsified the narrower **step-level** variant — an uncommitted step-level attachment holds `FOR KEY SHARE` on the *step* row, which the definition lock does not cover (HTTP 200, evidence destroyed). **Both are closed** by locking the definition row *and its step rows* inside the same transaction as the count and delete; both probes now return **409 `EVIDENCE_PRESENT`** with definition, steps and evidence intact. | **CLOSED.** Regression-protected by `R13` (template-level) and `R14` (step-level), each a deterministic two-connection interleaving that FAILS when the corresponding lock is removed. No migration required. |
| R‑2 | **Guards are application-layer.** `BaseModel.delete` remains a lower-level primitive, and the CLI seed-rollback utility `database/seeds/rollback-step3.js` deletes seeded templates with raw SQL (`seed_batch_id`-scoped), outside the application path. | CLI-only utilities require database credentials and are not HTTP-reachable; they are not a tenant-facing path. Consistent with KF‑01 finding F‑7. | Recorded. A database-level guard (a `BEFORE DELETE` trigger on `task_templates`) would additionally cover CLI raw-SQL paths, and remains available as a bounded follow-up if governance wants that defence-in-depth. |
| R‑3 | **Deleting a definition that has a published version but no working evidence** is refused by the existing `task_template_versions` immutability trigger, surfaced through the generic error handler as a **500** rather than a clean `409`. | **Pre-existing**, unrelated to F‑1 and untouched by this change. Published knowledge is still immutable and nothing is destroyed (verified in test G). | Recorded as a NIT; a candidate for a separate bounded error-mapping mission. |
| R‑4 | **A losing concurrent `evidence.attach` answers 500** with a raw database message (the `fk_knowledge_template_evidence_template` constraint name, or a migration‑011 trigger message) instead of a clean 4xx. | **Pre-existing**: an attachment racing a committed definition deletion always failed its foreign key. The new lock makes the deletion win deterministically, so the losing attach surfaces more reliably. Integrity is unaffected (no evidence is ever created in that interleaving). | Recorded as a MINOR error-contract issue; mapping foreign-key refusals on the provenance attach path to a clean 404/409 is a separate bounded change and was **not** made here (scope discipline). |
| R‑5 | **`fk_knowledge_template_evidence_source_version` is `ON DELETE CASCADE`** (verified live: `confdeltype = 'c'`), so deleting a `knowledge_source_version` would destroy working evidence with no `evidence.attach` guard. | **Latent and unreachable today**: no route, controller or model method deletes a source or a source version — the provenance models override `update`/`delete` to refuse (M3), and exhaustive search finds no `DELETE` against `knowledge_sources` / `knowledge_source_versions` in `src/`. The guard implemented here is definition-scoped only. | Recorded. If a source/version deletion capability is ever added, it must apply the same rule. |
| R‑6 | `deleteIfEditable` returns `false` if the definition vanished after the controller's `findById`, but `remove` ignores the return value and still answers **200 "deleted successfully"**. | **Pre-existing** shape, now reachable through two concurrent deletes. No unauthorized destruction; the response is merely optimistic about a no-op. | Recorded as a NIT. |


---

## 8. Verification evidence

| Check | Result |
|---|---|
| New KF‑06 suite (A–J, R12, R13, R14) **after** the fix | **17/17 pass, 0 fail** |
| Concurrency probe — template-level (two connections, uncommitted attachment) **before** the row lock | **R‑1(a) reproduced**: HTTP 200, evidence cascaded to 0 |
| Concurrency probe — step-level **before** the step lock | **R‑1(b) reproduced** (adversarial finding F‑ADV‑1): HTTP 200, evidence cascaded to 0 |
| Mutation test: `R13` with the definition lock removed | `R13` FAILS (`got 200 … deleted successfully`) → the test genuinely protects the window |
| Mutation test: `R14` with the step lock removed | `R14` FAILS (`got 200 … deleted successfully`) → the test genuinely protects the window |
| Same probes **after** the locks | **R‑1(a) and R‑1(b) not reproducible**: HTTP 409 `EVIDENCE_PRESENT`, definition, steps and evidence intact |
| New KF‑06 suite **before** the fix (fix stashed, tests unchanged) | **exactly B, B2, C, G2, J fail** — the suite genuinely detects the defect; A, D, D2, E, F, G, H, I, R12 pass before and after, proving preserved behaviour |
| Sanctioned integration suite (26 suites — 25 prior + KF‑06, parallel, fresh disposable PostgreSQL) | **915/915 pass, 0 fail, exit 0** (was 898/898 before this suite) |
| `npm test` (non-destructive; includes the new suite's guard checks ×3) | **162/162 pass, 0 fail, exit 0** (was 159/159) |
| Schema | canonical runner applied **23/23**; **no migration added** |

---

#### 8.0 Parallel-suite determinism observation (pre-existing, unrelated to this change)

One of the integration executions reported **914/915** with a single failure: a PostgreSQL **deadlock** in
`tests/knowledge-pack-membership.test.js` ("allows INSERT while the pack version is under_review"). The
server-reported cycle names `knowledge_pack_membership_guard()` holding/awaiting `FOR SHARE` on
`knowledge_pack_versions` and a concurrent **`ALTER TABLE task_template_versions`** from
`tests/migration-runner.test.js` awaiting `AccessExclusiveLock`.

**This change is not part of that cycle.** KF‑06 takes no `AccessExclusiveLock` anywhere, and its locks
(`task_templates`, `task_template_steps`) appear in neither side of the reported deadlock. Two subsequent
full executions on the same revision were **915/915, 0 fail, 0 deadlocks**. This is the intermittent
parallel-execution hazard already recorded as **KF‑01 finding F‑3** (a red `main` that turned green with
no code change, plus a deadlock observed in an earlier run): the sanctioned runner executes all suites in
one `node --test` invocation against one database, so a suite that takes DDL locks can collide with a
suite that takes row locks. It is recorded here rather than silently discarded, and it is a candidate for
the bounded CI-determinism review recommended by KF‑01.

### 8.1 Adversarial verification and its disposition

A **separate-context adversarial reviewer** (independent tooling, its own disposable database,
instructed to falsify the fix) attacked the change with 13 attack classes plus mutation testing of the
suite. Its results, dispositioned here:

| Adversarial result | Disposition |
|---|---|
| Core claim: no `knowledge.author`-only principal can destroy working evidence through the API | **Survived** — attacks S1, S3, S4–S13 all NOT POSSIBLE |
| **F‑ADV‑1 (MAJOR, latent)** — step-level TOCTOU: the definition-row lock does not cover the step rows, so a concurrent step-level attachment could still be cascaded away | **ACCEPTED and FIXED**: the transaction now also locks the step rows; regression test `R14` added and mutation-verified (§7 R‑1) |
| F‑ADV‑2 (MINOR) — the atomicity claim generalised "an attaching transaction" while only the template subject was tested | **ACCEPTED**: `R14` now covers the step subject and §4/§7 state both |
| F‑ADV‑3 (MINOR) — a losing concurrent attach returns 500 with a raw constraint name | **ACCEPTED as recorded residual R‑4**; not fixed (error-contract change outside F‑1 scope) |
| F‑ADV‑4 (MINOR, latent) — `fk_knowledge_template_evidence_source_version` is `ON DELETE CASCADE` | **ACCEPTED as recorded residual R‑5**; unreachable today, flagged for any future source/version deletion capability |
| F‑ADV‑5 (NIT) — a vanished definition still answers 200 | **ACCEPTED as recorded residual R‑6** |
| F‑ADV‑6 (INFO) — crosswalk evidence is a different table/domain, not a bypass | Noted; consistent with KF‑01 F‑8 |
| Mutation testing: the suite fails appropriately with the fix removed | **Confirms the tests are non-vacuous** (§8) |

**Independence statement.** This was a separate agent context, **not** an independent review *mission*
and not a human independent reviewer. Formal VUDA independence remains **PENDING**; no independent
acceptance is claimed.

## 9. What this record does not do

It does not merge, deploy, alter production, change a capability or bundle, change the database schema,
or modify PR #27 or PR #79. It records one bounded authorization-integrity correction and the residual
risks that remain.
