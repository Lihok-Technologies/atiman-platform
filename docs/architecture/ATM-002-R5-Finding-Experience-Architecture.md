# ATM-002-R5 — Finding Experience Architecture

**Document ID:** ATM-002-R5
**Status:** **APPROVED V1** — experience architecture only. No schema is designed and no workflow is
implemented by this document.
**Baseline:** `origin/main` = `3564772a6a4a73c8de2b50b4d84320f28506f1c8`
**Depends on:** `ATM-002-R1` §2 (principles), `ATM-002-R2` (destinations), `ATM-002-R3` (matrix),
`ATM-002-R4` (state and disclosure patterns).

---

## 1. The chain this experience must preserve

**Inspection → Finding → Assessment → Action → Closure**, with assessment outcomes **Operator
Correction**, **Monitoring**, **Escalation** (ATM-002-R1 §2 B). The chain ends with an **evidence-rich
handoff to an enterprise EAM** (R1 §2 F). Atiman never plans or executes the resulting maintenance work.

**Work-order concepts are removed from the Atiman mental model.** No assignment, no scheduling, no due
date, no "work order" object, no technician dispatch, no completion-of-work semantics appears anywhere in
this experience. Where the legacy application expresses those ideas, they are EAM material (R2 §4).

---

## 2. Observation versus Finding — the distinction the experience must make

This is the single most important conceptual decision in this record, because conflating the two either
over-governs routine evidence or under-governs real findings.

| | **Observation** | **Finding** |
|---|---|---|
| **What it is** | What the operator recorded in the moment: a condition, reading, photograph, note | A governed operational assertion about condition that requires assessment and carries an outcome |
| **Accountability** | The operator is accountable for the accuracy of what they recorded | The **assessor** is accountable for what it means; the operator remains accountable for the underlying report |
| **Obligation created** | **None** by itself — it may be routine evidence of work performed | An obligation to assess, and from the outcome, to act, monitor or escalate |
| **Who owns it next** | Nobody, unless promoted | The assessment queue |
| **Reversibility** | Freely amendable while the work is in progress | Immutable in its reported substance; corrections are new attributed statements, never silent edits |

**Experience rules:**

1. **Capture before classification.** The reporting moment optimises for recording what was observed
   (photo, reading, note, condition) — never for completing a form. Classification is a step the operator
   may reach, not a gate they must pass (R1 §2 G).
2. **Many observations never become Findings, and that is a success, not a failure.** Routine readings and
   photographic evidence of completed work are legitimate observations with no assessment obligation.
3. **Promotion is explicit and accountable.** The moment an observation becomes a Finding, the experience
   states plainly that it now asserts something about the asset, that it will be assessed, and who is
   accountable for that assertion. Because this is where accountability attaches, it is never inferred
   from a form field.
4. **The operator is never asked to decide an outcome.** Reporting ends at "this is what I observed";
   deciding Operator Correction, Monitoring or Escalation is an Assessor act (R3 §2.2).
5. **Nothing is lost silently.** A report in progress survives navigation, interruption and session
   expiry (ATM-003-R2 §3.5). Whether it survives *disconnection* is governed by R7 — and until that is
   resolved, the experience must **state** connectivity rather than imply durability (§8).

---

## 3. The report moment

| Step | Experience |
|---|---|
| **Enter** | From Today (assigned or available work), from an inspection step, from asset context after a scan, or ad-hoc from Report |
| **Context already known** | The asset, the inspection and the step (when reached from work) are carried in — the operator never re-identifies what the system already knows |
| **Capture** | Evidence first: photo, reading with explicit unit, note, and governed condition selection. The screen is usable one-handed and gloved (R7) |
| **Classify (optional)** | Governed taxonomy selections (what kind of condition, severity as defined by governed vocabulary) — never free text where a vocabulary exists (R4 §8) |
| **Decide** | *Record observation* (no obligation) or *Raise Finding* (obligation, accountable assertion) |
| **Confirm** | A short, plain statement of what was recorded and what happens next — proportionate, not ceremonial |
| **AI (optional)** | May suggest a classification, summarise the evidence, or point to relevant knowledge. It is clearly marked as a suggestion, and the operator confirms or discards it (R1 §2 E) |

Knowledge appears **in context** during capture — the relevant procedure step and its safety information
are available without leaving the moment (R6 §details the disclosure rules).

---

## 4. Assessment presentation

The Assessor's surface answers, in order: *what was asserted, on what evidence, on which asset, what
does the governed knowledge say, and what has happened here before.*

| Element | Rule |
|---|---|
| **The claim** | The Finding's assertion in the reporter's own recorded words, with its evidence, unedited |
| **Evidence review** | All captured evidence in one place; each item shows its capture context |
| **Asset context** | The asset, its identity, and its finding history as an evidence timeline (R2 §2.2) |
| **Knowledge in context** | The applicable procedure, safety information and condition definitions, with provenance disclosed plainly rather than as internals |
| **Precedent** | What was decided for comparable findings on this asset or type, presented as *information*, never as an automatic decision |
| **The decision** | Exactly one of the three outcomes, chosen explicitly, with an accountable confirmation and an optional rationale |
| **AI (optional)** | May summarise evidence, highlight the governing knowledge, or propose a candidate outcome with reasoning. It **never** records the decision, and the interface never pre-selects an outcome on its behalf (R1 §2 E) |

**Attribution is visible and human.** The outcome records who decided it; the experience surfaces that,
because it is the point at which accountability for the asset's condition becomes explicit.

---

## 5. The three outcomes — experience definition

### 5.1 Operator Correction

**Meaning:** the condition is dealt with now, as ordinary operator work, and the record documents what
was done. It is not a work order and creates no planning artefact.

- The experience optimises for **"fix it and record it"**: the correction action, the evidence of the
  corrected state, and the outcome in one flow.
- It presents **no** assignment, approval chain, scheduling or completion semantics — those are EAM
  concepts (R1 §2 F).
- It remains **accountable**: who corrected it, when, and with what evidence.
- Closure is by **verification of the corrected state**, not by "work completed".

### 5.2 Monitoring

**Meaning:** the condition is not corrected now and not yet escalated; it will be watched over time.

- Monitoring is **first-class**, never a note on a closed finding: what is being watched, what would
  change the decision, and when it must be revisited.
- It carries a **temporal affordance** (R4 §4) whose *effect in the experience* is that monitoring
  produces **attention items in Today** for the relevant profile — **not** scheduled work and not
  assigned tasks.
- Each monitoring capture is an observation attached to the same Finding; the Finding's history shows the
  trend rather than a series of disconnected reports.
- Monitoring ends in one of three explicit ways: **improved** (→ closure), **worsened** (→ assessment
  again, typically escalation), or **inconclusive** (→ assessment again, with the decision recorded).

### 5.3 Escalation

**Meaning:** the condition warrants enterprise maintenance planning or execution, and Atiman prepares an
evidence-rich handoff.

- Escalation is presented as **leaving Atiman's boundary** (R1 §2 F): the experience is explicit that
  planning and execution are the EAM's, and that Atiman's role is to hand over a well-evidenced case.
- **Escalation-readiness review** is a distinct moment with its own accountability: a named human reviews
  the package and approves it. Approval is an attributed decision, not a button that reflects a status.
- After handoff, Atiman records the **outcome it learns about**; it does not track execution, and no
  work-order-shaped artefact is created in the Atiman experience.

---

## 6. Escalation-readiness review — what the reviewer sees

Experience content of the package (presentation, not schema):

1. **Asset identity and context** — what the asset is, where it is, its current operational state.
2. **The finding** — the assertion, the reporter, when it was observed, the evidence.
3. **The assessment** — who decided escalation and why, including the rationale.
4. **Condition trajectory** — for a finding that went through Monitoring: what changed over time.
5. **Governing knowledge** — the applicable procedure and safety information, with a plain-language
   confidence cue (R1 §2 G) so the EAM inherits the case's evidential strength honestly.
6. **Recommended action context** — what the governed knowledge supports; clearly marked as context, not
   as a maintenance plan (Atiman does not plan).
7. **Explicit boundary statement** — what Atiman is handing over and what it is not.

The reviewer's decision is **approve for handoff** or **return** (with the reason recorded and attributed).
Neither option is a scheduling, prioritisation or resourcing decision.

---

## 7. Closure

| Outcome | Closure means | What closure is *not* |
|---|---|---|
| Operator Correction | The corrected state is verified, with evidence | "Work completed" |
| Monitoring | The condition resolved, or a new assessment supersedes the monitoring decision | "Task finished" |
| Escalation | Handoff completed, and any subsequent outcome Atiman learns is recorded | "Work order closed" |

Closure is attributed, and the Finding remains readable as history: the asset's context shows closed
findings as an evidence timeline (R2 §2.2).

---

## 8. Connectivity, AI and accountability boundaries

- **Connectivity:** the experience always shows when the device is not online (R4 §4), and must never
  imply that a report is durably saved when it is not. **Durable offline capture is unratified** and is an
  unresolved R7 decision; this record requires only that the user is never misled and never silently loses
  input.
- **AI:** assistance is contextual and subordinate (R1 §2 E). It may suggest, summarise and explain; it
  never records an observation, never decides an outcome, never approves escalation, and never becomes a
  source of engineering truth. Where AI contributed to content, that disclosure follows ATM-001's
  AI-assistance governance.
- **Human accountability:** every outcome and every escalation approval is an attributed human decision.

---

## 9. PR #27 — treated as implementation evidence, not as architecture

An open, unmerged change exists (`ATM-001: implement finding assessment (Operator Corrected / Monitor /
Escalate)`, head `a8511bcd…`). It was **not read as authority, not modified, and not merged** here.

**Its status for this architecture: implementation evidence requiring separate adjudication.** Its
outcome vocabulary appears consistent with the approved three outcomes, but:

- this record **does not ratify** its data model, its lifecycle states or its API shape;
- its shape was designed against the **legacy** `findings` table, which is SAP-notification-centric and
  carries `status`, `requires_sap_notification` and `sap_notification_*` — concepts this record retires
  from the Atiman mental model (R2 §4);
- before that change can be accepted, it must be adjudicated **against this experience architecture**
  (observation vs Finding, the three outcomes as accountable decisions, no work-order concepts) and
  against ATM-001's governance, in its own bounded mission.

---

## 10. What this record does not do

- No schema, no lifecycle state machine, no API, no permissions, no implementation.
- No decision on whether Findings are stored on the existing `findings` table or elsewhere.
- No offline mutation architecture (**R7**), no visual specification (**R4**), no knowledge disclosure
  rules (**R6**).

---

## 11. LCQE evidence

- Every element traces to an approved outcome or principle (R1 §2 B, E, F, G); nothing new is invented
  as product capability — the record specifies experience only.
- Work-order concepts are excluded explicitly and repeatedly, including in closure semantics, which is
  where CMMS vocabulary most easily re-enters (assignment, due dates, dispatch, completion).
- The observation/Finding distinction is stated with its accountability consequence, which is what makes
  it an architectural decision rather than a UI preference.
- PR #27 is explicitly framed as unadjudicated implementation evidence, avoiding both silent acceptance
  and silent rejection.
- Offline durability is left unresolved and labelled, consistent with R1 §5.

---

**ATM-002-R5 — Finding experience architecture approved. Experience only; no schema, no implementation.**
