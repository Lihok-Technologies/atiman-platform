# ATM-001-SEC-107-R1-CORRECTION — closure of the four Arena conditions

> **REVIEW-ONLY HANDOFF. NOT SELF-APPROVED.** Authored by the **implementing** agent. This is not
> its own review and confers no approval. No `OWNER-RATIFIED:` line exists here and none may be
> inferred. No merge to `main`, no deploy, no production database access.
>
> **ARENA VERDICT: NOT OBSERVED BY THE AUTHOR OF THIS DOCUMENT, AND NONE IS CLAIMED.** No Arena
> verdict for the final-evidence tree is asserted anywhere in this file. Two **outstanding Arena
> conditions** on this correction were **relayed verbatim in the final-evidence mission brief** and
> are reproduced with their disposition in **§13**; the author did **not** directly observe the
> Arena verdict artefact and states that plainly rather than inferring a verdict. Nothing here may
> be read as an independent PASS or as self-approval. An independent Arena **re-review of both
> conditions** is requested in §12.

**Mission:** ATM-001-SEC-107-R1-CORRECTION-CLOSURE — close the four Arena conditions on Mission
#107. **Issues:** #107 (parent #105, umbrella #97); the accepted #102 assertion is restored.
**Frozen `main`:** `f156aa4479efe783eefd4f13fd62171647f83b7f` — untouched; no branch, ref or
worktree of `main` was modified.

---

## 1. Artefact identity

Every value below was produced by `git rev-parse` (never an assumed abbreviation).

| Item | Value |
|---|---|
| **Corrected commit** | `1190a007ffa52e1ce6b231b7ff1cc1d527fef05f` |
| **Corrected tree** | `b5247cd3c9ee23682fee4cfbf16f7e805f96d17b` |
| Branch (the non-main DRAFT PR artefact) | `atm-001-sec-107-r1-correction-closure` |
| Reviewed candidate (base of this branch) | `f03a4f63b588b662ee4819820e40818d8dbe2a4a` / tree `3afb7e2c4a346ddd3fc3cea6b2e0d483a0be0f3a` |
| Its base (tested code tree) | `2cd999a965019b450ae1cc5235fc619b8c3860cd` / tree `0dcf749dca0bdf511680859ac7205bd9494cf7d9` |
| Integrated branch tip verified | `5fa3beb95f10d6dc9e68c69bca2ebcac9364fbb6` / tree `0d2c5da08025750a487cb654d98319c8001b6bff` |
| Frozen `main` | `f156aa4479efe783eefd4f13fd62171647f83b7f` / tree `fd1aa33a49e1678890cbaa377be35453d0185634` |

All five identities were verified and **matched the mission baseline exactly**; no STOP condition
was triggered. A commit cannot contain its own SHA, so the **final published tip and remote SHA**
are reported in the mission handoff, not inside this file.

The correction diff against the reviewed candidate is filed alongside this document as
`ATM-001-SEC-107-R1-CORRECTION.diff` (`git diff f03a4f6 HEAD`, 1012 lines).

`git diff --stat 2cd999a f03a4f6` (the reviewed candidate's own diff, inspected **before** editing)
= exactly 5 files: `src/middleware/rbac.js` (+48), `src/routes/user.routes.js` (+13/-…),
`tests/user-authorization-reconciliation.test.js` (+61/-…), `tests/user-credential-disclosure.test.js`
(+183/-…), `docs/review-evidence/ATM-001-SEC-107-R1-OWN-PROFILE-EVIDENCE.md` (+79). No unexpected
file.

---

## 2. The OWNER ruling implemented

> The OWNER approved the capability to view one's own sanitized profile, and **that approval did
> NOT authorize bypassing the administrative `GET /api/users/:id` permission gate.**

Required behaviour, implemented exactly:

- **A.** `GET /api/auth/profile` — an authenticated **operator** viewing its own profile returns
  **HTTP 200** with safe profile information only; never `password_hash`, credentials,
  authentication tokens or sensitive internals.
- **B.** `GET /api/users/:id` — an operator **without `USERS.VIEW`** returns **HTTP 403, including
  when requesting its own ID**. The Mission #107 carve-out `requireUsersViewUnlessOwnRecord` is
  **REMOVED**.
- **C.** All existing cross-tenant restrictions and non-disclosure preserved.
- **D.** Authorized administrator access preserved (admin own/same-tenant 200, foreign 404, list).
- **E.** **No new capability.** `USERS.VIEW` remains `{ admin: 'all', supervisor: 'all',
  operator: 'none' }`; `src/config/permissions.js` is byte-identical to the base.

This is Arena's alternative **(b)**. Arena's crux ruling — that the R-1 policy text names no route,
that `GET /api/auth/profile` already satisfied it on the pristine base, and that the `(a)`/`(b)`
choice was a governance-relevant interpretation the implementer was not authorized to self-resolve —
was **correct**.

**No architectural conflict was found**, so the mission's STOP condition was not triggered:
`docs/architecture/ATM-003-R1-Role-Capability-Architecture.md` §7 assigns *identity* to
Authentication and *capability grants / tenant scope* to Authorization, which is exactly the
`/api/auth/profile` (identity) vs `/api/users/:id` (administrative, `USERS.VIEW`-gated) split;
§8 states the record "does not implement permissions" and adds no capability. Issue #107 itself
directs "Verify existing self-profile endpoint(s) … choose the smallest correct implementation; no
extra route or capability without need."

---

## 3. The four Arena conditions — disposition

Arena's verbatim verdict (HEAD `f03a4f6` / tree `3afb7e2c…`) was **CONDITIONAL**, with four
conditions. Each is mapped to its disposition and evidence.

| # | Arena condition (verbatim) | Disposition | Evidence |
|---|---|---|---|
| 1 | "Obtain explicit OWNER ratification of (a) on `/api/users/:id`, **or** rework to (b) (leave 403; `/api/auth/profile` sole path) and restore the #102 assertion — the implementer was not authorized to self-resolve this." | **CLOSED — option (b) implemented.** Carve-out removed; route re-gated by `requirePermission('USERS','VIEW')`; #102 case 7 restored to 403. | §4.1, §4.2; mutation **M4** (carve-out re-added) → 12 RED including #102 case 7 and B3-B case 7 |
| 2 | "Correct the overstated sanitizer-coverage claim (M1 stays green via the pre-existing backstop)." | **CLOSED — corrected AND made non-vacuous.** Handler projection is now an explicit ALLOW-LIST; mutation **M1 is DETECTED**. | §5; mutation **M1** → RED (B3-B case 8) |
| 3 | "Correct claim 5's case-13 attribution." | **CLOSED — provenance restated (see §5.4 and §13.1).** The case-13 attribution appeared in **no repository document**: `git grep -n "case 13" f03a4f6 -- docs src tests` returns **no match**, and §5 of the #107 evidence doc lists only cases **3, 4, 5, 6, 12 and 12b**. It originated in the **unversioned mission/handoff prose** supplied by a parent agent, and is corrected here as prose — **no repository document is alleged to contain it**. Case 13 remains a 404 absorber using `ADMIN_A`, unchanged by R-1. | §5.4; §13.1 |
| 4 | "Correct Correction B's scope framing; the two baseline flakes are not R-1's." | **CLOSED.** The "1012/1014" figure was **integration-scope**; this correction reports integration-scope and full-`npm-test`-scope numbers **separately** and labels them. The two baseline flakes (B3-B test 13 racy global `count(*)`; `onboarding-atomicity` D4 race) are **not R-1's** and are not claimed as fixed. | §6 (both scopes, per group) |

---

## 4. Actual code changes

Diffstat `git diff f03a4f6 HEAD`: **8 files, +638 / −165** (5 source/test files changed, 2 added,
1 evidence doc superseded in a later commit). `git diff --stat 2cd999a HEAD -- src tests` =
**8 files, +763 / −51**.

### 4.1 Task 1 — the carve-out that had to be removed (quoted from the ACTUAL diff)

`git diff 2cd999a f03a4f6` showed one new route-local middleware and its **single** use. The
definition (now deleted) was:

```js
const requireUsersViewUnlessOwnRecord = (req, res, next) => {
  const targetUserId = parseUserIdParam(req.params.id);

  if (targetUserId !== null
      && req.user
      && Number(req.user.id) === targetUserId) {
    return next();
  }

  return requirePermission('USERS', 'VIEW')(req, res, next);
};
```

and its **only** use:

```js
-router.get('/:id', requirePermission('USERS', 'VIEW'), canViewUser, async (req, res, next) => {
+router.get('/:id', requireUsersViewUnlessOwnRecord, canViewUser, async (req, res, next) => {
```

`grep -rn requireUsersViewUnlessOwnRecord src/` confirms **exactly one route** used it (plus the
definition and the single re-export). **It is now removed cleanly, with no dead code**: the
definition, the re-export, and the route reference are gone; the module-load and structural check
in `tests/user-profile-projection.test.js` case **4a** asserts the helper is not exported, not
defined, and not referenced outside comments, and that the route is again
`router.get('/:id', requirePermission('USERS', 'VIEW'), canViewUser, …)`.

### 4.2 The gate restored

```js
router.get('/:id', requirePermission('USERS', 'VIEW'), canViewUser, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: { user: projectUserProfile(req.targetUser) }
    });
  } catch (error) {
    next(error);
  }
});
```

`src/middleware/rbac.js` now carries a comment block where the helper was, recording that the
carve-out was tried and why it was reverted — the history is documented, not erased.

### 4.3 Task 5 — the allow-list projection (the M1 fix)

New in `src/utils/helpers.js`:

```js
const USER_PROFILE_FIELDS = Object.freeze([
  'id', 'username', 'email', 'full_name', 'phone',
  'role', 'facility_id', 'organization_id',
  'is_active', 'status', 'is_organization_admin',
  'last_login', 'created_at', 'updated_at',
  'organization_name', 'subscription_plan', 'subscription_status'
]);

const projectUserProfile = (row) => {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return row;
  const projected = {};
  for (const field of USER_PROFILE_FIELDS) {
    if (isSensitiveField(field)) continue;                 // the list can never be widened into a leak
    if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
    projected[field] = row[field];
  }
  return projected;
};
```

Used by `GET /api/users/:id` (`src/routes/user.routes.js`) and `GET /api/auth/profile`
(`getProfile` in `src/controllers/auth.controller.js`).

**Why this detects M1:** the `users` table has **21** columns (verified against the disposable
PostgreSQL cluster). The allow-list serves **14** base columns; six internal columns are
deliberately withheld (`invited_by`, `invited_at`, `is_billable`, `is_sso_user`, `sso_provider`,
`last_sso_login_at`). A raw row behind the router backstop yields **20** keys (21 − `password_hash`),
so the response **shape** differs and the assertion `Object.keys(user).sort() === allow-list` fails.
`tests/user-profile-projection.test.js` case **2a** states this mechanism as a proof:
`projectedKeys.length < m1Keys.length` and `projectedKeys ≠ m1Keys`.

`GET /api/auth/profile` is the R-1 operator path and — importantly — `src/routes/auth.routes.js`
installs **no** router-level backstop, so the handler projection there is the **only** protection.
A raw-row bypass on that path leaks `password_hash` for real, and case 7b detects it twice
(credential presence **and** shape).

### 4.4 The router-level backstop preserved and made testable

The pre-existing backstop was extracted **unchanged** from an anonymous inline closure in
`src/routes/user.routes.js` into a named module `src/middleware/sensitive-response.js`
(`sensitiveResponseGuard`), and is still installed via `router.use(sensitiveResponseGuard);`.
No protection was weakened: `sanitizeUser` / `redactSensitiveFields` / `isSensitiveField` are
untouched and still used by the list, facility-listing, create and update handlers.

### 4.5 Unrelated authorization rules not altered

`git diff 2cd999a HEAD -- src/config/permissions.js src/middleware/auth.js src/config/auth.js
package.json .github` is **empty**. No route was added. No capability was granted.

---

## 5. Non-vacuous handler-level proof (Arena condition 2, task 5)

### 5.1 The defect Arena found

Arena mutation **M1** — `GET /api/users/:id` returning the RAW row while the router backstop stayed
intact — left cases 7, 7b, 7c, 8, 9, 10 **ALL GREEN**, because `sanitizeUser ≡ redactSensitiveFields`
and the backstop applied the identical function to the whole body, producing **byte-identical**
output. The #107 cases proved *no credential reaches the wire*; they could **not** attribute
protection to the handler projection.

### 5.2 The mutation matrix (reproduced on the corrected tree)

Harness: mutate the committed corrected tree in place, run the three relevant suites, restore from
HEAD (`git status` verified clean afterwards). Suites: `user-profile-projection` (8),
`user-credential-disclosure` (23), `user-authorization-reconciliation` (38) = **69 tests**.

| Mutation | Exact change | Result | Failing (RED witness) tests |
|---|---|---|---|
| **baseline** | none | **69/69 pass** | — |
| **M1** (Arena's M1) | `data: { user: projectUserProfile(req.targetUser) }` → `data: { user: req.targetUser }` in `user.routes.js` (**backstop intact**) | **RED**, 1 fail | **B3-B case 8** `an administrator reading an own-tenant operator gets the EXACT allow-list projection (M1 witness)` — `AssertionError: the served user must equal the documented allow-list EXACTLY`; diff shows extra `invited_at`, `invited_by`, `is_billable`, … |
| **M1b** | `getProfile`: `projectUserProfile(user)` → `user` | **RED**, 3 fails | **#102 case 7**, **B3-B case 7b**, **B3-B case 7c**. 7b fails on `the own-profile path must be sanitized` and on `response body must carry no bcrypt hash` — the raw row **really does** put `password_hash` on the wire on this backstop-less route |
| **M2** | `router.use(sensitiveResponseGuard);` → `/* disabled */` (**handler projection intact**) | **RED**, 1 fail | **projection case 3a** `the users router installs sensitiveResponseGuard, and the installed guard redacts a raw row` |
| **M3** (Arena's M3: both layers off) | M1 + M2 | **RED**, 3 fails | **#102 case 29** `the response never carries credential material`, **B3-B case 8**, **projection case 3a** |
| **M4** | restore the #107 carve-out: `requirePermission('USERS','VIEW')` → `(req,res,next)=>next()` on `GET /:id` | **RED**, 12 fails | **#102 case 7**, **B3-B case 7**, 7c, cases **3/12/12b** (the operator now reaches the handler for every identifier) and **projection case 4a** |
| **M5** | revert the projection to the deny-list: `projectUserProfile(req.targetUser)` → `sanitizeUser(req.targetUser)` | **RED**, 1 fail | **B3-B case 8** — confirms the **allow-list**, not the deny-list, is what makes M1 detectable |

**Requirement 5(a) — M1 is DETECTED:** M1 → 1 RED, `user-credential-disclosure.test.js` case 8.
**Requirement 5(b) — router-level protection is functional and its removal is caught:** M2 → RED,
`user-profile-projection.test.js` case 3a (the guard is located in the **real** users-router stack
and driven directly, so removing its installation is a failure, and a neutered guard body is also a
failure; case 3b additionally drives it over real HTTP via an Express app).
**Requirement 5(c) — sensitive data never reaches the client in the shipped state:** the baseline
run has **zero** bcrypt-shaped values anywhere; every 200 case asserts `assertNoCredential` plus
shape; the two authorized 200 cases are 7b and 8, and 9/10 assert the list/facility listings.

### 5.3 Honest limitation (a finding, not a claim)

On the **users** router the backstop is pure defence-in-depth and has **no individually-observable
success path**: every handler with a credential-bearing payload already projects explicitly
(`projectUserProfile`, `sanitizeUser`, or `redactSensitiveFields`), and error bodies carry no
credential. A mutation that removes **only** the backstop therefore cannot be detected by a
credential-leak assertion on that router — which is why its **function** is pinned directly
(case 3a/3b) and its **installation** is pinned in the real router stack (case 3a). This is stated
plainly rather than papered over by a test that merely restates the source.

### 5.4 Task 5 — case 13 attribution: corrected provenance (restated)

**Provenance, stated plainly (Arena condition 3).** The claim that "§5 attributed case 13 to
`assertDeniedBeforeProjection`" was **not sourced from a repository document**. It came from
**earlier mission/handoff prose** — text supplied to the implementing agent by a parent agent. That
prose is a conversational artefact: it is **not repository content, is not version-controlled, and
exists at no commit**, so it cannot be cited to a file, a line or a SHA.

What the repository actually contains, verified on the reviewed artefact:

```
$ git grep -n "case 13" f03a4f63b588b662ee4819820e40818d8dbe2a4a -- docs src tests
(no output; exit 1)

$ git grep -in "case 13\|case-13\|case13" f03a4f63b588b662ee4819820e40818d8dbe2a4a
(no output; exit 1)
```

The string "case 13" appears **nowhere** in `docs`, `src` or `tests` at `f03a4f6`, and nowhere else
in that tree. §5 of `ATM-001-SEC-107-R1-OWN-PROFILE-EVIDENCE.md` at `f03a4f6` lists the converted
cases as **"3, 4, 5, 6, 12 and 12b"**, and attributes **none** of them — and no case 13 — to
`assertDeniedBeforeProjection`. Its only mention of that helper is the sentence "They are now
asserted with `assertDeniedBeforeProjection`", whose subject is precisely that list of six.

**This section therefore corrects the handoff prose, not a repository document.** No repository
document is alleged to contain the case-13 attribution. The earlier wording that said the #107
evidence doc's §5 made that attribution — and the superseding banner that echoed it — have been
removed in the final-evidence closure commit. This is the §13.1 disposition of Arena condition 3.

**Case 13's verified behaviour is untouched and was never in question.** Case 13 (an absent
identifier answers 404 and creates no row) uses `ADMIN_A`, asserts **404**, is unchanged from the
base `2cd999a`, and was **never converted** to `assertDeniedBeforeProjection`. Neither the test nor
its assertion was altered by this closure (documentation-only diff — §13.3).

The cases actually converted to `assertDeniedBeforeProjection` are **3, 4, 5, 6, 12 and 12b**
(operator/foreign/malformed denials), and the deny-only cases now assert an exact status **and** that
no `data.user` projection was produced — so "blocked before projection" can never again be credited
to the sanitizer.

---

## 6. Validation matrix (each group separately)

Environment for every database-touching group: disposable PostgreSQL cluster at
`/tmp/atiman104-pg`, **port 55435** (`nc -z 127.0.0.1 55435` → open; started with
`pg_ctl -D /tmp/atiman104-pg -o "-p 55435 -c listen_addresses=127.0.0.1"`).
`TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55435 TEST_DB_NAME=atiman_test TEST_DB_USER=agadmin`, and the
**`TEST_DB_PASSWORD`** environment variable — **value not recorded in this document** (referenced by
credential **name only**; see §13.2 for the exposure assessment and the escalation to the OWNER),
with `NODE_ENV=test`, `RUN_DB_TESTS=true`. The JWT secret was read
from `src/config/auth.js`; **`JWT_SECRET` was never set** (`unset JWT_SECRET` in every run).
Node `v26.8.2`, npm `11.19.1`. **Port 5432 was never touched; no shared or production database was
contacted.**

| # | Group / exact command | Result | Notes |
|---|---|---|---|
| 1 | `npm ci` | **exit 0** | clean install in a fresh worktree, no `node_modules` carried over |
| 2 | `npm audit --omit=dev` | **exit 0 — found 0 vulnerabilities** | production dependencies only |
| 3 | `npm test` (**no** DB gate) | **229 tests / 75 suites / 229 pass / 0 fail / 0 cancelled** | DB-mutating suites are correctly skipped (`﹣ … # requires the sanctioned database-test gate`); this is the non-destructive contract |
| 4 | `npm test` (**with** the DB gate, the scope the reference figures use) | **1608 tests / 1485 pass / 1 fail / 122 cancelled / 0 skipped** | vs the HEAD reference 1600/1477/1/122: **+8 tests, +8 pass** = exactly the new `user-profile-projection.test.js`; the single fail and the 122 cancelled are unchanged |
| 5 | `node --test tests/database-test-guard.test.js` | **134 tests / 134 pass / 0 fail** | the database safety guard, run exactly as specified |
| 6 | `npm run test:integration` (sanctioned) | **241/241 pass (group 1)** then **1016 tests / 1015 pass / 1 fail**, exit 1 | matches the HEAD reference 241/241 + 1016/1015/1 **exactly** |
| 7 | disposable-PostgreSQL security suites (subset of #6, per file) | `user-credential-disclosure.test.js` **23/23**; `user-authorization-reconciliation.test.js` **38/38**; `user-profile-projection.test.js` **8/8** | plus, in #6: `ATM-003 capability grants (migration 022)` ✔, `ATM-001-SEC-106 B-1 capability-grant authority` ✔, `ATM-001-SEC-93 invitation security residuals` ✔, `SEC-00E/00G/00H` ✔, `SEC-104 V1 organization security policies` ✔, `SEC-104-R3` ✔, `D-1 onboarding` ✔ |
| 8 | authorization/projection mutation tests | **baseline 69/69 pass**; M1 **RED**; M1b **RED**; M2 **RED**; M3 **RED**; M4 **RED**; M5 **RED** | §5.2 |

**The SOLE red in groups 4 and 6 is the pre-existing
`tests/m6r3-r1-remediation.test.js` test "lists own and shared packs but never a foreign customer
pack" (`AssertionError: own customer pack must be listed`).** Nothing was hidden, skipped or
re-scoped.

### 6.1 Provenance of the sole red (proved, not assumed)

Run on the **pristine base** `2cd999a` (detached worktree `/private/tmp/atiman-r1-before`,
`git rev-parse HEAD` → `2cd999a965019b450ae1cc5235fc619b8c3860cd`) with the same gate:

```
node --test tests/m6r3-r1-remediation.test.js
→ ℹ tests 25  ℹ pass 24  ℹ fail 1
✖ lists own and shared packs but never a foreign customer pack
  AssertionError [ERR_ASSERTION]: own customer pack must be listed
    at tests/m6r3-r1-remediation.test.js:358
```

The corrected tree fails **identically at the same line with the same message**. Cause (unchanged
by this mission): the suite's listing assertion is scoped by an accumulated `knowledge_packs` count
against `limit: '500'` and the shared disposable database has accumulated enough packs that the
fixture pack is not returned. **Provenance: pre-existing, not introduced by this correction or by
#107.**

### 6.2 Baseline flakes explicitly NOT claimed as fixed

- **B3-B (old) test 13** — racy global `SELECT count(*) FROM users`. In the #107-era tree this was
  flaky on the base *sanctioned integration* run. It is **not R-1's** and is not claimed fixed.
- **`onboarding-atomicity` D4** race — likewise **not R-1's**.
- The **122 cancelled** are exactly the five legacy `step6-*` suites (their `before` hook fails on
  superseded architecture), identical before and after; under the sanctioned runner they are
  excluded, under `npm test` they are included-and-cancelled.

### 6.3 Correction B — scope framing (Arena condition 4)

The reference "1012/1014" figure was **integration-scope**, and it did reproduce. The #107
implementer substituted full-`npm test`-scope numbers **without flagging the scope change**. That
was a measurement mismatch, not a refutation — their after-numbers reproduce exactly. This document
therefore labels **every** group with its scope, and reports both scopes separately (group 4 =
full `npm test`; group 6 = sanctioned integration).

---

## 7. Database verification evidence

- Identity: `TEST_DB_NAME=atiman_test`, port **55435**, user `agadmin`. Never 5432, never a shared
  or production host. The runner scrubs all libpq/`DB_*` variables and refuses to start unless
  `TEST_DB_NAME` clearly identifies a test database.
- `users` schema verified live: **21 columns**, including `password_hash` and the six withheld
  internals — the factual basis for the allow-list being a strict subset.
- `organizations` verified live to carry `organization_name`, `subscription_plan`,
  `subscription_status` — the join columns the profile allow-list covers.
- **Migration 022 residue (documented, not cleaned):** grants are undeletable by design. Accumulated
  residue in `atiman_test` after these runs: `user_capabilities` **1251**, `users` **3379**,
  `organizations` **509**, `facilities` **1419** rows. A stray disposable database
  `atiman_m5r4b2_test_34376_1` (17 MB, owner `agadmin`) also remains from an **earlier** M5R.4B2
  run; this mission did not create it and did not delete it. Cleaning residue is **out of scope**
  and is left to the disposable-cluster owner.
- Row-effect assertions are carried by the suites themselves (own-record read non-effect; refused
  read non-effect; PUT rotation coherence; absent-identifier creates no row; cross-tenant DELETE
  removes nothing). No credential value was printed by any run; the suites' `redacted()` masks
  bcrypt hashes, JWTs and long opaque secrets at the assertion-message boundary.

---

## 8. Test-history preservation (no evidence erased)

- `tests/user-authorization-reconciliation.test.js` case 7: the **accepted #102 assertion is
  restored** (403 for an operator requesting its own `/api/users/:id`). The superseded #107
  `200` assertion is **quoted verbatim in a comment**, together with the reason it was reverted.
- `tests/user-credential-disclosure.test.js` case 7: the same call now asserts **403** (option (b)),
  with the superseded #107 `200` assertion and its reasoning **quoted verbatim in a comment**.
- Case 7b/7c/8: corrected to approved behaviour; the superseded shape assertion is preserved.
- Arena's own mutation definitions, the CONFIRMED findings, and the `(a)`-vs-`(b)` crux are recorded
  here so the reasoning survives the reversal.

---

## 9. Remaining blockers (preserved OPEN, deliberately untouched)

1. **Seven unresolved onboarding policy questions** — still OPEN.
2. **CI plan / ruleset Reserved Matter** (ATM-001-SEC-103 B3-C) — still OPEN; no org or ruleset
   change was made.
3. **M8 resend mutation control** — **not authored** here; remains OPEN in its own bounded
   workstream.
4. **Reviewer-evidence deficiencies** — the B3-B/B3-A evidence gaps recorded in the integration
   evidence remain OPEN.
5. **Pre-existing m6r3-r1 red** — pre-existing, proven above, **not** this mission's to fix.
6. **Disposable-cluster residue** (migration-022-undeletable grants + one stray DB) — documented,
   not cleaned.

---

## 10. Was anything else changed?

**No.** No business logic outside the R-1 authorization/sanitization boundary was touched; no
migration, no dependency change, no CI/org/deploy configuration, no `main` ref. `package.json`,
`src/config/permissions.js`, `src/config/auth.js`, `src/middleware/auth.js` and `.github/` are
unchanged versus the tested base.

---

## 11. What could NOT be verified here

- The exact OWNER approval wording for R-1 (whether it names `/api/users/:id`). The ruling as
  relayed in the mission is what was implemented; the crux turns on that wording.
- CI execution of any kind.
- Long-run flake stability of the two named baseline flakes.

---

## 12. Independent Arena review-only request (Arena verdict not observed by the author)

**Arena has not reviewed this tree.** The corrected commit `1190a007ffa52e1ce6b231b7ff1cc1d527fef05f`
/ tree `b5247cd3c9ee23682fee4cfbf16f7e805f96d17b` is offered for a **review-only** pass. Arena is
asked for a **verdict**, not for implementation.

Scope of the requested review:

1. **Identity + containment** — verify every SHA/tree above with `git rev-parse`; confirm `main`
   `f156aa44` untouched; confirm `src/config/permissions.js` and `.github/` unchanged.
2. **Condition 1** — confirm the carve-out is gone, exactly one route used it, and no dead code
   remains; confirm `GET /api/users/:id` returns **403 for an operator on its OWN id**, and that
   `GET /api/auth/profile` returns **200 sanitized** for the same operator.
3. **Condition 2 (the crux)** — independently reproduce **M1** (handler raw row, backstop intact)
   and confirm it is now **RED**, and reproduce **M2** (backstop uninstalled) and confirm **RED**.
   Attempt to defeat the allow-list projection; report any bypass.
4. **Condition 3 (provenance)** — confirm the case-13 attribution is sourced to the **unversioned
   handoff prose**, not to a repository document: reproduce `git grep -n "case 13" f03a4f6 -- docs
   src tests` (expect **no match**); confirm §5 at `f03a4f6` lists only cases **3, 4, 5, 6, 12 and
   12b**; confirm that **no remaining text** in this branch's evidence attributes the case-13 claim
   to a repository document; and confirm case 13 still uses `ADMIN_A`, asserts **404**, and is
   unchanged from `2cd999a`.
5. **Condition 4** — confirm the integration-scope vs `npm test`-scope figures are labelled.
6. **Credential hygiene** — confirm the disposable test-DB password literal is **absent** from every
   file in this branch's `docs/review-evidence/` (a value-grep must return **zero** matches) and that
   it is referenced by **name only**; and independently assess the §13.2 reuse/rotation question.
7. **Preserved controls** — cross-tenant 404/403 non-disclosure (no existence oracle), authorized
   administrator own/same-tenant 200 + foreign 404 + list, and no new capability.
8. **Residuals** — confirm the §9 blockers are still OPEN and that nothing was silently reconciled.

**A review-only context must state its procedural (not organisational) independence and must not
sign off merge, deploy, or OWNER approval. No independent PASS may be claimed until Arena has
actually reviewed the exact tree above. This document claims none.**

---

## 13. Final-evidence closure — the two remaining Arena conditions (this commit)

> **Reviewer findings are preserved verbatim. Nothing is deleted, reworded or softened.**
> The two conditions below are reproduced **verbatim** exactly as relayed in the final-evidence
> mission brief. **The author of this document did not directly observe the Arena verdict artefact**,
> and records them as relayed rather than as an observed verdict. The **four** earlier conditions in
> §3 are **preserved unchanged**; no text of theirs was removed.

### 13.1 Arena outstanding condition 1 (original condition 3) — case-13 provenance

> **Verbatim:** "The condition-3 banner/§5.4 must not assert a §5 case-13 attribution that is absent
> from the reviewed tree — restate it as correcting the handoff prose, or cite where it appeared."

**Disposition: CLOSED — restated as correcting the handoff prose. No repository citation is
possible, because none exists.**

**Verification performed (VERIFIED, reproduced by the author):**

| Check | Command | Result |
|---|---|---|
| "case 13" in the reviewed artefact | `git grep -n "case 13" f03a4f6 -- docs src tests` | **no output, exit 1** |
| variant spellings, whole artefact | `git grep -in "case 13\|case-13\|case13" f03a4f6` | **no output, exit 1** |
| "case 13" in any commit message, all refs | `git log --all --format='%B' \| grep -i "case 13"` | **no match** |
| §5's actual converted-case list at `f03a4f6` | `git show f03a4f6:docs/review-evidence/ATM-001-SEC-107-R1-OWN-PROFILE-EVIDENCE.md` | §5 reads: "Cases **3, 4, 5, 6, 12 and 12b** … are now asserted with `assertDeniedBeforeProjection`" — **case 13 is not listed and is not mentioned anywhere in §5** |
| §5's only `assertDeniedBeforeProjection` mention | same | the sentence whose subject is the six-case list above |

**What is and is NOT there — stated exactly.** At `f03a4f6`, §5 of the #107 evidence doc attributes
the helper to cases **3, 4, 5, 6, 12 and 12b** only. It makes **no** attribution of case 13 to
anything. The string "case 13" is absent from the reviewed tree entirely. Consequently the earlier
banner/text in this branch — which asserted a §5 case-13 attribution — asserted a correction of text
that **is not in the reviewed tree**.

**Why the literal phrase appears nowhere (corroborating detail, VERIFIED).** The suite numbers its
tests inside the `it()` title — `it('13. an absent identifier answers 404 and creates no row', …)` at
`tests/user-credential-disclosure.test.js:679` — and §5 of the evidence doc refers to the converted
cases by **bare number** ("Cases 3, 4, 5, 6, 12 and 12b"). The token "case 13" is therefore a
*paraphrase* of "test 13", not a string that any repository document was ever written to contain.
This is precisely why Arena's grep returned nothing, and it confirms that the attribution could only
have come from prose, never from a file.

**Provenance (a) vs (b), stated plainly:**

- **(a) EARLIER HANDOFF PROSE** — the *source* of the case-13 attribution. Mission/handoff text
  supplied to the implementing agent by a parent agent. It is **not repository content**, is **not
  version-controlled**, and **exists at no commit**, so it can be cited to no path, line or SHA.
- **(b) ACTUAL REPOSITORY CONTENT** — at `f03a4f6`: §5 lists 3, 4, 5, 6, 12, 12b and says nothing
  about case 13; "case 13" appears nowhere in `docs`, `src` or `tests`. **No repository document
  contains the attribution**, and none is alleged to.

**Exact text changed (both instances of the assertion were removed/restated):**

| File | Before | After |
|---|---|---|
| `ATM-001-SEC-107-R1-CORRECTION-EVIDENCE.md` §5.4 | heading "case 13 attribution corrected"; body asserting "The #107 evidence doc's §5 attributed \"case 13\" to `assertDeniedBeforeProjection`." | heading "case 13 attribution: corrected provenance (restated)"; body states the source was the **unversioned handoff prose**, quotes the two negative greps, reproduces §5's actual list, and states **no repository document is alleged** to contain the attribution. |
| same, §3 row 3 (condition "Correct claim 5's case-13 attribution.") | "The #107 evidence doc carries a superseding banner explaining that case 13 was never converted by `assertDeniedBeforeProjection`…" | "**CLOSED — provenance restated**… The case-13 attribution appeared in **no repository document**… It originated in the **unversioned mission/handoff prose**… **no repository document is alleged to contain it**." |
| same, §12 item 4 (Arena review scope) | "confirm case 13 is not attributed to `assertDeniedBeforeProjection`." | item rewritten to ask Arena to reproduce the negative grep, confirm §5's actual six-case list, confirm **no remaining text** attributes the claim to a repository document, and confirm case 13 is unchanged. |
| `ATM-001-SEC-107-R1-OWN-PROFILE-EVIDENCE.md` banner | "**§5's attribution of \"case 13\"** to `assertDeniedBeforeProjection` — wrong…" | banner corrected: the attribution came from **earlier handoff prose, not this document**; "case 13" appears **nowhere in this file** or in `docs`/`src`/`tests` at the reviewed artefact; §5 below lists only **3, 4, 5, 6, 12, 12b**. |

Note: the banner in `ATM-001-SEC-107-R1-OWN-PROFILE-EVIDENCE.md` is **correction-era** text added by
the correction commit — the *historical §5 body itself is unchanged*, so this restatement does not
alter the historical record.

**Case 13's verified behaviour is preserved and was never altered:** it uses `ADMIN_A`, asserts
**404**, is unchanged from base `2cd999a`, and was never converted to
`assertDeniedBeforeProjection`. **No test file and no assertion was modified** (§13.3).

### 13.2 Arena outstanding condition 2 — credential hygiene

> **Verbatim:** "Remove the literal disposable test-DB password from the committed evidence doc;
> reference the credential by name only."

**Disposition: CLOSED in the current evidence files. ESCALATED for rotation/revocation (STOP).**

**Removal.** At the pre-closure tip `e631888417da2953f7fae170f6f6f9e8a07e3666` the literal appeared
**exactly once** in tracked files — the `TEST_DB_PASSWORD=` assignment in the §6 environment block
of this document. It has been replaced by a **name-only** reference: "the **`TEST_DB_PASSWORD`**
environment variable — **value not recorded in this document**". Presence is confirmed by
count/hash only, **never by echoing the value**:

| Measure | Pre-closure (`e631888`) | Closure tip |
|---|---|---|
| files in `docs/review-evidence/` matching the value | 1 | **0 (expected)** |
| tracked files in the whole repo matching the value | 1 | **0 (expected)** |
| value hash (sha256, first 8 hex) | `c0b9e569` | `c0b9e569` (unchanged — same value) |

The credential is referred to by **name only** in this document, in the mission report and in all
new text. **No other literal secret was found** in `docs/review-evidence/`.
`ATM-001-SEC-106-B1-RECONCILIATION.md` already referenced the credential as the placeholder
`'<TEST_DB_PASSWORD>'` — the correct pattern — and was left unchanged. All 14 long-hex tokens across
the evidence files were verified to resolve to **existing commits or trees** (benign SHAs).
`TEST_DB_USER=agadmin` is a **role name, not a secret**, and is retained as necessary context,
matching the #106 reconciliation document.

**Fabricated bcrypt-shaped placeholder — assessed BENIGN, and labelled here (not edited in place).**
`ATM-001-SEC-107-R1-CORRECTION.diff` (and its source, `tests/user-profile-projection.test.js`)
contains exactly one bcrypt-shaped string, in the frozen in-memory `RAW_ROW` fixture as
`password_hash: '$2b$10$abc…XYZ012'`. It is a **fabricated placeholder, not a credential**: its body
is the literal sequence `abcdefghijklmnopqrstuvwxyz` then `ABCDEFGHIJKLMNOPQRSTUVWXYZ` then `012`,
and at **62** characters it is not even a well-formed bcrypt hash (bcrypt digests are 60). It
corresponds to no password, authenticates nothing, and protects nothing. **Rationale for labelling
rather than editing:** that `.diff` is a faithful `git diff f03a4f6 HEAD` evidence artefact; altering
its bytes would itself be an evidence-integrity defect, so the assessment is recorded here instead.
**No test file was changed.** The same string is likewise **not** a secret in the test.

**Residual — the value remains in Git history.** The literal is still present in **commit
`e631888417da2953f7fae170f6f6f9e8a07e3666`** (exactly **1** commit across all refs, per
`git log --all -S<value>`), which is already on `origin/atm-001-sec-107-r1-correction-closure`.
**Git history was NOT rewritten** and must not be without separate OWNER approval. Removing the
literal from the tip **reduces** exposure; it does not eliminate it.

**STOP / ESCALATION — the credential is potentially REUSABLE, and it grants more than a test
database.** Determined by direct observation on 2026-10-16:

| Question | Finding |
|---|---|
| Is the disposable cluster still running? | **YES.** `postgres -D /tmp/atiman104-pg -p 55435 -c listen_addresses=127.0.0.1` (PID 57271), PostgreSQL **16.14** (Homebrew), running as local user `gcb` |
| Listen configuration | **Loopback only** — `lsof` shows `TCP 127.0.0.1:55435 (LISTEN)`; no `0.0.0.0` bind. `pg_hba.conf`: `host all all 127.0.0.1/32 md5` over TCP, `local all all trust` on the socket |
| Who can reach it | Only processes on **this host** (loopback). No `cloudflared`/`ngrok`/`ssh -R`/`socat` tunnel exports port 55435. TCP loopback is **not** restricted by OS user, so any local user/process that learns the password can connect |
| Does the credential still authenticate? | **YES — verified positively.** A TCP connection to `127.0.0.1:55435` as `agadmin` authenticated with the committed credential and returned `AUTH_OK superuser=true db=atiman_test` |
| Does it grant anything beyond a disposable test database? | **YES.** `agadmin` is `rolsuper=t` **and** `rolcreatedb=t`, `rolcreaterole=t`, `rolreplication=t` — **cluster-wide superuser**. A PostgreSQL 16 superuser can read every database on the cluster and can execute OS-level commands as the cluster owner via `COPY … FROM PROGRAM` / `pg_read_server_files`. This **exceeds** "a disposable test database" |
| What data is actually at risk | **Only disposable test data**: the cluster contains `atiman_test` (55 MB), `atiman_m5r4b2_test_34376_1` (17 MB), `postgres`, `template0/1` — owner `agadmin` throughout. **No production data and no production host** were touched |

**Conclusion: potentially reusable → STOP and escalate.** Secure rotation or revocation is an
**OWNER decision, not the author's**. **Nothing was rotated, revoked, dropped or otherwise altered —
no database change was made by this mission.**

**The exact OWNER decision required.** The OWNER must direct **one** of:

- **(a) Rotate** the `agadmin` role password on the disposable cluster (e.g. `ALTER ROLE agadmin
  PASSWORD …` on `127.0.0.1:55435` only) and update the local environment/secret store that supplies
  `TEST_DB_PASSWORD`; or
- **(b) Destroy and rebuild** the disposable cluster at `/tmp/atiman104-pg` under a fresh credential;
  or
- **(c) Explicitly accept the residual** — loopback-only, no tunnel, disposable data only,
  workstation-local, and already on the remote's history — recording that acceptance as an OWNER risk
  decision rather than letting it stand by default.

and, separately:

- **(d)** whether to **rewrite Git history** to purge the value from commit
  `e631888417da2953f7fae170f6f6f9e8a07e3666` and force-push. **Not done; requires separate OWNER
  approval** (prohibited in this mission).

### 13.3 Bound of this closure — documentation/evidence only

This closure changes **documentation only**. `git diff --name-only <baseline> <closure tip>` contains
**only** paths under `docs/review-evidence/`. **No** `src/` change, **no** test change, **no**
`database/`, schema or migration change, **no** CI/`.github` change, **no** configuration change, and
**no** database change. `.gitignore` is untouched; the evidence remains Markdown, not `.log`
(`.gitignore:17` is `*.log`, which would silently untrack it). Case 13's test and assertion are
byte-identical to the baseline.

### 13.4 What this section does NOT claim

- It does **not** claim an Arena verdict, a PASS, a ratification, or an approval. The two conditions
  are recorded **as relayed**; the author did not observe the Arena verdict artefact.
- It does **not** close the credential exposure — that is **escalated** (§13.2) and remains open
  until the OWNER decides (a), (b), (c) and (d).
- It does **not** assert that any rotation, revocation or history rewrite occurred.
