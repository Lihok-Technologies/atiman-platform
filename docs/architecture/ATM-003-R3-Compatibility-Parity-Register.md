# ATM-003-R3 — Legacy Compatibility Parity Register

**Document ID:** ATM-003-R3
**Status:** **APPROVED V1** — evidence register for the legacy-role compatibility
bundles. It records verified parity; it creates no authority.
**Baseline:** `origin/main` = `2810b6d89a1c2f169420364cd0a28132ad042393`
**Governed by:** `ATM-003-R1` (capabilities, profiles, SoD) and the OWNER
adjudication of 2026-09-27 §7 ("do not silently grant an existing role an action
it could not previously perform") and §12 ("choose the LESS-PRIVILEGED mapping
and record the compatibility difference").

---

## 1. What is being verified

A principal with **no** explicit grant resolves through its legacy-role bundle
(`ATM-003-R2` mode rule). Each capability in each bundle must be one the role
could actually reach **before** the capability model existed. Authority is
measured from two pre-change sources:

1. `src/config/permissions.js` — the resource/action matrix
   (`admin` / `supervisor` / `operator` → `all` / `own` / `none`).
2. The guards on the routes that enforce it — notably `requireAdmin`
   (= `admin` **or** `supervisor`), `requireSupervisor`, `requireOperator` and
   `requirePermission(resource, action)`.

A capability whose protected act was unreachable by the role is **excluded**, and
the exclusion is recorded in §4.

---

## 2. Per-capability parity evidence

| Capability | Pre-change authority | Evidence |
|---|---|---|
| `inspection.execute` | supervisor, operator | `INSPECTIONS.SUBMIT`: admin **none**, supervisor all, operator all |
| `finding.report` | admin, supervisor, operator | `FINDINGS.CREATE`: all three `all` |
| `finding.assess` · `finding.monitor` · `finding.close` · `escalation.prepare` · `escalation.approve` | admin, supervisor | `FINDINGS.MANAGE`: admin all, supervisor all, operator none (routes: `/pending-sap`, `/:id/sap-notification`, `/:id/status`) |
| `inspection.assign` | admin, supervisor | `WORK_ORDERS.ASSIGN` (admin, supervisor) and `INSPECTIONS.MANAGE_POINTS` (admin, supervisor) |
| `evidence.attach` | **admin only** | knowledge-provenance routes are guarded by `TASKS.CREATE` / `TASKS.UPDATE`: admin all, supervisor **none**, operator **none** |
| `knowledge.author` | admin, supervisor | `POST /task-templates` and `PUT /task-templates/:id` guarded by `requireAdmin` (= admin or supervisor) |
| `knowledge.submit` | admin, supervisor | `POST /:id/submit-for-review` guarded by `KNOWLEDGE.REVIEW` (admin all, supervisor all) |
| `knowledge.review` | admin, supervisor | `KNOWLEDGE.REVIEW` |
| `knowledge.approve` | admin, supervisor | `KNOWLEDGE.APPROVE` |
| `knowledge.safety_review` | admin, supervisor | `KNOWLEDGE.SAFETY_REVIEW` |
| `knowledge.publish` | admin, supervisor | `POST /:id/publish` guarded by `requireAdmin` |
| `org.user_admin` | admin (see §4 for supervisor) | `USERS.CREATE/VIEW/DELETE`: admin all; `USERS.DELETE` supervisor none |
| `org.config_admin` | admin | `FACILITIES.CREATE/UPDATE/DELETE`: admin all, supervisor none |
| `knowledge.legacy_clearance` | **nobody** | no route enforces it; clearance columns are written only by governed system/bootstrap operations |

**Coarse-to-fine refinements (not expansions).** `FINDINGS.MANAGE` was one coarse
permission; the capability model expresses it as five precise capabilities
(`finding.assess`, `finding.monitor`, `finding.close`, `escalation.prepare`,
`escalation.approve`). The roles holding the coarse permission keep the same
practical reach, and no route enforces the finer split yet, so the refinement
grants nothing reachable that the role could not already do.

---

## 3. Verified bundles

| Role | Capabilities | Count |
|---|---|---|
| **operator** | `inspection.execute`, `finding.report` | 2 |
| **supervisor** | `inspection.execute`, `finding.report`, `knowledge.author`, `knowledge.submit`, `knowledge.review`, `knowledge.approve`, `knowledge.publish`, `knowledge.safety_review`, `finding.assess`, `finding.monitor`, `finding.close`, `escalation.prepare`, `escalation.approve`, `inspection.assign` | 14 |
| **admin** | `finding.report`, `finding.assess`, `finding.monitor`, `finding.close`, `escalation.prepare`, `escalation.approve`, `inspection.assign`, `evidence.attach`, `knowledge.author`, `knowledge.submit`, `knowledge.review`, `knowledge.approve`, `knowledge.publish`, `knowledge.safety_review`, `org.user_admin`, `org.config_admin` | 16 |

**In no bundle:** `platform.admin`, `knowledge.taxonomy_admin`,
`integration.service` (never human-grantable in V1) and
`knowledge.legacy_clearance` (unreachable pre-change).

**No bundle is a wildcard.** Each is an explicit enumeration, so a capability
added to the vocabulary later is not silently granted to any legacy role —
including `admin`, which is an 18-capability architecture but a 16-entry
compatibility bundle.

---

## 4. Recorded compatibility differences (less-privileged mappings)

Two places where exact parity was impossible and the **less-privileged** mapping
was chosen, as the OWNER required. In both cases the affected role must be given
an **explicit grant** to recover the ability.

| Difference | Why parity is impossible | Effect | Recovery |
|---|---|---|---|
| **`evidence.attach` removed from the operator and supervisor bundles** | ATM-001 *provenance* evidence (source citations) is guarded by `TASKS.CREATE/UPDATE`, which only admin held. The capability model has no separate capability for "operational evidence" — operator photo/reading capture is `inspection.execute` territory (`INSPECTIONS.SUBMIT_READINGS`) | Operator and supervisor cannot attach provenance evidence through the legacy bundle | Explicit grant of `evidence.attach` |
| **`org.user_admin` absent from the supervisor bundle** | Supervisors could create users, but `canCreateUser` constrained them to operators **within their own facility**. The capability model has no facility-scoped user administration, so granting the whole capability would expand supervisor authority beyond the pre-change constraint | Supervisors cannot administer users through the legacy bundle | Explicit grant of `org.user_admin` (which is deliberately *broader* than the old constraint, so it is an OWNER decision, not a silent expansion) |

**Also recorded:** `knowledge.legacy_clearance` is grantable in V1 but appears in
no bundle, because no role could perform the act before this campaign. It
requires an explicit grant, which is a deliberate narrowing of the architectural
admin profile.

---

## 5. What this register does not do

- It grants nothing, to anyone. It documents the parity of bundles the resolver
  applies in compatibility mode only.
- It changes no route, permission or role, and does not migrate `users.role`.
- It does not decide the explicit-grant future: explicit grants remain the
  authority, and any principal holding one resolves in `EXPLICIT_GRANTS` mode
  with the legacy bundle discarded entirely.
