# ATM-001 M5R.4B1 — Taxonomy Identity Lifecycle Architecture (Discovery)

**Status:** Discovery / architecture recommendation. **Awaiting OWNER review.**
**Baseline:** `origin/main` = `abfd6c8be83ee3201b8deea8f0c08a25952e4cda`, tree `0dbadf1c9bfcc951f6f08e1a90bf7c3e8efbd83a` (the M5R.4A merge).
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
| e | A concept **stops being a Type at all**, with **no** Type successor | `NOT_EQUIPMENT_TYPE` 29 + `TOO_BROAD_CONTAINER` 4 + `INSUFFICIENT_EVIDENCE` 3 = **36** |

**(a)(b)(c) are Type-row concerns. (d) is an identity-resolution concern. (e) is a retirement concern with no successor.** Requirements (c) and (d) additionally create **legacy vocabulary** that must stay resolvable: 46 existing identities are renamed (§5.4) and 19 retire with a target.

### 1.3 The recommendation

**OPTION D — canonical identity + governed standing + governed terminology**, built entirely from idioms the repository already uses.

1. **One additive column** on `equipment_types`: `identity_state` ∈ (`canonical`, `superseded`, `retired`), default `canonical`.
2. **One governed resolution table** recording, for each identity whose standing changes, the source Type, the optional canonical successor, the relationship kind, full human attribution, AI-assistance disclosure, provenance and effectivity. **All 55 rows of (d) and (e) get exactly one row here**, so retirement without a successor is represented as *positive governed knowledge* rather than as an absence.
3. **One governed terminology table** mapping a term (legacy name, abbreviation, synonym) to its canonical Type, so renamed and merged vocabulary stays discoverable.

**Not recommended now:** any tenant-scoped/customer alias layer. M5R.1 §6.2 defers it and M5R.4A produced **zero** `CUSTOMER_SPECIFIC` rows.

### 1.4 Schema change

**Necessary.** Option E (no schema change) is **not viable** (§7.6, §16). Migration 019 will eventually be required, with a bounded scope stated in §16.3. **It was not written.**

### 1.5 Three findings that block M5R.4B2

These are reported, not resolved. M5R.4A was **not** reopened and **not** modified.

| ID | Finding | Severity |
|---|---|---|
| **B1-1** | **All 62 placement-bearing rows (`ADD_TYPE` 29 + `RECLASSIFY` 33) target a `(category, class)` pair that does not exist.** 46 distinct pairs are missing; **18 new categories** and **44 new class names** would have to be created. M5R.4A §9 explicitly deferred the Category/Class layer. | **BLOCKING** for M5R.4B2 |
| **B1-2** | Candidates **7** and **8** merge into **`Submersible Pump`**, which is a **class name**, not any accepted Type identity. No candidate is named `Submersible Pump`; no accepted disposition establishes one. | **BLOCKING** for those 2 rows |
| **B1-3** | Candidate **56** `Pressure Filter` merges into `Pressure Filter` — **its own name**. The intended target is candidate 200, the other `Pressure Filter` row. The package is correct in substance but **ambiguously expressed by name**, proving relationship endpoints must be identified by **identity, not text**. | **CORRECTNESS** — an architecture requirement, not a package defect |

Full detail in §5.5–§5.7 and §19.

### 1.6 Consequence

M5R.4B1 **cannot** conclude that M5R.4B2 is ready to execute. The identity-lifecycle mechanism can be decided and is decided here; **the Category/Class target structure must be decided first**, because 62 of the 282 accepted decisions cannot be applied without it.

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

### 5.3 The representation partition (verified, 227 + 19 + 36 = 282)

| Bucket | Rows | Composition | What must be representable |
|---|---|---|---|
| **Remain canonical** | **227** | KEEP 165 + RECLASSIFY 33 + ADD 29 | 29 inserts; 198 in-place updates (replacement `class_id` and/or `type_name`) |
| **Leave with a target** | **19** | MERGE 17 + SYNONYM 2 | source Type stops being canonical; a canonical successor; why; who; when; from what source |
| **Retire without a Type successor** | **36** | NOT_EQUIPMENT_TYPE 29 + TOO_BROAD_CONTAINER 4 + INSUFFICIENT_EVIDENCE 3 | source Type stops being canonical; **no** successor; why; who; when; from what source |

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

### 5.5 BLOCKING FINDING B1-1 — every placement targets a non-existent class

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

**Therefore M5R.4B2 cannot be a Type-only additive application.** It depends on a prior bounded decision about the Category/Class target structure — which M5R.4A §9 ("*R1 is TYPE-SEMANTICS ONLY*") and the M5R.4B1 prohibitions both place outside this work. **No consolidation, rename or creation of any category or class was performed.**

### 5.6 BLOCKING FINDING B1-2 — an unresolved merge target

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

### 5.7 FINDING B1-3 — a relationship expressed by name is not unambiguous

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
| `canonical` | The identity is Atiman-canonical and valid for new classification. | **Yes** | to itself | 227 (165 KEEP + 33 RECLASSIFY + 29 ADD) |
| `superseded` | No longer valid for new classification; the engineering identity continues under another canonical Type. **Requires an active resolution whose target is `canonical`.** | **No** | follows the resolution edge | 19 |
| `retired` | Not an equipment Type at all. **No Type successor exists**, and that absence is a governed conclusion. | **No** | preserved as a row; resolves to nothing | 36 (see §19 Q2) |

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
| **I6** | A Type with an active resolution to a target is `superseded`; a Type with an active resolution without a target is `retired`; no disagreement is representable. | trigger coerces `identity_state`, `009` precedent (*"Coerce lifecycle when a successor is assigned"*) |
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

### 17.1 In scope for M5R.4B2 (only after B1-1 is resolved and 019 is authorised and applied)

1. **227 canonical outcomes** — 29 `ADD_TYPE` inserts; 198 in-place updates (`class_id` and/or `type_name` for the 33 `RECLASSIFY` and the 36 renamed `KEEP_EXISTING` rows).
2. **55 standing changes** — one governed `equipment_type_identity_resolution` row each: 19 with a canonical target (`MERGED_DUPLICATE` 17, `SYNONYM_OF` 2), 36 without (`NOT_AN_EQUIPMENT_TYPE` 29, `TOO_BROAD_FOR_TYPE` 4, and the `INSUFFICIENT_EVIDENCE` 3 subject to §19 Q2).
3. **Terminology** — `LEGACY_NAME`/`ABBREVIATION` term rows for the 46 renamed identities; `SYNONYM` term rows for the 2 `SYNONYM_OR_ALIAS` rows. Whether the 17 merged names also become terms is an OWNER decision (§19 Q3).
4. **Provenance** — one `knowledge_sources` + `knowledge_source_versions` pair citing the accepted decision package (`legacy_migration` + `engineering_authored`), referenced by every resolution and term.
5. **Read-path correctness** — the I16 discovery/selection split, and the `asset-import.service.js` ambiguity fix (§13.3), which is a **precondition**, not an optional extra.
6. **The 9 decomposition referrals** recorded as referrals only (M5R.4A §11) — no decomposition architecture.

### 17.2 Explicitly NOT in M5R.4B2

Category/Class creation, rename or consolidation (B1-1 — needs its own decision) · the 166 same-name class/type pairs · the 65-category dual scheme · Equipment Family · decomposition architecture (M5R.1 §6.1) · customer/tenant alias layer (§6.2) · crosswalk or evidence population · standards content · false-provenance remediation · `YEAR(created_at)` defect · class-level remediation · M6 · ATM-002 · UI · taxonomy delete-guard hardening (§18).

### 17.3 Preconditions for M5R.4B2 — all currently unmet

| # | Precondition | Status |
|---|---|---|
| P1 | **OWNER ruling on the Category/Class target structure** for the 62 placement-bearing rows (B1-1) | **UNMET — BLOCKING** |
| P2 | **OWNER ruling on `Submersible Pump`** for rows 7 and 8 (B1-2) | **UNMET** |
| P3 | **OWNER ruling that row 56's target is candidate 200** (identity, not name) (B1-3) | **UNMET** |
| P4 | **OWNER ruling on the 3 `INSUFFICIENT_EVIDENCE` rows** (§19 Q2) | **UNMET** |
| P5 | Migration 019 authored, reviewed, approved, applied | **NOT STARTED** |
| P6 | `asset-import.service.js` ambiguity fixed (application change) | **NOT STARTED** |
| P7 | OWNER decision: are the 282 "ratified"? (M5R.4A §2 calls them *unratified*) — determines whether a ratification dimension is needed | **UNMET** |

---

## 18. Deferred work (mission §18)

| # | Deferred item | Why deferred | Recorded in |
|---|---|---|---|
| D1 | **Category/Class target structure** — 18 categories, 44 classes | M5R.4A §9 *"R1 is TYPE-SEMANTICS ONLY"*; mission prohibits consolidation | §5.5 |
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

## 19. Open questions (mission §19)

| # | Question | Why it must be answered by the OWNER, not by engineering | Recommended default |
|---|---|---|---|
| **Q1** | **How are the 62 placement-bearing rows applied, given that all 46 target `(category, class)` pairs do not exist?** Options: (a) authorise a separate bounded Category/Class task first; (b) defer the 62 and apply only the 220 rows whose placement exists; (c) some other ruling. | This is a **taxonomy-structure decision**, explicitly outside M5R.4A's scope (§9) and outside this mission's prohibitions. Engineering cannot choose it. | **(a)** — apply nothing at the Type level until the target structure is decided, because applying 62 rows into invented classes would pre-empt the deferred structural decision. |
| **Q2** | **Do the 3 `INSUFFICIENT_EVIDENCE` rows become `retired`?** M5R.4A §15 reads *"retire 36 rows from Type level"* (29 + 4 + 3), but §7E calls those 3 *undecided*. Retiring an undecided row is itself a decision. | It changes the accepted package's meaning; §14 forbids silently changing it. | Keep them **`canonical`** and unresolved until decided (i.e. 33 retirements, 230 canonical) — or record them as `INSUFFICIENT_EVIDENCE` resolutions with no target. **Requires an explicit ruling.** |
| **Q3** | **Do the 17 merged identities' names become governed terms for their targets?** | It expands the term set from 48 to 65 and is a knowledge-preservation judgement. | **Yes** — an operator who says "Multistage Centrifugal" should still be understood. |
| **Q4** | **Are the 282 Type identities "ratified" by M5R.4A?** M5R.4A §2 records them as *unratified* `CANDIDATE_EQUIPMENT_IDENTITIES`. | Determines whether a ratification dimension is needed on `equipment_types` — a second additive column, i.e. scope. | Do **not** add a ratification dimension in 019; treat ratification as a separate governance act. |
| **Q5** | **Does `Submersible Pump` become a canonical Type, or do rows 7 and 8 re-target to `Submersible Centrifugal Pump`?** | Engineering identity decision; M5R.4A is accepted and cannot be silently edited. | **Neither asserted here.** Reported as B1-2. |
| **Q6** | **Is the two-table design (D) preferred over the single XOR-subject table (D′)?** | It is a maintainability judgement with one fewer table at stake. | **D** — two subjects, two cardinalities, two lookup intents. |

---

## 20. Explicitly NOT done (mission §15)

No schema modification · **no migration 019** · no database mutation · no taxonomy mutation · no category or class creation, rename or consolidation · no bootstrap/seed mutation · no synonym implementation · no supersession implementation · no application or runtime change · no UI change · no API change · no crosswalk population · no standards evidence population · no decomposition architecture · no Equipment Family · no customer alias architecture · no M5R.4A reopen or edit · no M5R.4B2 · no M6 · no ATM-002 · PR #27 untouched at `a8511bcdbe41a40f4656ce79d1a6224d3d1e55cb` · no merge · no deployment · no Render change · no production database access.

**The only change made by this mission is the addition of this document.**
