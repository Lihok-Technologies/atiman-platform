# ATM-002-R2 — Information Architecture and Surface Disposition

**Document ID:** ATM-002-R2
**Status:** **APPROVED V1** — architecture record. No routes are implemented by this document.
**Baseline:** `origin/main` = `b44a31d60a545305a60f8397b10abfd98db77d9d`
**Governed by:** `ATM-002-R1` §2 A–H (approved V1 principles) and its §5 (not-ratified list).

---

## 1. Method — destinations follow work, not modules

A destination is admitted only if it answers a distinct **user objective**, and is named for the work,
not for a data structure. Renaming a legacy module to a task-like label does **not** satisfy this test
and is explicitly rejected: e.g. "Work Orders" cannot become "Maintenance Tasks" and remain a
work-order surface.

Two questions decide every case:

1. *Whose work is this, and is it Atiman's work?* (Constitution §13 boundaries; ATM-002-R1 §2 F)
2. *Does a user arrive here to accomplish something, or to maintain data?* (R1 §2 A, G)

---

## 2. The destination set

### 2.1 Work destinations (the product's operational surface)

| Destination | User objective | Contains | Derived from |
|---|---|---|---|
| **Today** | "What needs my attention now?" | Assigned/available inspections; findings awaiting assessment; findings under monitoring that are due; recently reported findings awaiting closure; connectivity state | Approved entry experience; replaces the generic dashboard concept |
| **Inspect** | "Perform an inspection" | Initiate (assigned, scheduled-by-knowledge, or ad-hoc) and execute an inspection against governed knowledge | Inspection → Finding chain (R1 §2 B) |
| **Report** | "Record what I observed" | Capture an observation (photo, reading, note, condition) and promote it to a Finding with classification; the moment of accountable reporting | R1 §2 B; R5 defines the observation/Finding distinction |
| **Assess** | "Decide what this Finding means" | Assessment queue; evidence review; the accountable outcome decision — Operator Correction, Monitoring, Escalation | R1 §2 B |
| **Monitor** | "Watch a condition over time" | Findings under monitoring, follow-up captures, monitoring expiry/review | R1 §2 B (Monitoring is a first-class outcome, not a note) |
| **Escalate** | "Prepare an evidence-rich handoff" | Escalation readiness review and the package handed to an enterprise EAM | R1 §2 B, F |
| **Knowledge** | "Understand and follow authoritative guidance" | Contextual knowledge during work; deliberate browse/search when not in a task | R1 §2 D; R6 defines the experience |

### 2.2 Contexts (entered from work, not destinations themselves)

| Context | Role in the IA | Rationale |
|---|---|---|
| **Asset context** | Reached by scanning a QR/asset or from a Finding/Inspection; shows what to do here, open findings, and history as an evidence timeline | The discarded legacy pattern is *"asset register as the landing page"* (R1 §3, draft §16). Asset context must remain **task-centred**, never a register-first destination |
| **Knowledge in context** | Surfaces inside Inspect / Report / Assess / Monitor / Escalate rather than requiring navigation away | R1 §2 D |
| **Evidence / provenance disclosure** | Progressive disclosure inside a Finding, inspection or knowledge item | R1 §2 G; R6 defines what is disclosure vs first-class screen |

### 2.3 Platform destinations (not work navigation)

**Administration** and **Profile/Session** are platform concerns. They are reachable, role-gated, and
**must never appear in the primary work navigation**. Their ownership boundary is fixed by
`ATM-003-R2`; their presentation is ATM-002's.

### 2.4 Explicitly rejected as destinations

Generic **Dashboard**, **Reports**, **Calendar**, **Schedules**, **Work Orders**, **Assets (register)**,
**Custom Fields** and **Coverage** are not V1 destinations. Each is either EAM-owned, retired, or a
platform/admin concern (§4).

---

## 3. Navigation principles

### 3.1 Canonical entry point

- **Authenticated work users enter at Today.** That is the product's canonical entry point and the PWA
  start target once the PWA is aligned (see `ATM-003-R2` for shell ownership).
- **Unauthenticated users enter the platform shell** (login/onboarding), which is a platform concern.
- **Administration is never an entry point.** A platform/admin user who also performs work still lands
  on Today and reaches administration deliberately.

### 3.2 Deep-link principles

1. Every governed object — Finding, inspection, knowledge item, asset context, escalation package —
   has a **stable, addressable identity**; any user authorised to see it may be linked directly to it.
2. A deep link lands **in the object's working context**, never on a module index or a list page.
3. Deep links resolve **through authorization**, not around it; an unauthorised deep link fails closed
   with an explanatory state, never a silent redirect to a different object.
4. A deep link into a **retired** surface (e.g. a legacy work-order page) must resolve to a defined
   disposition state, not to a broken or resurrected legacy screen.
5. Deep links are **not** the primary navigation mechanism for operators in the field: scanning and
   Today remain the field entry paths.

### 3.3 Back and navigation principles

1. **Back means "the previous step in my work", not "the previous module level".** No destination may
   require the user to traverse a hierarchy that mirrors data structure.
2. **No dead ends.** Every terminal state (closed Finding, completed inspection, finished assessment)
   offers a defined next destination: Today, the parent object, or the next item in the current queue.
3. **Browser/OS back must remain coherent.** The current field shell relies on `history.back()` in the
   header; that is **historical behaviour, not an approved pattern**, because it breaks on deep links
   and on first-entry screens. V1 requires an explicit origin model (where did I come from, where does
   back go) rather than history dependence.
4. **State survives navigation.** Returning to a queue must not lose position, filters or the user's
   place in a multi-step flow.

### 3.4 Mobile navigation principles

1. The primary bar is composed of **work destinations only**, role-composed, with **no duplicate
   destinations**. A destination that only exists to fill a slot creates an IA defect (measured today:
   `Report` and `Inspect` share `/mobile/inspection/adhoc`; `Assess` and `Escalate` share
   `/mobile/dashboard/findings`).
2. The bar is **not required to expose every destination**: destinations beyond the primary set are
   reached from Today, from context, or from a secondary overflow — not by crowding the bar.
3. **Asset context is a scan affordance**, not a tab.
4. **Administration never occupies a work slot.**
5. The bar's final composition per role is decided in `ATM-002-R3`; this record fixes the destination
   set, the composition rules, and the prohibition on duplicates. The present six-item bar is
   **transitional evidence only** and is not ratified by R1 or by this record.

### 3.5 Desktop navigation principles

1. Desktop uses **the same information architecture** as mobile, presented with greater simultaneity —
   it is not a second product with its own conceptual model.
2. Desktop is the appropriate home for **high-density work**: assessment queues with more context,
   knowledge review, escalation-package review, and platform administration *(and, only if later
   evidence proves it belongs in V1, knowledge authoring — see R6)*.
3. Desktop must not reintroduce the discarded patterns: no module menu, no work-order grid as a primary
   surface, no asset register landing page.
4. Any surface that exists on desktop **but has no mobile counterpart** must be justified as
   information-density work, per R1 §2 C.

---

## 4. Surface disposition

Classification vocabulary: **RETAIN** (keep conceptually, subject to R4/R6 experience work) ·
**TRANSITION** (keep temporarily, must be replaced) · **FOLD INTO TASK FLOW** (capability survives
inside a work destination) · **RETIRE** (remove from the Atiman experience) · **PLATFORM/ADMIN**
(platform or administrative, outside work navigation) · **OUTSIDE ATIMAN PRODUCT BOUNDARY**
(EAM/ERP-owned; not an Atiman capability), abbreviated **OUTSIDE** in the table below.
Every **OUTSIDE** row means the full classification, not a weaker one.

| Existing surface | Evidence at baseline | Disposition | Rationale |
|---|---|---|---|
| `/mobile/today`, `home.ejs` | 2 routes/views | **RETAIN** → becomes the canonical Today | PWA entry drift (`start_url=/mobile/home`) is resolved in favour of Today |
| `/mobile/inspection/*`, `inspection.ejs` | 6 routes; step runner | **RETAIN** (transition to knowledge-driven execution) | Core work; ATM-005 already flagged the reusable step-runner |
| `/mobile/dashboard/findings`, `dashboard/*` | 3 views | **FOLD INTO TASK FLOW** | The findings list becomes Assess/Monitor/Escalate work queues, not a "dashboard" |
| `finding` API surface (legacy shape: `status`, `requires_sap_notification`, `sap_notification_*`) | migration 004 table; 369-line controller | **TRANSITION** — legacy semantics retired from the Atiman mental model | The SAP-notification work-order precursor is EAM-escalation machinery, not the approved Finding; R5 defines the experience, and PR #27 is implementation evidence requiring separate adjudication |
| `/mobile/asset`, `asset-context.ejs`, `asset-history.ejs` | operator surfaces | **FOLD INTO TASK FLOW** (asset context) | Task-centred asset context retained; register-first framing retired |
| `/mobile/templates`, `knowledge-*.ejs`, `template-list.ejs` | 9 routes; **0** references to lifecycle/version/approval/evidence | **TRANSITION** → R6 knowledge-in-context, with browse secondary | Knowledge is currently presented as master data with no governance state, contradicting R1 §2 D |
| `template-editor.ejs`, `maintenance-plan-editor.ejs` | authoring/editing surfaces | **TRANSITION / DEFERRED** | Knowledge authoring UI in V1 is evidence-gated (R6); maintenance-plan editing is EAM-owned |
| `/mobile/work-orders(+/:id)`, `work-order-detail.ejs`, `dashboard/work-orders.ejs` | 5 routes, 2 views | **OUTSIDE ATIMAN PRODUCT BOUNDARY** | Work Order is not an Atiman primary object (R1 §2 B); ATM-000 §11 and draft §16 |
| `/mobile/reports/work-order-summary` | report view | **OUTSIDE** | Work-order reporting is EAM territory |
| `/mobile/reports/technician-report` | productivity report | **OUTSIDE** | Workforce/productivity metrics belong to EAM/HR (ATM-005 §4) |
| `/mobile/reports/schedule-compliance` | compliance report | **OUTSIDE** | Schedule compliance implies Atiman owns scheduling |
| `/mobile/calendar`, `calendar.ejs` | scheduling surface | **OUTSIDE** | Calendar/PM planning is EAM-owned (ATM-005 §4) |
| `/mobile/maintenance-plans(+/new,/:id/edit)`, `maintenance-plans.ejs` | 3 routes, 2 views | **OUTSIDE** | In-app planning/execution violates the EAM boundary |
| `/mobile/reports/*` (remaining: equipment-report, trends, reports.ejs, report-placeholder) | reporting | **PLATFORM/ADMIN** or **OUTSIDE** per case | Knowledge-quality and coverage reporting may be platform/admin; asset/productivity reporting is EAM-owned |
| `/mobile/coverage/*`, `coverage-*.ejs` | 6 routes, 7 views | **PLATFORM/ADMIN** | Inspection/knowledge coverage is a governance concern, not field work |
| `/mobile/admin/*` | 18 routes, 18 views | **PLATFORM/ADMIN** | Consolidate into administration; never in work navigation |
| `/mobile/admin/custom-fields`, `/api/custom-fields` | extensibility surface | **RETIRE** | ATM-005 §4: taxonomy and knowledge replace ad-hoc custom fields |
| `/mobile/admin/facilities` | facility management | **PLATFORM/ADMIN** (minimal configuration only) | Facilities are operational data; keep only what configuration requires |
| `/mobile/equipment`, `/mobile/assets`, `/mobile/equipment-list.ejs`, `/mobile/admin/assets.ejs` | equipment list/registry surfaces | **FOLD INTO TASK FLOW** (asset context) + **PLATFORM/ADMIN** (the admin list) | The asset **registry** is not a destination: asset identity is reached by scan or from work context. Registry maintenance is administrative. |
| `/api/equipment`, `/api/assets` (asset registry APIs) | platform data services | **PLATFORM/ADMIN** (service layer) | Asset identity and hierarchy remain platform data, not a work destination |
| `/mobile/admin/users`, `organization`, `subscription`, `sso`, `api-keys`, `invitations`, `audit-logs` | administrative surfaces | **PLATFORM/ADMIN** | Platform/tenancy concerns; shell ownership fixed by ATM-003-R2 |
| `/mobile/qr-labels*`, `qr-label-view.ejs`, `qr-labels-batch.ejs` | label generation/printing | **RETAIN** as a supporting platform utility | Enables the scan affordance that makes asset context work |
| `/mobile/onboarding-wizard.ejs` | setup wizard | **PLATFORM/ADMIN** | Belongs to platform onboarding (ATM-003-R2) |
| `views/index.ejs`, `views/login.ejs`, `views/signup.ejs` | root pages with a third inline design system; legacy "Operator-Driven Maintenance" branding | **PLATFORM** (shell) + **TRANSITION** (branding) | Shell ownership in ATM-003-R2; branding residue tracked in R4 |
| `views/partials/mobile-header.ejs`, `mobile-bottom-nav.ejs`, `mobile/layout.ejs` | the shell itself | **TRANSITION** | Retained as transitional evidence; its `history.back()` behaviour and duplicate nav targets are not approved patterns (§3.3, §3.4) |
| `archive/views/**` (13 + 7) | archived duplicates | **RETIRE** | Superseded; retained only as history |
| `style.css`, `odm-mobile.css`, `odm-responsive.css`, `iso-ui.css` | 4 CSS systems, 1,942 inline styles | **TRANSITION** — migration strategy in R4 | Not an IA decision, recorded here only to prevent a second IA from accreting in legacy CSS |

**Rule applied throughout:** *Atiman must not retain EAM-owned functionality merely because the legacy
application already contains it.* Every EAM-owned row above is classified **OUTSIDE**, not
"transition", deliberately: keeping it as "transitional" is how a CMMS survives in a task-first product.

---

## 5. What this record does not do

- It does not implement, rename, redirect or delete any route.
- It does not decide the per-role navigation composition (**ATM-002-R3**), the design system
  (**R4**), the Finding experience detail (**R5**), knowledge-in-context (**R6**) or field/connectivity
  behaviour (**R7**).
- It does not decide platform-shell ownership (**ATM-003-R2**).
- It does not authorise retiring live surfaces: the retirement of EAM-owned surfaces is an
  implementation decision that requires its own bounded mission, and until then those routes remain
  reachable but **outside the Atiman information architecture**.

---

## 6. LCQE evidence

- Destination set derived from R1 §2 A–H and the Constitution, not from the legacy screen list.
- Every disposition row cites measured baseline evidence (route/controller/view existence, counts read
  from the repository at the stated baseline).
- The duplicate-destination finding, the `history.back()` reliance, the PWA entry-point drift
  (`start_url=/mobile/home` vs Today) and the "0 governance references in knowledge views" measurement
  are all previously measured facts, restated here rather than assumed.
- No ATM-001 architecture is touched; no EAM-owned surface is claimed as Atiman capability.

---

**ATM-002-R2 — task-first information architecture and surface disposition approved. Architecture only.**
