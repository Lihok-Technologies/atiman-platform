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
  with the legacy bundle discarded entirely — **with exactly one recorded
  qualification, §6 below.**

---

## 6. Recorded qualification: the tenant-administrator compatibility restoration (ATM-001-SEC-104-R2 F3)

**Status: RECORDED, awaiting OWNER acknowledgment. This section carries no
authority of its own and changes no rule by itself.**

### 6.1 The rule this qualifies

§5 states that a principal holding any explicit grant resolves in
`EXPLICIT_GRANTS` mode with the legacy bundle **discarded entirely**. ATM-003-R2's
mode rule is a strict disjunction: a principal resolves in exactly one mode and
there is no union. The F3 preservation recorded here is the **single, explicit
exception** to that "no union" property.

### 6.2 What the exception is

`src/config/capabilities.js` records the tenant administrator as the principal
shape `users.role = 'admin'` **and** `users.is_organization_admin = true`, and
preserves for that one shape the `ATM-003-R1 §4` **Tenant Administrator** profile
in **both** resolution modes.

That profile is exactly:

| Capability | Scope | ATM-003-R1 §4 wording |
|---|---|---|
| `org.user_admin` | Tenant | "Tenancy administration is required to operate at all" |
| `org.config_admin` | Tenant | (same profile row) |

**Verified effect (independently reviewed at the R2 head).** For a principal with
`role = 'admin'` AND `is_organization_admin = true` AND explicit grants `G`, the
resolved set is exactly `G ∪ {org.user_admin, org.config_admin}` — no union of the
rest of the legacy `admin` bundle, and no capability outside the ATM-003-R1 §4
Tenant Administrator profile.

### 6.3 Why it exists (a restoration, not an addition)

Before the capability model, any `admin` could administer its own organization
profile. The mode rule discards the legacy bundle once *any* grant exists, so a
tenant administrator that received one unrelated grant silently lost that ability
— reviewed at R2 as a regression (baseline `200` + persisted write; candidate
`403`). The preservation restores the pre-capability behaviour for that principal
shape and nothing more.

### 6.4 Consistency with ATM-003-R1, and why it is not new authority

1. **It is exactly an approved profile.** ATM-003-R1 §4 defines the Tenant
   Administrator launch profile as `org.user_admin` + `org.config_admin`, and
   neither capability is new: both are in the `admin` legacy bundle and in
   `V1_HUMAN_GRANTABLE`. No capability, role or profile is introduced.
2. **The preserved set is bounded by the legacy bundle.** The preserved entries
   are exactly the `admin` bundle's two organization-administration entries;
   every other `admin`-bundle capability still requires an explicit grant in
   `EXPLICIT_GRANTS` mode.
3. **The flag is not an authority.** Holding `is_organization_admin = true`
   grants nothing on its own — `role = 'admin'` is also required, so a
   flag-true non-administrator gains nothing. (Asserted live: an operator with
   the flag is refused every route it was refused before.)
4. **It stays tenant-scoped.** `platform.admin`, `knowledge.taxonomy_admin` and
   `integration.service` remain unreachable, `knowledge.legacy_clearance` is
   **not** preserved, and tenant scope is still enforced separately by the
   routes' ownership predicates and tenant-exact writes.

### 6.5 What the OWNER is asked to acknowledge

That the "explicit grants are the only authority, with the legacy bundle
discarded entirely" rule has **one recorded exception** — the tenant
administrator profile above — and that this exception is a compatibility
restoration bounded to an approved ATM-003-R1 §4 profile rather than a union of
the legacy bundle.

**Until the OWNER acknowledges it, this exception must be treated as a recorded
compatibility exception, not as a ratified rule.** Nothing in this section
asserts an approval, and no source is reclassified by it.

### 6.6 What this section does not do

- It creates no authority, for anyone, at any scope.
- It changes no route, permission, role or migration, and ratifies nothing.
- It does not generalise: no other principal shape, role or bundle gains any
  union between modes. The exception is enumerated for one shape only, and a
  capability added to the vocabulary later is still not silently preserved.

---

## 7. Recorded escalation: the subscription `status` scope question (ATM-001-SEC-104-R2 F1)

**Status: RECORDED AND ESCALATED to the OWNER. This section carries no authority
of its own, changes no rule, adds no option, and does not assert that the
conflict it records is resolved.**

R2 (F1) pinned subscription `status` as platform-scoped provisioning for the
**direct administrative write only** — `PUT /api/subscriptions/admin/organizations/:id`,
guarded by `requireCapability('platform.admin')`
(`src/routes/subscription.routes.js:246` at the R3 documentation head
`ce9947ba7ded4018792d2a3896c7bb81989320a9`, tree
`962f12051393c5a1448d8a02b2c536e190c2c2b5`), whose controller writes `status` at
`src/controllers/subscription.controller.js:349-355`. That scope statement does
not extend to subscription `status` transitions generally.

The sanctioned, tenant-scoped, admin-only paid path already performs the same
write. Verified link by link at that head:

- `POST /api/payments/checkout` — `src/routes/payment.routes.js:13-17`,
  `requirePermission('SUBSCRIPTION', 'UPDATE')`, which is `admin: 'all'`,
  `supervisor: 'none'`, `operator: 'none'` (`src/config/permissions.js:116`).
- the signature-validated webhook `POST /api/payments/webhook`
  (`src/routes/payment.routes.js:31-34`) is public by design and authenticated by
  the Stripe signature rather than by a permission; it calls
  `paymentService.handleWebhook` (`src/services/payment.service.js:254`), which
  dispatches `checkout.session.completed` to `handleCheckoutCompleted`
  (`:288-301`) → `handleSubscriptionUpgrade` (`:306-311`) →
  `subscriptionService.changePlan()`.
- `changePlan()` executes `SET status = 'active'` at
  `src/services/subscription.service.js:281`, whatever the target plan; the same
  write is reached from `customer.subscription.deleted` through
  `handleSubscriptionCancelled` (`src/services/payment.service.js:400-405`).

ATM-001-SEC-104-R3 in addition admitted a tenant-scoped administrator write of
that same column, through `POST /api/subscriptions/reactivate`
(`requirePermission('SUBSCRIPTION', 'UPDATE')`). The two positions — the direct
administrative write treated as platform-scoped, and the tenant-scoped
reactivation write — are **left in conflict on purpose and are NOT reconciled
here**.

**The OWNER must adjudicate this conflict.** The full record — the
"UNRESOLVED GOVERNANCE POINT, ESCALATED — NOT SILENTLY RECONCILED" paragraph,
including the three OWNER options and its self-correction clause — is the route
header of `src/routes/subscription.routes.js` at the head above. Before this
section that record appeared nowhere else in the repository, which is why it is
mirrored here for an OWNER reading the register. This section adds no policy and
no new option.
