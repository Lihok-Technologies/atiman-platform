# ATM-001 M5R.4A — Equipment Type Reconciliation Decision Package

**Status: DECISION CANDIDATE (R1) — NO TAXONOMY MUTATION. NOT IMPLEMENTED.**

This record reconciles the broader Atiman candidate equipment-type corpus
(historically reported as "approximately 282 equipment types") against the
accepted canonical model. It **classifies and proposes**; it does not change the
taxonomy.

**Revision R1 — engineering semantic correction.** Chief Architect review found
the M5R.4A dispositions too willing to collapse materially different engineering
knowledge under the labels *attribute*, *medium*, *voltage*, *duty*,
*construction* and *geometry*. R1 re-applies the governing Type-level test across
the whole challenge population and **reverses 32 dispositions** across 6 of the 9
categories. Corpus provenance and the 282-row accounting are unchanged and remain
reproducible.

**Revision R1.1 — challenge ledger integrity correction.** Chief Architect
inspection found R1's published challenge accounting internally inconsistent
(a stated population of 129 against 37 CHANGED + 102 UPHELD = 139) and two
mandatory challenges with blank machine-readable verdicts. The ledger is now
reconstructed from evidence (see §3.2): the deduplicated challenge population is
**141**, with **37 CHANGED** and **104 UPHELD**. **No R1 engineering decision was
changed by R1.1** — the correction is accounting and record only.

| | |
|---|---|
| Baseline | `origin/main` = `13f68bad311e7740e1a53247bf79f7275d9218a0` |
| Migration chain | 001–018 unchanged; **no 019** |
| Companion data | `docs/research/m5r4a/equipment-type-reconciliation.jsonl` |
| Companion sha256 | `2ee6fb48b8bbe8a3e9efe83d72e41aabd7843d5fb2d3334ea7a112794a736e9e` |
| Candidate corpus sha256 | `c1a310585e9ba4af8bdee232b8b328bbda3dd1687d83f867629c8152991f1b77` |
| Method | M5R.1 §10, deterministic and non-destructive |
| Challenge population | **141 rows** (deduplicated union, §3.2); every one carries a recorded verdict |

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

**Why earlier work said "282".** M5R.1 §10 records the live seed as *"65
categories / 311 classes / 282 types / 647 industry rows"*, and ATM-013 records
the same 282 each carrying three shared templates. The figure is the literal row
count of `equipment_types.jsonl` — never an engineering estimate. **Verified: 282.**

**How it is loaded.** `scripts/bootstrap-knowledge/bootstrap.js` is, per the
README, *"a one-time manual operation, never a deployment step"*, and it
*"requires its target tables to be empty"*. Migrations create the taxonomy
**structure only**: a freshly migrated database contains 0 categories, 0 classes
and 0 types.

**Source identifier gap (recorded, not an omission):** candidate ids run **1–283
with id 73 absent** — 282 rows. Each candidate is identified by its original `id`
and echoed as `source_row`, so the gap can never be mistaken for a dropped record.

**Literal duplicate rows in the raw corpus:** exactly two — `type_code = COMPACT`
(Conveyor › Screw Conveyor and PLC › PLC Controller) and
`type_name = "Pressure Filter"` (Chemical Separation and Filter › Sand Filter).
No `(class_id, type_code)` pair is duplicated.

**The two corpora are largely different knowledge sets.** Normalised-name
intersection between the 282 and the 60-type design artifact
(`database/odm_legacy_equipment_taxonomy_design.v1.json`, sha256 `cf7eece15c84c7fb7114b5470c209e30370d87803fef25d4d6a632ca21fd60be`,
**not seeded**) is **10 of 282 (3.5%)**. M5R.1 §1's warning is confirmed empirically.

---

## 2. Current canonical baseline — four things, never collapsed

| | Dataset | Counts | Status |
|---|---|---|---|
| **A** | Current canonical Atiman taxonomy | model `Category → Class → Type`; content 65/311/**282**/647 | **model** OWNER-approved (M5R.1 §2, Equipment Family excluded); **type identities unratified** — M5R.1 §10 records all 282 as `CANDIDATE_EQUIPMENT_IDENTITIES` defaulting to `NEEDS_RESEARCH` |
| **B** | Cleaned legacy design artifact | 10/42/60 types, 288 subunits, 376 MIs | `LEGACY_BEHAVIOR`, not seeded |
| **C** | Broader candidate corpus | **282** | the reconciliation subject |
| **D** | External standard classifications | **0** | the M5R.3 crosswalk exists and is empty |

**A and C are the same artifact.** Atiman has an approved canonical *model* and an
*unratified* canonical content; there is no already-ratified type set beyond the
282. Identity scheme: integer `id`, `type_code` unique within a class.
Coverage: 54 of 65 categories carry types; 98 of 311 classes carry none.

---

## 3. Reconciliation method

M5R.1 §10 followed in order: structural pass → crosswalk/evidence pass →
disposition → engineer review → **additive** application. The evidence pass could
not be performed (no standards evidence exists) and that absence is recorded on
every row. **Additive application remains deliberately unexecuted.**

### 3.1 The governing test applied in R1

A distinction justifies a separate Type where it materially changes one or more of:
**maintenance strategy · inspection regime · failure mechanisms · reliability
characteristics · safety controls · operating principle · maintainable
decomposition · engineering knowledge package.**

A distinction is an **attribute** — not a Type — only when it changes selection,
materials or ratings but leaves that list intact. Two operating principles were
used to keep the line consistent rather than case-by-case:

- **P1 — specification attribute.** Changing it alters what you *buy*, not what
  you *do*: stem arrangement on a gate valve, PLC form factor, shaft presence on a
  screw conveyor, lobe count, staging, network role of a transformer, the material
  a silo stores.
- **P2 — Type-making distinction.** Changing it alters the maintenance task set,
  the inspection regime, the failure-mode family, the safety controls or the
  operating principle: arc-quenching medium of a circuit breaker, oil versus dry
  insulation of a transformer, wet versus dry scrubbing, natural versus mechanical
  draught, gas versus air insulation, impeller-less versus oil-flooded screw
  compression, aero-derivative versus heavy-duty maintenance strategy.

R1's finding is that M5R.4A applied **P1 too widely** — several characteristics
that are P2 were treated as P1.

### 3.2 Challenge population — the R1.1 ledger

R1 published this as "129 rows". That was **wrong**, and the error is worth
recording precisely because it is easy to repeat. Three distinct populations were
being conflated:

| # | Population | Definition | Size |
|---|---|---|---|
| 1 | **Programmatic set** | rows matching the stated rule — rationale contains a collapse word OR disposition is one of `NOT_EQUIPMENT_TYPE`, `MERGE_DUPLICATE`, `SYNONYM_OR_ALIAS`, `TOO_BROAD_CONTAINER` | **137** |
| 2 | **Mandatory set** | the 16 rows named by the Chief Architect in the R1 mission | **16** |
| 3 | **Additional deliberately reviewed** | rows given a verdict during R1 that the rule does not select and the mandate does not name | **2** |
| | **Deduplicated union (the challenge population)** | 1 ∪ 2 ∪ 3 | **141** |

**The programmatic set must be evaluated against the PRE-R1 state.** R1's
rationales and dispositions were themselves rewritten by R1, so applying the rule
to the post-R1 file drops rows that R1 had already reversed — the reversed row no
longer contains the collapse word that caused it to be selected, and its
disposition has left the four high-risk values. Applied to the post-R1 state the
rule yields only 129; applied to the pre-R1 state (commit `1381906`, the reviewed
M5R.4A candidate) it yields the correct **137**.

The eight rows that silently disappeared from the rule after R1 rewrote them —
each of which R1 had reversed to `KEEP_EXISTING` and re-worded:

| # | Candidate | Pre-R1 disposition | Post-R1 |
|---|---|---|---|
| 24 | Triple Offset | `NOT_EQUIPMENT_TYPE` | `KEEP_EXISTING` |
| 29 | Gauge Pressure | `ADD_TYPE` | `ADD_TYPE` (rationale re-worded) |
| 48 | Safety PLC | `NOT_EQUIPMENT_TYPE` | `KEEP_EXISTING` |
| 54 | Oil Free | `MERGE_DUPLICATE` | `KEEP_EXISTING` |
| 58 | Microfiltration | `NOT_EQUIPMENT_TYPE` | `KEEP_EXISTING` |
| 59 | Ultrafiltration | `NOT_EQUIPMENT_TYPE` | `KEEP_EXISTING` |
| 141 | Subsea Tree | `SYNONYM_OR_ALIAS` | `KEEP_EXISTING` |
| 274 | Vacuum Circuit Breaker | `MERGE_DUPLICATE` | `KEEP_EXISTING` |

**The two additional deliberately reviewed rows** are `6 — Circulator Pump` and
`158 — Turbo Generator`. Both hold `INSUFFICIENT_EVIDENCE`, so the rule does not
select them and the mandate does not name them, yet R1 expressly reviewed them and
recorded an `UPHELD` verdict. They are therefore part of the population.

**Overlap.** 14 of the 16 mandatory rows are also inside the programmatic set. The
two that are not — `106 — Production Separator` and `139 — Desander`, both
`KEEP_EXISTING` with no collapse word in their rationales — are exactly the two
whose R1 machine-readable verdicts were left blank. R1's own completeness check
tested only the programmatic set, so it reported "all challenged rows carry a
verdict" while those two mandatory challenges were empty. **R1.1 encodes both from
the R1 report, where each was recorded `UPHELD`; no new engineering conclusion was
drawn.**

**Reconciliation:** the union is 141 rows, and 141 `challenge_review` fields are
populated — 37 `CHANGED`, 104 `UPHELD`, no other verdict state, and no verdict
carried by a row outside the union. 282 − 141 = 141 rows were outside the
challenge population.

---

## 4. Disposition summary — complete and balanced (after R1)

| Disposition | Before | **After** | Δ | Share | M5R.1 §10 equivalent |
|---|---|---|---|---|---|
| `KEEP_EXISTING` | 136 | **165** | +29 | 58.5% | `RETAIN` |
| `NOT_EQUIPMENT_TYPE` | 50 | **29** | -21 | 10.3% | `COMPONENT_NOT_EQUIPMENT` / `APPLICATION_NOT_EQUIPMENT` |
| `RECLASSIFY` | 31 | **33** | +2 | 11.7% | `RECLASSIFY` |
| `ADD_TYPE` | 30 | **29** | -1 | 10.3% | `RETAIN` (new identity) |
| `MERGE_DUPLICATE` | 25 | **17** | -8 | 6.0% | `MERGE` / `DUPLICATE` |
| `TOO_BROAD_CONTAINER` | 4 | **4** | +0 | 1.4% | structural (abstract-container risk) |
| `INSUFFICIENT_EVIDENCE` | 3 | **3** | +0 | 1.1% | `NEEDS_RESEARCH` |
| `SYNONYM_OR_ALIAS` | 3 | **2** | -1 | 0.7% | `RENAME` |
| `CUSTOMER_SPECIFIC` | 0 | **0** | +0 | 0.0% | (M5R.1 §6.2) |
| **TOTAL** | **282** | **282** | | **100.0%** | |

**Balance (machine-checked):** 165 + 29 + 33 + 29 + 17 + 4 + 3 + 2 + 0 = **282** = the reconstructed corpus size. Every candidate appears **exactly once**.

**Confidence after R1:** HIGH **231** · MEDIUM **48** · LOW **3**
(before: HIGH 233 · MEDIUM 46 · LOW 3). Rows reversed to retention were set to the
confidence their engineering basis supports — HIGH where the distinction is
established engineering practice (oil versus dry insulation, wet versus dry
scrubbing, LV/MV safety regimes, GIS/AIS, aero-derivative maintenance strategy),
MEDIUM where the call is defensible but closer (desilter, test separator, subsea
tree, membrane units, mechanical bar screen, absolute-pressure transmitter,
triple-offset valve, electrocoat, powder booth).

**`CUSTOMER_SPECIFIC` remains genuinely zero.** No vendor or customer name appears
in the corpus; industry-specific machinery is *industry* terminology and belongs to
applicability, not to customer-specific identity.

---

## 5. Mandatory challenge set — all 16 re-evaluated

Each row was tested against the eight questions in §2 of the R1 mission
(independently maintainable? different inspection? different failure modes?
different safety? different operating principle? different knowledge package?
terminology or engineering semantics?). Result: **13 dispositions reversed, 3 upheld.**

| Candidate | M5R.4A | **R1** | Governing-test answer |
|---|---|---|---|
| Drawworks | `NOT_EQUIPMENT_TYPE` | **`RECLASSIFY`** | Independently maintainable machine — drum, brakes, clutch, gearbox, lubrication — with a brake/rope inspection regime carrying direct safety consequence. The defect was placement under a category named "Rig". |
| Top Drive | `NOT_EQUIPMENT_TYPE` | **`RECLASSIFY`** | Motor, gearbox, pipe handler, IBOP, swivel and control system; its own inspection and failure-mode knowledge. |
| Air-Cooled Condenser | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Finned bundles, fans, motors, gearboxes; fin fouling, vibration and freezing are the dominant concerns. A water-cooled condenser shares none of it. |
| Wet Scrubber | `ADD_TYPE` | **`KEEP_EXISTING`** | Wet and dry scrubbing are different machines, not one machine with a medium: vessel, spray/venturi/packed internals, recirculation pumps, mist eliminators, corrosion/erosion knowledge. |
| Dry Scrubber | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Reagent-injection reactor plus solids handling; dry-solids and wet-dry-interface failure modes a wet scrubber does not have. |
| Desander | `KEEP_EXISTING` | **`KEEP_EXISTING`** | Upheld. Distinct solids-control stage with its own cone geometry and wear pattern. |
| Desilter | `MERGE_DUPLICATE` | **`KEEP_EXISTING`** | Distinct stage of the mud circuit: different cone geometry, cut point, wear pattern and position. Cut size alone was never the distinction. |
| Dry-Type Transformer | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | No oil means no DGA, no oil filtration, no breather; partial discharge in resin becomes the dominant failure concern and fire safety is why it is chosen indoors. |
| Oil-Filled Transformer | `MERGE_DUPLICATE` | **`KEEP_EXISTING`** | Oil sampling and dissolved gas analysis, filtration, silica gel breathers, Buchholz protection, leak and bund management — a whole maintenance package discarded as a "role". |
| Low Voltage Switchgear | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Voltage class changes insulation and clearance philosophy, arc-flash energy and therefore PPE and boundary controls, and the test regime. Safety controls are a limb of the test. |
| Medium Voltage Switchgear | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Adds partial-discharge and high-potential testing, racking and interlock maintenance, and a materially different arc-flash regime. |
| Air Circuit Breaker | `ADD_TYPE` | **`KEEP_EXISTING`** | Arc-quenching medium is an operating principle: contact and arc-chute inspection at low voltage is not vacuum-interrupter testing at medium voltage. |
| Vacuum Circuit Breaker | `MERGE_DUPLICATE` | **`KEEP_EXISTING`** | Vacuum-bottle integrity and contact-wear assessment on a different failure model from an air breaker. |
| Test Separator | `MERGE_DUPLICATE` | **`KEEP_EXISTING`** | Smaller, heavily instrumented, frequently reconfigured vessel; duty cycle, control philosophy and maintenance pattern differ from a permanent production separator. |
| Production Separator | `KEEP_EXISTING` | **`KEEP_EXISTING`** | Upheld. |
| Aero-Derivative Gas Turbine | `MERGE_DUPLICATE` | **`KEEP_EXISTING`** | Design lineage is not an attribute when it determines how the machine is maintained: modular removal and exchange versus on-site overhaul, with different intervals and access. |

---

## 6. Additional challenged rows — reversals

Beyond the mandatory set, the same error was found and corrected in **19 further rows**:

| Candidate | M5R.4A | **R1** | Basis |
|---|---|---|---|
| Explosion Proof motor | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Hazardous-area certification imposes a distinct inspection and compliance regime (flameproof joints, glands, Ex registers, certified repair). |
| Triple Offset butterfly valve | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Torque-seated metal seat, fire-safe and high-temperature; different sealing principle, torque and seat-replacement work. |
| Absolute Pressure transmitter | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Sealed reference is a different construction with a different failure mechanism (reference drift) from a vented gauge transmitter (blocked vent). Also restores consistency with the flow-meter decisions. |
| Safety PLC | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Safety-integrity proof testing, certified configuration and change control, documented functional test intervals. |
| Microfiltration / Ultrafiltration / Reverse Osmosis | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Distinct membranes, pretreatment, flux and cleaning chemistry; reverse osmosis is maintained around high-pressure pumps and scale control, with scaling rather than fouling as the dominant failure. |
| Mechanical Bar Screen | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Rake, drive, chains or cables, overload protection and jam/wear failure modes — a machine, not a static rack with a cleaning method. |
| Molecular Sieve | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Twin-tower cyclic operation, switching valves, regeneration gas heating, periodic sieve replacement. Not glycol dehydration knowledge. |
| Natural Draft Cooling Tower | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Hyperbolic civil shell with no fans, drives or gearboxes; almost no maintenance knowledge is shared with a mechanical draught tower. |
| GIS / Air-Insulated Switchgear | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Gas density monitoring, moisture and decomposition-product control, gas handling and leak management, and a different competency and safety regime — versus cleanliness, clearance and partial discharge. |
| Powder Coating Booth | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Electrostatic powder application, powder recovery and reclaim, no solvent regime, explosion-dust controls. |
| Electrocoat System | `NOT_EQUIPMENT_TYPE` | **`KEEP_EXISTING`** | Bath chemistry, rectifier and busbar integrity, ultrafiltration and rinse stages, curing. |
| Oil-Injected / Oil-Free Screw Compressor | `MERGE_DUPLICATE` | **`KEEP_EXISTING`** | Lubrication arrangement is an operating principle: an oil-flooded machine carries oil separation, filtration, analysis and carry-over control; an oil-free machine is gear-timed and runs dry rotors with coatings. |
| Subsea Tree | `SYNONYM_OR_ALIAS` | **`KEEP_EXISTING`** | ROV or diver intervention, subsea control modules, hydrate and insulation management, no routine access. Function is shared; maintenance reality is not. |
| Orifice Plate (Instrumentation) | `MERGE_DUPLICATE` | **`ADD_TYPE`** | Accounting correction: the canonical identity needed an originating row, and the Metering duplicate resolves here as the naming variant. |
| Gauge Pressure transmitter | `ADD_TYPE` (generic) | **`ADD_TYPE`** (named) | Renamed from the generic "Pressure Transmitter": gauge, absolute and differential are the Type-level identities, exactly as measurement principles are under flow. |

---

## 7. Challenged rows whose disposition stands

**104 of the 141 challenged rows were upheld**, each with its governing-test reason
recorded in the `challenge_review` field. The recurring reasons, with examples:

| Reason | Rows | Why the collapse is correct |
|---|---|---|
| Enclosure attribute | ODP motor, Weather Protected | Cooling and ingress suitability change; bearing, lubrication, insulation-resistance and vibration work does not. |
| Stem / disc arrangement | Non-rising stem, lift check, dual plate, nozzle check | Same sealing principle, same packing and seat work, same failure family (reverse leakage, chatter, seat wear). |
| Impeller geometry | Propeller mixer, paddle mixer | Impeller is the maintainable item; shaft, gearbox, seal and bearing work is identical. |
| Component, not identity | Fine/coarse bubble diffuser, perforated plate, brake assembly | Replaced items belonging to decomposition. |
| Construction attribute | Shaftless screw, compact screw, multistaging, lobe count | Same machine with the same casing, bearing, seal and rotor maintenance family. |
| Duty qualifier | Chemical transfer pump, process blower, blanking press, emergency generator, variable-speed motor | Names the service performed, discharged by whichever machine is selected — as distinct from recognised engineered machine designations (boiler feed, condensate, mine dewatering), which were retained. |
| Medium / material stored | Submersible sewage and drainage, limestone slurry, fly-ash silo, day bin, air versus gas service, HP/LP feedwater stage | Changes materials and selection, not the machine identity or its maintenance family. |
| Network / service role | Step-up transformer, unit transformer, pig receiver | Discharged by the same equipment identity; direction, role or stage is an attribute. |
| Generic container | Gas compressor, evaporator, dust collector, packaging machine | Each spans four distinct technologies; a name covering four machines is a Class, not a Type. |
| Cross-category duplicate | AC motor, Pressure Filter, Ultrasonic flow meter, Rotary screw compressor | The same identity is carried twice; one canonical identity must win. |
| Pipeline / linear asset | Subsea pipeline, flowline, gathering line | Maintained through integrity-management programmes, not as a maintainable equipment unit. |
| Column internals | Packed column, tray column | Packing and trays are internals, replaced as maintainable items. |
| Insufficient evidence | Circulator pump, turbo generator, agitated vessel | Two defensible readings remain; recording ambiguity is more honest than guessing. |

---

## 7A. Proposed additions — `ADD_TYPE` (29)

Legitimate Type-level identities the corpus holds only as a class name or as
attribute rows. Every one is derived from a row already in the corpus; none is
invented. The variant rows resolve into them.

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 13 | TEFC Motor as **AC Induction Motor** | Motor › AC Induction Motor | The corpus holds only enclosure variants here; the Type-level identity is the AC induction motor itself. |
| 19 | Rising Stem Gate as **Gate Valve** | Valve › Gate Valve | Stem arrangement is an attribute; the corpus never states the Type-level identity, which is the gate valve. |
| 22 | Concentric Butterfly as **Butterfly Valve** | Valve › Butterfly Valve | Seat/offset geometry is an attribute; the Type-level identity is the butterfly valve. |
| 25 | Swing Check as **Check Valve** | Valve › Check Valve | Disc arrangement is an attribute; the Type-level identity is the check valve. |
| 29 | Gauge Pressure as **Gauge Pressure Transmitter** | Instrumentation › Pressure Transmitter | Name corrected from the generic "Pressure Transmitter". Gauge, absolute and differential measurement are the Type-level identities under this class, exactly as electromagnetic, vortex and turbine principles are under flow measurement; a generic "pressure transmitter" would be the class, not a type. |
| 33 | Electromagnetic as **Electromagnetic Flow Meter** | Instrumentation › Flow Meter | Distinct operating principle with its own installation and maintenance requirements. |
| 35 | Vortex Shedding as **Vortex Flow Meter** | Instrumentation › Flow Meter | Distinct operating principle with specific Reynolds-number and piping requirements. |
| 36 | Turbine as **Turbine Flow Meter** | Instrumentation › Flow Meter | Distinct operating principle with rotating parts, filtration needs and its own wear profile. |
| 37 | Orifice Plate as **Orifice Plate Flow Meter** | Instrumentation › Flow Meter | RECLASSIFIED from MERGE_DUPLICATE so the canonical identity has an originating row: the Metering category duplicate resolves here as the naming variant. |
| 38 | Venturi Tube as **Venturi Flow Meter** | Instrumentation › Flow Meter | Distinct differential-producing primary element with different pressure loss and wear behaviour. |
| 39 | Radar Level as **Radar Level Transmitter** | Instrumentation › Level Transmitter | Distinct non-contact measurement principle with its own installation and tuning regime. |
| 40 | Ultrasonic Level as **Ultrasonic Level Transmitter** | Instrumentation › Level Transmitter | Distinct non-contact principle, distinguishable from radar by medium and application limits. |
| 41 | Capacitance as **Capacitance Level Transmitter** | Instrumentation › Level Transmitter | Distinct contact measurement principle with dielectric-dependent behaviour. |
| 46 | Modular PLC as **Programmable Logic Controller** | PLC › PLC Controller | The corpus holds only form-factor variants; the Type-level identity is the PLC. |
| 49 | Single Stage Centrifugal as **Centrifugal Blower** | Blower › Centrifugal Blower | Stage count is an attribute; the corpus never states the Type-level identity, which is the centrifugal blower. |
| 51 | Twin Lobe Blower as **Rotary Lobe Blower** | Blower › Rotary Lobe Blower | Lobe count is an attribute; the Type-level identity is the rotary lobe blower. |
| 61 | Turbine Mixer as **Mechanical Mixer** | Mixer › Mechanical Mixer | Impeller geometry is a component attribute; the Type-level identity is the mechanical mixer. |
| 66 | Manual Bar Screen as **Bar Screen** | Screen › Bar Screen | Cleaning method is an attribute; the Type-level identity is the bar screen. |
| 70 | Shafted Screw as **Screw Conveyor** | Conveyor › Screw Conveyor | Shaft presence is an attribute; the Type-level identity is the screw conveyor. |
| 94 | Overland Conveyor as **Belt Conveyor** | Conveyor › Overland Conveyor | Overland is a layout/duty qualifier; the belt conveyor is the Type-level identity and is otherwise unrepresented. |
| 112 | Reciprocating Compressor as **Reciprocating Compressor** | Compressor › Reciprocating Compressor | Stated here as a type while also existing as air-service in another category; one canonical identity only. |
| 113 | Screw Compressor as **Screw Compressor** | Compressor › Screw Compressor | Stated here as a type while also existing in the General Compressor category; one canonical identity only. |
| 117 | Pig Launcher as **Pig Launcher** | Pipeline › Pig Launcher | A launcher barrel is a discrete pressure vessel with its own closure and inspection regime. |
| 130 | Ultrasonic Meter as **Ultrasonic Flow Meter** | Metering › Ultrasonic Meter | Distinct operating principle; this is the canonical identity the Instrumentation duplicate resolves to. |
| 131 | Coriolis Meter as **Coriolis Flow Meter** | Metering › Coriolis Meter | Distinct mass-flow measurement principle with its own installation and zero-point regime. |
| 132 | Multiphase Meter as **Multiphase Flow Meter** | Metering › Multiphase Meter | Distinct measurement duty requiring phase-fraction computation; separate engineering package. |
| 146 | HRSG as **Heat Recovery Steam Generator** | HRSG › HRSG | The corpus states an abbreviation; the Type-level identity is the heat recovery steam generator. |
| 241 | Centrifugal Air Compressor as **Centrifugal Compressor** | General Compressor › Centrifugal Air Compressor | The Type-level identity is the centrifugal compressor; air service is a duty qualifier. |
| 248 | Spray Booth as **Spray Booth** | Paint › Spray Booth | Coating medium is an attribute; the Type-level identity is the spray booth. |

## 7B. Proposed reclassifications — `RECLASSIFY` (33)

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 21 | Knife Gate Valve as **Knife Gate Valve** | Valve › Gate Valve | Genuinely distinct isolation valve (shear disc, slurry service); misplaced as a gate valve variant. |
| 32 | Hydrostatic Level as **Hydrostatic Level Transmitter** | Instrumentation › Pressure Transmitter | Measures level, not pressure; belongs to level measurement and is a distinct equipment identity. |
| 42 | Float Switch as **Float Level Switch** | Instrumentation › Level Transmitter | A switch is not a transmitter: different function, different maintenance, distinct equipment identity. |
| 76 | Wheel Loader as **Wheel Loader** | Haulage › Wheel Loader | A loader is loading equipment, not a haulage machine; distinct machine, wrong category. |
| 79 | Bulldozer as **Bulldozer** | Excavation › Bulldozer | Earthmoving machine, not excavation loading equipment; distinct type, wrong category. |
| 80 | Motor Grader as **Motor Grader** | Excavation › Motor Grader | Earthmoving/levelling machine, not excavation equipment; distinct type, wrong category. |
| 84 | Continuous Miner as **Continuous Miner** | Drilling › Continuous Miner | A cutting/mining machine, not a drilling machine; distinct type, wrong category. |
| 85 | Longwall Shearer as **Longwall Shearer** | Drilling › Longwall Shearer | A longwall cutting machine, not a drilling machine; distinct type, wrong category. |
| 96 | Apron Feeder as **Apron Feeder** | Conveyor › Apron Feeder | A feeder is not a conveyor; distinct machine with its own duty and wear regime. |
| 97 | Vibrating Feeder as **Vibrating Feeder** | Conveyor › Vibrating Feeder | Distinct vibrating machine, not a conveyor; own drive and spring maintenance. |
| 100 | Mine Hoist as **Mine Hoist** | Gearbox › Mine Hoist | A mine hoist is a winding machine, not a gearbox; distinct type with its own safety regime. |
| 103 | Mine Ventilation Fan as **Mine Ventilation Fan** | Blower › Mine Ventilation Fan | A fan is not a blower; recognised distinct mining ventilation machine, wrongly categorised. |
| 110 | Indirect Heater as **Indirect Heater** | Heater › Indirect Heater | Legitimate process heater; placement needs class review against heat-transfer equipment. |
| 124 | Shell and Tube Exchanger as **Shell and Tube Heat Exchanger** | Heater › Shell and Tube Exchanger | A heat exchanger is not a heater; belongs to heat-transfer equipment. |
| 125 | Plate Exchanger as **Plate Heat Exchanger** | Heater › Plate Exchanger | Legitimate heat-transfer equipment misplaced under Heater. |
| 126 | Air Cooler as **Air-Cooled Heat Exchanger** | Heater › Air Cooler | Forced-draught air cooler is heat-transfer equipment with fan and fin maintenance. |
| 134 | Blowout Preventer as **Blowout Preventer** | BOP › Blowout Preventer | Recognised well-control equipment; the corpus category is an abbreviation and adds no level. |
| 136 | Drawworks as **Drawworks** | Rig › Drawworks | REVERSED from NOT_EQUIPMENT_TYPE. A drawworks is not a rig component: it is a large, independently maintained machine with its own drum, band or disc brakes, clutch, gearbox, motor and lubrication system, and a brake-and-rope inspection regime that carries direct safety consequence. It fails the M5R.4A collapse test on maintenance strategy, inspection regime, failure mechanisms and safety controls simultaneously. Its placement under a category literally named "Rig" was the real defect. |
| 137 | Top Drive as **Top Drive** | Rig › Top Drive | REVERSED from NOT_EQUIPMENT_TYPE. A top drive is an independently maintained machine: drive motor, gearbox, pipe handler, internal blowout preventer, swivel and control system, with its own inspection and failure-mode knowledge. Pushing it into unresolved decomposition destroyed useful identity, which is precisely the error this correction exists to fix. |
| 153 | Mechanical Draft Cooling Tower as **Cooling Tower** | Cooling › Cooling Tower | Correct Type-level identity, but a cooling tower is utility heat rejection, not a condenser. |
| 166 | Baghouse Filter as **Baghouse Dust Collector** | Pollution Control › Baghouse Filter | A baghouse is a dust collector; correct placement is with dust collection, not emission control. |
| 177 | LP Feedwater Heater as **Feedwater Heater** | Heater › LP Heater | Legitimate heat-transfer equipment; pressure stage is an attribute, so it resolves to one identity. |
| 188 | Double Pipe Heat Exchanger as **Double Pipe Heat Exchanger** | Heater › Double Pipe Exchanger | Legitimate heat-transfer equipment misplaced under Heater. |
| 189 | Spiral Heat Exchanger as **Spiral Heat Exchanger** | Heater › Spiral Exchanger | Legitimate heat-transfer equipment misplaced under Heater. |
| 201 | Rotary Vacuum Filter as **Rotary Vacuum Filter** | Chemical Separation › Rotary Vacuum Filter | Legitimate filtration equipment placed under a process-function container; belongs with filtration equipment. |
| 202 | Belt Filter as **Belt Filter Press** | Chemical Separation › Belt Filter | Legitimate dewatering equipment; correct under filtration/dewatering, not chemical separation. |
| 203 | Leaf Filter as **Leaf Filter** | Chemical Separation › Leaf Filter | Legitimate pressure-leaf filtration equipment; same reclassification rationale. |
| 218 | Grinding Machine as **Grinding Machine** | CNC Machine › Grinding Machine | Distinct machine tool, but grinding is not necessarily CNC; correct under machine tools. |
| 219 | EDM Machine as **Electrical Discharge Machine** | CNC Machine › EDM Machine | Distinct machine tool using a different material-removal principle; correct under machine tools. |
| 225 | Blow Molding Machine as **Blow Molding Machine** | Injection Molding › Blow Molding Machine | Blow molding is not injection molding; distinct type, wrong category. |
| 226 | Extrusion Machine as **Extrusion Machine** | Injection Molding › Extrusion Machine | Extrusion is a different process from injection molding; distinct type, wrong category. |
| 227 | Thermoforming Machine as **Thermoforming Machine** | Injection Molding › Thermoforming Machine | Thermoforming is not injection molding; distinct type, wrong category. |
| 247 | Cyclone Separator as **Cyclone Separator** | Dust Collection › Cyclone Separator | Distinct separation device, not a dust collector; own erosion and pressure-drop considerations. |

## 7C. Proposed merges and synonyms — `MERGE_DUPLICATE` (17) and `SYNONYM_OR_ALIAS` (2)

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 7 | Submersible Sewage Pump → **Submersible Pump** | Pump › Submersible Pump | Duty/medium qualifier of the same submersible pump machine; impeller selection is a design attribute, not a separate type. |
| 8 | Submersible Drainage → **Submersible Pump** | Pump › Submersible Pump | Duty qualifier of submersible pump; differs by impeller/head selection, not by equipment type. |
| 9 | Submersible Slurry → **Slurry Pump** | Pump › Submersible Pump | Submersible variant of the slurry pump already represented by its own type; resolves to one canonical identity. |
| 50 | Multistage Centrifugal → **Centrifugal Blower** | Blower › Centrifugal Blower | Multistaging is a construction attribute of the same machine. |
| 52 | Tri-Lobe Blower → **Rotary Lobe Blower** | Blower › Rotary Lobe Blower | Lobe count is a construction attribute of the same machine. |
| 56 | Pressure Filter → **Pressure Filter** | Filter › Sand Filter | Duplicate identity: the same pressure filter is also held under Chemical Separation. |
| 101 | Winder Motor → **AC Induction Motor** | Motor › Winder Motor | Application qualifier of an induction motor; the winder duty does not create a distinct machine type. |
| 118 | Pig Receiver → **Pig Launcher** | Pipeline › Pig Receiver | Receiver and launcher are the same vessel in opposite service; service direction is an attribute. |
| 160 | Step-Up Transformer → **Power Transformer** | Transformer › Step-Up Transformer | Network role qualifier of a power transformer, not a distinct machine type. |
| 161 | Unit Transformer → **Power Transformer** | Transformer › Unit Transformer | Network role qualifier of a power transformer, not a distinct machine type. |
| 171 | Fly Ash Silo → **Storage Silo** | Ash Handling › Fly Ash Silo | A silo is the equipment type; the stored material does not create a second canonical identity. |
| 174 | Limestone Slurry Pump → **Slurry Pump** | Pump › Limestone Slurry Pump | Lime/limestone slurry is a medium qualifier of the slurry pump already represented. |
| 178 | HP Feedwater Heater → **Feedwater Heater** | Heater › HP Heater | Pressure stage is an attribute of the same feedwater heater. |
| 205 | Day Bin → **Storage Silo** | Storage Tank › Day Bin | A day bin is a small silo; scale is a selection attribute, not a distinct equipment type. |
| 239 | Rotary Screw Compressor → **Screw Compressor** | General Compressor › Rotary Screw Compressor | Duplicate identity: "rotary screw" and "screw" name the same machine type. |
| 240 | Reciprocating Air Compressor → **Reciprocating Compressor** | General Compressor › Reciprocating Air Compressor | Air is the service medium; the machine type is already represented. |
| 260 | AC Motor → **AC Induction Motor** | Electrical Equipment › Motor | Duplicate identity: the Motor category already carries the AC induction motor; two categories cannot both own it. |

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 34 | Ultrasonic → **Ultrasonic Flow Meter** | Instrumentation › Flow Meter | The same instrument named without its head noun; a naming variant, not a second identity. |
| 129 | Orifice Meter → **Orifice Plate Flow Meter** | Metering › Orifice Meter | UPHELD. "Orifice Meter" is the same instrument named without "plate"; a naming variant of the identity the Instrumentation row now carries. |

## 7D. Container, non-Type and customer-specific concepts

`TOO_BROAD_CONTAINER` (4) and `NOT_EQUIPMENT_TYPE` (29):

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 111 | Gas Compressor | Compressor › Gas Compressor | Generic duty descriptor spanning many compressor technologies; belongs at Class level, not Type. |
| 213 | Evaporator | Treatment › Evaporator | Generic technology term that is a container for the falling-film and forced-circulation types already carried. |
| 245 | Dust Collector | Dust Collection › Dust Collector | Generic container spanning baghouse, cartridge, cyclone and scrubber technologies; belongs at Class level. |
| 254 | Packaging Machine | Packaging › Packaging Machine | Generic container spanning palletisers, case packers, labellers and wrappers; belongs at Class level. |

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 14 | ODP Motor | Motor › AC Induction Motor | Enclosure protection attribute (open drip proof) of an AC induction motor, not a distinct equipment type. |
| 15 | Weather Protected | Motor › AC Induction Motor | Enclosure protection attribute (weather protected), not a distinct equipment type. |
| 17 | Brake Motor | Motor › AC Induction Motor | UPHELD on re-review. The integral brake is a maintainable item bolted to a motor, not a different machine, so its adjustment and lining wear belong to decomposition rather than to Type identity. |
| 18 | Variable Speed | Motor › AC Induction Motor | Duty/speed-control attribute; a variable-speed motor is an induction motor plus a drive. |
| 20 | Non-Rising Stem | Valve › Gate Valve | Stem arrangement attribute of a gate valve, not a distinct equipment type. |
| 23 | Double Offset | Valve › Butterfly Valve | UPHELD on re-review. A double-offset valve remains a resilient-seated butterfly valve: the same sealing family, the same inspection tasks and the same failure modes as the concentric design, with geometry alone distinguishing it. |
| 26 | Lift Check | Valve › Check Valve | Disc arrangement attribute of a check valve. |
| 27 | Dual Plate | Valve › Check Valve | Disc arrangement attribute of a check valve. |
| 28 | Nozzle Check | Valve › Check Valve | Disc arrangement attribute of a check valve. |
| 47 | Compact PLC | PLC › PLC Controller | Form-factor attribute of a PLC (also a duplicated type_code across classes). |
| 62 | Propeller Mixer | Mixer › Mechanical Mixer | Impeller geometry attribute; the impeller itself belongs to decomposition. |
| 63 | Paddle Mixer | Mixer › Mechanical Mixer | Impeller geometry attribute; the impeller itself belongs to decomposition. |
| 64 | Fine Bubble Diffuser | Mixer › Diffuser Aerator | A diffuser is a component (membrane/disc) of an aeration system, not a Type-level equipment identity. |
| 65 | Coarse Bubble | Mixer › Diffuser Aerator | A diffuser is a component of an aeration system; decomposition referral, not Type. |
| 69 | Perforated Plate | Screen › Step Screen | UPHELD on re-review. A perforated plate is the screening medium itself, a replaceable component of a screen, and its specification belongs to the screen rather than to a separate equipment identity. |
| 71 | Shaftless Screw | Conveyor › Screw Conveyor | Shaft presence construction attribute of a screw conveyor. |
| 72 | Compact Screw | Conveyor › Screw Conveyor | Size/construction attribute (also a duplicated type_code across classes). |
| 114 | Subsea Pipeline | Pipeline › Subsea Pipeline | A pipeline is a system/asset rather than a Type-level equipment identity; no maintainable equipment unit. |
| 115 | Flowline | Pipeline › Flowline | A flowline is a pipeline segment, not a Type-level equipment identity. |
| 116 | Gathering Line | Pipeline › Gathering Line | A gathering line is a pipeline segment, not a Type-level equipment identity. |
| 147 | Triple Pressure HRSG | HRSG › Triple Pressure HRSG | Pressure-level attribute of the same heat recovery steam generator. |
| 159 | Hydrogen-Cooled Generator | Generator › Hydrogen-Cooled Generator | Cooling-medium attribute of the generator already represented. |
| 164 | SCR | Pollution Control › Selective Catalytic Reduction | A selective catalytic reduction is a process/system designation, not a discrete Type-level equipment identity. |
| 185 | Packed Column | Distillation › Packed Column | Internals arrangement attribute of a distillation column; packing belongs to decomposition. |
| 186 | Tray Column | Distillation › Tray Column | Internals arrangement attribute of a distillation column; trays belong to decomposition. |
| 206 | Chemical Transfer Pump | Pump › Chemical Transfer Pump | Duty qualifier ("transfer"), not a distinct equipment type: the machine is whichever pump technology is selected. |
| 211 | Process Blower | Blower › Process Blower | Duty qualifier ("process"), not a distinct equipment type: the machine is whichever blower technology serves it. |
| 223 | Blanking Press | Press › Blanking Press | A blanking press is a duty application of a press, not a distinct equipment type. |
| 265 | Emergency Generator | Electrical Equipment › Generator | Standby duty role, not a distinct machine type; the equipment is the generator set that performs it. |

`CUSTOMER_SPECIFIC` (0): no candidate in this corpus is
customer, site or vendor terminology. No vendor or customer name appears in the
corpus, and industry-specific machinery is *industry* terminology that belongs to
applicability rather than to customer-specific identity. Recording a zero is more
useful than manufacturing entries.

## 7E. Unresolved / insufficient-evidence items — `INSUFFICIENT_EVIDENCE` (3)

| # | Candidate | Source placement | Basis |
|---|---|---|---|
| 6 | Circulator Pump | Pump › Centrifugal Pump | Two defensible readings: a distinct small hydronic in-line pump, or a synonym for the circulating water pump already carried. The corpus gives no way to choose. |
| 158 | Turbo Generator | Generator › Generator | Two defensible readings: a distinct generator package, or a generator identity already covered where the driving turbine is the type. Not decidable from the corpus. |
| 190 | Agitated Vessel | Mixer › Agitated Vessel | Two defensible readings: a Type-level vessel with an agitator package, or a mixing-equipment variant overlapping Mechanical Mixer. Not decidable from the corpus. |

---

## 8. Level findings, containers and customer terms

The listings are in §7A–§7E. Two patterns dominate the reclassifications:
process-function categories holding equipment that belongs with its engineering
discipline (heat exchangers under `Heater`, filtration under `Chemical Separation`,
a baghouse under `Pollution Control`), and equipment filed under a process it does
not perform (wheel loader under `Haulage`, mine hoist under `Gearbox`, plastics
machines under `Injection Molding`, drawworks and top drive under `Rig`).

R1 reduced `NOT_EQUIPMENT_TYPE` from 50 to 29. The remaining set is genuinely
non-Type: enclosure and form-factor attributes, impeller and internals components,
duty qualifiers, pipeline and linear assets, and one process/system designation.

**Equipment Family was NOT reintroduced** — verified directly: no equipment type
carries a broad-container name. Container concepts exist only at Category level.

---

## 9. Structural debt — explicitly DEFERRED from R1

Per §6 of the R1 mission, these are **not** addressed here and require a separate
bounded architecture task:

1. **166 of 282 (58.9%) candidate names are identical to their own class name** —
   the 311-class structure largely mirrors the Type level.
2. **The 65 categories contain two parallel schemes at once** — a broad container
   scheme and a specific one — plus `Valve`/`Valves`,
   `Instrumentation`/`Instrumentation and Control`,
   `Compressor`/`General Compressor`, `Heater`/`Heat Exchanger`, and electrical
   fragmentation across six categories.

**R1 is TYPE-SEMANTICS ONLY.**

---

## 10. Engineering-evidence basis

Three kinds of evidence are kept strictly separate (§5 of the R1 mission):

| Kind | Present? | Used how |
|---|---|---|
| **Corpus evidence** | **Yes** — 282 rows, 311 classes, 65 categories, 647 applicability rows, all reproducibly hashed | Establishes what the corpus contains and how it is structured |
| **Atiman engineering reasoning** | **Yes** | The basis of every disposition. Recorded per row in `rationale`, with the governing-test reasoning in `challenge_review` |
| **Governed external-standard evidence** | **No — none exists** | The crosswalk tables are empty; no edition, classification or evidence row is populated |

**"No ISO evidence exists" does not mean "no engineering distinction exists."**
Atiman owns its taxonomy, so engineering semantics are a legitimate basis — but
they are never presented as external authority. The `iso_*` legacy columns were
**not consulted, converted or trusted** (`FALSE_PROVENANCE_REMEDIATION_REQUIRED`
stands), and **no mapping is proposed**. The identical `evidence` string appears on
all 282 rows.

---

## 11. Decomposition referrals

9 explicit referrals (diffusers, perforated plate, pipeline segments, flowline,
gathering line) plus rows flagged where the collapse itself depends on
decomposition (impeller geometry, brake assembly, column internals, screen rake).
**No decomposition architecture is designed.**

---

## 12. Industry applicability

647 rows → **6 industries** against **282 types**: every type covered, 1–6
industries each, criticality A=308 / B=295 / C=44, **no dangling references**.
Industry does **not** create duplicate canonical identities, and no type was
duplicated for appearing in several industries.

---

## 13. Complete candidate decision matrix

The complete per-candidate matrix — all 282 rows, one record each, now including
the R1 `challenge_review` verdict — is the companion artifact:

**`docs/research/m5r4a/equipment-type-reconciliation.jsonl`** (282 lines, sha256 `2ee6fb48b8bbe8a3e9efe83d72e41aabd7843d5fb2d3334ea7a112794a736e9e`)

It follows the existing `docs/research/**/*.jsonl` convention, introduces no new
framework, and is a **DECISION CANDIDATE**: no loader, migration or runtime path
reads it.

### Appendix — full 282-row matrix

| # | Candidate | Source category › class | Disposition | Canonical name / target | Conf | Challenge |
|---|---|---|---|---|---|---|
| 1 | End Suction Pump | Pump › Centrifugal Pump | `KEEP_EXISTING` | End Suction Pump | HIGH | reviewed |
| 2 | Split Case Pump | Pump › Centrifugal Pump | `KEEP_EXISTING` | Split Case Pump | HIGH | reviewed |
| 3 | Multistage Pump | Pump › Centrifugal Pump | `KEEP_EXISTING` | Multistage Centrifugal Pump | HIGH | — |
| 4 | Vertical Turbine | Pump › Centrifugal Pump | `KEEP_EXISTING` | Vertical Turbine Pump | HIGH | reviewed |
| 5 | Submersible Centrifugal | Pump › Centrifugal Pump | `KEEP_EXISTING` | Submersible Centrifugal Pump | HIGH | — |
| 6 | Circulator Pump | Pump › Centrifugal Pump | `INSUFFICIENT_EVIDENCE` | — | LOW | reviewed |
| 7 | Submersible Sewage Pump | Pump › Submersible Pump | `MERGE_DUPLICATE` | → Submersible Pump | HIGH | reviewed |
| 8 | Submersible Drainage | Pump › Submersible Pump | `MERGE_DUPLICATE` | → Submersible Pump | HIGH | reviewed |
| 9 | Submersible Slurry | Pump › Submersible Pump | `MERGE_DUPLICATE` | → Slurry Pump | HIGH | reviewed |
| 10 | Plunger Pump | Pump › Reciprocating Pump | `KEEP_EXISTING` | Plunger Pump | HIGH | — |
| 11 | Piston Pump | Pump › Reciprocating Pump | `KEEP_EXISTING` | Piston Pump | HIGH | reviewed |
| 12 | Hydraulic Diaphragm | Pump › Reciprocating Pump | `KEEP_EXISTING` | Hydraulic Diaphragm Pump | HIGH | — |
| 13 | TEFC Motor | Motor › AC Induction Motor | `ADD_TYPE` | AC Induction Motor | HIGH | reviewed |
| 14 | ODP Motor | Motor › AC Induction Motor | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 15 | Weather Protected | Motor › AC Induction Motor | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 16 | Explosion Proof | Motor › AC Induction Motor | `KEEP_EXISTING` | Explosion-Proof Motor | HIGH | changed |
| 17 | Brake Motor | Motor › AC Induction Motor | `NOT_EQUIPMENT_TYPE` | — | HIGH | changed |
| 18 | Variable Speed | Motor › AC Induction Motor | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 19 | Rising Stem Gate | Valve › Gate Valve | `ADD_TYPE` | Gate Valve | HIGH | reviewed |
| 20 | Non-Rising Stem | Valve › Gate Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 21 | Knife Gate Valve | Valve › Gate Valve | `RECLASSIFY` | Knife Gate Valve | HIGH | reviewed |
| 22 | Concentric Butterfly | Valve › Butterfly Valve | `ADD_TYPE` | Butterfly Valve | HIGH | reviewed |
| 23 | Double Offset | Valve › Butterfly Valve | `NOT_EQUIPMENT_TYPE` | — | MEDIUM | changed |
| 24 | Triple Offset | Valve › Butterfly Valve | `KEEP_EXISTING` | Triple Offset Butterfly Valve | MEDIUM | changed |
| 25 | Swing Check | Valve › Check Valve | `ADD_TYPE` | Check Valve | HIGH | reviewed |
| 26 | Lift Check | Valve › Check Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 27 | Dual Plate | Valve › Check Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 28 | Nozzle Check | Valve › Check Valve | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 29 | Gauge Pressure | Instrumentation › Pressure Transmitter | `ADD_TYPE` | Gauge Pressure Transmitter | MEDIUM | changed |
| 30 | Absolute Pressure | Instrumentation › Pressure Transmitter | `KEEP_EXISTING` | Absolute Pressure Transmitter | MEDIUM | changed |
| 31 | Differential Pressure | Instrumentation › Pressure Transmitter | `KEEP_EXISTING` | Differential Pressure Transmitter | HIGH | — |
| 32 | Hydrostatic Level | Instrumentation › Pressure Transmitter | `RECLASSIFY` | Hydrostatic Level Transmitter | HIGH | — |
| 33 | Electromagnetic | Instrumentation › Flow Meter | `ADD_TYPE` | Electromagnetic Flow Meter | HIGH | — |
| 34 | Ultrasonic | Instrumentation › Flow Meter | `SYNONYM_OR_ALIAS` | → Ultrasonic Flow Meter | HIGH | reviewed |
| 35 | Vortex Shedding | Instrumentation › Flow Meter | `ADD_TYPE` | Vortex Flow Meter | HIGH | — |
| 36 | Turbine | Instrumentation › Flow Meter | `ADD_TYPE` | Turbine Flow Meter | HIGH | — |
| 37 | Orifice Plate | Instrumentation › Flow Meter | `ADD_TYPE` | Orifice Plate Flow Meter | HIGH | changed |
| 38 | Venturi Tube | Instrumentation › Flow Meter | `ADD_TYPE` | Venturi Flow Meter | HIGH | — |
| 39 | Radar Level | Instrumentation › Level Transmitter | `ADD_TYPE` | Radar Level Transmitter | HIGH | — |
| 40 | Ultrasonic Level | Instrumentation › Level Transmitter | `ADD_TYPE` | Ultrasonic Level Transmitter | HIGH | reviewed |
| 41 | Capacitance | Instrumentation › Level Transmitter | `ADD_TYPE` | Capacitance Level Transmitter | HIGH | — |
| 42 | Float Switch | Instrumentation › Level Transmitter | `RECLASSIFY` | Float Level Switch | HIGH | — |
| 43 | RTD Sensor | Instrumentation › Temperature Sensor | `KEEP_EXISTING` | RTD Temperature Sensor | HIGH | — |
| 44 | Thermocouple | Instrumentation › Temperature Sensor | `KEEP_EXISTING` | Thermocouple | HIGH | — |
| 45 | Infrared | Instrumentation › Temperature Sensor | `KEEP_EXISTING` | Infrared Temperature Sensor | HIGH | — |
| 46 | Modular PLC | PLC › PLC Controller | `ADD_TYPE` | Programmable Logic Controller | HIGH | reviewed |
| 47 | Compact PLC | PLC › PLC Controller | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 48 | Safety PLC | PLC › PLC Controller | `KEEP_EXISTING` | Safety PLC | HIGH | changed |
| 49 | Single Stage Centrifugal | Blower › Centrifugal Blower | `ADD_TYPE` | Centrifugal Blower | HIGH | reviewed |
| 50 | Multistage Centrifugal | Blower › Centrifugal Blower | `MERGE_DUPLICATE` | → Centrifugal Blower | HIGH | reviewed |
| 51 | Twin Lobe Blower | Blower › Rotary Lobe Blower | `ADD_TYPE` | Rotary Lobe Blower | HIGH | reviewed |
| 52 | Tri-Lobe Blower | Blower › Rotary Lobe Blower | `MERGE_DUPLICATE` | → Rotary Lobe Blower | HIGH | reviewed |
| 53 | Oil Injected | Compressor › Screw Compressor | `KEEP_EXISTING` | Oil-Injected Screw Compressor | HIGH | changed |
| 54 | Oil Free | Compressor › Screw Compressor | `KEEP_EXISTING` | Oil-Free Screw Compressor | HIGH | changed |
| 55 | Rapid Gravity Filter | Filter › Sand Filter | `KEEP_EXISTING` | Rapid Gravity Sand Filter | HIGH | — |
| 56 | Pressure Filter | Filter › Sand Filter | `MERGE_DUPLICATE` | → Pressure Filter | HIGH | reviewed |
| 57 | Continuous Backwash | Filter › Sand Filter | `KEEP_EXISTING` | Continuous Backwash Sand Filter | HIGH | — |
| 58 | Microfiltration | Filter › Membrane Filter | `KEEP_EXISTING` | Microfiltration Unit | MEDIUM | changed |
| 59 | Ultrafiltration | Filter › Membrane Filter | `KEEP_EXISTING` | Ultrafiltration Unit | MEDIUM | changed |
| 60 | Reverse Osmosis | Filter › Membrane Filter | `KEEP_EXISTING` | Reverse Osmosis Unit | MEDIUM | changed |
| 61 | Turbine Mixer | Mixer › Mechanical Mixer | `ADD_TYPE` | Mechanical Mixer | MEDIUM | reviewed |
| 62 | Propeller Mixer | Mixer › Mechanical Mixer | `NOT_EQUIPMENT_TYPE` | — | MEDIUM | reviewed |
| 63 | Paddle Mixer | Mixer › Mechanical Mixer | `NOT_EQUIPMENT_TYPE` | — | MEDIUM | reviewed |
| 64 | Fine Bubble Diffuser | Mixer › Diffuser Aerator | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 65 | Coarse Bubble | Mixer › Diffuser Aerator | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 66 | Manual Bar Screen | Screen › Bar Screen | `ADD_TYPE` | Bar Screen | HIGH | reviewed |
| 67 | Mechanical Bar Screen | Screen › Bar Screen | `KEEP_EXISTING` | Mechanical Bar Screen | MEDIUM | changed |
| 68 | Fine Step Screen | Screen › Step Screen | `KEEP_EXISTING` | Fine Step Screen | HIGH | — |
| 69 | Perforated Plate | Screen › Step Screen | `NOT_EQUIPMENT_TYPE` | — | HIGH | changed |
| 70 | Shafted Screw | Conveyor › Screw Conveyor | `ADD_TYPE` | Screw Conveyor | HIGH | reviewed |
| 71 | Shaftless Screw | Conveyor › Screw Conveyor | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 72 | Compact Screw | Conveyor › Screw Conveyor | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 74 | Haul Truck | Haulage › Haul Truck | `KEEP_EXISTING` | Haul Truck | HIGH | — |
| 75 | Articulated Dump Truck | Haulage › Dump Truck | `KEEP_EXISTING` | Articulated Dump Truck | HIGH | — |
| 76 | Wheel Loader | Haulage › Wheel Loader | `RECLASSIFY` | Wheel Loader | HIGH | — |
| 77 | Hydraulic Shovel | Excavation › Hydraulic Shovel | `KEEP_EXISTING` | Hydraulic Shovel | HIGH | — |
| 78 | Rope Shovel | Excavation › Rope Shovel | `KEEP_EXISTING` | Rope Shovel | HIGH | — |
| 79 | Bulldozer | Excavation › Bulldozer | `RECLASSIFY` | Bulldozer | HIGH | — |
| 80 | Motor Grader | Excavation › Motor Grader | `RECLASSIFY` | Motor Grader | HIGH | — |
| 81 | Rotary Drill | Drilling › Rotary Drill | `KEEP_EXISTING` | Rotary Drill | HIGH | — |
| 82 | DTH Drill | Drilling › DTH Drill | `KEEP_EXISTING` | Down-the-Hole Drill | HIGH | reviewed |
| 83 | Roof Bolter | Drilling › Roof Bolter | `KEEP_EXISTING` | Roof Bolter | HIGH | — |
| 84 | Continuous Miner | Drilling › Continuous Miner | `RECLASSIFY` | Continuous Miner | MEDIUM | — |
| 85 | Longwall Shearer | Drilling › Longwall Shearer | `RECLASSIFY` | Longwall Shearer | MEDIUM | — |
| 86 | Jaw Crusher | Crushing › Jaw Crusher | `KEEP_EXISTING` | Jaw Crusher | HIGH | — |
| 87 | Cone Crusher | Crushing › Cone Crusher | `KEEP_EXISTING` | Cone Crusher | HIGH | — |
| 88 | Gyratory Crusher | Crushing › Gyratory Crusher | `KEEP_EXISTING` | Gyratory Crusher | HIGH | — |
| 89 | Impact Crusher | Crushing › Impact Crusher | `KEEP_EXISTING` | Impact Crusher | HIGH | — |
| 90 | SAG Mill | Milling › SAG Mill | `KEEP_EXISTING` | SAG Mill | HIGH | — |
| 91 | Ball Mill | Milling › Ball Mill | `KEEP_EXISTING` | Ball Mill | HIGH | — |
| 92 | Rod Mill | Milling › Rod Mill | `KEEP_EXISTING` | Rod Mill | HIGH | — |
| 93 | Vertical Mill | Milling › Vertical Mill | `KEEP_EXISTING` | Vertical Mill | HIGH | — |
| 94 | Overland Conveyor | Conveyor › Overland Conveyor | `ADD_TYPE` | Belt Conveyor | HIGH | reviewed |
| 95 | Bucket Elevator | Conveyor › Bucket Elevator | `KEEP_EXISTING` | Bucket Elevator | HIGH | — |
| 96 | Apron Feeder | Conveyor › Apron Feeder | `RECLASSIFY` | Apron Feeder | MEDIUM | reviewed |
| 97 | Vibrating Feeder | Conveyor › Vibrating Feeder | `RECLASSIFY` | Vibrating Feeder | HIGH | — |
| 98 | Mine Dewatering Pump | Pump › Mine Dewatering Pump | `KEEP_EXISTING` | Mine Dewatering Pump | MEDIUM | reviewed |
| 99 | Slurry Pump | Pump › Slurry Pump | `KEEP_EXISTING` | Slurry Pump | HIGH | reviewed |
| 100 | Mine Hoist | Gearbox › Mine Hoist | `RECLASSIFY` | Mine Hoist | HIGH | — |
| 101 | Winder Motor | Motor › Winder Motor | `MERGE_DUPLICATE` | → AC Induction Motor | MEDIUM | reviewed |
| 102 | Gas Detector | Instrumentation › Gas Detector | `KEEP_EXISTING` | Gas Detector | HIGH | — |
| 103 | Mine Ventilation Fan | Blower › Mine Ventilation Fan | `RECLASSIFY` | Mine Ventilation Fan | MEDIUM | — |
| 104 | Wellhead Assembly | Wellhead › Wellhead Assembly | `KEEP_EXISTING` | Wellhead Assembly | HIGH | — |
| 105 | Christmas Tree | Wellhead › Christmas Tree | `KEEP_EXISTING` | Christmas Tree | HIGH | reviewed |
| 106 | Production Separator | Separator › Production Separator | `KEEP_EXISTING` | Production Separator | HIGH | reviewed |
| 107 | Test Separator | Separator › Test Separator | `KEEP_EXISTING` | Test Separator | MEDIUM | changed |
| 108 | Coalescer | Separator › Coalescer | `KEEP_EXISTING` | Coalescer | HIGH | — |
| 109 | Heater Treater | Heater › Heater Treater | `KEEP_EXISTING` | Heater Treater | HIGH | — |
| 110 | Indirect Heater | Heater › Indirect Heater | `RECLASSIFY` | Indirect Heater | MEDIUM | — |
| 111 | Gas Compressor | Compressor › Gas Compressor | `TOO_BROAD_CONTAINER` | — | HIGH | reviewed |
| 112 | Reciprocating Compressor | Compressor › Reciprocating Compressor | `ADD_TYPE` | Reciprocating Compressor | HIGH | reviewed |
| 113 | Screw Compressor | Compressor › Screw Compressor | `ADD_TYPE` | Screw Compressor | HIGH | — |
| 114 | Subsea Pipeline | Pipeline › Subsea Pipeline | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 115 | Flowline | Pipeline › Flowline | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 116 | Gathering Line | Pipeline › Gathering Line | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 117 | Pig Launcher | Pipeline › Pig Launcher | `ADD_TYPE` | Pig Launcher | HIGH | — |
| 118 | Pig Receiver | Pipeline › Pig Receiver | `MERGE_DUPLICATE` | → Pig Launcher | MEDIUM | reviewed |
| 119 | Bullet Tank | Storage Tank › Bullet Tank | `KEEP_EXISTING` | Bullet Tank | HIGH | — |
| 120 | Spherical Tank | Storage Tank › Spherical Tank | `KEEP_EXISTING` | Spherical Storage Tank | HIGH | — |
| 121 | API Atmospheric Tank | Storage Tank › API Tank | `KEEP_EXISTING` | Atmospheric Storage Tank | HIGH | — |
| 122 | Flare Stack | Flare › Flare Stack | `KEEP_EXISTING` | Flare Stack | HIGH | — |
| 123 | Enclosed Flare | Flare › Enclosed Flare | `KEEP_EXISTING` | Enclosed Ground Flare | HIGH | — |
| 124 | Shell and Tube Exchanger | Heater › Shell and Tube Exchanger | `RECLASSIFY` | Shell and Tube Heat Exchanger | HIGH | — |
| 125 | Plate Exchanger | Heater › Plate Exchanger | `RECLASSIFY` | Plate Heat Exchanger | HIGH | — |
| 126 | Air Cooler | Heater › Air Cooler | `RECLASSIFY` | Air-Cooled Heat Exchanger | HIGH | — |
| 127 | TEG Dehydrator | Treatment › Dehydrator | `KEEP_EXISTING` | Glycol Dehydration Unit | HIGH | — |
| 128 | Molecular Sieve | Treatment › Molecular Sieve | `KEEP_EXISTING` | Molecular Sieve Dehydration Unit | MEDIUM | changed |
| 129 | Orifice Meter | Metering › Orifice Meter | `SYNONYM_OR_ALIAS` | → Orifice Plate Flow Meter | HIGH | changed |
| 130 | Ultrasonic Meter | Metering › Ultrasonic Meter | `ADD_TYPE` | Ultrasonic Flow Meter | HIGH | — |
| 131 | Coriolis Meter | Metering › Coriolis Meter | `ADD_TYPE` | Coriolis Flow Meter | HIGH | — |
| 132 | Multiphase Meter | Metering › Multiphase Meter | `ADD_TYPE` | Multiphase Flow Meter | HIGH | reviewed |
| 133 | Slug Catcher | Treatment › Slug Catcher | `KEEP_EXISTING` | Slug Catcher | HIGH | — |
| 134 | Blowout Preventer | BOP › Blowout Preventer | `RECLASSIFY` | Blowout Preventer | HIGH | — |
| 135 | Triplex Mud Pump | Pump › Triplex Pump | `KEEP_EXISTING` | Triplex Mud Pump | HIGH | — |
| 136 | Drawworks | Rig › Drawworks | `RECLASSIFY` | Drawworks | HIGH | changed |
| 137 | Top Drive | Rig › Top Drive | `RECLASSIFY` | Top Drive | HIGH | changed |
| 138 | Shale Shaker | Treatment › Shale Shaker | `KEEP_EXISTING` | Shale Shaker | HIGH | — |
| 139 | Desander | Treatment › Desander | `KEEP_EXISTING` | Desander | HIGH | reviewed |
| 140 | Desilter | Treatment › Desilter | `KEEP_EXISTING` | Desilter | MEDIUM | changed |
| 141 | Subsea Tree | Subsea › Subsea Tree | `KEEP_EXISTING` | Subsea Tree | MEDIUM | changed |
| 142 | Subsea Manifold | Subsea › Subsea Manifold | `KEEP_EXISTING` | Subsea Manifold | HIGH | — |
| 143 | Gas Turbine | Turbine › Gas Turbine | `KEEP_EXISTING` | Gas Turbine | HIGH | — |
| 144 | Steam Turbine | Turbine › Steam Turbine | `KEEP_EXISTING` | Steam Turbine | HIGH | — |
| 145 | Aero-Derivative Gas Turbine | Turbine › Aero Gas Turbine | `KEEP_EXISTING` | Aero-Derivative Gas Turbine | HIGH | changed |
| 146 | HRSG | HRSG › HRSG | `ADD_TYPE` | Heat Recovery Steam Generator | HIGH | — |
| 147 | Triple Pressure HRSG | HRSG › Triple Pressure HRSG | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 148 | Drum Boiler | Boiler › Drum Boiler | `KEEP_EXISTING` | Drum Boiler | HIGH | — |
| 149 | Once-Through Boiler | Boiler › Once-Through Boiler | `KEEP_EXISTING` | Once-Through Boiler | HIGH | — |
| 150 | Coal Pulverizer | Milling › Coal Pulverizer | `KEEP_EXISTING` | Coal Pulverizer | HIGH | — |
| 151 | Condenser | Cooling › Condenser | `KEEP_EXISTING` | Condenser | HIGH | reviewed |
| 152 | Air-Cooled Condenser | Cooling › Air-Cooled Condenser | `KEEP_EXISTING` | Air-Cooled Condenser | HIGH | changed |
| 153 | Mechanical Draft Cooling Tower | Cooling › Cooling Tower | `RECLASSIFY` | Cooling Tower | HIGH | reviewed |
| 154 | Natural Draft Cooling Tower | Cooling › Natural Draft Tower | `KEEP_EXISTING` | Natural Draft Cooling Tower | HIGH | changed |
| 155 | Boiler Feed Pump | Pump › Boiler Feed Pump | `KEEP_EXISTING` | Boiler Feed Pump | HIGH | reviewed |
| 156 | Condensate Pump | Pump › Condensate Pump | `KEEP_EXISTING` | Condensate Pump | MEDIUM | reviewed |
| 157 | Circulating Water Pump | Pump › Circulating Water Pump | `KEEP_EXISTING` | Circulating Water Pump | HIGH | reviewed |
| 158 | Turbo Generator | Generator › Generator | `INSUFFICIENT_EVIDENCE` | — | LOW | reviewed |
| 159 | Hydrogen-Cooled Generator | Generator › Hydrogen-Cooled Generator | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 160 | Step-Up Transformer | Transformer › Step-Up Transformer | `MERGE_DUPLICATE` | → Power Transformer | HIGH | reviewed |
| 161 | Unit Transformer | Transformer › Unit Transformer | `MERGE_DUPLICATE` | → Power Transformer | HIGH | reviewed |
| 162 | GIS Switchgear | Switchgear › GIS Switchgear | `KEEP_EXISTING` | Gas-Insulated Switchgear | HIGH | changed |
| 163 | Air-Insulated Switchgear | Switchgear › Air-Insulated Switchgear | `KEEP_EXISTING` | Air-Insulated Switchgear | HIGH | changed |
| 164 | SCR | Pollution Control › Selective Catalytic Reduction | `NOT_EQUIPMENT_TYPE` | — | MEDIUM | reviewed |
| 165 | ESP | Pollution Control › Electrostatic Precipitator | `KEEP_EXISTING` | Electrostatic Precipitator | HIGH | — |
| 166 | Baghouse Filter | Pollution Control › Baghouse Filter | `RECLASSIFY` | Baghouse Dust Collector | HIGH | — |
| 167 | Wet Scrubber | Pollution Control › Wet Scrubber | `KEEP_EXISTING` | Wet Scrubber | HIGH | changed |
| 168 | Dry Scrubber | Pollution Control › Dry Scrubber | `KEEP_EXISTING` | Dry Scrubber | HIGH | changed |
| 169 | Chimney/Stack | Stack › Chimney | `KEEP_EXISTING` | Chimney | MEDIUM | — |
| 170 | Bottom Ash Conveyor | Ash Handling › Bottom Ash Conveyor | `KEEP_EXISTING` | Bottom Ash Conveyor | MEDIUM | reviewed |
| 171 | Fly Ash Silo | Ash Handling › Fly Ash Silo | `MERGE_DUPLICATE` | → Storage Silo | HIGH | reviewed |
| 172 | Stacker | Ash Handling › Stacker | `KEEP_EXISTING` | Stacker | HIGH | — |
| 173 | Reclaimer | Ash Handling › Reclaimer | `KEEP_EXISTING` | Reclaimer | HIGH | — |
| 174 | Limestone Slurry Pump | Pump › Limestone Slurry Pump | `MERGE_DUPLICATE` | → Slurry Pump | HIGH | reviewed |
| 175 | FGD Absorber | Treatment › FGD Absorber | `KEEP_EXISTING` | FGD Absorber | MEDIUM | — |
| 176 | Deaerator | Treatment › Deaerator | `KEEP_EXISTING` | Deaerator | HIGH | — |
| 177 | LP Feedwater Heater | Heater › LP Heater | `RECLASSIFY` | Feedwater Heater | MEDIUM | reviewed |
| 178 | HP Feedwater Heater | Heater › HP Heater | `MERGE_DUPLICATE` | → Feedwater Heater | MEDIUM | reviewed |
| 179 | Batch Reactor | Reactor › Batch Reactor | `KEEP_EXISTING` | Batch Reactor | MEDIUM | — |
| 180 | CSTR | Reactor › CSTR | `KEEP_EXISTING` | Continuous Stirred Tank Reactor | HIGH | — |
| 181 | Plug Flow Reactor | Reactor › Plug Flow Reactor | `KEEP_EXISTING` | Plug Flow Reactor | HIGH | — |
| 182 | Fixed Bed Reactor | Reactor › Fixed Bed Reactor | `KEEP_EXISTING` | Fixed Bed Reactor | HIGH | — |
| 183 | Fluidized Bed Reactor | Reactor › Fluidized Bed Reactor | `KEEP_EXISTING` | Fluidized Bed Reactor | HIGH | — |
| 184 | Distillation Column | Distillation › Distillation Column | `KEEP_EXISTING` | Distillation Column | HIGH | — |
| 185 | Packed Column | Distillation › Packed Column | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 186 | Tray Column | Distillation › Tray Column | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 187 | Reactive Distillation Column | Distillation › Reactive Distillation | `KEEP_EXISTING` | Reactive Distillation Column | MEDIUM | — |
| 188 | Double Pipe Heat Exchanger | Heater › Double Pipe Exchanger | `RECLASSIFY` | Double Pipe Heat Exchanger | HIGH | — |
| 189 | Spiral Heat Exchanger | Heater › Spiral Exchanger | `RECLASSIFY` | Spiral Heat Exchanger | HIGH | — |
| 190 | Agitated Vessel | Mixer › Agitated Vessel | `INSUFFICIENT_EVIDENCE` | — | LOW | reviewed |
| 191 | Jet Mixer | Mixer › Jet Mixer | `KEEP_EXISTING` | Jet Mixer | HIGH | — |
| 192 | Static Mixer | Mixer › Static Mixer | `KEEP_EXISTING` | Static Mixer | HIGH | — |
| 193 | Rotary Dryer | Drying › Rotary Dryer | `KEEP_EXISTING` | Rotary Dryer | HIGH | — |
| 194 | Spray Dryer | Drying › Spray Dryer | `KEEP_EXISTING` | Spray Dryer | HIGH | — |
| 195 | Fluid Bed Dryer | Drying › Fluid Bed Dryer | `KEEP_EXISTING` | Fluid Bed Dryer | HIGH | — |
| 196 | Freeze Dryer | Drying › Freeze Dryer | `KEEP_EXISTING` | Freeze Dryer | HIGH | reviewed |
| 197 | Decanter Centrifuge | Chemical Separation › Decanter Centrifuge | `KEEP_EXISTING` | Decanter Centrifuge | HIGH | — |
| 198 | Basket Centrifuge | Chemical Separation › Basket Centrifuge | `KEEP_EXISTING` | Basket Centrifuge | HIGH | — |
| 199 | Disc Stack Centrifuge | Chemical Separation › Disc Stack Centrifuge | `KEEP_EXISTING` | Disc Stack Centrifuge | HIGH | — |
| 200 | Pressure Filter | Chemical Separation › Pressure Filter | `KEEP_EXISTING` | Pressure Filter | HIGH | — |
| 201 | Rotary Vacuum Filter | Chemical Separation › Rotary Vacuum Filter | `RECLASSIFY` | Rotary Vacuum Filter | HIGH | — |
| 202 | Belt Filter | Chemical Separation › Belt Filter | `RECLASSIFY` | Belt Filter Press | HIGH | — |
| 203 | Leaf Filter | Chemical Separation › Leaf Filter | `RECLASSIFY` | Leaf Filter | HIGH | — |
| 204 | Storage Silo | Storage Tank › Storage Silo | `KEEP_EXISTING` | Storage Silo | HIGH | — |
| 205 | Day Bin | Storage Tank › Day Bin | `MERGE_DUPLICATE` | → Storage Silo | MEDIUM | reviewed |
| 206 | Chemical Transfer Pump | Pump › Chemical Transfer Pump | `NOT_EQUIPMENT_TYPE` | — | MEDIUM | reviewed |
| 207 | Metering Pump | Pump › Metering Pump | `KEEP_EXISTING` | Metering Pump | HIGH | — |
| 208 | Magnetic Drive Pump | Pump › Mag Drive Pump | `KEEP_EXISTING` | Magnetic Drive Pump | HIGH | reviewed |
| 209 | Diaphragm Compressor | Compressor › Diaphragm Compressor | `KEEP_EXISTING` | Diaphragm Compressor | HIGH | — |
| 210 | Liquid Ring Compressor | Compressor › Liquid Ring Compressor | `KEEP_EXISTING` | Liquid Ring Compressor | HIGH | reviewed |
| 211 | Process Blower | Blower › Process Blower | `NOT_EQUIPMENT_TYPE` | — | MEDIUM | reviewed |
| 212 | Crystallizer | Treatment › Crystallizer | `KEEP_EXISTING` | Crystallizer | HIGH | — |
| 213 | Evaporator | Treatment › Evaporator | `TOO_BROAD_CONTAINER` | — | HIGH | reviewed |
| 214 | Falling Film Evaporator | Treatment › Falling Film Evaporator | `KEEP_EXISTING` | Falling Film Evaporator | HIGH | — |
| 215 | Forced Circulation Evaporator | Treatment › Forced Circulation Evaporator | `KEEP_EXISTING` | Forced Circulation Evaporator | HIGH | — |
| 216 | CNC Milling Machine | CNC Machine › CNC Mill | `KEEP_EXISTING` | CNC Milling Machine | HIGH | — |
| 217 | CNC Lathe | CNC Machine › CNC Lathe | `KEEP_EXISTING` | CNC Lathe | HIGH | — |
| 218 | Grinding Machine | CNC Machine › Grinding Machine | `RECLASSIFY` | Grinding Machine | MEDIUM | — |
| 219 | EDM Machine | CNC Machine › EDM Machine | `RECLASSIFY` | Electrical Discharge Machine | MEDIUM | — |
| 220 | Hydraulic Press | Press › Hydraulic Press | `KEEP_EXISTING` | Hydraulic Press | HIGH | — |
| 221 | Mechanical Press | Press › Mechanical Press | `KEEP_EXISTING` | Mechanical Press | HIGH | — |
| 222 | Servo Press | Press › Servo Press | `KEEP_EXISTING` | Servo Press | HIGH | — |
| 223 | Blanking Press | Press › Blanking Press | `NOT_EQUIPMENT_TYPE` | — | HIGH | reviewed |
| 224 | Injection Molding Machine | Injection Molding › Injection Molding Machine | `KEEP_EXISTING` | Injection Molding Machine | HIGH | — |
| 225 | Blow Molding Machine | Injection Molding › Blow Molding Machine | `RECLASSIFY` | Blow Molding Machine | MEDIUM | — |
| 226 | Extrusion Machine | Injection Molding › Extrusion Machine | `RECLASSIFY` | Extrusion Machine | HIGH | — |
| 227 | Thermoforming Machine | Injection Molding › Thermoforming Machine | `RECLASSIFY` | Thermoforming Machine | MEDIUM | — |
| 228 | Articulated Robot | Robot › Articulated Robot | `KEEP_EXISTING` | Articulated Robot | HIGH | — |
| 229 | SCARA Robot | Robot › SCARA Robot | `KEEP_EXISTING` | SCARA Robot | HIGH | reviewed |
| 230 | Cartesian Robot | Robot › Cartesian Robot | `KEEP_EXISTING` | Cartesian Robot | HIGH | — |
| 231 | Collaborative Robot | Robot › Collaborative Robot | `KEEP_EXISTING` | Collaborative Robot | HIGH | — |
| 232 | Roller Conveyor | Conveyor › Roller Conveyor | `KEEP_EXISTING` | Roller Conveyor | HIGH | — |
| 233 | Chain Conveyor | Conveyor › Chain Conveyor | `KEEP_EXISTING` | Chain Conveyor | HIGH | — |
| 234 | Overhead Conveyor | Conveyor › Overhead Conveyor | `KEEP_EXISTING` | Overhead Conveyor | MEDIUM | reviewed |
| 235 | Forklift | Material Handling › Forklift | `KEEP_EXISTING` | Forklift | HIGH | — |
| 236 | Reach Truck | Material Handling › Reach Truck | `KEEP_EXISTING` | Reach Truck | HIGH | reviewed |
| 237 | Order Picker | Material Handling › Order Picker | `KEEP_EXISTING` | Order Picker | HIGH | reviewed |
| 238 | Pallet Jack | Material Handling › Pallet Jack | `KEEP_EXISTING` | Pallet Jack | MEDIUM | — |
| 239 | Rotary Screw Compressor | General Compressor › Rotary Screw Compressor | `MERGE_DUPLICATE` | → Screw Compressor | HIGH | reviewed |
| 240 | Reciprocating Air Compressor | General Compressor › Reciprocating Air Compressor | `MERGE_DUPLICATE` | → Reciprocating Compressor | HIGH | reviewed |
| 241 | Centrifugal Air Compressor | General Compressor › Centrifugal Air Compressor | `ADD_TYPE` | Centrifugal Compressor | HIGH | reviewed |
| 242 | Rooftop HVAC Unit | HVAC Equipment › Rooftop Unit | `KEEP_EXISTING` | Rooftop HVAC Unit | HIGH | — |
| 243 | Chiller | HVAC Equipment › Chiller | `KEEP_EXISTING` | Chiller | HIGH | — |
| 244 | Air Handling Unit | HVAC Equipment › Air Handling Unit | `KEEP_EXISTING` | Air Handling Unit | HIGH | reviewed |
| 245 | Dust Collector | Dust Collection › Dust Collector | `TOO_BROAD_CONTAINER` | — | HIGH | reviewed |
| 246 | Cartridge Collector | Dust Collection › Cartridge Collector | `KEEP_EXISTING` | Cartridge Dust Collector | HIGH | — |
| 247 | Cyclone Separator | Dust Collection › Cyclone Separator | `RECLASSIFY` | Cyclone Separator | MEDIUM | — |
| 248 | Spray Booth | Paint › Spray Booth | `ADD_TYPE` | Spray Booth | MEDIUM | reviewed |
| 249 | Powder Coating Booth | Paint › Powder Coating Booth | `KEEP_EXISTING` | Powder Coating Booth | MEDIUM | changed |
| 250 | E-Coat System | Paint › E-Coat System | `KEEP_EXISTING` | Electrocoat System | MEDIUM | changed |
| 251 | MIG Welder | Welding › MIG Welder | `KEEP_EXISTING` | MIG Welding Machine | HIGH | — |
| 252 | TIG Welder | Welding › TIG Welder | `KEEP_EXISTING` | TIG Welding Machine | HIGH | — |
| 253 | Resistance Welder | Welding › Resistance Welder | `KEEP_EXISTING` | Resistance Welding Machine | HIGH | — |
| 254 | Packaging Machine | Packaging › Packaging Machine | `TOO_BROAD_CONTAINER` | — | HIGH | reviewed |
| 255 | Palletizer | Packaging › Palletizer | `KEEP_EXISTING` | Palletizer | HIGH | — |
| 256 | Case Packer | Packaging › Case Packer | `KEEP_EXISTING` | Case Packer | HIGH | — |
| 257 | Labeling Machine | Packaging › Labeling Machine | `KEEP_EXISTING` | Labelling Machine | HIGH | — |
| 258 | Shrink Wrapper | Packaging › Shrink Wrapper | `KEEP_EXISTING` | Shrink Wrapper | HIGH | — |
| 259 | Automated Guided Vehicle | Material Handling › AGV | `KEEP_EXISTING` | Automated Guided Vehicle | HIGH | — |
| 260 | AC Motor | Electrical Equipment › Motor | `MERGE_DUPLICATE` | → AC Induction Motor | HIGH | reviewed |
| 261 | DC Motor | Electrical Equipment › Motor | `KEEP_EXISTING` | DC Motor | HIGH | — |
| 262 | Synchronous Motor | Electrical Equipment › Motor | `KEEP_EXISTING` | Synchronous Motor | HIGH | reviewed |
| 263 | Submersible Motor | Electrical Equipment › Motor | `KEEP_EXISTING` | Submersible Motor | HIGH | reviewed |
| 264 | Diesel Generator | Electrical Equipment › Generator | `KEEP_EXISTING` | Diesel Generator Set | HIGH | — |
| 265 | Emergency Generator | Electrical Equipment › Generator | `NOT_EQUIPMENT_TYPE` | — | MEDIUM | reviewed |
| 266 | Power Transformer | Electrical Equipment › Transformer | `KEEP_EXISTING` | Power Transformer | HIGH | reviewed |
| 267 | Distribution Transformer | Electrical Equipment › Transformer | `KEEP_EXISTING` | Distribution Transformer | HIGH | reviewed |
| 268 | Dry Type Transformer | Electrical Equipment › Transformer | `KEEP_EXISTING` | Dry-Type Transformer | HIGH | changed |
| 269 | Oil Filled Transformer | Electrical Equipment › Transformer | `KEEP_EXISTING` | Oil-Filled Transformer | HIGH | changed |
| 270 | Low Voltage Switchgear | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Low Voltage Switchgear | HIGH | changed |
| 271 | Medium Voltage Switchgear | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Medium Voltage Switchgear | HIGH | changed |
| 272 | Motor Control Center | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Motor Control Center | HIGH | reviewed |
| 273 | Air Circuit Breaker | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Air Circuit Breaker | HIGH | changed |
| 274 | Vacuum Circuit Breaker | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Vacuum Circuit Breaker | HIGH | changed |
| 275 | Distribution Panel | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Distribution Panel | MEDIUM | reviewed |
| 276 | Control Panel | Electrical Equipment › Switchgear | `KEEP_EXISTING` | Control Panel | MEDIUM | reviewed |
| 277 | Uninterruptible Power Supply | Electrical Equipment › Power Backup Equipment | `KEEP_EXISTING` | Uninterruptible Power Supply | HIGH | reviewed |
| 278 | Battery Bank | Electrical Equipment › Power Backup Equipment | `KEEP_EXISTING` | Battery Bank | HIGH | — |
| 279 | Variable Frequency Drive | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Variable Frequency Drive | HIGH | — |
| 280 | Soft Starter | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Soft Starter | HIGH | reviewed |
| 281 | Rectifier | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Rectifier | HIGH | reviewed |
| 282 | Inverter | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Inverter | HIGH | — |
| 283 | Capacitor Bank | Electrical Equipment › Power Conversion Equipment | `KEEP_EXISTING` | Capacitor Bank | HIGH | — |

---

## 14. VUDA results (R1)

| # | Attack | Finding |
|---|---|---|
| A | Did we collapse independently maintainable equipment? | **Yes — found and corrected.** Drawworks and Top Drive were the clearest cases, plus 11 more reversed to retention. |
| B | Did we mistake different maintenance regimes for mere attributes? | **Yes.** Oil versus dry transformer insulation, wet versus dry scrubbing, and aero-derivative versus heavy-duty overhaul strategy were all maintenance-regime distinctions wrongly treated as attributes. |
| C | Did voltage classification hide materially different safety/maintenance knowledge? | **Yes.** LV/MV switchgear differ in arc-flash energy, PPE and boundary controls, and in test regime; both retained, and ACB/VCB retained on arc-quenching principle. |
| D | Did cooling/lubrication/process medium hide materially different failure mechanisms? | **Yes.** Oil-flooded versus oil-free screw compression, gas versus air insulation, natural versus mechanical draught, and membrane scaling versus fouling were all reversed. |
| E | Did a major maintainable assembly get pushed into unresolved decomposition? | **Yes — drawworks and top drive.** Both are major machines, not assemblies; reversed to Types. The brake assembly and diffusers remain decomposition items, correctly. |
| F | Did genericization destroy useful reliability knowledge? | **Partly.** Generic "Scrubber" (which merged wet and dry) was removed; the four genuine generic containers are upheld because each spans four distinct technologies. |
| G | Did duty/service labels genuinely represent only aliases? | **Mostly yes, with one boundary drawn.** Recognised engineered machine designations (boiler feed, condensate, circulating water, mine dewatering, bottom ash conveyor) were retained; generic service descriptions (chemical transfer, process blower, blanking press, emergency generator, variable-speed motor) remain collapsed. That line is recorded explicitly. |
| H | Did HIGH confidence exceed available engineering justification? | **Reviewed.** 12 rows were promoted and 20 set to MEDIUM where the call is closer; 3 remain LOW. Confidence is now on 231 HIGH / 48 MEDIUM / 3 LOW. |
| I | Did correction overreact and create unnecessary duplicate Types? | **Checked.** Two candidate reversals were **rejected on re-review**: `Brake Motor` stays `NOT_EQUIPMENT_TYPE` (the brake is a maintainable item) and `Double Offset` butterfly stays `NOT_EQUIPMENT_TYPE` (still resilient-seated, same failure family). `TOO_BROAD_CONTAINER`, `INSUFFICIENT_EVIDENCE` and `CUSTOMER_SPECIFIC` are unchanged. |
| J | Are all 282 candidates still accounted for exactly once? | **Yes** — 282 in, 282 out, machine-checked, ids unique. |

**Residual: BLOCKER = 0, MAJOR = 0.**

**Disclosures carried forward from M5R.4A and still standing:** the earlier
applicability field-shape mis-reading (corrected, recorded in the package) and the
four rows initially missing from the decision table (caught by the coverage check).

---

## 15. Proposed M5R.4B (STOP before implementing)

**Additive only** (M5R.1 §10 step 5) — no category, class or type deleted.
(1) add **29** canonical types; (2) reclassify **33**; (3) resolve **17** merges and **2** synonyms; (4) retire **36** rows from Type level without deleting their engineering vocabulary, recording the decomposition referrals; (5) hold the deferred structural debt of §9 for its own bounded task; (6) retain or rebuild applicability.

**The single largest open question remains** the approved mechanism to express
*"superseded by"* and *"synonym of"* without deleting rows. If that needs a schema
change it requires its own approved migration. Recommended sequencing: **B1** decide
the mechanism, **B2** apply additively.

---

## 16. Explicitly NOT changed

No taxonomy mutation · no migration (**019 absent**, 001–018 byte-identical) · no
seed change · no crosswalk or evidence population · no standards content · no false
provenance remediation · no Equipment Family · no decomposition architecture · no
customer alias architecture · no synonym schema · no category or class
consolidation · no M6 · no UI · no ATM-002 · no production access · no Render change
· no merge · no deployment · PR #27 untouched.
