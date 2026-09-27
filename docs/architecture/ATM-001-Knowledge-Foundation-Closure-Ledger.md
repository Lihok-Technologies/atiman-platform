# ATM-001 Knowledge Foundation — Closure Ledger

**Document ID:** ATM-001-CL
**Status:** Record of execution, classification, OWNER adjudication and **ATM-001 V1 completion**.
The ledger itself decides nothing; it records what was executed, what each item's authority is, and
the dispositions the OWNER has since issued. The governed deferrals in §3 and the completion record
in §9 are **OWNER decisions recorded here**, not decisions made by this document.

**Baseline of record:** `origin/main` = `922a0405f3bbfa52d2d34d46368912c3295eea94`
**OWNER V1 closure adjudication date:** 2026-09-27
**V1 completion date:** 2026-09-27
**Migration endpoint:** `021_ai_assistance_disclosure.sql` (chain 001–021, forward-only)
**Authority basis:** the OWNER-authorized ATM-001 Knowledge Foundation autonomous closure campaign
(§11 requires this ledger; §12.18 requires evidence to be recorded).
**Evidence rule:** every row cites a merge revision, a migration, a frozen suite, a production
observation or a controlled record. Nothing here is inferred from memory.

---

## 1. How to read this ledger

Classification vocabulary (campaign §11):

| Class | Meaning |
|---|---|
| **COMPLETE** | Implemented, merged, and — where it bears schema — deployed and production-accepted |
| **PARTIAL** | Some approved scope implemented; a recorded gap remains |
| **NOT STARTED** | Named in approved architecture, no implementation |
| **DEFERRED BY APPROVED ARCHITECTURE** | A controlled record explicitly defers it, or excludes it from the current version |
| **OUTSIDE ATM-001** | Belongs to another Atiman domain |
| **ADJUDICATION REQUIRED** | Neither implemented nor explicitly deferred; only the OWNER can authorise or defer it |

Gate columns: **L** = LCQE required, **V** = VUDA required, **D** = deployment required.

---

## 2. Executed milestones

| # | Milestone | Approved purpose | Merge evidence | Implementation state | Completion evidence | Remaining gap |
|---|---|---|---|---|---|---|
| 1 | **M1** governed publication admission | Governed knowledge must be reviewed, safety-attested, evidenced and approved by a principal other than the publisher | PR **#28** `b7ae6ee`; PR **#29** `f20751a` (production migration safety) | COMPLETE | `chk_task_template_versions_requires_governance`, `chk_task_template_versions_approver_not_publisher`, publisher FK `ON DELETE RESTRICT`; smoke test asserts each by definition fragment | none |
| 2 | **M2** Knowledge Pack membership | Immutable pack composition | PR **#31** `119dfc6` | COMPLETE | `knowledge_pack_version_task_template_versions` + membership guard (`FOR SHARE`), scope-compatibility triggers | none |
| 3 | **M3** governed provenance authoring | Authority/edition registry and evidence | PR **#32** `2caef23` | COMPLETE | migrations 011; `knowledge_sources` → `knowledge_source_versions` → evidence; confidence/role vocabularies | none |
| 4 | **M4** pack publication admission | A released pack version is held to the same governance standard as its members | PR **#33** `dec7a7b` | COMPLETE | migration 015; `chk_knowledge_pack_versions_requires_governance`, `…_approver_not_publisher` | pack rejection state deliberately not implemented (record M4) |
| 5 | **ATM-001H** migration 011 convergence | Migration 011 hygiene after knowledge versioning | PR **#34** `686acbb` | COMPLETE | migration 011 converged; canonical PostgreSQL migration safety in `scripts/migrate-postgres.js` | none |
| 6 | **M5R.1** equipment identity architecture | Canonical identity model and the gap register `ARCHITECTURE_GAP-1..3` | PR **#35** `434b84e` | COMPLETE (as architecture) | record `ATM-001-M5R1-…`; `ARCHITECTURE_GAP-1` resolved by M5R.3B–3E | `ARCHITECTURE_GAP-2`, `ARCHITECTURE_GAP-3` (§4) |
| 7 | **M5R.2 / 2A** legacy taxonomy provenance | Correct false ISO provenance of design artifacts | PR **#35** `434b84e`; PR **#36** `3c6f869` | COMPLETE | artifact renamed to `database/odm_legacy_equipment_taxonomy_design.v1.json`, verified 213,984 bytes, sha256 `cf7eece1…` | `FALSE_PROVENANCE_REMEDIATION_REQUIRED` (D9, §4) |
| 8 | **M5R.3** standards crosswalk architecture | Governed external-classification relationship, authorised as Option C | PR **#37** `f82f968` | COMPLETE (architecture + implementation) | record; implementation in rows 9–12 | §W/§X proposed alternatives never adopted (by design) |
| 9 | **M5R.3A** authority/edition groundwork | Readiness: existing model sufficient, no schema change | PR **#38** `138299d` | COMPLETE (readiness record) | record `ATM-001-M5R3A-…` | item **D**: executable OWNER registration mechanism — **deferred, not in V1** (§4) |
| 10 | **M5R.3B** external classification foundation | Migration 016 | PR **#39** `066b92a` | COMPLETE | migration 016 | none |
| 11 | **M5R.3C** governed crosswalk | Migration 017 | PR **#40** `9b1aea2` | COMPLETE | migration 017; immutability/delete-guard/supersession/edition-coherence triggers | none |
| 12 | **M5R.3D** crosswalk evidence foundation | Migration 018 | PR **#41** `326069b` | COMPLETE | migration 018; exactly-one-subject CHECK; global-scope guard | evidence rows are mutable working evidence by design (M5R.3: "no snapshot to freeze") |
| 13 | **M5R.3E** crosswalk application layer | Application seam | PR **#42** `13f68ba` | COMPLETE | application layer merged; frozen in the attributed migration-tail assertion | none |
| 14 | **M5R.4A** equipment type reconciliation | Decision package; no taxonomy mutation | PR **#43** `abfd6c8` | COMPLETE (as decision package) | record; dispositions accepted and frozen by M5R.4B1 | D1, D7 naming/structural debt (§4) |
| 15 | **M5R.4B1** identity lifecycle architecture | OWNER-ratified, frozen architecture | PR **#44** `82c6613` | COMPLETE (as architecture) | record + §21 ratification; §18 deferred register D1–D14 | D1–D14 (§4) |
| 16 | **M5R.4B-019** identity lifecycle mechanism | Migration 019 | PR **#45** `f07c916` | COMPLETE | migration 019; production identity states `canonical, retired, superseded` | none |
| 17 | **M5R.4B2** taxonomy application | Canonical-only resolution; governed application | PR **#46** `7d93479`; PR **#47** `9aca5d6` | COMPLETE | merged; production taxonomy 66 categories / 316 classes / 283 types | none |
| 18 | **M6.1** maintenance corpus reconciliation | Reconcile the corpus against the ratified rubric | PR **#48** `e1037e2` | COMPLETE (reconciliation only) | record; register of 10 decisions `M6R1-D01…D10` | D03/D05/D07/D08/D09 OPEN (§4) |
| 19 | **M6.2** maintenance knowledge architecture | Decision of record for the D01–D10 set | PR **#50** `6c918988` (record closure) | COMPLETE | record; D01/D02/D04/D06/D10 realised | none |
| 20 | **M6.3** governed knowledge foundation | Migration 020: governed definitions, versions, applicability, admission, immutability | PR **#49** `ffcfe297` | COMPLETE | migration 020; frozen suite 48/48 (amended identity `71e4f725…`, migration 020 sha256 `c14a3d53…` unchanged); production accepted | G1/G2 (§4) |
| 21 | **M6.4 policy** (Steps 1–2) | OWNER-ratified source/evidence/AI policy | PR **#50** `6c918988` | COMPLETE | record `ATM-001-M6.4-…` §3–§10 ratified | §11 G1/G2, §12 five OPEN decisions, §13 proprietary containment (§4) |
| 22 | **M6.4 Step 3A/3B** governed authoring | Draft-only authoring primitive | PR **#51** `05a92c0c` | COMPLETE | merged, deployed, production accepted | none |
| 23 | **M6.4 Step 3B-A/3B-B** AI-assistance disclosure | Definition-level disclosure, retirement of publish-time parameters, admission A3, approval binding | PR **#52** `209027385ed0…` | COMPLETE | migration 021 (`d35010bf…`); suite 25/25; sanctioned integration 680/680; VUDA 29/29; deployed `dep-das96o0ae00c73atmnd0`; production accepted; LCQE PASS | none |
| 24 | **Record accuracy R1** | Correct four stale implementation-status claims | PR **#53** `4cb612b70f…` | COMPLETE | 4 claims corrected with verified merge evidence; docs-only | none |
| 25 | **Record accuracy R2** | Close the class: five further stale claims found by class sweep | PR **#54** `6b26c0eb70…` | COMPLETE | 5 claims corrected; every asserted merge/commit/migration verified against git | none |

Every milestone above passed its required gates: **LCQE** for each implementation candidate, **VUDA**
at each governed-semantic boundary (M6.3, M6.4 Step 3B, Step 3B-B), and **deployment + production
acceptance** wherever schema was involved.

---

## 3. OWNER-adjudicated deferrals — ATM-001 V1 (2026-09-27)

The OWNER / Chief Architect adjudicated the four concepts that were previously recorded here as
"neither implemented nor deferred". **All four are DEFERRED from ATM-001 V1.** These are **governed
deferrals**: they are not declarations that the capabilities will never exist, they are not
cancellations, and **no implementation was performed**. Each remains discoverable for future
architectural adjudication through the trigger recorded below.

| Concept | Disposition | Reason (OWNER) | V1 completion impact | Future architectural trigger | Decision date | Implementation |
|---|---|---|---|---|---|---|
| **Knowledge-version effective dates** | **DEFERRED from ATM-001 V1** | "The V1 Knowledge Foundation already governs identity, approval, versioning and publication. Temporal applicability, supersession and effective-dating semantics shall be designed when an approved Knowledge Services / consumption capability requires them." | None — not required for V1 correctness | When an approved Knowledge Services / consumption capability requires temporal applicability, supersession or effective-dating semantics | 2026-09-27 | **None performed** |
| **Knowledge Pack adoption records** | **DEFERRED from ATM-001 V1** | "ATM-001 §10.3 explicitly identifies the adoption mechanism as an open architectural question pending ATM-002. ATM-001 shall not pre-empt that decision." | None — V1 does not pre-empt the ATM-002 question | ATM-002 (Experience Architecture) / the §10.3 adoption-mechanism decision | 2026-09-27 | **None performed** |
| **Knowledge-to-knowledge dependency resolution** | **DEFERRED from ATM-001 V1** | "Dependency resolution introduces graph, compatibility and cascading lifecycle semantics that are not prerequisites for the governed V1 Knowledge Foundation." | None — not a prerequisite for governance of V1 knowledge | When graph/compatibility/cascading-lifecycle semantics are required by an approved capability | 2026-09-27 | **None performed** |
| **Contribution-request entity** | **DEFERRED from ATM-001 V1** | "Contribution requests are collaboration/workflow capability around future knowledge evolution, not a prerequisite for the V1 foundation's governed storage, provenance, authoring, approval, versioning and publication." | None — collaboration workflow is not a V1 foundation prerequisite | When an approved knowledge-evolution / collaboration capability is designed | 2026-09-27 | **None performed** |

**Effect on the V1 completion assessment.** With these four governed deferrals recorded, the
previously unmet condition of the campaign's completion standard — "every approved ATM-001 milestone
is complete **or explicitly governed-deferred**" — is satisfied. No deferred capability is asserted to
be implemented anywhere in this ledger, and none is asserted to be cancelled.

## 4. Deferred by approved architecture (explicitly recorded deferrals)

These are **not** gaps in execution: each carries an explicit deferral, exclusion or revisit trigger in
an approved record, and is therefore satisfied under the campaign's completion standard.

| Item | Recorded in | Deferral / exclusion, and trigger |
|---|---|---|
| **D03** inspection-point anchor | M6.4 policy §12; register entry `owner_decision_required: true` | **OPEN**; "not a prerequisite for a bounded single-Equipment-Type authoring slice unless direct evidence proves otherwise" |
| **D05** decomposition identity space | M6.4 policy §12 | **OPEN** |
| **D07** false-provenance remediation (activity/cause codes) | M6.4 policy §12; M6.1 §13 (35 rows inventoried) | **OPEN**; M6.1 rewrote nothing |
| **D08** retired-type content target | M6.4 policy §12 | **OPEN** |
| **D09** endpoint procedure for Type 284 | M6.4 policy §12 | **OPEN** |
| **G1** rights/licence status not structurally represented | M6.4 policy §11 | Dated debt; must be resolved before the first procedure is authored from material whose rights are not established |
| **G2** evidence subjects template XOR step | M6.4 policy §11 | Dated debt; must be resolved before a safety-control or applicability claim is asserted as type-specific evidenced knowledge |
| **`ARCHITECTURE_GAP-2`** tenant/customer alias layer — mandatory requirement currently unsatisfied | M5R.1 §6.2, §298–300; M5R.4B1 §15.8, D2 | "The isolation requirement is mandatory. Only its implementation is deferred" — to a decision coordinated with Platform Foundation / tenancy architecture |
| **`ARCHITECTURE_GAP-3`** / **D6** decomposition architecture | M5R.1 §6.1; M5R.4B1 §18 D6 | Level count OPEN; 5 `NOT_EQUIPMENT_TYPE` rows refer to it |
| **M5R.3A item D** executable OWNER authority-registration mechanism | M5R.3A §3.3 | Explicitly **not in V1**: "no new authorization capability is created in V1"; required before any crosswalk population (production crosswalks: 0) |
| **ATM-013D2 deferrals** `knowledge_governance_events`, `knowledge_evidence`, `knowledge_entity_evidence`, further AI-governance tables | ATM-013D2 status notice | "Deferred / not approved for implementation by this task" |
| **M5R.4B1 D1** category naming/scope refinement | M5R.4B1 §18 | Not a placement blocker; consolidation prohibited |
| **M5R.4B1 D3** taxonomy delete-guard hardening (`class_id`/`category_id` CASCADE → RESTRICT/guard) | M5R.4B1 §15.7, §18 D3 | Verified still applicable: both FKs remain unguarded `ON DELETE CASCADE`; described as "a real knowledge-destruction vector"; schema change prohibited in that mission |
| **M5R.4B1 D4/D5/D7/D10/D11** contextual term resolution; effectivity-aware reporting; 166 same-name pairs / dual-category scheme; ratification state for the 282; global duplicate-name detection | M5R.4B1 §18 | Each deferred with a stated reason |
| **M5R.4B1 D9** `FALSE_PROVENANCE_REMEDIATION_REQUIRED` incl. the live `"ISO 14224 taxonomy"` string in `asset-import.service.js` | M5R.4B1 §4.3, §18 D9 | Out of scope; also bounded by M6.4 §13 proprietary-material boundary |
| **M5R.4B1 D12/D13** `REPOSITORY_GOVERNANCE_HARDENING_REQUIRED` (no branch protection/rulesets on `main`); `PROJECT_SOURCE_SYNCHRONIZATION_REQUIRED` | M5R.4B1 §18 | Standing recorded debt |
| **M5R.4B1 D14** `YEAR(created_at)` defect in `src/models/work-order.model.js` | M5R.4B1 §18 | Explicitly unrelated to ATM-001 |
| **Proprietary material containment** | M6.4 policy §13 | "Containment is a separate bounded mission" |
| **Marketplace** | ATM-000 §15.8, §23; ATM-001 Decision 8 | Proposed Future Architecture |
| **Equipment Family** | M5R.1 §2.1; M5R.4B1 §4.4, D8 | Permanently **excluded** (not deferred) |

---

## 4a. Adjudication of every other open / deferred item

Each item below was tested against a single question: **is it required for ATM-001 V1 correctness?**
"Correctness" means: does its absence create a contradiction with Knowledge Before Transactions,
governed knowledge identity, provenance, evidence, authoring, approval, versioning, publication,
tenant/organization isolation, Knowledge Packs, AI disclosure, or human accountability? No item was
implemented during this adjudication.

| Item | What the approved record actually says | Required for V1 correctness? | Contradiction check |
|---|---|---|---|
| **M6.1 D03** inspection-point anchor | "remain **OPEN**"; "not prerequisites for a bounded single-Equipment-Type authoring slice unless direct evidence proves otherwise" (M6.4 §12) | **No** — GOVERNED-DEFERRED / OPEN | None: inspection-point *anchoring* is a knowledge-modelling choice for a future authored slice, not a property of the implemented governance |
| **M6.1 D05** decomposition identity space | OPEN (M6.4 §12); decomposition architecture excluded from ATM-001 | **No** — GOVERNED-DEFERRED / OPEN | None: decomposition is explicitly outside the governed V1 boundary (also permanently excluded, §5) |
| **M6.1 D07** false-provenance remediation | OPEN; M6.1 inventoried 35 rows and rewrote nothing | **No** — GOVERNED-DEFERRED / OPEN | None: it concerns *legacy data quality*, not the governance model; V1 makes no claim about those rows' standards conformance |
| **M6.1 D08** retired-type content target | OPEN (M6.4 §12) | **No** — GOVERNED-DEFERRED / OPEN | None |
| **M6.1 D09** endpoint procedure for Type 284 | OPEN (M6.4 §12) | **No** — GOVERNED-DEFERRED / OPEN | None |
| **G1** rights/licence status not structurally represented | Dated debt; "must be resolved before the first procedure is authored from a licensed standard or a customer-supplied document whose rights are not already established" | **No, not yet** — event-triggered debt; trigger has **not fired** (production: 0 authored definitions) | None in V1: no procedure has been authored from such material |
| **G2** evidence subjects template XOR step | Dated debt; "must be resolved before the first safety control or applicability claim is asserted as *type-specific evidenced* knowledge" | **No, not yet** — event-triggered debt; trigger has **not fired** (production: 0 safety controls, 0 versions) | None in V1: no type-specific evidenced claim exists; template-level safety review remains the operative attestation |
| **`ARCHITECTURE_GAP-2`** tenant/customer alias layer | M5R.1 §6.2: requirement mandatory, implementation deferred to a decision coordinated with Platform Foundation / tenancy; M5R.4B1 states the isolation mechanism the requirement needs "already exists at the provenance layer" | **No** — see the §4b determination | **None**: core knowledge remains uncontaminated and tenant isolation is enforced |
| **M5R.3A item D** executable OWNER authority-registration mechanism | "Future implementation — NOT IMPLEMENTED. NOT IN THIS PR."; "no new authorization capability is created in V1" | **No** — explicitly excluded from V1 | None: crosswalk population is a future gated capability (production crosswalks: 0); implementing it would override an approved record |
| **ATM-013D2 deferrals** (`knowledge_governance_events`, `knowledge_evidence`, `knowledge_entity_evidence`, further AI-governance tables) | "Deferred / not approved for implementation by this task" | **No** — GOVERNED-DEFERRED | None: V1 governance does not depend on an event stream or on those additional tables |
| **M5R.4B1 D1–D14** (naming/scope refinement, tenant alias layer, delete-guard hardening, contextual term resolution, effectivity-aware reporting, decomposition, duplicate-name detection, false-provenance remediation, ratification state, repository-governance hardening, Project Source synchronisation, unrelated work-order defect) | Recorded with an explicit reason per item (§4) | **No** for V1 correctness; D12/D13 are standing *process* debt, D14 is explicitly unrelated | None: no V1 governance invariant depends on them. D3 (taxonomy delete-guard) is a recorded risk, not an active contradiction — no deletion path is exercised and the taxonomy is unreferenced by any delete flow |
| **Proprietary material containment** | "a separate bounded mission" | **No** — separate mission by the record's own words | None: containment is about not *reading* that material; V1 reads none |
| **Marketplace** | Proposed Future Architecture (ATM-000 §15.8, ATM-001 Decision 8) | **No** — not approved | None: marketplace fields carry explicit "not assignable" constraints |

## 4b. Special review — `ARCHITECTURE_GAP-2` (tenant/customer alias layer)

The ledger previously reported the source record's words: *"The isolation requirement is mandatory.
Only its implementation is deferred."* That wording was **not** reinterpreted; it was resolved against
the record's own later, OWNER-ratified authority.

**Mandatory for WHAT.** The requirement is that **customer-specific terminology and proprietary
knowledge must not contaminate Atiman Core Knowledge** — i.e. the canonical taxonomy stays global and
uncontaminated. It is a *non-contamination* requirement, not a requirement that a tenant terminology
capability exist.

**Mandatory at WHICH architectural stage.** M5R.1 defers only "the exact architecture" of the alias
layer, "to be taken in coordination with Platform Foundation / tenancy architecture". It does not make
the alias layer a precondition of the taxonomy's correctness.

**Is current isolation already correct without it.** **Yes, on both layers, and this is measured:**
- *Structural:* **no taxonomy table carries tenant scope** — `equipment_categories`, `equipment_classes`,
  `equipment_types`, `equipment_type_term`, `equipment_type_identity_resolution` and
  `equipment_type_external_classification` have **no `organization_id` column**. Customer terminology
  therefore has **no representable home inside the taxonomy**; contamination is not merely prevented,
  it is unrepresentable.
- *Provenance:* the later OWNER-ratified record states the isolation mechanism the requirement needs
  "already exists at the provenance layer". Verified directly:
  `uq_knowledge_sources_code_org UNIQUE NULLS NOT DISTINCT (organization_id, source_code)`, with
  `organization_id` NULL = global and non-NULL = tenant (`fk_knowledge_sources_organization`). This is
  where customer material is held, tenant-scoped.
- *Behavioural:* cross-organization knowledge create, edit and read are all **refused** (VUDA H1:
  `ACTOR_ORGANIZATION_MISMATCH`, `KNOWLEDGE_AUTHORING_NOT_FOUND`, `KNOWLEDGE_AUTHORING_NOT_FOUND`).
  `equipment_type_term` exists but is a **global** governed identity-lifecycle registry (migration 019,
  no `organization_id`) — it is not, and cannot act as, a tenant alias layer.

**Determination.** `ARCHITECTURE_GAP-2` is **not required for ATM-001 V1 correctness**, and the
deferred item `M5R.4B1 D2` (tenant/customer alias layer) does **not** create a present isolation
bypass. **Exact future gate:** the alias layer's architecture must be decided — coordinated with
Platform Foundation / tenancy — **before any capability that lets a customer attach their own
terminology to canonical Atiman identity is implemented**. Until then, accommodating customer
terminology inside the global taxonomy would *violate* the requirement rather than satisfy it.

## 4c. Special review — G1 / G2

- **Expired dates?** No. Neither item carries a date or a deadline. "Dated architectural debt" means
  the debt was *identified at a known point*; M6.4 §11 expresses both as **event-triggered** revisit
  conditions, not calendar deadlines.
- **Explicit completion deadlines?** None exist.
- **Correctness / security / tenancy consequences in V1?** None, because neither trigger has fired:
  production holds **0 authored definitions** (G1's trigger: authoring a procedure from a licensed
  standard or a customer-supplied document whose rights are not established) and **0 safety controls /
  0 versions** (G2's trigger: asserting a safety-control or applicability claim as type-specific
  evidenced knowledge). Both were verified by read-only production inspection.
- **Merely future hardening?** G2 is a granularity limitation (evidence attaches at template XOR step
  granularity, so safety-control and applicability claims cannot carry their own evidence row); the
  approved V1 attestation for safety remains the **template-level safety review**, which is enforced —
  `SAFETY_NOT_ASSESSED` / `SAFETY_STATE_INVALID` / `SAFETY_REVIEW_ATTRIBUTION_MISSING` /
  `SAFETY_CONTROLS_MISSING`. G1 is a *rights representation* gap that becomes material only when
  licensed or customer-restricted material is authored from.
- **Determination:** **neither G1 nor G2 blocks ATM-001 V1.** A passed date would not have been
  permission to defer again — there is no date to pass. Both remain recorded with their exact future
  gates, and their triggers are verified un-fired, not assumed un-fired.

## 5. Outside ATM-001

Named in the product roadmap but belonging to other domains (ATM-000 §23 lists them as *Proposed
Future Architecture*): Inspections & Operator-Driven Maintenance, Finding Assessment &
Prioritization, Asset Intelligence MVP, Enterprise Integration design, Knowledge Pack marketplace
design, Experience Architecture (ATM-002), Platform Foundation (ATM-003).

The campaign's §23 instruction therefore applies: after ATM-001, **stop** and return to the OWNER
for roadmap transition. No other domain was started.

---

## 6. Verification evidence recorded by this ledger

**Production acceptance** (read-only, `BEGIN TRANSACTION READ ONLY`): deployed revisions for this
campaign — `209027385ed0…` (Step 3B-B), `4cb612b70f…`, `6b26c0eb70…` (record accuracy) and
`922a0405f3…` (this ledger); `/health` and `/api/health` 200 at each; pre-deploy
`[21/21] applying 021_ai_assistance_disclosure.sql ... ok`, `SUCCESS: 21/21`,
`PostgreSQL smoke test PASSED`.

**Production corpus (unchanged throughout):** 846 definitions (ids 1100–1945, contiguous), 3,099
steps, 846 applicability anchors (all primary), 846 `legacy_generated`, 0 authored, 0 versions, 0
packs, 0 crosswalks, taxonomy 66/316/283 with identity states `canonical, retired, superseded`,
`ai_assisted` NULL ×846 and FALSE ×0, 1 user, 0 organizations. Governed semantics on the corpus are
deliberately unset (type/family/strategy/trigger/scope NULL; legacy clearance 0/846) — the ratified
position that the corpus is a reference aid, not governed knowledge.

**Schema state:** 91 tables; 13 immutability guards; 1 database-level publication-admission trigger;
scope/organization CHECKs on templates and packs; AI-disclosure coherence constraint; no
due-date/scheduled-occurrence column in any knowledge table.

**Gate results at the final revision:** Step 3B-B suite 25/25 · sanctioned native PostgreSQL
integration 680/680 · `npm test` 138/138 · database-test-guard 80/80 · governed foundation 48/48 ·
Step 3B-B VUDA 29/29 · **final whole-ATM-001 VUDA 29/29** (fresh, independent: own database, own
fixtures, areas A–L — knowledge identity, provenance, authoring, approval, versioning, publication,
Knowledge Packs, tenancy, legacy preservation, migration integrity, product boundary, AI boundary).

**Final production reconciliation (§9 of the closure mission), read-only:** endpoint columns
`ai_assisted` + `ai_assistance_detail`; `chk_task_templates_ai_assistance_coherence` present;
13 immutability guards; 1 database-level admission trigger; corpus `846 / 3,099 / 846 applicability /
0 safety controls / 0 versions / 0 step versions`; origins `846 legacy_generated / 0 authored /
0 other`; AI disclosure `846 NULL / 0 FALSE / 0 TRUE / 0 detail`; `0 packs / 0 pack versions /
0 crosswalks / 0 external classifications / 0 crosswalk evidence`; identity range `1100–1945` with
**0 gaps**; **0 rows of any knowledge table created since the campaign began**; 1 user, 0
organizations. No unexplained drift.

**Record-accuracy audit:** 9 stale status claims corrected across 6 records (PRs #53, #54); all 22
hashes asserted in ATM-001 records exist and every stated commit→tree relationship matches; 52
referenced paths resolve (2 are documented historical paths renamed in M5R.2A); the recorded
213,984-byte `cf7eece1…` artifact hash matches.

---

## 7. Completion assessment (campaign §21)

| Condition | Status |
|---|---|
| Every approved ATM-001 milestone complete **or explicitly governed-deferred** | **MET** — the 25 executed milestones in §2 are complete; the four previously unresolved concepts are now **OWNER-adjudicated governed deferrals** (§3), and every other open item is adjudicated in §4a–§4c |
| No BLOCKER remains | MET |
| No unresolved MAJOR threatens Knowledge Foundation correctness | MET — deferred items are recorded with evidence, not latent defects; no deferred item contradicts a V1 invariant (§4a) |
| All required LCQE gates passed | MET |
| All required milestone VUDAs passed | MET |
| Final whole-ATM-001 VUDA passes | MET — 29/29, fresh and independent (§6) |
| Production reconciliation passes | MET — no drift, no fabrication, no unauthorised content (§6) |
| Controlled records accurately describe current architecture | MET — record-accuracy audit and remediations (§6); 9 stale claims corrected across 6 records |
| No unauthorised scope entered the product | MET — product and AI boundaries verified in the final VUDA (K1, L1) |

**Consequence:** every condition is satisfied within the governed V1 boundary recorded in §8. ATM-001
Knowledge Foundation V1 is complete; see the completion record in §9.

---

## 8. ATM-001 V1 completion boundary

**ATM-001 V1 provides the governed foundation for maintenance and engineering knowledge.** The
boundary below is stated from implemented, verified truth only. No capability is claimed that does not
exist.

**Within the V1 boundary — implemented, merged, deployed and production-accepted:**

| Capability | What is actually implemented |
|---|---|
| **Taxonomy** | Equipment categories / classes / types with a governed identity lifecycle (`equipment_type_identity_resolution`, `equipment_type_term`), identity states `canonical / superseded / retired`, canonical-only import resolution with ambiguity refused, cross-tenant resolution refusals, and a global (untenanted) canonical taxonomy |
| **Maintenance knowledge** | Task definitions, steps, safety controls, and Equipment-Type applicability as governed first-class knowledge |
| **Applicable inspection knowledge** | Governed via the same substrate; `INSPECTION_TEMPLATE` is a seeded knowledge type — no separate inspection governance stack exists or is claimed |
| **Safety knowledge** | Safety controls with an explicit attributed safety-review state (`not_assessed`, `reviewed_no_control_required`, `reviewed_controls_defined`) and admission rules enforcing the attestation; per-control provenance is explicitly out of scope (G2) |
| **Provenance** | `knowledge_sources` → `knowledge_source_versions` authority+edition registry with tenant/global isolation (`UNIQUE NULLS NOT DISTINCT (organization_id, source_code)`), source categories, publication/effective dates, content hash |
| **Evidence** | Working (`knowledge_template_evidence`) and frozen (`knowledge_template_version_evidence`) evidence with confidence and supporting-role vocabularies, exactly-one-subject enforcement, tenant-scope guards, immutable frozen rows, and `ON DELETE RESTRICT` accountability linkage |
| **Governed authoring** | Draft-only authoring primitive: explicit accountable actor (absent / inactive / foreign refused), organization ownership verified against resulting state, `FOR UPDATE` locking, whitelist-only writable columns, draft completeness reporting, and an explicit refusal to author over legacy/system knowledge |
| **Legacy protection** | Immutable `content_origin`, accountable legacy clearance, legacy-generated knowledge exempt from the disclosure requirement, and no historical rewrite anywhere |
| **Approval** | Review state machine `draft → under_review → approved / rejected`, mandatory attributed reviewer/approver, segregation of duties, and approval bound to a content fingerprint |
| **Semantic fingerprints** | One canonical fingerprint over material governed fields (including the AI disclosure) plus applicability; changing any material field stales the approval; no parallel approval mechanism exists |
| **Versioning** | Immutable published versions with monotonic per-definition version numbers, sealed step sets, frozen evidence and applicability, and historical versions provably unrewritten |
| **Immutable publication** | Publication admission that fails closed with every reason before the first irreversible write, mirrored by a database-level admission trigger, with 13 immutability guards across the frozen tables |
| **Knowledge Packs** | Pack identity and versions, immutable membership guarded by a locking guard, scope compatibility, publication admission requiring every member to be an already-published immutable version |
| **AI-assistance disclosure** | Declaration on the working definition, frozen into the version and every step version, `NULL ≠ FALSE` preserved, participation in the approval fingerprint, and a publish-time refusal of the retired parameters |
| **Organization / tenant governance as implemented** | `shared` / `customer` scope with explicit organization binding, cross-tenant create/edit/read refusals, and provenance-layer global/tenant isolation for sources |

**Explicitly NOT within the V1 boundary (governed deferrals — see §3 and §4):** knowledge-version
effective dates; Knowledge Pack adoption records; knowledge-to-knowledge dependency resolution;
contribution-request entity; the tenant/customer terminology alias layer; the executable OWNER
authority-registration mechanism; decomposition architecture; `knowledge_governance_events` and the
ATM-013D2-deferred tables; marketplace; and the event-triggered debt G1/G2.

---

## 9. ATM-001 V1 completion record

# ATM-001 KNOWLEDGE FOUNDATION V1 — COMPLETE

| Element | Record |
|---|---|
| **Completion date** | 2026-09-27 |
| **Accepted production revision** | `922a0405f3bbfa52d2d34d46368912c3295eea94` |
| **Migration endpoint** | `021_ai_assistance_disclosure.sql` — chain 001–021, forward-only, idempotent under the established convention (no applied-migrations ledger; every file re-applied and verified `21/21` in production) |
| **Corpus reconciliation** | 846 definitions (ids 1100–1945, contiguous, 0 gaps) · 3,099 steps · 846 applicability anchors · 846 `legacy_generated` · **0 authored** · **0 published versions** · 0 packs · 0 crosswalks · `ai_assisted` **NULL ×846, FALSE ×0** · 0 knowledge rows created by any deployment |
| **Milestone ledger** | §2 — 25 executed milestones (M1 → M6.4 Step 3B-B, plus two record-accuracy remediations), each with merge revision and completion evidence |
| **LCQE result** | PASS at each implementation candidate, including the final closure-record review |
| **Final VUDA result** | **29/29 PASS** — fresh whole-ATM-001 VUDA across areas A–L (§6) |
| **Governed deferrals** | The four OWNER-adjudicated deferrals (§3) plus every explicitly recorded deferral (§4, §4a–§4c) |
| **Future architectural triggers** | Recorded per deferred item: Knowledge Services/consumption capability (effective dates); ATM-002 / §10.3 (pack adoption); approved capability requiring graph/compatibility semantics (dependencies); knowledge-evolution/collaboration capability (contribution requests); Platform Foundation/tenancy-coordinated decision (tenant alias layer); first crosswalk population (OWNER registration mechanism); first licensed or customer-restricted authored procedure (G1); first type-specific evidenced safety/applicability claim (G2) |

**The foundation is complete within its explicitly governed V1 boundary.** No deferred capability is
complete, and none is claimed to be. The deferrals are governed decisions that remain discoverable for
future architectural adjudication through the triggers above.

## 10. What this ledger does not do

The ledger document itself authorises no implementation, creates no milestone, amends no architecture
decision, and alters no schema, code or data. The deferrals recorded in §3 are **OWNER decisions
recorded here**; the completion statement in §9 records the outcome of the OWNER's V1 closure
adjudication against the evidence assembled in this ledger.
