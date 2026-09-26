# ATM-001 M5R.4B1 — Taxonomy Identity Lifecycle Architecture (Discovery)

**Status:** Discovery / architecture recommendation, **corrected by M5R.4B1-R1**. **Awaiting OWNER review.**
**Baseline:** `origin/main` = `abfd6c8be83ee3201b8deea8f0c08a25952e4cda`, tree `0dbadf1c9bfcc951f6f08e1a90bf7c3e8efbd83a` (the M5R.4A merge).

**Revision history**

| Revision | Change |
|---|---|
| M5R.4B1 | First issue: Option D recommendation; B1-1/B1-2/B1-3 reported; three findings recorded as blocking M5R.4B2. |
| **M5R.4B1-R1** | OWNER rulings applied. **B1-1 is substantially reversed:** the live taxonomy already contains a semantically correct parent for **59 of the 62** placement-bearing rows, and M5R.4A's 18 proposed categories were largely duplicate restatements of categories that already exist. **B1-2 and B1-3 are closed.** The 3 `INSUFFICIENT_EVIDENCE` rows are **not** retired (RULING 1), which revises the representation partition from **227 / 19 / 36** to **230 / 19 / 33**. Terminology population fixed at **65** terms with `ABBREVIATION` shown to be orthogonal to relationship kind. Option D **upheld, with one clarification**: unresolved governance is not a lifecycle state. Succeeded content is marked **[R1]**; the superseded reading is retained in §5.5 for the audit trail. See **§21** for the closure record. |
**Migrations at baseline:** 001–018. **Migration 019: ABSENT.**
**Scope of this record:** documentation and repository investigation only. No schema, migration, seed, code, test, API, UI, crosswalk, evidence or taxonomy change was made.
**Supersedes:** nothing. **Reopens:** nothing. M5R.4A engineering dispositions are treated as **accepted and frozen**.

**Required-contents map** (mission §16 → this record):

| §16 item | Section here |
|---|---|
| 1 Executive decision summary | §1 |
| 2 Current-state schema | §2 (2.1–2.4) |
| 3 Current identity semantics | §2.5 |
| 4 Referential dependency map | §4 |
| 5 Accepted M5R.4A representation requirements | §5 |
| 6 Semantic definitions | §6 |
| 7 Architecture options | §7 |
| 8 Comparative analysis | §8 |
| 9 Preferred architecture | §9 |
| 10 Proposed data semantics | §10 |
| 11 Invariants | §11 |
| 12 Provenance / governance model | §12 |
| 13 External integration behaviour | §13 |
| 14 AI boundaries | §14 |
| 15 VUDA results | §15 |
| 16 Migration necessity assessment | §16 |
| 17 Proposed M5R.4B2 boundary | §17 (preconditions §17.3) |
| 18 Deferred work | §18 |
| 19 Open questions | §19 |
| *(also)* existing lifecycle capability (mission §5C) | §3 |
| *(also)* explicitly not done (mission §15) | §20 |
| **(R1)** parent-taxonomy and unresolved-identity closure | §21 |
| **(R1)** the 62-row parent-placement decision table | `docs/research/m5r4b1/parent-taxonomy-placement-review.jsonl` |

---

## 1. Executive decision summary

### 1.1 The question

M5R.4A accepted a governed reconciliation of 282 equipment-Type identity candidates, including `MERGE_DUPLICATE` (17), `SYNONYM_OR_ALIAS` (2), `RECLASSIFY` (33) and `NOT_EQUIPMENT_TYPE` (29). Atiman has **no mechanism** to express "this identity is a synonym of that one", "this identity has been superseded by that one", or "this vocabulary is historically meaningful but is no longer a canonical Type". Deletion is not an acceptable default.

### 1.2 The finding

The investigation establishes that **at least five semantically different things are bundled inside the M5R.4A decision set**, and that a single "synonym" or "supersession" mechanism cannot represent them:

| # | What actually has to be represented | M5R.4A rows |
|---|---|---|
| a | A Type **row is inserted** as a new canonical identity | `ADD_TYPE` 29 |
| b | A Type **row keeps its identity but moves** (class, and often name) | `RECLASSIFY` 33 |
| c | A Type **row keeps its identity and only its name changes** | 36 `KEEP_EXISTING` renames |
| d | A Type **row stops being a canonical identity**, and the engineering identity continues under another Type | `MERGE_DUPLICATE` 17 + `SYNONYM_OR_ALIAS` 2 = **19** |
| e | A concept **stops being a Type at all**, with **no** Type successor | `NOT_EQUIPMENT_TYPE` 29 + `TOO_BROAD_CONTAINER` 4 = **33** |
| f | A concept **cannot be concluded at all** — insufficient evidence | `INSUFFICIENT_EVIDENCE` **3** — **[R1] not retired**; see §21.7 |

**(a)(b)(c) are Type-row concerns. (d) is an identity-resolution concern. (e) is a retirement concern with no successor. (f) is a governance/decision concern, which R1 rules is NOT a lifecycle concern.** Requirements (c) and (d) additionally create **legacy vocabulary** that must stay resolvable: 46 existing identities are renamed (§5.4) and 19 retire with a target.

**[R1] Revised partition:** 230 remain canonical (227 + the 3 unresolved rows, which stay `canonical` and selectable) · 19 leave with a canonical target · 33 retire = **282**.

### 1.3 The recommendation

**OPTION D — canonical identity + governed standing + governed terminology**, built entirely from idioms the repository already uses.

1. **One additive column** on `equipment_types`: `identity_state` ∈ (`canonical`, `superseded`, `retired`), default `canonical`.
2. **One governed resolution table** recording, for each identity whose standing changes, the source Type, the optional canonical successor, the relationship kind, full human attribution, AI-assistance disclosure, provenance and effectivity. **All 52 rows of (d) and (e) get exactly one row here**, so retirement without a successor is represented as *positive governed knowledge* rather than as an absence. The 3 rows of **(f)** get a **pending** record in the same table that changes no lifecycle state — **[R1]**.
3. **One governed terminology table** mapping a term (legacy name, synonym, or merged-identity term) to its canonical Type, so renamed and merged vocabulary stays discoverable. **[R1]** `ABBREVIATION` is **not** a distinct kind: R1 proves it is orthogonal to the relationship (11 legacy names and 2 merged-identity terms are abbreviation-form), so it is at most an attribute. See §21.8.

**Not recommended now:** any tenant-scoped/customer alias layer. M5R.1 §6.2 defers it and M5R.4A produced **zero** `CUSTOMER_SPECIFIC` rows.

### 1.4 Schema change

**Necessary.** Option E (no schema change) is **not viable** (§7.6, §16). Migration 019 will eventually be required, with a bounded scope stated in §16.3. **It was not written.**

### 1.5 Findings, and their disposition after R1 **[R1]**

| ID | Finding at M5R.4B1 | Disposition after R1 |
|---|---|---|
| **B1-1** | All 62 placement-bearing rows target a `(category, class)` pair that does not exist; 46 pairs missing, 18 new categories and 44 new class names needed. | **REVERSED IN SUBSTANCE.** True only of the *pairing*. The live taxonomy already contains a semantically correct parent for **59 of 62** rows; **48 of 62 placements are unchanged**; only **1 new Category** (`Mining Equipment`) and **5 new Classes** are genuinely required. M5R.4A's 18 proposed categories were almost all **duplicate restatements** of existing ones. Detail in §21.3. |
| **B1-2** | Candidates 7 and 8 merge into `Submersible Pump`, a class name that no accepted disposition establishes as a Type. | **CLOSED.** Confirmed as the same class-promotion pattern M5R.4A applies to 8 other rows. Resolution: the class-level identity `Pump > Submersible Pump` must be established as a Type. Adds **1 Type** (29 → 30). OWNER ratification required. Detail in §21.5. |
| **B1-3** | Candidate 56 merges into its own name; intended target is candidate 200. | **CLOSED — CONFIRMED.** M5R.4A §7C states the basis in its own words. Endpoint fixed by immutable identity, not text. No ambiguity remains. Detail in §21.6. |

Two further package observations were recorded during R1 and are **not** corrections to M5R.4A: **id 37** (`Orifice Plate`) is the one `ADD_TYPE` row carrying **no proposed parent at all**, and **2 `KEEP_EXISTING` rows** (167, 273) also propose a different parent, placing them outside the mission's 62-row definition. See §21.4.

### 1.6 Consequence **[R1]**

The identity-lifecycle mechanism is decided (Option D, upheld). The parent-taxonomy dependency is **resolved in principle but not yet ratified**: R1 determines a defensible parent for all 62 rows using **1 new Category and 5 new Classes**, and identifies **35 rows** whose resolution overrides an M5R.4A proposed parent name — every one of which is an OWNER decision. M5R.4B2 remains **not executable** until those ratifications are given and migration 019 is authorised, but it is no longer blocked by a missing structural domain.

---

## 2. Current-state schema (A)

### 2.1 The identity hierarchy

`database/postgresql/002_equipment_taxonomy.sql`:

```sql
equipment_categories ( id PK, category_code UNIQUE, category_name, description,
                       created_at, updated_at )

equipment_classes    ( id PK, category_id FK -> equipment_categories(id) ON DELETE CASCADE,
                       class_code, class_name, description, created_at, updated_at,
                       UNIQUE (category_id, class_code) )

equipment_types      ( id PK, class_id FK -> equipment_classes(id) ON DELETE CASCADE,
                       type_code, type_name, description, typical_components,
                       created_at, updated_at,
                       UNIQUE (class_id, type_code) )
```

### 2.2 Adjacent taxonomy structures

| Table | Attachment | Notes |
|---|---|---|
| `equipment_type_industries` | `equipment_type_id` → CASCADE | applicability; PK `(equipment_type_id, industry_id)`; `criticality` CHECK A/B/C |
| `subunits` | `equipment_type_id` → CASCADE | decomposition; empty |
| `equipment_subunits` | `equipment_type_id` → CASCADE | structurally identical to `subunits` — one is vestigial (`ARCHITECTURE_GAP-3`) |
| `maintainable_items` | `subunit_id` → `equipment_subunits` → CASCADE | decomposition; empty |
| `object_parts`, `damage_codes` | `equipment_class_id` → CASCADE | attached at **Class**, not Type |
| `failure_modes` | `equipment_type_id` → CASCADE | reliability vocabulary |
| `equipment` (installed asset) | `equipment_type_id` → **SET NULL** | operational tenant data, outside the Knowledge Foundation |
| `equipment_mapping_change_log` | `equipment_type_id` | append-only **operational audit log**; no approval state, no FK to a target |
| `task_templates` | `equipment_type_id` → CASCADE | knowledge |
| `task_template_versions` | `equipment_type_id` → **RESTRICT** | knowledge (migration 009) |
| `equipment_type_external_classification` | `equipment_type_id` → **RESTRICT** | standards crosswalk (migration 017) |
| `equipment_type_external_classification_evidence` | via crosswalk / external concept | evidence (migration 018) |
| `equipment_type_family_mappings`, `equipment_type_family_proposals`, `template_families`, `template_family_rules` | `equipment_type_id` / `family_code` | **legacy template-family construct**, see §4.4 |

### 2.3 Indexes

`007_indexes.sql` creates **no index whose leading column is on `equipment_types`**. `UNIQUE (class_id, type_code)` supplies the only btree, usable for `class_id` prefix lookups. **There is no index on `type_name`.** There is no index on `equipment_classes.class_name` or on category names.

### 2.4 Views

`008_views.sql` exposes taxonomy through several views. One is notable because it carries the false-provenance vocabulary into a queryable object:

```sql
COALESCE(ec.category_name,'') || ' > ' || COALESCE(ecl.class_name,'') || ' > '
  || COALESCE(et.type_name,'') AS iso_classification
```

### 2.5 Identity semantics (B)

An equipment Type is identified today by **`equipment_types.id`** (integer identity primary key). The only uniqueness rule is:

```
UNIQUE (class_id, type_code)
```

Therefore, **today**:

- `type_code` is unique **within a class only** — not globally. Verified: `COMPACT` occurs in two classes (`PLC Controller`, `Screw Conveyor`).
- `type_name` is **not unique at all**, locally or globally. Verified: `Pressure Filter` occurs twice, in different classes.
- There is **no** status, state, lifecycle, effective-date, canonical, successor, provenance or AI-disclosure column on `equipment_types`. **No column has ever been added to `equipment_types`**: the only `ALTER TABLE equipment_types` in migrations 001–018 is at `002:243`, inside an idempotency guard, and it adds the `class_id` **foreign key** — not a column. The same is true of `equipment_classes` (`002:228`) and `equipment_categories`.
- There is **no** `is_active` on `equipment_types` either. Its presence on sibling vocabulary tables (`object_parts`, `damage_codes`, `cause_codes`, `activity_codes`, `failure_modes`, `template_families`, `task_templates`) is inconsistent, and the Knowledge Foundation §15 already rules that `is_active` alone is **insufficient** for governed knowledge.

**Consequence:** duplicate canonical identities are **structurally permitted today**. Nothing in the schema prevents two Types from carrying the same name, and nothing prevents a "synonym" from existing as a second canonical Type.

---

## 3. Existing lifecycle capability (C)

The repository was searched (case-insensitively, across `database/`, `src/`, `scripts/`, `views/`, `tests/`, `docs/`) for: `alias`, `synonym`, `supersede(s|d)`, `replaced_by`, `canonical`, `deprecated`, `inactive`, `active`, `retired`, `redirect`, `redirect_to`, `merge`, `historical`, `alternate name`, `preferred name`, `terminology`, `alias_of`.

### 3.1 What does **not** exist

- **No synonym mechanism** anywhere. The word `synonym` does not occur in any migration or runtime file.
- **No alias mechanism.** The word `alias` occurs only as (i) three migration comments that explicitly state a customer alias layer is **not** built, and (ii) an unrelated `execute` compatibility alias in `src/config/database.js`.
- **No `replaced_by`, `redirect_to`, `preferred name`, `alternate name`, `deprecated`.**
- **No lifecycle state on `equipment_types`.**

### 3.2 What does exist

| Mechanism | Where | What it governs | Reusable for Type identity? |
|---|---|---|---|
| **Supersession by back-link + cycle detection + immutability** | `009_knowledge_versioning.sql` (`knowledge_pack_versions`, `task_template_versions`) | *versions of* knowledge, not Type identity | **Pattern: YES.** Directly reusable idiom (§3.3). Different subject. |
| **Governed relationship row** (`review_state`, outcome, attribution CHECK, `ai_assisted`, partial unique among *active* rows, `superseded_by_*` back-link, RESTRICT FKs, delete guard) | `017_equipment_type_external_classification_crosswalk.sql` | Atiman Type ↔ **external** classification | **Pattern: YES, and closest in shape.** Subject is external, not Atiman-internal. |
| **Evidence rows with exactly-one-subject XOR CHECK** | `018_..._crosswalk_evidence.sql`, `011_knowledge_provenance.sql` | evidence for crosswalks / templates | **Pattern: YES** for subject modelling. |
| **Source + source-version provenance with `legacy_migration` / `engineering_authored` categories, NULL org = global** | `011_knowledge_provenance.sql` | provenance substrate | **Directly reusable as-is.** |
| **Append-only operational audit log** | `equipment_mapping_change_log` (002) | family/industry mapping changes | **NO** — see §8.3. |
| **Governed proposal → review → applied** | `equipment_type_family_proposals` (003) | template **family** proposals | **Pattern: informative only.** Slated for removal (§4.4). |

### 3.3 The `009` supersession idiom (the repository's own answer to "superseded by")

`009` implements exactly the primitive M5R.4A needs, for versions:

```sql
lifecycle_state CHECK (lifecycle_state IN
    ('draft','under_review','approved','published','superseded','retired')),
superseded_by_version_id INTEGER DEFAULT NULL,
  FOREIGN KEY (superseded_by_version_id) REFERENCES ...(id) ON DELETE SET NULL
```

plus `valid_pack_version_supersession_check()`, which:

1. coerces `NEW.lifecycle_state := 'superseded'` when a successor is assigned;
2. refuses a `superseded` row without a successor;
3. refuses **self**-supersession;
4. refuses a successor belonging to a different parent;
5. requires the successor to be currently `published`;
6. **walks the successor chain with a `visited` array to refuse cycles**;
7. is paired with `immutable_version_update_check()` (sealed rows may change only `superseded_by_version_id`, `effective_until`, `lifecycle_state`) and `immutable_version_delete_check()` (deletion refused).

### 3.4 The `017` governed-relationship idiom (the repository's own answer to "governed relationship about a Type")

```sql
review_state CHECK (review_state IN ('draft','under_review','approved','rejected')),
mapping_outcome CHECK (... IN ('DIRECT_EQUIVALENT','RELATED_TO','BROADER_THAN',
                               'NARROWER_THAN','NO_DIRECT_MAPPING')),
proposed_by_user_id, reviewed_by_user_id, reviewed_at,
approved_by_user_id, approved_at,
ai_assisted BOOLEAN NOT NULL DEFAULT FALSE, ai_assistance_detail JSONB,
superseded_by_crosswalk_id,                       -- "a NEW row plus this back-link.
                                                  --  Never an in-place rewrite."
CHECK (superseded_by_crosswalk_id IS NULL OR superseded_by_crosswalk_id <> id),
CHECK (review_state <> 'approved' OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL
       AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)),
-- partial uniqueness: ONLY active+approved rows are constrained
CREATE UNIQUE INDEX ... WHERE review_state = 'approved' AND superseded_by_crosswalk_id IS NULL ...
-- RESTRICT FKs throughout:
FOREIGN KEY (equipment_type_id) REFERENCES equipment_types(id) ON DELETE RESTRICT
```

with the stated principle: *"Only simultaneously ACTIVE and APPROVED rows are constrained. draft, under_review, rejected and superseded rows may coexist freely, so competing proposals and full history remain representable. **Uniqueness is never achieved by deleting old knowledge.**"*

And the `017` coherence principle that a negative conclusion is legitimate positive knowledge:

```sql
CHECK ( (mapping_outcome = 'NO_DIRECT_MAPPING' AND external_classification_id IS NULL)
     OR (mapping_outcome <> 'NO_DIRECT_MAPPING' AND external_classification_id IS NOT NULL) )
```

*"a NO_DIRECT_MAPPING conclusion is positive engineering knowledge, and no fake classification is fabricated to hold its evidence."*

### 3.5 Why this does not mean the problem is already solved

`016`/`017`/`018` govern the relationship between an **Atiman Type** and an **external classification**, and they say so explicitly:

- `017`: *"Atiman canonical identity is referenced, never modified."* / *"no customer alias layer"*
- `016`: *"any customer alias layer"* is out of scope
- `018`: *"belong to a separate tenant-scoped alias layer that is NOT built here"*

**Nothing in the repository governs a relationship between two Atiman Types.** The problem is genuine; the *pattern* is established. The recommendation in §9 is therefore an application of the repository's own architecture, not an invention.

---

## 4. Referential dependency map (D)

### 4.1 Everything that references a Type identity

Complete FK map, extracted from all 18 migrations:

| Referencing table | Column | Action on delete of the Type | Meaning |
|---|---|---|---|
| `equipment_type_industries` | `equipment_type_id` | **CASCADE** | industry applicability destroyed |
| `subunits` | `equipment_type_id` | **CASCADE** | decomposition destroyed |
| `equipment_subunits` | `equipment_type_id` | **CASCADE** | decomposition destroyed |
| `failure_modes` | `equipment_type_id` | **CASCADE** | reliability knowledge destroyed |
| `equipment_type_family_mappings` | `equipment_type_id` | **CASCADE** | legacy grouping destroyed |
| `equipment_type_family_proposals` | `equipment_type_id` | **CASCADE** | legacy proposals destroyed |
| `task_templates` | `equipment_type_id` | **CASCADE** | **maintenance knowledge destroyed** |
| `equipment` (asset) | `equipment_type_id` | **SET NULL** | **asset classification silently erased** |
| `work_order_failures` | `equipment_type_id` | **SET NULL** | historical failure classification erased |
| `task_template_versions` | `equipment_type_id` | **RESTRICT** | governed |
| `equipment_type_external_classification` | `equipment_type_id` | **RESTRICT** | governed |

And one level up:

| Referencing table | Column | Action | Consequence |
|---|---|---|---|
| `equipment_types` | `class_id` | **CASCADE** | deleting a **Class** deletes its **Types** |
| `equipment_classes` | `category_id` | **CASCADE** | deleting a **Category** deletes its **Classes** → its **Types** |
| `object_parts`, `damage_codes` | `equipment_class_id` | **CASCADE** | vocabulary destroyed with the Class |

**Deleting one Category can therefore cascade through Classes → Types → applicability, decomposition, failure modes and task templates, while silently NULLing asset and work-order-failure classifications.** The only brakes are the two RESTRICT FKs in `009` and `017` — and **both of those tables are currently empty**, so they brake nothing today. This is VUDA G (§15.7).

### 4.2 Runtime read/write surface

| Path | Location | Behaviour relevant here |
|---|---|---|
| Taxonomy read API | `src/routes/iso-equipment.routes.js` → `src/models/iso-equipment.model.js` | `getFullHierarchy`, `search`, `getAllWithHierarchy`, `findByClass`, `findByCode` |
| `EquipmentType.findByClass(classId)` | model | `SELECT * FROM equipment_types WHERE class_id = ? ORDER BY type_name` — **no filter of any kind** |
| `EquipmentType.search(term)` | model | matches `type_name LIKE ? OR type_code LIKE ? OR description LIKE ?` — **the only terminology-discovery path** |
| `EquipmentType.getFullHierarchy(id)` | model | `SELECT t.* ... WHERE t.id = ?` — reads `t.type_name` for display |
| Cascading pickers | `src/routes/mobile.routes.js` `/templates/classes/:categoryId`, `/templates/types/:classId`, `/templates/type/:equipmentTypeId` | category → class → type selection |
| Industry applicability | `src/routes/industry.routes.js` `/:id/equipment-types` | |
| **Asset import** | `src/services/asset-import.service.js` | resolves an external `equipment_type_code` — see §4.3 |
| Coverage/admin | `src/controllers/coverage-validation.controller.js`, `admin-coverage-ui.controller.js` | reads **and writes** `equipment_type_family_mappings`, writes `equipment_mapping_change_log` |
| Findings/QR/scheduler | `finding.model.js`, `qr-label.service.js`, `scheduler.service.js` | read taxonomy for operational context |
| Views | 18 EJS views under `views/mobile/` | consume flattened taxonomy, including `iso_classification` |

### 4.3 A pre-existing defect that the design must not inherit

`src/services/asset-import.service.js`:

```js
async validateEquipmentType(typeCode) {
  const sql = `SELECT id, type_code, type_name FROM equipment_types
               WHERE LOWER(type_code) = LOWER(?)`;
  const [[type]] = await pool.query(sql, [typeCode.trim()]);   // FIRST ROW ONLY
  if (!type) throw new Error(`Equipment type '${typeCode}' not found in ISO 14224 taxonomy`);
  return type;
}
```

Two observations, both recorded rather than fixed:

1. **The lookup is unscoped and takes the first row.** `type_code` is unique only *within a class*, and `COMPACT` already exists in two classes. An external system sending a code that is ambiguous today is **silently assigned an arbitrary Type** — no `ORDER BY`, no ambiguity error. This is the exact failure mode VUDA A/E/M describe, already present.
2. The error string asserts *"ISO 14224 taxonomy"* — a live instance of `FALSE_PROVENANCE_REMEDIATION_REQUIRED`, surfacing to users. Out of scope here; recorded.

### 4.4 The legacy template-family construct — prior art, and slated for removal

`template_families`, `template_family_rules`, `equipment_type_family_mappings`, `equipment_type_family_proposals` exist in migration `003` and are **live** (read and written by the coverage controllers).

`equipment_type_family_proposals` is genuinely informative prior art — it already carries the governed-proposal shape: `proposal_source`, `proposal_reason`, `confidence_score`, `proposed_by`, `proposed_at`, `review_status`, `reviewed_by`, `reviewed_at`, `review_notes`, `applied_at`, with `UNIQUE (equipment_type_id, proposed_family_code)`. Note that its target is a **`family_code` string, deliberately not a FK**.

**But** `docs/architecture/ATM-001-Knowledge-Foundation.md` §15 rules this construct out:

> `equipment_type_family_proposals` — *"Ad-hoc customer proposal table"* → replaced by *"Governed knowledge contribution workflow"*.
> `template_families` / `template_family_rules` / `equipment_type_family_mappings` — *"Legacy family construct associated with the excluded SMP architecture"* → replaced by `task_template_equipment_types`.

and §17 lists the missing *"Contribution request entity — replacing `equipment_type_family_proposals`"*.

**Therefore the recommendation must not extend the family construct.** It is cited only as evidence that Atiman already accepts a governed-proposal shape for taxonomy-adjacent knowledge. Note also `equipment_type_family_mappings` targets a **template family**, not a Type identity, so it is not a Type-to-Type mechanism.

### 4.5 Provenance substrate available for reuse

`011_knowledge_provenance.sql` provides, and M5R.3B–E already depend on:

```sql
knowledge_sources          ( source_code, source_category CHECK IN (
                               'manufacturer_manual','engineering_standard','internal_standard',
                               'regulatory_source','legacy_migration','engineering_authored'),
                             default_title, issuing_organization,
                             is_active, organization_id,     -- NULL = global/system
                             UNIQUE NULLS NOT DISTINCT (organization_id, source_code) )

knowledge_source_versions  ( knowledge_source_id, version_designation, title, reference_number,
                             issuing_organization, publication_date, effective_date,
                             content_sha256, ... )
```

Two facts are decisive:

- Source categories **`legacy_migration`** and **`engineering_authored`** already exist — precisely the two provenance classes the M5R.4A rows need (the 282-row corpus is a legacy corpus; every disposition rests on Atiman engineering reasoning).
- `organization_id NULL` = global, non-NULL = tenant, with `UNIQUE NULLS NOT DISTINCT` — the isolation mechanism M5R.1 §6.2 / `ARCHITECTURE_GAP-2` requires already exists at the provenance layer.
- Migration `011` explicitly declares **"Polymorphic subject references"** out of scope. The repository's subject-modelling idiom is instead **typed nullable subject columns + an XOR CHECK** (`011`, `018`). Any recommendation must follow it.

`017` also requires `knowledge_source_version_id NOT NULL`: *"A source NAME is never sufficient: only a resolvable edition is auditable."*

---

## 5. Accepted M5R.4A representation requirements (E)

All figures below were **derived programmatically** from `docs/research/m5r4a/equipment-type-reconciliation.jsonl` and cross-checked against `scripts/bootstrap-knowledge/*.jsonl`. None was transcribed by hand.

**Verified artifact hashes at baseline:**

| Artifact | blob | sha256 | lines |
|---|---|---|---|
| `docs/architecture/ATM-001-M5R4A-Equipment-Type-Reconciliation.md` | `99971768ea448bd692b518d76f433881960d7a61` | `6c0a9a3155ed77c2408bea2ad6adb396a47566f34603d655b46013ea815e3987` | 865 |
| `docs/research/m5r4a/equipment-type-reconciliation.jsonl` | `471e083ab0918f6044c7d1894966077bdb182e43` | `d666ad4dba086106419c1c85c3518e64ed18988a2aff9ab83ba13da52b19c221` | 282 |

### 5.1 The candidates **are** the live taxonomy content

Keyed on `(category, class, type_name)`:

```
candidate keys            : 282
bootstrapped corpus keys  : 282
sets identical            : True
in candidates, not corpus : 0
in corpus, not candidates : 0
```

The corpus is exactly `65 categories / 311 classes / 282 types`. This is a **bijection**, so M5R.4A's dispositions are statements about the live canonical Type identities, not about a detached document. `candidate_id` corresponds to the corpus row's explicit `id`, which `scripts/bootstrap-knowledge/bootstrap.js` inserts verbatim (`columns: ['id','class_id','type_code','type_name',...]`, guarded by `assertTablesEmpty`, no `ON CONFLICT`). **M5R.4B2 must still resolve by identity at execution time and must never assume `candidate_id = equipment_types.id`.**

### 5.2 Disposition totals (verified)

```
KEEP_EXISTING 165 · RECLASSIFY 33 · ADD_TYPE 29 · NOT_EQUIPMENT_TYPE 29
MERGE_DUPLICATE 17 · TOO_BROAD_CONTAINER 4 · INSUFFICIENT_EVIDENCE 3
SYNONYM_OR_ALIAS 2 · CUSTOMER_SPECIFIC 0           = 282
```

### 5.3 The representation partition (**[R1] revised: 230 + 19 + 33 = 282**)

> **[R1] Superseded reading.** As first issued, this section read `227 + 19 + 36 = 282`, retiring the 3 `INSUFFICIENT_EVIDENCE` rows. OWNER RULING 1 rejects that: absence of evidence cannot become an affirmative retirement decision. The corrected partition is below, and the superseded row is retained for the audit trail.

| Bucket | Rows | Composition | What must be representable |
|---|---|---|---|
| **Remain canonical** | **230** | KEEP 165 + RECLASSIFY 33 + ADD 29 + **`INSUFFICIENT_EVIDENCE` 3** | 29 inserts; 198 in-place updates (replacement `class_id` and/or `type_name`); **3 rows whose governance is unresolved and which therefore stay `canonical` and selectable** |
| **Leave with a canonical target** | **19** | MERGE 17 + SYNONYM 2 | source Type stops being canonical; a canonical successor; why; who; when; from what source |
| **Retire without a Type successor** | **33** | NOT_EQUIPMENT_TYPE 29 + TOO_BROAD_CONTAINER 4 | source Type stops being canonical; **no** successor; why; who; when; from what source |
| ~~*Superseded: retire 36 incl. `INSUFFICIENT_EVIDENCE` 3*~~ | ~~36~~ | — | **rejected by RULING 1** |

230 + 19 + 33 = 282. The 3 unresolved rows generate a **pending governance record that changes no lifecycle state** (§21.7).


`M5R.4A §15` states the same partition: *"(1) add 29 … (2) reclassify 33 … (3) resolve 17 merges and 2 synonyms … (4) retire 36 rows from Type level without deleting their engineering vocabulary."*

### 5.4 Terminology preservation requirement — 46 existing identities are renamed

Rows where `canonical_name` differs from `candidate_name`:

| Disposition | Renames | Note |
|---|---|---|
| `ADD_TYPE` | 25 | new rows — no prior term exists |
| `KEEP_EXISTING` | **36** | **existing** identities renamed in place |
| `RECLASSIFY` | **10** | **existing** identities relocated **and** renamed |
| **Total** | **71** | **46 existing + 25 new** |

The 36 `KEEP_EXISTING` renames are exactly the vocabulary an operator or an external system will still use:

```
Multistage Pump → Multistage Centrifugal Pump      Vertical Turbine → Vertical Turbine Pump
Submersible Centrifugal → Submersible Centrifugal Pump
Hydraulic Diaphragm → Hydraulic Diaphragm Pump      Explosion Proof → Explosion-Proof Motor
Triple Offset → Triple Offset Butterfly Valve       Absolute Pressure → Absolute Pressure Transmitter
Differential Pressure → Differential Pressure Transmitter
RTD Sensor → RTD Temperature Sensor                 Infrared → Infrared Temperature Sensor
Oil Injected → Oil-Injected Screw Compressor        Oil Free → Oil-Free Screw Compressor
Rapid Gravity Filter → Rapid Gravity Sand Filter    Continuous Backwash → Continuous Backwash Sand Filter
Microfiltration → Microfiltration Unit              Ultrafiltration → Ultrafiltration Unit
Reverse Osmosis → Reverse Osmosis Unit              DTH Drill → Down-the-Hole Drill
Spherical Tank → Spherical Storage Tank             API Atmospheric Tank → Atmospheric Storage Tank
Enclosed Flare → Enclosed Ground Flare              TEG Dehydrator → Glycol Dehydration Unit
Molecular Sieve → Molecular Sieve Dehydration Unit  GIS Switchgear → Gas-Insulated Switchgear
ESP → Electrostatic Precipitator                    Chimney/Stack → Chimney
CSTR → Continuous Stirred Tank Reactor              Cartridge Collector → Cartridge Dust Collector
E-Coat System → Electrocoat System                  MIG Welder → MIG Welding Machine
TIG Welder → TIG Welding Machine                    Resistance Welder → Resistance Welding Machine
Labeling Machine → Labelling Machine                Diesel Generator → Diesel Generator Set
Dry Type Transformer → Dry-Type Transformer         Oil Filled Transformer → Oil-Filled Transformer
```

**This is the decisive sizing fact for the terminology layer.** The old term is *not* preserved by `type_code`, which M5R.4A leaves unchanged — but a human search for `ESP`, `CSTR`, `GIS Switchgear` or `TEG Dehydrator` returns **nothing** after a rename, because `EquipmentType.search()` matches `type_name` only. Combined with the 2 `SYNONYM_OR_ALIAS` rows and the 17 merged names, **the accepted package creates ~65 legacy terms that must remain resolvable** (46 renamed + 19 retired-into-a-target). A design that ignores this fails VUDA O (§15.15) on day one.

### 5.5 FINDING B1-1 — every placement targets a non-existent class (**[R1] reversed in substance**)

> **[R1] Read this with §21.3.** The measurements below are correct and were independently reproduced in R1. The **conclusion drawn from them at M5R.4B1 was wrong** in one decisive respect: it treated "the proposed `(category, class)` pair does not exist" as "no correct parent exists". R1 established that the live taxonomy already contains a semantically correct parent for **59 of the 62** rows. What does not exist is M5R.4A's *proposed pairing* — largely because those proposals were **duplicate restatements of categories and classes that already exist**. Only **1 new Category** and **5 new Classes** are genuinely required. The remaining text of this section is retained as the audit trail of the original finding.

`199` rows carry both a `proposed_category` and a `proposed_class`. Measured against the live `65` categories / `311` classes:

```
rows whose proposed_category exists live                    : 160 / 199
rows whose (proposed_category, proposed_class) exists live  : 137 / 199
distinct proposed (category, class) pairs                   : 163
distinct proposed pairs that DO NOT exist                   : 46
rows whose (category, class) pair DOES NOT exist            :  62
rows needing a category that DOES NOT exist                 :  39
```

**The 62 rows are exactly `ADD_TYPE` (29) + `RECLASSIFY` (33).** Every KEEP_EXISTING row's placement exists; **not one** of the 62 placement-bearing rows resolves.

**18 categories would have to be created** (none exists in the live 65 or in the 10-category legacy design artifact):

```
Compressors · Earthmoving · Fans · Fans and Blowers · Filtration · Gas Cleaning
Heat Recovery · Heat Rejection · Heat Transfer · Machine Tools · Materials Handling
Mining Equipment · Mixing · Pipeline Equipment · Plastics Processing · Screening
Separation · Surface Treatment
```

**44 class names would have to be created**, including `Isolation Valve`, `Non-Return Valve`, `Pressure Measurement`, `Flow Measurement`, `Level Measurement`, `Level Switches`, `Control Systems`, `Positive Displacement`, `Dynamic`, `Pigging`, `Shell and Tube`, `Plate`, `Air-Cooled`, `Double Pipe`, `Spiral`, `Feedwater Heating`, `Process Heaters`, `Cooling Towers`, `Fabric Filtration`, `Vacuum Filtration`, `Pressure Filtration`, `Dewatering`, `Bar Screens`, `Belt Conveyors`, `Screw Conveyors`, `Feeders`, `Loading Equipment`, `Earthmoving Equipment`, `Cutting Equipment`, `Mine Hoisting`, `Mine Ventilation Fans`, `Hoisting Equipment`, `Well Control Equipment`, `Grinding`, `Electrical Discharge`, `Blow Molding`, `Extrusion`, `Thermoforming`, `Cyclone Separation`, `Heat Recovery Steam Generators`, `Coating Booths`, `Mechanical Mixing`, `Switching Devices`, `Scrubbers`.

Several of the 18 would create **new parallel schemes of exactly the kind M5R.4A §9 defers**: `Material Handling` (live) vs `Materials Handling` (new); `Blower` (live) vs `Fans` and `Fans and Blowers` (new); `Filter` vs `Filtration`; `Separator` vs `Separation`; `Screen` vs `Screening`; `Mixer` vs `Mixing`; `Compressor`/`General Compressor` vs `Compressors`; `Heater`/`Heat Exchanger` vs `Heat Transfer`/`Heat Rejection`/`Heat Recovery`; `Instrumentation` and `Instrumentation and Control` both in use.

**~~Therefore M5R.4B2 cannot be a Type-only additive application.~~** **[R1] Superseded.** The correct conclusion is narrower and is given in §21.3: M5R.4B2 **can** be a Type-level additive application for **48 of the 62** rows without touching any parent, and needs **1 new Category and 5 new Classes** for the remainder. The 18 categories and 44 classes that M5R.4A proposed are **not** required and **must not** be created. **No consolidation, rename or creation of any category or class was performed by either M5R.4B1 or R1.**

### 5.6 FINDING B1-2 — an unresolved merge target (**[R1] CLOSED — see §21.5**)

```
id= 7  Submersible Sewage Pump  (class: Submersible Pump)  MERGE_DUPLICATE → Submersible Pump
id= 8  Submersible Drainage     (class: Submersible Pump)  MERGE_DUPLICATE → Submersible Pump
```

`Submersible Pump` is:
- **a Class name** (`equipment_classes.class_code = 'SUBM'` under category `Pump`),
- **not** the name of any of the 282 candidates,
- **not** any candidate's `canonical_name` (so it is neither `KEEP_EXISTING` nor `ADD_TYPE`).

The only accepted submersible-pump identity is `id=5` → `Submersible Centrifugal Pump` (`KEEP_EXISTING`, in class `Centrifugal Pump`). M5R.1 §2.1 and §2 forbid collapsing Class into Type, so the class name cannot silently be read as a Type.

**The package therefore merges two identities into a Type identity that it never establishes.** Applying the merge requires an OWNER ruling — at least: (a) author `Submersible Pump` as a new canonical Type, (b) re-target 7 and 8 to `Submersible Centrifugal Pump`, or (c) something else. **M5R.4A was not changed; it is reported (mission §14).**

### 5.7 FINDING B1-3 — a relationship expressed by name is not unambiguous (**[R1] CLOSED — see §21.6**)

```
id=56   Pressure Filter  code=PRESSURE     src: Filter / Sand Filter          MERGE_DUPLICATE → "Pressure Filter"
id=200  Pressure Filter  code=PRESS_FILT   src: Chemical Separation / Pressure Filter   KEEP_EXISTING
```

Candidate 56 merges into `Pressure Filter` — **its own name**. The substance is correct (§7C: *"Duplicate identity: the same pressure filter is also held under Chemical Separation"*), and the intended target is candidate 200. But expressed **as a name**, source and target are identical, so the edge is a self-loop.

This is not a defect to fix in M5R.4A; it is **proof of a hard architectural requirement**: a resolution edge must be identified by **row identity** (`equipment_types.id`), never by display text. Any design that stores a target as a string inherits this ambiguity, and `type_name` is not unique (verified) nor even `type_code` (verified: `COMPACT` × 2).

### 5.8 Cases not representable by any synonym relationship

For completeness — rows that a "synonym table" cannot express, with the reason:

| Case | Rows | Why a synonym relationship is wrong |
|---|---|---|
| `NOT_EQUIPMENT_TYPE` — **specification attribute** of another Type (enclosure protection, stem/disc arrangement, impeller geometry, shaft presence, form factor, cooling medium, pressure level) | 20 | the concept is a **property of a Type**, not a term for it. e.g. `ODP Motor`, `Weather Protected`, `Non-Rising Stem`, `Lift Check`, `Dual Plate`, `Nozzle Check`, `Propeller Mixer`, `Paddle Mixer`, `Shaftless Screw`, `Compact PLC`, `Compact Screw`, `Triple Pressure HRSG`, `Hydrogen-Cooled Generator`, `Packed Column`, `Tray Column` |
| `NOT_EQUIPMENT_TYPE` — **component / decomposition** | 5 | belongs to `Type → Subunit / Maintainable Item`, whose level count is **OPEN** (`M5R.1 §6.1`, `ARCHITECTURE_GAP-3`). e.g. `Fine Bubble Diffuser`, `Coarse Bubble`, `Perforated Plate`, `Brake Motor` |
| `NOT_EQUIPMENT_TYPE` — **linear asset / system**, not a maintainable equipment unit | 3 | `Subsea Pipeline`, `Flowline`, `Gathering Line` |
| `NOT_EQUIPMENT_TYPE` — **duty qualifier** or **process/system designation** | 1 | `SCR` |
| `TOO_BROAD_CONTAINER` — belongs at **Class** level | 4 | `Gas Compressor`, `Evaporator`, `Dust Collector`, `Packaging Machine`. A Class is not a Type. |
| `RECLASSIFY` | 33 | identity is unchanged; only its **location** changes. Not synonymy (VUDA K). |
| `INSUFFICIENT_EVIDENCE` | 3 | genuinely undecided — `Circulator Pump`, `Turbo Generator`, `Agitated Vessel` |
| `MERGE_DUPLICATE` where the merge is an **attribute collapse** rather than a naming variant | 14 | the source was a *narrower variant*; the engineering content is "this was never a distinct Type", which is a statement about **standing**, not vocabulary |

**Conclusion: only 2 rows (`SYNONYM_OR_ALIAS`) are pure synonymy, plus ~2–3 `MERGE_DUPLICATE` rows that are literal duplicates (`Pressure Filter`, `Rotary Screw Compressor`, `AC Motor`). The remaining 277 rows require other mechanisms.**

### 5.9 Provenance requirement

Every one of the 282 rows carries an **identical** `evidence` string stating that standards evidence does **not** exist, and `M5R.4A §10` records that the crosswalk tables are empty and the legacy `iso_*` columns were *"not consulted, converted or trusted"*. Restated plainly: **corpus evidence and Atiman engineering reasoning are the only bases**. So each decision's provenance must be expressible as `legacy_migration` (the corpus) plus `engineering_authored` (the reasoning) — both of which already exist in `knowledge_sources.source_category` (§4.5).

---

## 6. Semantic definitions (mission §7)

These concepts are **NOT** the same, and the architecture must not collapse them.

| Concept | Definition in Atiman | Requires | M5R.4A rows |
|---|---|---|---|
| **Alias** | An alternate **term** denoting the same engineering identity. Says nothing about standing. | vocabulary record | (part of `SYNONYM_OR_ALIAS`) |
| **Synonym** | Equivalent engineering **vocabulary** for the same canonical Type — a naming variant where the head noun is dropped or changed (`Ultrasonic` / `Ultrasonic Flow Meter`; `Orifice Meter` / `Orifice Plate Flow Meter`). | vocabulary record + source row retires | 2 |
| **Duplicate** | Two **candidate identities** that resolve to one canonical engineering identity. Says nothing about vocabulary: `Pressure Filter` twice, `Rotary Screw`=`Screw`, `AC Motor`=`AC Induction Motor`. | identity resolution + source row retires | ~3 (within MERGE 17) |
| **Superseded identity** | A previously accepted identity that must **no longer be used for new classification** but **must remain interpretable**. | standing change + resolution edge | 19 (with targets) |
| **Reclassified identity** | The engineering identity **remains valid and canonical**; it belongs at a **different taxonomy location**. **Not** supersession and **not** synonymy. No resolution edge is created. | in-place `class_id`/`type_name` update | 33 |
| **Retired non-Type concept** | Vocabulary that must not remain a canonical equipment Type, and **has no Type successor**. It may belong elsewhere (Class level, decomposition, a system notion) — but *where* is **not** asserted by this architecture. | standing change + resolution record **with no target** | 36 |
| **Attribute** (implicit in M5R.4A `P1`) | A distinction that changes what you buy, not what you do. Belongs to a Type's specification, or to decomposition — **not** to identity. | out of taxonomy scope | (inside NOT_EQUIPMENT_TYPE) |

**Why `Duplicate` ≠ `Synonym`:** a duplicate is a *collision of identity*; a synonym is a *collision of vocabulary*. Representing a duplicate as a synonym would lose the fact that two rows once claimed the same identity — which is precisely the provenance M5R.4A records and the invariant 017 protects.

**Why `Superseded` ≠ `Retired`:** a superseded identity **resolves to something**; a retired concept **resolves to nothing** and that absence is itself a governed conclusion. `017` established exactly this pattern for `NO_DIRECT_MAPPING`: *"a NO_DIRECT_MAPPING conclusion is positive engineering knowledge, and no fake classification is fabricated to hold its evidence."*

---

## 7. Architecture options (mission §6)

### 7.1 OPTION A — status + self-reference on `equipment_types`

```sql
equipment_types + identity_state VARCHAR(20)
                + superseded_by_type_id INTEGER FK -> equipment_types(id)
```

- **Represents:** canonical, superseded, historical. Weakly represents synonym (as a self-referencing kind).
- **Does not represent:** *why*, *who approved*, *when effective*, *from what source* — a bare FK cannot carry them. `M5R.4A §8` requires all four.
- **Cycles:** preventable, but needs a trigger (a `CHECK` cannot see other rows) — `009` already ships the algorithm.
- **Uniqueness:** one successor per row is free; **"at most one active claim per term" is not expressible** without a second structure.
- **Provenance:** would require ~8 governance columns *on the canonical identity table*, so every read of `equipment_types` returns mutable governance state, and the canonical table stops being canonical. `017` deliberately kept governance on the relationship row instead.
- **Query complexity:** lowest — one table, no join.
- **Verdict:** **REJECTED as a standalone design.** Insufficient for the knowledge-preservation test (§8), and it puts governance on the identity table.

### 7.2 OPTION B — separate terminology / alias table

```sql
equipment_type_terms ( term, canonical_equipment_type_id, relationship_kind, provenance )
```

- **Represents:** synonym, alias, alternate/preferred terminology, abbreviations, former names. Canonical Types stay clean. Handles N terms → 1 canonical, which a self-reference cannot.
- **Does not represent:** **supersession**, because a superseded Type row *still exists as a canonical Type* unless something changes its standing. **VUDA A fails:** a synonym can become a second canonical Type — and in Atiman it already can, because `type_name` has **no** uniqueness constraint at all (§2.5).
- **Verdict:** **REJECTED as a standalone design.** Necessary but not sufficient. It answers "what does this string denote", not "is this row still a canonical identity".

### 7.3 OPTION C — general taxonomy relationship table

```sql
equipment_type_relationships ( source_type_id, target_type_id, relationship_kind, governance )
```

- **Represents:** supersession, synonymy, merge, reclassification, and future kinds — uniformly. Mirrors `017`'s shape closely; the repository has proven the pattern.
- **Strengths:** full governance and provenance on the relationship row; partial uniqueness among active rows; RESTRICT discipline; competing proposals representable.
- **Weaknesses:** a "general" table invites unbounded `relationship_kind` growth; it cannot express a **term** that is not a Type row (so renames and future customer aliases have nowhere to go); and it cannot express the *absence* of a target without a nullable column plus a coherence CHECK.
- **Verdict:** **PARTIALLY ACCEPTED** — this is the right shape for identity resolution, and it becomes the recommended component 2.

### 7.4 OPTION D — combination: canonical identity + governed standing + governed terminology

```sql
equipment_types                        ( canonical identity — unchanged except one lifecycle column )
equipment_type_identity_resolution     ( standing changes; Type -> optional Type )
equipment_type_term                    ( vocabulary; term -> Type )
```

- **Represents every M5R.4A bucket** (§5.3), including retirement-without-successor and rename-without-standing-change.
- **Separates** canonical identity (what the Type *is*) from standing (whether it may still be used) from vocabulary (what it may be *called*) — three different questions, three different structures.
- **Cost:** one join on resolution; two new tables. Mitigated because *selection* reads only `equipment_types.identity_state` (no join), and only *resolution display* joins.
- **Verdict:** **RECOMMENDED** (§9).

### 7.5 OPTION D′ — single XOR-subject table instead of two

One table with `subject_type_id` XOR `subject_term`, mirroring `011`/`018`:

- **Smaller** by one table and shares one governance shape.
- **Rejected** because: two different cardinality rules would share one partial-unique design; `relationship_kind` would mix identity kinds and term kinds and need a long `kind ↔ subject` coherence CHECK; the two have different lookup intents (identity resolution vs. text discovery) and different future scopes (term table gains tenant scope, resolution table does not).
- Recorded because it is the closest competing minimal design and the OWNER may prefer it.

### 7.6 OPTION E — no schema change

Evaluated against every existing structure:

| Candidate host | Why it fails |
|---|---|
| `equipment_mapping_change_log` | Append-only **operational audit log**. No approval state, no FK to a target Type, `old_value`/`new_value` are `varchar(100)`, and it is used for **family/industry** mapping. Encoding a governed identity resolution as free text in a different concern's log fails governance, referential integrity and auditability. |
| `equipment_type_external_classification` (`017`) | Semantically about **external** classifications and requires `external_classification_id` (unless `NO_DIRECT_MAPPING`) **and** `knowledge_source_version_id NOT NULL`. Using it to record an **Atiman-internal** resolution would require **fabricating an external authority, edition and classification** — explicitly prohibited by M5R.1 §7.2: *"Atiman must never fabricate a standards mapping merely to satisfy a database constraint."* |
| `equipment_type_family_proposals` | Governed-proposal shape, but its target is `proposed_family_code` (a **template family**), it cannot express Type→Type, and the Knowledge Foundation §15 schedules it for **removal**. |
| `equipment_types.description` free text | Ungoverned, unqueryable, unattributable. Fails every part of §8. |
| Status quo (do nothing) | 19 rows cannot be retired without deletion; deletion cascades (§4.1). |

**OPTION E is NOT viable. A schema change is necessary.** See §16.

---

## 8. Comparative analysis (mission §12)

Scored against the required criteria. `✔` satisfies, `~` partial, `✘` fails.

| Criterion | A (self-ref) | B (terms only) | C (general rel.) | **D (recommended)** | E (no change) |
|---|---|---|---|---|---|
| Knowledge Before Transactions | ~ | ~ | ✔ | **✔** | ✘ |
| Knowledge preservation | ~ | ~ | ✔ | **✔** | ✘ |
| Canonical taxonomy integrity | ~ | ~ | ✔ | **✔** | ✘ |
| Provenance (why/who/when/source) | ✘ | ~ | ✔ | **✔** | ✘ |
| Human accountability | ✘ | ~ | ✔ | **✔** | ✘ |
| Historical truth | ✔ | ~ | ✔ | **✔** | ✘ |
| Query simplicity | **✔** | ✔ | ~ | **✔** | n/a |
| Migration safety (additive) | ✔ | ✔ | ✔ | **✔** | n/a |
| Future customer aliases | ✘ | ~ | ✘ | **~** (deferred by design) | ✘ |
| External integration | ~ | ~ | ✔ | **✔** | ✘ |
| Standards-crosswalk compatibility | ~ | ~ | ✔ | **✔** (disjoint; RESTRICT preserved) | ~ |
| AI safety | ✘ | ~ | ✔ | **✔** | ✘ |
| Maintainability | ✔ | ✔ | ~ | **✔** | n/a |
| Minimum architecture complexity | **✔** | ✔ | ~ | ~ | **✔** |

**D wins on correctness and loses only on complexity — and its complexity is bounded: one column, two tables, no new provenance machinery, no new vocabulary, no new role.** It reuses `009`'s cycle algorithm, `017`'s governance shape and CHECKs, `018`'s subject idiom, `011`'s source categories and `011`'s global/tenant scoping. Per the mission: *"Prefer the smallest architecture that satisfies the product semantics"* — A, B, C and E each fail a **required** semantic, so D is the smallest that satisfies them.

---

## 9. Preferred architecture (mission §13)

### 9.1 Summary

**Canonical identity + governed standing + governed terminology.** Apply the repository's own governed-relationship architecture to Atiman-internal Type identity.

```
equipment_types                       ← canonical identity; + ONE column
  id, class_id, type_code, type_name, description, typical_components,
  + identity_state  ('canonical' | 'superseded' | 'retired')  DEFAULT 'canonical'

equipment_type_identity_resolution    ← standing: a Type stops being a canonical Type
  from_type_id        NOT NULL  FK -> equipment_types(id) ON DELETE RESTRICT
  to_type_id          NULL      FK -> equipment_types(id) ON DELETE RESTRICT
  resolution_kind     NOT NULL  ('MERGED_DUPLICATE','SYNONYM_OF','SUPERSEDED_BY',
                                 'NOT_AN_EQUIPMENT_TYPE','TOO_BROAD_FOR_TYPE')
  + review_state, proposed_by/reviewed_by/approved_by + timestamps,
    ai_assisted + ai_assistance_detail, rationale,
    knowledge_source_version_id, effective_from, created_at/updated_at
  + coherence CHECK, approved-attribution CHECK, no-self CHECK
  + partial UNIQUE (from_type_id) WHERE active
  + cycle + target-canonicality trigger

equipment_type_term                   ← vocabulary: a term denotes a canonical Type
  term                NOT NULL
  canonical_type_id   NOT NULL  FK -> equipment_types(id) ON DELETE RESTRICT
  source_type_id      NULL      FK -> equipment_types(id) ON DELETE RESTRICT
  term_kind           NOT NULL  ('LEGACY_NAME','SYNONYM','ABBREVIATION','FORMER_NAME')
  + review_state, attribution, ai_assisted, rationale,
    knowledge_source_version_id, effective_from
  + partial UNIQUE (normalized term, canonical_type_id) WHERE active
```

### 9.2 Why each component exists — evidence, not symmetry

| Component | Justified by |
|---|---|
| `identity_state` | 19 + 36 = **55 rows must stop being selectable** while remaining interpretable. Selection reads (`findByClass`, mobile pickers, `getAllWithHierarchy`) query `equipment_types` directly with **no** filter today; a column keeps those paths correct with a one-predicate change instead of a join that can be forgotten in any of ~9 read paths (VUDA O). |
| `identity_resolution` | 55 rows need *why / who / when / source*. 36 of them have **no successor**, so the table must permit a NULL target with a coherence CHECK — exactly `017`'s `NO_DIRECT_MAPPING` precedent. |
| `equipment_type_term` | **46 existing identities are renamed** and 19 retire into a target; `EquipmentType.search()` matches `type_name` only, so `ESP`, `CSTR`, `GIS Switchgear`, `TEG Dehydrator` become unfindable. |
| Tenant scope **not** built | M5R.4A produced **0** `CUSTOMER_SPECIFIC` rows; M5R.1 §6.2 defers implementation; the mission forbids customer alias architecture. `011`'s `organization_id NULL = global` is already the mechanism when it is built. |

### 9.3 What it deliberately does NOT do

- No Equipment Family. No fourth identity level. No change to `Category → Class → Type`.
- No deletion, anywhere, ever, as a means of resolving identity.
- No new role or capability — governance reuses existing `KNOWLEDGE.*` capabilities.
- No AI approval path.
- No tenant column on global taxonomy knowledge.
- No category or class consolidation, creation or rename.
- No change to the crosswalk (`016`/`017`/`018`) — the new structures are **disjoint** from it and keep its RESTRICT discipline.
- No change to decomposition (M5R.1 §6.1 stays OPEN).

### 9.4 Rejected alternatives

| Rejected | Reason |
|---|---|
| **A** standalone | Cannot carry provenance; puts governance on the canonical identity table. |
| **B** standalone | Cannot express supersession; a synonym can become a second canonical Type (already possible today). |
| **C** standalone | Cannot express a term that is not a Type row → renames and future aliases homeless; invites unbounded kind growth. |
| **D′** one XOR-subject table | Two cardinality rules and two lookup intents in one structure; longer coherence CHECK. Recorded as the closest competitor. |
| **E** no schema change | Every candidate host fails governance, referential integrity, or the prohibition on fabricating standards mappings (§7.6). |
| **Reuse `equipment_type_family_proposals`** | Targets a template family, not a Type; scheduled for removal by the Knowledge Foundation §15. |
| **Reuse the crosswalk** | Requires fabricating an external authority/edition — prohibited by M5R.1 §7.2. |
| **Delete merged/retired rows** | Violates M5R.1 §10 step 5 (*"Additive application — no deletion"*) and cascades (VUDA G). |

---

## 10. Proposed data semantics (mission §10)

### 10.1 `equipment_types.identity_state`

| Value | Meaning | Offered for new classification? | Historical records resolve? | M5R.4A rows |
|---|---|---|---|---|
| `canonical` | The identity is Atiman-canonical and valid for new classification. | **Yes** | to itself | **230** (165 KEEP + 33 RECLASSIFY + 29 ADD + **3 `INSUFFICIENT_EVIDENCE`, unresolved but canonical**) **[R1]** |
| `superseded` | No longer valid for new classification; the engineering identity continues under another canonical Type. **Requires an active resolution whose target is `canonical`.** | **No** | follows the resolution edge | 19 |
| `retired` | Not an equipment Type at all. **No Type successor exists**, and that absence is a governed conclusion. | **No** | preserved as a row; resolves to nothing | **33** (29 `NOT_EQUIPMENT_TYPE` + 4 `TOO_BROAD_CONTAINER`) **[R1]** |

**[R1] `identity_state` carries lifecycle only — three values remain semantically sufficient.** Unresolved governance is deliberately **not** a fourth value and **not** a column: RULING 1 forbids treating insufficient evidence as retirement, and RULING 2 separates ratification from lifecycle. The 3 unresolved rows therefore stay `canonical`, remain selectable, and carry a **pending** governance record instead. See §21.7.

Invariants: `DEFAULT 'canonical'`; `NOT NULL`; `CHECK (identity_state IN (...))`. All 282 existing rows become `canonical` on migration (additive, safe). Transitioning away from `canonical` happens **only** by approving a resolution row (§12.3).

### 10.2 `equipment_type_identity_resolution.resolution_kind`

| Kind | Target required? | M5R.4A source | Semantics |
|---|---|---|---|
| `MERGED_DUPLICATE` | **Yes** | `MERGE_DUPLICATE` 17 | the source was not a distinct identity; two rows once claimed one identity |
| `SYNONYM_OF` | **Yes** | `SYNONYM_OR_ALIAS` 2 | pure naming variant; the source's term remains valid vocabulary |
| `SUPERSEDED_BY` | **Yes** | reserved | future: an identity formally replaced by a newer identity (not currently produced by M5R.4A) |
| `NOT_AN_EQUIPMENT_TYPE` | **No** | `NOT_EQUIPMENT_TYPE` 29 | the concept is an attribute, component, linear asset, duty qualifier or process designation — **not** a Type. Where it *does* belong is recorded in the rationale, not asserted here. |
| `TOO_BROAD_FOR_TYPE` | **No** | `TOO_BROAD_CONTAINER` 4 | the concept is a container appropriate to Class level |
| `INSUFFICIENT_EVIDENCE` | **No** | `INSUFFICIENT_EVIDENCE` 3 | *only if* §19 Q2 is ruled the way M5R.4A §15 reads; otherwise unused |

Coherence CHECK (the `017` `NO_DIRECT_MAPPING` precedent):

```
(to_type_id IS NOT NULL AND resolution_kind IN
     ('MERGED_DUPLICATE','SYNONYM_OF','SUPERSEDED_BY'))
OR
(to_type_id IS NULL AND resolution_kind IN
     ('NOT_AN_EQUIPMENT_TYPE','TOO_BROAD_FOR_TYPE','INSUFFICIENT_EVIDENCE'))
```

### 10.3 `equipment_type_term.term_kind`

| Kind | M5R.4A source | Example |
|---|---|---|
| `LEGACY_NAME` | the 46 renamed identities | `ESP` → `Electrostatic Precipitator` |
| `SYNONYM` | `SYNONYM_OR_ALIAS` 2 (+ the 17 merged names if the OWNER elects) | `Ultrasonic` → `Ultrasonic Flow Meter` |
| `ABBREVIATION` | subset of the above | `CSTR`, `GIS`, `RTD`, `TEG` |
| `FORMER_NAME` | a name that a *later* governed rename replaced | reserved |
| *(reserved)* `CUSTOMER_ALIAS` | **not built** — tenant-scoped, deferred (M5R.1 §6.2) | |

Global scope only. The term table must store **both** the as-written term and a normalized form (case-folded, whitespace-collapsed) — normalization is for *matching*, never for storage.

### 10.4 Governance columns (shape reused from `017`)

```
review_state   IN ('draft','under_review','approved','rejected')   -- 017's vocabulary
proposed_by_user_id, reviewed_by_user_id, reviewed_at,
approved_by_user_id, approved_at
ai_assisted BOOLEAN NOT NULL DEFAULT FALSE, ai_assistance_detail JSONB
rationale TEXT                       -- mandatory for approval
knowledge_source_version_id          -- FK -> knowledge_source_versions(id) ON DELETE RESTRICT
effective_from TIMESTAMPTZ NULL      -- when the resolution took effect
created_at, updated_at
```

Plus, borrowed verbatim in intent from `017`:

```sql
-- an unattributed governed row is unrepresentable
CHECK (review_state <> 'approved' OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL
       AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL))
-- partial uniqueness only among ACTIVE rows; history and competing proposals coexist
CREATE UNIQUE INDEX ... ON equipment_type_identity_resolution (from_type_id)
  WHERE review_state = 'approved' AND superseded_by_resolution_id IS NULL;
CREATE UNIQUE INDEX ... ON equipment_type_term (normalized_term, canonical_type_id)
  WHERE review_state = 'approved' AND superseded_by_term_id IS NULL;
```

### 10.5 What must NOT be added

- No `is_active` — the Knowledge Foundation §15 rules it insufficient.
- No free-form `context JSONB` on applicability (`017` explicitly refused this).
- No polymorphic `subject_type` / `subject_id` pair (migration `011` refused polymorphism).
- No global `UNIQUE` on `type_name` or on `type_code` — **it cannot be added safely**, and `Pressure Filter` / `COMPACT` prove the existing data already violates it. Duplicate detection belongs in the governance process, not in a constraint that would fail to deploy.
- No `organization_id` on either new table in this phase.

---

## 11. Invariants (mission §11)

Schema-enforceable invariants (a `CHECK` where possible, a trigger or partial index where a cross-row view is required — the repository already does both):

| # | Invariant | Enforcement |
|---|---|---|
| **I1** | A Type may not resolve to itself. | `CHECK (from_type_id <> to_type_id)` — `017` precedent |
| **I2** | A resolution with a target must target a **`canonical`** Type. | trigger — mirrors `009`'s *"successor must currently be `published`"* |
| **I3** | Resolution chains are **forbidden**: because I2 holds, resolution depth is exactly **1** and never recursive. | consequence of I2 |
| **I4** | A → B while B → A is unrepresentable. | `009`-style `visited[]` chain walk trigger |
| **I5** | A Type has at most **one active** resolution. | partial unique index on `(from_type_id)` |
| **I6** | A Type with an **approved** resolution to a target is `superseded`; a Type with an **approved** resolution without a target is `retired`; no disagreement is representable. **[R1] A `draft` or `under_review` proposal record changes NO lifecycle state** — that is how the 3 unresolved rows remain `canonical` and selectable while their governance is pending. | trigger coerces `identity_state`, `009` precedent (*"Coerce lifecycle when a successor is assigned"*); coercion fires only on approval |
| **I7** | A `canonical` Type has **no** active resolution. | converse of I6, enforced by the same trigger |
| **I8** | An approved resolution carries complete human attribution. | `CHECK` — `017` precedent |
| **I9** | AI cannot satisfy the approver requirement. | `approved_by_user_id` FKs to `users(id)`; AI is not a user; the I8 `CHECK` therefore makes an AI approval unrepresentable |
| **I10** | A resolution or term cannot be deleted while it is `approved` and active. | `RESTRICT` FKs + delete-guard trigger (`017` precedent: *"permits deleting only DRAFT crosswalks"*) |
| **I11** | Governed resolution history cannot vanish through a cascading taxonomy delete. | `ON DELETE RESTRICT` on `from_type_id`, `to_type_id`, `canonical_type_id`, `source_type_id` |
| **I12** | Only `canonical` Types are offered for new classification; **all** Types remain resolvable historically. | application rule + a `canonical`-only partial index for the picker query |
| **I13** | An `approved` resolution or term must cite a resolvable source **edition**, or explicitly declare `engineering_authored` provenance. | `knowledge_source_version_id` + FK RESTRICT; `017`: *"A source NAME is never sufficient"* |
| **I14** | External classification remains external. | disjoint tables; no FK path from `equipment_types` identity to `external_classification` |
| **I15** | Customer terminology cannot enter global taxonomy knowledge. | both new tables are global-only; tenant scope deferred; `018`'s global-scope trigger is the precedent for when it is built |

Application-level invariants that the schema cannot express:

| # | Invariant |
|---|---|
| **I16** | **Discovery queries include `superseded` and `retired` rows and return the resolution; selection queries offer `canonical` only.** Two read intents, two queries. |
| **I17** | A relationship endpoint is identified by `equipment_types.id`, **never** by `type_name` (proved necessary by B1-3) and never by `type_code` alone (`COMPACT` is duplicated). |
| **I18** | Ambiguity is **surfaced**, never guessed. (`asset-import.service.js` currently violates this — §4.3.) |
| **I19** | Renaming a Type requires a `LEGACY_NAME`/`ABBREVIATION` term for the previous name in the same governed act. |

---

## 12. Provenance and governance model (mission §12)

### 12.1 Provenance

Reuse `011` unchanged. Every resolution and every term cites `knowledge_source_version_id`, whose `knowledge_sources.source_category` already carries the exact classes mission §8 asks for:

| Mission §8.6 origin | `knowledge_sources.source_category` |
|---|---|
| Atiman engineering judgment | `engineering_authored` |
| legacy migration | `legacy_migration` |
| external-standard evidence | `engineering_standard` |
| another governed source | `internal_standard` / `regulatory_source` / `manufacturer_manual` |
| customer terminology | **not representable globally by design** — tenant scope deferred |

For the M5R.4A application, provenance is `legacy_migration` (the 282-row corpus) + `engineering_authored` (the reasoning), with the accepted decision package's hash recorded as the citation. **No standards evidence is claimed and none may be inferred.** The crosswalk remains empty and `FALSE_PROVENANCE_REMEDIATION_REQUIRED` stands.

### 12.2 Human accountability

Reuse existing capabilities only (`src/config/permissions.js`):

| Act | Required capability (existing) |
|---|---|
| Propose a resolution or term | `KNOWLEDGE.REVIEW` |
| Review | `KNOWLEDGE.REVIEW` |
| **Approve** (transitions `identity_state`) | `KNOWLEDGE.APPROVE` |
| Safety-review a `NOT_AN_EQUIPMENT_TYPE` conclusion | `KNOWLEDGE.SAFETY_REVIEW` where safety controls are implicated |
| Read all taxonomy and history | `KNOWLEDGE.VIEW` |

No new role, no new capability, no change to `permissions.js`.

### 12.3 State transition (the only path that changes standing)

```
            approve(resolution)                     approve(resolution)
canonical ──────────────────────► superseded   canonical ──────────────────► retired
                                   (target set)                              (no target)

No direct canonical -> superseded/retired write. No "un-canonical" state without a governed row.
```

Executing a M5R.4A outcome therefore always produces **one governed artefact** — which is what makes mission §8.3–8.6 answerable uniformly for all 55 standing-changing rows, including the 36 that have no successor.

---

## 13. External integration behaviour (mission §9)

Atiman complements SAP PM, Maximo, Infor EAM and Oracle EAM. Consider an integration sending each of the five payload kinds, against a Type that M5R.4A renames or merges:

| Payload | Resolution | Canonical identity changed? |
|---|---|---|
| **Canonical Atiman terminology** (`Electrostatic Precipitator`) | direct hit on `equipment_types.type_name` / `.id` | no |
| **An old Atiman term** (`ESP`) | hits an `equipment_type_term` row → canonical Type | **no** — the external system does not become canonical |
| **A customer-specific alias** | **not resolvable globally today**; there is no tenant alias layer (M5R.1 §6.2). The integration must be told so explicitly rather than silently mapped. | **no** |
| **An EAM equipment classification** (SAP/Maximo class code) | belongs in `external_classification` + the `017` crosswalk — a **separate** governed path requiring an authority and an edition. It must **never** create a Type or a term. | **no** |
| **An external-standard classification** (ISO/IEC/API class) | same as above; `017`'s `NO_DIRECT_MAPPING` remains a legitimate answer | **no** |

Requirements this imposes:

1. **An external system cannot create canonical identity.** Resolution is inbound-only: it may *find* a canonical Type, never *define* one. `ADD_TYPE` is a human-governed act.
2. **`type_code` remains the stable external key** — M5R.4A renames `type_name` only, so existing code-based integrations keep working. This is a mitigating factor and should be stated to integrators.
3. **`asset-import.service.js` must be fixed before retired Types exist.** It today selects the first row of an unscoped `LOWER(type_code)` match and destructures `[[type]]` (§4.3). Once retired Types exist, it can silently bind an asset to a retired Type, and it already silently picks arbitrarily between `COMPACT` occurrences. Fixing it is an application change and is **out of scope here**; it is a **precondition for M5R.4B2** and is recorded in §17.3.
4. **Ambiguity must be an error, not a coin flip** (I18).
5. **Ingested terminology is never canonical.** A customer term arriving from SAP is at most a tenant-scoped term — a structure that does not yet exist and whose absence must be surfaced honestly rather than absorbed into global vocabulary.

---

## 14. AI boundaries (mission §10)

**Principle: AI may recommend; AI may never approve.**

| Act | AI may | Structural enforcement |
|---|---|---|
| Search existing taxonomy and resolutions | **Yes** | read-only |
| Suggest "this incoming term most likely denotes Type X" | **Yes** — as a `draft` proposal with `ai_assisted = TRUE` | `ai_assisted` + `ai_assistance_detail` columns, `017` precedent |
| Draft a `MERGED_DUPLICATE` / `SYNONYM_OF` / `NOT_AN_EQUIPMENT_TYPE` proposal | **Yes** — draft only | `review_state = 'draft'`; no AI write path to `approved` |
| **Approve** a resolution or term | **NO** | `approved_by_user_id` FK → `users(id)`, plus the I8 `CHECK` requiring it non-NULL for `approved`; an AI principal cannot satisfy it |
| **Transition `identity_state`** | **NO** | only the approval trigger transitions state (I6) |
| Create a canonical Type | **NO** | `ADD_TYPE` is human-governed |
| Populate standards evidence | **NO** | `017`/`018`; and `018` states *"No AI behaviour of any kind"* |

`ai_assisted` **must never** be readable as "AI-approved". `017` already states the rule for its own table — *"AI may never populate `approved_by_user_id` (enforced by the attribution CHECK)"* — and the new tables must reproduce it rather than invent new language.

Additionally, and independent of schema: **AI must not be the *only* evidence for a taxonomy decision.** M5R.4A's own basis is Atiman engineering reasoning with a named governing test (§3.1) and a challenge ledger (§3.2). An AI recommendation is a proposal requiring the same human engineering justification.

---

## 15. VUDA results (mission §11)

Each attack was run against the **recommended** design; where the attack succeeds *today* or survives the design, that is stated plainly.

### 15.1 A — Can a synonym accidentally become a second canonical Type?

**Today: YES.** `type_name` has no uniqueness constraint at all, and `Pressure Filter` already exists twice. **Under the design: NO for a *governed* synonym** — `SYNONYM_OF` sets the source row to `superseded`, so it is never offered for new classification, and `identity_state` is coerced by the approval trigger rather than left to the author.

**Residual (accepted):** nothing prevents a future human from inserting a *new* Type whose name duplicates an existing one, and adding a global uniqueness constraint is **not safe** — the live corpus already violates it (`Pressure Filter`, `COMPACT`). *Mitigation:* duplicate-name detection as a **governance check** in the authoring workflow, using a non-unique index on the normalized name; **not** a uniqueness constraint. Recorded, not implemented.

### 15.2 B — Can a canonical Type point to itself?

**Blocked.** `CHECK (from_type_id <> to_type_id)`, exactly as `017` ships `chk_..._no_self_supersession`. **This attack currently exists as a real ambiguity in M5R.4A row 56** (B1-3) — the design prevents it structurally; the *expression* of that row still needs an OWNER ruling on its identity target.

### 15.3 C — Can A supersede B while B supersede A?

**Blocked.** A trigger walking the successor chain with a `visited[]` array, copied in intent from `009`'s `valid_pack_version_supersession_check`. A `CHECK` cannot do this because it cannot see other rows — which is precisely why `009` uses a trigger, and why the same trigger is required here.

### 15.4 D — Can a relationship chain become ambiguous?

**Blocked, by construction.** Invariant I2 (target must be `canonical`) plus I5 (at most one active outgoing edge per Type) means resolution depth is exactly **1**. Chains are therefore neither ambiguous nor recursive. **Deliberate cost:** a superseded row that points at another superseded row is **unrepresentable**; the newest canonical target must be named directly. This is a trade the design makes on purpose, mirroring `009`'s *"successor must currently be `published`"*.

### 15.5 E — Can two active canonical identities claim the same governed synonym?

**Today: YES** — and it is not hypothetical: `asset-import.service.js` resolves `LOWER(type_code)` unscoped and takes the first row, and `COMPACT` already matches two Types.

**Under the design:** the partial unique index on `(normalized_term, canonical_type_id)` prevents the *same* pair twice, but does **not** prevent two *different* canonical Types from each claiming the same term — because `type_name` itself is already non-unique. **Residual: REAL.** *Mitigation:* resolution must return **ambiguity** rather than a guess (I18), and the governing rule is that **identity is resolved, text is only a hint**. A hard uniqueness constraint on terms is deferred because it cannot be deployed against the existing corpus without first resolving `Pressure Filter`/`COMPACT`.

### 15.6 F — Can historical records be silently rewritten?

**Assets are safe:** `equipment` references `equipment_type_id` by id, so a rename or reclassification does not orphan an asset. **But the historical *label* is not preserved by a rename.** After `ESP → Electrostatic Precipitator`, a 2024 work order that rendered "ESP" would now render the new name, and the fact that it was called "ESP" at the time is lost from the operational record.

**Mitigation:** `equipment_type_term` records the prior term (`LEGACY_NAME`/`ABBREVIATION`) as governed knowledge with provenance and effectivity, so the old vocabulary remains resolvable and the rename itself is auditable. **Residual:** the *rendered* value on a historical report still changes unless the reporting layer is made effectivity-aware. That is a reporting concern, **out of scope**, and is recorded in §18.

**The design forbids the one thing that would be an actual silent rewrite:** it never UPDATEs a governed resolution row's conclusion, and never resolves identity by mutating an existing edge (`017`: *"Supersession is a NEW row plus this back-link. Never an in-place rewrite."*).

### 15.7 G — Can deletion destroy knowledge provenance?

**Today: YES, catastrophically — and this is the most serious pre-existing finding in this record.** From §4.1: deleting one **Category** cascades to its **Classes**, then to its **Types**, then CASCADE-destroys `equipment_type_industries`, `subunits`, `equipment_subunits`, `failure_modes`, `task_templates`, `equipment_type_family_mappings` and `equipment_type_family_proposals`, while **SET NULL**-ing `equipment.equipment_type_id` (asset classification) and `work_order_failures.equipment_type_id` (historical failure classification). The only brakes — `RESTRICT` on `task_template_versions` and on the crosswalk — protect **nothing today**, because both tables are empty.

**Under the design:** the new tables use `ON DELETE RESTRICT` throughout (I11), so a Type carrying governed standing or terminology **cannot be deleted**. "Resolve by deletion" becomes structurally impossible for every identity M5R.4A touched.

**Residual: REAL and NOT fixed here.** The taxonomy parent FKs (`class_id → CASCADE`, `category_id → CASCADE`) remain unguarded, so a Category or Class delete is still destructive for Types that have no resolution row and for all their dependent knowledge. **Recommendation:** a bounded hardening — either `RESTRICT`/delete-guard triggers on the taxonomy parents, or a `017`-style delete guard permitting deletion only of unreferenced, non-`canonical`-history rows. Recorded in §18; **not implemented** (schema change is prohibited by this mission).

### 15.8 H — Can customer terminology pollute canonical Atiman identity?

**Today:** there is no tenant alias layer, so customer terminology has **no** non-contaminating home — `ARCHITECTURE_GAP-2`, an explicitly **unsatisfied mandatory requirement** (M5R.1 §6.2/§12). The practical risk is that it gets absorbed into the global taxonomy as a Type.

**Under the design:** both new tables are **global-scope only**; there is no tenant column, so a customer term has nowhere to go *by construction* and cannot be mistaken for global vocabulary. Building the tenant layer is **deferred by design**. M5R.4A produced **0** `CUSTOMER_SPECIFIC` rows, so nothing in the accepted package requires it. `018`'s global-scope trigger (which refuses evidence citing a tenant-scoped `knowledge_source`) is the template for when it is built.

**Residual:** the requirement remains unsatisfied until the §6.2 decision. The design does not pretend otherwise.

### 15.9 I — Can external-standard terminology become canonical accidentally?

**No.** External classifications live in `external_classification` (`016`) reached only through the `017` crosswalk, which is a **different** table with a `knowledge_source_version_id NOT NULL` requirement. The new structures have **no FK path** to `external_classification`, and the target of a resolution/term must be an `equipment_types` row (enforced by FK). The only route from external vocabulary into canonical identity is a human-approved `ADD_TYPE` with `engineering_authored` provenance — which is correct, because Atiman owns its taxonomy (M5R.1 §1).

### 15.10 J — Can AI approve a taxonomy relationship?

**No — structurally.** `approved_by_user_id` is an FK to `users(id)` with a `CHECK` requiring it non-NULL for `review_state = 'approved'`. AI is not a user, so an AI approval is **unrepresentable**, not merely disallowed by policy. Only the approval trigger transitions `identity_state` (I6), so there is no side channel. This reproduces `017`'s stated enforcement rather than inventing new language (§14).

### 15.11 K — Can reclassification be confused with synonymy?

**No — they are structurally different acts.** `RECLASSIFY` (33 rows) creates **no resolution row at all**: the identity stays `canonical`, and only `class_id` (and possibly `type_name`) changes. Synonymy creates a resolution row and moves the source to `superseded`. Because one is an in-place update and the other is a governed edge, confusing them is not a representable state.

**And M5R.4A itself confirms they are different:** §7B renames 10 of the 33 reclassified rows while keeping their identity, which is by definition not supersession.

### 15.12 L — Can a non-Type concept be incorrectly redirected to an equipment Type?

**Blocked at the schema for the retirement kinds.** The coherence CHECK permits a target **only** for `MERGED_DUPLICATE` / `SYNONYM_OF` / `SUPERSEDED_BY`; `NOT_AN_EQUIPMENT_TYPE`, `TOO_BROAD_FOR_TYPE` and `INSUFFICIENT_EVIDENCE` **must** have `to_type_id IS NULL`. So "this is not a Type" cannot be silently given a Type successor, and no fake successor is fabricated — the `017` `NO_DIRECT_MAPPING` precedent.

**Residual:** a human approver can choose the *wrong kind* and thereby assert a successor that engineering would reject. That is a judgement risk governed by the review workflow and mandatory rationale, **not** a schema defect. The design chooses not to over-constrain it.

### 15.13 M — Can aliases become globally ambiguous where the same term legitimately means different things?

**Today: YES, and it is already material.** `Pressure Filter` denotes two different rows; `COMPACT` denotes two; terms like `Filter`, `Screen`, `Mixer`, `Separator` are legitimately overloaded. Nothing in the schema scopes a term.

**Under the design:** a term row is scoped by its canonical target and by `source_type_id`, so a term is never a bare global string; and I18 requires ambiguity to be **surfaced** rather than resolved by picking a row (contrast the current `asset-import` behaviour).

**Residual: REAL.** Two different canonical Types could legitimately need the same term in different engineering contexts, and the design does not model context beyond the canonical target. **Forward requirement (deferred):** term resolution must accept a context (class/category or industry applicability) and must return ambiguity when context does not disambiguate. Recorded in §18; **not** built now, because M5R.4A produced no case requiring it.

### 15.14 N — Can relationship resolution become unbounded or recursive?

**No.** By I2 + I5, resolution depth is exactly 1 — a single join, never a recursive walk, regardless of history length. This also bounds query cost and makes the resolution deterministic. The deliberate cost (no chains) is stated in §15.4.

### 15.15 O — Can application queries accidentally hide historically valid terminology?

**Today: YES.** `EquipmentType.search()` matches `type_name`, `type_code` and `description` only. Every one of the 46 renamed identities becomes unfindable by its former name the moment the rename lands, and the 19 merged/synonym names likewise. This is the failure mode the design must not amplify.

**Under the design:** the risk is **explicit, not incidental**, and is handled by invariant I16: **discovery and selection are two different read intents and must be two different queries.**

| Intent | Query | Includes retired/superseded? | Returns resolution? |
|---|---|---|---|
| **Discover** ("what did they mean by ESP?") | search across canonical **and** retired/superseded Types **and** terms | **Yes** | **Yes** — `ESP → Electrostatic Precipitator` |
| **Select** ("pick a Type for this asset") | filter `identity_state = 'canonical'` | **No** | n/a |

The reason `identity_state` is a **column on `equipment_types`** rather than a derived join is exactly this: the ~9 selection read paths (§4.2) must each add **one predicate** they can be grepped for, instead of each needing a join that can be silently omitted. A missing join hides revoked identities (offering a retired Type for new classification); a missing predicate is at least visible in review, and can be backed by a `canonical`-only partial index.

**Residual: REAL.** Any read path that is not updated will behave as it does today. The design reduces the failure from *silent and untyped* to *explicit and reviewable*; it does not eliminate the need to update every path — which is application work belonging to M5R.4B2, not to this discovery.

---

## 16. Migration necessity assessment (mission §13, §16)

### 16.1 Is a schema change necessary?

**YES.** Option E is not viable (§7.6): no existing structure can carry a governed, attributed, provenance-bearing Type-to-Type resolution without fabricating external-standard evidence (prohibited by M5R.1 §7.2), abusing an operational audit log, or extending a construct the Knowledge Foundation §15 schedules for removal.

### 16.2 Would migration 019 eventually be required?

**YES.** The repository's schema is forward-only, numbered, idempotent, and migration-managed; there is no other sanctioned schema path. Any of the three recommended structures therefore requires a numbered migration, which will be **019** (currently absent).

### 16.3 Exact bounded responsibility of migration 019, if authorised

If and only if the OWNER approves §9, migration 019 should be **strictly additive and strictly limited to**:

1. `ALTER TABLE equipment_types ADD COLUMN identity_state VARCHAR(20) NOT NULL DEFAULT 'canonical'` + its `CHECK` (`canonical`/`superseded`/`retired`).
2. `CREATE TABLE equipment_type_identity_resolution` — columns, coherence CHECK, approved-attribution CHECK, no-self CHECK, `RESTRICT` FKs, partial unique index on `(from_type_id)` among active rows.
3. `CREATE TABLE equipment_type_term` — columns, governance CHECKs, `RESTRICT` FKs, partial unique index on `(normalized_term, canonical_type_id)` among active rows.
4. The standing-coherence trigger (I6/I7) and the chain/cycle + target-canonicality trigger (I2/I4) for the resolution table, following `009`'s algorithm and `017`'s naming discipline.
5. Delete-guard triggers for both new tables, following `017`.
6. Identifier audit: **every** object name must be verified ≤ 63 bytes, because PostgreSQL truncates silently — the defect that bit M5R.3C and forced deliberate short names in `017`/`018`.
7. Idempotency (`CREATE ... IF NOT EXISTS` / `DROP ... IF EXISTS`) because the runner **re-applies every file on every run** and keeps no applied-migrations ledger.

Migration 019 must **not**: create, rename, merge or delete any category or class; populate any row; touch migrations 001–018; import the legacy design artifact; alter the crosswalk; add a tenant scope; add an AI path; or change any runtime file.

### 16.4 What migration 019 must not be confused with

Migration 019 provides the **mechanism**. It does **not** apply M5R.4A. Applying the accepted decisions is **M5R.4B2** and requires its own authorisation. And **M5R.4B2 cannot proceed at all until B1-1 is resolved** (§5.5), because 62 accepted placements have no target class.

---

## 17. Proposed M5R.4B2 boundary (mission §17)

### 17.1 In scope for M5R.4B2 (only after the §21.11 ratifications are given and 019 is authorised and applied) **[R1]**

1. **230 canonical outcomes** — 30 `ADD_TYPE` inserts (**29 + `Submersible Pump`, §21.5**); 198 in-place updates (`class_id` and/or `type_name` for the 33 `RECLASSIFY` and the 36 renamed `KEEP_EXISTING` rows); the 3 unresolved rows are left `canonical` and untouched.
2. **Parent structure** — create exactly **1 Category** (`Mining Equipment`) and **5 Classes** per the ratified §21.3 table. **No other category or class may be created, renamed or consolidated.**
3. **52 standing changes** — one governed `equipment_type_identity_resolution` row each: 19 with a canonical target (`MERGED_DUPLICATE` 17, `SYNONYM_OF` 2), 33 without (`NOT_AN_EQUIPMENT_TYPE` 29, `TOO_BROAD_FOR_TYPE` 4).
4. **3 pending governance records** — for `INSUFFICIENT_EVIDENCE` (ids 6, 158, 190), carrying **no** lifecycle effect.
5. **Terminology** — **65** terms: 46 `LEGACY_NAME` (renamed existing identities), 2 `SYNONYM`, 17 `MERGED_IDENTITY_TERM` (RULING 3). `ABBREVIATION` is not a kind (§21.8).
6. **Provenance** — one `knowledge_sources` + `knowledge_source_versions` pair citing the accepted decision package (`legacy_migration` + `engineering_authored`), referenced by every resolution and term.
7. **Read-path correctness** — the I16 discovery/selection split, and the `asset-import.service.js` ambiguity fix (§13.3), which is a **precondition**, not an optional extra.
8. **The 9 decomposition referrals** recorded as referrals only (M5R.4A §11) — no decomposition architecture.

### 17.2 Explicitly NOT in M5R.4B2

Any category or class creation beyond the ratified 1 + 5 · category or class **renaming or consolidation** · the 166 same-name class/type pairs · the 65-category dual scheme · Equipment Family · decomposition architecture (M5R.1 §6.1) · customer/tenant alias layer (§6.2) · crosswalk or evidence population · standards content · false-provenance remediation · `YEAR(created_at)` defect · M6 · ATM-002 · UI · taxonomy delete-guard hardening (§18).

### 17.3 Preconditions for M5R.4B2 — status after R1

| # | Precondition | Status after R1 |
|---|---|---|
| P1 | **Ratify the parent-placement table** (62 rows; 1 new Category, 5 new Classes; 35 rows overriding an M5R.4A proposed parent name) | **RESOLVED IN PRINCIPLE — awaiting OWNER ratification** (§21.3, §21.11) |
| P2 | **Ratify `Submersible Pump`** as an added canonical Type for rows 7 and 8 (29 → 30 added Types) | **RECOMMENDED — awaiting ratification** (§21.5) |
| P3 | **Ratify candidate 56's endpoint as candidate 200 by identity** | **RESOLVED — no OWNER decision required** (§21.6) |
| P4 | **Ratify the 3 `INSUFFICIENT_EVIDENCE` rows as unresolved, not retired** | **RULED by the OWNER (RULING 1)**; representation determined in §21.7 |
| P5 | Migration 019 authored, reviewed, approved, applied | **NOT STARTED** |
| P6 | `asset-import.service.js` ambiguity fixed (application change) | **NOT STARTED** |
| P7 | OWNER decision: are the 282 "ratified"? (M5R.4A §2 calls them *unratified*) | **UNMET** — deliberately **not** given a column (RULING 2) |
| P8 | **[R1] OWNER decision on the 2 `KEEP_EXISTING` rows outside the 62-row scope** (ids 167, 273, §21.4) | **UNMET — newly identified** |

---

## 18. Deferred work (mission §18)

| # | Deferred item | Why deferred | Recorded in |
|---|---|---|---|
| D1 | **[R1] Category naming and scope questions only** — the *domains* are resolved (§21.3); what remains deferred is whether to rename/consolidate categories whose names are narrower than their contents (`Heater`→heat transfer, `CNC Machine`→machine tools, `Injection Molding`→plastics processing, `Excavation`→earthmoving, `Blower`→fans and blowers, `Pollution Control`/`Dust Collection`, `Filter`/`Chemical Separation`, `Valve`/`Valves`, `Instrumentation`/`Instrumentation and Control`, `Material Handling` vs the rejected `Materials Handling`) | M5R.4A §9 *"R1 is TYPE-SEMANTICS ONLY"*; mission prohibits consolidation. **No longer a placement blocker** — 59 of 62 rows reuse existing parents | §5.5, §21.3 |
| D2 | **Tenant/customer alias layer** | M5R.1 §6.2 — requirement mandatory, implementation deferred; `ARCHITECTURE_GAP-2` | §15.8 |
| D3 | **Taxonomy delete-guard hardening** (`class_id`/`category_id` CASCADE → RESTRICT or guard trigger) | schema change prohibited here; a real knowledge-destruction vector | §15.7 |
| D4 | **Context-aware term resolution** (class/category/industry-scoped) | no M5R.4A case requires it | §15.13 |
| D5 | **Effectivity-aware reporting** so historical renders show the then-current term | reporting concern, outside taxonomy | §15.6 |
| D6 | **Decomposition architecture** — `ARCHITECTURE_GAP-3`, level count OPEN | M5R.1 §6.1; 5 `NOT_EQUIPMENT_TYPE` rows refer to it | §5.8 |
| D7 | **166 same-name class/type pairs; 65-category dual scheme** | M5R.4A §9 structural debt | §5.5 |
| D8 | **Equipment Family** | permanently excluded (M5R.1 §2.1) — **not** deferred, **excluded** | §4.4 |
| D9 | **`FALSE_PROVENANCE_REMEDIATION_REQUIRED`** — including the live `"ISO 14224 taxonomy"` error string in `asset-import.service.js` | out of scope | §4.3 |
| D10 | **Ratification state for the 282** | is a governance question, not an identity-lifecycle one | §17.3 P7 |
| D11 | **Global duplicate-name/term detection** as a governance check | cannot be a uniqueness constraint against the live corpus | §15.1, §15.5 |
| D12 | **`REPOSITORY_GOVERNANCE_HARDENING_REQUIRED`** — `main` has no branch protection and no rulesets | standing recorded debt | — |
| D13 | **`PROJECT_SOURCE_SYNCHRONIZATION_REQUIRED`** | standing recorded debt | — |
| D14 | `YEAR(created_at)` defect in `src/models/work-order.model.js` | unrelated | — |

---

## 19. Open questions (mission §19) — **[R1] status**

| # | Question | Status after R1 |
|---|---|---|
| **Q1** | ~~How are the 62 placement-bearing rows applied, given that all 46 target `(category, class)` pairs do not exist?~~ | **ANSWERED by R1 (§21.3).** A semantically correct existing parent exists for 59 of 62 rows. 48 placements are unchanged; the rest reuse an existing parent. Only **1 Category** (`Mining Equipment`) and **5 Classes** are required. What remains is OWNER **ratification**, not an open structural question. |
| **Q2** | ~~Do the 3 `INSUFFICIENT_EVIDENCE` rows become `retired`?~~ | **RULED by the OWNER — RULING 1: they must NOT be retired.** Representation determined in §21.7: they stay `canonical`, remain selectable, and carry a pending governance record with no lifecycle effect. The M5R.4A §15 reading of "retire 36" is superseded by 33 + 3 pending. |
| **Q3** | **Do the 17 merged identities' names become governed terms for their targets?** | **RULED by the OWNER — RULING 3: yes**, where technically and semantically valid. Population fixed at 65 terms (§21.8). Rows 7/8 remain contingent on §21.5. |
| **Q4** | **Are the 282 Type identities "ratified" by M5R.4A?** | **RULED — RULING 2: ratification is separate from identity lifecycle; no column in this mission.** The requirement is recorded (§21.7) and not implemented. |
| **Q5** | ~~Does `Submersible Pump` become a canonical Type, or do rows 7 and 8 re-target to `Submersible Centrifugal Pump`?~~ | **RESOLVED by R1 (§21.5)** with a recommendation and a stated alternative. Requires OWNER ratification because it changes the added-Type count from 29 to 30. |
| **Q6** | **Is the two-table design (D) preferred over the single XOR-subject table (D′)?** | **Still open** — unaffected by R1; the freeze check (§21.9) upholds D. |
| **Q7** | **[R1] How should the 2 `KEEP_EXISTING` rows outside the 62-row scope (ids 167, 273) be handled?** | **Newly identified.** Both propose a different parent while remaining `KEEP_EXISTING`. See §21.4. |
| **Q8** | **[R1] Should `Mining Equipment` be created, or should rows 84/85/100 be resolved another way?** | **Newly identified.** It is the only genuinely new domain among the 62. Recommended, but it is a category-creation decision and therefore an OWNER call. |

---

## 20. Explicitly NOT done (mission §15)

No schema modification · **no migration 019** · no database mutation · no taxonomy mutation · **no category or class created, renamed, merged or deleted in any database** (R1 *recommends* 1 + 5 and *applies* none) · no bootstrap/seed mutation · no synonym implementation · no supersession implementation · no application or runtime change · no UI change · no API change · no crosswalk population · no standards evidence population · no decomposition architecture · no Equipment Family · no customer alias architecture · no M5R.4A reopen or edit · no M5R.4B2 · no M6 · no ATM-002 · PR #27 untouched at `a8511bcdbe41a40f4656ce79d1a6224d3d1e55cb` · no merge · no deployment · no Render change · no production database access.

**Files changed by M5R.4B1 + R1:** this architecture record and `docs/research/m5r4b1/parent-taxonomy-placement-review.jsonl`. Nothing else.

---

## 21. M5R.4B1-R1 — Parent taxonomy and unresolved-identity decision closure **[R1]**

This section is the authoritative record of the R1 correction. Where it conflicts with an earlier section, **this section governs**, and the earlier text is retained as the audit trail.

Machine-readable companion: `docs/research/m5r4b1/parent-taxonomy-placement-review.jsonl` — 62 records, one per placement-bearing row, generated programmatically and validated against the live taxonomy.

### 21.1 The four OWNER rulings, and how each was applied

| Ruling | Applied as |
|---|---|
| **1 — `INSUFFICIENT_EVIDENCE` is not retired** | The 3 rows stay `canonical` and selectable. No retirement record is created. `identity_state` gains **no** fourth value. Partition revised to **230 / 19 / 33**. §21.7 |
| **2 — ratification is separate from lifecycle** | **No ratification column was added.** The requirement is recorded only. §21.7 |
| **3 — merged names remain resolvable** | All 17 `MERGE_DUPLICATE` names enter the terminology population as `MERGED_IDENTITY_TERM`. §21.8 |
| **4 — endpoints are identities, not text** | Every endpoint in the recommended architecture is `equipment_types.id`. Reaffirms I17; reinforces B1-3. §21.6 |

### 21.2 Methodology

1. Extract the 62 placement-bearing rows (`ADD_TYPE` 29 + `RECLASSIFY` 33) programmatically.
2. Reconstruct the **live** taxonomy from `scripts/bootstrap-knowledge/*.jsonl` — 65 categories, 311 classes, 282 types — and re-verify the bijection with the M5R.4A candidates (282/282 keys identical).
3. For every row, classify M5R.4A's proposed Category and Class against the live taxonomy, and determine **why** the pairing fails.
4. Apply the R1 parent-placement policy, stated verbatim in §21.2.1.
5. Validate every determination: a `USE_EXISTING` parent must exist; an `ADD_REQUIRED` parent must not. The generator **fails the build** otherwise — and did fail twice during authoring, catching a real error at row 166 (§21.2.2).
6. Simulate the post-application Type population of every affected class to measure the same-name consequence (§21.10).

**21.2.1 R1 parent-placement policy**

> 1. Reuse the **most specific existing Class** whose engineering scope genuinely contains the Type.
> 2. Otherwise reuse the Class in the row's **existing** placement, unless that parent is **engineeringly wrong** for the Type.
> 3. Otherwise **ADD** the minimum Class under the semantically correct **existing** Category.
> 4. **ADD a Category only when no existing Category denotes the domain.**
>
> Creating a parent that duplicates an existing parent's name or scope is **prohibited**. Forcing a Type under an engineeringly incorrect parent merely to avoid an addition is **prohibited**.

**21.2.2 Disclosed self-inflicted error.** The first generation run failed validation at **row 166**: I had assumed the baghouse's parent was `Dust Collection`, but the live taxonomy places `Baghouse Filter` under `Pollution Control`. The validator caught it before the artifact was written. This is the second time in this engagement that a mechanical check has caught a transcription error that manual review had passed; it is the reason the generator asserts rather than prints.

### 21.3 The 62-row result — B1-1 reversed

```
category_action : USE_EXISTING 59 · ADD_REQUIRED 3 · DEFER_BLOCKED 0
class_action    : USE_EXISTING 55 · ADD_REQUIRED 7 · DEFER_BLOCKED 0
new Categories  : 1   Mining Equipment
new Classes     : 5   Instrumentation/Level Switch
                      Mining Equipment/Cutting Equipment
                      Mining Equipment/Mine Hoisting
                      Drilling/Well Control Equipment
                      Drilling/Hoisting Equipment
placements that R1 leaves completely UNCHANGED : 48 of 62
rows where the M5R.4A proposed pair already existed : 1 (id 13)
rows requiring an OWNER ratification              : 35
```

**(a) How many can use existing Categories — 59 of 62.**

**(b) How many genuinely require a new Category — 3 rows, 1 distinct Category** (`Mining Equipment`, for ids 84, 85, 100). Justified because the current parents are engineeringly wrong (a continuous miner and a longwall shearer are not drilling machines; a mine hoist is not a gearbox) and **no existing Category denotes mining machinery at all**.

**(c) Exact proposed new Categories —** `Mining Equipment`.

**(d) How many can use existing Classes — 55 of 62.**

**(e) How many genuinely require a new Class — 7 rows, 5 distinct Classes.**

**(f) Exact proposed new Classes —** `Level Switch` (Instrumentation); `Cutting Equipment` and `Mine Hoisting` (Mining Equipment); `Well Control Equipment` and `Hoisting Equipment` (Drilling). Each is justified in the JSONL with explicit reasoning per row.

**(g) How many remain blocked or unresolved — 0.** Every one of the 62 rows has a recommended parent. What remains is **ratification**, not an engineering gap.

**(h) Does any proposed parent reintroduce Equipment Family — NO.** The one new Category is a domain, and all five new Classes group Types by engineering characteristics. No new identity level is created. `Category → Class → Type` is preserved exactly, and no Type carries a broad-container name.

**(i) Does any proposal prematurely perform the 65-category consolidation — NO.** No category is renamed, merged or deleted. The **10 empty legacy shell categories** (`Rotating Equipment`, `Static Equipment`, `Valves`, `Piping Systems`, `Structures`, `Safety Systems`, `Utility Equipment`, `SCADA`, `UPS`, `Instrumentation and Control`) are left **exactly as they are**, unpopulated. Several of them contain classes that M5R.4A proposed to create elsewhere — `Valves > Isolation Valve` already exists — and R1 deliberately does **not** repopulate them, because doing so would be the consolidation task.

**The 18 categories and 44 classes M5R.4A proposed are NOT required and must not be created.** Every one of the 18 is either an exact duplicate of a live category (`Compressors`/`Compressor`, `Heat Transfer`/`Heater`, `Filtration`/`Filter`, `Separation`/`Separator`, `Screening`/`Screen`, `Mixing`/`Mixer`, `Machine Tools`/`CNC Machine`, `Plastics Processing`/`Injection Molding`, `Pipeline Equipment`/`Pipeline`, `Surface Treatment`/`Paint`, `Heat Rejection`/`Cooling`, `Heat Recovery`/`HRSG`, `Earthmoving`/`Excavation`, `Fans` and `Fans and Blowers`/`Blower`, `Materials Handling`/`Material Handling`) or has no live equivalent (`Mining Equipment`, `Gas Cleaning`).

**Note a split M5R.4A introduced inside its own accepted package:** it proposes `Materials Handling` for 4 rows while 5 `KEEP_EXISTING` rows (235–238, 259) use the live `Material Handling`. Adopting the proposal would have created a singular/plural duplicate **within one decision set**.

### 21.4 Two package observations (reported, not corrected)

| Observation | Detail |
|---|---|
| **One `ADD_TYPE` row has no proposed parent** | **id 37 `Orifice Plate`** carries `proposed_category = null` and `proposed_class = null`. M5R.4A's rationale states it was converted from `MERGE_DUPLICATE` to `ADD_TYPE` "so the canonical identity has an originating row", but no destination was supplied. R1 supplies `Instrumentation > Flow Meter` by reuse — the same parent as its five sibling flow-meter principles. |
| **Two `KEEP_EXISTING` rows also propose a different parent** | **id 167 `Wet Scrubber`** (`Pollution Control`/`Wet Scrubber` → `Gas Cleaning`/`Scrubbers`) and **id 273 `Air Circuit Breaker`** (`Electrical Equipment`/`Switchgear` → `Electrical Equipment`/`Switching Devices`). Neither is inside the mission's 62-row definition, and **R1 did not expand scope to cover them.** `Gas Cleaning` has no live equivalent; `Switching Devices` does not exist as a class. Recorded as precondition **P8** and question **Q7**. |

Neither observation changes an M5R.4A engineering disposition.

### 21.5 Candidate 7 / 8 closure — `Submersible Pump` (B1-2, CLOSED)

**Source identities**

| id | name | code | class | disposition |
|---|---|---|---|---|
| 7 | Submersible Sewage Pump | `SEWAGE` | `Pump > Submersible Pump` | `MERGE_DUPLICATE` → `Submersible Pump` |
| 8 | Submersible Drainage | `DRAINAGE` | `Pump > Submersible Pump` | `MERGE_DUPLICATE` → `Submersible Pump` |
| 9 | Submersible Slurry | `SLURRY` | `Pump > Submersible Pump` | `MERGE_DUPLICATE` → `Slurry Pump` |

**Finding.** `Submersible Pump` is **not** a candidate name and **not** any candidate's canonical name. It is the **name of the class** `Pump > Submersible Pump`, which contains exactly rows 7, 8 and 9.

**This is not an anomaly — it is M5R.4A's own governing pattern.** Eight other rows promote the class-level kind and take the class name as their canonical identity: `TEFC Motor → AC Induction Motor`, `Rising Stem Gate → Gate Valve`, `Concentric Butterfly → Butterfly Valve`, `Swing Check → Check Valve`, `Modular PLC → Programmable Logic Controller`, `Single Stage Centrifugal → Centrifugal Blower`, `Twin Lobe Blower → Rotary Lobe Blower`, `Turbine Mixer → Mechanical Mixer`. Rows 7 and 8 are the **same operation**, except that no row performs the promotion, so the merge has no endpoint.

**Intended canonical engineering identity.** The submersible pump as a machine — differentiated by *installation* (submerged) rather than by hydraulic principle, which is why `Sewage` and `Drainage` are duty qualifiers and not Types. This is consistent with M5R.4A disposing of them as duplicates rather than as Types.

**Resolution.** Establish **`Submersible Pump`** as a canonical Type under `Pump > Submersible Pump`, using the same mechanism as the 29 `ADD_TYPE` rows; rows 7 and 8 then have a real endpoint.

**Numeric consequence — requires OWNER ratification.** M5R.4A §15 says *"add 29 canonical types"*. This closure makes it **30**. That is a change to an accepted count, so it is reported rather than assumed.

**Alternative, if the OWNER prefers no added Type.** Re-target rows 7 and 8 to **`Submersible Centrifugal Pump`** (id 5, `KEEP_EXISTING`). This keeps the count at 29, but it merges a duty-differentiated submersible into a hydraulic-principle class, which cuts across the two organizing axes in the corpus and would make `Pump > Submersible Pump` an empty class.

**Does this change M5R.4A semantics? NO.** Rows 7 and 8 remain `MERGE_DUPLICATE` into `Submersible Pump`. Only the **existence of their endpoint** is clarified. No disposition, rationale or confidence is altered. Per mission §10 this is therefore a clarification, not a revision, and does not require a STOP.

**Confidence: HIGH.** Not `MEDIUM`, because the pattern is attested eight times inside the same accepted package.

### 21.6 Candidate 56 closure — `Pressure Filter` endpoint (B1-3, CLOSED — no OWNER decision required)

| id | name | code | context | disposition |
|---|---|---|---|---|
| 56 | Pressure Filter | `PRESSURE` | `Filter > Sand Filter` | `MERGE_DUPLICATE` → `Pressure Filter` |
| 200 | Pressure Filter | `PRESS_FILT` | `Chemical Separation > Pressure Filter` | `KEEP_EXISTING` → canonical `Pressure Filter` |

**Verification from the package's own evidence, not inference.** M5R.4A §7C states the basis for row 56 in these words: *"Duplicate identity: the same pressure filter is also held under Chemical Separation."* There is exactly one pressure filter held under `Chemical Separation`, and it is candidate 200. **Confirmed.**

**Why they are duplicates.** Two live Type rows carry the same name in different categories. Row 56 is additionally mis-filed: a machine named "Pressure Filter" sits in the class `Sand Filter`. Row 200 sits in a class named after itself.

**Immutable endpoint.** `equipment_types.id` of the row whose class is `Chemical Separation > Pressure Filter` and whose `type_code` is **`PRESS_FILT`** — i.e. candidate/type **200**. **Not** the string `Pressure Filter`, which identifies two rows. This is RULING 4 applied concretely.

**Residual ambiguity — NONE in substance.** The endpoint is unique once expressed by identity. The only residual is the *textual* ambiguity in the accepted package, which is why the architecture's I17 prohibits text endpoints.

**Consistency check with §21.3.** Row 200 stays under `Chemical Separation`, and R1's recommendations for rows 201–203 also keep filtration equipment under `Chemical Separation`. The survivor and its siblings therefore remain in one category. **No contradiction.**

### 21.7 The three `INSUFFICIENT_EVIDENCE` rows (RULINGS 1 and 2)

```
id=6    Circulator Pump   Pump > Centrifugal Pump
id=158  Turbo Generator   Generator > Generator
id=190  Agitated Vessel   Mixer > Agitated Vessel
```

| Question (mission §12) | Determination |
|---|---|
| What evidence is missing? | **6:** whether a small hydronic in-line circulator is a distinct hydraulic machine or a synonym of the circulating water pump already carried. **158:** whether a turbo generator is a distinct package or already covered where the driving turbine is the Type. **190:** whether an agitated vessel is a Type-level vessel with an agitator package or a variant of the mechanical mixer. In each case the corpus supplies no physical description, no component list and no duty envelope. |
| Why the current evidence cannot conclude? | The governing test (§3.1) asks whether a distinction changes the maintenance task set, inspection regime, failure-mode family, safety controls or operating principle. The corpus content is a name, a code, a one-line description and a component phrase — enough to place a machine, **not** enough to decide these three. The M5R.4A rationale says exactly this: *"The corpus gives no way to choose."* |
| What evidence would resolve it? | For 6: a circulation-duty specification and whether the unit is a distinct machine or a selection of the existing circulating pump. For 158: whether the generator is supplied as an integrated package with its own control and lubrication, or as a turbine-driven machine. For 190: whether the agitator is a decomposition component of a vessel or the vessel is a variant of a mixer. Each is an **engineering-authoring** question answerable by Atiman without any standards evidence. |
| Can it safely remain an existing Type temporarily? | **YES — and it MUST.** Each is already a live Type with normal standing, and no evidence contradicts it. RULING 1 forbids converting that into a retirement. |
| Should it be excluded from new selection while unresolved? | **NO.** See VUDA K (§21.12). Excluding a Type without evidence is a negative decision reached by stealth, which is precisely what RULING 1 prohibits. They remain `canonical` and selectable. |
| Does this need a governance state distinct from identity lifecycle? | **YES — and this is the R1 finding for Option D.** Lifecycle answers *"may this identity still be used"*; the unresolved condition answers *"have we concluded about this identity's distinctness"*. They are different questions, which is exactly why RULING 2 separates them. |

**Cleanest representation, given the frozen architecture and RULING 2.** No new column and no fourth `identity_state`. The recommended resolution table already holds **proposals** as well as approved resolutions: its `review_state` is `draft` / `under_review` / `approved` / `rejected` (the `017` vocabulary). An unresolved identity is therefore represented as a record with:

- `review_state = 'under_review'`,
- `resolution_kind = 'INSUFFICIENT_EVIDENCE'`,
- `to_type_id = NULL`,
- `identity_state` **unchanged at `canonical`** — because I6 coerces lifecycle **only on approval**.

This satisfies both rulings simultaneously: the pending condition is durable, attributed and auditable, while the identity keeps its full standing. When evidence arrives, the same record is revised or superseded into a real resolution and only **then** does lifecycle move.

**Recorded but NOT implemented (RULING 2):** whether the Knowledge Foundation needs a first-class **ratification / decision** dimension distinct from lifecycle. It is a real requirement — M5R.4A §2 records the 282 as *unratified* `CANDIDATE_EQUIPMENT_IDENTITIES` — but it must not be smuggled in as a lifecycle value or an extra column.

### 21.8 Terminology closure (RULING 3)

**Population: 65 governed terms.**

| Kind | Count | Source |
|---|---|---|
| `LEGACY_NAME` | **46** | the 36 `KEEP_EXISTING` + 10 `RECLASSIFY` rows renamed in place |
| `SYNONYM` | **2** | `Ultrasonic` → `Ultrasonic Flow Meter`; `Orifice Meter` → `Orifice Plate Flow Meter` |
| `MERGED_IDENTITY_TERM` | **17** | all `MERGE_DUPLICATE` names, per RULING 3 |
| **Total** | **65** | |

**The 25 `ADD_TYPE` renames create NO term** — those are new rows and no prior term exists. **Nothing is created merely because strings differ:** each of the 65 is an *existing* string that would otherwise become unresolvable.

**`ABBREVIATION` is NOT a distinct kind — proven, not asserted.** If abbreviation were a relationship kind, a term could not be both an abbreviation and a merged-identity term. It can:

```
LEGACY_NAME terms containing an abbreviation token (11):
  RTD Sensor · DTH Drill · API Atmospheric Tank · TEG Dehydrator · GIS Switchgear
  ESP · LP Feedwater Heater · CSTR · EDM Machine · MIG Welder · TIG Welder
MERGED_IDENTITY_TERM terms containing an abbreviation token (2):
  HP Feedwater Heater -> Feedwater Heater · AC Motor -> AC Induction Motor
```

The two sets overlap in form and are disjoint in relationship, so **abbreviation is orthogonal to relationship kind**: it is at most an attribute of a term, and `LEGACY_NAME / SYNONYM / MERGED_IDENTITY_TERM` fully partition the 65. Adding `ABBREVIATION` as a fourth kind would create a false dichotomy and could not represent `HP Feedwater Heater` without picking one dimension arbitrarily.

**Machine-checked totals:** 46 + 2 + 17 = 65; the 46 decompose as 36 + 10 by disposition; the 17 merge into **14 distinct targets**.

### 21.9 Option D freeze check

The OWNER froze Option D unless a concrete contradiction is demonstrated. **No contradiction was found. Option D is upheld**, with one clarification.

| Question | Answer |
|---|---|
| Does it still satisfy the requirements? | **YES.** All 282 accepted outcomes remain representable: 230 canonical (29 in-place renames, 198 updates, 30 inserts), 19 superseded-with-target, 33 retired-without-target, 3 unresolved-pending, 65 terms. |
| Is `canonical` / `superseded` / `retired` still semantically sufficient for **lifecycle**? | **YES.** R1 produced no row requiring a fourth lifecycle value. The one candidate (`unresolved`) is a **decision** state, not a lifecycle state, and RULING 2 forbids conflating them. |
| Does unresolved governance need to remain outside lifecycle? | **YES — confirmed by evidence.** Two of the three unresolved rows (`6`, `190`) could plausibly resolve to `superseded` (a synonym of a carried Type) *or* to `canonical` (a distinct Type). Their lifecycle is genuinely unknown, so encoding the uncertainty as a lifecycle value would make the row's standing false in one of the two outcomes. |
| Are the two tables still justified? | **YES, and R1 strengthened the case.** (i) The **resolution** table is required because 33 retirements have **no target** — a nullable-target governed record with a coherence CHECK, exactly the `017` `NO_DIRECT_MAPPING` precedent — and because it now also carries pending proposals. (ii) The **terminology** table is required because **46 existing identities are renamed**, which R1 re-verified, so the old vocabulary must stay resolvable independently of any lifecycle change. A single XOR-subject table (D′) would have to hold a pending proposal, an approved resolution and a rename term under one cardinality rule; **D remains cleaner.** |
| Does migration 019 remain necessary? | **YES.** Unchanged in principle; scope is re-examined in §21.10. |
| Did R1 invalidate any Option D component? | **NO.** One refinement: the resolution table's partial unique index must be scoped to **approved, active** rows only — which is already how it was specified. A pending proposal must never collide with an approved resolution, and because I5's uniqueness is conditional on `review_state = 'approved'`, it does not. |

### 21.10 Migration 019 — necessity and revised scope

**Migration 019 is still necessary and was NOT written.** Its previously proposed responsibility **remains valid**, with two clarifications arising from R1:

**Unchanged (still in scope for 019):** the `identity_state` column + CHECK; the `equipment_type_identity_resolution` table with coherence, attribution and no-self CHECKs, `RESTRICT` FKs and a partial unique index among approved rows; the `equipment_type_term` table with its governance CHECKs and partial unique index; the lifecycle-coercion trigger; the chain/cycle and target-canonicality trigger; the delete guards; the ≤63-byte identifier audit; strict idempotency.

**Clarification 1 — no fourth lifecycle value, no ratification column.** RULINGS 1 and 2 remove any question of `identity_state` gaining `unresolved`, and forbid a ratification column. The pending condition is carried by the existing `review_state` vocabulary on the resolution table. **019 does not grow.** If anything it is unchanged in size.

**Clarification 2 — the resolution table must accept a pending proposal coherently.** The coherence CHECK must permit (`review_state IN ('draft','under_review')`, `resolution_kind = 'INSUFFICIENT_EVIDENCE'`, `to_type_id IS NULL`) without triggering lifecycle coercion. This is already implied by "coercion fires only on approval" (I6) and requires no extra object.

**019 must still NOT** create, rename, merge or delete any category or class; populate any row; touch 001–018; import the legacy design artifact; alter the crosswalk; add a tenant scope; add an AI path; or change any runtime file. **No SQL was written in this mission.**

### 21.11 The single OWNER ratification this mission requests

R1 asks the Chief Architect to ratify **one** artefact — the 62-row placement table in `docs/research/m5r4b1/parent-taxonomy-placement-review.jsonl` — comprising:

1. **48 placements unchanged** and **11 rows moved to a different existing parent**, all by reuse;
2. **1 new Category** (`Mining Equipment`) and **5 new Classes** (§21.3(f));
3. **35 rows** where R1's parent overrides an M5R.4A proposed parent name — each needing ratification because M5R.4A's name was not approval to create it;
4. the **§21.5** `Submersible Pump` addition, which changes the added-Type count from 29 to **30**.

Everything else in R1 is either a ruling already given by the OWNER, a closure requiring no decision (§21.6), or a recorded observation concerning rows outside the 62 (§21.4).

### 21.12 VUDA — R1 attacks

Run against the corrected architecture and the 62 parent decisions. Attacks that **succeed** are stated as successes.

| # | Attack | Result |
|---|---|---|
| **A** | Did we create Categories merely because M5R.4A proposed names? | **NO.** All 18 proposed names were classified and rejected: 16 are exact duplicates of live categories, and `Mining Equipment` + `Gas Cleaning` have no live equivalent — of which only `Mining Equipment` is needed, and it is justified by the **absence of any mining domain**, not by M5R.4A having named it. Created: **1**. |
| **B** | Did we create Classes that are actually Types? | **NO.** None of the 5 new class names equals any Type name. `Mine Hoisting` ≠ `Mine Hoist`; `Well Control Equipment` and `Hoisting Equipment` are families, not Types; `Level Switch` is a functional family; `Cutting Equipment` groups two peer Types. The inverse risk — M5R.4A's proposals `Isolation Valve`, `Non-Return Valve`, `Dynamic`, `Positive Displacement`, `Shell and Tube`, `Plate`, `Air-Cooled` — **were** constructions/technologies masquerading as Classes, and they were **rejected**. |
| **C** | Did we create Classes that merely repeat their only Type? | **PARTIALLY — disclosed.** Of the 5 new classes, **3 hold exactly one Type at application time**: `Level Switch` (Float Level Switch), `Mine Hoisting` (Mine Hoist), `Well Control Equipment` (Blowout Preventer); `Cutting Equipment` and `Hoisting Equipment` hold two each. Justification: each is a genuine functional family that will accrete members (other level-switch principles; other hoists; annular/ram/rotating preventers), and none of the three could be placed under an existing class without violating the engineering rule. **But this is a real cost and it is not hidden.** See §21.10's measurement of the wider same-name condition. |
| **D** | Did we recreate Equipment Family? | **NO.** No new identity level; no Type carries a broad-container name; the single new Category is a domain and the 5 new Classes sit below Category. Verified across all 62 final placements. |
| **E** | Did we collapse materially different engineering Classes? | **NO.** R1 created no class merge, and declined 18 category creations. `Gate Valve` and `Butterfly Valve` remain distinct classes with distinct Types; `Flow Meter`, `Level Transmitter` and `Pressure Transmitter` remain distinct instrument classes; the three valve constructions stay separate rather than being collapsed into one `Isolation Valve`. |
| **F** | Did we force equipment under incorrect existing parents just to avoid additions? | **NO — with a disclosed nuance.** In every reuse, the **Class** scope is exact; only the **Category name** is sometimes narrower than its contents (`Heater` holding exchangers, `CNC Machine` holding grinding/EDM, `Injection Molding` holding blow/extrusion/thermoforming, `Excavation` holding earthmoving plant, `Blower` holding a fan, `Conveyor` holding feeders, `Pollution Control` holding a baghouse, `Chemical Separation` holding filtration plant, `Haulage` holding a wheel loader, `Dust Collection` holding a cyclone). That is **pre-existing category-naming debt, explicitly deferred by M5R.4A §9** — not a placement error, and not something R1 may fix. Where the parent was engineeringly **wrong**, R1 added structure instead: rows **84, 85** (leaving `Drilling`) and **100** (leaving `Gearbox`). |
| **G** | Did we accidentally perform the deferred category consolidation? | **NO.** No category renamed, merged or deleted; the 10 empty legacy shell categories are untouched and still empty; `Valve`/`Valves`, `Instrumentation`/`Instrumentation and Control`, `Compressor`/`General Compressor`, `Heater`/`Heat Exchanger`, `Filter`/`Chemical Separation` all remain exactly as found. In particular R1 **declined** to populate `Valves > Isolation Valve` even though doing so would have satisfied M5R.4A's proposal with zero new objects. |
| **H** | Did we treat insufficient evidence as a negative conclusion? | **NO.** RULING 1 applied: 3 rows stay `canonical`, selectable, with no retirement record. The identity-lifecycle partition was **corrected from 227/19/36 to 230/19/33**. This was the one place where the first M5R.4B1 issue would have made an affirmative negative decision out of an absence of evidence. |
| **I** | Did we resolve an endpoint by name instead of identity? | **NO in the architecture; disclosed in the companion.** The JSONL reports `candidate_name` for readability but every governed endpoint is defined as `equipment_types.id`, and §21.6 fixes row 56's endpoint by class + `type_code`. **The M5R.4A companion does express `canonical_target` as text**, which is exactly what produced B1-3; RULING 4 and invariant I17 exist to prevent the architecture from inheriting that. |
| **J** | Did we lose historical terminology? | **NO.** All 65 terms are preserved as governed knowledge (§21.8), including the 17 merged names. Note the **18 rejected category names are not "historical terminology"**: they were never live taxonomy, they remain recorded in the M5R.4A package and in this record, and rejecting a proposal destroys no history. |
| **K** | Can an unresolved identity be selected as if fully governed? | **YES — deliberately, and this is the honest answer.** The 3 rows remain `canonical` and **selectable**, because excluding them without evidence would be a negative decision by stealth (RULING 1). **Residual risk:** nothing forces a picker to *surface* the pending condition, so a user could select `Circulator Pump` without seeing that its distinctness is under review. Mitigation requires the discovery/selection read-path work already scoped as I16 — the pending record must be visible in discovery. Not implemented here. |
| **L** | Does Option D still preserve historical truth? | **YES.** §21.9. Renames keep the prior term as governed vocabulary; retirements keep the row and record the conclusion; merges keep the source row and its name; the 3 unresolved rows keep full standing. |
| **M** | Can external/customer vocabulary pollute canonical taxonomy? | **NO new path.** Both new tables are global-scope only; the tenant/customer alias layer remains unbuilt (M5R.1 §6.2); no external identity becomes canonical. R1's reuse decision adds no pollution vector, and R1 created no category named after a customer, duty, medium or site. |
| **N** | Can AI approve any of these decisions? | **NO.** Unchanged: `approved_by_user_id` FKs to `users(id)` and I8 requires it non-NULL for `approved`, so an AI approval is **unrepresentable**. The 62 placements are human engineering determinations recorded as recommendations for a human OWNER. |
| **O** | Can any relationship form a cycle or ambiguous chain? | **NO.** Invariants I2 + I5 bound resolution depth to exactly 1. The 62 placements are Category/Class **parent** links, which are a tree, not a graph, so they cannot cycle. The one genuinely ambiguous input — two rows named `Pressure Filter` — is closed by identity in §21.6. |

**Additional R1-specific attack, not in the mission list.** *Does the class-promotion pattern degrade the Class level?* **YES, and it is measured.** M5R.4A's `ADD_TYPE` rows promote a class-level kind to Type level 30 times. Simulating the post-application population of all 185 affected classes shows **125 classes would hold exactly one Type whose name equals the class name** — including **27 of the 62** rows here. So M5R.4A's level-shift **increases** the same-name Class/Type debt that M5R.4A §9 records (166 of 282 names identical to their class name). **R1 neither created nor fixed this**, and it is the strongest argument for the deferred Class-level remediation task. It is recorded so the OWNER sees the true cost of the Type-level decisions, not just the parent cost.

### 21.13 R1 explicitly did NOT do

No taxonomy mutation · **no schema change** · **no migration 019** · no database mutation · no category or class **created, renamed, merged or deleted in any database** · no seed or bootstrap mutation · no runtime, API, UI, test or view change · no crosswalk or evidence population · no standards evidence invented · no synonym or supersession implementation · no decomposition architecture · no Equipment Family · no customer alias architecture · no category consolidation · no M5R.4A file edited · no M5R.4B2 · no M6 · no ATM-002 · PR #27 untouched · no merge · no deployment · no production access.

**R1 changed exactly two files:** this architecture record (corrected in place) and the one authorised machine-readable companion. The generator that produced the companion was **run from outside the repository** and was deliberately **not committed**, because mission §17 authorises exactly one research companion file.
