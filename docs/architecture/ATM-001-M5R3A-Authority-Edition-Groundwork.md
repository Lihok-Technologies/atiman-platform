# ATM-001 M5R.3A — External Authority / Edition Groundwork

**Status: READINESS RECORD — EXISTING MODEL SUFFICIENT. NO SCHEMA CHANGE.**
**Not the crosswalk implementation.** No crosswalk table, external-classification entity, trigger, index,
API or mapping is created by this record. The M5R.3 architecture remains **APPROVED — NOT IMPLEMENTED**.

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

## 3. Identified gap — and why it is NOT implemented here

**Gap:** the **application layer deliberately cannot create a global source.**
`KnowledgeSource.createSource(input, { organizationId })` throws
`SOURCE_ORGANIZATION_REQUIRED` when `organizationId` is absent. This is **not an oversight** — M3
documents the boundary explicitly: *"shared reference provenance is a system/OWNER act, not a tenant
act."* A test already asserts this refusal.

**Therefore the genuinely missing piece is not code — it is an authorization decision:** *who* may
perform the system/OWNER act of registering a global external authority. M5R.3A must not pre-empt that,
because the approved architecture states that **no new authorization capabilities are created in V1**
(M5R.3 §AC, closed by M5R.3R). Adding a tenant-callable global-creation path would breach M3's boundary;
adding an unreachable model method would be dead code awaiting a decision.

**Recorded for M5R.3B/3C:** global authority registration requires a bounded authorization decision
(which capability, which actor) **before** the crosswalk can be populated. This is an input to the
crosswalk implementation, not a defect in the existing model.

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
| Who may register a global authority | **REMAINS — authorization decision** (§3 above) |

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
false-provenance remediation · no publication semantics · no new authorization capability · no second
standards registry · no standards text committed · no production access.

## 9. Implementation handoff

**M5R.3A is complete as a readiness step.** The next slice that depends on it:

| Slice | Content | Dependency on M5R.3A |
|---|---|---|
| **M5R.3B** | `external_classification` keyed to `knowledge_source_version_id` + edition-coherence trigger | requires the authority/edition foundation proven here |
| **M5R.3C** | Crosswalk + coherence/attribution CHECKs + immutability/supersession triggers + partial unique indexes + **mandatory global-source guard** | requires the global/tenant distinction proven here |
| — | **Authorization decision:** who may register a global authority (§3) | **must precede any crosswalk population** |
