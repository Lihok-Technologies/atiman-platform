# ATM-001-SEC-107 / R-1 — operator own-profile read (implementation evidence)

> **SUPERSEDED IN PART — 2026-10-14, ATM-001-SEC-107-R1-CORRECTION.** An independent Arena
> review-only pass returned **CONDITIONAL** on this tree (`f03a4f63b588b662ee4819820e40818d8dbe2a4a`
> / tree `3afb7e2c4a346ddd3fc3cea6b2e0d483a0be0f3a`) with **four conditions**. The OWNER then
> resolved the crux as Arena's alternative **(b)**: the approval of an own-profile read did **not**
> authorize bypassing the administrative `USERS.VIEW` gate on `GET /api/users/:id`. The
> `requireUsersViewUnlessOwnRecord` carve-out described below (§2) has been **REMOVED**.
>
> This document is retained unchanged as the historical record of what was implemented and why.
> The corrected implementation, the four-condition disposition, the mutation evidence and the
> full test matrix are in
> [`ATM-001-SEC-107-R1-CORRECTION-EVIDENCE.md`](ATM-001-SEC-107-R1-CORRECTION-EVIDENCE.md).
> Two claims **below** are corrected there and must not be relied on:
> - **§5 "Non-vacuous sanitization coverage"** — overstated. Arena mutation M1 (handler returns the
>   RAW row, router backstop intact) left cases 7, 7b, 7c, 8, 9, 10 **ALL GREEN**, because
>   `sanitizeUser ≡ redactSensitiveFields` and the pre-existing backstop applied the identical
>   function to the whole body. Those cases proved *no credential reached the wire*; they did **not**
>   prove the handler projection executed. (Arena condition 2.)
> - **The "case 13" attribution** to `assertDeniedBeforeProjection` — wrong, and it did **not**
>   originate in this document. The attribution came from **earlier mission/handoff prose** supplied
>   by a parent agent, which is **not repository content and is not version-controlled**: the string
>   "case 13" appears **nowhere in this file**, and nowhere in `docs`, `src` or `tests`, at the
>   reviewed artefact. **§5 below lists only cases 3, 4, 5, 6, 12 and 12b** and attributes none of
>   them, and no case 13, to the helper. An earlier revision of this banner wrongly implied that §5
>   made that attribution; that wording has been removed. Case 13 uses `ADMIN_A`, asserts 404, is
>   unchanged from the base, and was never converted. (Arena condition 3; full provenance and the
>   exact text changed are in
>   [`ATM-001-SEC-107-R1-CORRECTION-EVIDENCE.md`](ATM-001-SEC-107-R1-CORRECTION-EVIDENCE.md)
>   §5.4 and §13.1.)
>
> Authored by the implementing agent. **This is not its own review.** No independent verdict
> exists for this tree; an independent Arena review-only pass has been requested and has not
> returned at the time of writing. Nothing here is self-approved.

**Base (tested code tree):** commit `2cd999a965019b450ae1cc5235fc619b8c3860cd`,
tree `0dcf749dca0bdf511680859ac7205bd9494cf7d9`.
**Integrated branch tip verified:** `5fa3beb95f10d6dc9e68c69bca2ebcac9364fbb6`
(tree `0d2c5da08025750a487cb654d98319c8001b6bff`); `git diff --stat 2cd999a 5fa3beb -- src tests`
is **empty**, and the only difference between the two commits is the evidence-only file
`docs/review-evidence/ATM-001-SEC-105-INTEGRATION-EVIDENCE.md`.

## 1. Approved policy implemented

> An authenticated **operator may read its OWN sanitized user profile (HTTP 200)**, with
> sensitive credential/secret fields including `password_hash` absent. Viewing the own record
> must NOT confer `USERS.VIEW`, `org.user_admin`, `org.config_admin` or any other elevated
> capability. Other users and foreign-tenant records remain governed by existing #102
> authorization and tenant non-disclosure rules.

## 2. The change

`GET /api/users/:id` previously began with `requirePermission('USERS', 'VIEW')`. Since
`USERS.VIEW` is `{ admin: 'all', supervisor: 'all', operator: 'none' }`
(`src/config/permissions.js:15`), that gate refused an operator **every** identifier alike,
including its own.

The route now begins with `requireUsersViewUnlessOwnRecord` (new, `src/middleware/rbac.js`):
it compares the **route parameter** to `req.user.id` — the **authenticated principal** — and,
only when they are equal, waives the capability requirement. `canViewUser` still runs on
every request and re-resolves the record from the database through the unchanged
`authorizeUserScope` core.

**The capability matrix is not changed.** No route was added. No other route, and no
create / PUT / DELETE / admin route, is touched. The list route (`GET /api/users`) still
requires `USERS.VIEW` and still refuses an operator.

## 3. Existing self-profile endpoint survey (task 1)

| Path | Auth | Identity source | Projection | Status |
|---|---|---|---|---|
| `GET /api/auth/profile` (`src/routes/auth.routes.js:18`) | `authenticate` only | `req.user.id` | `sanitizeUser` | **pre-existing, already-approved own-profile path**; used by `views/mobile/admin/users.ejs:256` |
| `GET /api/users/me/permissions` (`src/routes/user.routes.js:43`) | `authenticate` | `req.user.id` | permission map | presentation only |
| `GET /api/users/me/capabilities` (`src/routes/user.routes.js:51`) | `authenticate` | `req.user.id` | capability descriptor | presentation only |
| `GET /mobile/profile` (`src/routes/mobile.routes.js:580`) | `requireAuth` | `req.user` | rendered view | server-rendered UI |

`GET /api/auth/profile` **already satisfies the R-1 policy on its own** and is exercised as
such by B3-B case 7b. It was nevertheless not sufficient to close R-1: the approved policy and
**both** opposing tests address the `USERS.VIEW`-gated `GET /api/users/:id`, which is the route
that named `USERS.VIEW` in its refusal. The implemented change is the narrow identity carve-out
on that existing route; it adds no route and no capability.

## 4. Historical contradiction (recorded, not erased)

The same call was asserted in two accepted suites:

* `tests/user-credential-disclosure.test.js` test 7 — own record → **200** (was RED).
* `tests/user-authorization-reconciliation.test.js` test 7 — own record → **403**
  ("USERS.VIEW is none for an operator, so the permission gate refuses every identifier
  alike") (was GREEN; this was the *winning* side, not a red).

On the tested code tree the observed state was therefore **one red**, not two. R-1 resolves the
contradiction in favour of the 200; the superseded 403 assertion and its reasoning are quoted
verbatim in the corrected test and are not deleted.

## 5. Non-vacuous sanitization coverage

Cases 3, 4, 5, 6, 12 and 12b **cannot and should not** reach the projection under R-1 —
other-user and foreign-tenant reads stay refused, and an operator's malformed identifiers are
refused by the capability gate before the identifier is parsed. They are now asserted with
`assertDeniedBeforeProjection`, which pins the refusal status **and** requires that no
`data.user` projection was produced, so "blocked before projection" is never credited to the
sanitizer. Sanitizer evidence is carried only by the real HTTP 200 cases: 7, 7b, 7c, 8, 9, 10.

## 6. Expected behaviour change

An operator's `GET /api/users/<own id>` changes **403 → 200** with the same sanitized
projection administrators already receive. Everything else is unchanged.
