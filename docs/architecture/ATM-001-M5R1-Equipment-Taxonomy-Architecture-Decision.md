# ATM-001 M5R.1 — Atiman Canonical Equipment Identity Architecture Decision

**Status:** Accepted by OWNER — with **two open items** (decomposition level count; customer/tenant isolation).
**Baseline:** `origin/main` = `686acbb3fdabca762fd13eb5a14cd8ffdadee87e` (ATM-001 M1–M4 + ATM-001H complete).
**Scope of this record:** documentation only. No schema, migration, seed, code, branch, commit, PR or deployment was made.
**Supersedes:** any M5R statement implying ISO 14224 is Atiman's universal cross-industry equipment taxonomy.

**Revision history**

| Revision | Change |
|---|---|
| M5R.1 | Record first drafted: decision, evidence, rejected options, open items. |
| **M5R.2** | §7 crosswalk principles (`review status`, nullable `external_classification`) recorded as **APPROVED** by OWNER. §6.2 reframed: the customer-isolation **requirement is mandatory**, only its **implementation** is deferred — this is a deferred gap, **not** accepted contamination. §11 expanded with generator-based authorship proof and the reasons the rename/consolidation was deferred. §13 gained explicit **NON-DECISIONS**. §15 research-artifact disposition **executed**. §17 added: Project Source absent; out-of-scope documentation debt recorded. |
| **M5R.2A** | Legacy-taxonomy hygiene: artifact renamed to `database/odm_legacy_equipment_taxonomy_design.v1.json`, root byproduct removed, legacy tool paths made script-relative, false-provenance wording removed at source. §11.2 marked historical; §11.3 records the executed correction. **No architecture change; taxonomy content byte-identical.** |

---

## 1. Decision

Atiman owns a **canonical cross-industry equipment identity**. External standards and engineering
authorities **map to and substantiate** that identity; **no single external standard owns it**.

This supersedes the M5R premise that ISO 14224 would serve as the canonical classification backbone.
That premise was falsified by primary-source inspection (Section 4).

**Three concerns are permanently separated** and each may draw on different authoritative sources:

| Concern | Question it answers | Owner |
|---|---|---|
| **A. Equipment classification** | What kind of equipment is this? | Atiman-canonical; standards substantiate |
| **B. Reliability / failure knowledge** | How does it fail? | Reliability sources (ISO 14224 within scope) |
| **C. Maintenance knowledge** | What should be inspected/measured/maintained? | OEM + standards + sector bodies |

---

## 2. Accepted canonical model

```
ATIMAN CANONICAL EQUIPMENT IDENTITY
  Category
    └─ Class
        └─ Type

SEPARATE DECOMPOSITION
  Type
    └─ Subunit / Maintainable Item            [LEVEL COUNT OPEN — see §6.1]

SEPARATE CONTEXT
  Industry
  Application / Service
  Manufacturer
  Model / Series

SEPARATE CLASSIFICATION PROVENANCE
  Atiman Equipment Type
    └─ Standards Crosswalk
         ├─ Authority
         ├─ Standard + Edition
         ├─ External Classification
         ├─ Relationship
         ├─ Applicability
         └─ Evidence

SEPARATE KNOWLEDGE PROVENANCE
  Equipment
    ├─ Maintenance Knowledge  → Maintenance Evidence  → Source
    ├─ Reliability Knowledge  → Reliability Evidence  → Source
    └─ Safety Knowledge       → Safety Evidence       → Source
```

### 2.1 Permanent exclusions

- **No Equipment Family layer.** No evidence justified a fourth identity level; the current schema
  has none, and IEC 81346-2 achieves cross-industry reach with a three-level scheme.
- **No industry-based identity duplication** (no `Water Centrifugal Pump` / `Mining Centrifugal Pump`).
  Industry is applicability, not identity.
- **No service-based identity duplication** (no `Cooling-Water Pump` as a distinct type). Service is context.
- **No per-manufacturer or per-model universal equipment types.** OEM requirements attach through
  applicability.
- **No components as equipment.** Bearings, seals, couplings and impellers are maintainable items,
  never peer equipment types.

### 2.2 The three independent knowledge chains are mandatory

A standard that legitimises **classification** does not thereby hold authority over **maintenance
tasks**. Classification evidence, maintenance evidence, reliability evidence and safety evidence must
remain independently sourced and independently auditable. Collapsing them is prohibited.

---

## 3. Verified current implementation alignment

`CURRENT_IMPLEMENTATION` (migration 002), verified by inspection:

| Accepted layer | Already implemented? |
|---|---|
| `equipment_categories → equipment_classes → equipment_types` | **Yes** — with `UNIQUE (category_id, class_code)` and `UNIQUE (class_id, type_code)` |
| No Equipment Family | **Yes** — absent from schema |
| Industry as separate M:N context | **Yes** — `equipment_type_industries` (+ criticality A/B/C) |
| Decomposition separate from identity | **Yes in shape** — `subunits → maintainable_items`, reachable only via `equipment_type_id` |
| Classification provenance (crosswalk) | **No** — `ARCHITECTURE_GAP-1` |
| Knowledge provenance | **Yes** — M1–M4 evidence machinery (task/template/step evidence) |
| Customer / tenant isolation | **No** — `ARCHITECTURE_GAP-2` |

**Consequence: the accepted architecture requires no core schema redesign and no destructive
migration.** The identity layer already exists; the missing capability is classification provenance.

---

## 4. Verified basis: role of external standards

Conclusions rest on inspected primary sources, not summaries.

### 4.1 ISO 14224:2016 — sector-scoped, and not a task authority

Inspected: the official 15-page ISO preview (front matter, foreword, introduction, scope, definitions).

- **Title:** *Petroleum, petrochemical and natural gas industries — Collection and exchange of
  reliability and maintenance data for equipment*
- **Committee:** ISO/TC 67 — materials, equipment and offshore structures for **petroleum,
  petrochemical and natural gas** industries
- **Scope (verbatim):** collection of reliability and maintenance (RM) **data** in a standard format
  "for equipment in all facilities and operations **within the petroleum, natural gas and
  petrochemical industries**"
- **Clause 5.4 Limitations (verbatim):** does not apply to "additional on-service data that an
  operator, on an individual basis, can consider useful for **operation and maintenance**"

**Legitimate Atiman role (narrow, real):** equipment-classification *concepts* within its sector;
equipment hierarchy and boundary concepts; reliability vocabulary; failure-mode normalisation;
maintenance-**data** terminology; maintainable-item concepts; **reliability/failure knowledge**.
**Never** Atiman's universal backbone. Atiman must not claim ISO 14224 conformance outside its sector.
Annex A (equipment classes) is not publicly accessible — `SOURCE_ACCESS_LIMITATION`, so **no ISO
equipment-class code may be asserted**.

Source: <https://www.iso.org/standard/64076.html>

### 4.2 IEC 81346 series — genuinely cross-industry, but not an equipment-type taxonomy

Inspected: IEC 81346-2:2019 official preview; official series listing.

- **81346-2:2019 Scope (verbatim):** "establishes classification schemes with defined object classes
  and their associated letter codes, and is primarily intended for use in **reference designations**
  and for designation of **generic types**. The classification schemes are applicable for objects in
  **all technical disciplines and all branches of industry**. This document is a **horizontal
  publication**."
- **Its own change list:** entry classes reflect the object's **"inherent function"**; classes align
  with **ISO 22274 / ISO 704**; a **three-level classification scheme**; classes carry definitions and
  **preferred terms**; a separate scheme for **spaces**.

| Part | Role | Sector |
|---|---|---|
| 81346-1 | Basic rules and principles | Cross-industry |
| **81346-2** | **Classification** — object classes, letter codes, preferred terms | **All technical disciplines and branches of industry** |
| 81346-10 (RDS-PS) | Power supply systems library | Energy/power |
| 81346-12 (RDS-CW) | Construction works library | Construction, urban, utility, HVAC |
| 81346-14 (RDS-MS) | Manufacturing systems library | Manufacturing, mining |
| 81346-8 / -20 / -50 | Properties / Vehicle systems / Processes | In development, 2026–2027 |

**Role in Atiman:** the **primary crosswalk target** for classification, plus sector crosswalks
(10/12/14). It is **not** an equipment-type taxonomy and must never be described as one: its
organising principle is **function for reference designation**, whereas Atiman's users ask *"what
equipment is this?"* and expect `Pump → Centrifugal Pump → End-Suction Centrifugal Pump`. Clause 5.3
class tables are not publicly accessible — `SOURCE_ACCESS_LIMITATION`.

Sources: <https://www.iso.org/standard/82229.html>, <https://www.81346.com/rds-81346>

### 4.3 Structural precedent

The 81346 series is itself a **cross-industry core (Part 2) plus sector libraries (Parts 10/12/14)**
architecture. This independently validates the canonical-plus-crosswalk pattern Atiman has adopted —
while ownership of Atiman equipment identity remains Atiman's.

### 4.4 Other authorities assessed

| Candidate | What it is | Equipment-classification value |
|---|---|---|
| CFIHOS RDL | Facilities information handover (oil & gas / process) | Possible sector crosswalk — `NEEDS_RESEARCH` |
| DEXPI (ISO TC184/SC4) | Process-industry P&ID exchange | No — data/drawing exchange, not identity |
| eCl@ss / UNSPSC / eOTD / RosettaNet | Commerce/procurement product categorisation | Weak; procurement-oriented — `NEEDS_RESEARCH` |
| ISO 55000/55001 | Asset management **system** requirements | No — management system, not taxonomy |
| ISO 15926 | Oil & gas data integration model | No — data model |
| OEM manuals | Manufacturer requirements | **Maintenance-task and applicability evidence (Tier 1)** |
| Sector bodies (HI, ASHRAE, NETA, API, EPRI, AWWA…) | Sector engineering practice | **Maintenance/applicability evidence (Tier 2/3)** |

**No authority universally owns equipment identity.** Classification, reliability and maintenance
authority are distributed — which is why the three concerns are separated.

---

## 5. Rejected alternatives

| Option | Description | Why rejected (evidence-based) |
|---|---|---|
| **A. Single external standard** | One standard becomes canonical | **No universal standard exists.** ISO 14224 is petroleum-scoped and establishes no task; no other single standard spans water, buildings, renewables, pharma, food and semiconductor |
| **B. IEC 81346-centred** | 81346 owns the structure | 81346-2 is **function-based** for reference designation, not equipment identity; sector parts cover power, construction and manufacturing only; class tables are access-limited |
| **D. Federated standard taxonomies** | No canonical identity | Fails the OWNER requirement that Atiman answer *"what equipment is this?"* with one auditable identity; produces duplication across standards and fragmented task attachment |

The previously proposed ISO 14224-centred option is rejected on the same grounds as Option A.

---

## 6. Open decisions (NOT settled by this record)

### 6.1 Decomposition level count — **bounded investigation required**

The accepted model states `Type → Subunit / Maintainable Item` (one combined level). Verified schema
reality is materially different:

| Concept | Attachment | Status |
|---|---|---|
| `subunits` | `equipment_type_id` | **Empty** |
| `equipment_subunits` | `equipment_type_id` | **Empty**; structurally identical to `subunits` (same columns, same uniqueness rule) — one is vestigial |
| `maintainable_items` | `subunit_id` | **Empty** |
| `object_parts` | `equipment_class_id` (not Type) | 0 rows in the bootstrap corpus |

The live seed corpus contains **no** `subunits.jsonl` or `maintainable_items.jsonl` — the decomposition
layer is entirely unpopulated and unsourced, so the level count can still be settled at zero cost.

**Required investigation before this is decided:** decomposition semantics against ISO 14224
maintainable-item concepts (within its sector scope) and against sector practice; whether assembly
groupings (subunit) and replaceable components (maintainable item) are genuinely distinct for
maintenance-knowledge attachment; and whether `object_parts` is a component concept or reliability
vocabulary. **No implementation is authorised.**

### 6.2 Customer-specific terminology and knowledge isolation — **implementation DEFERRED; requirement MANDATORY**

**The isolation requirement is mandatory. Only its implementation is deferred.**

The canonical Atiman taxonomy is **global**. Customer-specific terminology and proprietary knowledge
must **not** contaminate Atiman Core Knowledge. No tenant-scoped alias layer exists today
(`ARCHITECTURE_GAP-2`), and no isolation mechanism is implemented by this record; the exact
architecture is deferred to a separate bounded decision, expected to be taken in coordination with
Platform Foundation / tenancy architecture.

This is **not** an acceptance of contamination. It is an acknowledgement that a mandatory requirement
is currently **unsatisfied**, with its remedy deferred. Until that remedy exists, customer-specific
terminology has no non-contaminating home, and any attempt to accommodate it inside the global
taxonomy would violate the requirement rather than satisfy it.

---

## 7. Crosswalk model — APPROVED principles

The accepted six fields are adopted. Two additional principles are **APPROVED by OWNER / Chief
Architect** as requirements for the future bounded crosswalk design. Neither is implemented here
(no columns, enums, tables, constraints or APIs are created by this record).

1. **An explicit governance / review state is REQUIRED — APPROVED.** M1–M4 is governance-oriented, so
   an auditor must be able to distinguish a proposed/unreviewed classification mapping from a reviewed
   or approved one. The crosswalk design must therefore carry an explicit review state. The repository
   already uses the `review_status` idiom, so this is consistent rather than novel.
2. **`external_classification` must permit absence (nullable) — APPROVED.** `NO_DIRECT_MAPPING` is a
   valid architectural state: a genuinely Atiman-owned identity may have no legitimate external
   equivalent. **Atiman must never fabricate a standards mapping merely to satisfy a database
   constraint.** A mandatory field would make such identities unrepresentable and would create exactly
   that pressure.

### 7.1 Relationship vocabulary

Adopted: `DIRECT_EQUIVALENT` · `BROADER_THAN` · `NARROWER_THAN` · `RELATED_TO` ·
`SECTOR_SPECIFIC_EQUIVALENT` · `NO_DIRECT_MAPPING`.

**Caution recorded:** `DIRECT_EQUIVALENT` should be reserved for genuinely bijective mappings. Because
81346-2 classes are **function-based** while Atiman types are **identity-based**, most real
relationships will be `RELATED_TO`, `BROADER_THAN` or `NARROWER_THAN`. Treating a function class as
equivalent to an equipment type would be false precision.

`Standard + Edition` is mandatory, not optional: citing a superseded edition is a live risk. The legacy
corpus cites "ISO 10816" while the current machine-vibration series is ISO 20816 — currency
**unverified** and not to be assumed.

---

## 8. Provenance models

**Classification provenance (auditable chain):**
```
Atiman Equipment Identity
  → Classification Evidence (source authority · standard + edition · external classification ·
                             relationship · applicability · evidence · review status)
  → External Authority
```
**Knowledge provenance (independent chains, never collapsed):**
```
Maintenance Task        → Maintenance Evidence        → Source (OEM / standard / sector body)
Reliability / Failure   → Reliability Evidence        → Source (ISO 14224 within sector scope)
Safety                  → Safety Evidence             → Source (safety standards)
```
Multiple crosswalk rows per identity are required. A single `iso_code` column is insufficient: an
identity may map to several standards, or to none.

---

## 9. Architecture gaps (recorded, none implemented)

| ID | Gap | Minimum remedy |
|---|---|---|
| `ARCHITECTURE_GAP-1` | No standards-crosswalk / classification-provenance capability on equipment identity | Additive crosswalk relation (§7) plus classification-evidence link, reusing existing source/evidence patterns |
| `ARCHITECTURE_GAP-2` | No customer/tenant isolation on taxonomy | Additive tenant-scoped alias mapping; core taxonomy stays global. **Deferred by OWNER** |
| `ARCHITECTURE_GAP-3` | `subunits` / `equipment_subunits` duplication; decomposition level unpopulated | Resolve as part of the §6.1 investigation |

---

## 10. Legacy taxonomy findings and reconciliation strategy

**Two structures exist; only one is live.**

| | Live seed | Design artifact |
|---|---|---|
| Source | `scripts/bootstrap-knowledge/*.jsonl` | `database/odm_legacy_equipment_taxonomy_design.v1.json` (authoritative) + `odm_seed/master_data/taxonomy.v1.json` (generated seed copy) — formerly three byte-identical copies named `iso14224_master_taxonomy.json`; consolidated by M5R.2A, see §11.3 |
| Counts | 65 categories / 311 classes / 282 types / 647 industry rows | 10 / 42 / 60 types / 288 subunits / 376 maintainable items |
| Seeded? | **Yes** | **No** — no loader references it |
| Representation | `CURRENT_IMPLEMENTATION` | `LEGACY_BEHAVIOR` (design artifact) |

The three "design" files are **byte-identical** (`sha256 cf7eece15c84c7fb…`): one document duplicated
three times under two names.

**Reconciliation method (deterministic, non-destructive):**
1. Structural pass — duplicates, plural forms, compound names, abstract-container risk, service-in-name.
2. Crosswalk pass — assign classification evidence per identity (requires §7).
3. Disposition assignment.
4. Engineer review.
5. **Additive** application — no deletion, no destructive migration.

**Dispositions:** `RETAIN` · `RENAME` · `MERGE` · `SPLIT` · `RECLASSIFY` · `COMPONENT_NOT_EQUIPMENT` ·
`APPLICATION_NOT_EQUIPMENT` · `DUPLICATE` · `UNSUPPORTED` · `NEEDS_RESEARCH` (default).

All 282 legacy identities currently default to `NEEDS_RESEARCH`. They are `CANDIDATE_EQUIPMENT_IDENTITIES`
— real discovery work that is neither approved nor discarded.

---

## 11. False-provenance findings — VERIFIED; rename/consolidation DEFERRED

Reproduced independently in M5R.2. **The finding is confirmed; the filename correction and duplicate
consolidation were deliberately not executed**, for the reasons given below.

### 11.1 Verification (reproduced, not inherited)

| Check | Result |
|---|---|
| ISO 14224 equipment-class codes (`PU`, `CE`, `GT`, `HE`, `VE`, `TR`) | **0** |
| Literal occurrences of "14224" inside the artifact | **0** |
| `iso_code` / `iso_ref` fields | **0** |
| Code scheme | `ECAT-nnn` / `ECLS-nnn` / `ETYPE-nnn` (ODM-authored) |
| Self-identifying marker | `odm_taxonomy_summary` present |
| Copies | **Three byte-identical copies**, `sha256 cf7eece15c84c7fb7114b5470c209e30370d87803fef25d4d6a632ca21fd60be`, 213,984 bytes each |

**Conclusive authorship evidence:** `database/generate_iso_taxonomy.py` is the artifact's **generator**.
Its own header reads:

> *"ISO 14224 Master Equipment Taxonomy Generator for **ODM-CMMS** / Generates complete seed dataset
> **aligned to** ISO 14224 standard"*

"Aligned to" is the generator's own description. The artifact is therefore **ODM-CMMS-authored and
ISO-*inspired***, not an ISO 14224 extract. This corroborates the content checks independently of them.

### 11.2 Why the rename and consolidation were NOT executed in M5R.2

> **Historical — resolved by ATM-001 M5R.2A (see §11.3).** This subsection records the analysis as it
> stood at M5R.2 and is retained for the audit trail. The path references below describe the
> *former* state.

Dependency analysis established that the correction was **not provably safe at M5R.2**, which is the
condition the mission set for performing it. The three copies had *different* roles:

| Copy (former) | Role established by analysis |
|---|---|
| `iso14224_master_taxonomy.json` (root) | **Generated output** of `database/generate_iso_taxonomy.py`; read by `database/validate_taxonomy.py` |
| `database/iso14224_master_taxonomy.json` | **Not referenced by any path-explicit reference** — but both Python tools used **bare relative filenames**, so this copy was the one they read when invoked from `database/`. Copy ownership was therefore **CWD-dependent and ambiguous** |
| `odm_seed/master_data/taxonomy.v1.json` | Read by `odm_seed/verify_seed.py` **and by `import-iso-data.js` (an import path)** |

Consequences at that time:
- Renaming the root copy would have changed a **generator's output contract** while leaving the ambiguous
  `database/` copy in place — producing an inconsistent repository and entrenching one interpretation
  of an ambiguity that itself needed resolving.
- Consolidating to one copy was **not safe**: depending on the working directory, either copy could be the
  live input, so removing one could silently break a legacy tool.
- Renaming the `odm_seed` copy would have touched an **import path**, which M5R.2 scoped out.

Verified **not** affected (so no product risk either way): no runtime (`src/`) reference, no bootstrap
(`scripts/bootstrap-knowledge/`) reference, no test reference, no CI/deployment reference, and no
`package.json` script.

### 11.3 Disposition — correction executed by ATM-001 M5R.2A

M5R.2A removed the blocker by first making the legacy tooling **path-deterministic**, which is what made
consolidation provably safe. No architecture changed; taxonomy content is byte-identical.

| Item | Status |
|---|---|
| Provenance finding | **VERIFIED and recorded** (this section, plus `ATM-001-M5R2-Legacy-Taxonomy-Provenance.md`) |
| Filename correction | **EXECUTED (M5R.2A)** — authoritative artifact is now `database/odm_legacy_equipment_taxonomy_design.v1.json`; the root `iso14224_master_taxonomy.json` byproduct was removed |
| Duplicate consolidation | **EXECUTED (M5R.2A)** — three byte-identical copies reduced to one authoritative design artifact plus one explicitly generated seed copy |
| Path determinism | **EXECUTED (M5R.2A)** — generator and consumers resolve paths from script location, not caller CWD |
| Taxonomy data values | **Unchanged** — same `sha256 cf7eece1…`, 213,984 bytes, identical record counts |
| Migration / seeding impact | **None** — not seeded; no database object depends on it |
| ISO implication | **Removed at source**: no active artifact filename asserts ISO extraction, and the tools' provenance wording states the dataset is ODM-authored and ISO 14224-*informed*, not an ISO extract |

---

## 12. Consequences

**Positive**
- Avoids false ISO/IEC conformance claims.
- Requires no core schema redesign; no destructive migration.
- Operator-legible three-level hierarchy.
- Absorbs new technologies (BESS, data-centre cooling, emerging renewables) without redesign.
- Keeps maintenance, reliability and safety authority independently auditable.
- Matches the multi-part "cross-industry core + sector libraries" pattern independently proven by the
  81346 series.

**Negative / accepted costs**
- Atiman must author and govern the taxonomy: ongoing curation work with no external standard to hide
  behind.
- Crosswalk accuracy becomes an Atiman responsibility, including edition tracking.
- **A mandatory requirement is currently unsatisfied:** customer-specific terminology has no
  non-contaminating home until §6.2 is implemented. This is a known, deferred **gap**, not an accepted
  contamination.
- Decomposition remains unresolved pending §6.1.

---

## 13. Non-goals and explicit NON-DECISIONS

No work-order planning, labour/resource planning, procurement, inventory, purchasing, financial
tracking, contractor management, enterprise scheduling, or replacement EAM functionality. Knowledge
may recommend escalation; formal execution remains outside Atiman's core responsibility. This
architecture concerns the Knowledge Foundation only.

**This record explicitly does NOT decide** (each requires its own bounded investigation and approval):

| Not decided here | Status |
|---|---|
| Final standards-crosswalk schema | Future bounded design; principles approved in §7 only |
| Final decomposition schema and level count | **OPEN** — §6.1 |
| Customer alias / tenancy schema | **DEFERRED** — §6.2; requirement mandatory, implementation deferred |
| Disposition of all 282 candidate equipment types | Future reconciliation; method only in §10 |
| Maintenance-task contents | Not researched — zero tasks evidenced |
| OEM applicability mappings | Not researched |
| Safety controls | Not researched; no safety content approved |
| Production publication of any knowledge | Not authorised and not performed |
| Any schema, migration or runtime change | Out of scope for this record |

---

## 14. Evidence status of this record

| Claim class | Status |
|---|---|
| ISO 14224 scope, committee, Clause 5.4 limitations | **VERIFIED** — inspected official preview |
| IEC 81346-2 scope, three-level scheme, function basis | **VERIFIED** — inspected official preview |
| 81346 series part structure | **VERIFIED** — official series listing |
| Current schema shape, table duplication, empty decomposition | **VERIFIED** — repository inspection |
| Live seed counts (65/311/282/647) | **VERIFIED** — repository data |
| Design-artifact byte-identity and counts | **VERIFIED** — hash + parse |
| Design-artifact ODM authorship | **VERIFIED** — `database/generate_iso_taxonomy.py` is its generator |
| Supabase-hosted Postgres on Render | **VERIFIED** — `DEPLOYMENT_CLOUD.md` |
| Exact production row counts | **NOT VERIFIED** — no production access authorised |
| ISO 14224 Annex A class codes; 81346-2 clause 5.3 class tables | `SOURCE_ACCESS_LIMITATION` |
| ISO 10816 currency | **NOT VERIFIED** — must be confirmed before any citation |
| Authoritative Project Source document | **ABSENT from the repository** — see §17 |

---

## 15. M5R research artifact disposition

Disposition is now **executed** under M5R.2: the durable architecture is this ADR plus the compact
retained evidence set under `docs/research/m5r/`. Generated working datasets that the ADR fully
supersedes are not promoted into permanent architecture merely because they exist.

| Artifact | Disposition | Rationale |
|---|---|---|
| `sources.jsonl` | **RETAIN_AS_EVIDENCE** | Primary-source register with continuing audit value; not fully reproducible without re-inspection |
| `excluded-sources.jsonl` | **RETAIN_AS_EVIDENCE** | The proprietary-knowledge exclusion and its principle must stay durable |
| `evidence-gaps.jsonl` | **RETAIN_AS_EVIDENCE** | Compact record of what is *not* known — directly supports future mission scoping |
| `source-conflicts.jsonl` | **RETAIN_AS_EVIDENCE** | Records unresolved conflicts that must not be silently resolved |
| `iso14224-taxonomy-baseline.json` | **FOLDED_INTO_ADR** | Its conclusions are now §4.1 and §11 |
| `legacy-reconciliation.jsonl` | **SUPERSEDED_RESEARCH** | 282 rows of `UNDETERMINED`; the §10 method supersedes it and its inputs remain in the live corpus |
| `equipment-register.jsonl` | **SUPERSEDED_RESEARCH** | Every row `UNDETERMINED_NEEDS_ISO_ANNEX_A`; superseded by §2 and §6.1 |
| `numeric-values.jsonl` | **RETAIN_AS_EVIDENCE** | Tiny; records the specific unsafe threshold and its step id, which is audit evidence not fully reproduced in prose |
| `safety-sensitive-tasks.jsonl` | **SUPERSEDED_RESEARCH** | 300 candidates against 0 controls; the durable point is the safety-evidence requirement, not the list |
| `next-research-batches.jsonl` | **SUPERSEDED_RESEARCH** | Superseded by the M5R.2 mission structure |
| `maintenance-tasks.jsonl` (empty) | **DISCARD** | Zero records; the fact that zero tasks were evidenced is recorded in §14 and §16 |
| `task-source-links.jsonl` (empty) | **DISCARD** | Zero records; same reason |
| `artifact-manifest.json` | **DISCARD** | Generated bookkeeping for a dataset that no longer exists as a working set |

Retained set: **4 files**. Full per-file rationale in the M5R.2 report.

---

## 16. Standing constraints preserved

Manila Water proprietary material remains `EXCLUDED_PROPRIETARY_LEGACY_MATERIAL` and contributes no
Atiman Core Knowledge. Customer/employer proprietary knowledge must never silently become reusable
Atiman Core Knowledge merely because it exists in a repository. AI does not author engineering or
safety authority, and does not impersonate engineer, safety reviewer, approver or publisher. Evidence
before assumption: where evidence is absent, the gap is recorded rather than filled.

**Legacy candidate knowledge requires independent evidence and accountable human review before
becoming governed Atiman knowledge.** Migration success does not equal engineering approval. No numeric
limit, safety control, frequency or maintenance task may be promoted from legacy material on the
strength of its presence alone.

---

## 17. Project Source, and out-of-scope documentation debt

**Authoritative Project Source: ABSENT.** No `ATIMAN_PROJECT_SOURCE.md`, `PROJECT_SOURCE.md`, or
equivalent tracked product-constitution document exists in the repository. Consequently no
`PROJECT_SOURCE_UPDATE_REQUIRED` conflict could be evaluated against repository evidence, and none is
raised. If an authoritative Project Source exists outside the repository, it was not available for
inspection and this record cannot attest to its contents.

**Out-of-scope documentation debt (`OUT_OF_SCOPE_DOCUMENTATION_DEBT`).** Recorded only; **not** fixed,
because each item would require touching live data, legacy migrations or runtime code and therefore
fall outside this record's scope:

| # | Finding | Why out of scope |
|---|---|---|
| 1 | The **live** bootstrap corpus carries ISO 14224-flavoured reference labels that assert standard lineage which cannot be verified, because ISO 14224 Annex A/B are not publicly accessible: `activity_codes.iso_maintenance_reference` = `ISO14224-I` (4), `-PM` (7), `-CM` (4), `-PdM` (2), `-MOD` (2); `cause_codes.iso_failure_cause_reference` = `ISO14224-T1`…`T7` (16 rows) | Correcting these means changing **live seeded data** — a seed-semantics change, explicitly out of scope |
| 2 | Legacy MySQL migrations under `database/migrations/` (e.g. `006_iso_sap_reliability_structure.sql`) scatter `ISO14224-*` references and an "ISO 14224 + SAP" framing | Legacy migration chain; never read by the PostgreSQL runner; changing it would rewrite migration history |
| 3 | Root-level legacy utilities (`import-iso-data.js`, `verify-iso-data.js`, `add-inspection-items.js`) carry "ISO 14224" framing in headers and filenames. M5R.2A corrected the misleading provenance **wording** in `import-iso-data.js` only; the remaining files and the utility **filenames** are untouched | Touching them changes legacy tooling behaviour |
| 4 | Stale ODM-CMMS product framing persists across legacy docs (`ISO_IMPLEMENTATION_SUMMARY.md`, `database/EAM_MIGRATION_SUMMARY.md`, `AUDIT-REPORT.md`, `SCHEMA_MANIFEST.md`) | General documentation cleanup is out of scope |
