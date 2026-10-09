# ATM-001 Knowledge Foundation V1 — Acceptance Register

**Document ID:** ATM-001-KF-AR
**Mission:** ATIMAN-KF-01/02 — Knowledge Foundation Closure and Engineering Evidence Qualification
**Status:** Verified acceptance register. **Records status only; authorises no implementation, no publication and no deployment.**
**Repository baseline:** `origin/main` = `988fbb99f31737dbc8f6050511964091e7962ce0` (merge of PR #78)
**Register date:** 2026-10-10

---

## 0. How to read this register, and its one global limitation

Statuses: **VERIFIED** · **PARTIAL** · **PENDING** · **BLOCKED** · **NOT_APPLICABLE**.
A requirement is marked VERIFIED **only** where reproducible evidence exists in this mission.

> ## ⚠ Global qualification — integration acceptance ≠ production acceptance
>
> Every **VERIFIED** status in this register is evidence of **repository / integration-level acceptance**:
> the code, schema and tests behave as specified on a **disposable PostgreSQL database**, through the
> canonical migration runner and the sanctioned integration suite.
>
> **This register does NOT claim production acceptance for the current revision.** The deployed production
> revision could not be identified from repository or GitHub evidence (see
> `ATM-001-KF-01-Post-Merge-Verification-and-Closure-Reconciliation.md` §10), and no production database
> was read. Production acceptance for revision `988fbb99…` is recorded as
> **`PRODUCTION_STATUS_UNVERIFIED`**.
>
> The historical V1 closure ledger records production acceptance at its own baseline
> (`922a0405…`, migration 021). That acceptance does **not** transfer forward to this revision.

**Evidence base used throughout:**

| Evidence | Result |
|---|---|
| Canonical migration runner against disposable PostgreSQL 16.14 (`db:migrate:postgres`) | **23/23 applied**, schema up to date |
| Schema readiness smoke test (`scripts/smoke-test-pg.js`) | **PASSED** |
| Full sanctioned integration suite (`npm run test:integration`, 25 suites, parallel) | **898/898 pass, 0 fail** |
| `npm test` (non-destructive) | **159/159 pass, 0 fail** |
| Focused suites (independent re-run) | accessions **16/16** · provenance authoring **46/46** · write scope **17/17** · capability grants **63/63** |
| Independent adversarial probe (separate database, own fixtures, checks A–N) | **45/45 pass** |
| Post-merge CI (GitHub Actions, run `38003870422`) | **success** |

---

## 1. Summary register

| # | Requirement | Status | Blocking gap? |
|---|---|---|---|
| 1 | Engineering taxonomy integrity | **VERIFIED** | — |
| 2 | Legacy knowledge preservation | **VERIFIED** | — |
| 3 | Source registration | **VERIFIED** | — |
| 4 | Immutable source versions | **VERIFIED** | — |
| 5 | Evidence attachment | **PARTIAL** | Transitive `ON DELETE CASCADE` path defeats the `evidence.attach` guard in effect (G-5 / KF-01 F-1) |
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

**No requirement is BLOCKED and none is NOT_APPLICABLE.** The four PARTIAL items and the one PENDING
item are **governed gaps with named next missions**. Three of them (13, 14, 15) are deliberate boundary
gaps; one (5) is a **MAJOR guard-completeness defect** discovered by adversarial verification and referred
to remediation mission KF-06. None of them is a defect in the V1 governance model itself.

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
| Supporting evidence | Source editions are insert-only: UPDATE refused unconditionally, DELETE refused once referenced by evidence; source identity (`organization_id`, `source_code`, `source_category`) locked after an edition exists |
| Implementation reference | Migration `011`; `trg_knowledge_source_versions_immutable`, `trg_knowledge_sources_identity_lock` |
| Existing tests | `tests/knowledge-provenance-authoring.test.js` (model-surface immutability assertions) |
| Missing acceptance evidence | None material |
| Blockers | None |
| Recommended next mission | None |

### 5. Evidence attachment — **PARTIAL**

| Field | Record |
|---|---|
| Status | **PARTIAL** — the evidence model and its mapped routes work exactly as ratified; the authorization boundary is **route-complete but not effect-complete** |
| Supporting evidence | Working (`knowledge_template_evidence`) and frozen (`knowledge_template_version_evidence`) evidence with exactly-one-subject enforcement, tenant-scope trigger, confidence and supporting-role vocabularies; frozen rows immutable; `ON DELETE RESTRICT` accountability linkage; **post-K3-G2 the attachment/detachment routes require `evidence.attach`, and a `knowledge.author`-only principal is refused on those routes (403, no row removed)** |
| Implementation reference | Migration `011`; `trg_knowledge_template_evidence_tenant_scope`, `trg_knowledge_template_version_evidence_immutable`; `src/models/knowledge-provenance.model.js` (`attachEvidence`, `detachWorkingEvidence`); `src/routes/knowledge-provenance.routes.js` |
| Existing tests | `tests/knowledge-accession-authority.test.js` (16/16 — mapping, denial, no-write, tenancy), `tests/knowledge-provenance-authoring.test.js` (46/46), independent probe checks A/B/C/I |
| **Missing acceptance evidence** | A guard that prevents working-evidence destruction by any route when the caller lacks `evidence.attach`, and a regression test proving it |
| Blockers | **G-5 — transitive working-evidence destruction (MAJOR).** `DELETE /api/task-templates/:id` is guarded only by `knowledge.author`, and `fk_knowledge_template_evidence_template` is `ON DELETE CASCADE`, so a principal denied `evidence.attach` can delete a draft definition and destroy its working evidence. **Independently reproduced** (KF-01 §4.1: direct route 403, template delete 200, evidence rows 1 → 0). Pre-existing; not introduced by PR #78; bounded to working evidence and to principals already holding `knowledge.author`. Frozen/published evidence is unaffected |
| Recommended next mission | **KF-06 (recommended): close the transitive working-evidence destruction path** — mirror the existing `STEP_EVIDENCE_PRESENT` guard onto definition deletion (service check and/or a `BEFORE DELETE` guard on `task_templates`) with regression tests. Requires an application-code change and therefore architectural review + OWNER authorisation |

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
| Caveat | The capability **mechanism** is verified. One destructive **transitive path** is not capability-guarded — see requirement 5 / G-5 / KF-01 F-1 |
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
| Status | **PENDING** |
| Supporting evidence (historical) | The V1 closure ledger records a **final whole-ATM-001 VUDA 29/29** (fresh, independent: own database, own fixtures, areas A–L) and production acceptance at baseline `922a0405…` |
| Supporting evidence (this mission) | Repository integrity, merged-artifact verification, sanctioned suites (898/898), `npm test` (159/159), focused suites (16/16, 46/46, 17/17, 63/63) and an independent adversarial probe (45/45, own database and fixtures) |
| **Missing acceptance evidence** | (a) An **independent review mission** (separate authority/context, per VUDA governance) executed against **this** revision; (b) **production acceptance** for this revision — the deployed revision could not be identified, so **`PRODUCTION_STATUS_UNVERIFIED`** |
| Blockers | **G-16** — independence cannot be self-granted. The KF-01/02 adversarial reviews were **separate-context** reviews, explicitly **not** an independent review mission and **not** a human independent reviewer. Recorded as PENDING rather than fabricated |
| Recommended next mission | **KF-05 (recommended): "Independent VUDA and Production Acceptance for revision `988fbb99…`"** — an independently authorised reviewer performs the VUDA, and an authorised read-only production reconciliation identifies the deployed revision and its schema/corpus state |

---

## 3. Register conclusions

1. **Eleven of sixteen requirements are VERIFIED at integration level** with reproducible evidence, and
   none is BLOCKED or NOT_APPLICABLE.
2. **Five requirements are open:** published-template resolution (13), historical inspection
   attribution (14) and operational consumption (15) are governed gaps whose implementation is
   deliberately outside the closed V1 governance boundary; independent acceptance (16) is PENDING because
   independence and production acceptance cannot be fabricated; and **evidence attachment (5) is PARTIAL**
   because one transitive destruction path defeats the `evidence.attach` guard in effect (G-5, MAJOR).
3. **No regression was found, but one MAJOR guard-completeness defect was discovered (G-5).** Post-merge,
   the knowledge governance and authorization surface behaves as ratified on every mapped route, including
   the K3‑R1 global-write protection and the OWNER-approved K3‑G2 capability mapping; the G-5 defect is a
   **pre-existing** path that PR #78 neither created nor widened.
4. **Production acceptance is NOT claimed.** The register's VERIFIED statuses are integration-level only;
   the deployed revision is unidentified and is recorded as `PRODUCTION_STATUS_UNVERIFIED`.
5. The two dated debts **G1** (rights/licence status not structurally represented) and **G2** (evidence
   subject granularity) remain recorded and un-fired **until** an authored procedure is attempted. The
   KF-02 evidence qualification shows that the **G1 trigger is now the next live gate** for the Knife Gate
   Valve pilot.

**Recommended next engineering mission (single):** **KF-03 — Knife Gate Valve Asset Identity and Rights
Adjudication** (evidence prerequisites; see `ATM-001-KF-02` §10), then **KF-06 — Close the transitive
working-evidence destruction path** (G-5, MAJOR), then **KF-04 — Published Knowledge Resolution for
Operational Execution**, with **KF-05 — Independent VUDA and Production Acceptance** as the closing gate.
None may start without architectural review and OWNER authorisation.
