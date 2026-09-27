# ATM-002-R1 — Experience Architecture V1 (Ratified Baseline)

**Document ID:** ATM-002-R1
**Status:** **APPROVED V1** — OWNER / Chief Architect decisions recorded 2026-09-27.
**Supersedes the *status* of:** `ATM-002-Experience-Architecture.md` (historically drafted
2026-08-10 as "Draft for Review"). That draft is **retained as historical reasoning**; this record
is the authority for V1.
**Baseline:** `origin/main` = `4d5b267abcf076653347e21dd39ae16b5e813192`
**Scope:** architecture and controlled records only. No implementation, no schema, no routes, no CSS.

---

## 1. Authority

Per the **Atiman Product Constitution** (`ATM-000`, now ratified) and the authoritative
ATIMAN_PROJECT_SOURCE chain: the Constitution is the highest product authority; Project Sources are
authoritative; conversations are exploratory; **approved architecture outranks implementation**.

This record derives from, and does not alter, ATM-000 §5 (axioms), §6 (principles), §13 (product
boundaries), §14 (permanent architecture), §16 (experience philosophy) and §17 (AI philosophy), and
from the completed **ATM-001 Knowledge Foundation V1**.

**Two ATM-001 governing facts constrain this record:** the Knowledge Foundation is complete and
immutable as accepted; and its governance substrate — provenance, evidence, versioning, approval,
publication, AI-assistance disclosure — exists and must be *consumed* by the experience, not
re-opened by it.

---

## 2. Approved V1 experience principles

These are **APPROVED V1**. Each is a constraint on every later experience decision.

| # | Principle | What it means in practice |
|---|---|---|
| **A** | **Task-first** | Navigation and surfaces organize around the user's objective and work — not around database tables or CMMS modules. |
| **B** | **Finding as the primary operational object** | The operational experience preserves **Inspection → Finding → Assessment → Action → Closure**, with assessment outcomes **Operator Correction**, **Monitoring**, **Escalation**. Work Order is **not** an Atiman primary object. |
| **C** | **Operator-first / mobile-first** | Field work is the primary experience constraint. Desktop experiences may exist for work genuinely benefiting from information density. **Mobile-first does not mean mobile-only.** |
| **D** | **Knowledge in context** | Governed ATM-001 content appears where it helps the user perform or understand work. Governance/database internals are **not** exposed merely because they exist. |
| **E** | **Contextual AI** | AI is not a permanent standalone product destination; it may assist, recommend, explain and analyze inside relevant work. **Humans remain accountable.** |
| **F** | **EAM escalation boundary** | Escalation prepares an evidence-rich handoff/package for an enterprise EAM. Atiman **does not** become the work-order planning or execution system. |
| **G** | **Progressive disclosure** | Show the minimum required for the current decision; deeper engineering and governance evidence is available when needed. |
| **H** | **Accessibility — WCAG 2.1 AA** | WCAG 2.1 AA is the V1 target. The existing `user-scalable=no` behaviour is **architectural debt** and is not an approved experience pattern. |

---

## 3. Classification of the historical ATM-002 draft

Every section of the 2026-08-10 draft is classified. Nothing is erased; superseded reasoning remains
readable in the draft.

| Draft section | Classification | Disposition |
|---|---|---|
| §3 Core Experience Principles | **APPROVED V1** | Reconciled into §2 above (A–H) |
| §4 Task-First Navigation — principle | **APPROVED V1** | Principle binding; see §2 A |
| §4.1 Navigation Model (concrete six-item bar) | **DEFERRED** | Concrete IA and navigation model are decided by **ATM-002-R2**; the six-item bar is explicitly **not** ratified (see §5) |
| §4.2 Entry Points / §4.3 Deep Links | **DEFERRED** | Canonical entry point and deep-link principles decided in **R2** |
| §5.1 Roles and Primary Experiences (operator, supervisor, engineer, admin) | **HISTORICAL / SUPERSEDED** | The role list is superseded by the capability architecture in **ATM-003-R1**; it assumed an "engineer" account that does not exist in the implementation |
| §5.2 Role-Based Surface Rules / §5.3 Cross-Role Continuity | **DEFERRED** | Decided by **ATM-002-R3** on the accepted capability model |
| §6 Operator-First / Mobile-First Workflows | **APPROVED V1** with correction | Operator-first and mobile-first approved; the draft's mobile-centric framing is corrected by **C** (desktop may exist) |
| §6.2 Mobile Design Rules / §6.3 Evidence Capture / §6.4 Safety-First Presentation | **DEFERRED** | Concrete rules decided in **R7** (field/accessibility/connectivity) and **R6** (safety in context) |
| §7 Finding-Centric Interaction Model | **APPROVED V1** in principle | Detail — observation vs Finding, assessment presentation, the three outcomes, closure — decided in **ATM-002-R5** |
| §8 Supervisor Experience | **APPROVED V1** in principle | Assessment and accountability approved; presentation decided in **R3**/**R5** |
| §9 Engineer / Knowledge Steward Experience | **OPEN** | No such accountable role exists today; whether knowledge **authoring/review** UI belongs in V1 is **not yet proven** (see **R6**) |
| §10 Knowledge-in-Context UX | **APPROVED V1** | Detailed in **ATM-002-R6** |
| §11 Contextual AI Behavior | **APPROVED V1** | Principle binding; presentation patterns decided in **R4**/**R6** |
| §12.1 Core Objects / §12.2 Object Relationships | **APPROVED V1** | Finding-centric object model approved; concrete IA decided in **R2** |
| §12.3 Avoid Module-Centric Language | **APPROVED V1** | Binding |
| §13 Design-System Principles | **APPROVED V1** as principles | Concrete token/component architecture decided in **ATM-002-R4** |
| §14 Accessibility | **APPROVED V1** | WCAG 2.1 AA ratified; `user-scalable=no` reclassified as debt (see §2 H) |
| §15 Offline Expectations (critical flows, sync behaviour) | **DEFERRED** | Offline **mutation/synchronisation is not ratified**; only degraded/offline **reading** expectations are in scope (see §5 and **R7**) |
| §16 Legacy UI Patterns to Discard | **APPROVED V1** | All nine patterns discarded, with the reconciliation in §4 |
| §17 Open Questions 1–8 | **mixed** | Q4 accessibility → **APPROVED** (WCAG 2.1 AA). Q1 role model → **OPEN, owned by ATM-003-R1**. Q8 escalation-review screen → **addressed by R5**. Q2 (mobile platform targets), Q3 (offline sync), Q5 (branding), Q6 (AI presentation), Q7 (notifications) → **OPEN** |
| §18 Decision Record 1, 2, 4, 5, 6, 7, 9, 10 | **APPROVED V1** | As recorded in §2 |
| §18 Decision Record 3 ("Operator-first, mobile-first") | **APPROVED V1** with correction | Qualified by **C**: mobile-first ≠ mobile-only |
| §18 Decision Record 8 ("Offline support for critical field flows") | **DEFERRED** | Consistency with §2/§15: offline mutation is not ratified |

---

## 4. ATM-005 reconciliation (stale premise corrected, observation retained)

`ATM-005-Legacy-UX-Inventory.md` states that the existing UI is *"a module-first, work-order-centric
CMMS"* and lists *"module-first bottom navigation"* among the assumptions to discard.

**That premise is partly stale, and the historical observation is retained rather than erased.**
Measured state at this baseline:

- The **primary navigation has already evolved toward task-first**: the live bottom bar is
  `Today · Inspect · Report · Know · Assess · Escalate`, with per-item role gating. It is *not* a
  module menu.
- The **underlying route and view surface remains substantially legacy and module-oriented**:
  `/mobile/work-orders(+/:id)`, `/mobile/calendar`, `/mobile/maintenance-plans(+/new,/:id/edit)`,
  `/mobile/reports/{work-order-summary,equipment-report,technician-report,schedule-compliance,trends}`,
  `/mobile/coverage/*`, `/mobile/admin/*` (18 surfaces), plus archived duplicate views.
- ATM-005's per-screen REFACTOR/REPLACE/RETAIN/REMOVE verdicts therefore remain **useful historical
  evidence**, and its §4 discard list and §6 implementation ordering remain **candidate input** —
  but its claim about the *primary navigation* must not be relied on as current fact.

This reconciliation is recorded into ATM-005 by a status annotation; its content is not rewritten.

---

## 5. Explicitly NOT ratified by this record

| Not ratified | Why | Where it will be decided |
|---|---|---|
| The current six-item bottom navigation as the final information architecture | Two of its six items are duplicate destinations (`Report`→inspection adhoc, `Escalate`→findings list), and `Escalate` has no distinct surface; duplicate destinations prove it is not a settled IA | **ATM-002-R2** |
| Durable **offline write / synchronisation** architecture | Mobile-first does not itself prove a requirement for distributed offline mutation. Operational requirements and platform analysis are missing | **Deferred** — see **R7** for the evidence required |
| ATM-003's proposed **eleven-role list** | It is a draft proposal; the implemented model has three roles, and ATM-003 itself records the role/permission model as requiring refactoring | **ATM-003-R1** |
| A **branding/visual identity** (final palette, logotype, type faces) | No approved branding constraints exist | **OPEN** — R4 defines token *architecture*, not brand values |
| Knowledge **authoring/review UI** in V1 | No authoritative role exists yet and no operational evidence yet proves V1 needs it | **ATM-002-R6** (explicitly evidence-gated) |
| Desktop information architecture | Desktop "may exist" is approved; what desktop owns is not yet decided | **ATM-002-R2** |
| Supervisor notification channels | No approved channel decision | **OPEN** |

---

## 6. Consequences for the remaining ATM-002 records

- **R2** decides the task-first information architecture and the per-surface disposition, and must not
  rename legacy modules into task-like labels.
- **ATM-003-R1** must supply the minimum role/capability model before **R3** can define the
  role-aware experience matrix.
- **ATM-003-R2** must fix the platform/product shell ownership boundary, which R2 and R7 depend on.
- **R4–R7** are constrained by §2 A–H and by §5's non-ratified list.
- No later record may contradict **ATM-001 V1**; where a later record needs a knowledge capability
  that ATM-001 defers, it must record a dependency rather than assume it exists.

---

## 7. LCQE evidence for this record

- Every classification above was derived from the actual draft sections (read in full) and from
  measured repository state, not from memory.
- The ATM-005 reconciliation rests on measured evidence: bottom-bar composition and role gating read
  from `views/partials/mobile-bottom-nav.ejs`; the module-oriented route inventory read from
  `src/routes/mobile.routes.js`; archived views counted under `archive/views/**`.
- The accessibility correction rests on measured evidence: `user-scalable=no` present in 4 views.
- No ATM-001 architecture is changed; no implementation is authorised by this record; no
  constitutional substance is altered.

---

**ATM-002-R1 — Experience Architecture V1 baseline ratified. Architecture and records only.**
