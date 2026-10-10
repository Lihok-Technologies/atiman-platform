# ATM-001 Knowledge Foundation V1 — Acceptance Register

**Document ID:** ATM-001-KF-AR
**Mission:** ATIMAN-KF-01/02 — Knowledge Foundation Closure and Engineering Evidence Qualification
**Status:** Verified acceptance register. **Records status only; authorises no implementation, no publication and no deployment.**
**Register revision:** 1.1 — dated reconciliation against current `main` (`bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e`, merge of PR #80 / ATM-001-KF-06). Revision 1.0 was verified against `988fbb99f31737dbc8f6050511964091e7962ce0` (merge of PR #78).
**Repository baseline (current):** `origin/main` = `bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e` (merge of PR #80, KF-06)
**Originating baseline (revision 1.0):** `988fbb99f31737dbc8f6050511964091e7962ce0` (merge of PR #78)
**Register date:** 2026-10-10

---

## 0. How to read this register, and its one global limitation

Statuses: **VERIFIED** · **PARTIAL** · **PENDING** · **BLOCKED** · **NOT_APPLICABLE**.
A requirement is marked VERIFIED **only** where reproducible evidence exists for the revision stated.
Register revision 1.1 adds the merged KF-06 remediation and its independent verification to the evidence
base (§0.1).

> ## ⚠ Global qualification — integration acceptance ≠ production acceptance
>
> Every **VERIFIED** status in this register is evidence of **repository / integration-level acceptance**:
> the code, schema and tests behave as specified on a **disposable PostgreSQL database**, through the
> canonical migration runner and the sanctioned integration suite.
>
> **This register does NOT claim production acceptance for the current revision.** The deployed production
> revision could not be identified from repository or GitHub evidence (see
> `ATM-001-KF-01-Post-Merge-Verification-and-Closure-Reconciliation.md` §10 and §18.4), and no production
> database was read. Production acceptance for the current revision (`bfa18c7…`) is recorded as
> **`PRODUCTION_STATUS_UNVERIFIED`**. The KF-06 independent review verified **implementation and
> integration** behaviour on disposable databases only; it is **not** production acceptance.
>
> The historical V1 closure ledger records production acceptance at its own baseline
> (`922a0405…`, migration 021). That acceptance does **not** transfer forward to this revision.

### 0.1 Revision reconciliation (revision 1.1, 2026-10-10)

`main` advanced from `988fbb99…` (PR #78) to `bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e` (merge of
**PR #80**, ATM-001-KF-06 "Knowledge Evidence Deletion Integrity") after revision 1.0 of this register.
KF-06 closes the transitive working-evidence destruction path (KF-01 finding **F-1**, MAJOR) that made
requirement 5 PARTIAL. It adds a guard at the model operation — both the definition row and its step rows
are locked `FOR UPDATE` in one transaction, working evidence is counted, and the deletion is refused with
`EVIDENCE_PRESENT` mapped to **HTTP 409** before any mutation — plus a registered regression suite. It
changes no capability, no bundle, no route guard, no migration and no schema.

| Evidence at revision 1.1 (`bfa18c7…`) | Result |
|---|---|
| Canonical migration runner against disposable PostgreSQL (`db:migrate:postgres`) | **23/23 applied**, no migration added by KF-06 |
| KF-06 focused suite (`knowledge-evidence-deletion-integrity`) | **17/17 pass, 0 fail** |
| Full sanctioned integration suite (26 suites, parallel) | **915/915 pass, 0 fail** (one earlier run showed a single pre-existing parallel-execution deadlock — F-3) |
| `npm test` (non-destructive) | **162/162 pass, 0 fail** |
| Independent KF-06 verification (**ATIMAN-KF-06-VUDA**, OWNER-authorised, separate reviewer context, own disposable database and fixtures) | **PASS_WITH_MINOR_FINDINGS** — reproduced the defect on the base revision and its closure on the merge head, for template-level and step-level evidence; both locks independently load-bearing under mutation testing |
| Post-merge CI (`push` / `main` / `bfa18c7…`, run `38011317579`) | **success** |

**Boundary.** The KF-06 review verified *one milestone* at integration level. It does **not** satisfy
requirement 16 (independent acceptance), which requires an independent review mission over ATM-001 as a
whole **and** production acceptance. Requirement 16 remains **PENDING**. The review's report is currently
an external mission record, **not yet a repository artifact** (see KF-01 §18.2).

**Evidence base — revision 1.0 (`988fbb99…`, PR #78):**

| Evidence | Result |
|---|---|
| Canonical migration runner against disposable PostgreSQL 16.14 (`db:migrate:postgres`) | **23/23 applied**, schema up to date |
| Schema readiness smoke test (`scripts/smoke-test-pg.js`) | **PASSED** |
| Full sanctioned integration suite (`npm run test:integration`, 25 suites, parallel) | **898/898 pass, 0 fail** |
| `npm test` (non-destructive) | **159/159 pass, 0 fail** |
| Focused suites (independent re-run) | accessions **16/16** · provenance authoring **46/46** · write scope **17/17** · capability grants **63/63** |
| Independent adversarial probe (separate database, own fixtures, checks A–N) | **45/45 pass** |
| Post-merge CI (GitHub Actions, run `38003870422`) | **success** |

**Evidence base — revision 1.1 (`bfa18c7…`, PR #80 / KF-06):** see §0.1 — KF-06 focused **17/17**,
sanctioned integration **915/915** (26 suites), `npm test` **162/162**, independent KF-06 verification
**PASS_WITH_MINOR_FINDINGS**, post-merge CI run `38011317579` **success**.

> **Scope of the revision-1.1 reconciliation.** Only **requirement 5** changes status. Requirements 13,
> 14, 15 and 16 are re-examined but **not** upgraded, because KF-06 supplies no new implementation
> evidence for operational resolution, historical version attribution, operational consumption, or
> whole-ATM-001 independent acceptance.

---

## 1. Summary register

| # | Requirement | Status | Blocking gap? |
|---|---|---|---|
| 1 | Engineering taxonomy integrity | **VERIFIED** | — |
| 2 | Legacy knowledge preservation | **VERIFIED** | — |
| 3 | Source registration | **VERIFIED** | — |
| 4 | Immutable source versions | **VERIFIED** | — |
| 5 | Evidence attachment and removal integrity | **VERIFIED** (integration level) | — (G-5 / KF-01 F-1 **remediated in `main`** by PR #80; bounded residuals recorded in §2 requirement 5) |
| 6 | Tenant isolation | **VERIFIED** | — |
| 7 | Global knowledge protection | **VERIFIED** | — |
| 8 | Capability authorization | **VERIFIED** | — |
| 9 | Engineering review | **VERIFIED** | — |
| 10 | Safety review | **VERIFIED** | — |
| 11 | Knowledge approval | **VERIFIED** | — |
| 12 | Immutable publication | **VERIFIED** | — |
| 13 | Published-template resolution | **PARTIAL** | Operational resolution absent (G-13) |
| 14 | Historical inspection attribution | **PARTIAL** | No version pin (G-14) |
| 15 | Operational consumption | **PARTIAL** | Publication/version semantics not operationally present (G-15) |
| 16 | Independent acceptance | **PENDING** | Independent VUDA mission + production acceptance (G-16) |

**No requirement is BLOCKED and none is NOT_APPLICABLE.** At revision 1.1, **twelve** requirements are
VERIFIED at integration level; three PARTIAL items (13, 14, 15) are **governed boundary gaps with named
next missions**; and one (16) is **PENDING** because independence and production acceptance cannot be
self-granted. Requirement 5's former MAJOR guard-completeness defect (G-5 / F-1) is **remediated in
`main`** by PR #80 and independently verified; its bounded residuals are recorded under requirement 5
and none is a security blocker. None of the open items is a defect in the V1 governance model itself.

---

## 2. Requirement detail

### 1. Engineering taxonomy integrity — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | Canonical taxonomy is global (no `organization_id` on taxonomy tables); governed identity lifecycle with states `canonical / superseded / retired`; canonical-only import resolution with ambiguity refused. Identity lifecycle mechanism applies and constrains at the schema level. |
| Implementation reference | Migrations `001`, `002`, `019`; `equipment_categories`, `equipment_classes`, `equipment_types`, `equipment_type_identity_resolution`, `equipment_type_term`; `trg_equipment_type_identity_resolution_immutable`, `trg_equipment_type_term_immutable` |
| Existing tests | `tests/taxonomy-identity-lifecycle.test.js` (1,224 lines, in the sanctioned suite), `tests/taxonomy-application.test.js`, `tests/asset-import-resolver-safety.test.js` |
| Missing acceptance evidence | Production taxonomy counts at this revision (last recorded 66/316/283 at the V1 baseline) |
| Blockers | None for integration acceptance |
| Recommended next mission | Fold a read-only production taxonomy reconciliation into any future authorised production-acceptance mission |

### 2. Legacy knowledge preservation — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | Immutable `content_origin`; accountable legacy clearance columns; legacy-generated knowledge exempt from AI-disclosure requirement; no historical rewrite; the M6.1 corpus record is a reconciliation, not a mutation |
| Implementation reference | Migration `020` (`content_origin`, `legacy_clearance_*`, `chk_task_templates_content_origin`, `trg_task_templates_origin_immutable`); `docs/architecture/ATM-001-M6.1-Maintenance-Corpus-Reconciliation.md` |
| Existing tests | `tests/governed-knowledge-foundation.test.js`, `tests/knowledge-versioning.test.js`, `tests/m6r3-r1-remediation.test.js` |
| Missing acceptance evidence | Production corpus reconciliation at this revision (last recorded 846 definitions / 3,099 steps / 0 authored) |
| Blockers | None |
| Recommended next mission | Same as requirement 1 |

### 3. Source registration — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | `knowledge_sources` authority registry with source category, issuing organization, tenant/global scoping and tenant-scoped uniqueness; tenant sources derive organization from the authenticated principal; a global source cannot be created through the application |
| Implementation reference | Migration `011`; `src/models/knowledge-provenance.model.js` (`createSource`, `findSourceById`); `uq_knowledge_sources_code_org UNIQUE NULLS NOT DISTINCT (organization_id, source_code)` |
| Existing tests | `tests/knowledge-provenance-authoring.test.js` (46/46), `tests/knowledge-accession-authority.test.js` (16/16) |
| Missing acceptance evidence | Identity/applicability of the production global sources (not readable in this mission) |
| Blockers | None; production source registry is **recorded as unresolved**, not assumed |
| Recommended next mission | Include production source-registry read-only reconciliation in the production-acceptance mission |

### 4. Immutable source versions — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | Source editions are insert-only: UPDATE refused unconditionally, DELETE refused once referenced by evidence; source identity (`organization_id`, `source_code`, `source_category`) locked after an edition exists. The DELETE refusal is enforced **before** any cascade: `immutable_source_version_check()` raises SQLSTATE **`23503`** ("… is referenced by evidence and cannot be deleted") when a `knowledge_template_evidence` or `knowledge_template_version_evidence` row references the edition. `fk_knowledge_template_evidence_source_version` is declared `ON DELETE CASCADE`, but that cascade is **not currently reachable** for a referenced edition because the `BEFORE DELETE` trigger refuses first. (Precision correction recorded from the independent KF-06 review — see §0.1 and KF-01 §18.3; the cascade must not be described as currently exploitable without contrary evidence.) |
| Implementation reference | Migration `011`; `trg_knowledge_source_versions_immutable` (`immutable_source_version_check`), `trg_knowledge_sources_identity_lock` |
| Existing tests | `tests/knowledge-provenance-authoring.test.js` (model-surface and trigger immutability assertions); independently probed in the KF-06 verification, where a raw `DELETE FROM knowledge_source_versions` was refused with `23503` and the evidence row survived |
| Missing acceptance evidence | None material |
| Blockers | None |
| Recommended next mission | None |

### 5. Evidence attachment and removal integrity — **VERIFIED** (integration level, revision 1.1)

| Field | Record |
|---|---|
| Status | **VERIFIED at integration level.** The evidence model and its mapped routes work exactly as ratified, and the authorization boundary is now **effect-complete** for the F-1 path: a principal without `evidence.attach` can no longer destroy working evidence through a definition deletion. Historical status at revision 1.0 was **PARTIAL** (G-5 / F-1 OPEN) |
| Supporting evidence | Working (`knowledge_template_evidence`) and frozen (`knowledge_template_version_evidence`) evidence with exactly-one-subject enforcement, tenant-scope trigger, confidence and supporting-role vocabularies; frozen rows immutable; `ON DELETE RESTRICT` accountability linkage; post-K3-G2 the attachment/detachment routes require `evidence.attach`, and a `knowledge.author`-only principal is refused on those routes (403, no row removed). **Post-KF-06 (PR #80, merge `bfa18c7…`), deleting a definition is additionally refused while working evidence is attached — directly or through any of its steps — with HTTP 409 `EVIDENCE_PRESENT`, before any mutation, in one transaction that locks the definition row and its step rows** |
| Implementation reference | Migration `011`; `trg_knowledge_template_evidence_tenant_scope`, `trg_knowledge_template_version_evidence_immutable`; `src/models/knowledge-provenance.model.js` (`attachEvidence`, `detachWorkingEvidence`); `src/routes/knowledge-provenance.routes.js`; **`src/models/task-template.model.js` (`countWorkingEvidence`, guarded `deleteIfEditable`) and `src/controllers/task-template.controller.js` (409 mapping)** |
| Existing tests | `tests/knowledge-accession-authority.test.js` (16/16 — mapping, denial, no-write, tenancy), `tests/knowledge-provenance-authoring.test.js` (46/46); **`tests/knowledge-evidence-deletion-integrity.test.js` (17/17; registered in the sanctioned runner and the database-test guard)**; independent KF-06 probe on a disposable database with the reviewer's own fixtures |
| Independent verification | **ATIMAN-KF-06-VUDA** (OWNER-authorised independent review mission; separate reviewer context; own disposable PostgreSQL cluster and own fixtures). It reproduced the defect on the base revision (`988fbb99…`: a `knowledge.author`-only supervisor delete → **200**, evidence 1 → 0) and its closure on the merge head (→ **409**, evidence intact), for **both** template-level and step-level evidence; mutation testing confirmed both `FOR UPDATE` locks are independently load-bearing; verdict **PASS_WITH_MINOR_FINDINGS** |
| Remaining acceptance evidence | Only the bounded residuals below; none defeats the requirement |
| Blockers | **None** — G-5 / KF-01 F-1 is **REMEDIATED IN MAIN**. Bounded residuals recorded (not blockers): **R-2** the guard is application-layer (raw SQL / CLI deletion is not HTTP-reachable); **R-3** deleting a definition that has a published version but no working evidence surfaces as HTTP 500 through the existing immutability trigger (nothing destroyed); **R-4** a losing concurrent attach surfaces as HTTP 500 with a raw FK message (no evidence created); **R-6** a definition that vanishes mid-flight answers an optimistic 200 |
| Recommended next mission | None required for the F-1 path. Optional bounded hardening: a `BEFORE DELETE` trigger on `task_templates` (or an explicit `delete()` override) to close R-2 at the database layer, and clean error-contract mapping for R-3/R-4/R-6 |

### 6. Tenant isolation — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | Cross-tenant source/version/evidence reads and writes are refused non-disclosingly (404) or by scope-mismatch conflict; the tenant **write** predicate is strict equality and is separate from the global-inclusive **read** predicate; provenance tenant-scope triggers enforce source-vs-template organization equality |
| Implementation reference | `src/models/knowledge-provenance.model.js` (`findTenantWritableSourceById` vs `findSourceById`); `provenance_tenant_scope_check` (migration `011`); `uq_knowledge_sources_code_org` |
| Existing tests | `tests/provenance-write-scope.test.js` (17/17), `tests/knowledge-accession-authority.test.js` R14, independent probe checks F, N2 |
| Missing acceptance evidence | Production cross-tenant behavioural verification (not performed) |
| Blockers | None |
| Recommended next mission | Production read-only behavioural spot-check in the production-acceptance mission |

### 7. Global knowledge protection — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | A global source (`organization_id IS NULL`) is **readable and citable** by tenants but **not writable**: a tenant attempting a new edition under a global source receives `409 SOURCE_NOT_TENANT_WRITABLE` and the global lineage does not grow; requesting-body spoofing of organization cannot create a global source. This is the repaired ATM-001-K3-R1 MAJOR-1 defect, re-verified after the merge |
| Implementation reference | `findTenantWritableSourceById` + `createVersion` refusal path in `src/models/knowledge-provenance.model.js` |
| Existing tests | `tests/provenance-write-scope.test.js` (17/17), independent probe checks G, H, N1 |
| Missing acceptance evidence | None material |
| Blockers | None |
| Recommended next mission | None |

### 8. Capability authorization — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | Tenant-scoped, attributed, revocable capability grants (migration 022); resolver with two modes (`EXPLICIT_GRANTS` / `LEGACY_COMPATIBILITY`) and no union; explicit grants are revocable history, never deleted; bundles are explicit enumerations (operator 2 / supervisor 14 / admin 16) with no wildcard; **post-K3-G2 provenance mapping is exactly: sources + editions → `knowledge.author`; evidence attach/detach → `evidence.attach`; three reads → `KNOWLEDGE.VIEW`** |
| Implementation reference | Migration `022`; `src/config/capabilities.js`; `src/services/capability.service.js`; `src/middleware/capability.middleware.js`; `src/routes/knowledge-provenance.routes.js` |
| Existing tests | `tests/capability-grants.test.js` (63/63, includes the guard-to-capability ↔ bundle agreement block), `tests/knowledge-accession-authority.test.js` R15/R16, independent probe checks A–E, K, L, M |
| Caveat | The capability **mechanism** is verified. The former destructive **transitive path** (requirement 5 / G-5 / F-1) is now **remediated in `main`** by PR #80 and independently verified; only the bounded, non-security residuals recorded under requirement 5 remain. The K3-G2 mapping itself is unchanged: sources + editions → `knowledge.author`; evidence attach/detach → `evidence.attach`; three reads → `KNOWLEDGE.VIEW` |
| Missing acceptance evidence | Production grant inventory (not read) |
| Blockers | None |
| Recommended next mission | Production read-only grant inventory in the production-acceptance mission (note: the closure ledger recorded 1 user / 0 organizations at the V1 baseline; whether grants now exist is unverified) |

### 9. Engineering review — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | Review state machine `draft → under_review → approved / rejected` with attributed `reviewer_user_id` / `reviewed_at` / `review_state`; authoring is draft-only with a real, active actor; approval is bound to a semantic content fingerprint |
| Implementation reference | Migration `013`; `src/services/knowledge-governance.service.js`; `src/models/task-template.model.js` |
| Existing tests | `tests/knowledge-authoring.test.js`, `tests/knowledge-publication-admission.test.js` (923 lines), `tests/ai-assistance-disclosure.test.js` |
| Missing acceptance evidence | Production review-state inventory (not read) |
| Blockers | None |
| Recommended next mission | Production read-only reconciliation in the production-acceptance mission |

### 10. Safety review — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | Explicit attributed safety-review states (`not_assessed`, `reviewed_no_control_required`, `reviewed_controls_defined`) with admission failures `SAFETY_NOT_ASSESSED`, `SAFETY_STATE_INVALID`, `SAFETY_REVIEW_ATTRIBUTION_MISSING`, `SAFETY_CONTROLS_MISSING`; safety content frozen into versions. Per-control provenance remains out of scope by ratified decision (G2) |
| Implementation reference | Migration `013` / `020`; `src/services/knowledge-governance.service.js` |
| Existing tests | `tests/governed-knowledge-foundation.test.js`, `tests/knowledge-publication-admission.test.js` |
| Missing acceptance evidence | Production safety-state inventory (not read) |
| Blockers | None. Note: **G2 (per-control/per-applicability evidence granularity) remains dated debt** and its trigger is engaged by any future type-specific evidenced safety/applicability claim — see the KF-02 record §9 |
| Recommended next mission | Resolve G2 before the first type-specific evidenced safety/applicability claim (OWNER-scoped architectural decision) |

### 11. Knowledge approval — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | Attributed accountable approval with `approver_user_id`, `approved_at`, `approved_content_sha`; **segregation of duties enforced in schema**: `chk_task_template_versions_approver_not_publisher` (published versions require reviewer, approver, safety attestation and publisher, with approver ≠ publisher); changing a material field stales the approval |
| Implementation reference | Migrations `013`, `020`; `chk_task_template_versions_requires_governance`, `chk_task_template_versions_approver_not_publisher`; `src/services/knowledge-governance.service.js`, `src/models/task-template.model.js` |
| Existing tests | `tests/knowledge-publication-admission.test.js`, `tests/knowledge-authoring.test.js`, `tests/governed-knowledge-foundation.test.js` |
| Missing acceptance evidence | Production approver/publisher distinctness is a **readiness** question at this revision: the V1 baseline recorded a single accountable user, which the ledger itself flagged as a publication-readiness issue. Whether a second accountable principal now exists is **unverified** |
| Blockers | None for the mechanism; potential operational blocker for any future publication (needs ≥2 distinct accountable principals) |
| Recommended next mission | Confirm accountable-principal availability before any publication mission |

### 12. Immutable publication — **VERIFIED**

| Field | Record |
|---|---|
| Supporting evidence | Publication admission fails closed with every reason before the first irreversible write, mirrored by a **database-level deferred constraint trigger**; 13 immutability guards existed at the V1 baseline and **14 immutability triggers exist at this revision** (the additional guard is `trg_user_capabilities_immutable` from migration 022); sealed step sets, frozen evidence, frozen applicability, monotonic version numbers, `ON DELETE RESTRICT` publisher FKs |
| Implementation reference | Migrations `009`, `010`, `013`, `020`; `trg_task_template_version_publication_admission`; the 14 immutability triggers; smoke test asserts the required constraints by definition fragment |
| Existing tests | `tests/knowledge-publication-admission.test.js`, `tests/knowledge-versioning.test.js` (3,741 lines), `tests/knowledge-pack-publication-admission.test.js` |
| Missing acceptance evidence | Production schema-state reconciliation (not read) |
| Blockers | None |
| Recommended next mission | Production read-only schema reconciliation in the production-acceptance mission |

### 13. Published-template resolution — **PARTIAL**

| Field | Record |
|---|---|
| Status | **PARTIAL** — immutable-version resolution exists for Knowledge Pack composition but **not** for operational execution |
| Supporting evidence | `src/services/knowledge-pack.service.js` resolves a pack member's `task_template_version_id` and **refuses a member whose `lifecycle_state_at_publish !== 'published'`** (`MEMBER_TEMPLATE_LIFECYCLE_STATE = 'published'`). This is genuine published-version resolution. However, no code path resolves "the published immutable version of template X" for inspection/observation execution |
| Implementation reference | `src/services/knowledge-pack.service.js` (member resolution); `src/models/knowledge-pack.model.js`; **absent**: any published-version resolver for consumption |
| Existing tests | `tests/knowledge-pack-membership.test.js`, `tests/knowledge-pack-publication-admission.test.js`, `tests/knowledge-versioning.test.js` |
| Missing acceptance evidence | A resolution path that serves a **published immutable version** (not the working definition) to an operational consumer, with tests |
| Blockers | **G-13** — operational consumption is deliberately not implemented yet (see requirement 15) |
| Recommended next mission | **KF-04 (recommended): "Published Knowledge Resolution for Operational Execution"** — design and implement the read path that resolves the published immutable version for a given definition + tenant scope, without weakening ATM-001 governance. Requires architectural review before implementation |

### 14. Historical inspection attribution — **PARTIAL**

| Field | Record |
|---|---|
| Status | **PARTIAL** — attribution to the **definition** exists; attribution to the **immutable version in force** does not |
| Supporting evidence (legacy) | `inspection_results` (migration 004) carries `asset_id`, `task_template_id`, **`task_template_step_id`**, `recorded_by_user_id`, `recorded_at` — a **definition/step** reference, no version reference |
| Supporting evidence (current field workflow) | `asset_observations` (migration 023) carries `asset_id`, `facility_id`, `recorded_by_user_id`, `observed_at`, and optional `task_template_id` / `task_template_step_id` — again a **definition/step** reference, no `task_template_version_id`; `proveProcedure()` validates only existence and tenant/global scope |
| Implementation reference | `database/postgresql/004_work_management.sql` (`inspection_results`); `database/postgresql/023_asset_observations.sql`; `src/services/observation.service.js` (`proveProcedure`); `src/controllers/mobile-inspection.controller.js` (`getTemplatesForAsset`, `getWithDetails`) |
| Existing tests | `tests/observation-foundation.test.js`, `tests/report-capture.test.js`, `tests/asset-context.test.js` |
| Missing acceptance evidence | A proven statement of **which immutable knowledge version** an historical inspection/observation was performed against (needed for defensible historical attribution and for "knowledge changed after an inspection" analysis) |
| Blockers | **G-14** — attributable to the same missing resolution path as G-13; also touches the deferred D03 (inspection-point anchor) decision |
| Recommended next mission | Same as requirement 13 (KF-04), extended to record the resolved knowledge version on the operational record. **Not a V1 correctness blocker** |

### 15. Operational consumption — **PARTIAL**

| Field | Record |
|---|---|
| Status | **PARTIAL** — an operational capture workflow exists; it consumes **working definitions**, not governed published versions |
| Supporting evidence | ATM-002-I2B observation foundation (migration 023) and ATM-002-I2E report/observation capture are implemented, merged and tested. Their own source comment states the boundary explicitly: *"Publication, version and pack semantics are NOT re-implemented or weakened here — ATM-001 owns them, and they are not operationally present yet."* `mobile-inspection.controller.js` resolves templates via `TaskTemplate.getTemplatesForAsset(asset_type_id, organizationId)` — the working definition |
| Implementation reference | `src/services/observation.service.js`; `src/controllers/mobile-inspection.controller.js`; `src/models/inspection-result.model.js`; `database/postgresql/023_asset_observations.sql` |
| Existing tests | `tests/observation-foundation.test.js` (1,444 lines), `tests/report-capture.test.js` (1,031 lines), `tests/asset-context.test.js` |
| Missing acceptance evidence | An operational consumer that (a) resolves a published immutable version, (b) presents its frozen steps/safety/evidence, and (c) records that version on the resulting operational record |
| Blockers | **G-15** — an approved consumption capability is required first; ATM-002-R6 defines the architecture but the governed read path is not implemented |
| Recommended next mission | **KF-04 (recommended)** as above; ATM-002-R6 §4/§4.1 supplies the experience contract. **Not a V1 correctness blocker** — the V1 boundary claims governance of knowledge, not operational consumption of it |

### 16. Independent acceptance — **PENDING**

| Field | Record |
|---|---|
| Status | **PENDING** (unchanged at revision 1.1) |
| Supporting evidence (historical) | The V1 closure ledger records a **final whole-ATM-001 VUDA 29/29** (fresh, independent: own database, own fixtures, areas A–L) and production acceptance at baseline `922a0405…` |
| Supporting evidence (revision 1.0) | Repository integrity, merged-artifact verification, sanctioned suites (898/898), `npm test` (159/159), focused suites (16/16, 46/46, 17/17, 63/63) and an independent adversarial probe (45/45, own database and fixtures) |
| Supporting evidence (revision 1.1) | The **ATIMAN-KF-06-VUDA** independent review mission (separate reviewer authority/context; own disposable database and fixtures) verified the KF-06 milestone: **PASS_WITH_MINOR_FINDINGS**, with base-versus-head falsification and mutation testing. **This is milestone-level, not whole-ATM-001, independent acceptance.** The KF-01 and KF-02 adversarial reviews remain **separate-context** reviews, explicitly **not** independent review missions and **not** human independent reviewers |
| **Missing acceptance evidence** | (a) An **independent review mission** (separate authority/context, per VUDA governance) executed against the **whole** ATM-001 Knowledge Foundation at the current revision — the KF-06 mission covers one milestone only and does **not** discharge this gate; (b) **production acceptance** for the current revision (`bfa18c7…`) — the deployed revision could not be identified, so **`PRODUCTION_STATUS_UNVERIFIED`** |
| Blockers | **G-16** — independence cannot be self-granted, and it cannot be assembled from milestone reviews. Recorded as PENDING rather than fabricated or partially claimed |
| Recommended next mission | **KF-05 (recommended): "Independent VUDA and Production Acceptance for the current revision"** — an independently authorised reviewer performs the whole-ATM-001 VUDA, and an authorised read-only production reconciliation identifies the deployed revision and its schema/corpus state |

---

## 3. Register conclusions

Status at **register revision 1.1** (`bfa18c7…`, PR #80 / KF-06 merged):

1. **Twelve of sixteen requirements are VERIFIED at integration level** with reproducible evidence, and
   none is BLOCKED or NOT_APPLICABLE.
2. **Four requirements remain open, and none is a V1-governance defect:** published-template resolution
   (13), historical inspection attribution (14) and operational consumption (15) are governed boundary
   gaps whose implementation is deliberately outside the closed V1 governance boundary; independent
   acceptance (16) is PENDING because independence and production acceptance cannot be fabricated.
3. **The former MAJOR guard-completeness defect (G-5 / F-1) is REMEDIATED IN MAIN** by PR #80 (merge
   `bfa18c7ffa4c7f46ffa1bfd31447f0f9360b254e`) and independently verified (**ATIMAN-KF-06-VUDA**,
   PASS_WITH_MINOR_FINDINGS). Requirement 5 is therefore **VERIFIED at integration level** — a status
   change from revision 1.0, where it was PARTIAL. The revision-1.0 record of the defect is preserved in
   `ATM-001-KF-01-Post-Merge-Verification-and-Closure-Reconciliation.md` §4.1, §17.1 and the appended
   §18. The remediation changes no capability, bundle, route guard, migration or schema, and leaves only
   bounded, non-security residuals (R-2 / R-3 / R-4 / R-6, recorded under requirement 5).
4. **Production acceptance is NOT claimed.** The register's VERIFIED statuses are integration-level only;
   the deployed revision is unidentified and is recorded as `PRODUCTION_STATUS_UNVERIFIED` for the current
   revision.
5. The two dated debts **G1** (rights/licence status not structurally represented) and **G2** (evidence
   subject granularity) remain recorded and un-fired **until** an authored procedure is attempted. The
   KF-02 evidence qualification shows that the **G1 trigger is the next live gate** for the Knife Gate
   Valve pilot, and G2 is engaged by any type-specific evidenced safety/applicability claim.

**Recommended next engineering mission (single):** **KF-03 — Knife Gate Valve Asset Identity and Rights
Adjudication** (evidence prerequisites; see `ATM-001-KF-02` §10 and §13), then **KF-04 — Published
Knowledge Resolution for Operational Execution** (requirements 13/14/15), with **KF-05 — Independent VUDA
and Production Acceptance** as the closing gate. **KF-06 is complete** and is removed from the forward
sequence. None of the remaining missions may start without architectural review and OWNER authorisation.
