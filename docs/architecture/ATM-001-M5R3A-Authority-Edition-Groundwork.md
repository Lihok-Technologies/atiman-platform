# ATM-001 M5R.3A — External Authority / Edition Groundwork

**Status: READINESS RECORD — EXISTING MODEL SUFFICIENT. NO SCHEMA CHANGE.**
**Not the crosswalk implementation.** No crosswalk table, external-classification entity, trigger, index,
API or mapping is created by this record. The M5R.3 architecture remains **APPROVED — NOT IMPLEMENTED**.

**Governance decision recorded (§3.2): global external authority / source registration IS a
system/OWNER-governed knowledge-administration operation, NOT ordinary tenant authoring.** The existing
`createSource()` refusal to create an application-level global source is **intentional and preserved —
not a defect**. This record creates **no new permission or capability** and changes **no authorization
code**; no tenant-callable global-authority creation API exists or is implied.

| | |
|---|---|
| Baseline | `origin/main` = `f82f9686ec2ab7a79276cb1bc5be6beb1fd3f1fa` (ATM-001 M5R.3 merged) |
| Approved architecture | `ATM-001-M5R3-Standards-Crosswalk-Architecture-Decision.md` (§I reuse decision) |
| Migration chain | 001–015 unchanged; **no 016** |
| Scope | One bounded task: establish and prove the authority/edition foundation only |

---

## 1. The primary question, answered

> *Can the existing `knowledge_sources` + `knowledge_source_versions` model already represent a global
> external authority and a specific authority/standard edition correctly under the approved M5R.3
> architecture?*

**YES — verified from code and proven on disposable PostgreSQL 17. No new schema is required.**

**Decision: `EXISTING MODEL SUFFICIENT` (M5R.3A Outcome A).** The M5R.3 §I reuse decision is correct as
written, and the "no second authority registry" constraint is satisfiable with zero schema change.

## 2. Verified contract (read from the implementation, not assumed)

### 2.1 Global authority — `knowledge_sources`

| Property | Verified behaviour |
|---|---|
| `organization_id IS NULL` | **is** the representation of a global/system source — stated in the constraint comment and confirmed by behaviour |
| `source_category` | CHECK permits exactly six values, **including `engineering_standard`** (also present in the model's `SOURCE_CATEGORIES`) |
| Identity stability | `UNIQUE NULLS NOT DISTINCT (organization_id, source_code)` — because `NULLS NOT DISTINCT` treats NULLs as equal, there is **exactly one global source per `source_code`**, while a tenant may reuse that code inside its own scope |
| Tenant visibility | `findSourceById(id, organizationId)` reads `(organization_id IS NULL OR organization_id = ?)` — **tenants can read global sources** |
| Identity lock | `knowledge_sources_identity_lock_check()` prevents `source_code`, `source_category` or `organization_id` from changing **once versions exist** |

### 2.2 Authority edition — `knowledge_source_versions`

| Property | Verified behaviour |
|---|---|
| Mandatory fields | `knowledge_source_id`, `version_designation`, `title` — **that is all** |
| Optional fields | `reference_number`, `issuing_organization`, `publication_date`, `effective_date`, `external_uri`, `content_sha256`, `uploaded_file_id`, `created_by_user_id` |
| Edition coexistence | `UNIQUE (knowledge_source_id, version_designation)` — a new edition is a **new row**, never a rewrite |
| Immutability | `immutable_source_version_check()` rejects **every** UPDATE; DELETE is blocked while any evidence references the version |
| No document required | all document-bearing columns are nullable, so provenance can be recorded **without possessing or uploading the standard** |

**Conclusion:** an external authority ("ISO") and one of its editions ("ISO 14224", edition 2016) are
fully representable as governed provenance — with bibliographic metadata only, and with edition history
protected by triggers that predate this mission.

## 3. Authority registration — the governance decision, recorded (not implemented)

### 3.1 What the application does today — verified, and intentional

`KnowledgeSource.createSource(input, { organizationId, userId })` throws `ProvenanceConflictError` with
code `SOURCE_ORGANIZATION_REQUIRED` when `organizationId` is absent, so the **application layer
deliberately cannot create a global source**. `findSourceById(id, organizationId)` still reads
`(organization_id IS NULL OR organization_id = ?)`, so tenants **read** global authority while being
unable to **create** it. A test asserts this refusal.

This asymmetry is **not a defect, not an oversight and not an incomplete implementation.** M3 documents
it explicitly: *"shared reference provenance is a system/OWNER act, not a tenant act."*

### 3.2 The decision (OWNER, recorded in this mission)

**GLOBAL EXTERNAL AUTHORITY / SOURCE REGISTRATION IS A SYSTEM/OWNER-GOVERNED KNOWLEDGE-ADMINISTRATION
OPERATION. It is NOT ordinary tenant authoring.**

The existing `createSource()` refusal to create an application-level global source is therefore **NOT a
defect to repair in M5R.3A. Preserve it.**

**M5R.3A creates no new permission or capability for it, and modifies no authorization code.** The
M5R.3 §AC closure (restated by M5R.3R) stands: **no new authorization capability is created in V1**.

### 3.3 The four-way distinction — these must not be conflated

| | Layer | State after M5R.3A |
|---|---|---|
| **A** | **Data-model capability** — can the database represent a global source? | **YES — PROVEN.** `organization_id IS NULL` is representable, tenant-distinguishable and uniqueness-constrained (§2.1, §7) |
| **B** | **Application authoring capability** — can a tenant create one through the application? | **NO — BY DESIGN, AND PRESERVED.** `createSource()` refuses; no tenant-callable global-creation path exists, and none is added |
| **C** | **Governance decision** — who is authorized to perform that system act? | **DECIDED THIS MISSION (§3.2)** — a system/OWNER knowledge-administration act, categorically distinct from tenant authoring |
| **D** | **Future implementation** — the executable OWNER mechanism | **NOT IMPLEMENTED. NOT IN THIS PR.** No service, route, capability, CLI or seed path is added by this slice |

**No tenant-callable global-authority creation API exists, and this record does not imply one.** A is not
B: the database's ability to represent a global authority is independent of the application's refusal to
let a tenant create one. C is not D: recording the governance decision is not building the mechanism that
executes it.

### 3.4 Consequence for M5R.3B / M5R.3C

**D is required before any crosswalk population**, because every crosswalk row carries
`knowledge_source_version_id` NOT NULL (M5R.3 §H). Until D exists there is **no application mechanism at
all** for registering a global authority; such rows can only come from a direct, governed system/OWNER
database operation outside the tenant authoring path. A tenant acting through the application still
cannot create one, and the crosswalk-level guard forbidding a **global crosswalk** from referencing a
**tenant-scoped** source or evidence (M5R.3 §R.1) remains mandatory and is still owed by M5R.3C.

## 4. Provenance is not a mapping — proven, not asserted

Registering an authority edition creates **no** crosswalk knowledge. Demonstrated factually:

- **No crosswalk relation exists in the schema.** `external_classification`,
  `equipment_type_external_classification` and `equipment_type_external_classification_evidence` are
  **absent** from `information_schema.tables` — M5R.3A implements no part of the architecture.
- **Registering an authority edition mutates no equipment taxonomy** — the `equipment_types` row count
  is unchanged across registration.
- **The legacy `iso_*` reference columns are not consulted.** No authority source may be derived from
  `activity_codes.iso_maintenance_reference` or `cause_codes.iso_failure_cause_reference`;
  `FALSE_PROVENANCE_REMEDIATION_REQUIRED` remains separate and **untouched**.

This directly guards against recreating the naive legacy model in which the mere presence of an
ISO-looking reference was treated as a mapping.

## 5. Copyright / licensing boundary

Only **bibliographic metadata** was used: authority, reference number, edition designation, title,
publication date, public URI. **No standard text, table, annex or document is copied, uploaded or
committed.** `uploaded_file_id` and `content_sha256` are deliberately **NULL** — Atiman holds no copy of
the standard, and recording the public *preview's* hash as though it were the standard's would be false
provenance. No standards database, no mirrored ISO content.

## 6. Global / tenant safety — what is guaranteed now, what remains

| Guarantee | State |
|---|---|
| A global source is representable and distinguishable from a tenant-scoped one | **GUARANTEED NOW** (proven) |
| Exactly one global source per `source_code` | **GUARANTEED NOW** (proven) |
| A global source cannot silently become tenant-scoped once it has editions | **GUARANTEED NOW** (proven) |
| Tenants can read global sources, but cannot create one via the application | **GUARANTEED NOW** (proven) |
| A **global crosswalk** must never reference a **tenant-scoped** source or evidence | **REMAINS FOR M5R.3C** — mandatory, non-omittable trigger recorded in M5R.3 §R.1 |
| The application refuses to create a global source even though the database can hold one | **GUARANTEED NOW** (proven) — and **INTENTIONAL, NOT A DEFECT** (§3.1) |
| Who may register a global authority | **DECIDED — a system/OWNER-governed knowledge-administration act** (§3.2), not tenant authoring |
| The executable OWNER registration mechanism | **NOT IMPLEMENTED — not in this PR** (§3.3 item **D**); must precede any crosswalk population |

The existing model provides the **foundation**; the crosswalk-level guard belongs to the crosswalk
implementation and is not claimed here.

## 7. Evidence

`tests/external-authority-edition-groundwork.test.js` — **17 tests**, disposable PostgreSQL 17,
proving: global-source existence · `engineering_standard` validity · identity stability across all
three locked columns · duplicate global identity rejection · tenant/global distinguishability ·
read-includes-global but create-refuses-global · edition row · edition coexistence · duplicate edition
rejection · edition immutability · evidence-referenced edition undeletable · no document required ·
representative authority metadata round-trip · no crosswalk relation exists · taxonomy unmutated ·
legacy labels not consulted · multiple editions per authority.

Registered in the sanctioned integration suites and in the database-test-guard lists.

## 8. Explicit non-goals

No migration 016 · no modification to migrations 001–015 · no `external_classification` · no crosswalk
or crosswalk-evidence tables, triggers or indexes · no mapping population · no mapping of any equipment
Type to ISO · no taxonomy reconciliation (282 or 60) · no decomposition · no customer aliases · no
false-provenance remediation · no publication semantics · no new authorization capability · no
authorization-code change · no OWNER global-registration mechanism (the governance decision is recorded,
the mechanism is not built) · no tenant-callable global-source creation · no second standards registry ·
no standards text committed · no production access.

## 9. Implementation handoff

**M5R.3A is complete as a readiness step.** The next slice that depends on it:

| Slice | Content | Dependency on M5R.3A |
|---|---|---|
| **M5R.3B** | `external_classification` keyed to `knowledge_source_version_id` + edition-coherence trigger | requires the authority/edition foundation proven here |
| **M5R.3C** | Crosswalk + coherence/attribution CHECKs + immutability/supersession triggers + partial unique indexes + **mandatory global-source guard** | requires the global/tenant distinction proven here |
| — | **OWNER registration mechanism** executing the §3.2 decision (four-way item **D**) | governance decision **C** is recorded here; the executable mechanism is **NOT implemented** — **required before any crosswalk population** |
