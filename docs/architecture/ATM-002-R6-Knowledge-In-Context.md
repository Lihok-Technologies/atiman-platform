# ATM-002-R6 — Knowledge-in-Context Experience

**Document ID:** ATM-002-R6
**Status:** **APPROVED V1** — experience architecture only. No UI is implemented by this document.
**Baseline:** `origin/main` = `d8ac1a0ceaf45d1dc1975dd4c6fcdeb6a9e7e500`
**Depends on:** `ATM-002-R1` §2 D/G, `ATM-002-R2` (destinations), `ATM-002-R3` (matrix),
`ATM-002-R4` (disclosure and knowledge presentation primitives), and the completed **ATM-001 V1**
foundation, which this record **consumes and does not change**.

---

## 1. The problem this record resolves

ATM-001 V1 is complete: provenance, evidence, versioning, approval, publication, applicability,
AI-assistance disclosure and immutability are all implemented, enforced and production-accepted. The
experience, however, does not yet consume it: measured at the R1 baseline, **zero** views reference
Knowledge Packs, provenance, evidence, versions, publication or approval, and the knowledge surfaces
present templates as master data with no governance state.

The governing principle is R1 §2 D: governed content **appears where it helps the user perform or
understand work**, and governance internals are **not exposed merely because they exist**.

---

## 2. Three consumption contexts (and one that is not a context)

| Context | Trigger | What knowledge does |
|---|---|---|
| **1. During work** | A step in an inspection or a correction | Supplies the instruction, the safety information and the acceptance criterion for *this* step |
| **2. At a decision point** | An assessment, a monitoring review, an escalation-readiness review | Supplies what the governed knowledge says about *this* condition and how well established it is |
| **3. Deliberate browse** | The user chooses to study, compare or prepare | Allows search and reading by work intent |
| **Not a context: taxonomy browsing** | — | Browsing by category/class/type is an **expert secondary path**, never the primary way to find guidance. The current knowledge screens operate this way and are classified TRANSITION in R2 §4 |

**Rule:** knowledge is *addressed by the work*, not by the knowledge's own filing system. A user should
almost never have to know where knowledge lives.

---

## 3. Procedure discovery

| Entry | Behaviour |
|---|---|
| **From the task** | The applicable procedure is already attached to the work; discovery is not required |
| **From the asset** | After a scan, the guidance applicable to that asset (by equipment type and applicability) is offered in context |
| **From a condition** | From a Finding or observation, the knowledge relevant to that condition and taxonomy |
| **From search** | Free-text search over governed content, ranked by relevance to work; results state applicability and currency |
| **Ad-hoc** | A user may deliberately look up knowledge before starting work; this is the browse context |

**Discovery must state applicability honestly.** Where the governed applicability does not cover the
asset in front of the user, the experience says so rather than presenting the nearest procedure as if it
applied (ATM-001 applicability is explicit, never inferred).

---

## 4. Task and step execution

1. **One step at a time.** The step runner presents the current step, its safety content, its acceptance
   criterion, and its evidence capture. The next step is deliberately not the focus.
2. **Safety first and inseparable.** Safety information belongs to the step it governs and **cannot be
   collapsed away or scrolled past without acknowledgement** where the governed content marks it as a
   control (R1 §2 D; the ATM-001 safety-attestation model means this content is attested, not decorative).
3. **Progress is explicit**, interruption-safe, and survives navigation and session expiry
   (ATM-003-R2 §3.5). Resuming work resumes at the step, with the work's evidence intact.
4. **Governed selection over free text** wherever the domain has a vocabulary (R4 §8).
5. **Evidence capture is part of the step**, not an afterthought: reading with unit, photograph, note,
   or observation — per the step's requirement, and never mandatory beyond what the knowledge requires.

### 4.1 Inspection guidance

Inspection guidance is the same step mechanism with condition definitions, measurement instructions
(with units and tolerances where the governed knowledge states them) and the observation-versus-Finding
decision point of R5 §2. No separate "inspection module" is created.

---

## 5. Provenance, evidence and confidence — disclosed, not exposed

One disclosure pattern (R4 §6) is reused everywhere. It has three tiers:

| Tier | Shows | Audience |
|---|---|---|
| **T1 — Working cue** | A short plain-language statement of how well established this content is | Everyone, always visible |
| **T2 — What it rests on** | The authority and edition the content derives from, and a summary of its evidence, in user language | Operators who ask; Assessors routinely |
| **T3 — Engineering detail** | Deeper derivation notes, parameters, tolerances and references | Assessors, Knowledge Stewards, engineers |

**Never shown anywhere:** fingerprints and content hashes, internal identifiers, table or column names,
row-level provenance records, applicability junction rows, or governance state machines. These are the
mechanism; the user gets the meaning.

**Confidence cue language** is derived from ATM-001's governed vocabularies
(`established` / `provisional` / `experimental` / `uncertain`) and translated, not quoted.

---

## 6. Version and publication confidence cues

| Situation | Experience |
|---|---|
| Current published guidance | Presented as current, with the confidence cue of §5 |
| Guidance under review or not yet published | Marked as **not current guidance**; it must never be presented as authoritative to an operator. Where authored drafts exist, they are visible only to roles with a knowledge capability (R3) |
| Guidance superseded by a newer version | The newer version is shown, with a plain note that it replaced an earlier one |
| Guidance retired | Shown as no longer applicable, with what replaced it if anything |

**Mid-task version change rule:** if the governing knowledge changes while a user is executing it, the
experience **must not silently swap the content mid-step**. It either completes the step against the
version it started with, or stops and explains that the guidance changed and why the user must re-read.
Silent content substitution inside a task is prohibited.

---

## 7. Knowledge Packs — deliberately not a user-facing concept

A Knowledge Pack is a **composition and delivery mechanism**. In V1 it does **not** get an
operator-facing screen: an operator benefits from a pack's contents, not from knowing a pack exists.

- No "Packs" destination, no pack browser, no pack membership UI for work roles.
- Pack scope, membership and composition remain **administration/coverage concerns** (R2 §4:
  PLATFORM/ADMIN), visible only where a knowledge capability needs them.
- If later evidence shows users must reason about packs (e.g. choosing between competing pack editions),
  that is a new architectural question, not an extension of this decision.

---

## 8. AI assistance tied to governed knowledge

1. **Grounded, not generative authority.** AI may explain, expand, summarise, translate or point to
   governed content — but it **draws on governed knowledge** and must identify which governed item it is
   drawing on.
2. **Never authoritative.** AI output is never presented as engineering truth, and never replaces the
   governed content it summarises: the governed item remains the artefact of record (R1 §2 E).
3. **Disclosure follows ATM-001.** Where a governed item was itself produced with AI assistance,
   ATM-001's disclosure governs how that is represented; the experience presents it in user language and
   never as a raw governance field.
4. **Subordinate placement.** AI assistance appears at the point of need inside work — a suggested
   classification, a summarised procedure, an explanation of a condition — and never as a standalone
   destination or persistent chat (R1 §2 E; draft §16).

---

## 9. Backend governance concepts that need **no** first-class user screen

This list is the point of R1 §2 D. It is deliberately explicit so that no later slice builds an
administration screen merely because a table exists.

| Governed concept | Status in the experience |
|---|---|
| `knowledge_sources` / `knowledge_source_versions` (authority + edition registry) | **No screen.** Appears only as the T2 provenance disclosure |
| `knowledge_template_evidence` / `knowledge_template_version_evidence` | **No screen.** Summarised inside "what this rests on" (T2) and detailed in T3 |
| `knowledge_types`, `task_families`, maintenance strategies, trigger mechanisms | **No screen.** Governed vocabularies used as selections inside work |
| `knowledge_scope` and organization bindings | **No screen.** Expressed as applicability ("applies to your organization / shared") |
| `content_origin` and legacy classification | **No work-role screen.** Administration/coverage only |
| `ai_assisted` / `ai_assistance_detail` | **No screen.** Disclosed in user language where relevant (§8) |
| Crosswalk, external classification, identity resolution and their evidence | **No operator screen.** Governance/administration only (ATM-002-R2 §4) |
| Version tables, publication state, approval fingerprints, `approved_content_sha` | **No screen, ever.** Expressed as the §6 currency cue |
| Knowledge Pack membership and composition | **No work-role screen.** Administration/coverage only (§7) |
| Coverage validation tooling | **PLATFORM/ADMIN** (R2 §4) |
| Audit trails of governance acts | **No work-role screen.** Available to administration where an approved auditability requirement exists (ATM-003 broader scope) |

---

## 10. Knowledge authoring and review UI — deferred, with an explicit gate

**Decision: knowledge authoring/review surfaces are DEFERRED from V1.**

Evidence at this baseline: the production corpus is 846 legacy-generated definitions with **zero**
authored knowledge; no operational requirement for in-product authoring has been expressed; and ATM-003-R1
shows the capability exists (`knowledge.author` … `knowledge.publish`) while no authoritative role has yet
been provisioned.

**Gate for entering V1:** when an accountable Knowledge Steward must operate in-product — i.e. when the
first non-legacy knowledge is to be authored, reviewed, safety-attested or published by a human through
Atiman rather than by a governed system operation. At that point authoring is architected in its own
bounded record, reusing R4's primitives, and must respect ATM-001's lifecycle, separation of duties and
immutability rather than inventing a parallel flow.

**Explicitly not authorised by this record:** an authoring UI built because the tables exist.

---

## 11. What this record does not do

- No UI, no schema, no API, no change to ATM-001.
- No authoring/review surfaces (§10 is a deferral with a gate).
- No Packs UI (§7 is a decision *not* to have one).
- No offline knowledge caching architecture (**R7** owns connectivity; caching policy is platform-owned
  per ATM-003-R2).
- No visual specification beyond the primitives R4 already defines.

---

## 12. LCQE evidence

- Every consumption context maps to a work destination or decision point from R2/R5; no new destination
  is created.
- The "no first-class screen" table is enumerated from the ATM-001 V1 surface (tables, constraints and
  governance state read from the schema at this baseline), not from assumption.
- The version-change rule and the applicability-honesty rule are stated as prohibitions, because both are
  ways an experience silently misleads a user about authoritative guidance.
- Authoring UI is deferred with a measurable gate (first human-authored non-legacy knowledge), and the
  record states that building it because tables exist is not authorised.

---

**ATM-002-R6 — knowledge-in-context experience approved. No authoring UI; no Packs screen; no ATM-001 change.**
