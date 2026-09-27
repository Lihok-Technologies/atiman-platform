# ATM-002 — Atiman Experience Architecture

**Document ID:** ATM-002  
**Title:** Atiman Experience Architecture  
**Status:** Controlled Architecture Document — Draft for Review *(historical)*.  
**Authority for V1 is `ATM-002-R1-Experience-Architecture-V1.md`**, which ratifies the approved
V1 principles, classifies every section of this draft (APPROVED V1 / DEFERRED / OPEN /
HISTORICAL-SUPERSEDED) and lists what V1 explicitly does **not** ratify. This draft is retained
as historical reasoning; where the two differ, R1 governs.  
**Repository:** `/Users/gcb/Documents/GitHub/ODM-CMMS`  
**Branch:** `atm-002-experience-architecture`  
**Date:** 2026-08-10  
**Author:** Implementation Architect  
**Reviewer:** Chief Architect / Product Architect

---

## Executive Summary

The Atiman Experience Architecture defines how users interact with the platform. It is derived from the product constitution in ATM-000 and the Knowledge Foundation in ATM-001. The experience is **task-first**, **role-aware**, **operator-first**, and **mobile-first**. It is organized around real maintenance work, not around backend modules or legacy CMMS screens.

This document describes the interaction model, information architecture, role-based experiences, knowledge-in-context patterns, contextual AI behavior, design-system principles, and legacy patterns to discard. It is a design document only: no mockups, code, or UI implementations are included.

---

## 1. Purpose

The Experience Architecture exists to:

1. Translate Atiman's product constitution into concrete UX direction.
2. Define how the Finding-centric operating model is surfaced to users.
3. Ensure each role sees the right information and actions for its responsibilities.
4. Keep knowledge visible in context so users act from authoritative guidance.
5. Provide a stable foundation for a future design system and component library.
6. Identify legacy ODM-CMMS UI patterns that must not survive into Atiman.

---

## 2. Constitutional Alignment

| Axiom | Experience Architecture Contribution |
|-------|--------------------------------------|
| **Knowledge Before Transactions** | Knowledge is surfaced to guide findings and escalations; it does not block ad-hoc operator observations. A missing knowledge match becomes a knowledge gap, not a blocked workflow. |
| **Findings Before Work Orders** | The primary create-flow is Finding; work-order preparation is a later, explicit escalation step. |
| **Operators Are the First Sensors** | The operator workflow is the most important and most carefully optimized path. |
| **Integrate Rather Than Replace** | Escalation handoffs to EAM are clearly framed; Atiman does not pretend to be the EAM UI. |
| **AI Augments Human Judgment** | AI appears contextually with traceable recommendations; humans approve consequential actions. |
| **Evidence Before Assumption** | Data-entry flows favor observed evidence, photos, readings, and selections from governed lists. |
| **Experience Follows Work** | Navigation, screens, and actions map to real maintenance tasks, not to modules. |

---

## 3. Core Experience Principles

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | **Task-first, not module-first** | Users start with what they are doing: inspect, report, assess, review. |
| 2 | **Role-aware by default** | Every screen is designed for a primary role and adapts its density and actions. |
| 3 | **Operator-first** | The frontline operator is the most important user. Mobile usability is non-negotiable. |
| 4 | **Knowledge in context** | Procedures, failure context, and safety controls appear inline where they are needed. |
| 5 | **Action-oriented** | Every screen has a clear primary action and obvious next step. |
| 6 | **Progressive disclosure** | Simple defaults for operators; depth available for supervisors and engineers. |
| 7 | **Mobile-first** | Field workflows are designed for mobile; desktop is for authoring, analysis, and configuration. |
| 8 | **Contextual AI** | AI assistance appears where it adds value, with explanation and human approval gates. |
| 9 | **Offline-capable where field work requires it** | Critical field workflows must degrade gracefully without connectivity. |
| 10 | **Accessible** | The experience must be usable by the widest possible maintenance workforce. |

---

## 4. Task-First Navigation

### 4.1 Navigation Model

Atiman does not expose a module-based navigation tree (e.g., Assets, Work Orders, Reports). Instead, navigation is organized around tasks and queues.

Primary navigation categories:

| Category | Example Tasks |
|----------|---------------|
| **Today** | Start assigned inspection, continue open finding, review overdue items. |
| **Inspect** | Select asset, run inspection checklist, capture evidence. |
| **Report** | Create a finding, add evidence, classify condition. |
| **Assess** | Review findings, recommend outcome, prioritize. |
| **Know** | Browse knowledge, view templates, review safety controls. |
| **Escalate** | Prepare handoff to EAM, review package, confirm submission. |

### 4.2 Entry Points

- **Operator:** Lands on "Today" with the next inspection or open finding.
- **Supervisor:** Lands on a queue of findings requiring assessment or approval.
- **Engineer / Knowledge Steward:** Lands on knowledge authoring/review queues.
- **Planner / Reliability Analyst:** Lands on dashboards and prioritization views.

### 4.3 Deep Links

Every task, finding, inspection, and knowledge entity must be addressable by URL so users can be sent directly to the right context from notifications, QR scans, or integrations.

---

## 5. Role-Aware UX

### 5.1 Roles and Primary Experiences

| Role | Primary Context | Key Needs |
|------|-----------------|-----------|
| **Operator** | Mobile, near the asset | Simple, fast, safe, guided. |
| **Supervisor** | Tablet / desktop, in the field office | Visibility, triage, approval, accountability. |
| **Engineer / Knowledge Steward** | Desktop | Precision, version history, governance, authoring. |
| **Planner** | Desktop | Prioritization, scheduling readiness, resource view. |
| **Reliability Analyst** | Desktop | Trends, failure patterns, knowledge improvement signals. |
| **Tenant Admin** | Desktop | Configuration, user access, pack adoption. |

### 5.2 Role-Based Surface Rules

- An operator does not see the full taxonomy browser by default; they see the inspection or finding relevant to the asset.
- A supervisor sees lists with exception highlighting, not raw data tables.
- An engineer sees full knowledge entities with history, dependencies, and governance state.
- A planner sees readiness and prioritization, not detailed procedure editing.

### 5.3 Cross-Role Continuity

- The same Finding or Inspection is viewable by multiple roles, but each role sees a role-appropriate presentation.
- Handoffs between roles are explicit: operator submits finding → supervisor assesses → engineer reviews knowledge impact.

---

## 6. Operator-First / Mobile-First Workflows

### 6.1 Operator Workflow

```
Scan Asset / Select Asset
    → View Current Context (open findings, due inspections)
    → Start Task (inspection or guided maintenance)
    → Execute Step (read knowledge, capture evidence)
    → Report Finding (always allowed, even if knowledge is incomplete)
    → Recommend Outcome (Operator Corrected / Monitor / Escalate)
    → Submit for Assessment (eligible minor findings may be corrected immediately)
    → Done
```

### 6.2 Mobile Design Rules

- Touch targets are large enough for gloves and field conditions.
- Forms are short; free text is minimized in favor of governed selections and photos.
- Critical actions are reachable with one hand where safe.
- Offline drafts save locally and sync when connectivity returns.
- Camera, voice memo, and barcode/QR/NFC are first-class input methods.
- Safety controls are shown before steps that require them.

### 6.3 Evidence Capture

Operators capture:

- Condition observations (selected from governed lists where possible).
- Photos and videos.
- Numeric readings with units.
- Voice notes converted to text where appropriate.
- Pass / Fail / N/A step outcomes.

Evidence is attached to findings, not buried in work-order notes.

### 6.4 Safety-First Presentation

- Safety controls and lockout/tagout reminders appear before hazardous steps.
- A step cannot be marked complete until mandatory safety acknowledgments are recorded.
- Visual warnings are clear but not alarming to the point of desensitization.

---

## 7. Finding-Centric Interaction Model

### 7.1 Finding as Primary Object

The Finding is the natural output of operator work. The UI makes this explicit:

- Operators "report a finding," not "create a work order."
- Findings are visible across roles in a unified finding stream.
- Each finding has a clear lifecycle: Open → Assessed → Resolved / Monitored / Escalated.

### 7.2 Finding Creation Flow

1. **Trigger:** Operator observes condition during inspection, or ad-hoc reporting.
2. **Classify:** Select equipment, component, failure mode, and evidence from governed knowledge where available. A missing match is recorded as a knowledge gap.
3. **Assess:** System suggests a recommended outcome based on knowledge and evidence.
4. **Recommend:** Operator recommends Operator Corrected, Monitor, or Escalate; accountable assessment/approval confirms the outcome.
5. **Act:** Capture resolution, set monitor interval, or prepare EAM escalation package.
6. **Close:** Record closure evidence and outcome.

### 7.3 Finding Outcomes

| Outcome | UI Behavior |
|---------|-------------|
| **Operator Corrected** | Operator records an eligible minor correction; accountable party approves or reviews. |
| **Monitor** | Operator/supervisor recommends monitor; accountable assessment confirms; system creates a reminder. |
| **Escalate** | Operator/supervisor recommends escalation; accountable assessment confirms; UI prepares an escalation package. |

### 7.4 Finding Stream

- A unified, filterable stream shows findings by status, asset, role, and priority.
- Supervisors and engineers can drill into evidence and knowledge context.
- The stream is the supervisor's primary queue, not a work-order inbox.

---

## 8. Supervisor Experience

### 8.1 Primary View

A supervisor sees:

- **Today:** findings requiring assessment, overdue monitors, exceptions.
- **Finding Stream:** all open findings with priority and aging.
- **Knowledge Gaps:** signals that recurring findings suggest missing or incorrect knowledge.

### 8.2 Assessment Actions

- Review evidence (photos, readings, operator notes).
- Confirm or override the recommended outcome.
- Add engineering context.
- Approve escalation to EAM.
- Reject or request more evidence.

### 8.3 Accountability

- Every assessment decision is attributed and timestamped.
- Overrides require a reason.
- The supervisor is the human accountability point for escalation decisions.

---

## 9. Engineer / Knowledge Steward Experience

### 9.1 Primary View

Engineers and stewards see:

- Knowledge review queues.
- Version history and pending drafts.
- Knowledge quality metrics.
- Feedback from operational findings.

### 9.2 Knowledge Authoring

- Edit taxonomy and maintenance knowledge with validation feedback inline.
- Compare versions side by side.
- Submit drafts for review.
- Publish approved knowledge.
- Deprecate or retire outdated knowledge.

### 9.3 Evidence-Driven Improvement

- Engineers can see which findings reference which knowledge entities.
- Recurring or misclassified findings trigger knowledge-improvement suggestions.
- AI may draft knowledge updates, but engineers approve them.

---

## 10. Knowledge-in-Context UX

### 10.1 Knowledge Surfaces Inline

Knowledge must not be hidden in separate screens or document libraries. It appears where users need it:

- During an inspection, the relevant task template and steps are shown.
- When reporting a finding, failure modes and damage codes are filtered by the selected equipment type.
- When assessing a finding, related task master definitions and safety controls are visible.

### 10.2 Knowledge Cards

A reusable **Knowledge Card** pattern shows:

- Title and version.
- Lifecycle state.
- Key attributes (frequency, duration, required skills, safety notes).
- Link to full knowledge detail for users who need it.

### 10.3 Safety in Context

Safety controls are not a separate document. They appear:

- Before hazardous steps.
- In finding summary when risk is elevated.
- In escalation package for EAM handoff.

### 10.4 No Hidden Documents

- PDFs and external attachments are supplementary only.
- The authoritative procedure is structured, executable, and versioned inside Atiman.

---

## 11. Contextual AI Behavior

### 11.1 AI Appears Contextually

AI is not a persistent chat panel. It appears when it can add value:

- Suggesting a failure mode and recommended outcome based on evidence and equipment type.
- Summarizing a finding's evidence for a supervisor.
- Drafting a knowledge update from a cluster of similar findings.
- Predicting monitor urgency based on trend data.
- Recommending prioritization for the escalation queue.

### 11.2 AI Presentation Rules

- Every AI suggestion is labeled as a suggestion.
- The knowledge or evidence basis is surfaced.
- The user can accept, reject, or edit.
- Consequential actions require explicit human approval.

### 11.3 AI Does Not

- Create authoritative findings without human confirmation.
- Publish knowledge directly.
- Override safety controls or governance rules.
- Generate work orders in EAM systems.

---

## 12. Information Architecture

### 12.1 Core Objects

The experience is organized around these primary objects:

| Object | Description |
|--------|-------------|
| **Asset** | The physical asset being maintained (operational data). |
| **Inspection** | A guided evidence-collection activity driven by a task template. |
| **Finding** | The primary operational output of operator and inspection activity. |
| **Assessment** | The review and outcome assignment for a finding. |
| **Escalation Package** | Prepared evidence and recommendations for EAM handoff. |
| **Knowledge Entity** | Authoritative procedure, taxonomy, or template. |

### 12.2 Object Relationships in UI

```
Asset
  → Inspection (uses Task Template)
      → Finding (references Failure Mode / Damage Code / Cause Code)
          → Assessment (uses Knowledge for recommendation)
              → Operator Corrected / Monitor / Escalation Package
```

### 12.3 Avoid Module-Centric Language

Avoid labels such as:

- "Work Orders" as a top-level menu.
- "Asset Register" as the landing experience.
- "Maintenance Plans" as a primary user destination.
- "Reports" as a standalone section.

Prefer:

- "Today," "Inspect," "Report," "Assess," "Know," "Escalate."

---

## 13. Design-System Principles

### 13.1 Foundations

A future Atiman design system should enforce:

- **Typography:** Legible under field conditions; large, high-contrast text for operators.
- **Color:** Semantic and role-aware (safe, warning, critical, informational). Accessible contrast ratios.
- **Spacing:** Generous touch targets; clear grouping.
- **Iconography:** Simple, maintenance-domain-specific icons; avoid generic icon ambiguity.
- **Motion:** Subtle, purposeful; never decorative or performance-heavy.

### 13.2 Component Patterns

| Pattern | Use |
|---------|-----|
| **Task Card** | Shows the next thing a user should do. |
| **Finding Card** | Summary of a finding with status, asset, priority, and evidence preview. |
| **Knowledge Card** | Inline display of authoritative knowledge. |
| **Step Runner** | Guided execution of inspection/maintenance steps. |
| **Evidence Uploader** | Photo/video/reading capture with metadata. |
| **Outcome Selector** | Operator Corrected / Monitor / Escalate decision. |
| **Escalation Package Viewer** | Review what will be sent to EAM. |

### 13.3 Responsive Behavior

- Mobile: single-column, large touch targets, offline-aware.
- Tablet: split views where appropriate (list + detail).
- Desktop: denser tables and side-by-side comparison for engineers and analysts.

---

## 14. Accessibility

### 14.1 Requirements

- Conform to WCAG 2.1 AA as a minimum target.
- Screen-reader support for all task flows.
- Keyboard navigable desktop flows.
- High-contrast mode support.
- Readable font sizes and scalable text.

### 14.2 Field Considerations

- Glove-compatible touch targets.
- Audio input for notes where hands are occupied.
- Clear visual feedback in bright or low-light conditions.

---

## 15. Offline Expectations

### 15.1 Critical Offline Flows

The following must degrade gracefully offline:

- Start and complete an assigned inspection.
- Report a finding with evidence.
- Capture operator-corrected resolution.
- View cached task templates and safety controls for assigned work.

### 15.2 Sync Behavior

- Drafts save locally with timestamps.
- Sync queues upload when connectivity returns.
- Conflicts (e.g., knowledge retired while offline) are surfaced clearly for resolution.
- Read-only knowledge is cached and refreshed on reconnect.

---

## 16. Legacy UI Patterns to Discard

The following ODM-CMMS / legacy patterns must not survive into Atiman:

| Legacy Pattern | Why It Is Discarded | Replacement |
|----------------|---------------------|-------------|
| Module-first navigation (Assets, Work Orders, Reports) | Forces users to learn backend structure. | Task-first navigation. |
| Work order as the primary object | Violates Findings Before Work Orders. | Finding as the primary object. |
| Desktop-first, spreadsheet-like tables for operators | Not usable in the field. | Mobile-first cards and step runners. |
| Static PDF attachments as procedures | Not executable, versioned, or in context. | Structured knowledge cards and step runners. |
| Generic ticket forms | Lose maintenance domain semantics. | Finding-specific, knowledge-driven forms. |
| Persistent AI chat bolted onto screens | Distracts from task flow. | Contextual AI suggestions. |
| Calendar / Gantt as primary planning UI | Atiman does not own enterprise planning. | Prioritization and escalation-readiness views. |
| Asset register as landing page | Puts data before action. | "Today" task list. |
| Free-text-heavy data entry | Slows operators and reduces data quality. | Governed selections, photos, and readings. |

---

## 17. Open Questions

1. What is the exact role model at launch (operator, supervisor, engineer, admin)?
2. Which mobile platform(s) are primary targets (PWA, iOS native, Android native)?
3. What is the offline sync architecture (service worker, native app, hybrid)?
4. What accessibility certification or standards are required by target customers?
5. What are the branding and visual identity constraints for the design system?
6. How is contextual AI presented visually without cluttering operator workflows?
7. What notification channels are used for supervisors (push, email, in-app)?
8. What is the exact escalation-package review screen before EAM handoff?

---

## 18. Decision Record

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Task-first navigation | Aligns with Experience Follows Work axiom. |
| 2 | Finding as primary operational object | Aligns with Findings Before Work Orders axiom. |
| 3 | Operator-first, mobile-first | Operators are the first sensors and work at the asset. |
| 4 | Knowledge surfaces inline | Keeps authoritative guidance in context. |
| 5 | Contextual AI, not persistent chat | AI assists without disrupting task flow. |
| 6 | Escalation package instead of internal work-order execution | Honors Integrate Rather Than Replace axiom. |
| 7 | Progressive disclosure | Simple for operators, deep for engineers. |
| 8 | Offline support for critical field flows | Maintenance work does not stop when connectivity drops. |
| 9 | Discard module-first and work-order-centric patterns | These are legacy CMMS patterns incompatible with Atiman's constitution. |
| 10 | WCAG 2.1 AA minimum | Maintenance workforce diversity requires accessible design. |

---

## STOP

This is a design document only.  
No mockups, code, UI implementations, schema changes, or deployment actions have been performed.  
Awaiting ChatGPT architectural review.
