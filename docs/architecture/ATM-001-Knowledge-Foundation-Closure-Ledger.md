# ATM-001 Knowledge Foundation — Closure Ledger

**Document ID:** ATM-001-CL
**Status:** Record of execution and classification. **This ledger decides nothing.** It records what
was executed, what each remaining item's *existing* authority is, and which items require an OWNER
decision. It creates no milestone, authorises no implementation and defers nothing on its own
authority.

**Baseline of record:** `origin/main` = `6b26c0eb70aa6d2958b3edcc01cd29aaafb7c70b`
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

## 3. Items requiring OWNER adjudication (campaign §18‑B / §18‑J)

Named in approved architecture, but **no controlled record authorises implementation and none defers
them**. Implementing any of these would require a new product/architecture decision, which is an OWNER
act. Bounded-PR boundary is stated so that authorisation can be given precisely.

| Item | Approved source naming it | Current state | Remaining gap | Bounded PR boundary if authorised | L | V | D |
|---|---|---|---|---|---|---|---|
| **Knowledge-version effective dates** | ATM-001 §8.3, §15, §17 | NOT STARTED — the governed model deliberately cannot express a date (M6.3 §2.4); effective dates exist only on the *source* registry (`knowledge_source_versions`) | No version effectivity window is representable | One migration + admission rule + freeze semantics | ✓ | ✓ | ✓ |
| **Knowledge Pack adoption records** | ATM-001 §10.3, §17 | NOT STARTED — §10.3 states the mechanism "is an **open architectural question** pending ATM-002 / implementation review" | Which tenants hold which pack versions | Undetermined until the §10.3 question is decided | ✓ | ✓ | ✓ |
| **Knowledge-to-knowledge dependency resolution** | ATM-001 §6.2, §17 | NOT STARTED | Pack dependency expression and resolution | Undetermined | ✓ | ✓ | ✓ |
| **Contribution-request entity** | ATM-001 §15, §17 (replaces `equipment_type_family_proposals`) | NOT STARTED — legacy table still exists, empty, ungoverned; legacy disposition recorded `REJECT_TEST_OR_DEMO` in M6.1 | A governed contribution workflow in place of an ad-hoc proposal table | Undetermined | ✓ | ✓ | ✓ |

**Why this ledger does not resolve them:** classifying an item as implemented, or deferring it, is a
governance decision. This ledger reports the evidence; the OWNER decides.

---

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

## 5. Outside ATM-001

Named in the product roadmap but belonging to other domains (ATM-000 §23 lists them as *Proposed
Future Architecture*): Inspections & Operator-Driven Maintenance, Finding Assessment &
Prioritization, Asset Intelligence MVP, Enterprise Integration design, Knowledge Pack marketplace
design, Experience Architecture (ATM-002), Platform Foundation (ATM-003).

The campaign's §23 instruction therefore applies: after ATM-001, **stop** and return to the OWNER
for roadmap transition. No other domain was started.

---

## 6. Verification evidence recorded by this ledger

**Production acceptance of the final accepted revision** (read-only, `BEGIN TRANSACTION READ ONLY`):
deployed revision `209027385ed0…` then `4cb612b70f…` then `6b26c0eb70…`; `/health` and `/api/health`
200; pre-deploy `[21/21] applying 021_ai_assistance_disclosure.sql ... ok`, `SUCCESS: 21/21`,
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
Step 3B-B VUDA 29/29.

**Record-accuracy audit:** 9 stale status claims corrected across 6 records (PRs #53, #54); all 22
hashes asserted in ATM-001 records exist and every stated commit→tree relationship matches; 52
referenced paths resolve (2 are documented historical paths renamed in M5R.2A); the recorded
213,984-byte `cf7eece1…` artifact hash matches.

---

## 7. Completion assessment (campaign §21)

| Condition | Status |
|---|---|
| Every approved ATM-001 milestone complete **or explicitly governed-deferred** | **NOT MET** — §3 lists four items that are neither |
| No BLOCKER remains | MET |
| No unresolved MAJOR threatens Knowledge Foundation correctness | MET (deferred items are recorded, not latent-defect) |
| All required LCQE gates passed | MET |
| All required milestone VUDAs passed | MET |
| Final whole-ATM-001 VUDA passes | MET (with the observations in §4) |
| Production reconciliation passes | MET |
| Controlled records accurately describe current architecture | MET (verified by the audit in §6) |
| No unauthorised scope entered the product | MET |

**Consequence:** the decisive unmet condition is the first. Until the four items in §3 are
individually either implemented or explicitly deferred by the OWNER, ATM-001 Knowledge Foundation
cannot be declared complete.

---

## 8. What this ledger does not do

It does not authorise implementation, does not defer anything on its own authority, does not create
a milestone, does not amend any architecture decision, and does not alter any schema, code or data.
It records execution, classification and evidence so that the OWNER's remaining decision can be taken
against a complete and checkable picture.
