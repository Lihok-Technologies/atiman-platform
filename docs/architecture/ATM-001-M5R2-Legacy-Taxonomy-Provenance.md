# ATM-001 M5R.2 / M5R.2A — Legacy Taxonomy Design Artifact Provenance

**Status:** Controlled provenance record. Updated by ATM-001 M5R.2A.
**Baseline:** `origin/main` = `434b84e1fb2c306b6c89acd69117aa74b385a592` (M5R.2 merged).
**Purpose:** To record durably what the legacy taxonomy design artifact is, who authors and owns it,
which copy is authoritative, and that it is **not** an ISO 14224 extract — so that no reader, tool or
future mission treats it as standards-derived equipment classification.

Superseding architecture: `ATM-001-M5R1-Equipment-Taxonomy-Architecture-Decision.md`.

---

## 1. Current artifacts and ownership

| Role | Path | Produced by | Consumed by |
|---|---|---|---|
| **Authoritative design artifact** | `database/odm_legacy_equipment_taxonomy_design.v1.json` | `database/generate_iso_taxonomy.py` (script-relative output) | `database/validate_taxonomy.py` (script-relative input) |
| **Generated seed copy** | `odm_seed/master_data/taxonomy.v1.json` | the **same** generator run — written from the same in-memory dataset | `import-iso-data.js` (`__dirname`), `odm_seed/verify_seed.py` (script-relative) |

Both files:

| Property | Value |
|---|---|
| sha256 | `cf7eece15c84c7fb7114b5470c209e30370d87803fef25d4d6a632ca21fd60be` |
| Bytes | 213,984 |
| Structural JSON | identical |
| Record counts | 10 categories · 42 classes · 60 types · 288 subunits · 376 maintainable items |

**The generator writes both outputs from one in-memory dataset**, so the design artifact and the seed
copy cannot silently drift apart. Before M5R.2A nothing enforced that identity.

### 1.1 What changed in M5R.2A

| Former path | Disposition | Reason |
|---|---|---|
| `iso14224_master_taxonomy.json` (root) | **REMOVED** | Orphan generator byproduct created only when the generator was run from the repository root. No consumer referenced it once paths were made deterministic. |
| `database/iso14224_master_taxonomy.json` | **RENAMED** → `database/odm_legacy_equipment_taxonomy_design.v1.json` | Content unchanged (same sha256). Filename no longer implies ISO extraction. |
| `odm_seed/master_data/taxonomy.v1.json` | **RETAINED** as an explicitly generated seed copy | Filename never falsely claimed ISO provenance, and it has a deterministic active consumer. |

**No active artifact filename now implies that ODM-authored content is an ISO extract.**

## 2. Path determinism

Before M5R.2A the generator and its consumers used **bare CWD-relative paths**, so which copy was read
or written depended on the caller's working directory. This was a latent silent-wrong-file hazard,
masked only because the duplicate copies happened to be byte-identical; had they diverged, the
validator would have silently validated the wrong file.

Path resolution is now fixed as follows:

| Tool | Resolution | Result |
|---|---|---|
| `database/generate_iso_taxonomy.py` | output paths derived from `__file__` | always writes both artifacts to their canonical locations, from any CWD |
| `database/validate_taxonomy.py` | input path derived from `__file__` | always validates the authoritative design artifact, from any CWD |
| `odm_seed/verify_seed.py` | path derived from `__file__` | always checks the seed copy, from any CWD |
| `import-iso-data.js` | `path.join(__dirname, …)` | already deterministic; **path untouched** in M5R.2A |

Verified by invoking the generator and both Python consumers from the repository root, from their own
script directories, and from an unrelated directory — all three produce identical targets and messages,
and no stray file is created in the caller's directory. A missing artifact now fails loudly with the
full resolved path rather than silently reading a different copy.

## 3. What this artifact is

A five-level **ODM-CMMS equipment taxonomy design**:

```
10 equipment_categories → 42 equipment_classes → 60 equipment_types
                        → 288 subunits → 376 maintainable_items
```

with authored `naming_conventions`, `future_addition_rules`, `consistency_rules`, `template_link_rule`,
`inspection_level_rule`, and an `odm_taxonomy_summary` section.

## 4. What this artifact is NOT

**It is not an ISO 14224 extract, and it makes no claim to ISO-defined equipment codes.** Verified:

| Check | Result |
|---|---|
| ISO 14224 equipment-class codes (`PU`, `CE`, `GT`, `HE`, `VE`, `TR`) | **0 occurrences** |
| Literal string `14224` anywhere in the file | **0 occurrences** |
| `iso_code` / `iso_ref` fields | **0** |
| Identifier scheme | `ECAT-nnn` / `ECLS-nnn` / `ETYPE-nnn` — **ODM-authored**, not ISO codes |
| Self-identifying marker | `odm_taxonomy_summary` present |

### Authorship is established by the generator

`database/generate_iso_taxonomy.py` is the artifact's **generator**, and running it reproduces the
committed artifact **byte-for-byte** (same sha256) — so the committed files are demonstrably genuine
generator outputs. Its header now states plainly that the dataset is ODM-authored and ISO 14224-
*informed* but **not** an ISO extract.

**No ISO endorsement, certification or conformance is implied by this artifact, and none may be
inferred from it.**

## 5. Status and standing

| Property | Value |
|---|---|
| Origin | ODM-CMMS legacy (pre-Atiman) |
| Nature | Design artifact — naming/consistency rules plus candidate equipment structure |
| Retained as | Historical and candidate **structural** material |
| Authoritative Atiman taxonomy? | **No** |
| Seeded into PostgreSQL? | **No** — no loader references it |
| Read by runtime (`src/`)? | **No** |
| Read by the PostgreSQL bootstrap? | **No** |
| Referenced by tests, CI or deployment? | **No** |
| Referenced by any `package.json` script? | **No** |
| Superseded as architecture by | `ATM-001-M5R1-Equipment-Taxonomy-Architecture-Decision.md` |

**Architectural status: SUPERSEDED.** These files carry **no architectural authority** and must not be
used as Atiman canonical taxonomy, as a standards mapping, or as evidence of ISO conformance.

## 6. Reading rule

Any reader encountering the former name `iso14224_master_taxonomy.json` — in history, in an old script,
or in an archived log — must treat it as a **legacy misnomer** for the ODM-CMMS design artifact now at
`database/odm_legacy_equipment_taxonomy_design.v1.json`. The content was ODM-authored, ISO 14224-
*informed* in concept only, contained no ISO-defined codes, and is superseded as Atiman architecture.

## 7. Remaining related debt (not addressed here)

| Item | Note |
|---|---|
| Legacy tool **filenames** still carry `iso` (`generate_iso_taxonomy.py`, `verify-iso-data.js`) | Renaming tool files changes legacy invocation contracts; deliberately out of M5R.2A scope |
| `verify-iso-data.js`, `add-inspection-items.js` still carry legacy ISO framing in headers | M5R.2A corrected only the wording of the tool that consumes this artifact |
| `add-inspection-items.js` reads `./odm_seed/master_data/default_inspection_items.json` via a **CWD-relative** path | Same class of defect as fixed here, but for a **different** artifact and therefore outside the legacy-**taxonomy** scope of M5R.2A |
| Legacy MySQL migrations under `database/migrations/` scatter `ISO14224-*` labels | Live-seed/migration territory; out of scope |
