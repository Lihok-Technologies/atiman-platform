# ATM-001-SEC-106 B-1 — reconciliation and correction record

**Document ID:** ATM-001-SEC-106-B1-RECONCILIATION
**Mission:** MISSION #106 — resolve blocker B-1 (one bounded non-main DRAFT PR).
**Type:** EVIDENCE + reconciliation. No policy is decided and nothing is ratified here.
**Baseline:** integrated candidate `b0ce6b01a7a6a9926f5ada99639fac853e064341`
(tree `de1bbb5e70627b4a44ef8a8449e5da4893a5109a`); frozen `main`
`f156aa4479efe783eefd4f13fd62171647f83b7f`.
**Branch:** `atm-001-sec-106-b1-grant-authority` (non-main).
**Pre-change evidence:** `ATM-001-SEC-106-B1-ORIGINAL-EVIDENCE.md` (committed at `e7d2ade`
BEFORE any source or test change).
**Status:** CORRECTION COMPLETE — **not approved, not ratified, not merged, no verdict claimed.**

---

## 1. The authority analysis — exact mode, flag and transition

**Question asked of the tree:** which mechanism conferred `org.user_admin` on the blocker-B-1
principal, and did any APPROVED rule authorise it?

**Answer (VERIFIED, quoted).**

| Element | Finding | Source (pre-change candidate `b0ce6b01`) |
|---|---|---|
| **Mode** | `EXPLICIT_GRANTS` — the principal holds one active explicit grant, so the legacy bundle is discarded | `src/services/capability.service.js:11-28` (the OWNER adjudication mode rule, 2026-09-27) and `:154-160` |
| **Flag** | `users.is_organization_admin = true` — read from the row, never from a token/body | `src/services/capability.service.js:87`, row read at `:117-120` |
| **Transition** | `withTenantAdministratorProfile(explicit, user)` **added** `TENANT_ADMINISTRATOR_PROFILE` (`org.user_admin`, `org.config_admin`) to the explicit set | `src/services/capability.service.js:86-91`, applied at `:157` (explicit) and `:166` (legacy) |
| **Vocabulary / profile** | The ATM-003-R1 §4 profile is `org.user_admin` + `org.config_admin` | `docs/architecture/ATM-003-R1-Role-Capability-Architecture.md:86` (§4 heading), `:98` (Tenant Administrator row), `:79` (`org.user_admin` = "Manage users, invitations, roles", Tenant) |
| **Recorded justification** | "compatibility key, not an authority of its own" | `src/config/capabilities.js:165-204` (pre-change block comment) |
| **The record's own status** | **"RECORDED, awaiting OWNER acknowledgment. This section carries no authority of its own and changes no rule by itself."** and **"Until the OWNER acknowledges it, this exception must be treated as a recorded compatibility exception, not as a ratified rule."** | `docs/architecture/ATM-003-R3-Compatibility-Parity-Register.md:109-112`, `:178-180` (§6, the F3 "recorded qualification") |
| **Blocker statement** | the two contradictory outcomes (200 vs 403), 5 tests red | `docs/ATM-001-SEC-B3D-INTEGRATION-CANDIDATE.md:322-347` (§8 B-1) |
| **Duty in the OWNER policy** | "Specific approved ATM-003-R1 compatibility exceptions must be proven, narrowly described, and reconciled rather than silently discarded." | mission #106, recorded from #105 |

**Did an approved rule authorise the inference? NO — with one qualification, which is the whole
question.** ATM-003-R1 is *Status: APPROVED V1*, but it is an **architecture record about
profiles, not a grant rule**:

* `ATM-003-R1:88` — §4 opens by stating: *"**Profiles are capability bundles, not job titles,
  and not database rows.**"*
* `ATM-003-R1:160-162` — §8: *"It does not implement permissions, change `users`, add
  migrations, or define a grant schema. **The representation of capabilities and their
  assignments is an implementation decision requiring its own bounded mission.**"*
* `ATM-003-R1:184` — the record closes: *"**No permissions implemented.**"*

So §4 **names** the profile and requires it to exist at launch; it says nothing that licenses
deriving it from `users.role` + `users.is_organization_admin`. The only instrument that ever
addressed the inference is ATM-003-R3 §6, and it expressly declines to carry authority and asks
the OWNER to acknowledge it.

---

## 2. Conflict determination — reconcilable, so no STOP package

There is **no genuine conflict between approved ATM-003-R1 and the OWNER policy**, so this
mission did not have to ask for a ruling and did not pick a side:

* ATM-003-R1 §4 is satisfied by the corrected tree. The Tenant Administrator profile still
  exists, is still enumerated, and is still conferred on an administrator holding **no active
  grant** — by the approved `LEGACY_COMPATIBILITY` `admin` bundle (`src/config/capabilities.js`,
  `admin: [...]` including `org.user_admin` and `org.config_admin`), which is parity recorded in
  ATM-003-R3 and unchanged here. It is also reachable through an explicit grant.
* The OWNER policy is satisfied by narrowing exactly the one inference §4 does not authorise.
  Nothing an approved record *requires* was removed: no capability, role, profile or vocabulary,
  and no legacy bundle entry, changed.
* The strictest applicable rule governs. The pre-existing OWNER adjudication mode rule
  (`capability.service.js:11-28`) says the explicit-grant mode uses **only** those grants, and the
  R2/F3 exception was a self-carved deviation from it whose own record says it is unratified.
  Restoring the strict rule is the fail-closed direction and requires no new authority. Widening
  authority would require exactly the OWNER act that R3 §6 asked for and did not receive.

**The exception duty, discharged.** The R2/F3 exception was **proven? NO.** Its only recorded
basis (`ATM-003-R3:109-112, 178-180`) declares itself unauthorised pending OWNER acknowledgment.
It was therefore **reconciled, not silently discarded**: the removal is recorded in the two
source headers that used to assert it (`src/services/capability.service.js` and
`src/config/capabilities.js`), in the inverted test section, and in this file. This mission did
**not** classify the exception or split it — e.g. keeping `org.config_admin` while dropping
`org.user_admin` would have been a decision about which half of an unapproved exception
survives, which is not this worker's to make. The whole inference was removed, and the
consequence is stated in §8.

---

## 3. The correction — smallest fail-closed change

Core change: **in `EXPLICIT_GRANTS` mode the resolved capability set is exactly the active
explicit grants, and the resolver no longer reads `is_organization_admin` at all.** Nothing else
in the resolution contract changed.

```diff
diff --git a/src/config/capabilities.js b/src/config/capabilities.js
index 0acdd99..b61fc43 100644
--- a/src/config/capabilities.js
+++ b/src/config/capabilities.js
@@ -163,44 +163,42 @@ const LEGACY_COMPATIBILITY_BUNDLES = Object.freeze({
 });
 
 /**
- * Tenant-administrator compatibility preservation (ATM-001-SEC-104-R2 F3).
+ * The ATM-003-R1 §4 "Tenant Administrator" capability profile.
  *
- * The database records the tenant administrator as `users.role = 'admin'` with
- * `users.is_organization_admin = true` — the same flag the application already
- * uses to recognise an organization administrator
- * (src/middleware/tenant.js, src/routes/user.routes.js,
- * views/mobile/admin/users.ejs), and the flag that the administrative
- * organization-creation path sets on a tenant's first administrator. The public
- * self-service signup is INTENDED to set it too, but at this head it creates no
- * user at all (defect D-1: HTTP 500 after committing an orphan organization —
- * see src/routes/organization.routes.js and
- * tests/organization-signup.integration.test.js), so this comment does not claim
- * that it does.
+ * ATM-003-R1 §4 defines this launch profile as exactly `org.user_admin` +
+ * `org.config_admin` ("Tenancy administration is required to operate at all").
+ * §4 states profiles are "capability bundles, not job titles, and not database
+ * rows", and §8 states the record "does not implement permissions ... or define a
+ * grant schema". The profile is therefore a DESCRIPTION of an approved profile —
+ * never an inference rule, and never a database-row predicate.
  *
- * ATM-003-R1 §4 defines the **Tenant Administrator** launch profile as exactly
- * `org.user_admin` + `org.config_admin`, "required to operate at all". The
- * `admin` legacy bundle above already confers both on every un-granted
- * administrator, so this profile is not new authority.
+ * MISSION #106 (blocker B-1) — THE INFERENCE IS REMOVED. Until that mission the
+ * resolver ADDED this profile to any principal the database recorded as
+ * `role = 'admin'` AND `is_organization_admin = true`, in BOTH resolution modes
+ * (ATM-001-SEC-104-R2 finding F3, recorded in
+ * docs/architecture/ATM-003-R3-Compatibility-Parity-Register.md §6 as
+ * "RECORDED, awaiting OWNER acknowledgment ... carries no authority of its own").
  *
- * The preservation exists because the resolver's mode rule discards the legacy
- * bundle entirely once a principal holds any explicit grant. For an ordinary
- * administrator that narrowing is intended; for the tenant administrator it
- * silently removed the ability to administer the principal's own tenant as soon
- * as an unrelated grant was issued — a regression against pre-capability
- * behaviour (any administrator could edit its own organization profile). A
- * tenant administrator therefore keeps the R1 Tenant Administrator profile in
- * BOTH resolution modes.
+ * The OWNER policy recorded for #106 is: "`is_organization_admin` + an unrelated
+ * explicit grant must NOT by itself confer `org.user_admin`. Do not infer
+ * user-admin from arbitrary grants." Accordingly
+ * src/services/capability.service.js no longer reads `is_organization_admin` and
+ * adds nothing in EXPLICIT_GRANTS mode: there, the resolved set is exactly the
+ * active explicit grants.
  *
- * This is a compatibility key, not an authority of its own:
- *   * holding `is_organization_admin` grants NOTHING by itself — the principal
- *     must also hold `role = 'admin'`;
- *   * the preserved set is exactly the legacy `admin` bundle's
- *     organization-administration entries, so no capability is preserved that an
- *     un-granted administrator did not already hold;
- *   * it is TENANT-scoped authority only. `platform.admin`,
- *     `knowledge.taxonomy_admin` and `integration.service` stay unreachable, and
- *     tenant scope is still enforced separately by the routes'
- *     `requireOwnOrganization` predicate / tenant-exact writes.
+ * Where the profile IS conferred, unchanged:
+ *   * LEGACY_COMPATIBILITY mode — the `admin` bundle below already enumerates
+ *     both entries for an administrator holding NO active grant (parity,
+ *     ATM-003-R3); and
+ *   * an explicit `org.user_admin` / `org.config_admin` grant.
+ *
+ * These constants are retained as the approved profile's NAME so tests and
+ * future code can refer to it. No production module may derive the profile from
+ * `users.role` or `users.is_organization_admin`. There is no union, no
+ * per-capability fallback, `platform.admin` / `knowledge.taxonomy_admin` /
+ * `integration.service` stay unreachable, and no capability is added by this
+ * change.
+ * See docs/review-evidence/ATM-001-SEC-106-B1-RECONCILIATION.md.
  */
 const TENANT_ADMINISTRATOR_ROLE = 'admin';
 
diff --git a/src/services/capability.service.js b/src/services/capability.service.js
index ca9c500..4afa117 100644
--- a/src/services/capability.service.js
+++ b/src/services/capability.service.js
@@ -14,10 +14,7 @@
  *
  *   EXPLICIT_GRANTS       the principal has one or more active explicit grants.
  *                         ONLY those grants are used; capabilities derived from
- *                         users.role are added in NO case — except the single
- *                         tenant-administrator profile recorded below, which is
- *                         the legacy bundle's own organization-administration
- *                         entries and never a new capability.
+ *                         users.role are added in NO case.
  *
  *   LEGACY_COMPATIBILITY  the principal has no active explicit grant. The
  *                         deterministic legacy-role bundle applies.
@@ -27,18 +24,30 @@
  * legacy-derived capability they did not explicitly hold — that is the intended
  * behaviour, and it is what makes explicit grants authoritative.
  *
- * ── The single exception: the tenant administrator (ATM-001-SEC-104-R2 F3) ───
+ * ── REMOVED: the tenant-administrator exception (MISSION #106, blocker B-1) ──
  *
- * A principal the database records as role `admin` AND
- * `is_organization_admin = true` additionally keeps the ATM-003-R1 §4 Tenant
- * Administrator profile in BOTH modes. This is compatibility preservation of a
- * profile the `admin` legacy bundle already confers on every un-granted
- * administrator (VUDA finding F3: an unrelated grant silently stripped the
- * tenant administrator's ability to administer its own tenant). It is not a
- * union and not role-derived authority: it is exactly the one profile, one
- * principal shape, tenant-scoped, and it grants nothing to a principal that is
- * not the tenant administrator. See src/config/capabilities.js for the full
- * rationale and the properties that keep it bounded.
+ * Until this mission the resolver additionally ADDED the ATM-003-R1 §4 Tenant
+ * Administrator profile (`org.user_admin` + `org.config_admin`) for a principal
+ * the database recorded as role `admin` AND `is_organization_admin = true`, in
+ * BOTH modes. It was introduced as ATM-001-SEC-104-R2 finding F3 and recorded in
+ * docs/architecture/ATM-003-R3-Compatibility-Parity-Register.md §6 as
+ * "RECORDED, awaiting OWNER acknowledgment. This section carries no authority of
+ * its own and changes no rule by itself" — it was never an approved exception.
+ *
+ * The OWNER policy recorded for this mission is: "`is_organization_admin` + an
+ * unrelated explicit grant must NOT by itself confer `org.user_admin`. Do not
+ * infer user-admin from arbitrary grants." EXPLICIT_GRANTS mode therefore adds
+ * nothing: the resolved set is EXACTLY the active explicit grants, and this
+ * module no longer reads `is_organization_admin` at all.
+ *
+ * This does not conflict with ATM-003-R1 §4: §4 defines a PROFILE (a capability
+ * bundle) and says profiles are "not job titles, and not database rows", while §8
+ * states the record "does not implement permissions ... or define a grant schema"
+ * — so §4 names the profile but authorises no inference from `users.role` or
+ * `is_organization_admin`. The profile is still conferred, unchanged, by the
+ * LEGACY_COMPATIBILITY `admin` bundle for an administrator holding no grant, and
+ * by an explicit `org.user_admin` / `org.config_admin` grant.
+ * See docs/review-evidence/ATM-001-SEC-106-B1-RECONCILIATION.md.
  *
  * ── Fail-closed ─────────────────────────────────────────────────────────────
  *
@@ -54,8 +63,6 @@ const {
   RESOLUTION_MODES,
   LEGACY_COMPATIBILITY_BUNDLES,
   NON_HUMAN_GRANTABLE,
-  TENANT_ADMINISTRATOR_ROLE,
-  TENANT_ADMINISTRATOR_PROFILE,
   isGrantable
 } = require('../config/capabilities');
 
@@ -70,26 +77,6 @@ const REFUSAL_REASONS = Object.freeze({
 
 const refusal = (reason) => ({ mode: null, capabilities: new Set(), reason });
 
-/**
- * Apply the single documented exception to the mode rule.
- *
- * A tenant administrator — `users.role = 'admin'` AND
- * `users.is_organization_admin = true` — keeps the ATM-003-R1 §4 Tenant
- * Administrator profile (`org.user_admin`, `org.config_admin`) in BOTH modes.
- * See the rationale, and the reason this is a compatibility key rather than an
- * authority of its own, in src/config/capabilities.js.
- *
- * Nothing else is preserved: the returns above are the only two resolution
- * outcomes, and both pass through here, so the exception cannot be reached
- * without a database row that says this principal is the tenant administrator.
- */
-const withTenantAdministratorProfile = (capabilities, user) => {
-  if (user.role === TENANT_ADMINISTRATOR_ROLE && user.is_organization_admin === true) {
-    for (const capability of TENANT_ADMINISTRATOR_PROFILE) capabilities.add(capability);
-  }
-  return capabilities;
-};
-
 /**
  * Resolve the capabilities of an authenticated principal.
  *
@@ -115,7 +102,7 @@ async function resolveCapabilities(principal, options = {}) {
     // The principal is re-read from the database: authorization never trusts a
     // token payload, a header or a client-supplied identity.
     const rows = await conn.query(
-      `SELECT id, organization_id, role, is_active, is_organization_admin FROM users WHERE id = $1`,
+      `SELECT id, organization_id, role, is_active FROM users WHERE id = $1`,
       [Number(principal.id)]
     );
     const user = rows[0];
@@ -152,9 +139,11 @@ async function resolveCapabilities(principal, options = {}) {
     );
 
     if (explicit.size > 0) {
+      // EXPLICIT_GRANTS: the grants and NOTHING else. `is_organization_admin` is
+      // not read and users.role contributes no capability here (blocker B-1).
       return {
         mode: RESOLUTION_MODES.EXPLICIT_GRANTS,
-        capabilities: withTenantAdministratorProfile(explicit, user),
+        capabilities: explicit,
         reason: null
       };
     }
@@ -163,7 +152,7 @@ async function resolveCapabilities(principal, options = {}) {
     return {
       mode: RESOLUTION_MODES.LEGACY_COMPATIBILITY,
       // An unrecognised role resolves to nothing rather than to a default.
-      capabilities: withTenantAdministratorProfile(new Set(bundle ? [...bundle] : []), user),
+      capabilities: new Set(bundle ? [...bundle] : []),
       reason: null
     };
   } catch (error) {
```

Test-side changes (full text in the diff of the final commit):

| File | Change | Why it is the coherent conversion |
|---|---|---|
| `tests/organization-security-policies.test.js` (section I) | I1 inverted to assert the resolved set is **exactly** the grant; I3/I4 inverted to assert **403 + no write**, each paired with a POSITIVE CONTROL (the same administrator shape with **no grant**, i.e. legacy mode, still gets 200 **and the persisted write**); I5 re-worded; I2 gained the legacy-parity assertion; the file header records the correction | Section I previously pinned the forbidden behaviour (200 + write). It now pins the OWNER policy in both directions and keeps the legitimate tenant-administration path under test |
| `tests/atm-001-sec-106-b1-grant-authority.test.js` (new, 25 tests) | the full matrix, the mode TRANSITION, the real route effects and the adversarial reproducers | a separate, standalone-runnable evidence suite that fails if the inference is re-widened |
| `scripts/run-integration-tests.js`, `tests/database-test-guard.test.js` | the new suite is registered in the sanctioned contract and in both database-mutating/sanctioned lists | the repository's own guard requires the runner list and the contract list to agree exactly |

Why this is the **smallest** change: it touches one resolution branch and one row read; it adds
no capability, role, permission or vocabulary (`platform.admin` stays non-human-grantable,
`V1_HUMAN_GRANTABLE` is unchanged, the two resolution modes are unchanged); it changes no route,
guard, controller, middleware, schema or migration; and it removes authority rather than adding
it. The five red assertions are **GREEN by correction**, not by weakening: no assertion was
relaxed, skipped or made vacuous, and no test was converted from 200 to 403 to match the code.

---

## 4. Evidence — before / after

### 4.1 The pre-change red state (archived before any change)

The five red tests and their verbatim failure output are in
`ATM-001-SEC-106-B1-ORIGINAL-EVIDENCE.md` (commit `e7d2ade`, which predates every source and
test change on this branch), together with the direct resolver probe of the
authority-granting principal:

```text
PROBE principal: {"id":473,"username":"sec104-f3-admin-granted","role":"admin","is_organization_admin":true,"organization_id":159,"active_grants":"knowledge.author"}
PROBE mode: EXPLICIT_GRANTS reason: null
PROBE capabilities: ["knowledge.author","org.config_admin","org.user_admin"]
PROBE holds org.user_admin: true
PROBE holds org.config_admin: true
```

### 4.2 The corrected state

```text
PROBE principal: {"id":473,"username":"sec104-f3-admin-granted","role":"admin","is_organization_admin":true,"organization_id":159,"active_grants":"knowledge.author"}
PROBE mode: EXPLICIT_GRANTS reason: null
PROBE capabilities: ["knowledge.author"]
PROBE holds org.user_admin: false
PROBE holds org.config_admin: false
```

### 4.3 Exact test counts

| Command | Unmodified candidate `b0ce6b01` | Corrected tree | Notes |
|---|---|---|---|
| `npm ci` | 0 vulnerabilities | 0 vulnerabilities | — |
| `npm test` | **195 / 195 pass** | **198 / 198 pass** | +3 are the new suite's three `database-test-guard` rows; the suite itself contributes 0 ungated tests |
| `node --test tests/database-test-guard.test.js` | **128 / 128 pass** | **131 / 131 pass** | +3 = the new suite's zero-execution / fail-closed proofs |
| `npm run test:integration` | **968 tests, 962 pass, 6 fail** (5 × B-1 + 1 × pre-existing `m6r3-r1`) | **993 tests, 992 pass, 1 fail** | the single remaining failure is the known pre-existing `m6r3-r1-remediation` "own customer pack must be listed", unrelated to B-1 and out of scope |
| `node --test tests/atm-001-sec-106-b1-grant-authority.test.js` (own suite, standalone, run twice) | — | **25 / 25 pass both runs** | idempotent fixture verified by the second run |

The five B-1 tests are GREEN by correction (no assertion altered):

```text
✔ 8. an administrator holding an unrelated explicit grant does NOT hold org.user_admin
✔ 04. an administrator without org.user_admin cannot resend
✔ 20. an explicit grant WITHOUT org.user_admin does not authorize resend
✔ 22-25. refusals create no row, issue no token, cancel nothing and deliver nothing
✔ R1-07. a principal without org.user_admin cannot resend any role
```

### 4.4 Positive and negative database effects actually asserted

The new suite asserts real persisted state, never a status code alone:

* REFUSED (403) and read back unchanged: `GET /api/invitations` (no row, no token anywhere in the
  serialised body), `DELETE /api/invitations/:id` (row still `pending`),
  `POST /api/invitations/:id/resend` (no replacement row, original still `pending`, nothing
  delivered), `PUT /api/organizations/:id` (`billing_address` unchanged).
* ADMITTED and read back changed: `GET` (returned ids equal the tenant's rows exactly), `DELETE`
  (row really moves `pending` → `cancelled`), `resend` (exactly one replacement row persisted
  with the stored role, predecessor retired `cancelled`), `PUT` (marker persisted), and
  `POST /api/invitations` (the unchanged legacy-guarded creation still persists a row).
* Resolver matrix over real rows: `is_organization_admin` true/false × grants present/absent ×
  `role` admin/other, plus the sibling case — an explicit `org.config_admin` confers **nothing
  else**, and an explicit `org.user_admin` does **not** drag in `org.config_admin`.
* The TRANSITION: legacy (holds the R1 profile) → issue one unrelated grant (explicit mode,
  profile GONE) → revoke it (legacy again, profile back).

---

## 5. Mutations (re-apply the old behaviour → the suite goes RED)

```bash
git checkout e7d2ade -- src/services/capability.service.js   # old withTenantAdministratorProfile
node --test tests/atm-001-sec-106-b1-grant-authority.test.js # with the sanctioned gate
```

Result: **11 pass / 14 fail** in the new suite — the old behaviour is caught by the structural
pin and by 13 behavioural cases:

```text
✖ A1. the resolver reads no is_organization_admin and adds no profile (1.369583ms)
✖ B1. role=admin + flag=true + UNRELATED grant confers ONLY that grant (9.291291ms)
✖ B4. an EXPLICIT org.user_admin grant IS preserved, and drags nothing with it (1.418375ms)
✖ B5. an explicit org.config_admin grant confers NOTHING else (sibling non-inference) (1.462833ms)
✖ C1. legacy -> explicit -> revoked -> legacy, with the authority following each time (6.249375ms)
✖ D1. GET /api/invitations: the flagged granted administrator is refused and sees no row (27.891375ms)
✖ D3. POST resend: the flagged granted administrator is refused and NO row is written (9.846292ms)
✖ D5. POST resend: an explicit org.config_admin holder is refused (no sibling inference) (8.056792ms)
✖ D6. DELETE /api/invitations/:id: refused for the flagged granted administrator, with no state change (7.199708ms)
✖ D9. PUT /api/organizations/:id is refused for the flagged granted administrator, with no write (7.780542ms)
✖ E1. EVERY org.user_admin-gated route refuses the exact B-1 principal and mutates nothing (10.04075ms)
✖ E2. the schema is a second independent gate: an unknown or non-grantable row cannot exist (3.476375ms)
✖ E3. users.role is schema-constrained, so no unrecognised role can be reached (8.4625ms)
✖ F1. every fixture grant is a real, active, tenant-scoped, attributed row (5.778541ms)
```

The inverted section I catches it independently — **76 pass / 3 fail**:

```text
✖ I1. resolves EXACTLY the explicit grant for the flagged administrator, and no R1 profile (7.162875ms)
✖ I3. REFUSES the granted flagged administrator its own organization profile, and writes nothing (10.91175ms)
✖ I4. REFUSES the granted flagged administrator the logo route and writes nothing (8.897625ms)
```

The mutation was reverted immediately (`src/services/capability.service.js` restored
byte-identical to the fixed version; `withTenantAdministratorProfile` appears 0 times).

---

## 6. Adversarial reproducers an independent reviewer can run

```bash
# 0. disposable cluster only: /tmp/atiman104-pg on 127.0.0.1:55435
#    NEVER set JWT_SECRET in the environment (the in-suite test constant is used).
git worktree add /tmp/b1-review atm-001-sec-106-b1-grant-authority
cd /tmp/b1-review && npm ci

# 1. the 25-test authority suite, standalone (the anti-re-widening reproducer)
NODE_ENV=test RUN_DB_TESTS=true TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55435 \
  TEST_DB_NAME=atiman_test TEST_DB_USER=agadmin TEST_DB_PASSWORD='<TEST_DB_PASSWORD>' \
  node --test tests/atm-001-sec-106-b1-grant-authority.test.js

# 2. the five previously-red B-1 assertions
NODE_ENV=test RUN_DB_TESTS=true TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55435 \
  TEST_DB_NAME=atiman_test TEST_DB_USER=agadmin TEST_DB_PASSWORD='<TEST_DB_PASSWORD>' \
  node --test tests/invitation-resend-authorization.test.js tests/invitation-list-authorization.test.js

# 3. re-widen the inference and watch the suite go RED
git checkout e7d2ade -- src/services/capability.service.js
# ... re-run (1) -> 14 failures; then: git checkout HEAD -- src/services/capability.service.js
```

`E1` is the direct reproducer: it drives **every** `org.user_admin`-gated route against the exact
principal shape (`role='admin'` **and** `is_organization_admin=true` **and** one unrelated active
grant) and requires 403 **with no state change**; if anyone re-widens the inference, those routes
answer 200 and the test fails.

---

## 7. Fixture residue (disposable database only)

Migration 022 makes a capability grant a permanent, attributed record (`DELETE` raises by
trigger), and `users.id` references it, so a granted user cannot be deleted either. The new suite
therefore builds ONE stable, idempotent fixture set — `sec106-b1-*` users in the
`ATM-001-SEC-106-B1 Tenant` organization, one stable plan and subscription, and one active grant
per granted principal (6) — and reuses it. The transition case adds **one REVOKED grant row per
run** by design, because revocation is the only mutation migration 022 permits. No production or
shared database is touched: the suite is gated on `isIntegrationTest()` and
`tests/database-test-guard.test.js` proves it executes **zero** tests without the sanctioned gate.

---

## 8. Remaining release blockers and limitations

1. **The R2/F3 compatibility restoration is now GONE by this change.** If the OWNER intends the
   ATM-003-R1 §4 Tenant Administrator profile to be auto-conferred on the `role='admin'` +
   `is_organization_admin=true` row shape, that requires an explicit OWNER act ratifying
   ATM-003-R3 §6 (or a new bounded mission). This mission did **not** assume it and did not decide
   it. Until then, such a principal needs an explicit `org.user_admin` / `org.config_admin` grant.
2. **Owner-visible consequence, stated honestly:** a tenant administrator that receives one
   unrelated grant loses profile/logo administration until it is granted `org.config_admin` (and
   loses invitation/user administration until granted `org.user_admin`). That is the fail-closed
   outcome of the OWNER policy for `org.user_admin`, and the fail-closed reading for its sibling.
   It is a behaviour change for that principal shape and belongs in the release notes.
3. **The pre-existing `m6r3-r1-remediation` failure remains** ("own customer pack must be listed").
   Out of scope, untouched, and it is why `npm run test:integration` still exits non-zero with 1
   failure.
4. **Label collision (evidence hygiene):** the B3-A register's own **"B-1"** is the #93/D-1
   retirement-mechanism merge (`docs/ATM-001-SEC-B3-OWNER-DECISION-REGISTER.md` §6.2/§7), not this
   capability-authority blocker. Its twelve requested decisions were retrieved for this mission
   and none is decided here.
5. **Not verified:** no independent review has been performed on this branch. The reported
   "independent PASS" statuses of #104-R2 and Bundle 2 B are quoted from the mission and the B3-D
   record; their primary artefacts are not in this repository (B3-A §2.3).
6. **No production/shared database was contacted.** All effects were produced against the
   disposable cluster on port 55435 only.

---

## 9. Non-approval statement

I did not self-approve. I did not ratify, approve, verify, merge, deploy or publish anything. I
decided no policy: the change applies the OWNER policy already recorded and the pre-existing OWNER
adjudication mode rule, and I did **not** classify or split the ATM-003-R3 §6 exception. No
`OWNER-RATIFIED:` line is written here or in any file changed by this mission. No Arena verdict is
claimed. Merge and deploy remain OWNER acts, and this branch requires an explicit independent
verdict before integration.

*Record identity at filing: this file is committed BY the correction commit, so the branch head
that carries it is resolved as `git log -1 --format='%H %T'` on
`atm-001-sec-106-b1-grant-authority`. The pre-change archive is commit `e7d2ade` (tree
`123e8aae`), which contains no source or test change and predates every change below.*
