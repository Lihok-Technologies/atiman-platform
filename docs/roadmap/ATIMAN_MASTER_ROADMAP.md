# ATIMAN — Master Product Roadmap

**Version:** 1.0 (proposed)  
**Date:** 2026-10-17  
**Status:** PROPOSED — documentation for review; not an approved architectural decision or release authorization  
**Authority:** Subordinate to Atiman Product Constitution and `ATM-SRC-001` v1.1; approved ADRs and Project Sources prevail on conflict  
**Repository:** `Lihok-Technologies/atiman-platform`  
**Legacy source:** ODM-CMMS (migration/reference only)

> **Reading rule:** "Approved direction" means sourced from `ATM-SRC-001`. "Reported implementation" means evidenced by supplied engineering/review reports, not reverified by this roadmap. "Proposed" requires appropriate approval. No completion, merge, database, CI, or deployment authorization is implied.

## 1. North star and boundaries — approved direction

Atiman is an **Asset Operations and Intelligence Platform**: the engagement and intelligence layer between field personnel, governed engineering knowledge, and enterprise maintenance systems. It **complements, not replaces**, SAP PM, Maximo, Infor EAM, Oracle EAM and equivalent systems. It must not drift into a full CMMS, EAM, ERP, procurement, inventory, or financial platform.

Constitutional axioms: **Knowledge Before Transactions; Findings Before Work Orders; Operators Are the First Sensors; Integrate Rather Than Replace; AI Augments Human Judgment; Evidence Before Assumption; Experience Follows Work.**

**Finding** remains the primary operational object. Core flow: **Inspection → Finding → Assessment → Operator Corrected / Monitor / Escalate → Closure → Knowledge preservation.** Escalation to enterprise maintenance execution is a governed decision, not an automatic work order.

## 2. Source-of-truth and status rules

1. Approved Product Constitution and Project Sources outrank this roadmap; then approved architecture/ADRs, approved experience/domain architecture, bounded specifications, current code, and legacy behavior.
2. `ATM-SRC-001` v1.1 is an active operating reference, **not** proof that every roadmap item is implemented or that an unverified constitution version has been ratified.
3. **Approved direction:** `ATM-000` Product Constitution/Vision; `ATM-001` Knowledge Foundation; `ATM-002` Experience Architecture; `ATM-003` Platform Foundation. The Project Source names later *domains* but does not assign their IDs or mandate sequence.
4. **Proposed planning IDs:** `ATM-004` through `ATM-012` below are provisional labels only. Do not use them as registered issue/ADR IDs until reconciled and approved.
5. Repository `README.md` on the inspected main branch still describes ODM-CMMS as a CMMS and documents historical operational behavior. That is **legacy/current documentation**, not the target product contract. The source file's local ODM-CMMS path is a historical baseline; current engineering reports identify this Atiman repository. Reconcile explicitly, not by silently rewriting approved source.
6. Treat user-supplied review reports as reported evidence until exact commits, tests, PRs, and production state are independently verified for the relevant release candidate.

## 3. Workstreams and gates

| Workstream | Authority/status | Target deliverable | Acceptance gate |
|---|---|---|---|
| ATM-000 Constitution/Vision | Approved direction; administrative version check pending | Product boundary, axioms, decision hierarchy | Source/version reconciliation and OWNER acceptance |
| ATM-001 Knowledge Foundation | Approved direction; active work | Curated engineering taxonomy, maintenance/safety/inspection knowledge, provenance, versioning, governance, knowledge packs | No dummy operational-history migration; evidence-backed provenance, publication approval, tenant isolation |
| ATM-002 Experience Architecture | Approved direction; design work to verify | Task-first, role-aware, mobile-first operator/supervisor/engineer flows | User task-flow/prototype acceptance before major UI replacement |
| ATM-003 Platform Foundation | Approved direction; existing foundation to verify | Identity, tenancy, authorization, PostgreSQL, APIs, audit, security, deployment | Verified exact-tree security/integration, approved migrations, release gate |
| ATM-004 Asset Knowledge | **Proposed ID/domain** | Asset context, hierarchy, specifications, documents, QR | EAM system-of-record boundary and hierarchy contract |
| ATM-005 Operator-Driven Maintenance | **Proposed ID/domain** | Inspections, condition observations, evidence capture | Operator can inspect and report with minimal friction |
| ATM-006 Findings Platform | **Proposed ID/domain** | Finding lifecycle, assessment, correction/monitor/escalation, closure | Human accountable action decisions; no automatic WO |
| ATM-007 Asset Health | **Proposed ID/domain** | Evidence-backed condition trends and health indicators | Scoring methods, confidence, explainability validated |
| ATM-008 Risk & Reliability | **Proposed ID/domain** | Criticality, risk, failure patterns, MTBF/MTTR where data supports | Defensible source data, validation, human review |
| ATM-009 Knowledge Services | **Proposed ID/domain** | Search, review, reuse, import/export, knowledge enrichment | Provenance, authorization, quality and version controls |
| ATM-010 Enterprise Integration | **Proposed ID/domain** | Governed SAP PM/EAM and condition-data adapters | Ownership boundaries, mappings, audit, failure recovery |
| ATM-011 Contextual AI | **Proposed ID/domain** | AI-assisted inspection, classification, retrieval, analysis, explanation | Evidence grounding, tenant isolation, human accountability |
| ATM-012 Commercial Readiness | **Proposed ID/domain** | Tenant onboarding, pilot readiness, support, security, operations | Explicit pilot/commercial release acceptance and OWNER deployment authorization |

These are **capability domains, not a promise of twelve sequential projects**. Knowledge services, security, and contextual AI are cross-cutting; their provisional IDs must not force module-first architecture.

## 4. Delivery increments — proposed

### Increment A — Governed foundation
Verify current implementation and source authority; complete the Knowledge Foundation and platform security baseline. Preserve curated legacy engineering knowledge, **not** dummy facilities, users, equipment, findings, work orders, logs, or test transactions. Use fresh tenant/admin bootstrap under approved policy.

**Gate:** provenance and publication lifecycle verified; tenancy and security evidence current; no unapproved production action.

### Increment B — Operational MVP
Deliver one complete **operator → finding → assessment → correction/monitor/escalation → closure → knowledge** experience, with asset context, inspection evidence, and role-aware mobile UI. Validate workflows with real roles, not legacy menu coverage.

**Gate:** operator and supervisor task acceptance; finding audit trail; no EAM replacement behavior.

### Increment C — Evidence-based intelligence
Introduce governed knowledge retrieval, asset-condition trends, health/risk/reliability assessments, and contextual AI assistance only as data and model validation permit.

**Gate:** explainable outputs, known confidence/limitations, engineering validation, accountable human decisions.

### Increment D — Enterprise and customer readiness
Pilot enterprise interfaces, tenant onboarding, support, privacy/security, operational resilience, and commercial release readiness.

**Gate:** independently verified release candidate, approved integration and customer-data boundaries, explicit OWNER merge/deployment decisions.

## 5. Immediate security/engineering execution queue — reported 2026-10-17

This is a **reported snapshot, not live repository verification**.

| Item | Reported status | Next required action |
|---|---|---|
| TA04 / T-4 runner fail-closed | Independent VUDA **PASS**; bounded technical assurance closed | Preserve evidence; do not reopen without new defect |
| TA05 output capture | Implemented; prior validation reported | Preserve exact candidate evidence |
| TA06-R2/R3 regression | Independent VUDA **PASS** on candidate `c76448ef2dbc9f8fc93ae8ee6200ea8b43108c51` | Preserve historical negative controls and reviewer evidence |
| T-5 stderr capture | Investigation classified **test-design improvement only** | No security fix required; optional label correction separately |
| T-3 default test lane | **OPEN — OWNER policy decision** | Design safe visible NOT-RUN reporting; do not silently change test policy |
| Credential suite case 16 | **OPEN** | Separately authorize DB-backed verification on isolated disposable PostgreSQL only |
| Historical credential exposure | **OPEN** | Security/OWNER disposition; no unapproved history rewrite |
| CI and GitHub rulesets | **OPEN — Reserved Matter** | Explicit governance decision; no unilateral CI/ruleset edits |
| Seven onboarding policy questions | **OPEN** | OWNER product-policy decisions before behavior changes |
| SEC-107 integration and review | **OPEN** | Verify exact release candidate and GitHub-recorded independent review; do not reuse wrong-worktree claims |
| Production | **HOLD** | No deployment without separate explicit OWNER authorization |

**Safety:** Do not connect to shared PostgreSQL, run migrations, use DB-mutating test runners, access credentials, or activate CI/deployment during roadmap documentation. The normal non-DB suite was *reported* 239/239 passing on Node 22 and 26; it is **not** evidence that DB-gated suites ran.

**Next bounded action:** T-3 design/policy recommendation → OWNER decision → approved implementation and independent review (if necessary) → separately authorized isolated-DB case 16 → remaining SEC-107 security/governance gates → exact-candidate acceptance.

## 6. Architecture dependencies

- **Knowledge and provenance before recommendations:** taxonomy, procedures, sources, approvals, versioning and evidence integrity precede confident health/risk/AI claims.
- **Identity/tenancy before customer data:** verify tenant isolation across knowledge, findings, files, AI context, integrations and audit.
- **Asset context before meaningful inspection:** consume enterprise asset references when appropriate; do not duplicate the enterprise master without approval.
- **Inspection before Finding; Finding before work order:** operator observations generate findings; escalation is a human-governed decision.
- **User work before UI navigation:** prototype role/task flows before recreating legacy modules.
- **Integration contracts before synchronization:** define authority, conflict handling, traceability and safe retries.
- **Quality gates before release:** exact-tree tests, independent review, authorized database tests, risk acceptance and explicit OWNER decisions.

## 7. Acceptance and release stages — proposed

| Stage | Required evidence | Authority |
|---|---|---|
| Internal alpha | Bounded workflow demonstrations; controlled identities; no production assumption | Engineering/product review |
| Pilot beta | Real operator and supervisor acceptance; tenant and data controls; support/rollback plan; integration boundaries | OWNER pilot authorization |
| Initial commercial | Security and privacy review, backups/recovery, observability, customer onboarding, independent acceptance, commercial obligations | Explicit OWNER commercial/release authorization |
| Subsequent expansion | Validated intelligence, reliability, AI, integration capabilities | Separate bounded acceptance |

**No dates or delivery-duration promises** until repository inventory, team capacity, dependency sequencing, and acceptance criteria are verified.

## 8. Execution and change governance

- **One bounded task per PR**; investigate before code changes; review the actual diff; no business-logic changes without approval.
- Kimi-Codex is the designated primary implementation engineer under the Project Source; other approved DSH models/sessions may be used for bounded implementation and independent review subject to OWNER direction.
- Keep **approved architecture**, **proposed design**, **current implementation**, **legacy behavior**, and **future ideas** explicitly separate.
- Maintain a separate execution-status tracker *only after* its scope and canonical source are agreed; do not create competing authority.
- Update this roadmap via a reviewed documentation-only PR. Changes to constitutional axioms, product boundaries, primary Finding model, knowledge philosophy, AI accountability, or deployment policy require a separately approved architectural decision.
- **No automatic merge, production deploy, database migration, CI/ruleset alteration, or credential operation.**

## 9. Open reconciliation register

1. Confirm approved Product Constitution document/version and whether this source's roadmap labels align with registered architecture/issue IDs.
2. Verify repository implementation inventory and any preexisting canonical roadmap outside default-branch code search.
3. Reconcile the historical ODM-CMMS paths/README with current Atiman repository identity without altering legacy records silently.
4. Confirm current SEC-107 candidate, GitHub PR/review evidence, and remaining blockers at release time.
5. Obtain OWNER T-3 policy decision and seven onboarding-policy decisions.
6. Reconcile provisional ATM-004–ATM-012 labels before creating work items.
7. Establish a maintained execution-status document as a separate bounded documentation task, if approved.

---

**This roadmap is a proposed planning artifact. It does not amend `ATM-SRC-001`, ratify a constitution, approve architectural changes, or authorize production.**
