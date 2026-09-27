# ATM-000 — Atiman Product Vision & Architecture

**Document ID:** ATM-000  
**Title:** Atiman Product Vision & Architecture  
**Status:** **RATIFIED — Atiman Product Constitution.** The document's substance is the highest
product authority (see *Authority* below).  
**Repository:** `/Users/gcb/Documents/GitHub/ODM-CMMS` *(historical drafting location — this document
was drafted before the repository moved; the metadata block below is historical, not a statement of
current location)*  
**Branch:** `atm-000-product-architecture` *(historical)*  
**Date:** 2026-08-10 *(drafting date; see Authority for ratification)*  
**Author:** Implementation Architect  
**Reviewer:** Chief Architect / Product Architect

## Authority

The authoritative **ATIMAN_PROJECT_SOURCE** establishes the following chain, which this document
records rather than creates:

1. The **Atiman Product Constitution** is the highest product authority. This document **is** that
   constitution.
2. **Project Sources are authoritative.** Conversations are exploratory and do not, by themselves,
   change this document.
3. **Approved architecture outranks implementation.** Where implementation diverges from an approved
   architecture record, the record governs and the implementation is the defect.
4. The constitutional axioms (§5), core product principles (§6), experience philosophy (§16), AI
   philosophy (§17), product boundaries (§13) and the permanent architecture (§14) are binding on
   every downstream milestone.

**Status-history correction (2026-09-27).** The header previously read *"Controlled Architecture
Document — Draft for Review"*, and this document ended with *"Awaiting ChatGPT architectural
review."* Both statements were **stale relative to the higher Project Source authority**, not
statements that the constitution's substance was unapproved. The constitution has governed
downstream work throughout — ATM-001 Knowledge Foundation V1 was ratified, implemented, deployed and
production-accepted against it, and its axioms (Knowledge Before Transactions; Findings Before Work
Orders; Operators Are the First Sensors; Integrate Rather Than Replace; AI Augments Human Judgment;
Evidence Before Assumption; Experience Follows Work) are cited as binding by OWNER missions. The
former wording is retained in this note as history rather than silently deleted; **no constitutional
substance is changed by this correction.**

---

## Executive Summary

Atiman is an **Asset Operations and Intelligence Platform** for physical asset maintenance.

It is the successor concept to ODM-CMMS, but it is not an incremental redesign of a traditional CMMS or EAM. Atiman starts from a different premise: **knowledge precedes transactions**. Engineering taxonomy, maintenance procedures, failure understanding, and operational evidence together enable better decisions by the people closest to the asset.

Atiman permanently separates two things:

- **Maintenance and engineering knowledge** — the enduring product asset. It is curated, versioned, reusable, and governed.
- **Operational evidence** — the per-customer, per-asset, per-moment observations, findings, and outcomes that feed assessment, learning, and integration with enterprise systems.

This architecture document defines what Atiman is, what it is not, and the layered foundation that every future feature, screen, API, database change, AI capability, and customer workflow must respect.

---

## 1. What Atiman IS

Atiman is:

1. **An Asset Operations and Intelligence Platform.** It connects frontline operations, engineering knowledge, and enterprise systems around the asset.
2. **A knowledge-first platform.** Engineering taxonomy, maintenance procedures, failure modes, and best practices are first-class, governed citizens.
3. **A multi-tenant SaaS platform.** Each customer organization operates in its own bounded workspace while benefiting from shared knowledge.
4. **A system of operational applications and intelligence built on a common knowledge foundation.** Inspections, operator-driven maintenance, finding assessment, and prioritization consume knowledge; they do not own it.
5. **An AI-assisted platform.** Artificial intelligence is used contextually to help users make decisions, never to become the source of truth.
6. **A mobile-first, role-aware, task-first experience.** The interface is organized around what a person must do and the role they perform.
7. **An extensible platform.** New knowledge domains, operational apps, integrations, and intelligence capabilities can be added without rewriting the core.

---

## 2. What Atiman is NOT

Atiman is explicitly NOT:

1. **A replacement for enterprise EAM.** SAP PM, IBM Maximo, Infor EAM, and Oracle EAM remain the systems of record for enterprise maintenance planning, technician work-order execution, resource scheduling, inventory, procurement, contracts, cost accounting, and financial management.
2. **A traditional CMMS clone.** Atiman does not start from work orders and asset registers; it starts from knowledge and findings.
3. **A generic project management or ticket system.** Maintenance domain semantics are intrinsic, not bolted on.
4. **An AI replacement for human judgment.** AI assists; humans remain accountable.
5. **A static document library.** Knowledge is structured, validated, versioned, and executable inside operational workflows.
6. **A one-size-fits-all UI.** The experience adapts to the role: operator, supervisor, engineer, planner, reliability analyst.
7. **A marketing concept.** This document controls implementation; it is not aspirational prose.

---

## 3. Mission

**Enable operators to become the first line of defense against asset failures by systematically collecting asset condition information and converting that information into actionable engineering intelligence.**

*Supporting knowledge objective:* Atiman captures, validates, and makes reusable the maintenance knowledge that would otherwise live only in senior engineers' heads, scattered spreadsheets, or legacy systems. This knowledge supports the primary mission by ensuring that operator-collected condition information is interpreted against authoritative, continuously improving engineering knowledge.

---

## 4. Vision

**Become the industry's default Asset Operations and Intelligence Platform for physical asset maintenance.**

In the long term, Atiman is the platform where:

- Maintenance knowledge is curated, shared, and continuously improved.
- Operators are the first sensors, and their findings drive assessment and action.
- Asset intelligence is evidence-based, explainable, and integrated with enterprise EAM systems.
- AI is a trusted assistant that never overrides human accountability.
- Customers can start simple and grow into enterprise asset operations without replacing platforms.

---

## 5. Constitutional Axioms

These seven axioms are the governing constitution of Atiman. All other principles, features, and architectural decisions are subordinate to them.

| # | Axiom | Meaning |
|---|-------|---------|
| 1 | **Knowledge Before Transactions** | Maintenance and engineering knowledge is established before operational transactions are created. |
| 2 | **Findings Before Work Orders** | The primary operational object is the Finding, not the work order. Findings drive assessment and action. |
| 3 | **Operators Are the First Sensors** | Frontline operators detect and report conditions. Their evidence is the earliest input to the intelligence layer. |
| 4 | **Integrate Rather Than Replace** | Atiman connects with enterprise EAM and other systems; it does not attempt to replace them. |
| 5 | **AI Augments Human Judgment** | AI recommends, analyzes, and explains; accountable humans decide. |
| 6 | **Evidence Before Assumption** | Decisions are based on observed evidence, governed knowledge, and validated data. |
| 7 | **Experience Follows Work** | The user experience is organized around real tasks, real roles, and real moments of work. |

---

## 6. Core Product Principles

These principles amplify the axioms and guide daily design decisions.

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | **Knowledge first** | The knowledge foundation is built before operational features consume it. |
| 2 | **Separation of knowledge and operational evidence** | Knowledge is shared and versioned; operational evidence is per-customer and feeds learning, audit, and integration. |
| 3 | **Role-aware by default** | Every screen and workflow is designed for a specific maintenance role. |
| 4 | **Task-first UX** | Users arrive at actions, not modules. |
| 5 | **Finding-centric operations** | Findings are the natural operational output; formal work orders are escalations to enterprise boundaries. |
| 6 | **Trust through validation** | Knowledge is validated against rules, real outcomes, and human review. |
| 7 | **Progressive disclosure** | Simple for operators, deep for engineers and analysts. |
| 8 | **Extensible by design** | New domains, apps, and integrations plug into the architecture without forks. |
| 9 | **Human accountability** | AI may recommend; humans approve, execute, and own the outcome. |

---

## 7. Architectural Principles

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | **Layered architecture** | Each layer has a single responsibility and depends only on layers below it. |
| 2 | **Knowledge services are APIs** | Operational apps and intelligence consume knowledge through well-defined services, not direct database coupling. |
| 3 | **Database schema reflects knowledge boundaries** | Schema changes are driven by knowledge-domain evolution, not by UI convenience. |
| 4 | **Tenant isolation** | Customer data is isolated; shared knowledge is referenceable but immutable to tenants. |
| 5 | **Event-ready** | State changes publish events so future analytics, integrations, and AI can react. |
| 6 | **Idempotent deployments** | Schema and knowledge deployments are rerunnable and safe. |
| 7 | **Security by default** | Authentication, authorization, audit, and data isolation are non-negotiable. |

---

## 8. Knowledge-First Philosophy

Atiman treats maintenance knowledge as a durable, reusable asset:

- **Engineering Taxonomy** defines what can fail, what can be done, and how things relate.
- **Maintenance Knowledge** defines the actual procedures, checks, and safe practices.
- **Knowledge Packs** are curated, versioned bundles of taxonomy and maintenance knowledge for an asset class or industry.
- **Customer Knowledge** is the subset a tenant adopts, customizes, or creates.

Knowledge is:

- **Authored** by domain experts.
- **Validated** against rules and real-world feedback.
- **Versioned** so changes are traceable.
- **Governed** so quality is maintained.
- **Executable** inside operational workflows.

Knowledge is never buried in operational records. Operational records may reference knowledge, but they do not define it.

---

## 9. Operational Philosophy

Operational applications exist to apply knowledge to real assets at real moments. The primary flow is:

```
Inspection → Finding → Assessment → Action → Closure
```

A **Finding** is the primary operational object. A finding may lead to:

- **Operator Corrected** — resolved by the operator at the point of observation.
- **Monitor** — observed condition is tracked over time.
- **Escalate** — condition is escalated to the enterprise EAM boundary for formal planning and execution.

Operational applications include:

- **Inspections** — execute checklists, capture evidence, and create findings.
- **Operator Driven Maintenance** — empower frontline operators with guided actions and operator-correctable outcomes.
- **Assessment** — evaluate findings against knowledge to determine severity and recommended action.
- **Prioritization** — rank findings and recommended actions for escalation.
- **Work Preparation** — package evidence, recommendations, and prioritization for exchange with enterprise systems.

Operational evidence belongs to the customer. It is created, modified, and archived per tenant. It feeds asset intelligence, audit, and lifecycle learning. Operational evidence is not disposable; it is the basis of explainable decisions.

---

## 10. Finding-Centric Operating Model

Atiman is finding-centric, not work-order-centric.

- Operators create findings.
- Findings are assessed against knowledge and evidence.
- Assessment produces a recommended outcome: Operator Corrected, Monitor, or Escalate.
- Escalated findings are handed to enterprise EAM systems for formal work-order planning and execution.
- Atiman monitors resulting outcomes where data is exchanged back.

This model honors the axiom **Findings Before Work Orders** and the boundary **Integrate Rather Than Replace**.

---

## 11. Enterprise EAM Boundary

Atiman does not own the enterprise EAM responsibilities listed below. These remain the domain of systems such as SAP PM, IBM Maximo, Infor EAM, and Oracle EAM:

- Enterprise maintenance planning
- PM calendars
- Technician and vendor work-order execution
- Resource scheduling
- Inventory management
- Procurement
- Contracts
- Cost accounting
- Financial management

Atiman may:

- Collect evidence through inspections and operator activities.
- Assess findings against governed knowledge.
- Recommend and prioritize actions.
- Prepare escalations for enterprise systems.
- Exchange data with enterprise systems.
- Monitor resulting outcomes and feedback.

The **Enterprise Integration** layer is responsible for this boundary.

---

## 12. AI Philosophy

AI in Atiman is a capability, not a module.

- **AI assists users.** It suggests, summarizes, predicts, and answers questions.
- **AI never becomes the source of truth.** Knowledge remains authoritative.
- **AI recommendations are traceable.** A user can see why a recommendation was made.
- **AI learns from outcomes.** Closed findings, inspection results, and reliability data refine future suggestions.
- **Human approval is required for consequential actions.** AI may draft an escalation; a human approves it.
- **AI operates from governed knowledge and evidence.** It does not hallucinate procedures or findings into existence.

---

## 13. Product Boundaries

### In Scope

- Knowledge foundation and knowledge services.
- Operational applications for inspection, operator-driven maintenance, finding assessment, and prioritization.
- Asset intelligence: health, condition, risk, reliability, prioritization, and recommended actions.
- Enterprise integration with EAM and related systems.
- Role-aware, task-first user experiences.
- AI assistance within operational and knowledge workflows.
- Multi-tenant platform services (auth, organizations, users, audit).
- APIs and future integration points.

### Out of Scope (for Atiman core)

- Enterprise EAM planning and execution.
- Inventory management, procurement, contracts, cost accounting, or financial management.
- General-purpose ERP.
- Generic project management unrelated to maintenance.
- Asset design / digital twin simulation (may integrate in future).
- Unstructured document storage as a primary feature.
- Social networking or community features outside knowledge marketplace governance.

---

## 14. Permanent Architecture

Atiman is organized into six permanent layers. Each layer depends only on the layers below it.

```
┌─────────────────────────────────────┐
│     Enterprise Integration           │  EAM exchange, outbound escalation, inbound outcomes
├─────────────────────────────────────┤
│        Asset Intelligence            │  Health, condition, risk, reliability, prioritization, recommendations
├─────────────────────────────────────┤
│    Operational Applications          │  Inspections, ODM, finding assessment, prioritization
├─────────────────────────────────────┤
│      Knowledge Services              │  Query, composition, validation, lifecycle
├─────────────────────────────────────┤
│      Knowledge Foundation            │  Taxonomy, procedures, knowledge packs, versioning
├─────────────────────────────────────┤
│      Platform Foundation             │  Tenancy, identity, audit, events, APIs
└─────────────────────────────────────┘
```

### 14.1 Platform Foundation

**Responsibilities:**

- Multi-tenant organizations and workspaces.
- Identity, authentication, and role-based authorization.
- Audit logging and compliance.
- Event bus for cross-layer communication.
- Core APIs and API governance.
- Database infrastructure and idempotent schema deployment.

**Boundaries:**

- The platform foundation does not contain maintenance domain logic.
- It provides the runtime and governance that everything else uses.

**Dependencies:** None (base layer).

### 14.2 Knowledge Foundation

**Responsibilities:**

- Store and version engineering taxonomy:
  - Equipment categories, classes, types.
  - Failure modes, damage codes, cause codes.
  - Activity codes, object parts, maintainable items.
- Store and version maintenance knowledge:
  - Task master definitions.
  - Task templates and steps.
  - Safety controls and precautions.
- Organize knowledge into packs:
  - Template families and rules.
  - Standard maintenance procedure (SMP) families and tasks.
- Govern knowledge lifecycle:
  - Draft → Review → Published → Deprecated → Retired.
- Validate knowledge integrity:
  - FK correctness, uniqueness, rule conformance.

**Boundaries:**

- Knowledge foundation does not store customer assets, work orders, or inspection results.
- It may store customer-specific customizations to knowledge (Customer Knowledge), but those remain knowledge, not operations.

**Dependencies:** Platform Foundation.

### 14.3 Knowledge Services

**Responsibilities:**

- Provide query and composition APIs for operational apps and asset intelligence.
- Resolve the right knowledge for an asset, role, and context.
- Validate knowledge before it is used operationally.
- Manage knowledge pack import, export, and versioning.
- Enforce knowledge governance rules.

**Boundaries:**

- Services expose knowledge; they do not mutate operational data.
- They may read customer context to select the right knowledge variant.

**Dependencies:** Knowledge Foundation, Platform Foundation.

### 14.4 Operational Applications

**Responsibilities:**

- Deliver task-first, role-aware experiences.
- Consume knowledge services to populate workflows.
- Capture operational evidence: inspections, findings, readings, operator corrections, monitor decisions, escalation requests.
- Enforce operational business rules for finding assessment and closure.

**Examples:**

- Inspections
- Operator Driven Maintenance (ODM)
- Finding Assessment
- Prioritization and Escalation Preparation
- Mobile Field Experience
- QR / NFC Asset Tagging

**Boundaries:**

- Operational apps do not bypass knowledge services to read knowledge tables directly.
- Operational apps do not store shared knowledge definitions.
- Operational apps do not perform enterprise EAM planning, scheduling, inventory, or financial execution.

**Dependencies:** Knowledge Services, Platform Foundation.

### 14.5 Asset Intelligence

**Responsibilities:**

- Produce evidence-based, explainable intelligence from operational evidence and knowledge.
- Compute and expose:
  - Asset Health
  - Asset Condition
  - Risk
  - Reliability
  - Prioritization
  - Recommended Actions
- Support human decision-making without replacing it.
- Feed enterprise integration with prioritized, well-documented recommendations.

**Boundaries:**

- Asset Intelligence reads operational evidence and knowledge; it does not own them.
- It does not create authoritative findings or work orders without accountable human action.

**Dependencies:** Operational Applications, Knowledge Services, Platform Foundation.

### 14.6 Enterprise Integration

**Responsibilities:**

- Exchange data with enterprise EAM and related systems.
- Send escalated findings, recommendations, and evidence outbound.
- Receive outcomes, schedules, and completion data inbound.
- Translate between Atiman semantics and enterprise system semantics.
- Maintain integration event logs and retry handling.

**Examples:**

- SAP PM integration
- IBM Maximo integration
- Infor EAM integration
- Oracle EAM integration
- Future ERP / CMMS connectors

**Boundaries:**

- Enterprise Integration does not store authoritative enterprise EAM data.
- It is a bidirectional boundary layer, not a replacement for enterprise systems.

**Dependencies:** Asset Intelligence, Operational Applications, Platform Foundation. It may consume Knowledge Services for semantic context.

---

## 15. Knowledge Foundation Detail

### 15.1 Engineering Taxonomy

The classification system that gives maintenance knowledge structure:

- `equipment_categories`
- `equipment_classes`
- `equipment_types`
- `industries`
- `failure_modes`
- `damage_codes`
- `cause_codes`
- `object_parts`
- `subunits`
- `maintainable_items`
- `activity_codes`

Taxonomy is shared or customer-extended. It is validated for referential integrity.

### 15.2 Maintenance Knowledge

The executable content of maintenance:

- `task_master`
- `task_templates`
- `task_template_steps`
- `task_template_safety_controls`

This is the core intellectual property that Atiman preserves and evolves.

### 15.3 Knowledge Packs

Curated bundles of taxonomy and maintenance knowledge:

- `template_families`
- `template_family_rules`
- `smp_families`
- `smp_tasks`

Knowledge packs are versioned, importable, and eventually marketable.

### 15.4 Customer Knowledge

Tenant-specific adaptations:

- Approved subset of shared knowledge.
- Custom task templates.
- Custom taxonomy extensions.
- Localized or regulatory variants.

Customer knowledge still lives in the Knowledge Foundation; it is not operational data.

### 15.5 Versioning

Every knowledge entity has a lifecycle state:

- **Draft** — under construction.
- **Review** — pending validation.
- **Published** — available for operational use.
- **Deprecated** — still usable but no longer recommended.
- **Retired** — not available for new operational use.

Versioning is explicit. Historical versions remain readable for audit and reference.

### 15.6 Governance

- Knowledge must pass automated validation before publication.
- Changes to published knowledge require review.
- Knowledge quality metrics are tracked.
- Customers can subscribe to knowledge pack updates.

### 15.7 Validation

- Referential integrity within the knowledge graph.
- Completeness (required fields, steps, safety controls).
- Rule conformance (frequency units, durations, allowed values).
- No duplicate canonical identifiers.

### 15.8 Future Marketplace — Proposed Future Architecture

*The following is a proposed future capability, not approved architecture.*

Long-term, Atiman may support a knowledge marketplace where:

- Vendors and experts author knowledge packs.
- Customers purchase or subscribe to packs.
- Usage and outcome feedback improve pack quality.
- Governance and certification maintain trust.

Marketplace business rules, external contributor models, pack ownership, and licensing models are **Proposed Future Architecture** until established by an authoritative Project Source.

### 15.9 Knowledge Ownership

*Proposed Future Architecture — not approved policy.*

Ownership and licensing models for knowledge are not established in this document. Possible future models may include shared knowledge ownership, tenant-owned customer knowledge, or marketplace author ownership with subscriber licensing. Any such model must be established by an authoritative Project Source before it becomes Atiman policy.

ATM-000 does not establish legal, IP, or licensing policy.

### 15.10 Knowledge Evolution

Knowledge improves through:

- Expert authoring and review.
- Customer customization and feedback.
- Operational outcomes (what worked, what failed, what was missed).
- AI-assisted suggestions that are validated by humans.

---

## 16. Experience Philosophy

- **Task-first, not module-first.** A user opens Atiman to perform a task: inspect an asset, record a finding, assess a condition, escalate a recommendation. The UI starts with the task.
- **Role-aware.** Operators see simple, guided actions. Supervisors see queues and exceptions. Engineers see taxonomy and reliability. Planners see prioritization and escalation readiness.
- **Action-oriented.** Every screen has a clear primary action.
- **Knowledge is first-class.** Procedures, safety controls, and failure context are visible in context, not hidden in documents.
- **AI appears contextually.** AI help is offered where it adds value, not as a separate chat window bolted onto every screen.
- **Mobile-first.** Field workflows are designed for mobile first; desktop is for authoring, planning, analysis, and integration configuration.
- **Operator-first.** The frontline operator is the most important user. If the operator cannot use it in the field, the feature is wrong.
- **Supervisor-first.** Supervisors need visibility and control without drowning in data.
- **Engineer-first.** Engineers need precision, version history, and governance.

---

## 17. AI Philosophy (Reinforced)

- AI is a capability distributed across the platform.
- AI reads authoritative knowledge and operational context.
- AI generates recommendations, summaries, predictions, and explanations.
- AI never overrides governance or human approval.
- AI mistakes are traceable and correctable through knowledge updates.

---

## 18. Knowledge Pack Philosophy

A Knowledge Pack is the unit of reusable maintenance knowledge:

- It contains taxonomy and maintenance knowledge for a domain.
- It is versioned and validated.
- It can be imported into a tenant workspace.
- It can be extended, but core pack updates can still flow to subscribers.
- It is the foundation of the future marketplace.

*Marketplace mechanisms are Proposed Future Architecture.*

Knowledge packs are how Atiman scales domain expertise without rebuilding it per customer.

---

## 19. Long-Term Evolution

| Phase | Focus |
|-------|-------|
| **Foundation** | Knowledge model, taxonomy, core platform, bootstrap admin/organization. |
| **Knowledge Ingestion** | Import curated knowledge from legacy sources (ATM-001). |
| **Operational Core** | Inspections, operator-driven maintenance, finding assessment, prioritization. |
| **Intelligence** | Asset health, condition, risk, reliability, and evidence-based recommendations. |
| **Enterprise Integration** | Outbound escalation and inbound outcome exchange with EAM systems. |
| **Marketplace** | Certified knowledge packs, subscriptions, contributor governance (Proposed Future Architecture). |
| **Enterprise Scale** | Deeper analytics and additional integrations, without becoming a full EAM. |

---

## 20. Guiding Principles for Future Decisions

When a future decision is uncertain, apply these rules in order:

1. **Does it strengthen the knowledge foundation?** If yes, prioritize.
2. **Does it respect the knowledge/operations separation?** If no, reject or refactor.
3. **Does it serve the operator, supervisor, or engineer directly?** If none, reconsider.
4. **Can it be expressed as a knowledge service consumed by apps?** If not, redesign.
5. **Does it preserve human accountability when AI is involved?** If not, reject.
6. **Is it safe to deploy idempotently?** If not, fix before shipping.
7. **Does it honor Findings Before Work Orders?** If not, reconsider.
8. **Does it integrate rather than replace enterprise systems?** If not, reconsider.

---

## 21. Decision Record

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Asset Operations and Intelligence Platform identity | Aligns with the approved Product Constitution. |
| 2 | Knowledge-first architecture | Maintenance expertise is the durable asset; operational apps are consumers. |
| 3 | Separate knowledge and operational evidence | Enables reuse, versioning, governance, auditability, and multi-tenant scaling. |
| 4 | Six-layer architecture | Clear boundaries, independent evolution, testable dependencies, explicit EAM integration boundary. |
| 5 | Finding-centric operating model | Honors "Findings Before Work Orders" and keeps Atiman out of enterprise EAM execution. |
| 6 | AI as capability, not module | AI should be pervasive and contextual, not isolated. |
| 7 | Task-first, role-aware UX | Field usability is the primary success metric. |
| 8 | Mobile-first | Maintenance happens at the asset, not at a desk. |
| 9 | Knowledge packs as reusable units | Scales expertise and enables future marketplace. |
| 10 | Human accountability for AI | Trust and safety require human ownership of consequential actions. |
| 11 | Idempotent deployments | Production safety and repeatability are non-negotiable. |
| 12 | Exclude operational legacy data | Atiman is a fresh product; only institutional knowledge is preserved. |
| 13 | Enterprise EAM boundary | SAP PM, Maximo, Infor, Oracle remain authoritative for planning, scheduling, inventory, procurement, and finance. |

---

## 22. Open Questions

1. What is the exact identity model for the bootstrap administrator (username, email, role naming)?
2. Which roles are defined at launch versus added later?
3. What is the initial Knowledge Pack release scope beyond the ATM-001 legacy extraction?
4. What certification/governance process applies to marketplace knowledge packs (Proposed Future Architecture)?
5. Which operational application is built first after the knowledge foundation?
6. What is the AI provider and integration model (self-hosted, API, hybrid)?
7. What is the event schema for cross-layer communication?
8. What are the exact mobile platform targets (PWA, iOS, Android)?
9. Which enterprise EAM system is the first integration target?
10. What is the formal escalation payload schema between Atiman and enterprise EAM?

---

## 23. Roadmap

| Milestone | Deliverable | Depends On |
|-----------|-------------|------------|
| ATM-000 | Product Constitution / Vision (this document) | — |
| ATM-001 | Knowledge Foundation | ATM-000 |
| ATM-002 | Experience Architecture | ATM-000 |
| ATM-003 | Platform Foundation | ATM-000 |
| *(Proposed)* | Knowledge Ingestion from legacy source | ATM-001 |
| *(Proposed)* | Inspections & Operator Driven Maintenance | ATM-002, ATM-003 |
| *(Proposed)* | Finding Assessment & Prioritization | ATM-002, ATM-003 |
| *(Proposed)* | Asset Intelligence MVP | Inspections / ODM |
| *(Proposed)* | Enterprise Integration design | Asset Intelligence |
| *(Proposed)* | Knowledge Pack marketplace design | Enterprise Integration |

*All items beyond ATM-003 are Proposed Future Architecture until approved.*

---

## STOP

This document is implementation preparation only.  
No code, no migrations, no UI redesign, and no production changes have been made.  

*(The former closing line — "Awaiting ChatGPT architectural review." — was stale: review by the
OWNER / Chief Architect occurred, and the constitution is ratified. See **Authority** at the head of
this document. The line is retained here as history.)*
