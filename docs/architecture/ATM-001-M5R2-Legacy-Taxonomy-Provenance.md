# ATM-001 M5R.2 — Legacy Taxonomy Design Artifact Provenance

**Status:** Controlled provenance record. Issued by ATM-001 M5R.2.
**Baseline:** `origin/main` = `686acbb3fdabca762fd13eb5a14cd8ffdadee87e`.
**Purpose:** To record durably, and adjacent to the artifacts themselves, that the legacy taxonomy
design files listed below are **ODM-CMMS-authored design material** and **not** ISO 14224 extracts —
so that no reader, tool or future mission treats them as standards-derived equipment classification.

This record exists because JSON cannot carry comments without either invalidating the file or altering
consumers. It is the controlled documentation that accompanies the artifacts.

Superseding architecture: `ATM-001-M5R1-Equipment-Taxonomy-Architecture-Decision.md`.

---

## 1. The artifacts

Three **byte-identical** copies:

| Path | sha256 | Bytes |
|---|---|---|
| `iso14224_master_taxonomy.json` | `cf7eece15c84c7fb7114b5470c209e30370d87803fef25d4d6a632ca21fd60be` | 213,984 |
| `database/iso14224_master_taxonomy.json` | `cf7eece15c84c7fb7114b5470c209e30370d87803fef25d4d6a632ca21fd60be` | 213,984 |
| `odm_seed/master_data/taxonomy.v1.json` | `cf7eece15c84c7fb7114b5470c209e30370d87803fef25d4d6a632ca21fd60be` | 213,984 |

## 2. What these artifacts are

A five-level **ODM-CMMS equipment taxonomy design**, structured as:

```
10 equipment_categories → 42 equipment_classes → 60 equipment_types
                        → 288 subunits → 376 maintainable_items
```

with authored `naming_conventions`, `future_addition_rules`, `consistency_rules`, `template_link_rule`,
`inspection_level_rule`, and an `odm_taxonomy_summary` section.

## 3. What these artifacts are NOT

**They are not an ISO 14224 extract, and they make no claim to defined ISO equipment codes.**

Verified checks:

| Check | Result |
|---|---|
| ISO 14224 equipment-class codes (`PU`, `CE`, `GT`, `HE`, `VE`, `TR`) | **0 occurrences** |
| Literal string `14224` anywhere in the file | **0 occurrences** |
| `iso_code` / `iso_ref` fields | **0** |
| Identifier scheme | `ECAT-nnn` / `ECLS-nnn` / `ETYPE-nnn` — **ODM-authored**, not ISO codes |
| Self-identifying marker | `odm_taxonomy_summary` present |

### Authorship is established by the generator

`database/generate_iso_taxonomy.py` is the artifact's **generator**. Its own header states:

> "ISO 14224 Master Equipment Taxonomy Generator for **ODM-CMMS** / Generates complete seed dataset
> **aligned to** ISO 14224 standard"

"Aligned to" is the generator's own wording. The artifacts are therefore **ODM-CMMS-authored and
ISO-*inspired***. The filename's `iso14224_` prefix asserts a provenance the content does not have.

**No ISO endorsement, certification or conformance is implied by these artifacts, and none may be
inferred from them.**

## 4. Status and standing

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

**Architectural status: SUPERSEDED.** Atiman's canonical equipment identity architecture is decided in
the M5R.1 record. These files carry **no architectural authority** and must not be used as Atiman
canonical taxonomy, as a standards mapping, or as evidence of ISO conformance.

## 5. Known consumers (why the filenames were not changed)

Dependency analysis found no product, runtime, bootstrap, test, CI or deployment dependency — but four
legacy standalone tools do reference these paths:

| Consumer | Reference |
|---|---|
| `database/generate_iso_taxonomy.py` | **writes** `iso14224_master_taxonomy.json` (bare relative path) |
| `database/validate_taxonomy.py` | **reads** `iso14224_master_taxonomy.json` (bare relative path) |
| `odm_seed/verify_seed.py` | reads `master_data/taxonomy.v1.json` |
| `import-iso-data.js` | reads `odm_seed/master_data/taxonomy.v1.json` (an import path) |

Because the two Python tools use **bare relative filenames**, which copy they read depends on the
working directory. Copy ownership between the root and `database/` copies is therefore ambiguous.

Consequently the filename correction and duplicate consolidation were **deferred**: renaming would
change a generator's output contract while leaving the ambiguous copy in place, and consolidating to a
single copy cannot be proven safe. See §11.2 of the M5R.1 record for the full reasoning.

**Recommended future remedy (not executed):** give the tools explicit, script-relative paths, then
rename to a non-ISO-implying name such as `odm_legacy_equipment_taxonomy_design.v1.json` and reduce to
one authoritative copy. This requires an OWNER decision because it changes legacy tooling behaviour.

## 6. Mandatory reading rule

Until the remedy in §5 is executed, any reader encountering a file named `iso14224_master_taxonomy.json`
**must** treat the name as a legacy misnomer and consult this record. The artifact is ODM-CMMS design
material that is *aligned to* ISO 14224 in concept only, contains no ISO-defined codes, and is
superseded as Atiman architecture.
