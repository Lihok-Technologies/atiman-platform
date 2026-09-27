# ATM-005 — Legacy UX Inventory

**Document ID:** ATM-005  
**Title:** Legacy ODM-CMMS User Experience Inventory  
**Status:** Controlled Architecture Document — Draft for Review *(historical evidence)*.  
**Reconciliation (ATM-002-R1, 2026-09-27).** This inventory's per-screen verdicts, §4 discard list
and §6 implementation ordering remain useful historical evidence. One premise is now **stale**
and must not be relied on as current fact: the claim that the product has *module-first bottom
navigation*. Measured at the R1 baseline, the primary navigation has already evolved toward
task-first — `Today · Inspect · Report · Know · Assess · Escalate`, role-gated — while the
underlying route and view surface remains substantially legacy/module-oriented (work orders,
calendar, maintenance plans, reports, coverage, 18 admin surfaces, archived duplicates). The
historical observation is retained above rather than rewritten.  
**Repository:** `/Users/gcb/Documents/GitHub/ODM-CMMS`  
**Branch:** `atm-005-ux-inventory`  
**Date:** 2026-08-10  
**Author:** Implementation Architect  
**Reviewer:** Chief Architect / Product Architect

---

## Executive Summary

This document inventories the existing ODM-CMMS user experience and classifies every major screen and workflow for transition to Atiman. It applies the principles defined in ATM-000, ATM-001, ATM-002, and ATM-003.

The existing UI is a module-first, work-order-centric CMMS built primarily for mobile but with desktop admin views. Atiman requires a task-first, finding-centric, role-aware experience. Most legacy screens must be refactored or replaced; a small number can be retained as transitional scaffolding.

No application code was modified.

---

## 1. Evaluation Criteria

Every screen/workflow is evaluated against:

| Principle | Test |
|-----------|------|
| **Task-first** | Does the screen start with a real user task? |
| **Role-aware** | Is the screen appropriate for a specific Atiman role? |
| **Operator-first / mobile-first** | Can the primary user complete the task on a mobile device in the field? |
| **Finding-centric** | Is the primary output a Finding rather than a Work Order? |
| **Knowledge Before Transactions** | Governed knowledge should guide operational work where available, but lack of matching knowledge must never block evidence capture or ad-hoc Finding creation. |
| **Knowledge-in-context** | Is authoritative knowledge visible inline? |
| **Contextual AI** | Could AI add value here without disrupting the task? |
| **EAM boundary** | Does the screen avoid EAM planning, scheduling, inventory, or financial execution? |

---

## 2. Screen/Workflow Inventory

### 2.1 Authentication

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `views/login.ejs` | All users | CMMS login | **REFACTOR** | Retain login function; rebrand and simplify; keep mobile login `views/mobile/login.ejs` for field use. |
| `views/signup.ejs` | New users | Organization-centric CMMS signup | **REFACTOR** | Retain signup flow; align branding and terminology with Atiman. |
| `views/mobile/login.ejs` | Field users | Same as above | **REFACTOR** | Simplify for operator-first entry. |

### 2.2 Landing / Home

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `views/index.ejs` | Visitor / new user | Marketing landing | **REPLACE** | Convert to Atiman product landing; remove CMMS module marketing. |
| `views/mobile/home.ejs` | Authenticated user | Module-first dashboard | **REPLACE** | Replace with "Today" task-first view per ATM-002. |

### 2.3 Operator Field Workflows

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/mobile/inspection/:workOrderId` | Operator | Inspection is subordinate to a work order | **REPLACE** | Inspections should be task-first and Finding-centric, not tied to a work order. Reusable step-runner pattern can be retained. |
| `/mobile/inspection/adhoc` | Operator | Ad-hoc inspection | **REFACTOR** | Convert to ad-hoc evidence capture / Finding creation. |
| `/mobile/work-orders` | Operator | Work orders are primary queue | **REPLACE** | Replace with "Today" and Finding stream. |
| `/mobile/work-orders/:id` | Operator | Work-order detail | **REPLACE** | Replace with Finding detail and escalation readiness. |
| `/mobile/work-orders/:id/complete` | Operator | Work-order completion | **REMOVE** | Atiman does not execute enterprise work orders. |
| `/mobile/asset` | Operator | Asset lookup | **REFACTOR** | Keep asset-context view but center on "what to do here" not asset registry. |
| `/mobile/equipment` | Operator | Equipment list | **REPLACE** | Replace with task- or scan-driven asset selection. |
| `/mobile/asset/:assetId/history` | Operator | Asset history | **REFACTOR** | Retain as operational evidence timeline, but Finding-centric. |

### 2.4 Finding and Evidence Workflows

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/mobile/dashboard/findings` | Supervisor | Finding list | **RETAIN / REFACTOR** | Keep the Finding stream concept; refactor for supervisor assessment queue. |
| `src/routes/finding.routes.js` API | All | Finding CRUD | **REFACTOR** | Align finding lifecycle with Operator Corrected / Monitor / Escalate outcomes. |

### 2.5 Dashboards and Reporting

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/mobile/dashboard` | Admin/Supervisor | Module-first dashboard | **REPLACE** | Replace with role-aware "Today" and exception queues. |
| `/mobile/dashboard/work-orders` | Admin/Supervisor | Work-order dashboard | **REMOVE** | Violates Finding Before Work Orders. |
| `/mobile/reports` | Analyst | CMMS reports | **REPLACE** | Replace with reliability / knowledge-quality / operational evidence analytics. |
| `/mobile/reports/work-order-summary` | Analyst | Work-order report | **REMOVE** | Out of Atiman scope. |
| `/mobile/reports/equipment-report` | Analyst | Asset registry report | **REFACTOR** | Convert to asset condition / evidence summary. |
| `/mobile/reports/technician-report` | Analyst | Technician productivity | **REMOVE** | Workforce productivity belongs to EAM/HR systems. |
| `/mobile/reports/schedule-compliance` | Planner | Schedule compliance | **REMOVE** | Scheduling is EAM-owned. |
| `/mobile/reports/trends` | Analyst | Trends | **REFACTOR** | Convert to finding/failure trend analysis for knowledge improvement. |
| `/mobile/calendar` | Planner | Maintenance calendar | **REMOVE** | Calendar scheduling is EAM-owned. |

### 2.6 Maintenance Plans

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/mobile/maintenance-plans` | Admin | Maintenance plan list | **REMOVE** | Maintenance plan execution is EAM-owned. |
| `/mobile/maintenance-plans/new` | Admin | Create plan | **REMOVE** | Same as above. |
| `/mobile/maintenance-plans/:id/edit` | Admin | Edit plan | **REMOVE** | Same as above. |

### 2.7 Knowledge / Templates

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/mobile/templates` | Engineer/Admin | Template list | **REFACTOR** | Retain as knowledge-browser with lifecycle state and version. |
| `/mobile/templates/new` | Engineer | Create template | **REFACTOR** | Align with Knowledge Foundation lifecycle and governance. |
| `/mobile/templates/:id/edit` | Engineer | Edit template | **REFACTOR** | Align with versioning and review workflow. |
| `/mobile/template-editor.ejs` | Engineer | Template editor | **RETAIN / REFACTOR** | Step-editor and safety-control editor are reusable; align with Atiman knowledge model. |
| `/mobile/template-list.ejs` | Engineer | Template list | **REFACTOR** | Add knowledge-pack grouping and governance state. |

### 2.8 Asset / Equipment Management

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/mobile/admin/assets` | Admin | Asset registry management | **REPLACE** | Operational data; simplify to asset-context configuration, not registry editing. |
| `/mobile/admin/facilities` | Admin | Facility management | **REMOVE / REFACTOR** | Facilities are operational; keep only minimal configuration if needed. |
| `/mobile/equipment-list.ejs` | Operator | Equipment list | **REPLACE** | Replace with scan/task-driven asset selection. |
| `/mobile/asset-context.ejs` | Operator | Asset context | **REFACTOR** | Keep but center on task context and open findings. |
| `/mobile/asset-history.ejs` | Operator | Asset history | **REFACTOR** | Keep as Finding/evidence timeline. |

### 2.9 QR / Label Workflows

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/assets/:id/qr-label` | Admin | QR label for asset | **RETAIN / REFACTOR** | QR tagging is valuable; align with operational asset context. |
| `/qr-labels` | Admin | QR label list | **REFACTOR** | Keep but simplified. |
| `/qr-labels/batch` | Admin | Batch QR labels | **REFACTOR** | Keep for setup workflows. |
| `/mobile/qr-label-view.ejs` | Operator | View QR label | **REMOVE** | Redundant with scan flow. |
| `/mobile/qr-error.ejs` | Operator | QR error | **RETAIN** | Simple error screen; rebrand only. |

### 2.10 Admin / Configuration

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/mobile/admin` | Admin | Admin dashboard | **REFACTOR** | Retain as configuration hub but reorganize by role. |
| `/mobile/admin/users` | Tenant Admin | User management | **RETAIN / REFACTOR** | Core platform capability. |
| `/mobile/admin/invitations` | Tenant Admin | Invitation management | **RETAIN / REFACTOR** | Core platform capability. |
| `/mobile/admin/organization` | Tenant Admin | Organization settings | **RETAIN / REFACTOR** | Core platform capability. |
| `/mobile/admin/subscription` | Tenant Admin | Billing/subscription | **RETAIN / REFACTOR** | SaaS operational capability; not Atiman product capability. |
| `/mobile/admin/api-keys` | Tenant Admin | API key management | **RETAIN / REFACTOR** | Core platform capability. |
| `/mobile/admin/sso` | Tenant Admin | SSO configuration | **RETAIN / REFACTOR** | Core platform capability. |
| `/mobile/admin/custom-fields` | Admin | Custom field definitions | **REMOVE / REFACTOR** | Evaluate against Knowledge Foundation; custom fields are anti-pattern if they duplicate taxonomy. |
| `/mobile/admin/audit-logs` | Admin | Audit log viewer | **RETAIN / REFACTOR** | Core platform capability; align with Platform Foundation. |
| `/mobile/admin/templates` | Engineer/Admin | Template admin | **REFACTOR** | Merge into knowledge authoring experience. |
| `/mobile/admin/coverage*` | Engineer | Coverage analysis | **REFACTOR** | Valuable for knowledge quality; convert to knowledge-pack coverage / gap analysis. |

### 2.11 Onboarding

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/mobile/onboarding` | New tenant | ODM-CMMS setup wizard | **REPLACE** | Rebuild as Atiman bootstrap wizard (organization, admin, knowledge pack adoption). |

### 2.12 Profile and Support

| Screen | Current Role | Legacy Assumption | Verdict | Rationale |
|--------|--------------|-------------------|---------|-----------|
| `/mobile/profile` | All | User profile | **RETAIN / REFACTOR** | Keep profile, settings, support links; align branding. |

### 2.13 Shared Partials

| Partial | Verdict | Rationale |
|---------|---------|-----------|
| `views/partials/header.ejs` | **REFACTOR** | Brand title already updated; navigation must become task-first. |
| `views/partials/footer.ejs` | **RETAIN / REFACTOR** | Keep simple footer; align branding. |
| `views/partials/mobile-header.ejs` | **REFACTOR** | Convert to task-first mobile header. |
| `views/partials/mobile-bottom-nav.ejs` | **REPLACE** | Replace module-first nav (Dashboard, Work Orders, Reports, etc.) with task-first nav (Today, Inspect, Report, Know). |

---

## 3. Highest-Value Reusable UI Components

The following legacy components contain valuable interaction patterns that can be refactored for Atiman:

| Component | Source File | Reuse Potential |
|-----------|-------------|-----------------|
| Step runner / inspection checklist | `views/mobile/inspection.ejs` | Core operator workflow; detach from work order. |
| Template editor | `views/mobile/template-editor.ejs` | Knowledge authoring; add versioning and governance. |
| Evidence capture (photos, readings) | `views/mobile/inspection.ejs` | Finding evidence capture. |
| QR scanner integration | `public/js/app.js`, mobile routes | Asset/task entry point. |
| Knowledge / template list | `views/mobile/templates.ejs` | Knowledge browser. |
| User/organization admin screens | `views/mobile/admin/*` | Platform configuration. |
| Audit log viewer | `views/mobile/admin/audit-logs.ejs` | Platform audit. |
| Finding list | `views/mobile/dashboard/findings.ejs` | Supervisor queue. |

---

## 4. Legacy CMMS Assumptions to Discard

| Assumption | Why It Must Go |
|------------|----------------|
| Work order is the primary operational object | Violates Findings Before Work Orders. |
| Calendar / schedule / PM planning is owned by the app | Violates EAM boundary. |
| Technician productivity reporting | Workforce metrics belong to EAM/HR. |
| Asset registry as the landing experience | Puts data before action. |
| Module-first bottom navigation | Forces users to learn backend structure. |
| Inspections are only triggered by work orders | Operators can inspect and report ad-hoc findings. |
| Custom fields as primary extensibility | Taxonomy and knowledge packs should replace ad-hoc custom fields. |
| Maintenance plans as in-app execution | Planning is EAM-owned. |
| Inventory / parts / procurement flows | Entirely outside Atiman scope. |

---

## 5. Duplication and Dead Screens

### 5.1 Duplication

- Dashboard index and home view largely duplicate each other.
- Work-order list appears in mobile app and dashboard.
- Template list appears in both operator-facing and admin-facing screens.
- Asset context and equipment list overlap.

### 5.2 Likely Dead / Obsolete Screens

| Screen | Reason |
|--------|--------|
| `/mobile/report-placeholder.ejs` | Placeholder only. |
| `/mobile/qr-label-view.ejs` | Redundant with QR scan flow. |
| `/mobile/dashboard/work-orders` | Out of scope. |
| `/mobile/reports/technician-report` | Out of scope. |
| `/mobile/reports/work-order-summary` | Out of scope. |

---

## 6. Recommended Implementation Sequence

The UI should be reinvented in the following order, aligned with the roadmap in ATM-000:

| Phase | Deliverable | Reuse From Legacy |
|-------|-------------|-------------------|
| **1. Platform Shell** | Login, signup, organization/user admin, header, task-first nav | Reuse auth routes and admin screens; replace navigation. |
| **2. Today View** | Operator landing with next task, open finding, due inspection | Reuse home/dashboard skeleton; replace content. |
| **3. Asset Scan / Context** | QR scan → asset context → available actions | Reuse QR integration and asset-context views. |
| **4. Inspection / Step Runner** | Execute inspection checklist, capture evidence | Reuse `views/mobile/inspection.ejs` step-runner pattern. |
| **5. Finding Flow** | Create finding, classify, recommend outcome, capture closure | Build new Finding-centric flow. |
| **6. Supervisor Assessment** | Finding stream, assessment queue, approve Monitor/Escalate | Reuse finding list; build new assessment UI. |
| **7. Knowledge Browser** | Read-only knowledge cards and template list | Reuse template list and knowledge card concept. |
| **8. Knowledge Authoring** | Draft/review/publish templates, steps, safety controls | Reuse template editor; add lifecycle and governance. |
| **9. Escalation Readiness** | Prepare and review EAM escalation package | New screen; consumes Finding and Asset Intelligence. |
| **10. Reliability / Knowledge Quality Dashboards** | Trends, coverage gaps, knowledge improvement signals | Reuse coverage analysis and trend screens. |
| **11. Mobile Polish & Offline** | Offline step execution, sync, field resilience | Add to step runner and finding capture. |

---

## 7. Open Questions

1. Which existing EJS partials and CSS classes can be salvaged for the Atiman design system?
2. What is the mobile navigation structure at launch (Today, Inspect, Report, Assess, Know, Escalate)?
3. Should the existing mobile-first CSS be refactored incrementally or replaced?
4. Which legacy admin screens can be collapsed into a single configuration hub?
5. How much of the existing client-side JavaScript (form handling, QR, modals) is reusable?
6. What is the plan for the existing report screens that are out of scope but may still be referenced?
7. Should the onboarding wizard be part of ATM-006 or a separate milestone?

---

## 8. Decision Record

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Replace module-first navigation with task-first navigation. | Aligns with ATM-002 Experience Architecture. |
| 2 | Replace work-order queue with Finding stream + Today view. | Aligns with Finding Before Work Orders axiom. |
| 3 | Remove calendar, maintenance-plan execution, and technician productivity screens. | Respects EAM boundary. |
| 4 | Retain and refactor inspection step runner. | Core operator workflow; valuable interaction pattern. |
| 5 | Retain and refactor template editor / knowledge browser. | Becomes Knowledge Foundation authoring UI. |
| 6 | Remove or refactor custom-field admin. | Prefer governed taxonomy and knowledge packs. |
| 7 | Retain QR label generation and scan flows. | Critical field usability enabler. |
| 8 | Replace onboarding wizard for Atiman bootstrap. | Existing wizard assumes ODM-CMMS setup. |
| 9 | Replace generic reports with reliability/knowledge-quality analytics. | Aligns with Asset Intelligence and Knowledge Foundation. |

---

## STOP

This is a design/inventory document only.  
No application code, UI, schema, or deployment changes were made.  
Awaiting ChatGPT architectural review.
