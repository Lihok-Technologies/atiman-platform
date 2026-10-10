# ATM-001-KF-03 — Knife Gate Valve Engineering Evidence Adjudication

**Document ID:** ATM-001-KF-03
**Mission:** ATM-001-KF-FINAL — Knowledge Foundation V1 completion (workstream KF-03)
**Status:** Investigation and adjudication record. **Authorises no authoring, no approval, no publication and no purchase.**
**Baseline:** `origin/main` = `f156aa4479efe783eefd4f13fd62171647f83b7f`
**Pilot:** equipment type **21** (`KNIFE`, "Knife Gate Valve"); legacy template **1217** (`KNIFE_INSPECTION`).
**Governing policy:** `ATM-001-M6.4-Knowledge-Source-And-Evidence-Policy.md` (OWNER-ratified) — §2, §3, §4, §4.1, §6, §7, §8, §11.
**Predecessor:** `ATM-001-KF-02-Knife-Gate-Valve-Evidence-Qualification.md` (verdict `NO_ADMISSIBLE_ENGINEERING_EVIDENCE`).
**Outcome:** **`NO_ADMISSIBLE_ENGINEERING_EVIDENCE` (UPHELD).** See §5.

---

## 1. Purpose and boundary

KF-02 qualified the source landscape and concluded that no admissible engineering evidence exists today
to author a publishable, evidence-backed Knife Gate Valve inspection procedure. KF-03 re-opens the
question against the **current** revision and asks whether anything changed.

**Boundary.** Repository evidence only. This mission did **not** purchase a document, circumvent a
paywall, retrieve a publisher catalogue, contact a supplier, read a production database, or establish
any engineering value. It changes no code, schema, migration, capability or test. No value asserted in
KF-02 was re-derived from memory: every fact below was re-verified in the repository at this baseline.

**What would change the outcome** is a *new admissible source plus an accountable qualified review*, not
more analysis. §6 records the exact gates.

---

## 2. Pilot identity re-verified at this baseline

| Field | Value (re-verified) | Source |
|---|---|---|
| Equipment type id | **21** | `scripts/bootstrap-knowledge/equipment_types.jsonl` row 21 |
| Code / name | `KNIFE` / "Knife Gate Valve" | same |
| Parent class | 14 (Gate Valve) | same |
| Description / component hint | "Gate valve for slurry applications" / "Body, sharp gate, stem, actuator, wiper" | same |
| M5R.4A disposition | `RECLASSIFY` → proposed Category "Valve", Class "Isolation Valve"; identity kept | `docs/research/m5r4a/equipment-type-reconciliation.jsonl` row 21 |
| M5R.4A evidence recorded for that disposition | **`"NONE — no standards evidence available (crosswalk unpopulated; legacy iso_* fields are FALSE_PROVENANCE)"`** | same |
| Legacy template | **1217** `KNIFE_INSPECTION` "Knife Gate Valve - Inspection" | `scripts/bootstrap-knowledge/task_templates.jsonl` row 118 |
| Legacy steps | **5** (ids **3651–3655**), step_no 1–5 | `scripts/bootstrap-knowledge/task_template_steps.jsonl` rows 418–422 |
| Related legacy templates | **1218** `KNIFE_SAFETY_CHECK` (3 steps), **1219** `KNIFE_TESTING` (3 steps) | same file, rows 119–120 |
| Declared frequency | 1 / month / 60 minutes on all three — `GENERATED_DEFAULT`, no engineering basis | `docs/research/m6r1/maintenance-procedure-reconciliation.jsonl` rows 118–120 |
| M6R1 rubric | **`Reject`** — D1 pass, D2 pass, **D3 fail (0 acceptance criteria)**, **D4 fail (0 safety content)**, **D5 fail (generated default)** | same |
| Disposition | `TRANSFORM_CONTENT` (revision candidate, **not** approved knowledge) | same |
| Provenance availability | `false` — 0 evidence rows; no published version exists for any template | same |
| Manufacturer / model / serial | **NOT ESTABLISHED anywhere in the repository** | §3 |

The five legacy steps concern, verbatim in substance: the knife-edged gate and body liner; the packing
gland, lantern ring and scrape ring; gate travel alignment in the guides; actuator thrust, limit switches
and position feedback; and the bottom bonnet or purge port. They carry **no acceptance criteria, no safety
content and no evidence-backed interval**.

**They also mix feature families that do not coexist on every knife gate design** (a packing gland with a
lantern ring and a body liner/bonnet-purge arrangement are absent from e.g. elastomer-sleeve slurry
designs). A single procedure cannot therefore be asserted as Type-wide evidenced knowledge — this is the
same point that engages the M6.4 **G2** granularity debt.

---

## 3. Asset identity and asset-register evidence

| Question | Finding |
|---|---|
| Is any `equipment` (asset) row linked to type 21 in the repository? | **No.** There is no equipment seed file in `scripts/bootstrap-knowledge/` and no repository artifact binds an asset to `equipment_type_id` 21 |
| Is a manufacturer, model, size, seat/sleeve type or actuator type recorded anywhere? | **No** |
| Is an asset register, tag or isolation/process datum available? | **No** in the repository; production asset data was **not accessed** |
| Can a matching OEM document be *selected* without that identity? | **No** — selection would be a guess, and M6.4 §4/§6 forbid guessing applicability |

`equipment` can carry `manufacturer`, `model` and `serial_number` (migration 002); the point is that
**no repository artifact populates them for this pilot**. Equipment type 21 is a generic taxonomy
identity, not an asset.

---

## 4. Source adjudication at this baseline

KF-02's register (§5) is the substantive source qualification and remains the operative analysis. Its
outcome, restated for adjudication:

| Class | Sources | Adjudication |
|---|---|---|
| **A — ADMISSIBLE** | **None** | nothing is admissible to author knife-gate specific content |
| **B — CONDITIONALLY ADMISSIBLE** | M1–M9 (authentic OEM IOMs; DeZURIK, Bray, Valmet, ORBINOX, VAG, HAWLE, POLIX) | each is blocked by (i) unresolved make/model, (ii) unresolved rights (G1), (iii) required accountable SME review; and each is strictly **model-specific** |
| **C — REFERENCE_ONLY** | S1–S5 (MSS SP-81/SP-151/SP-135, AWWA C520, USBR FIST 4-1A) | authoritative context exist; paywalled/DRM or internal-use, none is task-level instruction |
| **D — REJECTED** | U1–U3; the legacy corpus; AI output | unverifiable, or expressly non-establishing under M6.4 §2/§3/§6 |

**Repository-registered sources at this baseline:**

| Registry | Contents | Applicability to this pilot |
|---|---|---|
| `docs/research/m5r/sources.jsonl` | 4 candidates (ISO 14224:2016, IEC 81346-1:2022, ISO 20816-1:2016, ISO 10816 series) | **Every entry carries `establishes_maintenance_tasks: false`.** They establish taxonomy, structuring and vibration-measurement concepts — none establishes a knife gate valve inspection task |
| `docs/research/m5r/excluded-sources.jsonl` | `EXCL-001` proprietary tenant SMP material; `EXCL-002` legacy taxonomy; `EXCL-003` the 846-template/3,099-step bootstrap corpus | excluded by ratified decision; not evidence |
| Production `knowledge_sources` registry | recorded only as existing out of band | **not verifiable in this mission**; no production access; recorded as unresolved, never assumed |

**No new admissible evidence was found in the repository at this baseline, and none was created.**

---

## 5. Adjudication outcome

# `NO_ADMISSIBLE_ENGINEERING_EVIDENCE` — UPHELD

For the bounded purpose of authoring a publishable, evidence-backed Knife Gate Valve inspection procedure
for equipment type 21 today, **no candidate source is admissible**. This is a valid adjudicated outcome,
not an investigation failure.

**Precise blocker, in priority order:**

1. **Asset identity unresolved (G-A).** The pilot valve's manufacturer, model, size, seat/sleeve type and
   actuator type are not established anywhere in the repository. Without them no manufacturer- or
   model-specific document can be selected, and the OEM evidence proves generalisation would be
   engineering error — the examined designs prescribe materially different regimes, two prescribe no
   calendar interval at all.
2. **Rights / licence status unresolved (G-B/G-C, the M6.4 §11 G1 gate).** M6.4 §4 makes rights a
   precondition for storage, reproduction, derivation and redistribution. The standards are paywalled
   and the OEM manuals range from "all rights reserved" to "no notice observed" (which is **not**
   permission). **The G1 trigger is live for this pilot now.**
3. **No applicable registered source** exists in the repository (`establishes_maintenance_tasks: false`
   for every registered entry).
4. **Acceptance criteria, safety content, intervals, torque, and pressure/temperature limits remain
   unresolved.** M6.4 §6 forbids AI from establishing any of them; M6.4 §8 permits accountable
   qualified-human derivation with recorded rationale, which has not occurred.

**M6.4 restrictions preserved:** nothing in this record promotes reference-only material into approved
engineering authority; no OEM applicability, inspection limit, safety requirement, maintenance interval,
acceptance criterion or licence permission is asserted; **G1** and **G2** remain in force.

---

## 6. Exact conditions that would change the outcome

| Gate | Required action | Owner |
|---|---|---|
| **G-A — Asset identity** | Establish manufacturer, model, size, seat/sleeve type, actuator type and service conditions from a tenant asset register or an authorized customer engineering source | Tenant engineering / Knowledge Steward |
| **G-B — Rights adjudication (G1)** | Decide, per M6.4 §4.1, whether the specific matching OEM manual may be stored, quoted, paraphrased and derived from, and record that status | OWNER (governance) |
| **G-C — Standard licensing** | If a standard is to be relied on, lawfully obtain it and record the licence terms. KF-02 identifies the acceptance-criteria basis as **MSS SP-151:2021** and, for high-pressure designs, **ANSI/MSS SP-135:2021+ERRATA:2022** | OWNER (procurement / governance) |
| **G-D — Qualified derivation** | A qualified engineer/SME performs accountable authoring: selects the matching OEM document, derives steps, states criteria only where the source states them, records rationale for anything SME-derived | Qualified engineer / SME |
| **G-E — Safety review** | Safety content and controls are authored under the M1 safety-attestation model **with an attributed safety review by a separate principal** | Safety reviewer |
| **G-F — Interval policy** | Assert a trigger only with an admissible basis; otherwise use the governed `no_fixed_interval` state | Knowledge Steward |

KF-03 performed none of these. **KF-03 must not start automatically and requires architectural review and
OWNER authorization.**

---

## 7. Effect of current software work on this adjudication

The KF-04A published-knowledge resolver (PR #81) and the KF-04B attribution design change **what the
platform can do** with admissible knowledge. They do **not** create any. The adjudication is unchanged:
the platform can now serve and (once approved) attribute immutable published versions, but a Knife Gate
Valve procedure still cannot be authored, approved or published without G-A … G-F.

This is the intended separation: **software readiness does not manufacture engineering evidence**, and
`Evidence Before Assumption` forbids closing that gap by inference.

---

## 8. Non-actions

No document purchased, no paywall circumvented, no third-party document stored, no production access, no
authoring, approval or publication, no engineering value established, no code/schema/migration/capability/
test change, no PR #27 change.
