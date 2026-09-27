# ATM-003-R1 — Minimum Role and Capability Architecture (bounded intervention)

**Document ID:** ATM-003-R1
**Status:** **APPROVED V1** — bounded ATM-003 intervention. It resolves **only** the dependency blocking
ATM-002. It does not complete ATM-003.
**Baseline:** `origin/main` = `c7a1c1cd406b7c1f5189a6c6ef1a6c195a68b47f`
**Blocks:** `ATM-002-R3` (role-aware experience matrix), and the permission model behind every later
experience slice.
**Scope:** architecture only. No permission implementation, no `users` change, no migration.

---

## 1. The dependency being resolved

ATM-002 requires a role model it can compose experiences from. Three incompatible answers exist at this
baseline:

| Source | Model | Status |
|---|---|---|
| Implementation | `users.role` CHECK = **3** values (`admin`, `operator`, `supervisor`) | live |
| ATM-002 draft §5.1 | **4** experiences (operator, supervisor, engineer, admin) | draft; assumes an "engineer" account that does not exist |
| ATM-003 draft §3.3 | **11** job-title roles | draft; ATM-003 §6.2 itself records the role/permission model as *requires refactoring* |

**Decision on the eleven-role list: REPLACE WITH CAPABILITY MODEL** — with the parts that have no V1
capability **DEFERRED**. The eleven titles are not accepted as roles, refused as roles, or renumbered;
they are treated as *responsibility descriptions* to be re-expressed as capabilities, and the ones that
describe EAM-owned or not-yet-built work are deferred rather than modelled. This is also a **REDUCE** on
the implementation's three roles, which are themselves only coarse bundles of the capabilities below.

---

## 2. Derivation rule

Capabilities are derived from **accountable acts that approved architecture already requires** — not from
job titles, and not from the legacy application's screens. The strongest evidence source is the ATM-001
Knowledge Foundation, where each accountable act is enforced by schema: attribution columns, admission
rules, immutability triggers and a segregation-of-duties constraint. A capability is admitted only if
some approved workflow contains the act.

---

## 3. Capability groups

### 3.1 Knowledge governance (ATM-001 V1 — schema-enforced today)

| Capability | Accountable act | Enforcement evidence |
|---|---|---|
| `knowledge.author` | Create and edit a draft definition | `created_by`; authoring primitive requires a real, active actor; draft-only |
| `knowledge.submit` | Submit a draft for review | `submitted_for_review_by_user_id`, `submitted_for_review_at` |
| `knowledge.review` | Review and record a review decision | `reviewer_user_id`, `reviewed_at`, `review_state` |
| `knowledge.approve` | Approve knowledge as the accountable approver | `approver_user_id`, `approved_at`, `approved_content_sha` |
| `knowledge.safety_review` | Attest the safety state of a definition | `safety_review_state`, `safety_reviewed_by_user_id`, `safety_reviewed_at` |
| `knowledge.publish` | Publish an approved version | `published_by_user_id`; `chk_task_template_versions_approver_not_publisher` |
| `knowledge.legacy_clearance` | Clear legacy-generated content for governance | `legacy_clearance_by_user_id/_at/_rationale` |
| `evidence.attach` | Attach provenance evidence to a definition or step | `added_by_user_id` on evidence rows |
| `knowledge.taxonomy_admin` | Register global external authority / canonical taxonomy identity | **NOT CREATED IN V1** — ATM-001 M5R.3A: a system/OWNER act; "no new authorization capability is created in V1". Deferred, not modelled here |

### 3.2 Inspection and Findings (approved operational model)

| Capability | Accountable act | Evidence |
|---|---|---|
| `inspection.execute` | Perform an inspection and capture evidence | Approved Inspection → Finding chain |
| `inspection.assign` | Assign or release inspection work | Supervisor work in the approved model |
| `finding.report` | Record an observation and raise a Finding | Approved Finding creation flow |
| `finding.assess` | Decide the Finding outcome — Operator Correction, Monitoring, Escalation | Approved assessment outcomes |
| `finding.monitor` | Keep a Finding under monitoring and record follow-up | Monitoring is a first-class outcome |
| `escalation.prepare` | Prepare the evidence-rich EAM handoff package | Approved escalation-readiness step |
| `escalation.approve` | Accountably approve the handoff (the escalation decision) | Human accountability; R5 details the presentation |
| `finding.close` | Close a Finding at task/verification level | Approved Closure step |

> `inspection.assign`, `escalation.*` and `finding.close` are **modelled but not implemented**: they have
> no code today. They are admitted because the approved workflow requires the act, and they are marked
> so that no later record assumes they exist.

### 3.3 Organization and platform administration

| Capability | Scope | Accountable act |
|---|---|---|
| `org.user_admin` | Tenant | Manage users, invitations, roles |
| `org.config_admin` | Tenant | Tenant settings, facilities, organization profile |
| `platform.admin` | Platform | Provisioning, cross-tenant health, platform configuration — **no domain content access** (ATM-003 §3.3 System Admin) |
| `integration.service` | Scoped | Machine-to-machine API access with an explicit, narrow scope |

---

## 4. Minimum launch responsibility profiles

**Profiles are capability bundles, not job titles, and not database rows.** A person may hold several
profiles; a profile may be held by several people. This is the property that makes the model survivable:
the implementation's single `role` column cannot express "supervisor who is also the safety reviewer",
which the approved workflows already require in small organizations.

| Profile | Capabilities | Why it must exist at launch |
|---|---|---|
| **Field Operator / Inspector** | `inspection.execute`, `finding.report`, `evidence.attach`* | Operators are the first sensors; the approved chain starts here |
| **Assessor** (supervisory) | `finding.assess`, `finding.monitor`, `escalation.prepare`, `escalation.approve`, `inspection.assign`, `finding.close` | Assessment outcomes and escalation approval are accountable supervisory decisions |
| **Knowledge Steward** | `knowledge.author`, `knowledge.submit`, `knowledge.review`, `knowledge.approve`, `knowledge.publish`, `knowledge.safety_review`, `knowledge.legacy_clearance`, `evidence.attach` | ATM-001's governed lifecycle cannot operate without these acts. **Its surfaces are evidence-gated (R6); the capability exists regardless** |
| **Tenant Administrator** | `org.user_admin`, `org.config_admin` | Tenancy administration is required to operate at all |
| **Platform Operator** | `platform.admin` | Provisioning and cross-tenant health; explicitly without domain content access |
| **Integration Identity** | `integration.service` (scoped) | Service accounts are the only non-human identity admitted, and they are never a persona |

\* `evidence.attach` is shared deliberately: evidence attaches where the work happens.

**Not admitted as launch profiles:** Planner, Reliability Analyst, Knowledge Reviewer as a *separate
person* from the Steward, and Knowledge Author as a *separate person* from the Steward. Their proposed
work is either **EAM-owned** (planning, prioritisation) or **analytics not in V1** (reliability trends),
so they are **DEFERRED**, not modelled. ATM-002 §9's "Engineer / Knowledge Steward" experience maps to
the **Knowledge Steward** profile; the engineer *title* is not admitted as a role.

---

## 5. Separation of duties — only where evidence requires it

| Constraint | Required? | Basis |
|---|---|---|
| Approver must not be the publisher of the same knowledge | **REQUIRED** | Already schema-enforced (`chk_task_template_versions_approver_not_publisher`); it is the one SoD the platform has actually ratified |
| Safety review must be attributed | **REQUIRED** | Schema-enforced attribution |
| Safety reviewer must be a different person from the approver | **NOT REQUIRED** | No approved record requires distinctness; inventing it would block small-tenant operation |
| Assessor must differ from the reporter | **NOT REQUIRED** | No approved record requires it; in a two-person operation it is impossible |
| Escalation approval must be a distinct, attributed human decision | **REQUIRED (attribution)**, distinctness not required | Human accountability |
| Legacy clearance must be attributed | **REQUIRED** | Schema-enforced |

**Rule:** a separation-of-duties constraint is added only when an approved record or an enforced
constraint demands it. SoD invented for symmetry reduces operability without adding assurance.

---

## 6. Scoping: tenant, platform, and neither

- **Tenant-scoped** (`org.*`, all `knowledge.*`, `finding.*`, `inspection.*`, `escalation.*`): evaluated
  against the acting user's organization; cross-tenant access fails closed (measured today: cross-org
  create/edit/read all refused).
- **Platform-scoped** (`platform.admin`): cross-tenant operational authority **without** domain content
  access. The separation is deliberate — the platform must not read tenant knowledge to administer it.
- **OWNER/governance-scoped** (`knowledge.taxonomy_admin`): **not created in V1** (ATM-001 M5R.3A). The
  data model can represent global authority; no application capability to create it exists, and none is
  added by this record.
- **Machine-scoped** (`integration.service`): explicit narrow scope, never a persona, never accountable.

---

## 7. Authentication vs authorization vs presentation

| Layer | Owns | Does not own |
|---|---|---|
| **Authentication** (ATM-003) | Identity, credentials, session lifecycle, SSO, service-account credentials | What the identity may do |
| **Authorization** (ATM-003, enforced at API/service layer) | Capability grants, tenant scoping, platform scoping, SoD constraints | How controls look |
| **Presentation** (ATM-002) | Whether a control is visible, its ordering, defaults, progressive disclosure, copy | The authority itself |

**Two binding rules:**
1. **Presentation is never a control.** Hiding a control is convenience; the authoritative check occurs
   at the API/service layer (ATM-003 §3.3). The existing client-side `permissions.js` map is therefore
   presentation-only and must never be treated as enforcement.
2. **A capability existing does not require exposing a control** (R1 §2 G; R3 will apply this).

---

## 8. What this record does not do

- It does not implement permissions, change `users`, add migrations, or define a grant schema. **The
  representation of capabilities and their assignments is an implementation decision requiring its own
  bounded mission.**
- It does not decide the surfaces each profile sees (**ATM-002-R3**).
- It does not complete ATM-003: tenancy internals, SSO, auditability, events, storage, security,
  observability and integration foundations remain ATM-003's broader scope.
- It does not reopen ATM-001: every `knowledge.*` capability above already exists in the foundation; this
  record names them, it does not create them.

---

## 9. LCQE evidence

- Every capability is traceable to a schema-enforced attribution column, admission rule or approved
  workflow; nothing is derived from a job title.
- The eleven-role decision (**REPLACE WITH CAPABILITY MODEL**, parts deferred) is stated explicitly, as
  is the mapping of ATM-002 §9's engineer/steward experience onto the Knowledge Steward profile.
- The SoD table distinguishes *attribution* (often required) from *distinctness* (required exactly once,
  and already enforced), avoiding invented constraints.
- The three-way role mismatch (3 implemented / 4 assumed / 11 drafted) is resolved without asserting any
  of the three as correct.

---

**ATM-003-R1 — capability architecture approved as a bounded intervention. No permissions implemented.**
