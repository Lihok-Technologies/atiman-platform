# ATM-001 M5R.4A — Equipment Type Reconciliation Decision Package

**Status: DECISION CANDIDATE — NO TAXONOMY MUTATION. NOT IMPLEMENTED.**

This record reconciles the broader Atiman candidate equipment-type corpus
(historically reported as "approximately 282 equipment types") against the
accepted canonical model. It **classifies and proposes**; it does not change
the taxonomy. No migration, no seed change, no data mutation, no production
access.

| | |
|---|---|
| Baseline | `origin/main` = `13f68bad311e7740e1a53247bf79f7275d9218a0` |
| Migration chain | 001–018 unchanged; **no 019** |
| Companion data | `docs/research/m5r4a/equipment-type-reconciliation.jsonl` |
| Companion sha256 | `bb87057a555f403e340d9a4a741201259a68aa06655cd46523b07a25ade7734e` |
| Candidate corpus sha256 | `c1a310585e9ba4af8bdee232b8b328bbda3dd1687d83f867629c8152991f1b77` |
| Method | M5R.1 §10, deterministic and non-destructive |

---

## 1. Candidate corpus provenance

The corpus previously called "282 types" is **not** an external standard and not
a cleaned design. It is the **live manual bootstrap corpus**:

| Artifact | Rows | Status | Role |
|---|---|---|---|
| `scripts/bootstrap-knowledge/equipment_types.jsonl` | **282** | `CURRENT_IMPLEMENTATION` — seeded | **the candidate corpus** |
| `scripts/bootstrap-knowledge/equipment_classes.jsonl` | 311 | seeded | class level |
| `scripts/bootstrap-knowledge/equipment_categories.jsonl` | 65 | seeded | category level |
| `scripts/bootstrap-knowledge/equipment_type_industries.jsonl` | 647 | seeded | applicability |
| `scripts/bootstrap-knowledge/industries.jsonl` | 6 | seeded | applicability targets |

**Why earlier work said "282".** M5R.1 §10 records the live seed as
*"65 categories / 311 classes / 282 types / 647 industry rows"*, and ATM-013
§19/§41 records the same 282 equipment types each carrying three shared
templates. The figure is the literal row count of `equipment_types.jsonl` — it
was never an engineering estimate. **Verified: 282.**

**How it is loaded.** `scripts/bootstrap-knowledge/bootstrap.js` is, per the
README, *"a one-time manual operation, never a deployment step"*, and it
*"requires its target tables to be empty"*. The PostgreSQL migrations therefore
create the taxonomy **structure only**: a freshly migrated database contains 0
categories, 0 classes and 0 types. The canonical *content* exists only after the
manual bootstrap.

**Provenance classification of every source:**

| Class | Artifact | Verdict |
|---|---|---|
| Candidate corpus | `scripts/bootstrap-knowledge/equipment_types.jsonl` | **AUTHORITATIVE CANDIDATE** — the live corpus, unratified |
| Cleaned legacy design | `database/odm_legacy_equipment_taxonomy_design.v1.json` | `LEGACY_BEHAVIOR` — **not seeded**, no loader references it |
| Generated seed copy | `odm_seed/master_data/taxonomy.v1.json` | byte-identical duplicate of the design artifact |
| Generator | `database/generate_iso_taxonomy.py` | produces both design outputs from one in-memory dataset |
| Current schema | `database/postgresql/002_equipment_taxonomy.sql` | structure only |

The design artifact and its seed copy are byte-identical
(`sha256 cf7eece15c84c7fb7114b5470c209e30370d87803fef25d4d6a632ca21fd60be`), as M5R.2A recorded.

**The two corpora are largely different knowledge sets — verified, not assumed.**
Normalised-name intersection between the 282 corpus and the 60-type design
artifact is **10 of 282 (3.5%)**: `Air Handling Unit`, `Battery Bank`, `Chiller`,
`Distribution Transformer`, `Gas Turbine`, `Power Transformer`,
`Reciprocating Compressor`, `Rotary Screw Compressor`, `Steam Turbine`,
`Variable Frequency Drive`. The design artifact is also **coarser**: its 60 types
sit under the broad categories (`Rotating Equipment`, `Static Equipment`,
`Valves`, `Piping Systems`, `Utility Equipment`, `Structures`, `Safety Systems`,
`Instrumentation and Control`, `Electrical Equipment`, `HVAC Equipment`), whereas
the 282 corpus is finer-grained. §1's warning that these are not the same
knowledge set is **confirmed empirically**.

**Source identifier gap (recorded, not an omission):** candidate ids run
**1–283 with id 73 absent** — 282 rows, not 283. The candidates are therefore
identified by their original `id` and echoed as `source_row` in the companion
data, so the gap can never be mistaken for a dropped record.

**Literal duplicate rows in the raw corpus:** exactly two —
`type_code = COMPACT` (used by both `Conveyor › Screw Conveyor › Compact Screw`
and `PLC › PLC Controller › Compact PLC`) and `type_name = "Pressure Filter"`
(used by both `Chemical Separation › Pressure Filter` and
`Filter › Sand Filter › Pressure Filter`). No `(class_id, type_code)` pair is
duplicated, so the corpus satisfies
`uq_equipment_types_unique_type_per_class`; the `COMPACT` collision is real but
legal because the codes live in different classes.

---

## 2. Current canonical baseline — four things, never collapsed

| | Dataset | Counts | Status |
|---|---|---|---|
| **A** | **Current canonical Atiman taxonomy** | model: Category → Class → Type; content: 65 categories / 311 classes / **282 types** / 647 applicability rows | The **model** is OWNER-approved (M5R.1 §2, Equipment Family permanently excluded). The **type identities are unratified**: M5R.1 §10 records all 282 as `CANDIDATE_EQUIPMENT_IDENTITIES` defaulting to `NEEDS_RESEARCH`. |
| **B** | Cleaned legacy design artifact | 10 categories / 42 classes / 60 types / 288 subunits / 376 maintainable items | `LEGACY_BEHAVIOR`, not seeded, superseded as a live structure |
| **C** | Broader candidate corpus | **282 types** (the reconciliation subject) | = the live seeded type corpus |
| **D** | External standard classifications | **0** | None populated. The M5R.3 crosswalk capability exists and is **empty**; no edition, no classification, no evidence row. |

**A and C are the same artifact.** Atiman has an approved canonical *model* and
an unratified canonical *content*. There is no separate, already-ratified set of
Atiman equipment types beyond the 282 — which is precisely why this
reconciliation exists. Stating that plainly is more honest than implying a
ratified baseline that does not exist.

**Identity scheme (current):** integer `id`; `type_code` unique **within a
class** (`uq_equipment_types_unique_type_per_class`); `equipment_types.class_id`
→ classes → `category_id` → categories. Types carry no global code uniqueness.

**Hierarchy coverage:** 54 of 65 categories carry at least one type; **98 of 311
classes (31.5%) carry none**; 282 types total.

---

## 3. Reconciliation method

M5R.1 §10 mandates a deterministic, non-destructive method. It was followed in
order, and its outcome is recorded for each step:

| Step | M5R.1 §10 requirement | What was done |
|---|---|---|
| 1 | Structural pass — duplicates, plural forms, compound names, abstract-container risk, service-in-name | Run over all 282 rows; findings in §4 and §8 |
| 2 | Crosswalk pass — assign classification evidence per identity | **Could not be performed: no evidence exists.** Recorded as absent, not invented (§9) |
| 3 | Disposition assignment | Every candidate assigned exactly one of the nine approved dispositions (§4) |
| 4 | Engineer review | Applied; every call is recorded with its rationale and confidence, and this package is submitted for Chief Architect review |
| 5 | **Additive** application — no deletion, no destructive migration | **Deliberately NOT executed.** This is a decision package; application is M5R.4B (§13) |

**Disposition vocabulary.** M5R.1 §10 approved
`RETAIN · RENAME · MERGE · SPLIT · RECLASSIFY · COMPONENT_NOT_EQUIPMENT ·
APPLICATION_NOT_EQUIPMENT · DUPLICATE · UNSUPPORTED · NEEDS_RESEARCH`. This
mission specifies a nine-value output vocabulary
(`KEEP_EXISTING · ADD_TYPE · SYNONYM_OR_ALIAS · MERGE_DUPLICATE · RECLASSIFY ·
NOT_EQUIPMENT_TYPE · TOO_BROAD_CONTAINER · CUSTOMER_SPECIFIC ·
INSUFFICIENT_EVIDENCE`). The mission's vocabulary is used as the primary output
because it is the required accounting and balancing format; **both are recorded**
so the M5R.1 vocabulary stays durable:

| Mission disposition | M5R.1 §10 equivalent |
|---|---|
| `KEEP_EXISTING` | `RETAIN` |
| `ADD_TYPE` | `RETAIN` (a new Type-level identity) |
| `SYNONYM_OR_ALIAS` | `RENAME` |
| `MERGE_DUPLICATE` | `MERGE` / `DUPLICATE` |
| `RECLASSIFY` | `RECLASSIFY` |
| `NOT_EQUIPMENT_TYPE` | `COMPONENT_NOT_EQUIPMENT` / `APPLICATION_NOT_EQUIPMENT` |
| `TOO_BROAD_CONTAINER` | structural — the "abstract-container risk" of step 1 |
| `CUSTOMER_SPECIFIC` | M5R.1 §6.2 customer-isolation requirement |
| `INSUFFICIENT_EVIDENCE` | `NEEDS_RESEARCH` (the M5R.1 default) |

**Operational reading of the dispositions**, stated so another engineer can
reproduce the calls:

- `KEEP_EXISTING` — the candidate is already a correctly placed Type-level
  identity; retain it (new canonical name where §11 requires normalisation).
- `ADD_TYPE` — the candidate names a legitimate Type-level identity that the
  corpus **does not currently hold as a type**: it exists only as a class name,
  or only as attribute/variant rows that must collapse into it. The first member
  of such a group becomes the `ADD_TYPE`; the rest `MERGE_DUPLICATE` into it.
- `SYNONYM_OR_ALIAS` — a different *name* for an identity already carried.
- `MERGE_DUPLICATE` — a variant row (construction, duty, medium, scale) of an
  identity that already exists.
- `NOT_EQUIPMENT_TYPE` — a component, subunit, maintainable item, assembly,
  system, material, technology, activity or **attribute**.
- `RECLASSIFY` — a legitimate Type under the wrong Category or Class.

**Test applied to every candidate** (mission §6): would maintenance strategy,
inspection method, failure mechanisms, reliability characteristics, safety
controls, operating principle, maintainable decomposition or the knowledge
package reasonably differ? If not — and the difference is manufacturer, model,
size, rating, capacity, voltage, material, site terminology, spelling, acronym,
plural/singular or a minor construction variant — it is not a separate canonical
Type. `Voltage` and enclosure/medium attributes were the two most productive
exclusions; both are named explicitly in §6.

---

## 4. Disposition summary — complete and balanced

| Disposition | Count | Share | M5R.1 §10 equivalent |
|---|---|---|---|
| `KEEP_EXISTING` | **136** | 48.2% | `RETAIN` |
| `NOT_EQUIPMENT_TYPE` | **50** | 17.7% | `COMPONENT_NOT_EQUIPMENT` / `APPLICATION_NOT_EQUIPMENT` |
| `RECLASSIFY` | **31** | 11.0% | `RECLASSIFY` |
| `ADD_TYPE` | **30** | 10.6% | `RETAIN` (new identity) |
| `MERGE_DUPLICATE` | **25** | 8.9% | `MERGE` / `DUPLICATE` |
| `TOO_BROAD_CONTAINER` | **4** | 1.4% | structural (abstract-container risk) |
| `INSUFFICIENT_EVIDENCE` | **3** | 1.1% | `NEEDS_RESEARCH` |
| `SYNONYM_OR_ALIAS` | **3** | 1.1% | `RENAME` |
| `CUSTOMER_SPECIFIC` | **0** | 0.0% | (M5R.1 §6.2) |
| **TOTAL** | **282** | **100.0%** | |

**Balance (machine-checked):** 136 + 50 + 31 + 30 + 25 + 4 + 3 + 3 + 0 = **282** = the reconstructed corpus size. Every candidate appears **exactly once** as a primary record in the companion JSONL.

**Confidence:** HIGH 233 · MEDIUM 46 · LOW 3

**`CUSTOMER_SPECIFIC` is genuinely zero.** No vendor or customer name appears in
the corpus, and industry-specific machinery (mine ventilation fans, mud pumps,
longwall shearers) is *industry* terminology, not *customer* terminology — it
belongs to applicability, not to a customer-specific identity. Recording a zero
here is more useful than manufacturing entries.

---

## 5. Proposed additions — 30

### Proposed additions (ADD_TYPE) — 30

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 13 | TEFC Motor → **AC Induction Motor** | Motor › AC Induction Motor | The corpus holds only enclosure variants here; the Type-level identity is the AC induction motor itself. |
| 19 | Rising Stem Gate → **Gate Valve** | Valve › Gate Valve | Stem arrangement is an attribute; the corpus never states the Type-level identity, which is the gate valve. |
| 22 | Concentric Butterfly → **Butterfly Valve** | Valve › Butterfly Valve | Seat/offset geometry is an attribute; the Type-level identity is the butterfly valve. |
| 25 | Swing Check → **Check Valve** | Valve › Check Valve | Disc arrangement is an attribute; the Type-level identity is the check valve. |
| 29 | Gauge Pressure → **Pressure Transmitter** | Instrumentation › Pressure Transmitter | The corpus holds only measurement-mode variants; the Type-level identity is the pressure transmitter. |
| 33 | Electromagnetic → **Electromagnetic Flow Meter** | Instrumentation › Flow Meter | Distinct operating principle with its own installation and maintenance requirements. |
| 35 | Vortex Shedding → **Vortex Flow Meter** | Instrumentation › Flow Meter | Distinct operating principle with specific Reynolds-number and piping requirements. |
| 36 | Turbine → **Turbine Flow Meter** | Instrumentation › Flow Meter | Distinct operating principle with rotating parts, filtration needs and its own wear profile. |
| 38 | Venturi Tube → **Venturi Flow Meter** | Instrumentation › Flow Meter | Distinct differential-producing primary element with different pressure loss and wear behaviour. |
| 39 | Radar Level → **Radar Level Transmitter** | Instrumentation › Level Transmitter | Distinct non-contact measurement principle with its own installation and tuning regime. |
| 40 | Ultrasonic Level → **Ultrasonic Level Transmitter** | Instrumentation › Level Transmitter | Distinct non-contact principle, distinguishable from radar by medium and application limits. |
| 41 | Capacitance → **Capacitance Level Transmitter** | Instrumentation › Level Transmitter | Distinct contact measurement principle with dielectric-dependent behaviour. |
| 46 | Modular PLC → **Programmable Logic Controller** | PLC › PLC Controller | The corpus holds only form-factor variants; the Type-level identity is the PLC. |
| 49 | Single Stage Centrifugal → **Centrifugal Blower** | Blower › Centrifugal Blower | Stage count is an attribute; the corpus never states the Type-level identity, which is the centrifugal blower. |
| 51 | Twin Lobe Blower → **Rotary Lobe Blower** | Blower › Rotary Lobe Blower | Lobe count is an attribute; the Type-level identity is the rotary lobe blower. |
| 61 | Turbine Mixer → **Mechanical Mixer** | Mixer › Mechanical Mixer | Impeller geometry is a component attribute; the Type-level identity is the mechanical mixer. |
| 66 | Manual Bar Screen → **Bar Screen** | Screen › Bar Screen | Cleaning method is an attribute; the Type-level identity is the bar screen. |
| 70 | Shafted Screw → **Screw Conveyor** | Conveyor › Screw Conveyor | Shaft presence is an attribute; the Type-level identity is the screw conveyor. |
| 94 | Overland Conveyor → **Belt Conveyor** | Conveyor › Overland Conveyor | Overland is a layout/duty qualifier; the belt conveyor is the Type-level identity and is otherwise unrepresented. |
| 112 | Reciprocating Compressor → **Reciprocating Compressor** | Compressor › Reciprocating Compressor | Stated here as a type while also existing as air-service in another category; one canonical identity only. |
| 113 | Screw Compressor → **Screw Compressor** | Compressor › Screw Compressor | Stated here as a type while also existing in the General Compressor category; one canonical identity only. |
| 117 | Pig Launcher → **Pig Launcher** | Pipeline › Pig Launcher | A launcher barrel is a discrete pressure vessel with its own closure and inspection regime. |
| 130 | Ultrasonic Meter → **Ultrasonic Flow Meter** | Metering › Ultrasonic Meter | Distinct operating principle; this is the canonical identity the Instrumentation duplicate resolves to. |
| 131 | Coriolis Meter → **Coriolis Flow Meter** | Metering › Coriolis Meter | Distinct mass-flow measurement principle with its own installation and zero-point regime. |
| 132 | Multiphase Meter → **Multiphase Flow Meter** | Metering › Multiphase Meter | Distinct measurement duty requiring phase-fraction computation; separate engineering package. |
| 146 | HRSG → **Heat Recovery Steam Generator** | HRSG › HRSG | The corpus states an abbreviation; the Type-level identity is the heat recovery steam generator. |
| 167 | Wet Scrubber → **Scrubber** | Pollution Control › Wet Scrubber | Medium is an attribute; the Type-level identity is the scrubber. |
| 241 | Centrifugal Air Compressor → **Centrifugal Compressor** | General Compressor › Centrifugal Air Compressor | The Type-level identity is the centrifugal compressor; air service is a duty qualifier. |
| 248 | Spray Booth → **Spray Booth** | Paint › Spray Booth | Coating medium is an attribute; the Type-level identity is the spray booth. |
| 273 | Air Circuit Breaker → **Circuit Breaker** | Electrical Equipment › Switchgear | The corpus holds only interrupting-medium variants; the Type-level identity is the circuit breaker. |

**Net new Type-level identities: 30.** Each is a legitimate Type that the corpus
currently holds only as a class name or as attribute rows. **None of these is
invented:** every one is derived from a row that is already in the corpus.

---

## 6. Proposed reclassifications — 31

### Proposed reclassifications (RECLASSIFY) — 31

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 21 | Knife Gate Valve  | Valve › Gate Valve | Genuinely distinct isolation valve (shear disc, slurry service); misplaced as a gate valve variant. |
| 32 | Hydrostatic Level  | Instrumentation › Pressure Transmitter | Measures level, not pressure; belongs to level measurement and is a distinct equipment identity. |
| 42 | Float Switch  | Instrumentation › Level Transmitter | A switch is not a transmitter: different function, different maintenance, distinct equipment identity. |
| 76 | Wheel Loader  | Haulage › Wheel Loader | A loader is loading equipment, not a haulage machine; distinct machine, wrong category. |
| 79 | Bulldozer  | Excavation › Bulldozer | Earthmoving machine, not excavation loading equipment; distinct type, wrong category. |
| 80 | Motor Grader  | Excavation › Motor Grader | Earthmoving/levelling machine, not excavation equipment; distinct type, wrong category. |
| 84 | Continuous Miner  | Drilling › Continuous Miner | A cutting/mining machine, not a drilling machine; distinct type, wrong category. |
| 85 | Longwall Shearer  | Drilling › Longwall Shearer | A longwall cutting machine, not a drilling machine; distinct type, wrong category. |
| 96 | Apron Feeder  | Conveyor › Apron Feeder | A feeder is not a conveyor; distinct machine with its own duty and wear regime. |
| 97 | Vibrating Feeder  | Conveyor › Vibrating Feeder | Distinct vibrating machine, not a conveyor; own drive and spring maintenance. |
| 100 | Mine Hoist  | Gearbox › Mine Hoist | A mine hoist is a winding machine, not a gearbox; distinct type with its own safety regime. |
| 103 | Mine Ventilation Fan  | Blower › Mine Ventilation Fan | A fan is not a blower; recognised distinct mining ventilation machine, wrongly categorised. |
| 110 | Indirect Heater  | Heater › Indirect Heater | Legitimate process heater; placement needs class review against heat-transfer equipment. |
| 124 | Shell and Tube Exchanger  | Heater › Shell and Tube Exchanger | A heat exchanger is not a heater; belongs to heat-transfer equipment. |
| 125 | Plate Exchanger  | Heater › Plate Exchanger | Legitimate heat-transfer equipment misplaced under Heater. |
| 126 | Air Cooler  | Heater › Air Cooler | Forced-draught air cooler is heat-transfer equipment with fan and fin maintenance. |
| 134 | Blowout Preventer  | BOP › Blowout Preventer | Recognised well-control equipment; the corpus category is an abbreviation and adds no level. |
| 153 | Mechanical Draft Cooling Tower  | Cooling › Cooling Tower | Correct Type-level identity, but a cooling tower is utility heat rejection, not a condenser. |
| 166 | Baghouse Filter  | Pollution Control › Baghouse Filter | A baghouse is a dust collector; correct placement is with dust collection, not emission control. |
| 177 | LP Feedwater Heater  | Heater › LP Heater | Legitimate heat-transfer equipment; pressure stage is an attribute, so it resolves to one identity. |
| 188 | Double Pipe Heat Exchanger  | Heater › Double Pipe Exchanger | Legitimate heat-transfer equipment misplaced under Heater. |
| 189 | Spiral Heat Exchanger  | Heater › Spiral Exchanger | Legitimate heat-transfer equipment misplaced under Heater. |
| 201 | Rotary Vacuum Filter  | Chemical Separation › Rotary Vacuum Filter | Legitimate filtration equipment placed under a process-function container; belongs with filtration equipment. |
| 202 | Belt Filter  | Chemical Separation › Belt Filter | Legitimate dewatering equipment; correct under filtration/dewatering, not chemical separation. |
| 203 | Leaf Filter  | Chemical Separation › Leaf Filter | Legitimate pressure-leaf filtration equipment; same reclassification rationale. |
| 218 | Grinding Machine  | CNC Machine › Grinding Machine | Distinct machine tool, but grinding is not necessarily CNC; correct under machine tools. |
| 219 | EDM Machine  | CNC Machine › EDM Machine | Distinct machine tool using a different material-removal principle; correct under machine tools. |
| 225 | Blow Molding Machine  | Injection Molding › Blow Molding Machine | Blow molding is not injection molding; distinct type, wrong category. |
| 226 | Extrusion Machine  | Injection Molding › Extrusion Machine | Extrusion is a different process from injection molding; distinct type, wrong category. |
| 227 | Thermoforming Machine  | Injection Molding › Thermoforming Machine | Thermoforming is not injection molding; distinct type, wrong category. |
| 247 | Cyclone Separator  | Dust Collection › Cyclone Separator | Distinct separation device, not a dust collector; own erosion and pressure-drop considerations. |

Two families dominate: **process-function categories held equipment that belongs
with its engineering discipline** (heat exchangers filed under `Heater`,
filtration under `Chemical Separation`, a baghouse under `Pollution Control`),
and **equipment filed under a process it does not perform** (a wheel loader
under `Haulage`, a mine hoist under `Gearbox`, plotters under `Injection
Molding`).

---

## 7. Proposed merges and synonyms — 25 merges, 3 synonyms

### Proposed merges (MERGE_DUPLICATE) — 25

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 7 | Submersible Sewage Pump → **Submersible Pump** | Pump › Submersible Pump | Duty/medium qualifier of the same submersible pump machine; impeller selection is a design attribute, not a separate type. |
| 8 | Submersible Drainage → **Submersible Pump** | Pump › Submersible Pump | Duty qualifier of submersible pump; differs by impeller/head selection, not by equipment type. |
| 9 | Submersible Slurry → **Slurry Pump** | Pump › Submersible Pump | Submersible variant of the slurry pump already represented by its own type; resolves to one canonical identity. |
| 37 | Orifice Plate → **Orifice Plate Flow Meter** | Instrumentation › Flow Meter | Duplicate identity: the Metering category carries the same instrument. |
| 50 | Multistage Centrifugal → **Centrifugal Blower** | Blower › Centrifugal Blower | Multistaging is a construction attribute of the same machine. |
| 52 | Tri-Lobe Blower → **Rotary Lobe Blower** | Blower › Rotary Lobe Blower | Lobe count is a construction attribute of the same machine. |
| 53 | Oil Injected → **Screw Compressor** | Compressor › Screw Compressor | Lubrication arrangement is an attribute; same machine type as the screw compressor already carried. |
| 54 | Oil Free → **Screw Compressor** | Compressor › Screw Compressor | Lubrication arrangement is an attribute of the same machine type. |
| 56 | Pressure Filter → **Pressure Filter** | Filter › Sand Filter | Duplicate identity: the same pressure filter is also held under Chemical Separation. |
| 101 | Winder Motor → **AC Induction Motor** | Motor › Winder Motor | Application qualifier of an induction motor; the winder duty does not create a distinct machine type. |
| 107 | Test Separator → **Production Separator** | Separator › Test Separator | Test service is a duty role of the same separation vessel, not a distinct equipment type. |
| 118 | Pig Receiver → **Pig Launcher** | Pipeline › Pig Receiver | Receiver and launcher are the same vessel in opposite service; service direction is an attribute. |
| 140 | Desilter → **Desander** | Treatment › Desilter | Same hydrocyclone device at a finer cut; cut size is a selection attribute, not a distinct type. |
| 145 | Aero-Derivative Gas Turbine → **Gas Turbine** | Turbine › Aero Gas Turbine | Aero-derivative is a design lineage of the same machine type; lightweight construction is a variant. |
| 160 | Step-Up Transformer → **Power Transformer** | Transformer › Step-Up Transformer | Network role qualifier of a power transformer, not a distinct machine type. |
| 161 | Unit Transformer → **Power Transformer** | Transformer › Unit Transformer | Network role qualifier of a power transformer, not a distinct machine type. |
| 171 | Fly Ash Silo → **Storage Silo** | Ash Handling › Fly Ash Silo | A silo is the equipment type; the stored material does not create a second canonical identity. |
| 174 | Limestone Slurry Pump → **Slurry Pump** | Pump › Limestone Slurry Pump | Lime/limestone slurry is a medium qualifier of the slurry pump already represented. |
| 178 | HP Feedwater Heater → **Feedwater Heater** | Heater › HP Heater | Pressure stage is an attribute of the same feedwater heater. |
| 205 | Day Bin → **Storage Silo** | Storage Tank › Day Bin | A day bin is a small silo; scale is a selection attribute, not a distinct equipment type. |
| 239 | Rotary Screw Compressor → **Screw Compressor** | General Compressor › Rotary Screw Compressor | Duplicate identity: "rotary screw" and "screw" name the same machine type. |
| 240 | Reciprocating Air Compressor → **Reciprocating Compressor** | General Compressor › Reciprocating Air Compressor | Air is the service medium; the machine type is already represented. |
| 260 | AC Motor → **AC Induction Motor** | Electrical Equipment › Motor | Duplicate identity: the Motor category already carries the AC induction motor; two categories cannot both own it. |
| 269 | Oil Filled Transformer → **Power Transformer** | Electrical Equipment › Transformer | Oil-filled is the conventional construction of the power transformer already represented. |
| 274 | Vacuum Circuit Breaker → **Circuit Breaker** | Electrical Equipment › Switchgear | Vacuum is the interrupting medium of the same device; medium is an attribute, not a type. |

### Proposed synonyms / aliases (SYNONYM_OR_ALIAS) — 3

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 34 | Ultrasonic → **Ultrasonic Flow Meter** | Instrumentation › Flow Meter | The same instrument named without its head noun; a naming variant, not a second identity. |
| 129 | Orifice Meter → **Orifice Plate Flow Meter** | Metering › Orifice Meter | "Orifice Meter" is the same instrument as the orifice plate flow meter under a different name. |
| 141 | Subsea Tree → **Christmas Tree** | Subsea › Subsea Tree | The subsea industry term for the same equipment; installation context is an attribute, not a new identity. |

The merges cluster into three causes, all of them §6 exclusions rather than
missing knowledge:

1. **Duty or medium qualifier of the same machine** — submersible sewage /
   drainage / slurry; limestone slurry; process air versus gas; test versus
   production separator; day bin versus storage silo; fly-ash silo.
2. **Construction attribute stated as a type** — lubrication arrangement of a
   screw compressor; lobe count of a rotary lobe blower; multistaging; disc
   arrangement of a check valve; seat geometry of a butterfly valve; step-up /
   unit / oil-filled transformer roles.
3. **The same equipment carried twice under two categories** — AC motor,
   pressure filter, orifice meter, ultrasonic meter, vacuum circuit breaker,
   rotary screw compressor, reciprocating air compressor.

**Legacy synonyms to be recorded (§11, not stored yet):** see §14 — the
reconciliation preserves every displaced term as a synonym of its canonical
target rather than deleting the vocabulary.

---

## 8. Level findings, containers and customer terms

### Container concepts (TOO_BROAD_CONTAINER) — 4

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 111 | Gas Compressor  | Compressor › Gas Compressor | Generic duty descriptor spanning many compressor technologies; belongs at Class level, not Type. |
| 213 | Evaporator  | Treatment › Evaporator | Generic technology term that is a container for the falling-film and forced-circulation types already carried. |
| 245 | Dust Collector  | Dust Collection › Dust Collector | Generic container spanning baghouse, cartridge, cyclone and scrubber technologies; belongs at Class level. |
| 254 | Packaging Machine  | Packaging › Packaging Machine | Generic container spanning palletisers, case packers, labellers and wrappers; belongs at Class level. |

### Non-Type concepts (NOT_EQUIPMENT_TYPE) — 50

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 14 | ODP Motor  | Motor › AC Induction Motor | Enclosure protection attribute (open drip proof) of an AC induction motor, not a distinct equipment type. |
| 15 | Weather Protected  | Motor › AC Induction Motor | Enclosure protection attribute (weather protected), not a distinct equipment type. |
| 16 | Explosion Proof  | Motor › AC Induction Motor | Hazardous-area protection attribute; changes certification and materials, not equipment type. |
| 17 | Brake Motor  | Motor › AC Induction Motor | Integral brake is a component of the motor assembly; belongs to decomposition, not to Type. |
| 18 | Variable Speed  | Motor › AC Induction Motor | Duty/speed-control attribute; a variable-speed motor is an induction motor plus a drive. |
| 20 | Non-Rising Stem  | Valve › Gate Valve | Stem arrangement attribute of a gate valve, not a distinct equipment type. |
| 23 | Double Offset  | Valve › Butterfly Valve | Offset geometry attribute of a butterfly valve. |
| 24 | Triple Offset  | Valve › Butterfly Valve | Offset geometry attribute of a butterfly valve; metal-seated service changes materials, not type. |
| 26 | Lift Check  | Valve › Check Valve | Disc arrangement attribute of a check valve. |
| 27 | Dual Plate  | Valve › Check Valve | Disc arrangement attribute of a check valve. |
| 28 | Nozzle Check  | Valve › Check Valve | Disc arrangement attribute of a check valve. |
| 30 | Absolute Pressure  | Instrumentation › Pressure Transmitter | Reference-mode attribute (absolute) of a pressure transmitter. |
| 47 | Compact PLC  | PLC › PLC Controller | Form-factor attribute of a PLC (also a duplicated type_code across classes). |
| 48 | Safety PLC  | PLC › PLC Controller | Certification/safety-integrity attribute of a PLC, not a distinct equipment type. |
| 58 | Microfiltration  | Filter › Membrane Filter | A membrane process/technology, not an equipment type; the equipment is the membrane filtration unit it is built into. |
| 59 | Ultrafiltration  | Filter › Membrane Filter | A separation process/technology, not a Type-level equipment identity. |
| 60 | Reverse Osmosis  | Filter › Membrane Filter | A separation process/technology, not a Type-level equipment identity. |
| 62 | Propeller Mixer  | Mixer › Mechanical Mixer | Impeller geometry attribute; the impeller itself belongs to decomposition. |
| 63 | Paddle Mixer  | Mixer › Mechanical Mixer | Impeller geometry attribute; the impeller itself belongs to decomposition. |
| 64 | Fine Bubble Diffuser  | Mixer › Diffuser Aerator | A diffuser is a component (membrane/disc) of an aeration system, not a Type-level equipment identity. |
| 65 | Coarse Bubble  | Mixer › Diffuser Aerator | A diffuser is a component of an aeration system; decomposition referral, not Type. |
| 67 | Mechanical Bar Screen  | Screen › Bar Screen | Cleaning-method attribute of a bar screen; the rake mechanism belongs to decomposition. |
| 69 | Perforated Plate  | Screen › Step Screen | A perforated plate is a component of a screen, not an equipment type; decomposition referral. |
| 71 | Shaftless Screw  | Conveyor › Screw Conveyor | Shaft presence construction attribute of a screw conveyor. |
| 72 | Compact Screw  | Conveyor › Screw Conveyor | Size/construction attribute (also a duplicated type_code across classes). |
| 114 | Subsea Pipeline  | Pipeline › Subsea Pipeline | A pipeline is a system/asset rather than a Type-level equipment identity; no maintainable equipment unit. |
| 115 | Flowline  | Pipeline › Flowline | A flowline is a pipeline segment, not a Type-level equipment identity. |
| 116 | Gathering Line  | Pipeline › Gathering Line | A gathering line is a pipeline segment, not a Type-level equipment identity. |
| 128 | Molecular Sieve  | Treatment › Molecular Sieve | A molecular sieve is a desiccant material/technology; the equipment it fills is a dehydration unit. |
| 136 | Drawworks  | Rig › Drawworks | A drawworks is a major component/assembly of a drilling rig, not a Type-level equipment identity. |
| 137 | Top Drive  | Rig › Top Drive | A top drive is a major assembly of a drilling rig, not a Type-level equipment identity. |
| 147 | Triple Pressure HRSG  | HRSG › Triple Pressure HRSG | Pressure-level attribute of the same heat recovery steam generator. |
| 152 | Air-Cooled Condenser  | Cooling › Air-Cooled Condenser | Cooling-medium attribute of the condenser already represented; the equipment type is the condenser. |
| 154 | Natural Draft Cooling Tower  | Cooling › Natural Draft Tower | Draught method attribute of the cooling tower already represented. |
| 159 | Hydrogen-Cooled Generator  | Generator › Hydrogen-Cooled Generator | Cooling-medium attribute of the generator already represented. |
| 162 | GIS Switchgear  | Switchgear › GIS Switchgear | Insulation-medium attribute (gas insulated) of a switchgear assembly. |
| 163 | Air-Insulated Switchgear  | Switchgear › Air-Insulated Switchgear | Insulation-medium attribute (air insulated) of a switchgear assembly. |
| 164 | SCR  | Pollution Control › Selective Catalytic Reduction | A selective catalytic reduction is a process/system designation, not a discrete Type-level equipment identity. |
| 168 | Dry Scrubber  | Pollution Control › Dry Scrubber | Scrubbing-medium attribute of the same equipment type. |
| 185 | Packed Column  | Distillation › Packed Column | Internals arrangement attribute of a distillation column; packing belongs to decomposition. |
| 186 | Tray Column  | Distillation › Tray Column | Internals arrangement attribute of a distillation column; trays belong to decomposition. |
| 206 | Chemical Transfer Pump  | Pump › Chemical Transfer Pump | Duty qualifier ("transfer"), not a distinct equipment type: the machine is whichever pump technology is selected. |
| 211 | Process Blower  | Blower › Process Blower | Duty qualifier ("process"), not a distinct equipment type: the machine is whichever blower technology serves it. |
| 223 | Blanking Press  | Press › Blanking Press | A blanking press is a duty application of a press, not a distinct equipment type. |
| 249 | Powder Coating Booth  | Paint › Powder Coating Booth | Powder coating is a medium/method attribute of the same booth equipment. |
| 250 | E-Coat System  | Paint › E-Coat System | Names a coating SYSTEM (tank, rectifier, rinse, ultrafiltration), which is a line rather than one Type-level equipment identity. |
| 265 | Emergency Generator  | Electrical Equipment › Generator | Standby duty role, not a distinct machine type; the equipment is the generator set that performs it. |
| 268 | Dry Type Transformer  | Electrical Equipment › Transformer | Insulation/cooling-medium attribute of a transformer, not a distinct equipment type. |
| 270 | Low Voltage Switchgear  | Electrical Equipment › Switchgear | Voltage class attribute. M5R.4A section 6 explicitly excludes voltage alone as a basis for a distinct type. |
| 271 | Medium Voltage Switchgear  | Electrical Equipment › Switchgear | Voltage class attribute; same assembly with different ratings. |

### Customer-specific (CUSTOMER_SPECIFIC) — 0

None. No candidate in this corpus is customer/site/vendor terminology: no vendor or customer
names appear, and industry-specific equipment is handled by applicability rather than by
customer-specific identity.

**`TOO_BROAD_CONTAINER`** captures names that span several technologies and
therefore belong at Class level: a generic "gas compressor", a generic
"evaporator", a generic "dust collector", a generic "packaging machine".

**`NOT_EQUIPMENT_TYPE` (50) is the single largest non-retention group
(17.7%)**, and it is where the corpus's structural defect is concentrated. Four
recurring causes:

1. **Attributes presented as types** — enclosure protection (`TEFC`, `ODP`,
   `Weather Protected`, `Explosion Proof`), voltage class (`Low/Medium Voltage
   Switchgear`), insulation or cooling medium (`Dry Type`, `Oil Filled`, `GIS`,
   `Air-Insulated`, `Hydrogen-Cooled`, `Air-Cooled Condenser`), stem or disc
   arrangement, stage or lobe count, offset geometry, control mode.
2. **Components and maintainable items** — diffusers, perforated plates,
   impellers, brake assemblies, packing internals.
3. **Systems and technologies rather than equipment** — membrane processes
   (`Microfiltration`, `Ultrafiltration`, `Reverse Osmosis`), `SCR`, `E-Coat
   System`, molecular sieve desiccant.
4. **Pipelines and rig assemblies** — `Subsea Pipeline`, `Flowline`,
   `Gathering Line`, `Drawworks`, `Top Drive`.

**A structural finding worth the OWNER's attention:** **166 of the 282 (58.9%)**
candidate rows have a `type_name` **identical to their own class name**. The
corpus systematically created a class bearing the same name as its single type
(`Jaw Crusher` class → `Jaw Crusher` type). This is not a Type-level defect — the
type is legible — but it means **the Class level is largely a mirror of the Type
level** for most of the corpus, so the 311-class structure carries far less
independent engineering meaning than its size suggests. This is a Class-level
remediation subject for M5R.4B, recorded here rather than acted on.

**Category-level findings (65 categories).** The category list contains **two
parallel schemes at once** — a broad container scheme (`Rotating Equipment`,
`Static Equipment`, `Utility Equipment`, `Structures`, `Safety Systems`,
`SCADA`, `Piping Systems`, `Instrumentation and Control`, `Valves`,
`Heat Exchanger`) and a specific scheme (`Pump`, `Boiler`, `Milling`, …). Also
present: singular/plural duplicates (`Valve`/`Valves`), overlapping duplicates
(`Instrumentation`/`Instrumentation and Control`, `Compressor`/`General
Compressor`, `Heater`/`Heat Exchanger`), and electrical fragmentation across six
categories (`Electrical Equipment`, `Motor`, `Generator`, `Transformer`,
`Switchgear`, `UPS`).

**Equipment Family was NOT reintroduced.** No equipment **type** carries a
broad-container name — verified directly: the intersection of type names with
the broad-container list is empty. The container concepts exist only at
**Category** level, and 10 of the 65 categories with such names carry no types at
all. M5R.1 §2.1's permanent exclusion therefore holds at Type level, which this
mission preserves and does not reopen.

---

## 9. Standards-evidence status — explicitly absent

| Question | Answer |
|---|---|
| Are there populated external authority editions? | **No** — `knowledge_sources` / `knowledge_source_versions` carry no reconciliation-relevant rows |
| Are there populated external classifications? | **No** — the M5R.3 crosswalk tables are empty |
| Is there governed evidence supporting any decision? | **No** — no `crosswalk_id` or `external_classification_id` evidence exists |
| Were the legacy `iso_*` columns used? | **No** — `activity_codes.iso_maintenance_reference` and `cause_codes.iso_failure_cause_reference` remain `FALSE_PROVENANCE_REMEDIATION_REQUIRED` and were not consulted, converted or trusted |

**Therefore every disposition in this package rests on Atiman engineering
semantics and is recorded as such** — the companion JSONL carries the identical
`evidence` string on all 282 rows so no decision can later be mistaken for a
standards-backed one. **Nothing here is presented as ISO-supported, and no
mapping is proposed.** Populating the crosswalk is a separate governed activity
under M5R.3C/E, not this mission.

---

## 10. Decomposition referrals — 8

These candidates appear to belong **below** equipment Type. Subunits and
maintainable items remain an OPEN architecture area (M5R.1 §6.1), so they are
classified `NOT_EQUIPMENT_TYPE` and referred — **no decomposition architecture
is designed here**:

| Candidate | Likely lower-level concept |
|---|---|
| Fine Bubble Diffuser | maintainable item (aeration membrane/disc) |
| Coarse Bubble Diffuser | maintainable item (aeration diffuser) |
| Perforated Plate | component (screen medium) |
| Subsea Pipeline | system/asset, not a maintainable equipment unit |
| Flowline | pipeline segment |
| Gathering Line | pipeline segment |
| Drawworks | rig assembly/component |
| Top Drive | rig assembly |
| E-Coat System | coating line system |

**7 rows are additionally flagged** in the JSONL with `DECOMPOSITION_REFERRAL`
where the collapse itself depends on decomposition being settled: impeller
geometry (`Propeller Mixer`, `Paddle Mixer`), brake assemblies, column internals
(`Packed Column`, `Tray Column`), and bar-screen rake mechanisms
(`Mechanical Bar Screen`).

---

## 11. Industry applicability observations

`equipment_type_industries.jsonl` holds 647 rows and references **6 industries**
(`general`, `oil_gas`, `power_gen`, `water_ww`, `mining`, `chemical`) against
**282 equipment types** — every type is covered, with 1–6 industries each, and
criticality distributes A=308, B=295, C=44. **No dangling references:** all
industry ids are 1–6 and all equipment type ids resolve.

**Industry applicability does not create duplicate canonical identities**, and
this corpus does not use it that way. The reconciliation therefore keeps
canonical Type identity global and treats applicability as a relationship, as
§12 requires. **No type was duplicated for appearing in several industries.**

Two observations for M5R.4B: my first pass mis-read the row shape
`[equipment_type_id, industry_id, …]` and initially reported the reverse, which
would have produced a false "6 of 282 covered" finding — corrected before
publication, and recorded here so the correction is auditable. Second, mining and
oil-and-gas machinery currently sits under process-based categories rather than
an industry dimension, so applicability carries load that structural placement
should arguably carry.

---

## 12. Complete candidate decision matrix

The **complete** per-candidate matrix — all 282 rows, one record each, with
source provenance, current match, proposed category/class, disposition,
canonical name, canonical target, rationale, evidence status, confidence and
notes — is the companion artifact:

**`docs/research/m5r4a/equipment-type-reconciliation.jsonl`** (282 lines,
sha256 `bb87057a555f403e340d9a4a741201259a68aa06655cd46523b07a25ade7734e`)

It follows the repository's existing controlled-data convention
(`docs/research/**/*.jsonl`) and introduces no new framework. **It is a DECISION
CANDIDATE, not an executable seed:** no loader, migration or application startup
reads it, and nothing consumes it automatically. The full matrix is reproduced
below in human-readable form for review convenience.

### Appendix — full 282-row matrix

| # | Candidate | Source category › class | Disposition | Canonical name / target | Conf |
|---|---|---|---|---|---|
| 1 | End Suction Pump | Pump › Centrifugal Pump | `KEEP_EXISTING` | End Suction Pump | HIGH |
| 2 | Split Case Pump | Pump › Centrifugal Pump | `KEEP_EXISTING` | Split Case Pump | HIGH |
| 3 | Multistage Pump | Pump › Centrifugal Pump | `KEEP_EXISTING` | Multistage Centrifugal Pump | HIGH |
| 4 | Vertical Turbine | Pump › Centrifugal Pump | `KEEP_EXISTING` | Vertical Turbine Pump | HIGH |
| 5 | Submersible Centrifugal | Pump › Centrifugal Pump | `KEEP_EXISTING` | Submersible Centrifugal Pump | HIGH |
| 6 | Circulator Pump | Pump › Centrifugal Pump | `INSUFFICIENT_EVIDENCE` | — | LOW |
| 7 | Submersible Sewage Pump | Pump › Submersible Pump | `MERGE_DUPLICATE` | → Submersible Pump | HIGH |
| 8 | Submersible Drainage | Pump › Submersible Pump | `MERGE_DUPLICATE` | → Submersible Pump | HIGH |
| 9 | Submersible Slurry | Pump › Submersible Pump | `MERGE_DUPLICATE` | → Slurry Pump | HIGH |
| 10 | Plunger Pump | Pump › Reciprocating Pump | `KEEP_EXISTING` | Plunger Pump | HIGH |
| 11 | Piston Pump | Pump › Reciprocating Pump | `KEEP_EXISTING` | Piston Pump | HIGH |
| 12 | Hydraulic Diaphragm | Pump › Reciprocating Pump | `KEEP_EXISTING` | Hydraulic Diaphragm Pump | HIGH |
| 13 | TEFC Motor | Motor › AC Induction Motor | `ADD_TYPE` | AC Induction Motor | HIGH |
| 14 | ODP Motor | Motor › AC Induction Motor | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 15 | Weather Protected | Motor › AC Induction Motor | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 16 | Explosion Proof | Motor › AC Induction Motor | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 17 | Brake Motor | Motor › AC Induction Motor | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 18 | Variable Speed | Motor › AC Induction Motor | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 19 | Rising Stem Gate | Valve › Gate Valve | `ADD_TYPE` | Gate Valve | HIGH |
| 20 | Non-Rising Stem | Valve › Gate Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 21 | Knife Gate Valve | Valve › Gate Valve | `RECLASSIFY` | Knife Gate Valve | HIGH |
| 22 | Concentric Butterfly | Valve › Butterfly Valve | `ADD_TYPE` | Butterfly Valve | HIGH |
| 23 | Double Offset | Valve › Butterfly Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 24 | Triple Offset | Valve › Butterfly Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 25 | Swing Check | Valve › Check Valve | `ADD_TYPE` | Check Valve | HIGH |
| 26 | Lift Check | Valve › Check Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 27 | Dual Plate | Valve › Check Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 28 | Nozzle Check | Valve › Check Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 29 | Gauge Pressure | Instrumentation › Pressure Transmitter | `ADD_TYPE` | Pressure Transmitter | HIGH |
| 30 | Absolute Pressure | Instrumentation › Pressure Transmitter | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 31 | Differential Pressure | Instrumentation › Pressure Transmitter | `KEEP_EXISTING` | Differential Pressure Transmitter | HIGH |
| 32 | Hydrostatic Level | Instrumentation › Pressure Transmitter | `RECLASSIFY` | Hydrostatic Level Transmitter | HIGH |
| 33 | Electromagnetic | Instrumentation › Flow Meter | `ADD_TYPE` | Electromagnetic Flow Meter | HIGH |
| 34 | Ultrasonic | Instrumentation › Flow Meter | `SYNONYM_OR_ALIAS` | → Ultrasonic Flow Meter | HIGH |
| 35 | Vortex Shedding | Instrumentation › Flow Meter | `ADD_TYPE` | Vortex Flow Meter | HIGH |
| 36 | Turbine | Instrumentation › Flow Meter | `ADD_TYPE` | Turbine Flow Meter | HIGH |
| 37 | Orifice Plate | Instrumentation › Flow Meter | `MERGE_DUPLICATE` | → Orifice Plate Flow Meter | HIGH |
| 38 | Venturi Tube | Instrumentation › Flow Meter | `ADD_TYPE` | Venturi Flow Meter | HIGH |
| 39 | Radar Level | Instrumentation › Level Transmitter | `ADD_TYPE` | Radar Level Transmitter | HIGH |
| 40 | Ultrasonic Level | Instrumentation › Level Transmitter | `ADD_TYPE` | Ultrasonic Level Transmitter | HIGH |
| 41 | Capacitance | Instrumentation › Level Transmitter | `ADD_TYPE` | Capacitance Level Transmitter | HIGH |
| 42 | Float Switch | Instrumentation › Level Transmitter | `RECLASSIFY` | Float Level Switch | HIGH |
| 43 | RTD Sensor | Instrumentation › Temperature Sensor | `KEEP_EXISTING` | RTD Temperature Sensor | HIGH |
| 44 | Thermocouple | Instrumentation › Temperature Sensor | `KEEP_EXISTING` | Thermocouple | HIGH |
| 45 | Infrared | Instrumentation › Temperature Sensor | `KEEP_EXISTING` | Infrared Temperature Sensor | HIGH |
| 46 | Modular PLC | PLC › PLC Controller | `ADD_TYPE` | Programmable Logic Controller | HIGH |
| 47 | Compact PLC | PLC › PLC Controller | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 48 | Safety PLC | PLC › PLC Controller | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 49 | Single Stage Centrifugal | Blower › Centrifugal Blower | `ADD_TYPE` | Centrifugal Blower | HIGH |
| 50 | Multistage Centrifugal | Blower › Centrifugal Blower | `MERGE_DUPLICATE` | → Centrifugal Blower | HIGH |
| 51 | Twin Lobe Blower | Blower › Rotary Lobe Blower | `ADD_TYPE` | Rotary Lobe Blower | HIGH |
| 52 | Tri-Lobe Blower | Blower › Rotary Lobe Blower | `MERGE_DUPLICATE` | → Rotary Lobe Blower | HIGH |
| 53 | Oil Injected | Compressor › Screw Compressor | `MERGE_DUPLICATE` | → Screw Compressor | HIGH |
| 54 | Oil Free | Compressor › Screw Compressor | `MERGE_DUPLICATE` | → Screw Compressor | HIGH |
| 55 | Rapid Gravity Filter | Filter › Sand Filter | `KEEP_EXISTING` | Rapid Gravity Sand Filter | HIGH |
| 56 | Pressure Filter | Filter › Sand Filter | `MERGE_DUPLICATE` | → Pressure Filter | HIGH |
| 57 | Continuous Backwash | Filter › Sand Filter | `KEEP_EXISTING` | Continuous Backwash Sand Filter | HIGH |
| 58 | Microfiltration | Filter › Membrane Filter | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 59 | Ultrafiltration | Filter › Membrane Filter | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 60 | Reverse Osmosis | Filter › Membrane Filter | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 61 | Turbine Mixer | Mixer › Mechanical Mixer | `ADD_TYPE` | Mechanical Mixer | MEDIUM |
| 62 | Propeller Mixer | Mixer › Mechanical Mixer | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 63 | Paddle Mixer | Mixer › Mechanical Mixer | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 64 | Fine Bubble Diffuser | Mixer › Diffuser Aerator | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 65 | Coarse Bubble | Mixer › Diffuser Aerator | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 66 | Manual Bar Screen | Screen › Bar Screen | `ADD_TYPE` | Bar Screen | HIGH |
| 67 | Mechanical Bar Screen | Screen › Bar Screen | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 68 | Fine Step Screen | Screen › Step Screen | `KEEP_EXISTING` | Fine Step Screen | HIGH |
| 69 | Perforated Plate | Screen › Step Screen | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 70 | Shafted Screw | Conveyor › Screw Conveyor | `ADD_TYPE` | Screw Conveyor | HIGH |
| 71 | Shaftless Screw | Conveyor › Screw Conveyor | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 72 | Compact Screw | Conveyor › Screw Conveyor | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 74 | Haul Truck | Haulage › Haul Truck | `KEEP_EXISTING` | Haul Truck | HIGH |
| 75 | Articulated Dump Truck | Haulage › Dump Truck | `KEEP_EXISTING` | Articulated Dump Truck | HIGH |
| 76 | Wheel Loader | Haulage › Wheel Loader | `RECLASSIFY` | Wheel Loader | HIGH |
| 77 | Hydraulic Shovel | Excavation › Hydraulic Shovel | `KEEP_EXISTING` | Hydraulic Shovel | HIGH |
| 78 | Rope Shovel | Excavation › Rope Shovel | `KEEP_EXISTING` | Rope Shovel | HIGH |
| 79 | Bulldozer | Excavation › Bulldozer | `RECLASSIFY` | Bulldozer | HIGH |
| 80 | Motor Grader | Excavation › Motor Grader | `RECLASSIFY` | Motor Grader | HIGH |
| 81 | Rotary Drill | Drilling › Rotary Drill | `KEEP_EXISTING` | Rotary Drill | HIGH |
| 82 | DTH Drill | Drilling › DTH Drill | `KEEP_EXISTING` | Down-the-Hole Drill | HIGH |
| 83 | Roof Bolter | Drilling › Roof Bolter | `KEEP_EXISTING` | Roof Bolter | HIGH |
| 84 | Continuous Miner | Drilling › Continuous Miner | `RECLASSIFY` | Continuous Miner | MEDIUM |
| 85 | Longwall Shearer | Drilling › Longwall Shearer | `RECLASSIFY` | Longwall Shearer | MEDIUM |
| 86 | Jaw Crusher | Crushing › Jaw Crusher | `KEEP_EXISTING` | Jaw Crusher | HIGH |
| 87 | Cone Crusher | Crushing › Cone Crusher | `KEEP_EXISTING` | Cone Crusher | HIGH |
| 88 | Gyratory Crusher | Crushing › Gyratory Crusher | `KEEP_EXISTING` | Gyratory Crusher | HIGH |
| 89 | Impact Crusher | Crushing › Impact Crusher | `KEEP_EXISTING` | Impact Crusher | HIGH |
| 90 | SAG Mill | Milling › SAG Mill | `KEEP_EXISTING` | SAG Mill | HIGH |
| 91 | Ball Mill | Milling › Ball Mill | `KEEP_EXISTING` | Ball Mill | HIGH |
| 92 | Rod Mill | Milling › Rod Mill | `KEEP_EXISTING` | Rod Mill | HIGH |
| 93 | Vertical Mill | Milling › Vertical Mill | `KEEP_EXISTING` | Vertical Mill | HIGH |
| 94 | Overland Conveyor | Conveyor › Overland Conveyor | `ADD_TYPE` | Belt Conveyor | HIGH |
| 95 | Bucket Elevator | Conveyor › Bucket Elevator | `KEEP_EXISTING` | Bucket Elevator | HIGH |
| 96 | Apron Feeder | Conveyor › Apron Feeder | `RECLASSIFY` | Apron Feeder | MEDIUM |
| 97 | Vibrating Feeder | Conveyor › Vibrating Feeder | `RECLASSIFY` | Vibrating Feeder | HIGH |
| 98 | Mine Dewatering Pump | Pump › Mine Dewatering Pump | `KEEP_EXISTING` | Mine Dewatering Pump | MEDIUM |
| 99 | Slurry Pump | Pump › Slurry Pump | `KEEP_EXISTING` | Slurry Pump | HIGH |
| 100 | Mine Hoist | Gearbox › Mine Hoist | `RECLASSIFY` | Mine Hoist | HIGH |
| 101 | Winder Motor | Motor › Winder Motor | `MERGE_DUPLICATE` | → AC Induction Motor | MEDIUM |
| 102 | Gas Detector | Instrumentation › Gas Detector | `KEEP_EXISTING` | Gas Detector | HIGH |
| 103 | Mine Ventilation Fan | Blower › Mine Ventilation Fan | `RECLASSIFY` | Mine Ventilation Fan | MEDIUM |
| 104 | Wellhead Assembly | Wellhead › Wellhead Assembly | `KEEP_EXISTING` | Wellhead Assembly | HIGH |
| 105 | Christmas Tree | Wellhead › Christmas Tree | `KEEP_EXISTING` | Christmas Tree | HIGH |
| 106 | Production Separator | Separator › Production Separator | `KEEP_EXISTING` | Production Separator | HIGH |
| 107 | Test Separator | Separator › Test Separator | `MERGE_DUPLICATE` | → Production Separator | MEDIUM |
| 108 | Coalescer | Separator › Coalescer | `KEEP_EXISTING` | Coalescer | HIGH |
| 109 | Heater Treater | Heater › Heater Treater | `KEEP_EXISTING` | Heater Treater | HIGH |
| 110 | Indirect Heater | Heater › Indirect Heater | `RECLASSIFY` | Indirect Heater | MEDIUM |
| 111 | Gas Compressor | Compressor › Gas Compressor | `TOO_BROAD_CONTAINER` | — | HIGH |
| 112 | Reciprocating Compressor | Compressor › Reciprocating Compressor | `ADD_TYPE` | Reciprocating Compressor | HIGH |
| 113 | Screw Compressor | Compressor › Screw Compressor | `ADD_TYPE` | Screw Compressor | HIGH |
| 114 | Subsea Pipeline | Pipeline › Subsea Pipeline | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 115 | Flowline | Pipeline › Flowline | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 116 | Gathering Line | Pipeline › Gathering Line | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 117 | Pig Launcher | Pipeline › Pig Launcher | `ADD_TYPE` | Pig Launcher | HIGH |
| 118 | Pig Receiver | Pipeline › Pig Receiver | `MERGE_DUPLICATE` | → Pig Launcher | MEDIUM |
| 119 | Bullet Tank | Storage Tank › Bullet Tank | `KEEP_EXISTING` | Bullet Tank | HIGH |
| 120 | Spherical Tank | Storage Tank › Spherical Tank | `KEEP_EXISTING` | Spherical Storage Tank | HIGH |
| 121 | API Atmospheric Tank | Storage Tank › API Tank | `KEEP_EXISTING` | Atmospheric Storage Tank | HIGH |
| 122 | Flare Stack | Flare › Flare Stack | `KEEP_EXISTING` | Flare Stack | HIGH |
| 123 | Enclosed Flare | Flare › Enclosed Flare | `KEEP_EXISTING` | Enclosed Ground Flare | HIGH |
| 124 | Shell and Tube Exchanger | Heater › Shell and Tube Exchanger | `RECLASSIFY` | Shell and Tube Heat Exchanger | HIGH |
| 125 | Plate Exchanger | Heater › Plate Exchanger | `RECLASSIFY` | Plate Heat Exchanger | HIGH |
| 126 | Air Cooler | Heater › Air Cooler | `RECLASSIFY` | Air-Cooled Heat Exchanger | HIGH |
| 127 | TEG Dehydrator | Treatment › Dehydrator | `KEEP_EXISTING` | Glycol Dehydration Unit | HIGH |
| 128 | Molecular Sieve | Treatment › Molecular Sieve | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 129 | Orifice Meter | Metering › Orifice Meter | `SYNONYM_OR_ALIAS` | → Orifice Plate Flow Meter | HIGH |
| 130 | Ultrasonic Meter | Metering › Ultrasonic Meter | `ADD_TYPE` | Ultrasonic Flow Meter | HIGH |
| 131 | Coriolis Meter | Metering › Coriolis Meter | `ADD_TYPE` | Coriolis Flow Meter | HIGH |
| 132 | Multiphase Meter | Metering › Multiphase Meter | `ADD_TYPE` | Multiphase Flow Meter | HIGH |
| 133 | Slug Catcher | Treatment › Slug Catcher | `KEEP_EXISTING` | Slug Catcher | HIGH |
| 134 | Blowout Preventer | BOP › Blowout Preventer | `RECLASSIFY` | Blowout Preventer | HIGH |
| 135 | Triplex Mud Pump | Pump › Triplex Pump | `KEEP_EXISTING` | Triplex Mud Pump | HIGH |
| 136 | Drawworks | Rig › Drawworks | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 137 | Top Drive | Rig › Top Drive | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 138 | Shale Shaker | Treatment › Shale Shaker | `KEEP_EXISTING` | Shale Shaker | HIGH |
| 139 | Desander | Treatment › Desander | `KEEP_EXISTING` | Desander | HIGH |
| 140 | Desilter | Treatment › Desilter | `MERGE_DUPLICATE` | → Desander | MEDIUM |
| 141 | Subsea Tree | Subsea › Subsea Tree | `SYNONYM_OR_ALIAS` | → Christmas Tree | HIGH |
| 142 | Subsea Manifold | Subsea › Subsea Manifold | `KEEP_EXISTING` | Subsea Manifold | HIGH |
| 143 | Gas Turbine | Turbine › Gas Turbine | `KEEP_EXISTING` | Gas Turbine | HIGH |
| 144 | Steam Turbine | Turbine › Steam Turbine | `KEEP_EXISTING` | Steam Turbine | HIGH |
| 145 | Aero-Derivative Gas Turbine | Turbine › Aero Gas Turbine | `MERGE_DUPLICATE` | → Gas Turbine | MEDIUM |
| 146 | HRSG | HRSG › HRSG | `ADD_TYPE` | Heat Recovery Steam Generator | HIGH |
| 147 | Triple Pressure HRSG | HRSG › Triple Pressure HRSG | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 148 | Drum Boiler | Boiler › Drum Boiler | `KEEP_EXISTING` | Drum Boiler | HIGH |
| 149 | Once-Through Boiler | Boiler › Once-Through Boiler | `KEEP_EXISTING` | Once-Through Boiler | HIGH |
| 150 | Coal Pulverizer | Milling › Coal Pulverizer | `KEEP_EXISTING` | Coal Pulverizer | HIGH |
| 151 | Condenser | Cooling › Condenser | `KEEP_EXISTING` | Condenser | HIGH |
| 152 | Air-Cooled Condenser | Cooling › Air-Cooled Condenser | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 153 | Mechanical Draft Cooling Tower | Cooling › Cooling Tower | `RECLASSIFY` | Cooling Tower | HIGH |
| 154 | Natural Draft Cooling Tower | Cooling › Natural Draft Tower | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 155 | Boiler Feed Pump | Pump › Boiler Feed Pump | `KEEP_EXISTING` | Boiler Feed Pump | HIGH |
| 156 | Condensate Pump | Pump › Condensate Pump | `KEEP_EXISTING` | Condensate Pump | MEDIUM |
| 157 | Circulating Water Pump | Pump › Circulating Water Pump | `KEEP_EXISTING` | Circulating Water Pump | HIGH |
| 158 | Turbo Generator | Generator › Generator | `INSUFFICIENT_EVIDENCE` | — | LOW |
| 159 | Hydrogen-Cooled Generator | Generator › Hydrogen-Cooled Generator | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 160 | Step-Up Transformer | Transformer › Step-Up Transformer | `MERGE_DUPLICATE` | → Power Transformer | HIGH |
| 161 | Unit Transformer | Transformer › Unit Transformer | `MERGE_DUPLICATE` | → Power Transformer | HIGH |
| 162 | GIS Switchgear | Switchgear › GIS Switchgear | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 163 | Air-Insulated Switchgear | Switchgear › Air-Insulated Switchgear | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 164 | SCR | Pollution Control › Selective Catalytic Reduction | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 165 | ESP | Pollution Control › Electrostatic Precipitator | `KEEP_EXISTING` | Electrostatic Precipitator | HIGH |
| 166 | Baghouse Filter | Pollution Control › Baghouse Filter | `RECLASSIFY` | Baghouse Dust Collector | HIGH |
| 167 | Wet Scrubber | Pollution Control › Wet Scrubber | `ADD_TYPE` | Scrubber | MEDIUM |
| 168 | Dry Scrubber | Pollution Control › Dry Scrubber | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 169 | Chimney/Stack | Stack › Chimney | `KEEP_EXISTING` | Chimney | MEDIUM |
| 170 | Bottom Ash Conveyor | Ash Handling › Bottom Ash Conveyor | `KEEP_EXISTING` | Bottom Ash Conveyor | MEDIUM |
| 171 | Fly Ash Silo | Ash Handling › Fly Ash Silo | `MERGE_DUPLICATE` | → Storage Silo | HIGH |
| 172 | Stacker | Ash Handling › Stacker | `KEEP_EXISTING` | Stacker | HIGH |
| 173 | Reclaimer | Ash Handling › Reclaimer | `KEEP_EXISTING` | Reclaimer | HIGH |
| 174 | Limestone Slurry Pump | Pump › Limestone Slurry Pump | `MERGE_DUPLICATE` | → Slurry Pump | HIGH |
| 175 | FGD Absorber | Treatment › FGD Absorber | `KEEP_EXISTING` | FGD Absorber | MEDIUM |
| 176 | Deaerator | Treatment › Deaerator | `KEEP_EXISTING` | Deaerator | HIGH |
| 177 | LP Feedwater Heater | Heater › LP Heater | `RECLASSIFY` | Feedwater Heater | MEDIUM |
| 178 | HP Feedwater Heater | Heater › HP Heater | `MERGE_DUPLICATE` | → Feedwater Heater | MEDIUM |
| 179 | Batch Reactor | Reactor › Batch Reactor | `KEEP_EXISTING` | Batch Reactor | MEDIUM |
| 180 | CSTR | Reactor › CSTR | `KEEP_EXISTING` | Continuous Stirred Tank Reactor | HIGH |
| 181 | Plug Flow Reactor | Reactor › Plug Flow Reactor | `KEEP_EXISTING` | Plug Flow Reactor | HIGH |
| 182 | Fixed Bed Reactor | Reactor › Fixed Bed Reactor | `KEEP_EXISTING` | Fixed Bed Reactor | HIGH |
| 183 | Fluidized Bed Reactor | Reactor › Fluidized Bed Reactor | `KEEP_EXISTING` | Fluidized Bed Reactor | HIGH |
| 184 | Distillation Column | Distillation › Distillation Column | `KEEP_EXISTING` | Distillation Column | HIGH |
| 185 | Packed Column | Distillation › Packed Column | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 186 | Tray Column | Distillation › Tray Column | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 187 | Reactive Distillation Column | Distillation › Reactive Distillation | `KEEP_EXISTING` | Reactive Distillation Column | MEDIUM |
| 188 | Double Pipe Heat Exchanger | Heater › Double Pipe Exchanger | `RECLASSIFY` | Double Pipe Heat Exchanger | HIGH |
| 189 | Spiral Heat Exchanger | Heater › Spiral Exchanger | `RECLASSIFY` | Spiral Heat Exchanger | HIGH |
| 190 | Agitated Vessel | Mixer › Agitated Vessel | `INSUFFICIENT_EVIDENCE` | — | LOW |
| 191 | Jet Mixer | Mixer › Jet Mixer | `KEEP_EXISTING` | Jet Mixer | HIGH |
| 192 | Static Mixer | Mixer › Static Mixer | `KEEP_EXISTING` | Static Mixer | HIGH |
| 193 | Rotary Dryer | Drying › Rotary Dryer | `KEEP_EXISTING` | Rotary Dryer | HIGH |
| 194 | Spray Dryer | Drying › Spray Dryer | `KEEP_EXISTING` | Spray Dryer | HIGH |
| 195 | Fluid Bed Dryer | Drying › Fluid Bed Dryer | `KEEP_EXISTING` | Fluid Bed Dryer | HIGH |
| 196 | Freeze Dryer | Drying › Freeze Dryer | `KEEP_EXISTING` | Freeze Dryer | HIGH |
| 197 | Decanter Centrifuge | Chemical Separation › Decanter Centrifuge | `KEEP_EXISTING` | Decanter Centrifuge | HIGH |
| 198 | Basket Centrifuge | Chemical Separation › Basket Centrifuge | `KEEP_EXISTING` | Basket Centrifuge | HIGH |
| 199 | Disc Stack Centrifuge | Chemical Separation › Disc Stack Centrifuge | `KEEP_EXISTING` | Disc Stack Centrifuge | HIGH |
| 200 | Pressure Filter | Chemical Separation › Pressure Filter | `KEEP_EXISTING` | Pressure Filter | HIGH |
| 201 | Rotary Vacuum Filter | Chemical Separation › Rotary Vacuum Filter | `RECLASSIFY` | Rotary Vacuum Filter | HIGH |
| 202 | Belt Filter | Chemical Separation › Belt Filter | `RECLASSIFY` | Belt Filter Press | HIGH |
| 203 | Leaf Filter | Chemical Separation › Leaf Filter | `RECLASSIFY` | Leaf Filter | HIGH |
| 204 | Storage Silo | Storage Tank › Storage Silo | `KEEP_EXISTING` | Storage Silo | HIGH |
| 205 | Day Bin | Storage Tank › Day Bin | `MERGE_DUPLICATE` | → Storage Silo | MEDIUM |
| 206 | Chemical Transfer Pump | Pump › Chemical Transfer Pump | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 207 | Metering Pump | Pump › Metering Pump | `KEEP_EXISTING` | Metering Pump | HIGH |
| 208 | Magnetic Drive Pump | Pump › Mag Drive Pump | `KEEP_EXISTING` | Magnetic Drive Pump | HIGH |
| 209 | Diaphragm Compressor | Compressor › Diaphragm Compressor | `KEEP_EXISTING` | Diaphragm Compressor | HIGH |
| 210 | Liquid Ring Compressor | Compressor › Liquid Ring Compressor | `KEEP_EXISTING` | Liquid Ring Compressor | HIGH |
| 211 | Process Blower | Blower › Process Blower | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 212 | Crystallizer | Treatment › Crystallizer | `KEEP_EXISTING` | Crystallizer | HIGH |
| 213 | Evaporator | Treatment › Evaporator | `TOO_BROAD_CONTAINER` | — | HIGH |
| 214 | Falling Film Evaporator | Treatment › Falling Film Evaporator | `KEEP_EXISTING` | Falling Film Evaporator | HIGH |
| 215 | Forced Circulation Evaporator | Treatment › Forced Circulation Evaporator | `KEEP_EXISTING` | Forced Circulation Evaporator | HIGH |
| 216 | CNC Milling Machine | CNC Machine › CNC Mill | `KEEP_EXISTING` | CNC Milling Machine | HIGH |
| 217 | CNC Lathe | CNC Machine › CNC Lathe | `KEEP_EXISTING` | CNC Lathe | HIGH |
| 218 | Grinding Machine | CNC Machine › Grinding Machine | `RECLASSIFY` | Grinding Machine | MEDIUM |
| 219 | EDM Machine | CNC Machine › EDM Machine | `RECLASSIFY` | Electrical Discharge Machine | MEDIUM |
| 220 | Hydraulic Press | Press › Hydraulic Press | `KEEP_EXISTING` | Hydraulic Press | HIGH |
| 221 | Mechanical Press | Press › Mechanical Press | `KEEP_EXISTING` | Mechanical Press | HIGH |
| 222 | Servo Press | Press › Servo Press | `KEEP_EXISTING` | Servo Press | HIGH |
| 223 | Blanking Press | Press › Blanking Press | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 224 | Injection Molding Machine | Injection Molding › Injection Molding Machine | `KEEP_EXISTING` | Injection Molding Machine | HIGH |
| 225 | Blow Molding Machine | Injection Molding › Blow Molding Machine | `RECLASSIFY` | Blow Molding Machine | MEDIUM |
| 226 | Extrusion Machine | Injection Molding › Extrusion Machine | `RECLASSIFY` | Extrusion Machine | HIGH |
| 227 | Thermoforming Machine | Injection Molding › Thermoforming Machine | `RECLASSIFY` | Thermoforming Machine | MEDIUM |
| 228 | Articulated Robot | Robot › Articulated Robot | `KEEP_EXISTING` | Articulated Robot | HIGH |
| 229 | SCARA Robot | Robot › SCARA Robot | `KEEP_EXISTING` | SCARA Robot | HIGH |
| 230 | Cartesian Robot | Robot › Cartesian Robot | `KEEP_EXISTING` | Cartesian Robot | HIGH |
| 231 | Collaborative Robot | Robot › Collaborative Robot | `KEEP_EXISTING` | Collaborative Robot | HIGH |
| 232 | Roller Conveyor | Conveyor › Roller Conveyor | `KEEP_EXISTING` | Roller Conveyor | HIGH |
| 233 | Chain Conveyor | Conveyor › Chain Conveyor | `KEEP_EXISTING` | Chain Conveyor | HIGH |
| 234 | Overhead Conveyor | Conveyor › Overhead Conveyor | `KEEP_EXISTING` | Overhead Conveyor | MEDIUM |
| 235 | Forklift | Material Handling › Forklift | `KEEP_EXISTING` | Forklift | HIGH |
| 236 | Reach Truck | Material Handling › Reach Truck | `KEEP_EXISTING` | Reach Truck | HIGH |
| 237 | Order Picker | Material Handling › Order Picker | `KEEP_EXISTING` | Order Picker | HIGH |
| 238 | Pallet Jack | Material Handling › Pallet Jack | `KEEP_EXISTING` | Pallet Jack | MEDIUM |
| 239 | Rotary Screw Compressor | General Compressor › Rotary Screw Compressor | `MERGE_DUPLICATE` | → Screw Compressor | HIGH |
| 240 | Reciprocating Air Compressor | General Compressor › Reciprocating Air Compressor | `MERGE_DUPLICATE` | → Reciprocating Compressor | HIGH |
| 241 | Centrifugal Air Compressor | General Compressor › Centrifugal Air Compressor | `ADD_TYPE` | Centrifugal Compressor | HIGH |
| 242 | Rooftop HVAC Unit | HVAC Equipment › Rooftop Unit | `KEEP_EXISTING` | Rooftop HVAC Unit | HIGH |
| 243 | Chiller | HVAC Equipment › Chiller | `KEEP_EXISTING` | Chiller | HIGH |
| 244 | Air Handling Unit | HVAC Equipment › Air Handling Unit | `KEEP_EXISTING` | Air Handling Unit | HIGH |
| 245 | Dust Collector | Dust Collection › Dust Collector | `TOO_BROAD_CONTAINER` | — | HIGH |
| 246 | Cartridge Collector | Dust Collection › Cartridge Collector | `KEEP_EXISTING` | Cartridge Dust Collector | HIGH |
| 247 | Cyclone Separator | Dust Collection › Cyclone Separator | `RECLASSIFY` | Cyclone Separator | MEDIUM |
| 248 | Spray Booth | Paint › Spray Booth | `ADD_TYPE` | Spray Booth | MEDIUM |
| 249 | Powder Coating Booth | Paint › Powder Coating Booth | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 250 | E-Coat System | Paint › E-Coat System | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 251 | MIG Welder | Welding › MIG Welder | `KEEP_EXISTING` | MIG Welding Machine | HIGH |
| 252 | TIG Welder | Welding › TIG Welder | `KEEP_EXISTING` | TIG Welding Machine | HIGH |
| 253 | Resistance Welder | Welding › Resistance Welder | `KEEP_EXISTING` | Resistance Welding Machine | HIGH |
| 254 | Packaging Machine | Packaging › Packaging Machine | `TOO_BROAD_CONTAINER` | — | HIGH |
| 255 | Palletizer | Packaging › Palletizer | `KEEP_EXISTING` | Palletizer | HIGH |
| 256 | Case Packer | Packaging › Case Packer | `KEEP_EXISTING` | Case Packer | HIGH |
| 257 | Labeling Machine | Packaging › Labeling Machine | `KEEP_EXISTING` | Labelling Machine | HIGH |
| 258 | Shrink Wrapper | Packaging › Shrink Wrapper | `KEEP_EXISTING` | Shrink Wrapper | HIGH |
| 259 | Automated Guided Vehicle | Material Handling › AGV | `KEEP_EXISTING` | Automated Guided Vehicle | HIGH |
| 260 | AC Motor | Electrical Equipment › Motor | `MERGE_DUPLICATE` | → AC Induction Motor | HIGH |
| 261 | DC Motor | Electrical Equipment › Motor | `KEEP_EXISTING` | DC Motor | HIGH |
| 262 | Synchronous Motor | Electrical Equipment › Motor | `KEEP_EXISTING` | Synchronous Motor | HIGH |
| 263 | Submersible Motor | Electrical Equipment › Motor | `KEEP_EXISTING` | Submersible Motor | HIGH |
| 264 | Diesel Generator | Electrical Equipment › Generator | `KEEP_EXISTING` | Diesel Generator Set | HIGH |
| 265 | Emergency Generator | Electrical Equipment › Generator | `NOT_EQUIPMENT_TYPE` | — | MEDIUM |
| 266 | Power Transformer | Electrical Equipment › Transformer | `KEEP_EXISTING` | Power Transformer | HIGH |
| 267 | Distribution Transformer | Electrical Equipment › Transformer | `KEEP_EXISTING` | Distribution Transformer | HIGH |
| 268 | Dry Type Transformer | Electrical Equipment › Transformer | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 269 | Oil Filled Transformer | Electrical Equipment › Transformer | `MERGE_DUPLICATE` | → Power Transformer | MEDIUM |
| 270 | Low Voltage Switchgear | Electrical Equipment › Switchgear | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 271 | Medium Voltage Switchgear | Electrical Equipment › Switchgear | `NOT_EQUIPMENT_TYPE` | — | HIGH |
| 272 | Motor Control Center | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Motor Control Center | HIGH |
| 273 | Air Circuit Breaker | Electrical Equipment › Switchgear | `ADD_TYPE` | Circuit Breaker | HIGH |
| 274 | Vacuum Circuit Breaker | Electrical Equipment › Switchgear | `MERGE_DUPLICATE` | → Circuit Breaker | HIGH |
| 275 | Distribution Panel | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Distribution Panel | MEDIUM |
| 276 | Control Panel | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Control Panel | MEDIUM |
| 277 | Uninterruptible Power Supply | Electrical Equipment › Power Backup Equipment | `KEEP_EXISTING` | Uninterruptible Power Supply | HIGH |
| 278 | Battery Bank | Electrical Equipment › Power Backup Equipment | `KEEP_EXISTING` | Battery Bank | HIGH |
| 279 | Variable Frequency Drive | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Variable Frequency Drive | HIGH |
| 280 | Soft Starter | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Soft Starter | HIGH |
| 281 | Rectifier | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Rectifier | HIGH |
| 282 | Inverter | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Inverter | HIGH |
| 283 | Capacitor Bank | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Capacitor Bank | HIGH |

---

## 13. Proposed M5R.4B implementation plan (STOP before implementing)

**Nothing below has been executed.** This is the plan the OWNER would approve.

**Shape: ADDITIVE ONLY**, exactly as M5R.1 §10 step 5 requires. No equipment
category, class or type is deleted; no existing identity is destroyed.

1. **Add 30 canonical types** under the classes named in §5, using the
   recommended canonical names. These are new rows, not renames of existing ones
   where the existing row is itself being merged.
2. **Reclassify 31 types** by changing `class_id` (and the owning
   category where the class also moves). Reclassification is a placement change,
   not a new identity.
3. **Resolve 25 merges and 3 synonyms.** Because deletion
   is forbidden, each displaced row becomes either a recorded synonym of its
   canonical target or is retired by an explicit, auditable status — **neither
   mechanism exists today**, so M5R.4B needs a decided, approved way to express
   "this identity is superseded by that one". This is the single largest open
   question and is why acquisition is staged below.
4. **Retire 50 + 4 + 3 rows from Type level**
   (57 candidates) without deleting the
   engineering vocabulary they carry, and record the 8 decomposition
   referrals for the decomposition decision.
5. **Class-level remediation** — the 166 same-name class/type pairs and the 65
   → proposed category consolidation, including singular/plural and
   fragmented-electrical merges.
6. **Applicability** — retain, or rebuild on the consolidated identities.

**Expected data implications:** tens of new type rows; roughly a hundred
placement changes; roughly eighty rows leaving Type level in some recorded form;
plus class and category consolidation. **No schema change is required** to hold
the dispositions — `equipment_types` already supports the placements — **except**
for whatever mechanism the OWNER approves to record "superseded by" and
"synonym of" without deleting rows. If that mechanism is judged to need a
schema change, it requires its own approved migration; **M5R.4B must not create
one unilaterally.**

**Sequencing recommendation:** split M5R.4B into (B1) the synonym/merge
mechanism decision and (B2) additive application, so that the largest open
question is settled before rows start moving.

**STOP.** Nothing in this section is authorised by this mission.

---

## 14. Explicitly NOT changed

- **No taxonomy mutation.** No equipment category, class or type row was inserted,
  updated or deleted. No seed file was modified.
- **No migration.** Migrations 001–018 are byte-identical to `main`;
  **migration 019 does not exist**.
- **No crosswalk or evidence population.** No `knowledge_sources`,
  `knowledge_source_versions`, `external_classification`,
  `equipment_type_external_classification` or evidence row was created.
- **No standards content.** No licensed text, classification table or annex was
  reproduced, and no ISO identity is claimed anywhere in this package.
- **No false-provenance remediation.** The `iso_*` columns were not touched,
  converted or consulted.
- **No Equipment Family.** Not reintroduced, and no type is made a container.
- **No decomposition architecture.** Referrals only.
- **No customer alias architecture.** `CUSTOMER_SPECIFIC` is zero and no alias
  storage is designed.
- **No M6, no UI, no ATM-002, no maintenance-knowledge work.**
- **No production access**, no Render change, no deployment, no merge.
- **No unrelated defect fixed.**

---

## 15. VUDA results

| # | Attack | Finding |
|---|---|---|
| A | Did legacy data become canonical merely because it existed? | **No.** The live corpus is explicitly recorded as *unratified candidate identity* (M5R.1 §10), and 116 of 282 candidates were NOT retained as-is. |
| B | Did string differences create fake equipment types? | **No** — the reverse was found. 25 merges and 3 synonyms remove distinctions that exist only as strings (duty, medium, stage, lobe, offset, voltage, enclosure). |
| C | Were real engineering distinctions collapsed as synonyms? | **No.** Distinct crushers, mills, compressors, robots, machine tools, valves and instruments were all retained. Only construction/duty *attributes* were collapsed; each is recorded with its rationale so the call is reviewable. |
| D | Did Category/Class concepts leak into Type? | **4 `TOO_BROAD_CONTAINER`** rows found and reclassified upward. Broad-container names appear **only** at Category level, never as a Type. |
| E | Did subunits/components leak into Type? | **Yes — 50 rows (17.7%)**, the largest defect class. Referred, not absorbed; no decomposition designed. |
| F | Did customer terminology leak into global taxonomy? | **No.** `CUSTOMER_SPECIFIC` = 0; industry-specific machinery was retained as industry *applicability*, not customer identity. |
| G | Did industry applicability create duplicate identities? | **No.** 282 types × 6 industries with no duplicate canonical identity; applicability is a relationship. |
| H | Was ISO or another standard falsely presented as authority? | **No.** The `evidence` field states absence on all 282 rows; no mapping was proposed and no ISO identity claimed. |
| I | Did any legacy ISO-looking field become trusted evidence? | **No.** The `iso_*` columns were not consulted; `FALSE_PROVENANCE_REMEDIATION_REQUIRED` stands. |
| J | Were unresolved candidates guessed? | **No.** 3 rows carry `INSUFFICIENT_EVIDENCE` where two defensible readings exist and the corpus cannot choose. |
| K | Was Equipment Family reintroduced? | **No.** Verified directly: no Type carries a broad-container name. |
| L | Did any candidate disappear from the accounting? | **No.** 282 in = 282 out, exactly once each, machine-checked; two literal raw duplicates are reported separately. |
| M | Did the reconciliation modify production taxonomy? | **No.** Documentation and one data artefact only; no DB write outside a disposable container. |
| N | Did M5R.4A start designing decomposition? | **No.** Referrals only; the boundary is explicitly left open. |
| O | Did crosswalk population leak into scope? | **No.** Zero rows created in any crosswalk or classification table. |
| P | Did M6 maintenance knowledge leak into scope? | **No.** |
| Q | Did UI/ATM-002 leak into scope? | **No.** |
| R | Are proposed canonical names vendor/customer neutral? | **Yes** by construction: vendor names are absent from the corpus, and abbreviations (`HRSG`, `CSTR`, `ESP`) were expanded to engineering-recognisable names. |
| S | Are disposition totals mathematically complete? | **Yes** — §4 balances to 282, verified programmatically. |
| T | Can another engineer reproduce the corpus and decisions? | **Yes** — exact source path, row count, sha256, per-row `source_row` back-reference, recorded rationale, confidence and evidence status. |

**Residual: BLOCKER = 0, MAJOR = 0.**

**Deviations disclosed:** my first drafting pass mis-read the applicability row
shape and reported a wrong coverage figure (corrected in §11, before
publication), and 4 of the 282 rows were initially missing from the decision
table — caught by the coverage check, not by inspection. Both were found by the
machine checks this mission built for exactly that purpose.

---

## 16. Validation

- Accepted baseline confirmed exact (`13f68bad…`) before branch creation.
- No database migration added; migrations 001–018 byte-identical to `main`; 019 absent.
- No taxonomy or seed mutation; no production data touched.
- Reconciliation totals balance (282 = 282) and every candidate appears exactly once.
- Companion JSONL parses (282 valid JSON objects, one per line); it is read by no
  loader, migration or runtime path.
- No `src/` change; no test or tooling change; the existing suite is untouched and
  therefore remains green by construction.
