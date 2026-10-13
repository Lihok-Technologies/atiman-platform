# ATM-001-SEC-B3 — Condition Reconciliation and OWNER Decision Register (Issue #105)

**Document ID:** ATM-001-SEC-B3-OWNER-DECISION-REGISTER
**Mission:** MISSION B3-A — Condition reconciliation and OWNER decision register (Issue #105)
**Type:** DOCUMENT / EVIDENCE mission. No code, schema, migration, capability, test or route change.
**Scope:** Consolidate every unresolved condition and act carried by the frozen security-closure
candidates into one register, resolve each against the approved sources where approved authority
exists, and present the remainder as a single OWNER decision package.
**Baseline:** frozen `main` = `f156aa4479efe783eefd4f13fd62171647f83b7f`.
**Branch:** `atm-001-sec-b3a-decision-register` (non-main).
**Status:** REGISTER COMPLETE — **not approved, not ratified, not merged.**
**Claim labels:** `VERIFIED` (directly observed in this session, with the command or `file:line`
that shows it) · `INFERRED` (reasoned from cited evidence) · `NOT YET VERIFIED`.

---

## 0. Conduct statement (read first)

1. **This document decides no policy.** Every item below is either (a) resolved by an authority I
   can cite, or (b) recorded as `NO APPROVED AUTHORITY — OWNER DECISION REQUIRED`. Where no approved
   authority exists I stopped the dependent subtask and recorded it here. I did not invent policy
   and did not decide on the OWNER's behalf.
2. **I did not self-approve.** This is not an approval, a ratification, a verification verdict, a
   merge authorisation or a deploy authorisation. It is a prepared approval package that stops at
   the approval boundary.
3. **No `OWNER-RATIFIED:` line is written by me**, and none may be inferred from this document.
4. **Fail-closed.** Where authority is unclear, absent or in conflict the default is not authorized.
   The "fail-closed default if the OWNER does nothing" column below is the operative consequence,
   not a neutral placeholder.
5. **Reported verdicts are reported, not produced.** I did not run an independent verification of
   any candidate. Where I quote a reviewer verdict I say who said it, when, and in what context —
   including the reviewer's own statement of its independence limits.

---

## 1. Method

### 1.1 Approved sources searched for authority

| Source | Searched for | Result |
|---|---|---|
| `src/config/permissions.js` (171 lines) | signup, first administrator, org-name uniqueness, rate limiting, D-2 sequencing | **No match on any of the five.** Matrix covers resource/action × role only (`permissions.js:11-30`) |
| `src/config/capabilities.js` (174 lines) | same | **No match.** The file states of itself: *"This module contains no authorization decisions. It is vocabulary and mapping only"* (`capabilities.js:11-13`) |
| `src/middleware/capability.middleware.js` (192 lines) | same | **No match.** It is the fail-closed 403 primitive (`capability.middleware.js:86-118`), not a policy source |
| `docs/architecture/ATM-003-R1-Role-Capability-Architecture.md` | signup ceremony, uniqueness, rate limiting, §3.3 invitation authority | **§3.3 found and cited.** No signup/rate-limit/uniqueness policy |
| `docs/architecture/ATM-000-Atiman-Product-Vision.md` | signup, self-service, first admin, registration, onboarding | **No match** |
| `docs/architecture/ATM-003-R3-Compatibility-Parity-Register.md` | signup, rate limit, captcha, verification, unique, duplicate | **No match** |
| `docs/architecture/ATM-003-Platform-Foundation.md` | rate limiting | **One generic requirement only**, and the document is *"Status: Controlled Architecture Document — **Draft for Review**"* (`ATM-003-Platform-Foundation.md:5`) |
| `docs/` (whole tree) | `organization-signup`, self-service signup, first administrator, rate limit, captcha, email verification | **Only** the #104-R3 authority comment on the 2A branch (cited in §5.1) |
| `database/postgresql/*.sql` | UNIQUE constraint on `organizations.organization_name` | **None exists** (`001_core.sql:5-22`) |

### 1.2 What the searches could and could not see

- They could see every tracked file on the frozen candidates I checked out ad hoc via `git show`.
- They could **not** see any artefact that is not committed to this repository. That limitation is
  material, because **the primary reviewer reports are not in the repository** (see §2.3).
- I recovered those reports from the DSH session transcripts on this workstation
  (`~/.dsh/sessions/--Users-gcb-Projects-Lihok-Technologies-atiman-platform--/*/session.v4.jsonl.zstd`,
  decompressed and searched). I quote them as **transmitted** evidence, and I label them accordingly.

### 1.3 Meaning of "NO APPROVED AUTHORITY"

Used below to mean: **I searched the approved sources listed in §1.1 for a rule that governs the
item, and found none.** It does not mean the item is forbidden; it means no ratified rule addresses
it, so under fail-closed it is *not authorized* and requires a direct OWNER act. Per the standing
instructions, a rule I did not consult could change this; the search scope is stated so it can be
challenged.

---

## 2. Source checkpoint verification

Every commit and tree below was resolved with `git rev-parse <sha>^{commit}` and
`git rev-parse <sha>^{tree}`. Nothing is inferred from an abbreviation.

### 2.1 Verification table

| Label | Stated commit | `rev-parse` commit | Stated tree | `rev-parse` tree | Match |
|---|---|---|---|---|---|
| Frozen main | `f156aa4479efe783eefd4f13fd62171647f83b7f` | same | (not stated) | `fd1aa33a49e1678890cbaa377be35453d0185634` | — |
| Bundle 2 A (#104-R3) | `7956ecfe3cbd92c76ff2c2cc9ba4af4b51cfaa56` | same | `e35e6aed516df7b212a40651d7c69a43d2b1ce61` | same | ✅ VERIFIED |
| Bundle 2 B | `0e6f8f9a2501b2f4a754eb4e1e7df1174cb59c82` | same | `1c7663427827446c8d65638e4e55c693dfa41f9e` | same | ✅ VERIFIED |
| Bundle 2 C | `0247cde5140ed277fcc06cf517710a2646bd643e` | same | `670ce55cfca60e4819f1fb6dcd91ab576f8aea12` | same | ✅ VERIFIED |
| Bundle 2 D | `7b0d6f4c2baac1109e94325550588cefaaafcb82` | same | `c55c9c70ad2e54266fbbd26c0e216081ebbd1f4e` | same | ✅ VERIFIED |
| #102 | `749043ba0aadc6d6b2f8a37ff53d2b59cd1cda5` | **NOT RESOLVABLE** | `149221d0e92ee96917a8e84feed4466e0dcf0e40` | `149221d0e92ee96917a8e84feed4466e0dcf0e40` | ❌ see §2.2 |
| #104 (earlier head) | `4b00462fcfc34b35f181e2a82c91b9b49562e302` | same | (not stated) | `0977a9d0a56547fd780544f856a3c33303ca0548` | ✅ commit VERIFIED |
| #93 (base of 2B) | `24b3f485f0c2eb73184015ff4160001c54c3c4f2` | same | (not stated) | — | ✅ commit VERIFIED |
| #98 | `5077c2d2b011b115976940bcc100e66dbe415b8c` | same | — | — | ✅ commit VERIFIED |
| #99 | `042aa33df6b01b70b564187e0119b09bfb1873f8` | same | — | — | ✅ commit VERIFIED |

### 2.2 Discrepancy V-1 — the stated #102 SHA is corrupt (VERIFIED)

The SHA transmitted in the mission, `749043ba0aadc6d6b2f8a37ff53d2b59cd1cda5`, is **39 characters**
and `git rev-parse` rejects it: `fatal: ambiguous argument ... unknown revision`.

The real commit is **`749043b7a0aadc6d6b2f8a37ff53d2b59cd1cda5`** (40 characters), confirmed by
`git rev-parse --disambiguate=749043` (single unambiguous match) and
`git for-each-ref` (`refs/heads/atm-001-sec-users-r3-reconciliation` and its origin counterpart).
Its tree is exactly the stated `149221d0e92ee96917a8e84feed4466e0dcf0e40`, which confirms identity.

**Impact:** the tree was correct and the commit identity is recoverable with certainty, so **no
substantive finding depends on this**. But the same corrupt string appears verbatim in the upstream
B3-D mission prompt, so the defect is **propagating between missions**. It is recorded as an
evidence-hygiene defect, not a content defect.

### 2.3 Discrepancy V-2 — the primary reviewer reports are not in the repository (VERIFIED)

- No `review-evidence/` directory exists in this repository at the frozen baseline.
- `git ls-tree` on all four candidate branches shows **no reviewer report** committed.
- A workspace-wide content search for the verbatim condition strings found **no committed
  artefact** containing them.

The reports exist only as DSH session transcripts. I located and read two of them:

| Bundle | Reviewer report | Where it lives |
|---|---|---|
| 2 B (`0e6f8f9`/`1c76634`) | "ADVERSARIAL RE-REVIEW RESULT — Mission B" | DSH session `9ba66fa2-bae2-42b4-841a-2a94ef586efd`, line 455 |
| 2 D (`7b0d6f4`/`c55c9c70`) | "INDEPENDENT ADVERSARIAL REVIEW — Mission D-1" | DSH session `f3402d09-48b5-4cbd-be55-af1071fa655b`, line 508 |

An additional VERIFIED fact from the same source: the B3-D mission's own reconnaissance recorded
that **no pull request carries a GitHub review** (`reviewDecision` empty, `reviews: none`), so the
"independent PASS" verdicts are **external reviewer verdicts reported to the mission**, not
GitHub-recorded approvals.

### 2.4 Discrepancy V-3 — the independence of the reviewers, in their own words (VERIFIED)

Both reviewer reports state their own limitation explicitly. Quoted verbatim:

- Bundle 2 B: *"PROCEDURE: I am a separate non-implementing context on the same workstation/model
  family (**procedural, not organisationally independent**). This is a technical verdict only — NOT
  merge/deploy/OWNER approval."*
- Bundle 2 D: *"Separate non-implementing context on the same workstation/model family
  (**procedural, not organisationally independent**). Not merge/deploy/OWNER approval."*

**Impact:** describing either as an "independent PASS" without this caveat overstates the
independence. This register therefore says **"separate-context reviewer verdict, self-declared
procedurally-but-not-organisationally independent"** wherever it reports one.

### 2.5 Discrepancy V-4 — the "five other callers" count (VERIFIED)

The D-1 commit message and the mission both say D-2 "has 5 other callers". My own enumeration of
`canAddUser(` call sites across `src/` gives **six**, plus one accessor:

```
src/services/subscription.service.js:351   this.canAddUser(organizationId)
src/middleware/seat-limit.js:23            subscriptionService.canAddUser(organizationId)
src/middleware/seat-limit.js:69            subscriptionService.canAddUser(organizationId)
src/controllers/invitation.controller.js:96   subscriptionService.canAddUser(organizationId)
src/controllers/invitation.controller.js:275  subscriptionService.canAddUser(invitation.organization_id)
src/controllers/auth.controller.js:202     subscriptionService.canAddUser(targetOrgId)
```
plus `getAvailableSeats()` (`subscription.service.js:158-161`, no `src/` caller found).

The mission's list names **four** sites and calls them five. Two of the six are inside
`invitation.controller.js` — **the very controller D-2 is said to mask** — which materially
strengthens the D-2 activation question in §5.4.

---

## 3. PART A — Bundle 2 B residual OWNER act

### A.0 Binding

- Candidate: commit `0e6f8f9a2501b2f4a754eb4e1e7df1174cb59c82`, tree `1c7663427827446c8d65638e4e55c693dfa41f9e`
- Parent: `203b36a0b35074c537c795067c477e8c3acad97c` (tree `24b33b61898ba13477ae794872d5ed51319cf050`)
- Base: `24b3f485f0c2eb73184015ff4160001c54c3c4f2` (PR #93 head) — VERIFIED ancestor of `0e6f8f9`
- Superseded and VERIFIED ancestors of #93: #90 `adb7cb8c`, #91 `4910d8cb`, #92 `1524fbde`

### A.1 Reported verdict (verbatim, from the reviewer's item 9)

> "VERDICT: PASS on c1 and c2 (both independently reproduced and verified); **CONDITIONAL
> overall**. Single remaining condition, one sentence: the OWNER must adjudicate E1 (legacy pending
> administrator invitations) and the E3/E4 scope — confirming the recorded acknowledgement that an
> invitation-only D-1 repair does not fix the accept path — and should confirm or reject the E2
> source-based resolution; none of that is a DSH-act and none of it exists in the tree. If the
> OWNER's c3 intent was only 'record the escalations and the required acknowledgement', then section
> G satisfies it and I would call the candidate PASS — the residual is procedural, not a code
> defect. No code-level blocking finding."

**Note (claim discipline):** the transmitted source checkpoint called this "independent PASS for
c1/c2; one residual OWNER act". The reviewer's own words are **CONDITIONAL overall**, not PASS, and
the reviewer self-declares as not organisationally independent (§2.4). Both corrections are
registered here.

### A.2 Recorded escalation text at the candidate (VERIFIED)

The candidate records the escalations in `tests/invitation-lifecycle-residuals.test.js` at
`0e6f8f9`, section G (lines 1081-1157):

- **G1** (`:1088`) — `E1 ... OPEN OWNER escalation: legacy pending ADMINISTRATOR invitations`
- **G2** (`:1106`) — `E2 ... RESOLVED from approved sources — NOT an open escalation`
- **G3** (`:1131`) — `E3/E4 ... OPEN OWNER escalation, with the accept-path acknowledgement it MUST carry`
- **G4** (`:1149`) — `(c2) OPEN OWNER escalation: no delivery path for an EXISTING pending invitation`

The file header (`:64-68`) states: *"(c3) OWNER ADJUDICATIONS. Section G records E1 and E3/E4 as OPEN
OWNER escalations (with the required acknowledgement that an invitation-only D-1 repair does not fix
the accept path), and records E2 as RESOLVED from approved sources rather than an open escalation."*

---

### A-ITEM 1 — E1: legacy pending administrator invitations

**Verbatim condition (reviewer, item 9):**
> "the OWNER must adjudicate E1 (legacy pending administrator invitations) and the E3/E4 scope"

**Verbatim recorded question (candidate, `tests/invitation-lifecycle-residuals.test.js:1089-1097`):**
> "E1 is an OWNER question. Some existing tenants hold pending invitations whose stored role is
> `admin`, issued before the current role-issuance authority existed. Whether those may still be
> accepted, must be re-validated against the issuing principal's current authority, or must be
> retired changes WHO MAY ENROLL — a product-policy decision this mission deliberately does not take."

**Exact binding:** commit `0e6f8f9a2501b2f4a754eb4e1e7df1174cb59c82`, tree `1c7663427827446c8d65638e4e55c693dfa41f9e`
**Current status:** OPEN. VERIFIED: the accept arm carries no `roleIssuanceAuthority` call (G1 asserts
`!/roleIssuanceAuthority/` over the accept arm), and no adjudication exists anywhere in the tree.
**Governing authority: NO APPROVED AUTHORITY — OWNER DECISION REQUIRED.** Searched §1.1; no approved
source addresses pre-SEC-00E administrator invitations. The condition itself is an OWNER act by
construction ("none of that is a DSH-act").

**Fail-closed default if the OWNER does nothing:** the pre-SEC-00E administrator invitations remain
acceptable as they stand. Acceptance grants `role` from the **stored** row with no re-validation
against the issuing principal's *current* authority. Fail-closed is *not* automatic here: doing
nothing preserves an enrolment path that the newer role-issuance authority would not today authorize.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Accept them as-is | Historical invitations keep working; a role issued under a superseded authority remains redeemable. No migration, no data change. |
| (b) Re-validate at acceptance against the issuing principal's current authority | Tightest; may strand legitimate pending invitations if the issuer has since lost authority. Requires an accept-path code change (new gate) and new tests. |
| (c) Retire them (expire/cancel) | Cleanest end-state; is a destructive data change against live rows, needs a migration, and would need its own authorisation and evidence. |

**Proposed decision (narrowly scoped — for OWNER action, not decided here):** select exactly one of
(a)/(b)/(c) **for the class "pending invitations whose stored role is `admin` and whose `created_at`
precedes the SEC-00E role-issuance authority"**, and state whether it applies to all tenants or named
tenants. If (b) or (c), state the cut-off identifier (commit or migration version) that defines
"before SEC-00E".

---

### A-ITEM 2 — E2: is a separate authority required to cancel a higher-role invitation?

**Verbatim recorded resolution (candidate, `:1107-1118`):**
> "E2 ("must a separate authority exist to cancel a HIGHER-ROLE invitation?") is resolvable from
> approved sources, so it must not be left open:
>   - cancellation confers NO enrolment and NO role: it forecloses an enrollment that already exists,
>     and the only thing it writes is `status = 'cancelled'`;
>   - ATM-003-R1 section 3.3 grants "Manage users, invitations, roles" at Tenant scope to the Tenant
>     Administrator profile, which covers cancelling any invitation in the tenant;
>   - `roleIssuanceAuthority` answers "may this principal ISSUE this role", which correctly applies to
>     RE-ISSUE (resend), not to cancel."

**Verbatim reviewer judgement (item 4):**
> "MY E2 JUDGEMENT: genuinely resolvable from approved sources — ATM-003-R1 §3.3 grants
> `org.user_admin | Tenant | Manage users, invitations, roles`, the capability map routes
> USERS.VIEW/CREATE/DELETE to it, cancel writes only `status='cancelled'` and confers no
> account/role/enrolment, and roleIssuanceAuthority answers "may this principal ISSUE this role"
> (creation/re-issue), not "may this principal cancel". So E2 should NOT remain an open escalation and
> the resolution is correct in substance. **Caveat: "RESOLVED" is the implementer's source-grounded
> characterisation, not an OWNER act** (the test does not claim OWNER authority, so no forgery) — the
> OWNER should confirm it."

**Exact binding:** commit `0e6f8f9a2501b2f4a754eb4e1e7df1174cb59c82`, tree `1c7663427827446c8d65638e4e55c693dfa41f9e`

**Governing authority: APPROVED AUTHORITY EXISTS (VERIFIED).** The authority the resolution cites is
real, and I verified it independently at the frozen baseline:

- `docs/architecture/ATM-003-R1-Role-Capability-Architecture.md:75` — heading
  `### 3.3 Organization and platform administration`
- `docs/architecture/ATM-003-R1-Role-Capability-Architecture.md:79` — the row
  `| `org.user_admin` | Tenant | Manage users, invitations, roles |`
- `src/middleware/rbac.js:453` defines `roleIssuanceAuthority`; at `0e6f8f9` it is called at
  `src/controllers/invitation.controller.js:620` (the **resend / re-issue** arm) and
  `src/middleware/rbac.js:494` (register) — and **nowhere in the cancel arm** (VERIFIED: the cancel
  arm contains no `roleIssuanceAuthority` call).

**Status:** **RESOLVABLE BY APPROVED AUTHORITY — OWNER CONFIRMATION ONLY.** The substance is
grounded; what remains is that *no DSH worker may mark it resolved*, because "RESOLVED" in the tree
is an implementer characterisation, not an OWNER act.

**Fail-closed default if the OWNER does nothing:** the tree continues to assert "E2 RESOLVED from
approved sources" while the OWNER has not confirmed it. Under fail-closed, an unconfirmed
characterisation confers no authority: cancellation remains authorized **only** by
`org.user_admin`, and the classification of E2 as "closed" is unratified. In practice the route keeps
working (the guard is unchanged); what is unresolved is the *record*, not the behaviour.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Confirm E2 as resolved on the cited authority | E2 leaves the escalation list; the register's only remaining 2B items are E1 and E3/E4. No code change. |
| (b) Reject / re-open E2 | A new gate must be designed for the cancel path (does cancelling a higher-role invitation need role-issuance authority?); that is a behaviour change to a live route and needs its own mission. |

**Proposed decision (narrowly scoped):** confirm or reject the E2 resolution **on exactly these two
grounds** — (i) `ATM-003-R1-R3 §3.3`/`:79` grant of "Manage users, invitations, roles" at Tenant
scope covers cancellation; (ii) `roleIssuanceAuthority` governs issue/re-issue, not cancel.

---

### A-ITEM 3 — E3/E4: scope, and the mandatory accept-path acknowledgement

**Verbatim condition (reviewer item 9):**
> "the OWNER must adjudicate E1 (legacy pending administrator invitations) and the E3/E4 scope —
> confirming the recorded acknowledgement that an invitation-only D-1 repair does not fix the accept
> path"

**Verbatim recorded text (candidate, `:1131-1147`):**
> "E3/E4 are scope questions for the OWNER. Any E3 acceptance must acknowledge: an invitation-only
> D-1 repair (for example giving `Invitation.createInvitation` a RETURNING id) does NOT fix the
> accept path. `POST /api/invitations/accept` creates the account through `User.create` ->
> `BaseModel.create` on the `users` table, which still never reads the generated id, so acceptance
> still throws and still returns 500 after the account row commits. The invitation-side repair is
> NOT implemented here and is NOT claimed to close anything."

**Exact binding:** commit `0e6f8f9a2501b2f4a754eb4e1e7df1174cb59c82`, tree `1c7663427827446c8d65638e4e55c693dfa41f9e`

**The acknowledgement is independently TRUE (VERIFIED at the frozen baseline):**
- `src/models/base.model.js:123-133` — `BaseModel.create` runs a bare `INSERT ... VALUES (...)` with
  **no `RETURNING`** and reads `const insertId = (result && result.insertId) || ...` (`:131`), then
  `return this.findById(insertId)` (`:132`).
- `src/models/base.model.js:94-101` — `findById` is `SELECT * FROM ${tableName} WHERE id = ?`.
- The accept arm calls `User.create(...)`, so an invitation-only repair of
  `Invitation.createInvitation` cannot fix accept. **Confirmed.**

**E3/E4 definitions — limit of this register (claim discipline).** The labels "E3" and "E4" are
**NOT defined in any primary artefact in the repository**, and the reviewer report I recovered treats
them as a joint "scope" question without enumerating them. The worker who implemented c3 recorded
this explicitly in-session: *"There's no explicit E1/E2/E3/E4 escalation list in the repo yet... The
escalation list E1-E4 likely came from the VUDA review which is not in the repo."* I therefore
register E3/E4 **as transmitted** and flag that their precise content is `NOT YET VERIFIED`.

**Governing authority: NO APPROVED AUTHORITY — OWNER DECISION REQUIRED.**

**Fail-closed default if the OWNER does nothing:** an invitation-only D-1 repair must not be treated
as closing acceptance, and the accept path remains broken (500 after a committed account row) under
unrepaired D-1. Any future mission that appears to "fix invitations" without fixing
`BaseModel.create` on `users` must be treated as **not fixing accept**.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Accept E3/E4 scope **with** the acknowledgement | Invitation-side work may proceed, but every record must state accept is not fixed. |
| (b) Accept E3/E4 **without** the acknowledgement | Refused: the acknowledgement is a condition of acceptance, not an optional note. |
| (c) Reject/defer E3/E4 | Invitation-side scope stays closed; no invitation-side repair may land. |

**Proposed decision (narrowly scoped):** (i) state what E3 and E4 each are — the register cannot
supply their content; (ii) state the E3/E4 scope boundary; (iii) record that any E3 acceptance
**carries** the acknowledgement above.

---

### A-ITEM 4 — The c2 delivery gap (registered because it is an OPEN escalation on the same candidate)

**Verbatim (candidate, `:1149-1156`):** *"G4. (c2) OPEN OWNER escalation: no delivery path for an
EXISTING pending invitation... The gap condition (c2) describes is recorded as an escalation, NOT
repaired and NOT worked around by re-exposing the listing token."*

**Reviewer's independent measurement (item 3):** *"CREATE → 500 ... invitation row persisted pending
with a live 64-hex token, response contains no token, delivered-email count 0. RESEND → 500 same,
original invitation still pending with unchanged token, TWO pending rows both with live tokens,
delivered 0."*

**Governing authority: NO APPROVED AUTHORITY for accepting a permanent delivery gap** — the
fail-closed default is that no delivery path exists, and no product-policy source in §1.1 addresses
it. **Fail-closed default if the OWNER does nothing:** tenants with existing pending invitations
cannot obtain a link for them.

**Proposed decision (narrowly scoped):** state whether a delivery path for existing pending
invitations is required, and if so under which authority (the reviewer explicitly warns against
re-exposing the listing token as a workaround).

---

## 4. PART B — The FOUR Bundle 2 D conditions

### B.0 Binding and reported verdict

- Candidate: commit `7b0d6f4c2baac1109e94325550588cefaaafcb82`, tree `c55c9c70ad2e54266fbbd26c0e216081ebbd1f4e`
- Merge-base with frozen main: `f156aa44` (VERIFIED — reviewer item 1, and `git diff --stat` gives exactly 10 files, +1203/-111)
- Relationship to #104: `4b00462` is a **VERIFIED ancestor** of `7956ecf`; lineage is
  `b795a04 → 4b00462 → ce9947b → 7956ecf`.

**Reported verdict (verbatim, reviewer header):**
> "VERDICT for HEAD 7b0d6f4c2baac1109e94325550588cefaaafcb82 / tree c55c9c70ad2e54266fbbd26c0e216081ebbd1f4e:
> **PASS on the D-1 repair, with 4 conditions attached** (below). Every material implementer claim I
> tested is confirmed by independent row-state evidence; no regression found in the change; all
> findings are residual-scope, claim-accuracy or evidence-gap."

The four conditions are at reviewer item 10, labelled **C1–C4**, and the mission's B1–B4 reproduce
them. I verified each against the reviewer text: **B1, B2 and B4 are verbatim identical to C1, C2 and
C4**; **B3 is C3 with a line reference added** (`organization.controller.js:184-196`, which the
reviewer gives in item 6 rather than in C3). Both forms are registered.

---

### B-ITEM 1 — Semantic merge with #93 (one retirement mechanism + retain the 409 guard)

**Verbatim (reviewer C1):**
> "Any merge with #93 must be resolved semantically: keep exactly ONE retirement mechanism inside the
> transaction and retain #93's duplicate-email 409 guard, because the candidate alone answers that
> case 500 with raw driver text."

**Reviewer's supporting measurement (item 7):**
> "#93's accept also carries a duplicate-email pre-check (409, no driver disclosure) that the
> candidate lacks — I measured candidate 500 with raw `uq_users_email` text vs #93's 409. #93's
> `accept()` is attribution-only (retirement moved to claimForAcceptance) while the candidate's sets
> status='accepted'; a textual merge that takes the candidate's accept wholesale loses #93's B2
> control, and one that keeps both retirement mechanisms is incoherent."

**Exact binding:** the condition binds the **merge** of `7b0d6f4`/`c55c9c70` with
`0e6f8f9`/`1c76634`. Both sides VERIFIED independently:

| Claim | Verified where |
|---|---|
| #93 retirement is `claimForAcceptance` (`SET status = 'accepted'`) | `src/models/invitation.model.js:142-146` @ `0e6f8f9` |
| #93 `accept()` is attribution-only | `src/models/invitation.model.js:155-167` @ `0e6f8f9` |
| #93 has the duplicate-email 409 guard on accept | `src/controllers/invitation.controller.js:444-462` @ `0e6f8f9` (comment at `:451-459` records the reproduced 500 `duplicate key value violates unique constraint uq_users_email`) |
| D candidate's retirement is `accept()` (`SET status = 'accepted', accepted_at, accepted_by_user_id`) | `src/models/invitation.model.js:153-155` @ `7b0d6f4`; called at `src/controllers/invitation.controller.js` accept arm |
| D candidate's lock is a read, not a retirement | `src/models/invitation.model.js:85-99` @ `7b0d6f4` (`SELECT ... FOR UPDATE OF i`) |
| D candidate's accept arm has **no** duplicate-email guard | accept arm @ `7b0d6f4` — the four 409s in the file are at other checks |
| `uq_users_email` exists | `database/postgresql/001_core.sql:69` |
| Textual auto-merge really is incoherent | B3-D reconnaissance reproduced the merged file retaining **both** `findByTokenForUpdate` and `claimForAcceptance`, with `accept()` taking B2B's body and D1's signature |

**Governing authority:** the *security* half (retain the 409 guard) is not a policy choice — losing a
control is a regression, and **NO APPROVED AUTHORITY authorises dropping it**. The *engineering*
half (which single retirement mechanism to keep) is **not determined by any approved source I could
find**: both are implementation choices, each individually sound.

**Status:** **NOT RESOLVED.** The B3-D mission permitted either implementing the reconciled form or
stopping and recording it as an OWNER decision; the reconciled form was implemented in the draft
integration candidate, which is **not merged, not approved, and itself carries the other three
conditions**.

**Fail-closed default if the OWNER does nothing:** no merge of #93 and D-1 occurs, or a textual merge
ships and silently loses #93's duplicate-email 409 guard (raw `uq_users_email` driver text on a 500),
because a textual merge is what the branches produce by default.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Keep #93's `claimForAcceptance` as the single retirement, D1's `FOR UPDATE` as a read/lock only, and keep the 409 guard | Exactly one retirement mechanism; both controls survive; matches reviewer's framing. Requires the reconciled accept arm. |
| (b) Keep D1's `accept()`-as-retirement, drop #93's claim, keep the 409 guard | One retirement mechanism, but discards #93's claim design and its ordering guarantee. |
| (c) Textual merge | Rejected by the condition: two retirement mechanisms and a lost control. |

**Proposed decision (narrowly scoped):** approve **one** retirement mechanism — the register proposes
(a) as the control-maximising form but does not decide it — and confirm that the duplicate-email 409
guard is retained on the accept path **unconditionally**.

---

### B-ITEM 2 — Invert/retire #104's S2–S4 D-1 pins

**Verbatim (reviewer C2), mission B2 identical:**
> "#104's S2–S4 D-1 pins must be inverted/retired in the merge (they assert the defect) and their S9
> passes."

**Reviewer's supporting text (item 7):**
> "#104 (7956ecf) verified as claimed: tests/organization-signup.integration.test.js S2/S3/S4 pin the
> defect (500 + one orphan + permanent 409) and will fail identically after this fix, while S9 (201 +
> 1 org + 1 admin + 1 sub, atomically) passes; that file and scripts/run-integration-tests.js
> tests/database-test-guard.test.js also conflict textually with #104's edits."

**Exact binding:** commit `7956ecfe3cbd92c76ff2c2cc9ba4af4b51cfaa56`, tree `e35e6aed516df7b212a40651d7c69a43d2b1ce61`;
the merge target is `7b0d6f4c2baac1109e94325550588cefaaafcb82`.

**VERIFIED independently by me at `7956ecf`** (`tests/organization-signup.integration.test.js`):

| Pin | Line | Test name (verbatim) |
|---|---|---|
| S1 | `:212` | `S1. the endpoint is mounted and anonymous, and a real free plan exists` |
| S2 | `:226` | `S2. anonymous signup answers HTTP 500 and persists ONE ORPHAN organization with ZERO users and ZERO subscriptions (D-1 pinned)` |
| S3 | `:277` | `S3. the failure is NOT transactional: the partial write is committed and visible from independent connections` |
| S4 | `:296` | `S4. ORPHAN-RECORD behaviour: a retry of the same name is refused 409 and the orphan blocks it permanently` |
| S9 | `:422` | `S9. INTENDED contract: 201 with exactly one organization, one administrator and one subscription, atomically` |

S9 carries `{ todo: 'D-1 open: BaseModel.create never populates insertId, so signup commits an orphan
and answers HTTP 500' }` (`:423`) — i.e. S9 is currently a **todo**, not a real pass; "their S9
passes" means it becomes satisfiable once D-1 is repaired.

**VERIFIED:** `tests/organization-signup.integration.test.js` is **ABSENT** at `7b0d6f4`
(`git cat-file -e` → `does not exist`) — the file is introduced by #104, which is why the merge must
reconcile it.

**Governing authority: NO APPROVED AUTHORITY is needed to invert a pin that asserts a repaired
defect** — the inversion is determined by the repair itself, not by policy. What *is* an OWNER act is
**authorising the merge** that performs the inversion (Art. 13.2 — merge remains an OWNER act), and
**accepting that the inverted assertions are the correct new evidence standard**.

**Fail-closed default if the OWNER does nothing:** if #104 lands unchanged, its S2–S4 pins *assert
the defect*; after the D-1 repair they fail. A red suite must not be "fixed" by weakening the
assertions, so the fail-closed outcome is that the merged tree cannot pass its own acceptance suite.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Invert/retire S2–S4 and keep S9 as the intended-contract assertion | Suite matches the repaired behaviour; S9 must be un-todo'd and must genuinely pass. |
| (b) Leave S2–S4 | Red suite on the merged tree; the pins now assert behaviour the repair removed. |
| (c) Delete S2–S4 outright | Loses the historical record that the defect was reproduced; the register records that inverting is preferable to deleting. |

**Proposed decision (narrowly scoped):** approve inverting S2–S4 to assert the *repaired* contract
and un-todo'ing S9, **in the same change that lands the D-1 repair**, on the evidence that S9 passes
against the repaired tree.

---

### B-ITEM 3 — Accept the disclosed residuals as out-of-envelope

**Verbatim (reviewer C3):**
> "Accept as out-of-envelope the disclosed residuals: the six-plus non-BaseModel INSERT sites that
> still read insertId with no RETURNING (inspection.model.js:42, inspection-result.model.js:39,
> custom-field.model.js:72, maintenance-plan.controller.js:116, asset-import.service.js:235/408,
> task-template.model.js:311) — materially more than the four files the commit message names — plus
> the un-transacted POST /api/organizations org+admin window and the still-live GET /api/users/:id
> password_hash disclosure."

**Mission B3 form (adds the controller line reference from reviewer item 6):**
> "... plus the un-transacted POST /api/organizations org+admin window (`organization.controller.js:184-196`)
> and the still-live `GET /api/users/:id` password_hash disclosure."

**Exact binding:** commit `7b0d6f4c2baac1109e94325550588cefaaafcb82`, tree `c55c9c70ad2e54266fbbd26c0e216081ebbd1f4e`

**VERIFIED independently by me (frozen baseline = the cited tree's base).** Each named INSERT site
does read `insertId` with no `RETURNING` at that site:

| Site (as cited) | `insertId` read VERIFIED at | `RETURNING` at the site |
|---|---|---|
| `inspection.model.js:42` | `:45` `return this.getReadingById(result.insertId, organizationId);` | none |
| `inspection-result.model.js:39` | `:42` `return this.getResultWithDetails(result.insertId, organizationId);` | none |
| `custom-field.model.js:72` | `:95` `logHistory(result.insertId, ...)`, `:97` `getDefinitionById(result.insertId)` | none |
| `maintenance-plan.controller.js:116` | `:131` `data: { id: result.insertId }` | none |
| `asset-import.service.js:235` | `:246` `id: result.insertId,` | none |
| `asset-import.service.js:408` | `:433` `return { ...assetData, id: result.insertId };` | none |
| `task-template.model.js:311` | `:340` `const templateId = templateResult.insertId;` | none |

Across `src/`, `RETURNING` appears 22 times and **only** in knowledge-provenance / knowledge-crosswalk
/ knowledge-pack / `task-template.model.js:1176,1231` / `observation.service.js` — i.e. the class
repair is partial by design.

**The un-transacted `POST /api/organizations` window — VERIFIED (reviewer item 6):** *"One genuine
un-transacted partial-write window remains in-repo: `src/controllers/organization.controller.js:184–196`
(POST /api/organizations, admin) creates Organization then User with no transaction, so an admin-path
failure still leaves an orphan tenant."* I confirmed the code shape at `organization.controller.js:184-196`.

**The `GET /api/users/:id` password_hash disclosure — VERIFIED by me, and still live on the candidate:**
- `src/routes/user.routes.js:104` — `router.get('/:id', canManageUser, async (req, res, next) => {`
- `:107` — `const user = await User.findById(userId);`
- `:117-120` — `res.json({ success: true, data: { user } });` — **no `sanitizeUser` projection**
- `User.findById` is `BaseModel.findById` (`src/models/base.model.js:94-101`) = `SELECT * FROM users WHERE id = ?` → includes `password_hash`
- `src/utils/helpers.js:88-91` — `sanitizeUser` exists and strips `password_hash`, and the D-1 candidate *did* apply it to `POST /api/users` and `PUT /api/users/:id` — **but not to `GET /api/users/:id`**
- The reviewer measured it live: *"`GET /api/users/:id` returns 200 with `password_hash` = real bcrypt hash (observed on pristine, candidate, M3, M3M7)."*

**Additional residual the reviewer disclosed that the transmitted condition omits — VERIFIED as
present at the baseline:** `src/models/base.model.js` logs every INSERT parameter to stdout:
`console.log('[BASE MODEL] Params:', validParams)`. **Line number depends on the tree and both are
VERIFIED:** at the candidate `7b0d6f4` it is `src/models/base.model.js:54` (the reviewer's citation,
correct for the tree the condition binds to); at frozen main `f156aa44` the same statement is
`src/models/base.model.js:29` (the D-1 repair moved it). The reviewer recorded: *"logs every INSERT
parameter, including the bcrypt hash... unchanged by this diff, worth escalating separately."*
Because the finding is material and the transmitted condition does not name it, I register it as
**B-ITEM 3b** below rather than silently folding it in.

**Governing authority: NO APPROVED AUTHORITY — OWNER DECISION REQUIRED.** *Accepting a security
residual as out-of-envelope is an acceptance of risk.* No source in §1.1 grants any DSH worker the
authority to accept residual security risk; per fail-closed, an item no ratified rule addresses is
not authorized.

**Fail-closed default if the OWNER does nothing:** the residuals stay in scope and **are not
accepted** — meaning the D-1 repair cannot be treated as security-complete, and each residual
remains an open finding rather than a dispositioned one. In particular the live `GET /api/users/:id`
credential disclosure remains an open finding.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Accept all three classes as out-of-envelope | D-1 becomes closable as scoped; the residuals must be recorded as accepted and assigned to another owner/mission. |
| (b) Accept only some | D-1 remains partially open; name which class stays open. |
| (c) Reject the acceptance | D-1's envelope must be widened or the residuals fixed before D-1 can close. |

**Proposed decision (narrowly scoped):** a per-class disposition (`ACCEPTED-out-of-envelope` /
`NOT ACCEPTED`) for exactly these classes, each with a named receiving mission:
(1) the seven residual non-`BaseModel` INSERT sites; (2) the un-transacted `POST /api/organizations`
window at `organization.controller.js:184-196`; (3) the `GET /api/users/:id` `password_hash`
disclosure; (4) **B-ITEM 3b** the `base.model.js:54` INSERT-parameter stdout log.

---

### B-ITEM 4 — Add a resend failure-injection case (M8)

**Verbatim (reviewer C4), mission B4 identical:**
> "If the evidence standard requires every write site to be mutation-detected, add a resend
> failure-injection case, since M8 (non-transactional resend) escapes the suite and I demonstrated it
> yields two live pending tokens."

**Reviewer's mutation evidence (item 5, verbatim):**
> "MY MUTATIONS: **M8 resend non-transactional → ESCAPED 18/18** — a real evidence gap: no case
> injects a failure into resend, and **I proved the consequence (2 live pending tokens) on the
> mutant**"

**Exact binding:** commit `7b0d6f4c2baac1109e94325550588cefaaafcb82`, tree `c55c9c70ad2e54266fbbd26c0e216081ebbd1f4e`
(the suite in question is `tests/onboarding-atomicity.test.js`, added by that commit).

**VERIFIED corroboration:** the B3-D reconnaissance reproduced the same condition on the merged
resend handler — the B2B side is `createInvitation(...)` then `cancel(invitationId)` with no
transaction, the D1 side is create-then-cancel with `conn`. So the gap is not hypothetical.

**Governing authority: NO APPROVED AUTHORITY mandates per-write-site mutation detection.** I
searched `docs/` for a mutation-testing standard. What exists is **milestone-specific evidence
practice**, not a ratified general standard:

- `docs/architecture/ATM-001-KF-06-Knowledge-Evidence-Deletion-Integrity.md:230` —
  *"Mutation testing: the suite fails appropriately with the fix removed | **Confirms the tests are
  non-vacuous**"*
- `docs/architecture/ATM-001-Knowledge-Foundation-V1-Acceptance-Register.md:52`, `:167`, `:294` —
  mutation testing as an **independent-verifier technique on KF-06**, not a repo-wide obligation.
- The CI verification contract requires suites to be **registered and executed**
  (`docs/CI-VERIFICATION-CONTRACT.md` §4), not that every write site be mutation-detected. That
  document is additionally **branch-local and not merged**, and its own §3 records a known-failing
  job.

The condition is therefore **conditional on its own premise** ("If the evidence standard requires
every write site to be mutation-detected"). I could not find such a standard.

**Fail-closed default if the OWNER does nothing:** M8 remains an undetected mutation — a future change
that makes resend non-transactional will pass the suite while producing two live pending tokens. The
suite stays silent on the exact defect class the D-1 repair claims to close.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Declare that the evidence standard *does* require it; add the case | Suite becomes non-vacuous for resend; new test must fail on the non-transactional mutant (the reviewer already demonstrated the mutant). |
| (b) Declare it does *not* require it | The gap is accepted as a known limitation and must be recorded as such, not left implicit. |

**Proposed decision (narrowly scoped):** settle the premise — state whether the accepted evidence
standard requires every write site to be mutation-detected. If **yes**, authorise adding exactly one
resend failure-injection case with the M8 mutant as its falsification control. If **no**, record M8
as an explicit accepted evidence gap on the D-1 candidate.

---

## 5. PART C — The four product-policy questions with NO approved authority

### C-ITEM 1 — The first-administrator ceremony

**The question (as transmitted):** on `POST /api/auth/organization-signup` the first person to POST
becomes the tenant's `role='admin'`, `is_organization_admin=true`, with a password they choose, no
verification, no invite, no approval — and after the D-1 repair signup genuinely creates tenants.
Is that approved? What should the ceremony be?

**VERIFIED behaviour at the frozen baseline** (`src/controllers/auth.controller.js`):

| Fact | Line |
|---|---|
| Handler | `:398` `const organizationSignup = async (req, res, next) => {` |
| Pre-write duplicate-name check → 409 | `:478-484` `const existingOrg = await Organization.findByName(organization_name);` → `res.status(409)` |
| Organization created | `:487` `const organization = await Organization.create({` |
| First user becomes tenant admin | `:503` `role: 'admin',` |
| First user is the org admin | `:505` `is_organization_admin: true,` |
| Password is the requester's own, hashed | `:497-509` (`password_hash: passwordHash`) |
| Auto-login token returned | `:542-545` |
| Route is anonymous and unlimited | `src/routes/auth.routes.js:14` `router.post('/organization-signup', authController.organizationSignup);` — no middleware |
| No verification / invite / approval step | VERIFIED: no such code exists in the handler or the route |

**What approved authority DOES exist (VERIFIED — partial):** the endpoint's **existence and
anonymity** are approved, recorded on the 2A branch at
`src/routes/organization.routes.js:39-42` @ `7956ecf`:

> "Tenant self-registration exists, is approved, and is deliberately separate: `POST /api/auth/organization-signup`
> ... is the pre-authentication self-service tenant-registration endpoint reached by `views/signup.ejs`.
> It is approved, it is deliberately anonymous, and it neither requires nor should require `platform.admin`."

The same file (`:47-63`) labels the full ceremony a **"CORRECTED CLAIM"** and calls the 201-with-admin
contract the *"Intended contract (NOT observed at this head, and deliberately NOT repaired here)"*.

**Governing authority for the CEREMONY: NO APPROVED AUTHORITY — OWNER DECISION REQUIRED.** The
approval above covers *that the endpoint exists and is anonymous*. It does **not** approve the
ceremony's details (who becomes admin, whether the password is self-chosen, whether any verification
precedes tenant creation). Nothing in §1.1 addresses them.

**Fail-closed default if the OWNER does nothing:** the ceremony as implemented continues, and — once
D-1 is repaired — any anonymous caller who POSTs first obtains a real tenant with a real
`role='admin'`, `is_organization_admin=true` principal and a 30-day Free subscription, with no
verification and no approval. The fail-closed default is **not** "no tenant" — the endpoint is
approved and stays mounted, so doing nothing means the current ceremony is what ships.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Ratify the current ceremony | No code change; anonymous first-POSTer is the tenant admin. |
| (b) Require contact verification before the tenant exists | Tenant creation becomes conditional; needs a pending-state design, a delivery path, and a schema/migration change. |
| (c) Require an invite/approval step | Contradicts the recorded approval of *self-service* registration; needs a redesign and re-approval of the endpoint's authority. |
| (d) Split: create tenant but hold admin until verified | Middle path; needs a new intermediate state. |

**Proposed decision (narrowly scoped):** ratify or replace the ceremony — specifically (i) whether
the first anonymous POSTer becomes `role='admin'`/`is_organization_admin=true`, (ii) whether the
password may be self-chosen, and (iii) whether any verification or approval precedes tenant
creation.

---

### C-ITEM 2 — Duplicate organization name

**The question (as transmitted):** today a pre-write SELECT-then-409 (TOCTOU) with NO unique
constraint on `organizations.organization_name`. Options: keep 409 (accept the race), add a UNIQUE
constraint (409/23505), or make signup idempotent. Which is approved?

**VERIFIED:**
- `database/postgresql/001_core.sql:5-22` — `CREATE TABLE IF NOT EXISTS organizations (... organization_name varchar(255) NOT NULL, ... PRIMARY KEY (id));` — **no UNIQUE constraint, no unique index anywhere on that column** (VERIFIED by searching all of `database/`).
- `src/controllers/auth.controller.js:478-484` — the check is a **pre-write read**, then 409: TOCTOU.
- The D-1 commit message records the consequence in the implementer's own words: *"`organizations.organization_name` has no UNIQUE constraint, so the pre-check is TOCTOU. **Anonymous tenant-name squatting**."*
- The reviewer independently measured the squat: *"anon signup — pristine: 500, after = 1 org / 0 users / 0 subs, retry 409 (**permanent squat**)."*

**Governing authority: NO APPROVED AUTHORITY — OWNER DECISION REQUIRED.** Nothing in §1.1 addresses
organization-name uniqueness or re-registration.

**Fail-closed default if the OWNER does nothing:** the TOCTOU window stays open and **no constraint
enforces uniqueness**. Two concurrent signups with the same name can both pass the pre-check; a lost
race surfaces as a raw unique/driver error or an orphan, not a clean 409. Doing nothing is *not*
fail-closed here — it leaves a public, anonymous squatting vector with no database-level backstop.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Keep the pre-write 409 and accept the race | No schema change; the race and the orphan-squat remain. |
| (b) Add a UNIQUE constraint on `organization_name` | Database-level enforcement; requires a migration and a 23505 → 409 mapping; a migration on a live table with existing duplicates would need a pre-check. NOTE: the D-1 commit records migration **022** makes capability grants undeletable, so migrations here have residue risk and need care. |
| (c) Make signup idempotent | Requires a policy on *identity* of an organization (is same-name the same tenant?) — a product decision in its own right; may conflict with (b). |

**Proposed decision (narrowly scoped):** choose exactly one of (a)/(b)/(c) **and**, if (b), state
whether the constraint is applied to existing rows (and what happens to pre-existing duplicates).

---

### C-ITEM 3 — Public signup rate limiting / verification

**The question (as transmitted):** `POST /api/auth/organization-signup` is anonymous, unauthenticated,
unlimited, and now really creates a tenant + administrator + subscription per request. Should it be
rate-limited, CAPTCHA'd, and/or contact-verified before a tenant exists?

**VERIFIED:**
- `src/routes/auth.routes.js:14` — the route has **no** middleware at all: `router.post('/organization-signup', authController.organizationSignup);`
- A search of `src/` for rate-limiting shows it exists **only on the API-key path**
  (`src/middleware/api-auth.middleware.js:39-79`, `src/models/api-key.model.js:345-363`,
  `api_rate_limit_tracking`), **not** on any auth route. There is no CAPTCHA and no contact
  verification anywhere in `src/`.
- Per request, the handler creates an organization (`:487`), an `admin` user (`:497-509`), and a Free
  subscription (`:516-530`).

**The only candidate authority, and why it does not decide this (VERIFIED):**
`docs/architecture/ATM-003-Platform-Foundation.md:111` lists `| Rate limiting | Prevent abuse and
ensure fair usage. |` in a requirements table. It is:
- a **generic capability requirement**, not a rule naming this endpoint, a limit, or a mechanism; and
- in a document whose own status line reads
  `**Status:** Controlled Architecture Document — **Draft for Review**` (`:5`).

A draft requirement that rate limiting *exist* somewhere does not authorise any particular regime on
this endpoint, and under fail-closed a draft confers no authority.

**Governing authority: NO APPROVED AUTHORITY — OWNER DECISION REQUIRED.**

**Fail-closed default if the OWNER does nothing:** the endpoint stays anonymous, unlimited and
unverified. Combined with §C-ITEM 1, each anonymous request that succeeds mints a real tenant,
administrator and subscription. Doing nothing leaves an unmetered, unverified public tenant-creation
path.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Rate-limit only | Bounds volume; needs a store (in-memory vs shared) and a decision on limits and on 429 semantics; does not stop a determined or distributed caller. |
| (b) CAPTCHA | Raises the cost of automation; adds a third-party dependency (and provider neutrality, Art. 4.12, is engaged — a vendor is never a source of authority). |
| (c) Contact verification before a tenant exists | Strongest; introduces a pending state and a delivery path (note §A-ITEM 4 already records that there is **no working delivery path** for existing pending invitations under unrepaired D-1). |
| (d) Combinations / none | Must be stated explicitly; "none" must be an explicit accepted decision, not a default. |

**Proposed decision (narrowly scoped):** state, per mechanism (rate limit / CAPTCHA / contact
verification), `REQUIRED` or `NOT REQUIRED`, and if `REQUIRED` state the limit or the verification
gate **and** whether it applies before or after tenant creation.

---

### C-ITEM 4 — D-2 activation sequencing

**The question (as transmitted):** D-2 (the case-folded alias in `src/services/subscription.service.js`
making `availableSeats` NaN and `canAddUser()` false for every tenant) currently MASKS the invitation
controller behind 403s. Repairing it ACTIVATES previously-latent paths. It has other callers
(`seat-limit.js:23`, `seat-limit.js:69`, `auth.controller.js:202`, `subscription.service.js:351`).
What is the approved landing order and who authorises the activation?

**VERIFIED — D-2 mechanism (exact):**
- `src/services/subscription.service.js:98` — `SELECT COUNT(*) as activeBillableUsers`
- `src/services/subscription.service.js:106` — `const activeUsers = result[0].activeBillableUsers;`
- PostgreSQL **case-folds the unquoted alias** `activeBillableUsers` → `activebillableusers`, so
  `result[0].activeBillableUsers` is `undefined`.
- `src/services/subscription.service.js:114` — `const availableSeats = Math.max(0, totalAllowed - activeUsers);` → **`NaN`**
- `src/services/subscription.service.js:150` — `return usage.availableSeats > 0 && !usage.overHardLimit;` → `NaN > 0` is `false` → **`canAddUser()` false for every tenant**

This matches the recorded description verbatim at `tests/onboarding-atomicity.test.js:60-62` @
`7b0d6f4` and the D-1 commit message ("PostgreSQL case-folds to `activebillableusers`, so `activeUsers`
is `undefined`, `availableSeats` is `NaN` and `canAddUser()` is false for every tenant. Measured:
availableSeats=NaN, canAddUser=false.").

**VERIFIED — the caller set (see §2.5 for the count correction):** six `canAddUser(` call sites —
`subscription.service.js:351`, `seat-limit.js:23`, `seat-limit.js:69`, `invitation.controller.js:96`,
`invitation.controller.js:275`, `auth.controller.js:202` — plus the `getAvailableSeats()` accessor
(`:158-161`). **Two of the six are inside `invitation.controller.js`**, the controller D-2 masks.

**VERIFIED — the masking, from the reviewer's own probe:** *"D-2 neutralised in-process only:
`subscriptionService.canAddUser = async () => true`... CREATE → 500 ... RESEND → 500 ..."* and the
candidate's own pin: `tests/onboarding-atomicity.test.js:557` — *"D-2 masks the invitation controller:
the request is refused by its own seat gate"*, with C2 asserting the mask is present so
*"a silent D-2 repair fails this"*.

**A material interaction the transmitted question omits (VERIFIED):** the D-1 candidate **pins D-2 as
unrepaired**. `tests/onboarding-atomicity.test.js:536-560` (`describe('C. D-2 (seat alias) is pinned,
not repaired')`) contains `C1. getSeatUsage still computes NaN availableSeats and canAddUser is still
always false` and a case asserting the mask is still present. **Therefore repairing D-2 will fail the
D-1 candidate's own suite unless that pin is inverted in the same change.** Any landing order must
account for it.

**Governing authority: NO APPROVED AUTHORITY — OWNER DECISION REQUIRED.** Nothing in §1.1 addresses
the landing order of a shared-subsystem repair, and nothing authorises activating latent paths. The
D-1 commit message states only that D-2 *"is NOT repaired here (it has 5 other callers and is out of
this mission's envelope)"* — an envelope statement, not a policy.

**Fail-closed default if the OWNER does nothing:** D-2 stays unrepaired, so `canAddUser()` stays
`false` for every tenant and the invitation paths stay masked behind 403 "Seat limit reached". The
latent D-1 invitation instances (create/resend/accept) therefore stay **unreachable**, which is
masking a defect rather than fixing it — and the security posture depends on a *bug* continuing to
exist.

**Impact of each choice:**
| Choice | Consequence |
|---|---|
| (a) Repair D-2 first, alone | Activates every `canAddUser`/seat-gated path — including the six call sites and the two in `invitation.controller.js` — while the D-1 invitation instances are still broken; also breaks the D-1 candidate's C1/C2 pin unless inverted. |
| (b) Repair D-1 first, then D-2 | Latent invitation paths are activated only after the writes they depend on are atomic. Recommended by the D-1 commit's own reasoning, and it requires inverting the D-2 pin. |
| (c) Repair both in one change | One activation event, one review, one evidence set; couples two candidate lineages and the registry/pin reconciliation. |
| (d) Leave D-2 unrepaired | Invitation functionality stays dead platform-wide; the mask is load-bearing. |

**Proposed decision (narrowly scoped):** approve a landing order among (a)/(b)/(c)/(d), name the
authorising mission, and state explicitly that repairing D-2 **inverts the D-1 candidate's C1/C2 pin**
(`tests/onboarding-atomicity.test.js:536-560`) and that the newly activated call sites are
`subscription.service.js:351`, `seat-limit.js:23`, `seat-limit.js:69`,
`invitation.controller.js:96`, `invitation.controller.js:275`, `auth.controller.js:202`.

---

## 6. Authority determination summary

### 6.1 Resolved by approved authority

| Item | Governing authority (cited) | Residual OWNER action |
|---|---|---|
| **A-ITEM 2 (E2)** | `ATM-003-R1-Role-Capability-Architecture.md:75` (§3.3 heading) and `:79` (`org.user_admin` = "Manage users, invitations, roles", Tenant scope); `roleIssuanceAuthority` at `src/middleware/rbac.js:453`, applied to re-issue at `src/controllers/invitation.controller.js:620` and **not** to cancel (VERIFIED) | **Confirmation only** — the reviewer's caveat is that "RESOLVED" is the implementer's characterisation, not an OWNER act |
| **B-ITEM 2 (invert S2–S4)** | Not a policy question: the inversion is determined by the D-1 repair, and S9 (`tests/organization-signup.integration.test.js:422`) is the intended contract | **Merge authorisation** (Art. 13.2) |
| **C-ITEM 1, endpoint existence only** | `src/routes/organization.routes.js:39-42` @ `7956ecf` — "Tenant self-registration exists, is approved, and is deliberately anonymous" | None for existence; **the ceremony itself is unresolved** |

### 6.2 Genuinely OWNER acts — `NO APPROVED AUTHORITY — OWNER DECISION REQUIRED`

| # | Item | Fail-closed default if nothing is done |
|---|---|---|
| A-1 | E1 — legacy pending administrator invitations | Pre-SEC-00E admin invitations stay redeemable with no re-validation against current issuing authority |
| A-2 | E2 — confirmation of the source-based resolution | Record stays unratified; behaviour unchanged (route keeps working under `org.user_admin`) |
| A-3 | E3/E4 scope **plus** the accept-path acknowledgement | An invitation-only D-1 repair must not be treated as fixing accept |
| A-4 | The c2 delivery gap for existing pending invitations | No delivery path exists; tenants cannot obtain links for existing pending invitations |
| B-1 | Semantic merge: one retirement mechanism + retain the 409 guard | No merge, or a textual merge that silently loses #93's duplicate-email 409 guard |
| B-3 | Accept the disclosed residuals as out-of-envelope | Residuals stay **not accepted**; D-1 cannot be treated as security-complete; the live `GET /api/users/:id` credential disclosure remains an open finding |
| B-3b | `base.model.js:54` INSERT-parameter stdout log (disclosed by the reviewer, omitted from the transmitted condition) | Every INSERT parameter, including bcrypt hashes, keeps being logged to stdout |
| B-4 | Whether the evidence standard requires per-write-site mutation detection (then add the M8 case) | M8 remains undetected; a future non-transactional resend passes the suite while producing two live pending tokens |
| C-1 | The first-administrator ceremony | The current ceremony ships: first anonymous POSTer becomes `role='admin'`, `is_organization_admin=true`, self-chosen password, no verification |
| C-2 | Duplicate organization name | TOCTOU window open; **no** database-level uniqueness; anonymous tenant-name squatting |
| C-3 | Rate limiting / CAPTCHA / contact verification | Endpoint stays anonymous, unlimited and unverified while minting real tenants |
| C-4 | D-2 activation sequencing | D-2 unrepaired → `canAddUser()` false platform-wide → invitation paths stay masked behind 403s |

### 6.3 Context: Bundle 2 C and the other candidates (reported, not re-reviewed)

- **Bundle 2 C** `0247cde`/`670ce55` — the feasibility document states of itself: *"Status: analysis
  complete; **implementation BLOCKED and escalated to the OWNER** (see §7)."* The branch
  `atm-001-sec-103-trust-boundary-feasibility` is **local and unpushed** (VERIFIED: no matching
  `origin/` ref). Both facts are consistent with the transmitted "CONDITIONAL PASS on the
  investigation, BLOCKED on the security boundary". This register records that status and does not
  re-review it; it is not one of the A/B/C/D items above.
- **#86 `456e4cde`, #89 `48f4a976`, #87 `c061fdff`** — their own commit messages state that *"An
  independent VUDA review has not been commissioned; this commit is not a verification verdict"*
  (VERIFIED in the B3-D reconnaissance). Their verdicts must not be reported as independent PASSes.
- **Bundle 2 A (`7956ecf`), #102 (`749043b7a0`), #98, #99, #95, #96** — I verified **commit and tree
  identity only** (and the `4b00462 → 7956ecf` ancestry). I found **no primary reviewer artefact** for
  these in the repository or in the sessions I searched, so their "independent PASS" status is
  **reported by the commissioning mission and NOT re-verified by me**.

---

## 7. The consolidated OWNER decision package

Twelve decisions are requested. Each is stated so that a one-line OWNER answer suffices. **None is
decided here.**

| # | Decision requested | Options (register's proposal in *italics* — a proposal, not a decision) |
|---|---|---|
| **1** | E1: disposition of pre-SEC-00E pending **administrator** invitations | (a) accept as-is / (b) re-validate at acceptance / (c) retire. *State the SEC-00E cut-off identifier.* |
| **2** | E2: confirm or reject the source-based resolution | Confirm / reject. *Confirm on `ATM-003-R1:79` + `roleIssuanceAuthority` scope.* |
| **3** | E3/E4: define the scope **and** accept with the acceptance-path acknowledgement | Define E3 and E4; accept-with-acknowledgement / reject |
| **4** | c2 delivery gap: is a delivery path for existing pending invitations required? | Required (which mechanism?) / not required |
| **5** | B-1: which single retirement mechanism, and confirm the 409 guard is retained | (a) #93 `claimForAcceptance` + D1 `FOR UPDATE` as lock, 409 guard kept / (b) D1 `accept()`-as-retirement, 409 guard kept |
| **6** | B-2: authorise inverting/retiring #104's S2–S4 pins and un-todo'ing S9 | Approve / reject |
| **7** | B-3: per-class disposition of the disclosed residuals | ACCEPTED-out-of-envelope / NOT ACCEPTED, for each of: (i) seven residual INSERT sites, (ii) `organization.controller.js:184-196`, (iii) `GET /api/users/:id` `password_hash`, (iv) `base.model.js:54` stdout log |
| **8** | B-4: does the evidence standard require every write site to be mutation-detected? | Yes → add the resend failure-injection case / No → record M8 as an accepted evidence gap |
| **9** | C-1: the first-administrator ceremony | Ratify current ceremony / require contact verification / require invite-or-approval / split |
| **10** | C-2: duplicate organization name | Keep 409+race / add UNIQUE constraint / make idempotent |
| **11** | C-3: rate limit / CAPTCHA / contact verification on public signup | REQUIRED / NOT REQUIRED per mechanism, and before or after tenant creation |
| **12** | C-4: D-2 landing order and who authorises activation | D-2 first / D-1 first / both together / leave unrepaired — *plus acknowledgement that repairing D-2 inverts the D-1 C1/C2 pin* |

**Recommended sequencing (a recommendation, not a decision):** settle **#12** (D-2 order) and **#5**
(the merge mechanism) before any integration, because both change which code paths are live; settle
**#7** and **#8** before closing D-1, because they define whether D-1 is finished; settle **#9–#11**
before any tenant signup is exercised beyond a disposable database, because all three govern an
anonymous public endpoint.

---

## 8. Fail-closed consequence of inaction — one line each

- **A-1 (E1):** superseded-authority administrator invitations stay redeemable; no re-validation.
- **A-2 (E2):** the "RESOLVED" record stays unratified; the route behaves unchanged.
- **A-3 (E3/E4):** an invitation-only repair must not be read as fixing accept.
- **A-4 (c2):** no link can be obtained for an existing pending invitation.
- **B-1:** no merge, or a textual merge that silently drops the duplicate-email 409 guard.
- **B-2:** #104's pins fail against the repaired tree; a red suite must not be quietened by weakening it.
- **B-3 / B-3b:** the residuals are **not accepted**; D-1 is not security-complete; `GET /api/users/:id` keeps disclosing `password_hash`; INSERT parameters keep being logged to stdout.
- **B-4:** the non-transactional-resend mutation stays undetected.
- **C-1:** the anonymous-first-POSTer ceremony ships.
- **C-2:** no uniqueness enforcement; anonymous tenant-name squatting continues.
- **C-3:** unmetered, unverified, anonymous tenant creation continues.
- **C-4:** D-2 unrepaired; `canAddUser()` false platform-wide; invitation paths stay masked by a defect.

---

## 9. Limitations — what I could not verify

1. **E3 and E4 are not defined in any primary artefact I could reach.** I registered them as
   transmitted. Settling this requires the original review's escalation list. — `NOT YET VERIFIED`.
2. **The primary reviewer reports are not committed to the repository** (§2.3). I read two of them
   from DSH session transcripts. I did **not** find primary artefacts for Bundle 2 A, Bundle 2 C,
   #102, #95, #96, #98 or #99, so their verdicts are reported, not re-verified.
3. **I did not run any test suite, migration, database probe or reviewer-style adversarial
   verification.** All code claims above are read-verified from the frozen trees (`git show` /
   worktree reads), not executed. Where I cite a reviewer's *measured* result, I say so and attribute
   it.
4. **I did not reproduce D-2's `NaN` at runtime.** I verified the mechanism by reading
   `subscription.service.js:98/106/114/150` and by the candidate's recorded pin and the D-1 commit
   message. Settle it by executing `getSeatUsage` against a disposable PostgreSQL.
5. **I did not verify the #104 S2–S4 failure empirically**; I verified that the pins *assert the
   defect* by reading their names and bodies, and that the file is absent at `7b0d6f4`.
6. **I did not search outside this repository** (except the DSH session transcripts and the
   workspace's `review-evidence/` tree, which contains no ATM-001-SEC-B3 artefact). If an approved
   authority for C-1…C-4 exists elsewhere, this register's `NO APPROVED AUTHORITY` findings would
   change.
7. **"NO APPROVED AUTHORITY" is scoped to the sources listed in §1.1.** It is not a claim that no
   such authority exists anywhere.

---

## 10. Non-approval statement

I did not self-approve. I did not ratify, approve, merge, deploy or publish anything. I decided no
policy. No `OWNER-RATIFIED:` line appears in this document or in any file changed by this mission.
Where no approved authority exists I stopped the dependent subtask and recorded it as
`NO APPROVED AUTHORITY — OWNER DECISION REQUIRED`. Where a candidate carries conditions, this
document reproduces the conditions and does **not** convert them into an unqualified PASS: Bundle 2 B
is recorded as the reviewer recorded it — **CONDITIONAL overall**, PASS on c1/c2 — and Bundle 2 D as
**PASS on the D-1 repair, with 4 conditions attached**, both by reviewers who self-declare as
procedurally but not organisationally independent.

Merge and deploy remain OWNER acts. This document is an input to that decision, not the decision.
