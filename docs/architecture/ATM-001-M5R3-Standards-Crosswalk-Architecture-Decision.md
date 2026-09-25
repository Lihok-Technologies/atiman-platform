# ATM-001 M5R.3 — Standards Crosswalk Architecture Decision

**Status: PROPOSED — AWAITING OWNER / CHIEF ARCHITECT APPROVAL.**
**Not implemented.** No schema, migration, model, service, API or data change accompanies this record.

| | |
|---|---|
| Baseline | `origin/main` = `3c6f86925ead5495f59373e939ed2d395c0d31fc` (ATM-001 M5R.2A merged) |
| Predecessors | M5R (ISO 14224 role corrected), M5R.1 (canonical identity), M5R.2 (crosswalk principles approved), M5R.2A (legacy provenance hygiene) |
| Migration chain | 001–015 unchanged; **no 016 proposed for execution here** |
| Question answered | *For this Atiman-owned equipment identity, what external classifications relate to it — according to which authority/edition, through what relationship, for what applicability, on what evidence, with what governance status?* |

---

## A. Context

Atiman owns its canonical cross-industry equipment identity (`Category → Class → Type`). External
standards do **not** own that identity; they may substantiate, classify, contextualize and
cross-reference it (M5R.1, approved).

M5R.2 approved these principles: an explicit governance/review state is required;
`external_classification` must permit absence; `NO_DIRECT_MAPPING` is legitimate; Atiman must never
fabricate a mapping to satisfy a constraint; `DIRECT_EQUIVALENT` must mean genuine semantic equivalence;
one Atiman identity may hold multiple external relationships; and standard **edition**, applicability,
relationship and evidence all matter.

Those are principles, not a model. This record proposes the smallest durable architecture that
represents them truthfully.

## B. Problem

Atiman cannot currently state, auditably, how any equipment identity relates to any external
classification. Two consequences follow:

1. **No truthful provenance for classification.** `equipment_categories`, `equipment_classes` and
   `equipment_types` carry **no** provenance columns of any kind (verified, migration 002).
2. **A naive pattern already exists and is untrustworthy.** Live schema contains
   `activity_codes.iso_maintenance_reference varchar(50)` and
   `cause_codes.iso_failure_cause_reference varchar(50)` (migration 002, indexed in 007). These are
   exactly the simplistic master-data columns §14 warns against, and they carry `ISO14224-*` labels
   whose lineage **cannot be verified** because ISO 14224 Annex A/B are not accessible
   (`SOURCE_ACCESS_LIMITATION`, recorded in M5R.2 §17). They must not be treated as trusted mappings.

The absence of a governed model is therefore not hypothetical: an ungoverned substitute is already in
the database and in the seed corpus.

## C. Evidence examined

| Source | Status |
|---|---|
| Migrations 001–015 (schema, conventions, idempotency patterns) | **VERIFIED** — repository inspection |
| `knowledge_sources`, `knowledge_source_versions`, `knowledge_template_evidence`, `knowledge_template_version_evidence` | **VERIFIED** — full definitions read |
| M1–M4 governance (admission, membership, provenance authoring, pack publication) | **VERIFIED** — prior mission records + schema |
| Authorization model (`src/config/permissions.js`) | **VERIFIED** |
| Legacy classification concepts (`iso_maintenance_reference`, `iso_failure_cause_reference`, `ISO14224`, `iso_ref`, `sap_equipment`) | **VERIFIED** — classified in §C of the report |
| ISO 14224:2016 scope/limitations; IEC 81346 series role | **VERIFIED earlier** (official ISO/IEC previews) — carried forward, not re-derived |
| ISO 14224 Annex A class codes; 81346-2 clause 5.3 class tables | `SOURCE_ACCESS_LIMITATION` |

## D. Current implementation map (design input)

### D.1 Canonical taxonomy — `CURRENT_ATIMAN`

| Table | Shape | Provenance columns |
|---|---|---|
| `equipment_categories` | `category_code` UNIQUE, `category_name`, `description` | **none** |
| `equipment_classes` | `category_id` FK, `class_code`, `class_name`, UNIQUE `(category_id, class_code)` | **none** |
| `equipment_types` | `class_id` FK, `type_code`, `type_name`, `description`, `typical_components`, UNIQUE `(class_id, type_code)` | **none** |
| `equipment_type_industries` | `(equipment_type_id, industry_id)` + `criticality` A/B/C | n/a (context) |

No Equipment Family layer. Decomposition (`subunits`/`equipment_subunits`/`maintainable_items`/
`object_parts`) exists but is **unpopulated and unresolved** — out of scope here.

### D.2 Provenance — `CURRENT_ATIMAN`, and highly reusable

`knowledge_sources`: `source_code`, **`source_category`** (CHECK:
`manufacturer_manual | engineering_standard | internal_standard | regulatory_source | legacy_migration |
engineering_authored`), `default_title`, **`issuing_organization`**, `is_active`, `organization_id`
(NULL = global), `created_by_user_id`; `UNIQUE NULLS NOT DISTINCT (organization_id, source_code)`;
identity locked by trigger once versions exist.

`knowledge_source_versions`: `version_designation`, `title`, **`reference_number`**,
**`issuing_organization`**, **`publication_date`**, **`effective_date`**, `uploaded_file_id`,
**`external_uri`**, `content_sha256`; `UNIQUE (knowledge_source_id, version_designation)`;
**immutable** by trigger; delete blocked while referenced by evidence.

**This is already an external-authority + edition registry.** "ISO 14224:2016" is representable today
as a `knowledge_sources` row (`source_category='engineering_standard'`, `issuing_organization='ISO'`)
with a `knowledge_source_versions` row (`version_designation='2016'`,
`reference_number='ISO 14224'`, `publication_date`). **This is the single most important discovery of
M5R.3 and it determines the architecture.**

Evidence: `knowledge_template_evidence` (working) and `knowledge_template_version_evidence` (frozen)
both enforce **exactly-one-subject** (`task_template_id` XOR `task_template_step_id`), carry
`section_or_clause`, `page_or_paragraph`, `derivation_notes`, `confidence_level`
(established/provisional/experimental/uncertain), `supporting_role` (primary/supporting) and
`added_by_user_id`. Their subject CHECK is **hard-coded to template/step**, so they cannot hold an
equipment-type or crosswalk subject without altering migration 011 — which is out of scope.

### D.3 Governance vocabulary — `CURRENT_ATIMAN`

- Template review: `draft → under_review → approved | rejected`, plus `safety_review_state`.
- Version lifecycle: `published | superseded | retired`, immutable once published.
- Pack lifecycle: `draft → under_review → approved → published → superseded | retired`.
- Segregation of duties: approver ≠ publisher; publisher attribution durable and `NOT NULL` for
  governed states.

### D.4 Authorization — `CURRENT_ATIMAN`

`KNOWLEDGE.VIEW` (all roles) · `KNOWLEDGE.REVIEW` / `.APPROVE` / `.SAFETY_REVIEW` (admin + supervisor) ·
`TASKS.CREATE` / `.UPDATE` / `.DELETE` (admin only) · `TASKS.VIEW` (all).

### D.5 Legacy classification concepts — classified

| Finding | Classification |
|---|---|
| `activity_codes.iso_maintenance_reference` (live, indexed) | **CURRENT_ATIMAN but FALSE_PROVENANCE-bearing** — unverifiable `ISO14224-*` labels |
| `cause_codes.iso_failure_cause_reference` (live, indexed) | **CURRENT_ATIMAN but FALSE_PROVENANCE-bearing** |
| `ISO14224-*` literals in 7 files; `iso_ref` in 9; `sap_equipment` in 8 | **LEGACY_ODM** |
| `database/odm_legacy_equipment_taxonomy_design.v1.json` (60 types, 288 subunits, 376 items) | **SEED_ONLY / legacy design dataset** |
| `external_classification`, `crosswalk` | **PROPOSED / DOCUMENTATION_ONLY** (M5R.1 ADR only) |
| `equipment_type_family_*`, `smp_families`, `template_families` | **DEAD/HISTORICAL** (empty vestiges) |

**No existing crosswalk structure is reused.** The two `iso_*_reference` columns are *not* a foundation
to build on — they are evidence of why a governed model is needed.

## E. Approved requirements

### MUST

1. The relationship is **owned by the Atiman equipment identity**; no external system owns it.
2. Represent, without lying: reviewed-and-equivalent; reviewed-and-related/broader/narrower;
   reviewed-**NO_DIRECT_MAPPING**; never reviewed; proposed; rejected; approved; superseded.
3. **Governance status and mapping outcome are separate dimensions** (`APPROVED + NO_DIRECT_MAPPING`
   must be expressible).
4. `NO_DIRECT_MAPPING` must record **which authority/edition was actually investigated**, without
   inventing a fake classification record.
5. External classification is **nullable**, and `NULL` must never be readable as `NO_DIRECT_MAPPING`.
6. Edition provenance is durable; an external edition change must not silently rewrite history.
7. Every material relationship is **traceable to evidence**, reusing the existing provenance machinery.
8. **External-concept evidence ≠ relationship evidence** — the two propositions stay distinguishable.
9. Approved knowledge is never silently destroyed; history is preserved by supersession.
10. **Standards-neutral**: no ISO 14224-specific semantics; any authority fits the same model.
11. `DIRECT_EQUIVALENT` is strict and never inferred from label similarity.
12. An AI-proposed mapping is **distinguishable** from human-approved truth.

### SHOULD

13. Reuse `knowledge_sources` / `knowledge_source_versions` as the authority+edition registry rather
    than duplicating it.
14. Attach to the canonical **`equipment_type`**, not to unresolved decomposition.
15. Be answerable by ordinary relational queries — no meaning buried in arbitrary JSON.
16. Use the lifecycle vocabulary already established by M1–M4.
17. Prevent duplicate simultaneously-active approved mappings from arising silently.

### MAY

18. Support many authorities per type, and one external classification mapping to many types.
19. Later accommodate **customer-specific** classification systems in a separate scoped layer.

### MUST NOT

20. Introduce an Equipment Family layer.
21. Fabricate a mapping to satisfy a constraint.
22. Turn Atiman into a standards database or an ontology platform.
23. Duplicate the provenance subsystem.
24. Implement tenancy, customer aliases, decomposition, or any 282/60-type reconciliation.
25. Modify migrations 001–015 or create migration 016 in this mission.

## F. Architecture options

### Option A — Minimal crosswalk with embedded external metadata

One table on `equipment_type`: `authority_name`, `standard_reference`, `edition`, `external_code`,
`external_label`, `relationship`, `applicability_note`, `review_state`, reviewer/approver + timestamps,
plus an evidence association.

- **Strengths:** smallest possible surface; one migration; immediately queryable.
- **Weaknesses / failure modes:**
  - Authority and edition become **free text** → "ISO 14224" vs "ISO14224" vs "iso 14224" fragment;
    edition drift is unrecordable; **no single answer** to "what is ISO 14224:2016?".
  - External concept metadata carries **no evidence of its own** → violates requirement 8; the
    external concept cannot be substantiated independently of the mapping.
  - One external classification reused by 40 Atiman types is duplicated 40×.
  - `NO_DIRECT_MAPPING` records the authority as text → requirement 4 met only accidentally.
  - Uniqueness on free text cannot prevent duplicate active mappings (requirement 17).
- **Verdict: rejected** — under-engineered; fails requirements 6, 8, 13, 17.

### Option B — Fully normalized authority → edition → classification hierarchy

New `external_authority` → `external_authority_edition` → `external_classification` → crosswalk →
evidence.

- **Strengths:** clean modelling; complete edition handling; reusable classifications; one class → many
  types; strong queryability.
- **Weaknesses / failure modes:**
  - **Duplicates an existing governed registry.** `knowledge_sources` + `knowledge_source_versions`
    already carry `issuing_organization`, `reference_number`, `version_designation`,
    `publication_date`, `effective_date`, `external_uri`, `content_sha256`, with identity-lock and
    immutability guarantees. A parallel authority registry creates **two answers** to the same question
    and two places for evidence to point — violating requirement 13 and §9's "do not duplicate".
  - Larger migration surface and a permanent reconciliation obligation between two registries.
  - Invites scope creep into a standards-catalogue product (requirement 22).
- **Verdict: rejected** — over-engineered; duplicates governed machinery it should reuse.

### Option C — Hybrid: reuse existing provenance + minimal external-classification identity + governed crosswalk ✅

Reuse `knowledge_sources` / `knowledge_source_versions` **unchanged** as the authority + edition
registry. Add only what does not exist:

1. **`external_classification`** — the identity of a classification *concept within* a specific source
   version (the thing a standard's table actually defines). Keyed to
   `knowledge_source_version_id`.
2. **`equipment_type_external_classification`** — the **governed crosswalk relationship**: Atiman type
   ↔ external classification, with relationship, review state, mapping outcome, applicability,
   attribution and supersession. `knowledge_source_version_id` is **always** recorded — this is what
   makes requirement 4 solvable: the authority/edition investigated is known **even when no
   classification exists**.
3. **`equipment_type_external_classification_evidence`** — evidence for **either** the external
   concept **or** the relationship, using the repo's established **exactly-one-subject** idiom. This is
   what satisfies requirement 8 with one table instead of two.

- **Strengths:** standards-neutral; single authority registry; separates review state from outcome;
  records the investigated authority for `NO_DIRECT_MAPPING`; supports edition history and supersession;
  supports many-to-many; reuses M1–M4 vocabulary and the repo's proven CHECK/trigger idioms; three
  tables is a small, honest surface; customer-specific classification can later attach in a **separate**
  scoped layer without touching this one.
- **Weaknesses / accepted costs:** three new tables rather than one; a crosswalk must reference a
  **global** source version or global taxonomy is at risk (mitigated below); the external-classification
  entity adds a level that Option A avoids.
- **Verdict: SELECTED.**

## G. Tradeoff matrix

| Criterion | A (embedded) | B (fully normalised) | **C (hybrid)** |
|---|---|---|---|
| Truthfulness of external identity | ✗ free text | ✓ | ✓ |
| Edition provenance | ✗ | ✓ | ✓ (reused registry) |
| Reuses governed provenance | ✗ | ✗ (duplicates) | **✓** |
| External-concept evidence vs relationship evidence | ✗ | ✓ | **✓** |
| Records investigated authority for NDM | ~ accidental | ✓ | **✓ explicit** |
| Review state vs outcome separable | ✓ | ✓ | **✓** |
| Duplicate-active-mapping prevention | ✗ | ✓ | **✓** |
| Standards-neutral | ✓ | ✓ | **✓** |
| Many authorities per type / many types per class | ✗ duplicated | ✓ | **✓** |
| Two competing authority registries | no | **yes ✗** | **no ✓** |
| Implementation complexity | low | high | **low–moderate** |
| Migration surface | 1 table | 4–5 tables | **3 tables** |
| Customer-classification compatibility | contaminating | separate layer | **separate layer ✓** |
| Over-engineering risk | — | high | low |
| Under-engineering risk | **high** | — | low |

## H. Proposed architecture — conceptual model

```
Atiman canonical identity (unchanged, M5R.1)
  equipment_categories → equipment_classes → equipment_types

External authority + edition  (REUSED, unchanged — migration 011)
  knowledge_sources ──1:N──> knowledge_source_versions
        (issuing_organization,        (reference_number, version_designation,
         source_category)               publication_date, effective_date,
                                        external_uri, content_sha256)

NEW  external_classification                      (a concept defined within one edition)
  id · knowledge_source_version_id → knowledge_source_versions(id)  NOT NULL
  classification_code · classification_label · classification_path · description · is_active
  UNIQUE (knowledge_source_version_id, classification_code)

NEW  equipment_type_external_classification        (the GOVERNED RELATIONSHIP)
  id · equipment_type_id → equipment_types(id)                     NOT NULL
       knowledge_source_version_id → knowledge_source_versions(id) NOT NULL   ← authority investigated
       external_classification_id  → external_classification(id)   NULLABLE   ← only for NO_DIRECT_MAPPING
       relationship        NULLABLE  CHECK (DIRECT_EQUIVALENT | RELATED_TO | BROADER_THAN | NARROWER_THAN)
       review_state        NOT NULL  CHECK (draft | under_review | approved | rejected)
       mapping_outcome     NOT NULL  CHECK (DIRECT_EQUIVALENT | RELATED_TO | BROADER_THAN |
                                            NARROWER_THAN | NO_DIRECT_MAPPING)
       applicability_industry_id → industries(id) NULLABLE
       applicability_note · confidence_level · supporting_role
       proposed_by_user_id · reviewed_by_user_id/reviewed_at · approved_by_user_id/approved_at
       ai_assisted · ai_assistance_detail
       superseded_by_crosswalk_id → self NULLABLE
       created_at · updated_at

NEW  equipment_type_external_classification_evidence
  id · knowledge_source_version_id → knowledge_source_versions(id) NOT NULL
       external_classification_id → external_classification(id) NULLABLE   ┐ exactly-one-subject
       crosswalk_id               → equipment_type_external_classification(id) NULLABLE ┘
       section_or_clause · page_or_paragraph · derivation_notes
       confidence_level · supporting_role · added_by_user_id · added_at
```

### H.1 The two decisive design decisions

**(1) Review state and mapping outcome are SEPARATE dimensions.**

| | |
|---|---|
| `review_state` | `draft` · `under_review` · `approved` · `rejected` — *governance* |
| `mapping_outcome` | `DIRECT_EQUIVALENT` · `RELATED_TO` · `BROADER_THAN` · `NARROWER_THAN` · `NO_DIRECT_MAPPING` — *the finding* |

`APPROVED + NO_DIRECT_MAPPING` is therefore a **first-class positive finding**, not a null, and not a
pseudo-state. Collapsing them (the tempting alternative) would make "we looked and found nothing" and
"we approved an equivalence" share a column and become mutually confusable.

**(2) `knowledge_source_version_id` is NOT NULL even when `external_classification_id` is NULL.**

This is the direct answer to §21. A `NO_DIRECT_MAPPING` row records precisely **which authority edition
was investigated** without fabricating a classification. A CHECK enforces the pairing:

```sql
-- PROPOSED — NOT IMPLEMENTED
CHECK (
  (mapping_outcome  = 'NO_DIRECT_MAPPING' AND external_classification_id IS NULL AND relationship IS NULL)
  OR
  (mapping_outcome <> 'NO_DIRECT_MAPPING' AND external_classification_id IS NOT NULL
     AND relationship = mapping_outcome)
)
```

Absence of a classification is thus *never* the same value as a governed `NO_DIRECT_MAPPING`, and
"never reviewed" is the **absence of any row** — three genuinely distinct states.

### H.2 Relationship vocabulary — four, not six

| Relationship | Meaning |
|---|---|
| `DIRECT_EQUIVALENT` | Genuinely bijective: the external classification denotes the same equipment concept, with no broader or narrower extent. **Strict.** |
| `BROADER_THAN` | The external classification's extent **includes** this Atiman type plus others. |
| `NARROWER_THAN` | The external classification's extent is a **subset** of this Atiman type. |
| `RELATED_TO` | A defensible association that is neither equivalence nor containment — e.g. a **function-based** classification (81346-2) versus an **identity-based** Atiman type. |

**Refinement to the M5R.1 draft:** M5R.1 listed a sixth value, `SECTOR_SPECIFIC_EQUIVALENT`. M5R.3
recommends **dropping it**: sector scoping is *applicability*, and the architecture already carries a
structured applicability dimension. "Equivalent within petroleum scope" is expressible as
`DIRECT_EQUIVALENT` + applicability=petroleum. Keeping a relationship value whose meaning is really
"equivalence plus a qualifier" would conflate two orthogonal axes and inflate the vocabulary — exactly
the ontology inflation §7 warns against.

`NO_DIRECT_MAPPING` is **not** in this list: it is an *outcome*, not a relationship. That reclassification
is the second refinement to the M5R.1 draft.

### H.3 Null semantics — the three states must never collapse

| State | Representation |
|---|---|
| **Never reviewed** | **no crosswalk row exists** for (type, authority edition) |
| **Reviewed → no direct mapping** | row with `mapping_outcome='NO_DIRECT_MAPPING'`, `external_classification_id IS NULL`, `knowledge_source_version_id` set, `review_state='approved'` |
| **Absence / not applicable** | no row; or a row still in `draft`/`under_review` — never `approved` |

`external_classification_id IS NULL` on its own carries **no** governed meaning; meaning comes from
`mapping_outcome` + `review_state`. An unapproved row can never be read as a conclusion.

## I. External authority model

Reuses `knowledge_sources` + `knowledge_source_versions` unchanged. Mapping of concepts:

| Concept | Where it lives (reused) |
|---|---|
| Authority / issuing body | `knowledge_sources.issuing_organization`, `.default_title` |
| Authority kind | `knowledge_sources.source_category` (`engineering_standard`, `manufacturer_manual`, `internal_standard`, `regulatory_source`, …) |
| Standard / system number | `knowledge_source_versions.reference_number` |
| Edition / version | `knowledge_source_versions.version_designation` |
| Publication / effective date | `.publication_date`, `.effective_date` |
| Accessibility / traceability | `.external_uri`, `.content_sha256`, `.uploaded_file_id` |
| Scope | not modelled here — carried by `source_category` + crosswalk applicability |

**Flexibility without metadata soup:** an OEM manual revision is a source version; a professional body's
taxonomy without a formal number simply leaves `reference_number` NULL; an enterprise system's codes
become a source with `source_category='internal_standard'` (scoped) or a future customer layer. No
optional-metadata megatable is introduced.

## J. Edition / version model

- Authority identity is separated from edition by construction: `knowledge_sources` (stable identity,
  identity-locked once versions exist) vs `knowledge_source_versions` (immutable editions).
- The crosswalk references the **edition actually reviewed**, so a later edition cannot retroactively
  change what an approved mapping meant.
- When a new edition renames/splits/removes a classification: the historical crosswalk remains intact
  (immutable once approved), and a **new** crosswalk row is created for the new edition referencing the
  new `external_classification`; the old row is marked superseded via `superseded_by_crosswalk_id`.
- No validity-window/temporal modelling is proposed. The repository's existing "immutable + supersede"
  idiom already answers "what did we believe, and when" without bitemporal complexity.

## K. External classification model

`external_classification` is deliberately thin: it identifies **a concept defined by one edition** —
`classification_code` (e.g. an ISO class code, an OEM assembly code, a customer code), `label`,
optional `classification_path` for hierarchical codes, `description`, `is_active`.

Why an entity rather than repeated text (Option A): a classification is *defined once* and may be
referenced by many Atiman types; it carries **its own evidence** (that the concept exists and means
what we say); and it must be constrained by a real uniqueness rule. This is the minimum that satisfies
requirements 8, 13 and 17 without duplicating the authority registry.

## L. Crosswalk relationship model

One row = one governed proposition: *"Atiman equipment type T is related to external concept C, as
defined by authority edition E, through relationship R, for applicability A, supported by evidence
S, in governance state G."* A row may instead record *"…T was reviewed against E and no defensible
direct mapping exists."*

## M. Review / governance model

Exactly the M1–M4 vocabulary and separation of duties:

- `draft → under_review → approved | rejected`.
- Reviewer attribution (`reviewed_by_user_id`, `reviewed_at`) and approver attribution
  (`approved_by_user_id`, `approved_at`) are separate and **required for `approved`**.
- **AI cannot approve.** `ai_assisted` / `ai_assistance_detail` mirror migrations 009/011; an AI-proposed
  row still requires an accountable human approver, so an AI suggestion can never be presented as
  approved truth (requirement 12).
- Authorization **reuses existing capabilities** — see §AC.

## N. Mapping outcome model

Four relationship outcomes + `NO_DIRECT_MAPPING`, stored in `mapping_outcome` and constrained to be
consistent with `relationship` and `external_classification_id` (check above). Outcome answers *what
was concluded*; review state answers *whether it is governed*. They are deliberately not the same
column.

## O. Null / NO_DIRECT_MAPPING semantics

See §H.3. Additionally:

- An approved `NO_DIRECT_MAPPING` row **must** carry relationship evidence (the review that concluded
  it), so "we found nothing" is itself evidenced rather than asserted.
- Partial uniqueness prevents two contradictory active `NO_DIRECT_MAPPING` rows for the same
  (type, edition).

## P. Evidence / provenance model

**Reuse, not duplication** (requirement 13): evidence references
`knowledge_source_versions(id)` — the same immutable, identity-locked, delete-protected registry M3
already governs.

**Two propositions stay separate** (requirement 8) via exactly-one-subject:

| Subject | Proposition | Example |
|---|---|---|
| `external_classification_id` | *"This external concept exists and denotes X."* | Evidence that ISO 14224 defines a given equipment class |
| `crosswalk_id` | *"Atiman's relationship to it is defensible."* | The engineering review concluding our type is `BROADER_THAN` it |

Source evidence therefore can never silently become relationship evidence. Confidence and supporting
role reuse the existing `established|provisional|experimental|uncertain` and `primary|supporting`
vocabularies, so no new confidence language is invented.

## Q. Supersession / history model

Mirrors the idioms already proven in migrations 009 and 015:

- Rows are **hard-deletable only in `draft`**.
- Once `approved`, the row is immutable except the supersession pointer (trigger-enforced).
- Supersession is a **new row** plus a `superseded_by_crosswalk_id` back-link; self-supersession is
  prohibited and reference validity is checked, mirroring the existing supersession guard.
- **`rejected` proposals are retained**, because a rejection is governed knowledge: "this mapping was
  considered and refused" must remain visible, or the same bad mapping will be re-proposed.
- Evidence rows attached to a superseded crosswalk remain (evidence is a historical record).

## R. Applicability model

Minimum dimensions justified by the evidence:

| Dimension | Representation | Why |
|---|---|---|
| Industry | `applicability_industry_id → industries(id)` **structured, nullable** | Atiman already has a global `industries` reference; prevents an industry-scoped mapping from reading as universal |
| Anything else (jurisdiction, lifecycle phase, OEM context, service) | `applicability_note TEXT` nullable | Deferred until evidence of need (§12) — deliberately not modelled speculatively |

Structured where a governed concept already exists; free text only as the residual. No schema is
created for dimensions with no demonstrated need.

### R.1 The tenant-contamination hazard — and its mitigation

`knowledge_sources.organization_id` is **nullable**, meaning tenant-scoped sources exist. A crosswalk
between the **global** canonical taxonomy and a **tenant-scoped** source would leak customer
terminology into global Atiman knowledge — the contamination M5R.2 forbids.

**Mitigation (must be enforced, not assumed):** a future trigger must reject any crosswalk or evidence
row whose referenced `knowledge_source_versions.knowledge_source.organization_id IS NOT NULL`. This
mirrors the existing `provenance_tenant_scope_check` idiom in migration 011. Recorded here as a
**mandatory implementation constraint** so the next mission cannot omit it.

## S. Customer-specific future compatibility

The crosswalk maps **Atiman canonical identity → public/standard classification** and is therefore
**global**. Customer classification systems (SAP class/type, Maximo classification, customer codes) are
a **different concern** and must **not** be recorded here: doing so would contaminate global taxonomy.

Recommended future shape (not designed, not implemented): a separate, tenant-scoped
*customer-alias layer* keyed to the same canonical `equipment_type`, e.g.
`customer_equipment_alias(organization_id, equipment_type_id, system, customer_code, customer_label)`.
This architecture **accommodates** that without modification — the global crosswalk table never needs a
tenant column — which satisfies requirement 19 while keeping M5R.2's isolation requirement intact.

## T. AI governance boundary

`ai_assisted` + `ai_assistance_detail` (JSONB) on the crosswalk, mirroring migrations 009/011. An AI
proposal is always a `draft`/`under_review` row with a human approver required to reach `approved`.
Existing reviewer/approver attribution is sufficient to preserve the distinction; **no new mechanism is
required**. AI must never populate `approved_by_user_id`.

## U. Publication model

**Decision: crosswalks do NOT get a separate `published` state, and do NOT participate in Knowledge
Pack membership.**

Reasoning:

- A Knowledge Pack composes **immutable published task-template versions** — deliverable operational
  knowledge. A crosswalk is **classification provenance**: an attribute *about* how Atiman knows what a
  thing is. Forcing it into pack semantics would conflate provenance with content.
- M1–M4's publication state exists to freeze a **content snapshot** and to gate external consumption of
  executable knowledge. A crosswalk has no executable content to freeze; `approved` already freezes it
  (immutability trigger + supersession).
- Crosswalk evidence already rides on the same immutable source-version registry that published
  knowledge evidence uses, so a published task's provenance chain remains complete **without** the
  crosswalk being published.

Therefore: **`approved` is the terminal governed state** for a crosswalk. If a future requirement
emerges for crosswalks to travel with published packs, that is a new decision with its own evidence.
This is deliberately the smallest model that does not lie.

## V. Publication vs approval — summary

| Concern | State set | Rationale |
|---|---|---|
| Crosswalk | `draft · under_review · approved · rejected` (+ superseded via back-link) | Provenance, not content; no snapshot to freeze |
| Task template / pack version | existing `published/superseded/retired` | Executable content requiring a frozen snapshot |

## W. PROPOSED — NOT IMPLEMENTED: schema sketch

Non-executable. No migration 016 is created, no SQL executed, no schema modified.

```sql
-- ============================================================
-- PROPOSED — NOT IMPLEMENTED. Requires OWNER approval.
-- ============================================================

CREATE TABLE external_classification (                       -- concept within ONE edition
    id                        INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    knowledge_source_version_id INTEGER NOT NULL,             -- the edition that defines it
    classification_code       VARCHAR(100) NOT NULL,
    classification_label      VARCHAR(500) NOT NULL,
    classification_path       VARCHAR(500) DEFAULT NULL,      -- for hierarchical codes
    description               TEXT,
    is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT uq_external_classification_version_code
        UNIQUE (knowledge_source_version_id, classification_code),
    CONSTRAINT fk_external_classification_source_version
        FOREIGN KEY (knowledge_source_version_id) REFERENCES knowledge_source_versions(id)
        ON DELETE RESTRICT                                    -- edition history is not deletable
);

CREATE TABLE equipment_type_external_classification (          -- the governed relationship
    id                        INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    equipment_type_id         INTEGER NOT NULL,
    knowledge_source_version_id INTEGER NOT NULL,              -- authority/edition INVESTIGATED
    external_classification_id INTEGER DEFAULT NULL,           -- NULL only for NO_DIRECT_MAPPING
    relationship              VARCHAR(30) DEFAULT NULL
        CONSTRAINT chk_..._relationship CHECK (relationship IN
            ('DIRECT_EQUIVALENT','RELATED_TO','BROADER_THAN','NARROWER_THAN')),
    review_state              VARCHAR(20) NOT NULL DEFAULT 'draft'
        CONSTRAINT chk_..._review_state CHECK (review_state IN
            ('draft','under_review','approved','rejected')),
    mapping_outcome           VARCHAR(30) NOT NULL
        CONSTRAINT chk_..._mapping_outcome CHECK (mapping_outcome IN
            ('DIRECT_EQUIVALENT','RELATED_TO','BROADER_THAN','NARROWER_THAN','NO_DIRECT_MAPPING')),
    applicability_industry_id INTEGER DEFAULT NULL,
    applicability_note        TEXT,
    confidence_level          VARCHAR(50) NOT NULL DEFAULT 'provisional'
        CONSTRAINT chk_..._confidence CHECK (confidence_level IN
            ('established','provisional','experimental','uncertain')),
    supporting_role           VARCHAR(50) NOT NULL DEFAULT 'supporting'
        CONSTRAINT chk_..._role CHECK (supporting_role IN ('primary','supporting')),
    proposed_by_user_id       INTEGER DEFAULT NULL,
    reviewed_by_user_id       INTEGER DEFAULT NULL,
    reviewed_at               TIMESTAMPTZ DEFAULT NULL,
    approved_by_user_id       INTEGER DEFAULT NULL,
    approved_at               TIMESTAMPTZ DEFAULT NULL,
    ai_assisted               BOOLEAN NOT NULL DEFAULT FALSE,
    ai_assistance_detail      JSONB DEFAULT NULL,
    superseded_by_crosswalk_id INTEGER DEFAULT NULL,
    created_at                TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),

    -- Outcome/relationship/classification coherence (the §21 solution)
    CONSTRAINT chk_..._outcome_coherent CHECK (
        (mapping_outcome =  'NO_DIRECT_MAPPING'
             AND external_classification_id IS NULL AND relationship IS NULL)
        OR
        (mapping_outcome <> 'NO_DIRECT_MAPPING'
             AND external_classification_id IS NOT NULL AND relationship = mapping_outcome)
    ),
    -- Governance completeness: an approved row carries full accountable attribution
    CONSTRAINT chk_..._approved_requires_attribution CHECK (
        review_state <> 'approved' OR (
            reviewed_by_user_id IS NOT NULL AND reviewed_at   IS NOT NULL AND
            approved_by_user_id IS NOT NULL AND approved_at   IS NOT NULL
        )
    ),
    CONSTRAINT chk_..._no_self_supersession
        CHECK (superseded_by_crosswalk_id IS NULL OR superseded_by_crosswalk_id <> id),

    CONSTRAINT fk_..._equipment_type   FOREIGN KEY (equipment_type_id)
        REFERENCES equipment_types(id)            ON DELETE RESTRICT,
    CONSTRAINT fk_..._source_version   FOREIGN KEY (knowledge_source_version_id)
        REFERENCES knowledge_source_versions(id)  ON DELETE RESTRICT,
    CONSTRAINT fk_..._external_class   FOREIGN KEY (external_classification_id)
        REFERENCES external_classification(id)    ON DELETE RESTRICT,
    CONSTRAINT fk_..._industry         FOREIGN KEY (applicability_industry_id)
        REFERENCES industries(id)                 ON DELETE SET NULL,
    CONSTRAINT fk_..._superseded_by    FOREIGN KEY (superseded_by_crosswalk_id)
        REFERENCES equipment_type_external_classification(id) ON DELETE SET NULL
);

CREATE TABLE equipment_type_external_classification_evidence (
    id                        INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    knowledge_source_version_id INTEGER NOT NULL,
    external_classification_id INTEGER DEFAULT NULL,
    crosswalk_id              INTEGER DEFAULT NULL,
    section_or_clause         VARCHAR(255) DEFAULT NULL,
    page_or_paragraph         VARCHAR(255) DEFAULT NULL,
    derivation_notes          TEXT,
    confidence_level          VARCHAR(50) NOT NULL DEFAULT 'provisional',
    supporting_role           VARCHAR(50) NOT NULL DEFAULT 'supporting',
    added_by_user_id          INTEGER DEFAULT NULL,
    added_at                  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- Exactly one subject: evidence substantiates EITHER the external concept
    -- OR the Atiman relationship, never both, never neither. (011 idiom)
    CONSTRAINT chk_..._exactly_one_subject CHECK (
        (external_classification_id IS NOT NULL AND crosswalk_id IS NULL)
        OR
        (external_classification_id IS NULL AND crosswalk_id IS NOT NULL)
    ),
    CONSTRAINT fk_..._source_version FOREIGN KEY (knowledge_source_version_id)
        REFERENCES knowledge_source_versions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_..._external_class FOREIGN KEY (external_classification_id)
        REFERENCES external_classification(id)   ON DELETE CASCADE,
    CONSTRAINT fk_..._crosswalk      FOREIGN KEY (crosswalk_id)
        REFERENCES equipment_type_external_classification(id) ON DELETE CASCADE
);
```

### W.1 Candidate uniqueness (conceptual, not implemented)

```sql
-- At most one ACTIVE approved mapping per (type, classification, relationship)
CREATE UNIQUE INDEX ... ON equipment_type_external_classification
    (equipment_type_id, external_classification_id, relationship)
    WHERE review_state = 'approved' AND superseded_by_crosswalk_id IS NULL
      AND external_classification_id IS NOT NULL;

-- At most one ACTIVE approved NO_DIRECT_MAPPING per (type, edition)
CREATE UNIQUE INDEX ... ON equipment_type_external_classification
    (equipment_type_id, knowledge_source_version_id)
    WHERE review_state = 'approved' AND superseded_by_crosswalk_id IS NULL
      AND mapping_outcome = 'NO_DIRECT_MAPPING';
```

Note the deliberate asymmetry — these are **partial unique indexes**, so `draft`, `under_review`,
`rejected` and superseded rows may coexist freely; only *simultaneously active approved* duplicates are
constrained. That satisfies requirement 17 while preserving history and allowing competing proposals.

### W.2 Candidate indexes (from actual query needs, §33)

```
equipment_type_external_classification (equipment_type_id, review_state)
equipment_type_external_classification (external_classification_id)
equipment_type_external_classification (knowledge_source_version_id)
equipment_type_external_classification (superseded_by_crosswalk_id)
external_classification (knowledge_source_version_id)
..._evidence (crosswalk_id) ; ..._evidence (external_classification_id)
```

### W.3 Proposed triggers (conceptual)

1. **Immutability**: once `review_state='approved'`, only `superseded_by_crosswalk_id` may change.
2. **Delete protection**: hard delete only while `review_state='draft'`.
3. **Crosswalk subject validity**: `external_classification.knowledge_source_version_id` must equal the
   crosswalk's `knowledge_source_version_id` — a classification from a *different* edition cannot be
   used, which is the primary defence for requirement 6.
4. **Global-scope enforcement**: referenced source must be global (`organization_id IS NULL`) — §R.1.
5. **Supersession validity**: successor must exist and must not self-reference or form a cycle.

## X. PROPOSED — NOT IMPLEMENTED: API sketch

Reusing repository conventions (service → model → controller → routes; `KNOWLEDGE.*` capabilities):

| Operation | Method/path (shape) | Capability |
|---|---|---|
| List crosswalks for an equipment type | `GET /api/equipment-types/:id/external-classifications` | `KNOWLEDGE.VIEW` |
| Read one crosswalk with evidence + history | `GET /api/knowledge-crosswalks/:id` | `KNOWLEDGE.VIEW` |
| Propose a mapping | `POST /api/knowledge-crosswalks` | `TASKS.UPDATE` |
| Edit a draft | `PATCH /api/knowledge-crosswalks/:id` | `TASKS.UPDATE` |
| Submit for review | `POST /api/knowledge-crosswalks/:id/submit-for-review` | `KNOWLEDGE.REVIEW` |
| Record review | `POST /api/knowledge-crosswalks/:id/review` | `KNOWLEDGE.REVIEW` |
| Approve | `POST /api/knowledge-crosswalks/:id/approve` | `KNOWLEDGE.APPROVE` |
| Reject | `POST /api/knowledge-crosswalks/:id/reject` | `KNOWLEDGE.REVIEW` |
| Record `NO_DIRECT_MAPPING` | `POST /api/knowledge-crosswalks` (outcome variant) | `TASKS.UPDATE` |
| Supersede with a new-edition mapping | `POST /api/knowledge-crosswalks/:id/supersede` | `KNOWLEDGE.APPROVE` |
| Attach / detach evidence | `POST|DELETE /api/knowledge-crosswalks/:id/evidence` | `TASKS.UPDATE` |
| Register authority + edition | reuse existing provenance routes | `TASKS.CREATE` / `TASKS.UPDATE` |

## Y. UX architectural requirements

A future engineer view must visibly distinguish — and must never blur — these six states:

`UNREVIEWED` (no row) · `PROPOSED` (draft) · `IN REVIEW` (under_review) ·
**`APPROVED MAPPING`** · **`APPROVED — NO DIRECT MAPPING`** · `REJECTED` · `SUPERSEDED`.

Architectural requirement: the read model must expose `review_state` **and** `mapping_outcome`
**separately**, and the UI must render them as independent facts — a single "status" string would
collapse the distinction this architecture exists to preserve. History (superseded rows, rejected
proposals) must be reachable from the same view. No screen is designed here.

## Z. Query walkthrough (conceptual)

| Question | How the model answers |
|---|---|
| Approved external classifications for this type? | `review_state='approved' AND superseded_by IS NULL AND equipment_type_id=?` |
| Which standard/edition supports each? | join `knowledge_source_versions` (+ `reference_number`, `version_designation`) |
| What evidence supports the relationship? | evidence rows where `crosswalk_id=?` |
| What evidence supports the external concept itself? | evidence rows where `external_classification_id=?` |
| Proposed but unapproved? | `review_state IN ('draft','under_review')` |
| Never reviewed against a given authority? | left-join on (type × source_version) where no row exists |
| Reviewed and NO_DIRECT_MAPPING? | `mapping_outcome='NO_DIRECT_MAPPING' AND review_state='approved'` |
| Mappings relying on inaccessible or weak evidence? | join evidence → `confidence_level IN ('experimental','uncertain')` or source with `external_uri`/`uploaded_file_id` NULL |
| Which mappings were superseded? | `superseded_by_crosswalk_id IS NOT NULL` |
| What changed between editions? | compare approved rows across two `knowledge_source_version_id`s |
| Types with multiple external relationships? | `GROUP BY equipment_type_id HAVING COUNT(DISTINCT knowledge_source_version_id) > 1` |
| What did we review and reject? | `review_state='rejected'` (retained, not deleted) |

Every question is answerable by ordinary relational predicates — no JSON interpretation required
(requirement 15).

## AA. Scale / performance

Estimated ceiling: ~10³ Atiman types × ~10 authorities × ~3 editions × ~2 relationships ≈ **10⁴–10⁵
crosswalk rows**, and a similar order for evidence. At that scale the partial unique indexes and the
six candidate indexes above are more than sufficient; no caching, denormalization or search
infrastructure is justified. An **external classification** row count is bounded by (editions × classes
per edition) — likewise small. The design deliberately avoids optimising for millions of rows
(§33).

## AB. Future data-migration input classification (planning only — nothing migrated)

| Input | Classification | Reason |
|---|---|---|
| `activity_codes.iso_maintenance_reference` | **FALSE_PROVENANCE** | `ISO14224-*` labels; lineage unverifiable (Annex A/B inaccessible) |
| `cause_codes.iso_failure_cause_reference` | **FALSE_PROVENANCE** | same |
| 60-type legacy design dataset | **NEEDS_REVIEW** | ODM-authored; architecture-validation examples only |
| 282 candidate equipment types | **NEEDS_REVIEW** | Not reconciled by this mission |
| `iso14224_master_taxonomy*` naming (pre-M5R.2A) | resolved | See M5R.2A |
| Manila Water SMPs / `SMP Folder/smps.csv` | **PROPRIETARY_EXCLUDED** | `EXCLUDED_PROPRIETARY_LEGACY_MATERIAL` |
| Any mapping derivable from the above without new evidence | **UNSUPPORTED** | Must be re-derived from a real authority edition |

**Explicit rule for the future:** the two `iso_*_reference` columns must **never** be bulk-imported into
the crosswalk as trusted mappings. At most they are *candidates* requiring independent verification
against an accessible edition.

## AC. Authorization model

**Reuse, no new capabilities** (requirement: avoid a permission zoo):

| Action | Existing capability | Notes |
|---|---|---|
| View crosswalks and history | `KNOWLEDGE.VIEW` | already granted to all roles |
| Propose / edit draft / attach evidence | `TASKS.UPDATE` | admin-only — **same shape as M3 provenance authoring** |
| Register authority + edition | `TASKS.CREATE` / `TASKS.UPDATE` | reuses existing provenance routes |
| Submit for review / review / reject | `KNOWLEDGE.REVIEW` | admin + supervisor |
| Approve | `KNOWLEDGE.APPROVE` | admin + supervisor |
| Supersede an approved mapping | `KNOWLEDGE.APPROVE` | it is a governed conclusion |

**Identified authorization question (flagged, not decided):** proposing a mapping requires
`TASKS.UPDATE`, which is **admin-only**. If OWNER intends practising engineers (supervisors) to propose
candidate mappings, that requires broadening a capability — an authorization decision, not an
architecture defect. M3 has the identical shape today, so this is consistent rather than novel.

## AD. First VUDA (findings + corrections)

| # | Challenge | Finding | Severity | Correction applied |
|---|---|---|---|---|
| A | Canonical ownership | Crosswalk FKs point **from** Atiman type; no external entity is a parent of identity | — | none needed |
| B | False equivalence | `DIRECT_EQUIVALENT` is a *checked* value, but nothing mechanically prevents a human choosing it wrongly | **MAJOR** | Mitigated architecturally: strict definition + `relationship = mapping_outcome` coherence check + evidence required on both propositions + reviewer/approver attribution. Residual is **human judgement**, correctly out of scope for a schema |
| C | Null vs NO_DIRECT_MAPPING | Naïve nullable FK would collapse the two | MAJOR | **Corrected**: outcome/relationship/classification coherence CHECK (§H.1) |
| D | NDM without fake classification | Original sketch had no way to record the investigated edition | **BLOCKER** | **Corrected**: `knowledge_source_version_id` is NOT NULL on every crosswalk row (§H.1) |
| E | Review state vs outcome | Collapsing them makes "found nothing" and "equivalent" share a column | MAJOR | **Corrected**: two separate dimensions (§H.1) |
| F | Edition provenance | `external_classification` keyed only to authority would let an edition change rewrite meaning | MAJOR | **Corrected**: classification keyed to `knowledge_source_version_id`; trigger requires the crosswalk and classification editions to match (§W.3.3) |
| G | Evidence required | An `approved` row could exist with no evidence | MAJOR | **Corrected**: attribution CHECK; plus a policy requirement that approval is evidence-backed (§O, §P). Note: enforcing "≥1 evidence row" is cross-table and remains a **service/domain** rule — consistent with migration 013's documented boundary |
| H | Source vs relationship evidence | One evidence table would conflate both propositions | MAJOR | **Corrected**: exactly-one-subject evidence (§P) |
| I | Supersession | Historical rows could be lost | MINOR | Addressed: immutable-after-approval + supersession back-link; rejected rows retained (§Q) |
| J | Duplication | Contradictory active approval could exist silently | MAJOR | **Corrected**: partial unique indexes (§W.1) |
| K | Customer contamination | `knowledge_sources.organization_id` is nullable → a tenant source could enter a **global** crosswalk | **BLOCKER** | **Corrected**: mandatory global-scope trigger (§R.1) — flagged as a must-not-omit implementation constraint |
| L | AI authority | AI could appear as truth | MINOR | Addressed: `ai_assisted` + human approver required; no new mechanism needed (§T) |
| M | Publication fit | Forcing packs onto crosswalks | MINOR | Addressed by explicit decision **not** to publish (§U) |
| N | Over-engineering | Risk of an ontology platform | — | Avoided: 3 tables, 4 relationships, no temporal/validity model, no metadata megatable |
| O | Under-engineering | Option A collapse into master-data columns | — | Avoided by selecting Option C (§F) |
| P | Proprietary knowledge | Customer/proprietary classification could become global | MAJOR | Addressed via §R.1 + §S isolation and the `PROPRIETARY_EXCLUDED` classification (§AB) |
| Q | Deletion | Approved knowledge vanishing | MINOR | Addressed: draft-only delete, RESTRICT FKs (§W.3.2) |
| R | Queryability | Meaning buried in JSON | — | Avoided: all decision-relevant meaning is in typed columns; JSONB used only for AI detail |
| S | Scale | Premature infrastructure | — | Avoided (§AA) |
| T | Implementability | Fits current stack? | — | Yes: PostgreSQL only, migration-00x conventions, `pg` driver, node:test, existing capabilities — **no new dependency or framework** |

**Corrections demanded by the first VUDA were applied to the proposal itself** (actions D, E, F, H, J,
K in particular), not merely documented — per §39 Phase 15.

## AE. Second VUDA (re-test after correction)

| Challenge | Before | After |
|---|---|---|
| Canonical ownership | pass | **pass** — external entities are referenced, never parents |
| False equivalence | checked value only | **pass (architectural)** — strict definition + coherence check; residual is human judgement, explicitly bounded |
| Null vs `NO_DIRECT_MAPPING` | collapse possible | **pass** — coherence CHECK makes the collapse unrepresentable |
| Governance status vs outcome | collapsed | **pass** — separate columns, separate semantics |
| Edition history | rewriteable | **pass** — classification keyed to edition; cross-edition reference rejected by trigger |
| Evidence provenance | conflated | **pass** — exactly-one-subject evidence |
| Customer isolation | contaminating | **pass** — mandatory global-source trigger; customer layer kept separate (§S) |
| AI authority | ambiguous | **pass** — human approver required; AI can never approve |
| Over-engineering | — | **pass** — 3 tables, no temporal model, no megatable |
| Implementability | — | **pass** — fits current stack and conventions |

**Residual findings: none classified BLOCKER or MAJOR.** Two items remain deliberately open and are
**not** architecture defects:

1. Whether proposing should be broadened beyond admin (`TASKS.UPDATE`) — an **authorization** decision
   (§AC).
2. Whether crosswalks should ever be externally publishable — a **product** decision (§U). The
   architecture does not preclude it; it simply does not force it.

## AF. Architecture acceptance tests (§41) — all 25

Recorded in full in `docs/research/m5r3/architecture-case-matrix.jsonl`. Summary: **25 of 25
representable without lying**; the four cases that specifically stress the design are:

| Case | Representation |
|---|---|
| 5 — reviewed, NO_DIRECT_MAPPING | `outcome='NO_DIRECT_MAPPING'`, `external_classification_id NULL`, `source_version_id` set, `approved` |
| 6 — never reviewed | **no row** (distinct from case 5) |
| 20 — classification absent without meaning NDM | absent FK **plus** `review_state ≠ approved` ⇒ not a conclusion |
| 22 — `DIRECT_EQUIVALENT` not inferred from labels | requires an explicit human-chosen, evidence-backed, separately-approved value |

## AG. Failure-mode review (§13)

| Failure mode | Defence |
|---|---|
| Fake equivalence | strict definition; coherence check; evidence on both propositions; human approval |
| Lost edition | immutable source versions; classification keyed to edition; cross-edition reference rejected |
| Null read as no-mapping | coherence CHECK; outcome column carries the meaning |
| Rejected proposal presented as approved | `review_state` separate; rejected rows retained and queryable |
| AI suggestion presented as truth | `ai_assisted` + mandatory human approver |
| Duplicate active mapping | partial unique indexes |
| Superseded returned as current | `superseded_by_crosswalk_id IS NULL` in the read model |
| Customer classification contaminating global | global-source trigger; separate future alias layer |
| Evidence deleted | `ON DELETE RESTRICT` on source versions; evidence is historical |
| External authority renamed | `knowledge_sources` identity-lock trigger; change creates a new source/edition |
| Source inaccessible | `confidence_level` + `SOURCE_ACCESS_LIMITATION` recorded at source-version level |
| Inventory/denormalization drift | none introduced |

## AH. Project Source / documentation sync items

**`PROJECT_SOURCE_OR_DOCUMENTATION_SYNC_ITEM` (recorded, not actioned):**

1. **`PROJECT_SOURCE_SYNCHRONIZATION_REQUIRED`** (carried from M5R.2) — the authoritative project-level
   Atiman Project Source exists outside this repository and may carry older repository/taxonomy/
   Knowledge-Foundation terminology requiring controlled synchronization with the approved ADRs. No
   repository-resident copy exists, so no conflict could be evaluated from repository evidence.
2. Documentation that still presents `iso_maintenance_reference` / `iso_failure_cause_reference` as
   ISO lineage (legacy docs, MySQL migrations) conflicts with the verified ISO 14224 scope. Recorded in
   M5R.2 §17 as out-of-scope debt; restated here because the crosswalk architecture is the eventual
   correct home for that information.

No broad governance documentation was silently rewritten.

## AI. Open questions (genuine)

1. **Authorization**: should candidate crosswalk proposals be permitted for supervisors, or remain
   admin-only (`TASKS.UPDATE`) as in M3?
2. **Publication**: is there any future requirement for crosswalks to be externally consumable as part
   of a published pack? Current decision: no.
3. **Applicability granularity**: is industry the only structured applicability dimension Atiman needs,
   or must jurisdiction/lifecycle phase be modelled structurally?
4. **External classification granularity**: should Atiman record *hierarchical paths* for external
   codes (modelled as an optional text path today) or a full external hierarchy later?

None blocks convergence; each is a product decision, not an architecture defect.

## AJ. Proposed implementation plan (smallest future slices)

Derived from the architecture, not assumed:

| Slice | Content | Why this order |
|---|---|---|
| **M5R.3A** | Authority/edition groundwork: **no new tables** — verify that `knowledge_sources` + `knowledge_source_versions` cleanly represent an external authority edition end-to-end (register ISO 14224:2016 as a *source*, not as a mapping), including the global-scope rule | Everything else depends on authority identity being correct; smallest possible slice; may need no migration at all |
| **M5R.3B** | `external_classification` table + edition-coherence trigger | The external concept must exist before a relationship can point at it |
| **M5R.3C** | `equipment_type_external_classification` + coherence/attribution CHECKs + immutability/deletion/supersession triggers + partial unique indexes + global-scope trigger | The governed relationship itself |
| **M5R.3D** | Crosswalk evidence table (exactly-one-subject) | Evidence can attach once subjects exist |
| **M5R.3E** | Service/model/controller/routes read + lifecycle operations, reusing capabilities | Only after the schema is approved and populated in a disposable environment |
| **M5R.3F** | Candidate reconciliation against real editions (the 282 types) | Depends on having a truthful place to record conclusions — deliberately last |

**No slice is authorised by this record.** A realistic first implementation slice is M5R.3A + M5R.3B.

## AK. Explicit no-change confirmation

No schema change · **no migration 016** · no modification to migrations 001–015 · no database mutation ·
**no production access** (no production DB connection, no production SQL of any kind) · no Supabase
mutation · no Render mutation · **no deployment** · no runtime or API change · **no taxonomy semantic
change** · **no mapping population** · no 282-type reconciliation · no 60-type reconciliation · no
maintenance-task population · no decomposition implementation · no tenancy/customer-alias
implementation · **no PR #27 modification** · no M5R.4 · no M6 · no ATM-002.

Manila Water proprietary material remains `EXCLUDED_PROPRIETARY_LEGACY_MATERIAL` and contributes no
Atiman Core Knowledge.

---

## AL. Decision requested

**Approval of Option C** as the standards-crosswalk architecture, and confirmation of:

1. governance status and mapping outcome as **separate dimensions** (§H.1);
2. `knowledge_source_version_id` **NOT NULL** on every crosswalk, with a nullable
   `external_classification_id` (§H.1) — the §21 solution;
3. relationship vocabulary of **four** values, with `NO_DIRECT_MAPPING` reclassified as an **outcome**
   and `SECTOR_SPECIFIC_EQUIVALENT` **dropped** in favour of applicability (§H.2);
4. reuse of `knowledge_sources` / `knowledge_source_versions` as the authority+edition registry, with
   **no** parallel registry (§I);
5. crosswalks **not** participating in Knowledge Pack publication (§U);
6. the **mandatory global-source trigger** (§R.1) as a non-omittable implementation constraint.
