# ATM-001-KF-01 — Post-Merge Verification and Knowledge Foundation Closure Reconciliation

**Document ID:** ATM-001-KF-01
**Mission:** ATIMAN-KF-01/02 — Knowledge Foundation Closure and Engineering Evidence Qualification
**Status:** Verification and reconciliation record. **Authorises no implementation, no deployment, no migration, no publication.**
**Revision:** 1.1 — dated KF-06 remediation reconciliation appended (§18). Revision 1.0 verified PR #78 at `988fbb99…`.
**Verification date:** 2026-10-10
**KF-06 reconciliation date:** 2026-10-10
**Subject:** PR #78 — ATM-001-K3 Knowledge Accession Authority — and its effect on the ATM-001 V1 closure records; reconciled against merged PR #80 (KF-06).

---

## 1. Purpose and boundary

This record verifies, independently and reproducibly, that PR #78 merged correctly, that the
OWNER-approved authorization mapping survived the merge, that no protection was weakened, and that the
existing Knowledge Foundation closure records still describe the repository truthfully after the merge.

It also records the **production deployment status** honestly: it is **not** verifiable from repository
or GitHub evidence, and it is therefore recorded as `PRODUCTION_STATUS_UNVERIFIED` rather than assumed.

**Boundary.** Read-only verification plus documentation. No merge, no deployment, no production
mutation, no migration, no application-code change, no runtime-authorization change, no test changed,
and no change to PR #27.

---

## 2. Repository baseline

| Item | Value |
|---|---|
| Repository | `Lihok-Technologies/atiman-platform` |
| Branch (mission) | `atm-kf-01-02-knowledge-closure-and-kgv-evidence`, created from `origin/main` |
| `origin/main` (verified) | `988fbb99f31737dbc8f6050511964091e7962ce0` — revision-1.0 baseline; `main` has since advanced to `bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e` (merge of PR #80, KF-06). See §18 |
| Merge commit tree | `ce32efdd201b7fd89db52ca31461ea95755b582a` |
| PR #78 head | `db0de82d63184d6929bb7a331779ac1ffaf982a6` |
| Pre-merge `main` | `54ee2094c7b7ddbfeb2e7d7f2bb5855014382bc2` |
| Working tree at verification start | clean (`git status --porcelain` → 0 entries) |
| Migration endpoint | `023_asset_observations.sql` (chain 001–023, forward-only) |

---

## 3. PR #78 post-merge verification — **PASS**

| Check | Result |
|---|---|
| PR state | **MERGED** (`state: MERGED`) |
| Merge commit | `988fbb99f31737dbc8f6050511964091e7962ce0` — **matches the expected merge commit** |
| Merged at | `2026-10-09T23:19:49Z`, by `estrangender26` |
| Merge parents | `54ee2094…` (pre-merge `main`) **and** `db0de82…` (PR head) — a true two-parent merge commit |
| Merge commit in `main` history | `988fbb99…` was the tip of `origin/main` at revision 1.0; PR head `db0de82…` is an **ancestor** of `origin/main` (main has since advanced to `bfa18c7…` — see §18) |
| **Merge integrity (strongest available check)** | The merge commit tree is `ce32efdd…`, which is **byte-identical to the PR head tree**. A merge that resolves no conflicts and introduces no content change cannot have silently altered the reviewed code |
| Diff introduced by the merge | `git diff 54ee2094 988fbb99` = **9 files, +1,667 / −29**, exactly the reviewed PR #78 diff |

**No target drift and no merge-time content change.**

---

## 4. Authorization mapping survived the merge — **PASS**

Verified by reading the route file **at the merge commit** (`git show 988fbb99:src/routes/knowledge-provenance.routes.js`), not from any summary:

| Route | Guard on merged `main` | Expected |
|---|---|---|
| `POST /api/knowledge-provenance/sources` | `requireCapability('knowledge.author')` | `knowledge.author` ✅ |
| `POST /api/knowledge-provenance/sources/:id/versions` | `requireCapability('knowledge.author')` | `knowledge.author` ✅ |
| `POST /api/knowledge-provenance/templates/:templateId/evidence` | `requireCapability('evidence.attach')` | `evidence.attach` ✅ |
| `DELETE /api/knowledge-provenance/templates/:templateId/evidence/:evidenceId` | `requireCapability('evidence.attach')` | `evidence.attach` ✅ |
| `GET /sources`, `GET /sources/:id/versions`, `GET /templates/:templateId/evidence` | `requirePermission('KNOWLEDGE','VIEW')` ×3 | unchanged ✅ |

Guard census: exactly **2 × `knowledge.author`**, **2 × `evidence.attach`**, **3 × `KNOWLEDGE.VIEW`**, and **no `TASKS.*` guard** remains on this surface.

Independently corroborated at runtime: the full sanctioned suite (898/898) and focused suites
(accessions 16/16, provenance authoring 46/46, write scope 17/17, capability grants 63/63) exercise each
mapping behaviourally, and an independent adversarial probe (45 checks, own database and fixtures) found
`knowledge.author`-only holders refused on the evidence routes and `evidence.attach`-only holders refused
on the authoring routes.

### 4.1 Effect-level completeness — **NOT fully satisfied (finding F-1, MAJOR)**

The mapping is **route-complete** but **not effect-complete**. Adversarial verification found, and this
mission **independently reproduced**, a transitive path by which a principal deliberately denied
`evidence.attach` can still destroy working provenance evidence:

| Observation | Result |
|---|---|
| Supervisor (legacy bundle: `knowledge.author`, **no** `evidence.attach`) calls `DELETE /api/knowledge-provenance/templates/:id/evidence/:evidenceId` | **403** — `"Access denied: evidence.attach is required for this action"` ✅ correct |
| Evidence rows after that denial | **1** — no row removed ✅ correct |
| **The same supervisor** calls `DELETE /api/task-templates/:id` (guarded by `requireCapability('knowledge.author')`, `src/routes/task-template.routes.js:109`) | **200** — `"Task template deleted successfully"` |
| Evidence rows after the template deletion | **0** ❌ **working evidence destroyed without `evidence.attach`** |
| Control: operator (neither capability) calling the same delete | **403** (fail-closed) |

**Mechanism.** `fk_knowledge_template_evidence_template` is `ON DELETE CASCADE`
(`database/postgresql/011_knowledge_provenance.sql`), and there is no `BEFORE DELETE` guard on
`task_templates`. `TaskTemplate.deleteIfEditable` refuses only *system* templates
(`src/models/task-template.model.js`), so deleting a tenant-owned draft definition silently removes its
working evidence rows. The repository already contains the analogous guard for the *step* case —
`STEP_EVIDENCE_PRESENT` (`src/services/knowledge-authoring.service.js`, tested in
`tests/knowledge-authoring.test.js`) — but no equivalent exists for template deletion.

**Assessment.**

- **Class: MAJOR (guard completeness).** A capability the ratified compatibility register deliberately
  withholds from the supervisor (`evidence.attach`, ATM-003-R3 §4) is reachable **in effect**: the
  supervisor is refused the detach route and then destroys the same evidence by deleting its parent
  definition. The K3-G2 record's §6 statement that a legacy supervisor is "denied" the evidence acts is
  accurate **for the four mapped routes** and incomplete **for the effect**.
- **Not a regression.** The structure pre-dates the capability model: before K3 the evidence routes were
  `TASKS.*` (admin-only) and template deletion was `requireAdmin` (admin **or** supervisor), so a
  supervisor could already destroy working evidence transitively while being denied the evidence routes.
  PR #78 neither created nor widened this path, and it changed no template-delete code.
- **Security impact is bounded.** It requires `knowledge.author` — the same capability that already
  permits deleting the definition itself; it affects only **working** (draft, mutable-by-design)
  evidence; frozen/published evidence is protected by `knowledge_template_version_evidence` immutability
  triggers and `ON DELETE RESTRICT` linkage; no tenant boundary is crossed and no data is disclosed.
- **Remediation is deliberately NOT performed here.** It requires an **application-code change**, which
  this mission is not authorised to make; per the mission's implementation boundary the defect is
  reproduced, documented, assessed and referred to a bounded remediation mission (**KF-06**, §17).

---

## 5. Capability vocabulary and bundles — **PASS (unchanged)**

| Check | Result |
|---|---|
| `src/config/capabilities.js` changed by the merge? | **No** — `git diff 54ee2094 988fbb99 -- src/config/capabilities.js` is empty |
| `database/` changed by the merge? | **No** |
| Capability vocabulary size | 21 (unchanged) |
| V1 human-grantable set | 18 (unchanged; `knowledge.author` and `evidence.attach` both grantable) |
| Non-human-grantable set | 3 (unchanged) |
| Legacy bundles | operator **2**, supervisor **14**, admin **16** — unchanged; `evidence.attach` present in **admin** only, **absent** from supervisor and operator |
| New capability introduced? | **None** |

---

## 6. Global provenance write protection and tenant isolation — **PASS**

| Property | Evidence |
|---|---|
| A tenant cannot author an edition into a **global** (`organization_id IS NULL`) source | `409 SOURCE_NOT_TENANT_WRITABLE`; global lineage count unchanged; the strict write predicate `findTenantWritableSourceById` is separate from the global-inclusive read predicate |
| A tenant **can** read and cite an existing global edition | Citation succeeds; global source/lineage snapshot is byte-identical afterwards |
| A tenant cannot author into another tenant's lineage | Non-disclosing `404`; foreign lineage unchanged |
| Cross-tenant evidence attach/detach | Non-disclosing `404`; no row written, no row removed |
| Request-body spoofing of `organizationId` / attribution | Ignored — tenant and attribution derive from the session |

This is the repaired **ATM-001-K3-R1 MAJOR-1** defect, re-verified **after** the merge.

---

## 7. Approval and publication separation of duties — **PASS (unchanged)**

- `chk_task_template_versions_approver_not_publisher` remains present; published versions require
  reviewer, approver, safety attestation **and** publisher, with approver ≠ publisher.
- The post-merge code confers **no** `knowledge.review`, `knowledge.approve`, `knowledge.safety_review`
  or `knowledge.publish` authority through `knowledge.author` or `evidence.attach` (verified
  behaviourally: a principal holding both provenance capabilities is refused on all six governed
  task-template lifecycle routes).
- Immutability guard inventory at this revision: **14 immutability triggers** (the V1 ledger recorded 13;
  the additional guard is `trg_user_capabilities_immutable` from migration 022), plus the deferred
  database-level publication-admission constraint trigger.

---

## 8. Migration chain — **PASS**

| Check | Result |
|---|---|
| Numbered migrations on merged `main` | **23** (`001` … `023`) |
| Endpoint | **`023_asset_observations.sql`** |
| Migration `024` present? | **No** (0 files, 0 tracked paths) |
| Canonical runner against a freshly created disposable PostgreSQL database | **23/23 applied**; `SUCCESS: 23/23 migration(s) applied.` |
| Schema readiness (`scripts/smoke-test-pg.js`) | **PASSED** — 87 base tables, 6 views; 9 required tables, 8 required columns, 4 required constraints, 1 required guard function, membership guard triggers, publisher FKs all present |

The PR #78 merge added **no** migration, so no schema change was deployed by this merge.

---

## 9. PR #27 preservation — **PASS**

| Check | Result |
|---|---|
| PR #27 state | **OPEN** |
| Head | `a8511bcdbe41a40f4656ce79d1a6224d3d1e55cb` — **unchanged** (`refs/pull/27/head` identical before and after) |
| Last updated | `2026-09-22T04:08:08Z` — predates the PR #78 merge |
| Mergeability | `CONFLICTING` (its own pre-existing state; not caused by this mission) |
| Files unique to PR #27 | `database/postgresql/013_finding_assessment.sql`, `src/config/permissions.js`, `src/controllers/finding-assessment.controller.js`, `src/models/finding-assessment.model.js`, `src/models/finding.model.js`, `src/models/index.js`, `src/routes/finding.routes.js`, `tests/finding-assessment.test.js` — **none touched** by PR #78 or by this mission |
| Shared files | `scripts/run-integration-tests.js` and `tests/database-test-guard.test.js`. PR #78 adds **its own** suite registrations additively; it does not remove or rewrite PR #27's future registration. Whichever PR lands second must reconcile the two lists |

---

## 10. Production deployment status — **`PRODUCTION_STATUS_UNVERIFIED`**

Production deployment was investigated **read-only**. Nothing was changed, restarted or reconfigured.

### 10.1 What is established

| Finding | Evidence |
|---|---|
| Production deployment is **configured to be automatic on merge** | `render.yaml`: `autoDeploy: true`, `branch: main`, `preDeployCommand: npm run db:migrate:postgres && node scripts/smoke-test-pg.js`, health check `/health` |
| Deployment is authorised by merge, per the ratified deployment policy | `DEPLOYMENT_CLOUD.md` §"An approved merge to `main` is the production deployment authorization event… Auto-Deploy is intentionally enabled" |
| A production service is **live** | `GET https://atiman-api.onrender.com/health` → **HTTP 200** at `2026-10-09T23:27:08Z`, body `{"success":true,"message":"API is running","timestamp":"2026-10-09T23:27:08.535Z"}`, served via Cloudflare with `x-render-origin-server: Render` |
| The merge therefore **plausibly** triggered a deployment | The health response was observed ≈7 minutes after the merge |

### 10.2 What is **not** established

| Missing evidence | Why it matters |
|---|---|
| **The deployed revision identity** | The `/health` endpoint returns no commit SHA or build identifier, and no repository artifact records a deployed revision for the post-merge code. There is **no evidence** that revision `988fbb99…` (or `db0de82…`) is the revision running in production |
| Any Render deployment record | `render.yaml` is a repository blueprint; the Render control plane is not visible from GitHub. **17 GitHub deployment records exist, all from Railway, all dated 2026-03-19** — pre-dating the current architecture by months. **Zero deployments exist after 2026-10-01** |
| Any automated deployment workflow | The only workflow is `.github/workflows/db-integration.yml`, which performs **validation only** and contains no deploy step or deployment action |
| Production schema/corpus state | No production database was read in this mission |

### 10.3 Determination

> **`PRODUCTION_STATUS_UNVERIFIED`.**
>
> Production is **live**, and the merge is **expected** to have deployed by ratified policy, but the
> **deployed revision cannot be identified** from available evidence, and no production database or
> deployment record was read. **No production acceptance is claimed for revision `988fbb99…`.**
>
> Verifying this requires an authorised read-only production reconciliation (see §15.3 finding **F-5**,
> recommended mission KF-05). No guess is recorded in place of evidence.
>
> **Reconciliation note (revision 1.1).** This determination is unchanged for the current revision. The
> production health endpoint was re-probed live at the KF-06 merge and still exposes **no revision
> identity**; the deployed revision remains unidentified and `PRODUCTION_STATUS_UNVERIFIED` (see §18.4).
> Stale cross-reference corrected at revision 1.1: the original text cited a non-existent "§13.6".

**Risk note (not a finding against PR #78).** Because Auto-Deploy runs `db:migrate:postgres` on every
merge, an unverified deployment is also an unverified migration execution. For **this** merge the risk is
bounded: PR #78 added no migration and the endpoint remains 023, so a deployment of this merge would
re-apply an unchanged migration set.

---

## 11. CI verification — **PASS**

| Item | Result |
|---|---|
| Run | `38003870422` — "PostgreSQL Integration Validation" |
| Event / branch / SHA | `push` / `main` / `988fbb99f31737dbc8f6050511964091e7962ce0` |
| Conclusion | **success** (created `2026-10-09T23:19:51Z`, finished `2026-10-09T23:26:23Z`) |
| Pre-merge comparison | The immediately preceding `main` push (`54ee2094…`, run `36325743505`) had concluded **failure**: `# tests 863, # pass 862, # fail 1` — one failing assertion in the Knowledge Pack Membership suite ("ON DELETE RESTRICT prevents deleting a pack version that has members") |

**Reconciliation of the red-to-green transition (recorded, not explained away).**

- The failing run was on the **pre-merge** `main` revision; the merge commit's run is **green**.
- PR #78 changed no Knowledge Pack code, no pack test, and no migration, so it did not "fix" that
  assertion by changing behaviour.
- The same assertion **passes** in this mission's independent runs on the identical tree (part of
  898/898 in the sanctioned suite, and in `npm test`), and it passed in the implementing engineer's
  recorded runs.
- The most consistent available explanation is a **parallel-execution / shared-fixture flake** under the
  single-invocation runner, not a repaired defect. This is recorded as an **observation to monitor**
  (finding F-3), not as a resolved fact, because a red `main` that turns green without a corresponding
  code change is a CI-integrity signal that deserves tracking rather than silent acceptance.

---

## 12. Test evidence on the merged revision

| Suite | Expected (implementer) | **Actual, independently executed on the merged tree** |
|---|---|---|
| Focused authorization (`knowledge-accession-authority`) | 16/16 | **16/16**, 0 fail |
| Provenance authoring (`knowledge-provenance-authoring`) | 46/46 | **46/46**, 0 fail |
| Global-write protection (`provenance-write-scope`) | 17/17 | **17/17**, 0 fail |
| Capability parity (`capability-grants`) | 63/63 | **63/63**, 0 fail |
| Full sanctioned integration (25 suites, parallel) | 898/898 | **898/898**, 0 fail, 0 skipped |
| `npm test` | 159/159 | **159/159**, 0 fail |
| Independent adversarial probe (own DB, own fixtures) | — | **45/45**, exit 0 |

Environment: disposable PostgreSQL **16.14** (the implementer's reference used 17), schema applied via
the canonical runner (23/23) and asserted by the readiness smoke test. All reference totals reproduced.

**Repeat-run observation (recorded, supports finding F-3).** The sanctioned suite was executed twice on
the identical merged tree. The first execution's output contained a **PostgreSQL deadlock report**
(`deadlock.c`); its summary line was not captured because the shell pipeline masked the runner's exit
code. The clean re-run (fresh database, canonical migrations, exit code captured directly) produced
**898/898, 0 fail, 0 `not ok`, 0 deadlock mentions, exit 0**. Two runs, one deadlock, one clean — on the
same code. This corroborates the parallel-execution nondeterminism recorded at F-3 and is **not** a
failure of the merged code.

**Relation attribution added at reconciliation (revision 1.1).** The later independent KF-06 review
observed the same class of deadlock and mapped its cycle to concrete relations:
`knowledge_pack_membership_guard()` awaiting a `RowShareLock` on **`knowledge_pack_versions`** against a
concurrent `AccessExclusiveLock` on **`knowledge_pack_version_task_template_versions`**. Neither relation
belongs to the KF-06 change (whose tables are `task_templates` and `task_template_steps`), which is further
evidence that the intermittent parallel-execution nondeterminism is a pre-existing shared-runner hazard,
not a defect in either merged change. The finding remains open as F-3.

---

## 13. Closure-record reconciliation (KF-01 task N)

The V1 closure ledger (`ATM-001-Knowledge-Foundation-Closure-Ledger.md`) declares ATM-001 V1 **COMPLETE**
at baseline `922a0405f3bbfa52d2d34d46368912c3295eea94` with **migration endpoint 021**. The repository has
since advanced. This section reconciles the ledger's statements against verified repository evidence; it
does **not** edit the ledger (its completion record is an OWNER decision recorded there, and its baseline
remains historically accurate).

### 13.1 What changed after the ledger baseline

| Change | Evidence |
|---|---|
| **49 commits across 23 merges** landed between `922a0405…` and `988fbb99…` | `git rev-list --count` = 49; `git rev-list --count --merges` = 23; merges PR **#56 … #78** |
| **Two migrations added:** `022_capability_grant_foundation.sql`, `023_asset_observations.sql` | `git diff --name-only 922a0405 988fbb99 -- database/postgresql/` |
| Migration endpoint moved **021 → 023** | verified on merged `main` |
| ATM-003 capability model implemented (migrations, resolver, middleware, bundles) | PRs #68–#71; `src/config/capabilities.js`, `src/services/capability.service.js`, `src/middleware/capability.middleware.js` |
| ATM-002 experience/operational work merged (shell, observations, asset context, report capture) | PRs #74–#77 |
| **ATM-001-K3 / K3-R1 / K3-G2** merged | PR #78 — provenance mutation authority moved to capabilities; MAJOR-1 global-write defect repaired; evidence routes re-mapped to `evidence.attach` |

### 13.2 Ledger statements that remain true

- The V1 **completion judgement** for the ATM-001 governance boundary (identity, provenance, authoring,
  review, safety, approval, versioning, immutable publication, packs, AI disclosure, legacy protection)
  is **not contradicted** by any evidence found in this mission.
- The four OWNER-adjudicated governed deferrals and the recorded deferrals (§3, §4, §4a–§4c) remain
  unchanged in the repository.
- The ledger's recorded production corpus at its own baseline is not contradicted; it is simply **not
  re-verifiable** in this mission (no production access).

### 13.3 Ledger statements that are now **stale or superseded** (require a dated addendum, not a rewrite)

| # | Ledger statement | Current verified truth |
|---|---|---|
| S-1 | "Migration endpoint: `021_ai_assistance_disclosure.sql`" (§9, and the header) | Endpoint is now **023**. Migrations 022 and 023 were added by later, separately authorised missions |
| S-2 | "Accepted production revision `922a0405…`" (§9) | That revision is no longer the tip of `main`, and the **currently deployed revision is unverifiable** (`PRODUCTION_STATUS_UNVERIFIED`, §10) |
| S-3 | §6 gate totals: "sanctioned native PostgreSQL integration 680/680 · `npm test` 138/138" | Superseded: **898/898** and **159/159** at this revision |
| S-4 | §6 "13 immutability guards" | **14** immutability triggers at this revision (adds `trg_user_capabilities_immutable`, migration 022) |
| S-5 | §2 row 3 (M3 governed provenance authoring) records completion with no mention of authorization surface | The provenance **mutation authority** has since changed twice (K3, then K3-G2) and the **global-write MAJOR-1 defect was repaired** (K3-R1). The M3 row's *completion* claim stands, but it no longer describes the current authorization mapping |
| S-6 | §4c: "G1 trigger has **not fired** (production: 0 authored definitions)" and "G2 trigger has not fired" | Still **true as recorded** — but the **KF-02 evidence investigation establishes that G1 is now the next live gate** for the Knife Gate Valve pilot, because the only sources that could support the procedure are rights-unresolved OEM manuals and licensed standards (`ATM-001-KF-02` §9). The ledger's statement is accurate about the corpus; it should be read with that forward-looking addendum |

### 13.4 Reconciliation verdict

The closure ledger remains a **truthful historical record of its own baseline**. It is **not** an accurate
description of the current revision in the specific respects listed in §13.3. The correct treatment is a
**dated addendum** to the closure ledger referencing this verification — consistent with the established
"record accuracy" practice (PRs #53, #54) that corrected stale claims by dated correction rather than by
rewriting history.

**Recommended bounded documentation action (not performed here to keep this PR to its three authorised
documents):** add a short addendum section to the closure ledger recording S-1 … S-6. This is proposed as
part of recommended mission **KF-05** or as a standalone record-accuracy PR. It is recorded as finding
**F-4** in §15.

---

## 14. LCQE validation (KF-01)

| LCQE check | Result |
|---|---|
| Repository integrity verification | **PASS** — clean tree, correct branch, verified SHAs, merge tree identity, no uncommitted drift |
| Documentation consistency | **PASS with findings** — the three deliverables are internally consistent and consistent with the repository; **six stale closure-ledger statements identified** (F-4) |
| Architectural compliance | **PASS** — the merged mapping matches ATM-003-R1 §3.1 and the ATM-003-R3 less-privileged mapping; the decision record is reproduced faithfully in the route documentation |
| Authorization boundary review | **PASS with one MAJOR completeness finding (F-1)** — exactly 2 + 2 + 3 guards; no new capability; no bundle change; no alternate **writer** of provenance tables outside the single provenance router; **but** definition deletion cascades working evidence without `evidence.attach` (§4.1) |
| Source traceability review | **PASS** — every claim in this record cites a SHA, a command result, a file, a test result or a CI/GitHub record |
| Evidence qualification review | **PASS (KF-02)** — see the KF-02 record §11.1 |
| Applicable regression tests | **PASS** — 898/898, 159/159, focused suites, independent probe |
| Diff inspection | **PASS** — the PR contains documentation only; verified below in §16 |
| Scope compliance | **PASS** — no code, schema, migration, capability, runtime-authorization or test change |
| Production-assumption check | **PASS** — production acceptance explicitly **not** claimed; recorded as `PRODUCTION_STATUS_UNVERIFIED` |

---

## 15. VUDA / adversarial verification (KF-01)

### 15.1 Independence statement

Adversarial verification was performed in a **separate agent context** with no inherited conversation
state, instructed to falsify the KF-01 claims and to hunt for anything the claims missed. Its results are
dispositioned below.

**This is a separate-context adversarial review — it is NOT an independent review mission and NOT a human
independent reviewer.** Formal independent VUDA acceptance for this revision is therefore recorded as
**PENDING** (acceptance register requirement 16). No independence is claimed that was not obtained.

### 15.2 Adversarial claims tested

| # | Claim put to adversarial test | Outcome |
|---|---|---|
| 1 | PR #78 merged; merge commit and its parents as stated | **Upheld** — verified independently |
| 2 | Merge tree equals PR head tree (zero merge content change) | **Upheld** |
| 3 | Route-guard mapping exactly as specified (2 + 2 + 3, no `TASKS.*`) | **Upheld** — verified by reading the file at the merge commit |
| 4 | No capability vocabulary/bundle change; bundle sizes 2/14/16 | **Upheld** |
| 5 | Migration chain ends at 023; no 024 | **Upheld** |
| 6 | PR #27 unchanged | **Upheld** |
| 7 | Merge CI green; no deployment workflow exists | **Upheld** |
| 8 | Deployed production revision is not verifiable | **Upheld** (no falsifying artifact found) |
| 9 | No alternate code path writes provenance tables outside the provenance router | **Upheld** — the only INSERT/DELETE on the provenance evidence tables and the only INSERTs on sources/editions are in `src/models/knowledge-provenance.model.js`, reachable only through the single provenance router |

### 15.3 Findings ledger

| ID | Class | Finding | Disposition |
|---|---|---|---|
| **F-1** | **MAJOR** | **Transitive working-evidence destruction defeats the `evidence.attach` mapping in effect.** A supervisor holding `knowledge.author` (and no `evidence.attach`) is refused on `DELETE …/evidence/:evidenceId` (403) yet destroys the same working evidence by deleting the draft template (`DELETE /api/task-templates/:id` → 200, `ON DELETE CASCADE`). **Independently reproduced** by this mission (§4.1). **Pre-existing, not a regression**; bounded to working evidence and to principals who already hold authoring authority over the definition | Documented and referred to bounded remediation mission **KF-06** (mirror the existing `STEP_EVIDENCE_PRESENT` guard onto template deletion, or add a `BEFORE DELETE` guard). **No code changed by this mission.** **STATUS UPDATE (revision 1.1, 2026-10-10): MAJOR — REMEDIATED IN MAIN** by PR #80 (merge `bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e`); see §18 |
| **F-2** | **NIT** | Structural guard-to-capability regression assertions in the merged tests are source-text scans; a future fifth mutation route guarded by a *different* capability would not move the asserted counts. Behavioural coverage mitigates | Recorded; test-hardening opportunity, not a defect |
| **F-3** | **MINOR** | **Parallel-execution nondeterminism in the sanctioned suite.** Three independent data points: (a) pre-merge `main` CI was **red** (862/863) on a Knowledge Pack Membership assertion, then green at the merge commit with **no** corresponding code change; (b) one of this mission's two runs on the identical merged tree emitted a **PostgreSQL deadlock report**; (c) the clean re-run was 898/898 with no deadlock. All 25 suites share one database injected into one `node --test` invocation | Recorded for monitoring; consider a bounded CI-determinism review (isolate shared-fixture suites and/or remove the deadlock-prone contention). **No code change made by this mission.** Relation attribution added at revision 1.1: `knowledge_pack_versions` ↔ `knowledge_pack_version_task_template_versions` (§12, §18.3) |
| **F-4** | **MINOR** | The V1 closure ledger contains **six statements rendered stale** by post-closure merges (§13.3) | Reconciliation recorded here; a dated addendum to the ledger is recommended (not performed in this PR, to keep it to its three authorised documents) |
| **F-5** | **MINOR** | **`PRODUCTION_STATUS_UNVERIFIED`**: the deployed production revision cannot be identified from repository/GitHub evidence, and no production record was read. Production has no observable revision identity on `/health` | Recorded; requires an authorised read-only production reconciliation (recommended mission KF-05). **No guess made** |
| **F-6** | **NIT** | GitHub deployment records are stale (all Railway, 2026-03-19) while `render.yaml` auto-deploys from `main`; GitHub therefore does not reflect the real deployment channel | Recorded; consider whether the Render GitHub App should report deployment status (governance-owned, out of mission scope) |
| **F-7** | **MINOR** | Guards are **HTTP-layer only**. The CLI/migration script `scripts/m5r4b2/apply-taxonomy-application.js` INSERTs into `knowledge_sources` and `knowledge_source_versions` with no capability check. It is not HTTP-reachable and requires database credentials, so the route mapping is not bypassable through it | Recorded; consistent with the script's status as an out-of-band provider/migration operation (M5R.4B2). No change made |
| **F-8** | **MINOR** | **Unmapped seam in the crosswalk domain.** `POST`/`DELETE /api/knowledge-crosswalks/:id/evidence` remain on the legacy `requirePermission('TASKS','UPDATE')` matrix (`src/routes/knowledge-crosswalk.routes.js`) and write `equipment_type_external_classification_evidence` — a **different table** from the provenance evidence tables, so the K3‑G2 mapping is not bypassed; but the crosswalk evidence surface is not expressed in the capability model | Recorded for architectural follow-up (ATM-003 capability coverage). (Adversarial review named this table `external_classification_crosswalk_evidence`; the actual constant is `equipment_type_external_classification_evidence` — corrected here.) No change made |
| **F-9** | **NIT** | Precision of the merge-integrity statement: "zero content change" is true **relative to the PR head tree**; relative to the **base** commit the merge changed 9 files. The record states both facts (§3), and this row removes any ambiguity | Recorded; wording already qualified in §3 |

**No BLOCKER. Findings: one MAJOR (F-1, pre-existing guard completeness — not a regression and not introduced by PR #78); five MINOR (F-3, F-4, F-5, F-7, F-8); three NIT (F-2, F-6, F-9). No authorization regression, tenant-isolation failure or immutability failure was found.**

**Reconciliation update (revision 1.1, 2026-10-10).** F-1 is **REMEDIATED IN MAIN** by PR #80 (merge
`bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e`). The revised ledger is therefore: **no BLOCKER; zero MAJOR
open**; the five MINOR and three NIT findings above remain as recorded. See §18.

---

## 16. Non-actions (KF-01)

- **No merge** of any PR.
- **No deployment** and no change to Render, Supabase or any production configuration.
- **No production database read or mutation.**
- **No migration executed against production**; migrations were applied only to a disposable local database.
- **No application business logic, runtime authorization, schema or test changed.**
- **No PR #27 change.**
- Documentation-only changes, listed in the mission report.

---

## 17. KF-01 conclusion

# KF-01 — PASS (verification objectives) WITH FINDINGS — one MAJOR (F-1)

1. PR #78 **merged correctly**: expected merge commit, true two-parent merge, and a merge tree
   byte-identical to the reviewed head tree.
2. The **OWNER-approved authorization mapping survived intact** (2 × `knowledge.author`,
   2 × `evidence.attach`, 3 × `KNOWLEDGE.VIEW`), with no capability or bundle change.
3. **Global-write protection, tenant isolation and separation of duties are verified unweakened.**
4. The migration chain ends at **023** with **no 024**.
5. **PR #27 is untouched.**
6. **Production acceptance is NOT claimed:** `PRODUCTION_STATUS_UNVERIFIED`.
7. The Knowledge Foundation closure records remain truthful **for their own baseline**, with six
   statements now stale and reconciled here for dated addendum.
8. **One MAJOR finding (F-1):** the `evidence.attach` mapping is **route-complete but not
   effect-complete** — a principal denied the detach route can destroy the same working evidence by
   deleting its parent draft definition (`ON DELETE CASCADE`). **Independently reproduced**, assessed,
   **pre-existing (not a regression introduced by PR #78)**, security impact bounded to working evidence
   and to principals already holding `knowledge.author`, and **referred to bounded remediation mission
   KF-06** because the fix requires an application-code change this mission is not authorised to make.
   **Status at reconciliation (revision 1.1, 2026-10-10): REMEDIATED IN MAIN** — KF-06 was authorised and
   delivered as PR #80 (merge `bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e`) and independently verified; see
   §18.

### 17.1 Recommended remediation mission (delivered at revision 1.1)

**KF-06 (recommended): "Close the transitive working-evidence destruction path"** — add the missing
guard on definition deletion so that the `evidence.attach` mapping holds in effect, mirroring the
existing `STEP_EVIDENCE_PRESENT` pattern (service-level check and/or a database `BEFORE DELETE` guard on
`task_templates`), with regression tests proving that a principal denied `evidence.attach` cannot destroy
working evidence by any route. **Requires architectural review and OWNER authorisation; not started.**

**Status update (revision 1.1, 2026-10-10).** KF-06 was subsequently authorised by the OWNER, delivered
as **PR #80**, and **merged to `main`** at `bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e`. The guard is
implemented at the model operation (both the definition and its step rows are locked, and the refusal
carries `EVIDENCE_PRESENT` → HTTP 409), with a registered regression suite. It was independently verified
by the **ATIMAN-KF-06-VUDA** review mission, which reproduced the defect on the base commit and its
closure on the merge head before issuing **PASS_WITH_MINOR_FINDINGS**. See §18 for the full
reconciliation, the preserved acceptance boundaries and the recorded residuals.

---

## 18. Dated reconciliation — KF-06 remediation landed in main (revision 1.1)

**This section is appended, not substituted.** Everything above remains the historical revision-1.0
record of the PR #78 verification at `988fbb99…`. This section records only what has changed since, and
it changes no revision-1.0 observation.

### 18.1 What changed in `main`

| Item | Value (verified at reconciliation) |
|---|---|
| PR #80 — ATM-001-KF-06 "Knowledge Evidence Deletion Integrity" | **MERGED** |
| Merge commit | `bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e` — a true two-parent merge of base `988fbb99…` and PR head `eb373e830c08fd88f28b60324d55b14c602fe548` |
| Merged at | `2026-10-10T00:58:45Z` |
| Branch | `atm-001-kf-06-knowledge-evidence-deletion-integrity` |
| Diff introduced | **6 files, +1,125 / −4**; no change to `src/config/` (capability vocabulary and bundles), `src/routes/` (route guards), `database/postgresql/` or `database/migrations/` |
| Post-merge CI (`push` / `main` / `bfa18c7…`) | run `38011317579` — **success** |

The guard now present on `main` (`src/models/task-template.model.js`) is, in one transaction:

1. `SELECT id FROM task_templates WHERE id = ? FOR UPDATE` — locks the **definition** row;
2. `SELECT id FROM task_template_steps WHERE task_template_id = ? FOR UPDATE` — locks the **step** rows
   (a step-level attachment takes its `FOR KEY SHARE` lock on the step row, not the definition);
3. `countWorkingEvidence(id, conn)` — counts working evidence bound directly **or** through a step;
4. a refusal with `error.code = 'EVIDENCE_PRESENT'` **before** any mutation; and
5. the controller maps that code to **HTTP 409** (`src/controllers/task-template.controller.js`).

The regression suite `tests/knowledge-evidence-deletion-integrity.test.js` is registered in both
`scripts/run-integration-tests.js` and `tests/database-test-guard.test.js`.

### 18.2 F-1 status

| Field | Record |
|---|---|
| Finding | **F-1** — transitive working-evidence destruction (guard completeness) |
| Status at revision 1.0 | **MAJOR — OPEN** |
| **Status at reconciliation (revision 1.1)** | **MAJOR — REMEDIATED IN MAIN** |
| Remediation | PR #80, merge `bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e` |
| Independent verification | **ATIMAN-KF-06-VUDA** — an OWNER-authorised independent review mission executed in a separate reviewer context with its own disposable PostgreSQL cluster and its own fixtures. It reproduced the defect on the base revision (`988fbb99…`: a `knowledge.author`-only supervisor delete → **200**, evidence rows 1 → 0) and its closure on the merge head (→ **409 `EVIDENCE_PRESENT`**, template, steps and evidence intact), for **both** template-level and step-level evidence. Verdict: **PASS_WITH_MINOR_FINDINGS** |
| Regression evidence at the merged revision | KF-06 focused suite **17/17**; sanctioned integration **915/915** (26 suites; one earlier run showed a single pre-existing parallel-execution deadlock, F-3); `npm test` **162/162** |
| Concurrency evidence | Independent adversarial reproduction: a concurrent (uncommitted) template-level **and** step-level attachment each forces 409 with the evidence intact; the two locks are independently load-bearing (removing either makes the corresponding regression test fail); no deadlock, cascade loss or orphaned evidence was observed involving the KF-06 tables |
| Residuals left open (bounded; none is a security blocker) | **R-2** guards remain application-layer (raw SQL / CLI deletion is not HTTP-reachable); **R-3** deleting a definition that has a published version but no working evidence surfaces as HTTP 500 through the existing immutability trigger (pre-existing; nothing destroyed); **R-4** a losing concurrent attach surfaces as HTTP 500 with a raw FK message (no evidence is created); **R-6** a definition that vanishes mid-flight answers an optimistic 200 |

**Evidence-provenance note.** The ATIMAN-KF-06-VUDA review is an OWNER-authorised independent review
mission. Its report is currently an **external mission record and is not yet a repository artifact**. A
future record-accuracy action should commit the report (or a repository summary of it) so that the
revision-1.1 evidence cited here is traceable from the repository alone. Until then, this reconciliation
cites the mission by name rather than linking a repository path.

### 18.3 Residual-record precision corrections (from the independent review)

These correct statements in the merged KF-06 record. They are recorded here because this mission's scope
is the three KF-01/02/register documents; the KF-06 record itself should receive a matching dated
addendum in a future record-accuracy action.

| Residual | Correction |
|---|---|
| **R-5 — source-version cascade** | The KF-06 record describes `fk_knowledge_template_evidence_source_version`'s `ON DELETE CASCADE` as latent and unreachable because no route, controller or model method deletes a source or a source version. The independent review established an additional, stronger protection the record does not mention: a **`BEFORE DELETE` trigger, `trg_knowledge_source_versions_immutable` (`immutable_source_version_check`), raises SQLSTATE `23503`** ("… is referenced by evidence and cannot be deleted") **before the cascade can run**, so the cascade is blocked even by a direct SQL delete. The cascade is therefore **not currently exploitable** and must not be described as such without contrary evidence |
| **F-3 — CI deadlock relation** | The deadlock observed under parallel execution is between `knowledge_pack_membership_guard()` awaiting a `RowShareLock` on **`knowledge_pack_versions`** and a concurrent `AccessExclusiveLock` on **`knowledge_pack_version_task_template_versions`**. Neither is a KF-06 table. The KF-06 record's §8.0 attributes the DDL lock to `task_template_versions`; the verified relation is `knowledge_pack_version_task_template_versions` |

### 18.4 Acceptance boundaries preserved

- **Implementation acceptance** — the guard exists and behaves as specified on `main` (verified by
  reading the merged source and the route/controller mapping).
- **Integration acceptance** — the KF-06 suite, the sanctioned integration suite and `npm test` pass at
  the merged revision, and the post-merge CI run is green.
- **Production acceptance** — **NOT claimed.** The production health endpoint exposes no revision
  identity, so the deployed revision cannot be identified. The current revision is recorded as
  **`PRODUCTION_STATUS_UNVERIFIED`**. Nothing in this reconciliation asserts a verified production
  deployment.
- **Independent acceptance (register requirement 16)** — **still PENDING.** The KF-06 VUDA is one
  independently authorised review *of one milestone*; it does **not** satisfy the whole-ATM-001
  independent acceptance gate and is not offered as doing so.

### 18.5 Effect on the KF-01 conclusion

F-1 is **closed in `main`**. The revised finding ledger is: **no BLOCKER; zero MAJOR open** (F-1
remediated); five MINOR (**F-3**, F-4, F-5, F-7, F-8) and three NIT (F-2, F-6, F-9) remain as recorded.
The KF-01 verification objectives remain **PASS**, now with F-1 recorded as remediated rather than open.
The V1 closure ledger's six stale statements (F-4) are unaffected by this reconciliation and still
require their own dated addendum.
