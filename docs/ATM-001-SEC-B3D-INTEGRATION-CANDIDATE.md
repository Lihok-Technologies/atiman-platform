# ATM-001-SEC-B3D — DRAFT integrated security candidate

> ## ⛔ THIS IS A DRAFT INTEGRATION CANDIDATE. IT IS **NOT** RELEASABLE.
>
> It is **not** merged, **not** approved, **not** independently verified, and **not**
> authorized for merge or deployment. Merge and deploy are OWNER acts.
> This document is authored by the implementing agent and is **not** its own review.
> The final independent VUDA must assess the exact final commit/tree recorded in §0.
> No `OWNER-RATIFIED:` line exists or may be inferred from anything here.

Authority: issue **#105** task **B3-D** ("Security integration readiness"), parent #97.
OWNER direction 2026-10-14 is **engineering** authorization only, release hold.
Constraints honoured: separate worktree, no merge to `main`, no push to `main`, no
production/shared database, no Render / branch-protection / organization-settings change.

---

## 0. The candidate artefact

| Item | Value |
|---|---|
| Branch | `atm-001-sec-b3d-integration-candidate` (non-main, disposable) |
| Worktree | `/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-b3d-integration` |
| Base | frozen `main` `f156aa4479efe783eefd4f13fd62171647f83b7f` (verified with `git rev-parse`) |
| Commit | recorded in §11 (and in the PR/message that publishes this branch) |
| Tree | recorded in §11 |
| Remote SHA | recorded in §11 |

---

## 1. Candidate enumeration (exact identities, verdicts, authorization)

`git rev-parse` was run on **every** commit and tree below. Nothing is accepted by assertion.

| Ref | Exact commit (verified) | Exact tree (verified) | Verdict as *asserted* | Independently re-verified by B3-D? | Policy authorization | In candidate? |
|---|---|---|---|---|---|---|
| #102 users reconciliation | `749043b7a0aadc6d6b2f8a37ff53d2b59cd1cda5` | `149221d0e92ee96917a8e84feed4466e0dcf0e40` | independent PASS | **NO** — no in-repo/GitHub VUDA artefact; verdict comes from the #105 checkpoint | OWNER-approved facility policy (issue #102) | **YES** |
| Bundle 2 A — #104-R3 (org security + signup evidence) | `7956ecfe3cbd92c76ff2c2cc9ba4af4b51cfaa56` | `e35e6aed516df7b212a40651d7c69a43d2b1ce61` | independent PASS (documentation) | **NO** — asserted only | five OWNER-approved V1 organization security policies (`5bf7122`) | **YES** |
| Bundle 2 B — invitation closure | `0e6f8f9a2501b2f4a754eb4e1e7df1174cb59c82` | `1c7663427827446c8d65638e4e55c693dfa41f9e` | independent PASS for c1/c2; one residual OWNER act | **NO** — asserted only | SEC-00E/00G/00H missions + SEC-93 | **YES** |
| #93 consolidated invitation integration | `24b3f485f0c2eb73184015ff4160001c54c3c4f2` | `0a7e40b495aac0bd4b436405afa9415c8688bcb1` | inherited by Bundle 2 B | ancestry verified | OWNER Option B (consolidated merge) | subsumed by Bundle 2 B |
| #90 / #91 / #92 (superseded) | `adb7cb8c…`, `4910d8cb…`, `1524fbde…` | verified | superseded | ancestry verified | superseded by #93 | subsumed |
| Bundle 2 C — #103 CI trust-boundary feasibility | `0247cde5140ed277fcc06cf517710a2646bd643e` | `670ce55cfca60e4819f1fb6dcd91ab576f8aea12` | CONDITIONAL PASS on investigation, **BLOCKED** on the security boundary | **NO** | #103 investigation | **NO — excluded (BLOCKED)** |
| Bundle 2 D — D-1 onboarding repair | `7b0d6f4c2baac1109e94325550588cefaaafcb82` | `c55c9c70ad2e54266fbbd26c0e216081ebbd1f4e` | repair PASS **subject to four exact conditions** | **NO** — asserted only | Mission D-1 | **YES** (with conditions carried) |
| #86 public-signup hardening | `456e4cdeabcf30ba49126660d68d8660b5c6f14c` | `de8eaeb2c2936fa11bce5441b1f730892a6d68a9` | **none** — commit body states *"An independent VUDA review has not been commissioned; this commit is not a verification verdict."* | **NO** | fail-closed containment in the SEC-00 chain | **NO — excluded** (see §2) |
| #88 org-delete containment | `913ef50ddce0d6339a09fd17dfd382189e566a47` | `504d8a2467bb4550828a8fd3d57eee8f967e9c62` | **none recorded** | **NO** | "authorized by the OWNER" (commit body) | **NO as a separate merge** — its control is present transitively in #104-R3 (verified: `ORGANIZATION_DELETION_DISABLED` in the #104-R3 tree) |
| #89 register role authority | `48f4a97633f55db81711ca120b5adb2d0d9077e0` | `4469dc27523f0c9ee8820f055e3e37280d8a916e` | **none** — commit body states *"No independent VUDA has been commissioned for this commit; it is not a verification verdict."* | **NO** | applies the already-sanctioned `canCreateUser` | **NO — excluded** (see §2) |
| #95 transitive deps | `391756795533e194898564848218f73b36aa29bc` | `fbc1fcb0d4ae72423a32a572f7e13457d42d9054` | "independently verified" (#105 checkpoint) | **NO** — asserted only | WP5-02 dependency security | **YES** |
| #96 multer security | `60ca148bb345ebaaca7c56d2b99f2c0870bb3b6c` | `883fad946335c9f89eaf0df022d44404bd480adb` | "independently verified" (#105 checkpoint) | **NO** — asserted only | WP5-03 dependency security | **YES** |
| #98 F-3 isolation | `5077c2d2b011b115976940bcc100e66dbe415b8c` | `e9173db25489f6b22fbd42daff36721e36ff7f2d` | "independently verified" (#105 checkpoint) | **NO** — asserted only | F-3 integration determinism | **YES** |
| #99 mysql2 security | `042aa33df6b01b70b564187e0119b09bfb1873f8` | `7db62d87aa7b035e67ca223c99654dae9a80e7b2` | "independently verified" (#105 checkpoint) | **NO** — asserted only | WP5-04 dependency security | **YES** |
| #85 GET user authorization | `fc9eb298259c556893e18c8e1e3d9d81e1b19fcb` | `87c233944f23cd9b51a9190f69a4a2dfeb34ccb7` | accepted-in-spirit; **no recorded verdict** | **NO** | superseded/absorbed by #102 | **NO — excluded (subsumed)** |
| #87 DELETE user authorization | `c061fdff7e10248a2a3b969d9cbda3bf2cf4cd9a` | `09edbd80815311094beb89e58ada8d354b539ba6` | accepted-in-spirit; commit body states *"An independent VUDA review has not been commissioned"* | **NO** | superseded/absorbed by #102 | **NO — excluded (subsumed)** |

### 1.1 Identity discrepancies found (no acceptance by assertion)

1. **#102's SHA in the B3-D brief is not a git object.**
   The brief and the #105 checkpoint give `749043ba0aadc6d6b2f8a37ff53d2b59cd1cda5`.
   That object **does not exist** (`git cat-file -t` → *Not a valid object name*). The real
   commit is **`749043b7a0aadc6d6b2f8a37ff53d2b59cd1cda5`** — the 8th hex digit is `7`, not `a`.
   It is identified unambiguously by (a) the abbreviation `749043b` resolving to it alone and
   (b) its tree matching the brief's tree exactly. This is precisely the "never infer full SHAs
   from abbreviations" failure mode. **Anything that pinned `749043ba…` is a transcription
   error, not a second commit.**
2. **`4b00462` is not `7956ecf`'s parent.** The brief calls it "its parent in that lineage".
   `7956ecf`'s parent is `ce9947b`; `4b00462` is an **ancestor** (grandparent). Ancestry verified.
3. **No GitHub-recorded independent review exists for any in-scope PR.** `gh pr view` for
   #85–#101 returns `reviews: none` and an empty `reviewDecision` for every one. The "independent
   PASS" verdicts are external reports carried in the #105 checkpoint. B3-D could verify
   **identity** for every candidate but could **not** reproduce any verdict.
4. **#88 is not an ancestor of #104-R3** (`git merge-base --is-ancestor` → false), but #104-R3's
   tree *re-implements* #88's containment verbatim. #88's security effect therefore reaches the
   candidate through an accepted artefact; merging #88 separately only re-adds a conflicting copy.
5. **#90/#91/#92/#93 are all ancestors of Bundle 2 B** (verified), so they are not merged separately.

---

## 2. What is in the candidate, and what is deliberately excluded

**Included** (each is policy-authorized and carries an asserted independent verdict):
#104-R3 (Bundle 2 A), Bundle 2 B `0e6f8f9`, Bundle 2 D `7b0d6f4c`, #102, #95, #96, #98, #99.

**Excluded, with reason:**

| Excluded | Reason |
|---|---|
| Bundle 2 C `0247cde` | **BLOCKED on the security boundary**; branch is local/never pushed (verified). Cannot be part of an accepted candidate. |
| #86, #89 | **No independent verdict exists**, and both commits state so in their own bodies. They are policy-authorized *containments* but are not *accepted* work. #105 B3-D asks only to "identify conflicts across #86/#88/#89", not to integrate them. |
| #88 | No recorded verdict. Its control is already present via #104-R3; a separate merge would only produce a conflicting duplicate. |
| #85, #87 | Accepted-in-spirit but **superseded and absorbed by #102** (whose own body says it reconciles "R2 + #85 + #87"). Merging them separately would double-apply the users lane. |
| #93, #90, #91, #92 | Ancestors of Bundle 2 B — subsumed. #93's duplicate-email 409 guard is preserved inside Bundle 2 B. |

**Consequence that must not be glossed over:** excluding #86 means the candidate still
contains the public self-enrollment escalation (`POST /api/auth/signup` reads
`organization_id` and `role` from the request body), and excluding #89 means `POST
/api/auth/register` still lacks the role-assignment authority. Both are recorded as release
blockers in §8, not silently absorbed.

---

## 3. Conflict analysis

Method: `git merge-tree --write-tree --name-only <A> <B>` for every pair of the 15 in-scope
candidates (105 pairs), with conflict-hunk counts read back from the written merge tree.

**44 of 105 pairs conflict.** Hotspots by number of conflicting pairs:

| File | Conflicting pairs | Nature |
|---|---|---|
| `scripts/run-integration-tests.js` | 44 / 44 | registry append / execution topology |
| `tests/database-test-guard.test.js` | 44 / 44 | registry append (set-equality contract) |
| `src/routes/user.routes.js` | 6 | #85 × #87 × #102 × D1, same anchor |
| `src/middleware/rbac.js` | 3 | #85 × #87 × #102, same anchor |
| `src/controllers/invitation.controller.js` | 2 | #93/B2B × D1 — **4 conflict hunks** |
| `src/routes/organization.routes.js` | 1 | #88 × #104-R3 |
| `src/controllers/auth.controller.js` | 1 | #104-R3 × D1 |

Non-registry conflicts in full (registry pairs are all 44 and are all append-style):

```
85 × 87   rbac.js(5h) user.routes.js(2h)
85 × 102  rbac.js(4h) user.routes.js(4h)
85 × D1   user.routes.js(2h)
87 × 102  rbac.js(3h) user.routes.js(5h)
87 × D1   user.routes.js(1h)
88 × 104R3 organization.routes.js(1h)
93 × D1   invitation.controller.js(1h)
B2B × D1  invitation.controller.js(4h)
D1 × 104R3 auth.controller.js(1h)
102 × D1  user.routes.js(3h)
```

### Two conflicts that are NOT textual

1. **`src/models/invitation.model.js` auto-merged "cleanly" and was INCOHERENT.** It retained
   **both** retirement mechanisms. This is the subject of condition 1 (§4).
2. **The `package-lock.json` trio (#95/#96/#99) merges cleanly but a lockfile merge is not a
   dependency resolution.** It was validated by `npm ci` and `npm audit`, not inferred.

### Recommended integration order (the order actually used)

```
f156aa4 (frozen main)
  1. #104-R3  7956ecf   Bundle 2 A                       clean
  2. #102     749043b7  users lane                       registries (union)
  3. B2B      0e6f8f9   invitation closure (⊃ #93/90/91/92) registries (union); rbac auto
  4. D1       7b0d6f4c   onboarding repair  ← SEMANTIC   auth.controller, user.routes,
                                                        invitation.controller, registries
  5. #98      5077c2d2   F-3 isolation topology          clean
  6. #95,#96,#99        dependency patches               clean; validated by npm ci + audit
```

Rationale: infrastructure/documentation first; the smallest, disjoint source changes next;
Bundle 2 B before D1 so D1's changes are resolved against the accepted invitation closure;
the dependency trio last because it only touches `package-lock.json` and must be validated by
re-resolution rather than by text.

---

## 4. Condition 1 — the semantic merge decision (IMPLEMENTED, not self-approved)

**Status: implemented and documented; requires independent VUDA confirmation. It is carried as
blocker B-1, not cleared.**

The textual merge of Bundle 2 B with Bundle 2 D produced `src/models/invitation.model.js` with
**no conflict markers** and **two retirement mechanisms**:

* Bundle 2 B: `claimForAcceptance(id)` — one conditional `UPDATE … WHERE status='pending' AND
  expires_at > NOW()`, plus `accept()` reduced to **attribution only**;
* Bundle 2 D: `findByTokenForUpdate(token, conn)` — `SELECT … FOR UPDATE`, plus an `accept()`
  that **sets `status='accepted'`**.

Keeping both is incoherent (whichever control runs, the other is dead or duplicated); taking
either side wholesale loses a control. Condition 1 requires *exactly one* retirement mechanism
inside the transaction **and** #93's duplicate-email 409 guard.

### What was chosen

| Element | Decision | Where |
|---|---|---|
| The ONE retirement mechanism | Bundle 2 B's `claimForAcceptance`, executed **inside** D1's transaction | `src/models/invitation.model.js` |
| `claimForAcceptance` signature | gained an optional `conn` (same pattern D1 used for `create`/`update`/`accept`/`cancel`) so it participates in the transaction | `invitation.model.js` |
| `accept()` | **attribution only** (`accepted_by_user_id` + `conn`) — Bundle 2 B's semantics. It is *not* a second retirement mechanism and cannot move a row back to `pending` | `invitation.model.js` |
| `findByTokenForUpdate` | **retained**, as the eligibility read + row lock (Bundle 2 D's control). It does not change status, so it is not a retirement mechanism | `invitation.model.js` |
| Duplicate-email guard | **retained verbatim** from Bundle 2 B: `User.findByEmail(invitation.email)` → **409** *"A user with this email already exists"*, evaluated **before** the claim, so a predictable conflict neither 500s with raw `uq_users_email` driver text nor burns a live invitation | `invitation.controller.js` |
| `accept()` handler | D1's transaction skeleton + B2B's pre-transaction refusals; inside the transaction: lock → **claim** → `User.create(…, conn)` → attribution → `recalculateSeats(…, conn)` → commit | `invitation.controller.js` |
| `resend()` handler | B2B's lifecycle + role-issuance checks + **D1's transactional issue-then-retire** | `invitation.controller.js` |

### Why this is the minimal-loss reconciliation

* It keeps **both** independently-verified controls: Bundle 2 B's single-use claim *and*
  Bundle 2 D's row-lock serialisation and transaction.
* It invents **no new authority**: the claim is B2B's control, the transaction is D1's repair,
  the 409 is B2B's guard. The only code addition is an **optional parameter** on an existing
  method.
* Rejecting an accepted control (dropping either `findByTokenForUpdate` or `claimForAcceptance`)
  would lose a control; the alternatives were not taken.

### The one judgement call, flagged for the final VUDA

Retaining `findByTokenForUpdate` alongside `claimForAcceptance` means the transaction takes a
row lock and *then* performs the conditional UPDATE. B3-D judges this **not** a second
retirement mechanism (it changes no status) and therefore compliant with "exactly ONE
retirement mechanism". A reviewer who reads condition 1 more strictly — requiring the lock to
be removed as well — can obtain that variant by deleting `findByTokenForUpdate` and its call
site; single-use would still hold on the claim alone. **This reading is explicitly submitted
for independent adjudication rather than asserted as correct.**

---

## 5. Condition 2 — D-1 pins inverted / retired

The integrated tree carries the D-1 repair, so every pin that asserted the **defect** now
asserts the **repaired** contract. Nothing was deleted and no assertion was weakened.

**#104's pins (the ones the brief named): `tests/organization-signup.integration.test.js`**

| Pin | Was | Now |
|---|---|---|
| S2 | HTTP 500 + ONE ORPHAN org, 0 users, 0 subs | **201** + exactly 1 org / 1 admin(`role=admin`, `is_organization_admin=true`) / 1 subscription |
| S3 | "the failure is NOT transactional" | "the write **IS** transactional": complete state from independent connections; no orphan |
| S4 | retry refused 409 because an **orphan squats** the name | retry refused 409 because the tenant **genuinely exists**; plus a new-username variant that exercises the org-name check; nothing duplicated |
| S9 | carried as a `todo` | **`todo` marker removed** → strict assertion |

**Under-enumeration #1 (finding).** The brief said "S2–S4 …; S9 passes". In fact **S5, S7 and
S8 also asserted the defect** and would also have failed. All three are inverted:
S5 (two names both onboard completely), S7 (now asserts exactly the designed single
administrator for the **new** tenant and pins the JWT payload to the hand-picked
allow-list `userId/organizationId/role/isOrgAdmin`, while keeping every credential
non-disclosure assertion), S8 (authenticated caller gets the same new-tenant result; its own
tenant is unchanged). The under-enumeration is recorded, not silently absorbed.

**Under-enumeration #2 (finding).** `tests/organization-security-policies.test.js` pin **A9**
also required the documents to record D-1 as *"NOT repaired"*. It is inverted, and the stale
claim was corrected at source in `src/routes/organization.routes.js` (a false statement must
not be left standing merely because its pin was inverted).

**Under-enumeration #3 — the largest, and a defect a textual merge would have shipped
(MAJOR FINDING).** **Bundle 2 B's own suite**, `tests/invitation-lifecycle-residuals.test.js`,
pins D-1 as **OPEN** and asserts source text requiring D-1 to be unrepaired. Inverted/retired:

| Test | Was | Now |
|---|---|---|
| C6 | create/resend **DEAD** under D-1; no link deliverable; no email sent | 201 + token in the response + **email actually sent**; the control that the listing stays token-free is **kept** |
| D3 | 500 + row persisted | 201 + row persisted + **token delivered** |
| D4 | 500 + **TWO live pending tokens** | 200 + **exactly ONE** live pending token; the original is `cancelled` |
| D5 | 500 + `accepted_by_user_id` **NULL** | 200 + single use holds + attribution **now recorded** (strengthened) |
| D6 | source pin "`BaseModel.create` is unchanged" | asserts `RETURNING id` **is** present and the `insertId` read is gone. **D-2's pins are kept verbatim** |
| G3 | "an invitation-only D-1 repair does not fix the accept path" | inverted: the repair is **class-level**, so it does fix the accept path |
| G4 | condition-c2 delivery gap recorded as an open escalation | **RESOLVED** by the D-1 repair; the assertion that the listing token is *not* re-exposed is kept |
| header / F1 | "reported, not repaired"; stale negative-control label | updated |

Three further D-1 pins were found by running the *other* inherited suites and inverted:
`invitation-resend-authorization.test.js` test 05 and R1-13, and
`invitation-role-authority.test.js` test 18.

Because these pins assert **source text**, the now-false "dead delivery path" claims were also
corrected at source — `src/controllers/invitation.controller.js` (listing-view comment and
`create()` comment) and `views/mobile/admin/invitations.ejs`.

---

## 6. Condition 3 — out-of-envelope residuals ACCEPTED explicitly

**(a) Non-`BaseModel` INSERT sites still reading `insertId` with no `RETURNING` — CONFIRMED,
and BROADER than the brief.** All six-plus named sites were verified present:

`inspection.model.js:45`, `inspection-result.model.js:42`, `custom-field.model.js:95,97`,
`maintenance-plan.controller.js:131`, `asset-import.service.js:246,433`,
`task-template.model.js:340` — plus **additional** sites the brief did not name:
`finding.model.js:177`, `api-key.model.js:70`, `sso-config.model.js:99,195,248`,
`audit-log.model.js:76`, and several `src/utils/` import scripts. These all answer the same
"committed write, unreadable id" failure mode D-1 fixed at the class level **for `BaseModel`
subclasses only**. Accepted as a residual; not repaired.

**(b) `POST /api/organizations` org+admin window — CONFIRMED.** `organization.controller.js`
`create` performs `Organization.create(...)` and then `User.create(...)` as **two independent
autocommit statements with no transaction** (`getConnection`/`commit`/`rollback` count: 0). A
failure between them leaves an organization with no administrator — the same defect class D-1
repaired on the signup path. **Reachability nuance:** #104-R3 gates this route behind
`platform.admin`, which is non-human-grantable in V1, so it is fail-closed for every human
principal. Accepted as a residual; not repaired.

**(c) `GET /api/users/:id` `password_hash` disclosure — NOT REPRODUCED in this candidate;
the condition appears STALE.** Condition 3 asserts this is "still-live". #102 (included, and
independently PASSed) adds `redactSensitiveFields`/`sanitizeUser` to every JSON response of the
users router plus a router-level `res.json` backstop. An empirical probe against the integrated
tree on the disposable cluster (§9) **did not reproduce** a hash or `password_hash` field on
`GET /api/users/:id` (self or other), `GET /api/users`, or the capabilities route. This is
reported as a **discrepancy with the condition, not as a clearance**: the probe is B3-D-authored,
not independently reviewed, and B3-B must still assess the exact final commit/tree.

**(d) `src/models/base.model.js` SQL-parameter logging — CONFIRMED LIVE, with log evidence.**
`BaseModel.query` executes `console.log('[BASE MODEL] Params:', validParams)` **unconditionally**,
so every `BaseModel` write logs its parameters — **including `users.password_hash`**. This was
observed verbatim in the sanctioned run output, e.g.
`[BASE MODEL] Params: [ '…-s5a', '…@test.local', '$2a$10$fut4g00mDE48HA/.jdx9l…', … ]`.
`PROTECTED_CREATE_COLUMNS` strips the hash from the **returned object** but has no effect on
this log. This is B3-B's scope; accepted as a residual here and **not** repaired.

---

## 7. Condition 4 — missing resend failure-injection detector (NOT cleared)

The D-1 suite has failure-injection coverage for the **onboarding** path, but **no
failure-injection case for the resend path**. Mutation **M8** (make the resend
non-transactional) therefore escapes the suite: with the issue-then-retire pair split into two
autocommit statements, a failure between them leaves the replacement committed and the original
still `pending` — **two live pending tokens for one invitee**.

The integrated tree takes D-1's **transactional** resend, so the *code* defect is not present.
The *detector* is still missing, so **condition 4 is carried as blocker B-4, not cleared.**
B3-D did **not** author the missing test: doing so would manufacture the evidence that clears
its own condition and would breach reviewer separation.

---

## 8. RELEASE BLOCKERS carried by this candidate

> No reader may mistake this DRAFT for a releasable artefact. The list below is the complete
> set of reasons it is not releasable. None of them was resolved by choosing a side.

**B-1 — OWNER DECISION REQUIRED: unresolved capability-resolution conflict between two
independently PASSed artefacts (HIGHEST SEVERITY, and the reason 5 integration tests are red).**
A **tenant administrator** (`users.role='admin'` **and** `users.is_organization_admin=true`)
that holds one unrelated explicit capability grant:

* **ATM-001-SEC-104-R2 (F3)** — independently PASSed — deliberately preserves the ATM-003-R1 §4
  Tenant Administrator profile (`org.user_admin` + `org.config_admin`) for exactly that
  principal shape in both resolution modes (`src/services/capability.service.js`
  `withTenantAdministratorProfile`; documented in `src/config/capabilities.js`). It records the
  previous behaviour as a **regression** it was created to fix. → the principal **holds**
  `org.user_admin`, so `POST /api/invitations/:id/resend` answers **200**.
* **Bundle 2 B** — independently PASSed — asserts the same principal **must not** hold
  `org.user_admin` and must be refused **403**.

Both cannot hold. The conflict changes **who may resend an invitation, including an
ADMINISTRATOR invitation** — an authority-*granting* outcome, the direction that requires
explicit authority. Consistent with AGENTS.md Art. 6.9 and the B3-D instruction *"do NOT
resolve a blocker by choosing a side"*, **neither the code nor the assertions were changed**;
the failing assertions are left failing and reported. OWNER adjudication required.

Failing tests that are this blocker (5):

```
tests/invitation-resend-authorization.test.js  04, 20, 22-25, R1-07   (4)
tests/invitation-list-authorization.test.js    8                        (1)
```

**B-2 — Condition 1 requires independent confirmation.** The semantic reconciliation in §4 is
B3-D-authored. It is not self-approved; the retention of `findByTokenForUpdate` is a judgement
call explicitly submitted for adjudication.

**B-3 — Condition 3 residuals ACCEPTED, not repaired.** (a) the non-`BaseModel` `insertId`
INSERT sites (broader than enumerated); (b) the un-transacted `POST /api/organizations`
org+admin window; (c) the `BaseModel.query` SQL-parameter logging that prints
`password_hash`. Plus the condition-(c) discrepancy in §6.

**B-4 — Condition 4: the resend failure-injection detector is missing** (mutation M8 escapes).
Not authored here.

**B-5 — Bundle 2 B's residual OWNER act is unresolved:** E1 legacy pending **administrator**
invitations, the E3/E4 scope questions, and confirmation of the E2 resolution.

**B-6 — D-2 activation ordering is live and un-repaired.** The seat-alias defect
(`subscription.service.js` `getSeatUsage` reads the case-folded alias, so `canAddUser()` is
always false) currently MASKS invitation paths. Repairing D-2 **activates** them. Verified
call sites are **six, not the five enumerated**:

```
src/middleware/seat-limit.js:23
src/middleware/seat-limit.js:69
src/controllers/invitation.controller.js:215   (create)
src/controllers/invitation.controller.js:499   (accept)   ← not in the brief's list
src/controllers/auth.controller.js:203
src/services/subscription.service.js:367        (self-call; :155 is the definition)
```

The brief's `subscription.service.js:351` and its five-caller count are inaccurate.

**B-7 — #86 excluded: public self-enrollment escalation remains in the candidate.**
`POST /api/auth/signup` still reads `organization_id` and `role` from the request body. #86
has no independent verdict, so it is not accepted work — but its absence is a **live
privilege-escalation path** in this draft.

**B-8 — #89 excluded: `POST /api/auth/register` still lacks the role-assignment authority.**
#89 has no independent verdict, so it is not accepted work.

**B-9 — Bundle 2 C excluded: the CI trust boundary remains unproven.**
`.github/workflows/ci-verification.yml`, `scripts/assert-test-coverage.js` and
`scripts/test-execution-evidence.js` are **absent** from this tree (they exist only on the
BLOCKED, unpushed `0247cde` branch). Consequently `node scripts/assert-test-coverage.js`
cannot be run here at all.

**B-10 — the in-repo CI evidence gate is NOT trustworthy and is NOT cited as assurance.**
The mission states, and B3-D concurs without qualification, that the in-repo CI evidence gate
is independently judged **not trustworthy**. It cannot establish that the suites it reports as
green actually executed. **No CI result is cited anywhere in this document as assurance.**
Every number in §9 comes from B3-D running the commands locally against the disposable cluster.

**B-11 — the candidate is not independently verified.** Every "independent PASS" above is an
**asserted** external verdict; B3-D verified identity only. This document is the implementer's,
not a review.

**B-12 — no independent verdict exists for #85/#87/#86/#88/#89**, and their exclusion is a
scope decision recorded here, not an OWNER ruling.

---

## 9. Test results (exact counts, B3-D-run, disposable cluster)

Environment: disposable PostgreSQL 16.14 at `/tmp/atiman104-pg`, **port 55435** (verified by
`data_directory` and `nc -z 127.0.0.1 55435`); `TEST_DB_NAME=atiman_test`,
`TEST_DB_USER=agadmin`. Port 5432 was **never touched**. Migration 022 makes grants
undeletable, so **no grant was created** — the #104 F3 fixture already existed and was reused
idempotently. JWT secret read from `src/config/auth.js`.

| Command | Result |
|---|---|
| `npm ci` | **exit 0**; lockfile not rewritten |
| `npm audit --omit=dev` | **0 vulnerabilities** (the #95/#96/#99 trio cleared every advisory) |
| `npm test` (non-destructive profile) | **195 tests / 61 suites → 195 pass, 0 fail, 0 skipped, 0 todo** |
| `node scripts/assert-test-coverage.js` | **NOT PRESENT** in this tree (B-9) |
| `npm run test:integration` | see §9.1 — **not green** |
| disposable PostgreSQL integration | same run as above |
| cross-tenant DB-effect tests | included in the run (the users, invitation, org-security and signup suites all assert persisted rows, not status codes alone) |
| auth enrollment D-1/D-2 sequencing | D-1 repaired and asserted (§5); D-2 still masked and **pinned** as unrepaired (blocker B-6) |
| MySQL legacy compatibility | **NOT EXERCISED** — no MySQL 8 instance was available in this session. Limitation, stated rather than implied. |

### 9.1 `npm run test:integration` — failures reported, not hidden

```
FINAL RUN
  Sanctioned group : 241 tests / 33 suites -> 241 pass / 0 fail
  Full run         : 968 tests / 230 suites -> 962 pass / 6 fail
  The 6 remaining failures are exactly: 5 x blocker B-1 + 1 x the known pre-existing failure.
```

An **intermediate** run (before the D-1 pins in §5 and B3-D's own S4 were corrected) had
**10** failures. The classification below is of that intermediate set, so that the causes that
were fixed are visible and not silently dropped:

| # | Failure | Classification |
|---|---|---|
| 1 | `invitation-resend-authorization` 04, 20, 22-25, R1-07 (4 tests) | **Blocker B-1** (F3 authority conflict) — preserved deliberately, assertions untouched |
| 2 | `invitation-list-authorization` 8 (1 test) | **Blocker B-1**, same root cause, same helper assertion |
| 3 | `invitation-resend-authorization` 05, R1-13 (2 tests) | **D-1 pins — since inverted** (§5) |
| 4 | `invitation-role-authority` 18 (1 test) | **D-1 pin — since inverted** (§5) |
| 5 | `organization-signup.integration` S4 (1 test) | **B3-D's own inverted test** pinned one specific 409 message; corrected to assert the refusal and add a genuine org-name-path variant |
| 6 | `m6r3-r1-remediation` "own customer pack must be listed" (1 test) | **KNOWN PRE-EXISTING failure** — the accumulated database holds >500 `knowledge_packs` against `limit: '500'`; fails identically on pristine. **Reported, not fixed.** |

After fixing causes 3, 4 and 5 the re-run of the affected suites gives:

```
organization-signup.integration :  9 tests -> 9 pass / 0 fail
invitation-role-authority       : 30 tests -> 30 pass / 0 fail
invitation-resend-authorization : 49 tests -> 45 pass / 4 fail   (all 4 = blocker B-1)
invitation-list-authorization   : 25 tests -> 24 pass / 1 fail   (the 1  = blocker B-1)
```

So the candidate's only **deliberately preserved** red tests are the 5 of blocker B-1, plus the
1 known pre-existing failure — which is exactly the 6 failures of the FINAL full run
(962 pass / 6 fail). **The candidate is not green and is not presented as green.**

---

## 10. Limitations

1. No verdict was reproducible: no in-repo VUDA artefact, no GitHub review, and the CI evidence
   gate is untrustworthy (B-10). B3-D verified **identity**, not **verdict**.
2. Everything B3-D authored here — the §4 reconciliation, the §5 inversions, the probe in §6(c)
   — is implementer evidence and requires the independent final VUDA on the **exact** commit/tree.
3. The §6(c) probe is a single-run probe on one cluster; it is evidence of non-reproduction, not
   a proof of absence.
4. MySQL legacy compatibility was not exercised (no MySQL 8 available).
5. The integration run shares one accumulated database; the pre-existing `m6r3-r1-remediation`
   failure is a property of that accumulation, exactly as the mission states.
6. `#104-R3` is labelled a "documentation" PASS in the brief, but the accepted **tree** includes
   the org-security implementation. The tree, not the label, is what was integrated.
7. Bundle 2 C's `assert-test-coverage.js` is absent, so the "assert test coverage" step could not
   be performed at all rather than performed and failed.
8. Branch published as a **non-main** branch only. No merge, no deploy, no ruleset change.

---

## 11. Published artefact

A commit cannot contain its own SHA, so the authoritative commit, tree and remote SHA for this
candidate are reported in the mission's B3-D result (and in the branch's published tip), not
inside this file. At publication the branch
`atm-001-sec-b3d-integration-candidate` is pushed to `origin` as a **non-main** branch; the
reported triple is `commit / tree / remote SHA`.

**The final independent VUDA must assess that exact commit and tree.** Any later change —
including a further test inversion, a documentation edit, or a resolution of blocker B-1 —
invalidates this report and requires a fresh assessment.
