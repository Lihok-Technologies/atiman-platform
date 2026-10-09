# ATM-001-KF-02 — Knife Gate Valve Engineering Evidence Qualification

**Document ID:** ATM-001-KF-02
**Mission:** ATIMAN-KF-01/02 — Knowledge Foundation Closure and Engineering Evidence Qualification
**Status:** Investigation and evidence-qualification record. **Authorises no authoring, no approval, no publication.**
**Revision:** 1.1 — adversarial corrections applied (see §11.3)
**Pilot:** Atiman equipment type **21** (`KNIFE`, "Knife Gate Valve"); legacy template **1217** (`KNIFE_INSPECTION`).
**Governing policy:** `ATM-001-M6.4-Knowledge-Source-And-Evidence-Policy.md` (OWNER-ratified) — §2, §3, §4, §4.1, §7, §8, §11.
**Repository baseline:** `origin/main` = `988fbb99f31737dbc8f6050511964091e7962ce0`
**Investigation date:** 2026-10-10
**Qualification outcome:** **`NO_ADMISSIBLE_ENGINEERING_EVIDENCE`** for authoring a publishable, evidence-backed Knife Gate Valve inspection procedure today. See §9.

---

## 1. Purpose, method and boundary

This record qualifies whether credible, admissible engineering evidence exists to support a **new,
engineering-authored** Knife Gate Valve inspection procedure for equipment type 21 — and, where it does
not, states precisely which prerequisite is missing rather than filling the gap with assumption.

Method, in order:

1. Inspect the repository for the pilot's knowledge, taxonomy identity and any registered sources (§3).
2. Read the ratified evidence policy and apply its admissibility classes (§2).
3. Locate candidate external sources and **verify each one directly** — every source below was either
   downloaded and inspected locally, or verified on the publisher's own catalogue page. Search-engine
   summaries were treated as leads only, never as evidence.
4. Classify every candidate (ADMISSIBLE / CONDITIONALLY ADMISSIBLE / REFERENCE_ONLY / REJECTED) and
   separate **source authenticity** from **engineering applicability** (§6, §7).
5. Record unresolved values as unresolved (§8).
6. Submit every source claim and the conclusion to **separate-context adversarial falsification** (§11).

**Boundary.** This record does not author, transform, approve or publish knowledge; does not purchase
documents; does not reproduce substantial copyrighted text; does not store any third-party document in
the repository; and does not establish any engineering value. No application code, schema, migration,
capability or test was changed.

---

## 2. The governing admissibility rules (applied, not restated)

| Rule | Source | Application here |
|---|---|---|
| Admissible classes: regulatory sources; OEM/manufacturer technical sources; recognized engineering and safety standards and codes; authorized customer engineering sources; organization-approved procedures; accountable qualified SME authorship; Atiman-authored content reviewed by qualified humans | M6.4 §4 | Candidate classes used in §5 |
| **Rights and licensing govern what source material may be stored, reproduced, derived from, or redistributed** | M6.4 §4 | Every candidate carries a licensing finding |
| Legacy-generated content and AI output are **NOT establishing evidence** | M6.4 §4, §6 | Legacy template 1217 is a reference aid only (§3.2) |
| Rights/licence status is **not structurally represented** (G1) and "must be resolved before the first procedure is authored from a licensed standard or a customer-supplied document whose rights are not already established" | M6.4 §11 | G1 is a live gate for this pilot (§9) |
| An **asserted** trigger requires an admissible basis (`trigger_basis_source_version_id`); otherwise use the governed **`no_fixed_interval`** state | M6.4 §7 | No interval may be invented; see §8 |
| Acceptance criteria require admissible evidence **or** accountable qualified-human derivation with recorded rationale; `UNKNOWN` is preferable to fabricated precision | M6.4 §8 | See §8 |
| AI **MUST NOT** autonomously establish engineering correctness, safety controls, triggers/intervals, acceptance criteria, Equipment-Type applicability, source authority, or approval | M6.4 §6 | This record deliberately establishes none of these |

---

## 3. Repository knowledge investigation

### 3.1 The pilot equipment identity

| Field | Value (verified in repository) | Source |
|---|---|---|
| Atiman equipment type id | **21** | `scripts/bootstrap-knowledge/equipment_types.jsonl` row 21 |
| Code / name | `KNIFE` / "Knife Gate Valve" | same |
| Parent class | 14 (Gate Valve) | same |
| Description | "Gate valve for slurry applications" | same |
| Component hint | "Body, sharp gate, stem, actuator, wiper" | same |
| M5R.4A disposition | **`RECLASSIFY`** — proposed Category "Valve", Class "Isolation Valve", canonical name kept | `docs/research/m5r4a/equipment-type-reconciliation.jsonl` row 21 |
| M5R.4A evidence noted for that disposition | **"NONE — no standards evidence available (crosswalk unpopulated; legacy `iso_*` fields are FALSE_PROVENANCE). Decision rests on Atiman engineering semantics."** | same |
| Manufacturer / model / serial | **NOT ESTABLISHED anywhere in the repository** | see §3.4 |

**Consequence.** Equipment type 21 is a **generic taxonomy identity**, not an asset. The `equipment`
table can carry `manufacturer`, `model` and `serial_number` (migration 002), but **no seed, fixture or
script links any equipment row to `equipment_type_id` 21** — verified by search; the seeded equipment are
unrelated samples. The make and model of any physical knife gate valve the pilot intends to inspect are
therefore **unresolved**, and no repository artifact resolves them.

### 3.2 The legacy template is reference material only

| Field | Value | Source |
|---|---|---|
| Template id / code / name | **1217** / `KNIFE_INSPECTION` / "Knife Gate Valve - Inspection" | `scripts/bootstrap-knowledge/task_templates.jsonl` row 118 |
| Task kind / maintenance type | inspection / preventive | same |
| Declared frequency | 1 / `month` / 60 minutes — recorded as **`GENERATED_DEFAULT`** with no engineering basis | M6R1 record, `docs/research/m6r1/maintenance-procedure-reconciliation.jsonl` |
| Steps | **5** (ids 3651–3655) — see below | `scripts/bootstrap-knowledge/task_template_steps.jsonl` rows 418–422 |
| M6R1 rubric verdict | **`Reject`** — D1 pass (5/5 type-specific), D2 pass (imperative), **D3 fail (0 acceptance criteria)**, **D4 fail (0 safety content)**, **D5 fail (generated default interval)** | same |
| Disposition | `TRANSFORM_CONTENT` = accountable-authoring/revision candidate, **not** approved knowledge | M6.4 §3 |
| Provenance availability | `false` — 0 evidence rows; "bootstrap never writes the evidence tables; no published version exists for any template" | same |

The five legacy steps (paraphrased, as legacy text only) concern: the knife-edged gate and body liner;
the packing gland, lantern ring and scrape ring; gate travel alignment in the guides; actuator thrust,
limit switches and position feedback; and the bottom bonnet or purge port.

Two observations matter for source matching, and both are *negative* findings about applicability:

- The step set mixes **feature families that belong to different valve designs** (a packing gland with a
  lantern ring and a body liner/bonnet-purge arrangement are not present on every knife gate design —
  e.g. elastomer-sleeve slurry designs have no packing gland at all).
- The five steps contain **no** acceptance criteria, **no** safety content and **no** evidence-backed
  interval. They therefore cannot supply D3/D4/D5 under any reading.

Related legacy templates also exist for this type: **1218** `KNIFE_SAFETY_CHECK` and **1219**
`KNIFE_TESTING` (same generated-default metadata). They are likewise legacy reference material.

### 3.3 Registered sources

| Registry | Contents | Applicability to this pilot |
|---|---|---|
| Repository research registry `docs/research/m5r/sources.jsonl` | 4 candidates, all `TIER2_RECOGNIZED_STANDARD`: ISO 14224:2016, IEC 81346-1:2022, ISO 20816-1:2016, ISO 10816 series | **None establishes maintenance tasks** — every entry carries `establishes_maintenance_tasks: false`; they establish taxonomy, structuring and vibration-measurement concepts. **Not evidence for a knife gate valve inspection procedure.** |
| Excluded material `docs/research/m5r/excluded-sources.jsonl` | `EXCL-001` proprietary tenant SMP material; `EXCL-002` legacy taxonomy; `EXCL-003` the 846-template bootstrap corpus | Excluded by ratified decision; not evidence |
| Production `knowledge_sources` registry | The closure ledger records global/system sources created out-of-band (`organization_id IS NULL`) | **Not verifiable in this mission** — production database access was not available/authorised; no repository artifact records their identity or applicability. Recorded as unresolved, not assumed. |

**No registered engineering source applicable to knife gate valve maintenance tasks exists in the
repository.**

### 3.4 What the repository does *not* establish

- The **make/model** of the pilot valve.
- Any **asset register** entry (site-specific data) for type 21.
- Any **crosswalk/standards classification** for type 21 (M5R.4A: "NONE").
- Any **evidence row** for template 1217 (0 rows; no published version).

---

## 4. External source investigation and verification method

Each candidate below was verified by **direct retrieval or direct catalogue inspection**, not by search
summary:

- PDFs were downloaded to a temporary directory (never into the repository) and their **embedded
  metadata, page count and internal terminology** were extracted locally.
- Standards were verified on a **publisher/distributor catalogue page** (title, abstract/scope, page
  count, publication date, supersession, format and price).
- Sources that could not be retrieved were recorded as **not verified** and were given no evidentiary
  weight (§5, Group 5).

Rights were assessed from what the document or catalogue itself states (copyright notices, "all rights
reserved", internal-use statements, DRM/licence terms). Where a document carries **no** notice, that is
recorded as *"no notice observed"* — never as "no rights". **No document was purchased, no paywall was
circumvented, and no third-party document was stored in the repository.**

---

## 5. Candidate source register

Legend for **Class**: A = ADMISSIBLE · B = CONDITIONALLY ADMISSIBLE · C = REFERENCE_ONLY · D = REJECTED.

### Group 1 — Recognized engineering standards (knife gate valves)

| # | Source title | Publisher | Document identifier | Revision / date | Location | Equipment applicability | Manufacturer / model applicability | Engineering relevance | Safety relevance | Evidence limitations | Licensing / redistribution | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | *Stainless-Steel or Stainless-Steel-Lined, Bonnetless, Knife Gate Valves with Flanged Ends (Incl. 2022 Errata Sheet)* — note: the NSAI catalogue lists the title without the errata parenthetical, while the MSS publisher page includes it | Manufacturers Standardization Society (MSS), TC 409 | **MSS SP-81:2021** | Catalogue published date **01-01-2022**; the MSS publisher page states **January 31, 2022** (source conflict recorded, not resolved); supersedes SP-81:2017 | Publisher catalogue + distributor catalogue (verified); document paywalled | Knife gate valves, bonnetless, stainless or stainless-lined, flanged, **NPS 2–36** | **None** — applies by valve construction, not by make/model | Design, materials, dimensional and testing requirements for a scoped construction family | Partial — assumes a valve within scope; does not cover site isolation practice | **Content not inspectable without purchase**; 14 pages; no clause text verified; no maintenance-task or interval content verifiable | Paywalled, DRM PDF; **may not be reproduced or stored** without a licence | **C** |
| S2 | *Pressure Testing of Knife Gate Valves* | Manufacturers Standardization Society (MSS), TC 409 | **MSS SP-151:2021** | Published **21-01-2021**; supersedes MSS SP 151:2016 | Publisher/distributor catalogue (verified); document paywalled | "resilient, non-metallic (e.g. ceramic), and metal-to-metal seated **knife gate valves of all types**" | **None** — applies by construction type, not by make/model | **The identified standards basis for acceptance criteria**: scope states it "establishes requirements and **acceptance criteria** for shell and seat closure pressure testing" | Partial — pressure-test safety is implicit in the test regime; no task-level safety instructions | **Content not inspectable without purchase**; 14 pages; no clause text, test pressures or acceptance values verified | Paywalled, DRM PDF; **may not be reproduced or stored** without a licence | **C** |
| S3 | *High Pressure Knife Gate Valves (Incl. 2022 Errata Sheet)* | Manufacturers Standardization Society (MSS), TC 114 | **ANSI/MSS SP-135:2021+ERRATA:2022** | Published **01-02-2022**; supersedes ANSI/MSS SP-135:2021 | Publisher/distributor catalogue (verified); document paywalled | Wafer- and flange-type knife gate valves made from ASME Code materials, meeting applicable gate valve requirements of ASME B16.34 | **None** — applies by construction/material class | Construction requirements for high-pressure knife gate valves | Not established from the abstract | **Content not inspectable without purchase**; 19 pages | Paywalled, DRM PDF; **may not be reproduced or stored** without a licence | **C** |

### Group 2 — Recognized engineering standards (water/wastewater knife gate valves)

| # | Source title | Publisher | Document identifier | Revision / date | Location | Equipment applicability | Manufacturer / model applicability | Engineering relevance | Safety relevance | Evidence limitations | Licensing / redistribution | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S4 | *Knife Gate Valves, Sizes 2 In. (50 mm) Through 96 In. (2,400 mm)* | American Water Works Association (AWWA) | **ANSI/AWWA C520:2024** | Published 2024-10-01; supersedes C520:2019 | Publisher catalogue (verified); document paywalled | Bonneted and bonnetless, cast and fabricated steel, stainless-steel and cast ductile-iron body knife gate valves with resilient or metal seats, including tapping valves, for water/wastewater/reclaimed systems; catalogue abstract states pH 6–12 and temperature 0.6–52 °C | **None** — applies by construction/service class, not by make/model | Purchase, design, testing, installation and commissioning requirements for the scoped class | Partial — states a service envelope; does not supply task-level safety instructions | **Content not inspectable without purchase**; 36 pages; no clause text verified; no maintenance-task content verifiable | Paywalled, DRM PDF; **may not be reproduced or stored** without a licence | **C** |

> **Note on a possible trap.** S4's stated service envelope (pH 6–12, 0.6–52 °C) is a **standard's scope
> condition**, not a statement about the pilot valve. It must not be copied into a procedure as the
> equipment's allowable limits. The same caution applies to every catalogue abstract.

### Group 3 — Government engineering guidance

| # | Source title | Publisher | Document identifier | Revision / date | Location | Equipment applicability | Manufacturer / model applicability | Engineering relevance | Safety relevance | Evidence limitations | Licensing / redistribution | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S5 | *Facilities Instructions, Standards, and Techniques, Volume 4-1A — Maintenance Scheduling for Mechanical Equipment* | U.S. Department of the Interior, **Bureau of Reclamation** | **FIST 4-1A** | **Current edition verified: Revision 3.0 (01/2026), 200 pages.** The earlier **May 2024 edition (208 pages, FIST 029, 05/29/2024) is superseded** | Publicly downloadable PDFs (both editions verified locally by download and text extraction) | Valves as a general equipment class within Reclamation water/power facilities; the valve taxonomy named in the document is **butterfly, hollow-jet and turbine pressure-relief** | **None** | General preventive-maintenance scheduling practice and indicative intervals (e.g. valve visual inspection and exercising entries) expressed as **"Reclamation Practice"** | General facility safety practice; not valve-model-specific | **Both editions contain zero occurrences of "knife" and zero of "gate valve"**; intervals are agency practice, not manufacturer requirements; not applicable to a specific proprietary valve | **No copyright notice, © or "all rights reserved" observed** in either edition — but the document carries its own **Disclaimer** page stating the material is "general information **for internal use only by Bureau of Reclamation operations and maintenance staff**", plus a non-endorsement statement. Rights are therefore **not established for redistribution**, and a formal reuse determination (M6.4 §4.1) is required before storage or derivation | **C** — general programme context only; **not** admissible for knife-gate-specific task content |

### Group 4 — OEM / manufacturer technical documents (verified genuine, model-specific)

All documents in this group were downloaded and inspected locally (embedded metadata, page count and
internal terminology verified). All are **model-specific installation/operation/maintenance documents**.
**Every one of them states maintenance frequencies that are specific to its own model and size** (§5
Group 4 notes and §8), which is precisely why none can be generalised.

| # | Source title | Publisher | Document identifier | Revision / date | Location | Equipment applicability | Manufacturer / model applicability | Engineering relevance | Safety relevance | Evidence limitations | Licensing / redistribution | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M1 | *DeZURIK KSV & KSV SBD (Short Body Design) Severe Service Knife Gate Valves — Instruction* | DeZURIK, Inc. (Sartell, MN, USA) | **D11021** | Instruction dated September 2026; 17 pages; PDF metadata 2026-09-10 | Manufacturer public download (verified locally) | Knife gate valve, severe service | **Model-specific: KSV / KSV-SBD only** | Installation, operation and maintenance instructions; scraper and purge-port terminology (matching several legacy step features); bolt torque table (Table A) | Warnings and cautions present | Applicable only to that model; **no calendar maintenance interval observed**; torque values are model/size-specific | © notice observed; **no "all rights reserved"** statement observed in the extractable text | **B** |
| M2 | *DeZURIK KGC-MD Knife Gate Valves — Instruction* | DeZURIK, Inc. | **D11032** | Instruction dated **July 2018**; copyright page reads **© 2022**; 17 pages | Manufacturer public download (verified locally) | Knife gate valve, slurry/severe service variant | **Model-specific: KGC-MD only** | Installation and maintenance; scraper and purge terminology; clip-replacement procedure | Warnings and cautions present | Model-specific; **no calendar maintenance interval observed** (the word "frequency" appears only as *cycling* frequency) | © notice observed; no "all rights reserved" | **B** |
| M3 | *DeZURIK KGI Iron Knife Gate Valve — Instruction* | DeZURIK, Inc. | **D10523** | August 2024; 12 pages | Manufacturer public download (verified locally) | Iron-body knife gate valve | **Model-specific: KGI only** | Installation, operation and maintenance; packing/gland and installation torque table | Warnings and cautions present | Model-specific (iron body); different materials and ratings from stainless/slurry designs; **no calendar maintenance interval observed** | © notice observed; no "all rights reserved" | **B** |
| M4 | *Series 740 Bidirectional Knife Gate Valves — Installation, Operation, and Maintenance Manual* | Bray International | Series 740 IOM | © 2025 stated on the document; 28 pages | Manufacturer public download (verified locally) | Bidirectional knife gate valve with liner and packing | **Model-specific: Series 740 only** | Full IOM with liner/packing/gland content, warnings and cautions | Substantial warning/caution content (11 / 18 occurrences) | Model-specific. Its only frequency statement is a **storage** inspection "on a semi-annual basis" — **not an in-service interval**; stem lubrication is "at regular intervals" with no period given | **Strongly restricted:** "ALL RIGHTS RESERVED" ×27, © ×27, and an explicit no-copying/permission clause | **B** |
| M5 | *Flowrox™ Slurry Knife Gate valves SKH (High pressure) DN80–600 (3"–24") — Installation, maintenance and operating instructions* | Valmet | **4SK71EN** (1/2024); 28 pages | January 2024 (PDF created 2024-01-11) | Manufacturer public download (verified locally) | **Slurry** knife gate valve, high pressure | **Model-specific: Flowrox SKH only, DN80–600** | Directly relevant to slurry service; sleeve-based design; torque values; **a titled "Maintenance schedule" (Table 4) carrying explicit frequencies** — e.g. leakage inspection "Regularly", lubricate the valve "After every 50 cycles", lubricate the actuator stem "Every six months", suggested open/close cycle "once a month", examine flushing/drainage and clean the gate "Every two months" — with the document's own caveat that "schedules will vary with applications" | Warnings and cautions present | Sleeve design differs fundamentally from packing-gland designs; **every frequency is model- and application-specific** and must not be transplanted | **Restricted:** "Copyright © … Valmet Corporation. All rights reserved.", plus confidentiality/non-disclosure language | **B** |
| M6 | *TL with bonnet — Knife Gate Valve — Installation, Operation & Maintenance Manual* | ORBINOX | TL (with bonnet) IOM | Document produced 2024-10 (PDF metadata 2024-10-09); 14 pages | Manufacturer public download (verified locally) | Bonneted knife gate valve | **Model-specific: TL with bonnet only** | IOM with packing-gland content and torque values | Warnings present | Model-specific; **no calendar maintenance interval observed** | **No copyright, "reserved", reproduction or permission notice observed** — copyright is presumed, not observed | **B** |
| M7 | *VAG ZETA® Knife Gate Valve, version with AUMA electrical multiturn actuator (EA) — Operating and Maintenance Instructions* | VAG Group | **KAT-B2 2410, Edition 8** | 30-11-2017; 12 pages (PDF metadata 2017-11-30) | Manufacturer public download (verified locally) | Knife gate valve with electric actuator | **Model-specific: ZETA / KAT-B2 with AUMA EA only** | Installation, operation and maintenance; §6.2 "Inspection- and operation intervals" advises operating the valve over its **entire stroke "at least four times per year"** and checking components for proper function; includes actuator **torque-adjustment** content (not a fastener torque table) | Warnings present | Actuator-specific content is not transferable to a different actuator; the "four times per year" figure is model-application advice, not a manufacturer requirement for all knife gate valves | **No copyright notice observed** — copyright presumed; model/actuator-specific | **B** |
| M8 | *Operating and maintenance instructions for Knife gate valve HaPur® with PUR-coated shut-off blade, Ord.No. 392-00* | HAWLE | Ord.No. **392-00** | 07/2026; 2 pages | Manufacturer public download (verified locally) | Knife gate valve, PUR-coated blade | **Model-specific: HaPur® 392-00** | States "Hawle knife gate valves do not require any maintenance", then recommends **actuating the valve "once a year"** and relubricating the shut-off blade; product limits stated for that product (municipal sewage; max. operating temperature **0–40** (document omits the unit; °C implied); max. operating pressure **10 bar**) | Warning content present | 2-page instruction; product-specific limits and the "once a year" recommendation must not be generalised; coating application differs from slurry/metal-seat designs | **No copyright notice observed** — copyright presumed; product-specific | **B** |
| M9 | *Installation, Operation and Maintenance Instructions — Knife Gate Valve* | POLIX | not stated in the document | No revision statement in the document; **PDF metadata creation date 2016-08-24**; 2 pages | Manufacturer public download (verified locally) | General-purpose knife gate valve | **Model-specific/undetermined** | Brief IOM; working temperature **0–90 °C**; DIN 2642 PN10 flanges; bolt/packing inspection steps; explicit hand-safety warning | Explicit safety warning about putting hands/objects into the valve | Short document; limits are product-specific; no model family declared. **No calendar maintenance interval is stated** (see §11.3 — an adversarial claim that this document states a three-month interval could not be reproduced) | **No copyright, "reserved" or permission notice observed** — copyright presumed | **B** |

### Group 5 — Candidates that could **not** be verified (no evidentiary weight)

| # | Source | Attempted location | Outcome | Class |
|---|---|---|---|---|
| U1 | Emerson (Clarkson) KGD knife gate valves IOM, document 5193462 | Manufacturer document URL | Retrieval redirected to a corporate search page; document body **not obtained** | **D** (not verified) |
| U2 | ITT Engineered Valves knife gate IOM (`33ptd-iom`) | Manufacturer media library | HTTP 404 at the attempted path; **not obtained** | **D** (not verified) |
| U3 | A municipal knife gate valve procurement specification (publicly posted) | City document centre | Located but **not inspected**; procurement specifications are not OEM/standards authority and their reuse rights are unestablished | **D** (not relied upon) |

Group 5 entries are recorded so the search itself is auditable. **Nothing was inferred from them.**

---

## 6. Evidence admissibility classification (summary)

| Class | Sources | Meaning |
|---|---|---|
| **A — ADMISSIBLE** | **None** | No candidate is currently admissible for authoring knife gate valve inspection content. |
| **B — CONDITIONALLY ADMISSIBLE** | M1–M9 (OEM IOMs) | Genuine engineering documents, but each is blocked by at least one condition: the pilot's make/model is unresolved; rights status is not established (M6.4 §4/§4.1; G1); and a qualified engineer/SME must review the derivation. Each also carries **model-specific** intervals, limits and torques. |
| **C — REFERENCE_ONLY** | S1, S2, S3, S4 (standards); S5 | Establishes that authoritative standards exist and bound the technology. **S2 (MSS SP-151) specifically bounds acceptance criteria for knife gate valves of all types.** None of S1/S4/S2/S3 can be inspected (paywalled/DRM), and even if licensed they state requirements rather than task-level instructions. S5 is general government programme guidance carrying an internal-use statement. |
| **D — REJECTED** | U1–U3; all legacy corpus material; AI output | Unverifiable, or expressly non-establishing under M6.4 §2/§3/§6. |

**Authenticity is not applicability.** M1–M9 are authentic manufacturer documents, and each is
applicable **only to its own model family**. None can be substituted for another, and none can be
applied to "a knife gate valve" in general. Likewise, S2's "of all types" scope makes it the acceptance-
criteria authority for the *class*, but it is unlicensed and uninspected — and it does not tell anyone
which actions to perform on a specific valve.

**Rights notices are a spectrum, not a binary.** Observed restrictions: M4 (Bray) and M5 (Valmet) carry
explicit "all rights reserved" and no-copying/confidentiality language; M1–M3 (DeZURIK) carry a © notice
only; M6 (ORBINOX), M7 (VAG), M8 (HAWLE) and M9 (POLIX) carry **no notice at all** — copyright is
presumed but not observed; and S5 (USBR) has no copyright notice but an **internal-use-only** statement.
Absence of a notice is **not** permission.

---

## 7. Applicability analysis (the five required distinctions)

| Kind of requirement | Established for the pilot? | Basis |
|---|---|---|
| **General equipment knowledge** | **Partially** | Knife gate valves are isolation/shear valves for slurry and water service; general valve maintenance scheduling practice is described in S5 (but not for this valve type). Usable as context only. |
| **Manufacturer-specific requirements** | **NO** | The pilot's manufacturer is unresolved (§3.4). Group 4 documents are each manufacturer-specific and cannot be selected without it. |
| **Model-specific requirements** | **NO** | Same, more strictly: features named in legacy steps (lantern ring, scrape ring, purge port, body liner) exist on *some* designs and not others. The OEM evidence proves the point — Valmet's schedule runs on *cycles* and two-month intervals, VAG advises four full-stroke operations per year, HAWLE advises once a year for a product that "does not require any maintenance", Bray's only period is a *storage* inspection, and the DeZURIK models state no calendar interval at all. A model match is mandatory before any instruction, interval or value is taken. |
| **Site-specific requirements** | **NO** | No asset register entry, no isolation/process data, no line/valve tag for the pilot asset exists in the repository; production asset data was not accessed. |
| **Safety-critical instructions** | **NO** | Legacy steps carry **zero** safety content (D4 fail). OEM documents contain safety warnings (including POLIX's explicit hand-injury warning and Valmet's warnings/cautions), but those are model-specific and rights-restricted, and M6.4 §6 forbids AI from establishing safety controls. Safety content must come from an admissible source plus an attributed safety review. |

**The applicability gate fails at manufacturer-specific level and is worse at model- and site-specific
level.** That is the central evidence blocker.

---

## 8. Unresolved values (recorded as unresolved — none invented)

Per M6.4 §7 and §8, the following are **deliberately not established** by this record. None may be
supplied by inference, by AI generation, or by copying a catalogue abstract:

| # | Unresolved value | Why it is unresolved |
|---|---|---|
| 1 | **Inspection / maintenance interval** | Legacy value is `GENERATED_DEFAULT`. OEM intervals **do** exist but are mutually inconsistent and strictly model/application-specific (Valmet: 50 cycles / six months / two months, with "schedules will vary with applications"; VAG: at least four full-stroke operations per year; HAWLE: once a year, for a product it says needs no maintenance; Bray: a *storage* inspection only). No admissible source states an interval for this unspecified valve; M6.4 §7 therefore requires the governed **`no_fixed_interval`** state. |
| 2 | **Acceptance criteria** (per step) | Legacy steps have none (D3 fail). **The standards basis is now identified: MSS SP-151:2021 (S2) establishes acceptance criteria for shell and seat closure pressure testing of knife gate valves of all types — but it is paywalled and uninspected, and it covers pressure testing, not every step's criterion.** M6.4 §8 permits accountable qualified-human derivation with recorded rationale; that has not occurred. |
| 3 | **Safety instructions / controls** | Legacy steps have none (D4 fail); M6.4 §6 forbids AI establishing safety controls; OEM warnings are model-specific and rights-restricted. |
| 4 | **Fastener torque values** | Present in several OEM manuals (M1 Table A, M3 installation torque table, M5 torque values, M6 torque values) but **model-, size- and material-specific**; unusable without the exact model. (M7's torque content is actuator torque *adjustment*, not fastener torque.) |
| 5 | **Operating pressure / temperature limits** | Stated per product and mutually inconsistent: M8: 10 bar, 0–40; M9: 0–90 °C; S4 catalogue scope: 0.6–52 °C. **No general value exists.** |
| 6 | **Isolation / lockout requirements** | Site-specific; not established. |
| 7 | **Materials, seat/sleeve type, actuator type** | Unresolved without the asset identity; different designs require different inspection actions. |
| 8 | **Applicability to type 21 as a class** | Unresolved: type 21 is a generic identity; a single procedure cannot be asserted as type-wide evidenced knowledge (also engaged by G2). |

---

## 9. Qualification outcome

# `NO_ADMISSIBLE_ENGINEERING_EVIDENCE`

For the bounded purpose of **authoring a publishable, evidence-backed Knife Gate Valve inspection
procedure for equipment type 21 today**, no candidate source is admissible.

This is a **valid mission outcome**, not a failure of investigation. The blocker is not a shortage of
documents — several genuine OEM manuals and four authoritative standards were located and verified (and
adversarial review added two of those standards). The blocker is that **none of them can be lawfully and
correctly turned into instructions for this pilot yet**, because:

1. **The pilot's make and model are unresolved**, so no manufacturer- or model-specific document can be
   selected. Generalising one across knife gate designs would be engineering error, and the OEM evidence
   demonstrates it: the four designs examined prescribe materially different maintenance regimes, and
   two prescribe no calendar interval at all.
2. **Rights/licence status is not established** for the standards or the OEM manuals. M6.4 §4 makes
   rights a precondition for storage, reproduction, derivation and redistribution, and §11 (G1) states
   this must be resolved before the first procedure is authored from material whose rights are not
   established. **This G1 trigger is now live for this pilot.**
3. **The only source found that carries no copyright notice (USBR FIST 4-1A) does not cover knife gate
   valves at all** (zero mentions in either the current Revision 3.0 or the superseded May 2024 edition)
   **and carries an internal-use-only statement**, so it cannot close the gap either on applicability or
   on rights.
4. **Acceptance criteria, safety content and every numeric value remain unresolved** (§8), and M6.4 §6/§8
   forbid AI from establishing them.

**No procedure is ready for publication. No value in this document is an engineering assertion.**

### 9.1 Exact conditions that would change this outcome

| Gate | Required action | Owner |
|---|---|---|
| **G-A — Asset identity** | Establish the pilot valve's manufacturer, model, size, seat/sleeve type, actuator type and service conditions from a tenant asset register or an authorized customer engineering source | Tenant engineering / knowledge steward |
| **G-B — Rights adjudication (G1)** | Decide, per M6.4 §4.1, whether the specific OEM manual may be stored, quoted, paraphrased and derived from for the owning tenant, and record that status | OWNER (governance) |
| **G-C — Standard licensing** | If a standard is to be relied on, lawfully obtain it and record the licence terms. The **acceptance-criteria basis is identified as MSS SP-151:2021 (S2)**; the construction basis for high-pressure designs is ANSI/MSS SP-135:2021+ERRATA:2022 (S3) | OWNER (procurement/governance) |
| **G-D — Qualified derivation** | A qualified engineer/SME performs accountable authoring: selects the matching OEM document, derives steps, states criteria only where the source states them, and records rationale for any SME-derived criterion | Qualified engineer / SME |
| **G-E — Safety review** | Safety content and controls are authored under the M1 safety-attestation model with the attributed safety review | Safety reviewer (separate principal) |
| **G-F — Interval policy** | Assert a trigger only with an admissible basis; otherwise record `no_fixed_interval` | Knowledge steward |

Only when G-A through G-F are satisfied can a Knife Gate Valve procedure be authored, reviewed,
approved and published. **This mission performed none of them.**

---

## 10. Recommended next engineering mission

**KF-03 (recommended): "Knife Gate Valve Pilot — Asset Identity and Rights Adjudication Package"** —
a bounded, non-authoring mission to:

1. Resolve the pilot asset identity (G-A) from a tenant asset register or authorized customer source.
2. Produce the rights/licence adjudication for the specific OEM document(s) that match that asset
   (G-B/G-C), giving consideration to M6.4 §4.1's open questions.
3. Identify the exact OEM document(s) and edition(s) that match, and record their admissibility.
4. Assess whether a licensed MSS SP-151:2021 (and, if the design requires it, ANSI/MSS SP-135:2021)
   is required for the acceptance-criteria basis, and record the licence position.
5. Establish the governed SME-derivation format (G-D) and the safety-review path (G-E).
6. Return for OWNER authorization before any authoring begins.

**Do not start KF-03 automatically.** It requires architectural review and OWNER authorization.

---

## 11. LCQE and adversarial verification

### 11.1 LCQE (performed on this record)

| Check | Result |
|---|---|
| Unsupported engineering claims | **None** — every numeric or technical statement is attributed to a source or recorded as unresolved (§8) |
| Unverifiable citations | **None relied upon** — Group 5 candidates are explicitly recorded as unverified and given no weight |
| Incorrect source applicability | **Checked** — authenticity separated from applicability; model-specific documents explicitly not generalised (§6, §7) |
| Copyright/licensing hazard | **Controlled** — no third-party document stored in the repository; only metadata and short factual characterisations recorded; no paywall circumvented; "no notice observed" distinguished from "no rights" |
| Invented values | **None** — §8 lists every unresolved value; no torque, pressure, temperature, interval, tolerance or safety instruction is asserted |
| Legacy treated as authority | **No** — template 1217 recorded as reference material with rubric verdict `Reject` |
| Scope compliance | **Yes** — documentation only; no code, schema, migration, capability or test changed |
| Production assumptions | **None** — production source registry recorded as unresolved rather than assumed |

### 11.2 Adversarial verification

A **separate-context adversarial review** was executed, instructed to falsify source authenticity,
manufacturer/model attribution, dates, page counts, rights statements and the
`NO_ADMISSIBLE_ENGINEERING_EVIDENCE` conclusion, to search hard for any missed admissible source, and to
flag any invented engineering value. Every finding was independently re-verified by this mission before
being accepted or rejected; the outcome is dispositioned below and the corrections are in this revision.

### 11.3 Adversarial findings and disposition

| # | Reviewer severity | Finding | Mission disposition |
|---|---|---|---|
| A-1 | MAJOR | The standard register was **incomplete**: MSS **SP-151:2021** ("Pressure Testing of Knife Gate Valves" — requirements and **acceptance criteria** … "of all types") and **ANSI/MSS SP-135:2021+ERRATA:2022** ("High Pressure Knife Gate Valves") were missed | **ACCEPTED — independently verified** on the distributor catalogue (titles, scopes, TC numbers, page counts, dates, supersessions, DRM). Added as **S2/S3**; **S2 is now named as the identified acceptance-criteria basis** in §8 row 2 and §9.1 G-C. **The class-C/paywalled status means the conclusion is unchanged** |
| A-2 | MAJOR | S5 currency: the verified May 2024 FIST 4-1A is **superseded by Revision 3.0 (01/2026, 200 pp)** | **ACCEPTED — independently verified** by downloading Revision 3.0 (200 pages, U.S. Department of the Interior) and confirming **zero** "knife"/"gate valve" mentions there too. §5 Group 3 records both editions and the supersession |
| A-3 | MINOR | S5 rights cell omitted the document's own internal-use statement | **ACCEPTED — independently verified** ("general information for internal use only by Bureau of Reclamation operations and maintenance staff", Disclaimer page). S5 **reclassified to class C** and its rights cell rewritten; the earlier "most rights-permissive candidate" wording is withdrawn |
| A-4 | MINOR | §5 evidence-limitation cells omitted the OEM intervals | **PARTIALLY ACCEPTED — verified for M5 (Valmet Table 4), M7 (VAG §6.2 "at least four times per year"), M8 (HAWLE "once a year") and M4 (Bray storage semi-annual, in-service none).** These are now recorded. **NOT REPRODUCED for M9 (POLIX):** the review claimed a "three-month" interval; the downloaded document (2 pages) contains **no calendar interval**, only bolt/packing checks. The claim is rejected and §5 M9 records the negative finding |
| A-5 | MINOR | Date precision: M2 "July 2018" vs "© 2022"; M9 recorded as "not stated" despite PDF metadata | **ACCEPTED** — M2 now records both the July 2018 instruction date and the © 2022 copyright page; M9 records the **2016-08-24 PDF metadata creation date** alongside the absence of any in-document revision |
| A-6 | MINOR | §11.2 overclaimed that prior adversarial findings had been dispositioned and applied | **ACCEPTED** — this revision states the review's findings and their disposition explicitly (§11.2–§11.3) instead of asserting closure |
| A-7 | NIT | "Manufacturer copyright" for ORBINOX/VAG/POLIX is presumption, not observed notice | **ACCEPTED** — §5 Group 4 and §6 now distinguish "notice observed" (Bray, Valmet, DeZURIK) from "no notice observed; copyright presumed" (ORBINOX, VAG, HAWLE, POLIX) |
| A-8 | NIT | S1 title omitted "(Incl. 2022 Errata Sheet)"; publisher/distributor published-date conflict | **ACCEPTED** — S1 records the errata parenthetical and the 01-01-2022 vs 31-01-2022 source conflict explicitly, unresolved |
| A-9 | NIT (positive) | No fabricated source, no wrong-product attribution, no invented value; the conclusion survived falsification | **RECORDED.** The adversarial process changed the register's completeness, not the verdict |

**Effect on the conclusion:** none. A-1 and A-2 strengthen the record (a knife-gate-specific
acceptance-criteria standard is now identified; the current government edition is cited) without
creating an admissible source. The outcome remains **`NO_ADMISSIBLE_ENGINEERING_EVIDENCE`**.

**Independence statement.** This was a separate agent context, **not** an independent review *mission*
and not a human independent reviewer. Formal independent VUDA independence for this evidence
qualification is therefore recorded as **PENDING** (see the acceptance register, requirement 16). No
claim of independent acceptance is made.

---

## 12. What this document does not do

It does not author, transform, approve, publish, cite-as-authority, purchase, or store any engineering
document. It creates no knowledge source, no evidence row, no version and no capability. It establishes
no engineering value. It authorises no procedure and asserts no readiness.
