# ATM-001-SEC-106 B-1 — ORIGINAL (pre-change) evidence archive

**Document ID:** ATM-001-SEC-106-B1-ORIGINAL-EVIDENCE
**Mission:** MISSION #106 — resolve blocker B-1, one bounded non-main DRAFT PR.
**Type:** EVIDENCE archive. Captured BEFORE any source or test change on this branch.
**Status:** SUPERSEDED-BY-FIX (kept verbatim; never edited after capture).

> This file is the durable record of the state of the integrated candidate
> **before** the B-1 correction. Nothing in it was edited after the correction
> commit; the corrected state is recorded separately in
> `ATM-001-SEC-106-B1-RECONCILIATION.md`.

---

## 0. Identity verification (resolved with `git rev-parse`, no abbreviations assumed)

| Label | Commit (`rev-parse <sha>^{commit}`) | Tree (`rev-parse <sha>^{tree}`) | Mission-stated | Match |
|---|---|---|---|---|
| B3-D integrated candidate | `b0ce6b01a7a6a9926f5ada99639fac853e064341` | `de1bbb5e70627b4a44ef8a8449e5da4893a5109a` | same / same | ✅ VERIFIED |
| B3-A decision register | `3a3205224679dc16f783ea3234b7fd194c72776e` | `4cd9dda72180c3b0f323f00869513a5091bb8843` | same / same | ✅ VERIFIED |
| Frozen `main` | `f156aa4479efe783eefd4f13fd62171647f83b7f` | `fd1aa33a49e1678890cbaa377be35453d0185634` | commit same (no tree stated) | ✅ VERIFIED |

Worktree: `atm-001-sec-106-b1-grant-authority`, created **from the integrated candidate**
`b0ce6b01` (NOT from frozen `main`), because B-1 only reproduces on the integrated tree.

---

## 1. Baseline test state of the UNMODIFIED integrated candidate

| Command | Result | Exit |
|---|---|---|
| `npm ci` | 0 vulnerabilities | 0 |
| `npm test` | **195 tests / 195 pass / 0 fail** (61 suites) | 0 |
| `node --test tests/database-test-guard.test.js` | see §5 | 0 |
| `npm run test:integration` | **968 tests / 962 pass / 6 fail** | 1 |

The 6 integration failures are exactly:

* the **5 B-1 tests** below, deliberately preserved RED by B3-D; and
* **1 known pre-existing failure** (`tests/m6r3-r1-remediation.test.js`: "own customer
  pack must be listed"), unrelated to B-1 and out of this mission's scope.

Environment: disposable PostgreSQL cluster `/tmp/atiman104-pg` on port **55435** only.
`JWT_SECRET` was **not** set in the shell environment (the in-suite test constant is used).

---

## 2. The five B-1 tests and their EXACT failure output (verbatim, credentials redacted)

```text
✖ failing tests:

test at tests/invitation-list-authorization.test.js:424:5
✖ 8. an administrator holding an unrelated explicit grant does NOT hold org.user_admin (13.078ms)
  AssertionError [ERR_ASSERTION]: the resolver resolves in EXPLICIT_GRANTS mode and the legacy bundle is discarded
  
  200 !== 403
  
      at TestContext.<anonymous> (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/invitation-list-authorization.test.js:429:14)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 200,
    expected: 403,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/invitation-resend-authorization.test.js:375:5
✖ 04. an administrator without org.user_admin cannot resend (15.24975ms)
  AssertionError [ERR_ASSERTION]: admin without org.user_admin: expected 403, got 200 {"success":true,"message":"Invitation resent successfully","data":{"invitation":{"organization_id":1221,"email":"sec00h-a_04-mv76ca6cqqsi@test.local","role":"admin","invited_by":4672,"token":"<REDACTED-64HEX-TOKEN>","status":"pending","expires_at":"2026-10-20T21:09:36.783Z","id":4944}}}
  
  200 !== 403
  
      at assertRefusedCleanly (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/invitation-resend-authorization.test.js:273:10)
      at TestContext.<anonymous> (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/invitation-resend-authorization.test.js:379:13)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 200,
    expected: 403,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/invitation-resend-authorization.test.js:577:5
✖ 20. an explicit grant WITHOUT org.user_admin does not authorize resend (10.154417ms)
  AssertionError [ERR_ASSERTION]: explicit grant without org.user_admin: expected 403, got 200 {"success":true,"message":"Invitation resent successfully","data":{"invitation":{"organization_id":1221,"email":"sec00h-a_20-mv76ca6cqqsx@test.local","role":"operator","invited_by":4672,"token":"<REDACTED-64HEX-TOKEN>","status":"pending","expires_at":"2026-10-20T21:09:37.018Z","id":4983}}}
  
  200 !== 403
  
      at assertRefusedCleanly (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/invitation-resend-authorization.test.js:273:10)
      at TestContext.<anonymous> (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/invitation-resend-authorization.test.js:581:13)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1905:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 200,
    expected: 403,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/invitation-resend-authorization.test.js:595:5
✖ 22-25. refusals create no row, issue no token, cancel nothing and deliver nothing (21.994083ms)
  AssertionError [ERR_ASSERTION]: rejected: no org.user_admin: expected 403, got 200 {"success":true,"message":"Invitation resent successfully","data":{"invitation":{"organization_id":1221,"email":"sec00h-r_mv76ca6cqqs13-mv76ca6cqqs14@test.local","role":"admin","invited_by":4672,"token":"<REDACTED-64HEX-TOKEN>","status":"pending","expires_at":"2026-10-20T21:09:37.052Z","id":4992}}}
  
  200 !== 403
  
      at assertRefusedCleanly (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/invitation-resend-authorization.test.js:273:10)
      at TestContext.<anonymous> (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/invitation-resend-authorization.test.js:606:15)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1905:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 200,
    expected: 403,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/invitation-resend-authorization.test.js:791:5
✖ R1-07. a principal without org.user_admin cannot resend any role (24.342709ms)
  AssertionError [ERR_ASSERTION]: ADMIN_A_OTHER_GRANT without org.user_admin: expected 403, got 200 {"success":true,"message":"Invitation resent successfully","data":{"invitation":{"organization_id":1221,"email":"sec00h-r1_07_admin_a_other_grant-mv76ca6cqqs1i@test.local","role":"admin","invited_by":4672,"token":"<REDACTED-64HEX-TOKEN>","status":"pending","expires_at":"2026-10-20T21:09:37.221Z","id":5016}}}
  
  200 !== 403
  
      at assertRefusedCleanly (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/invitation-resend-authorization.test.js:273:10)
      at TestContext.<anonymous> (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/invitation-resend-authorization.test.js:796:15)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 200,
    expected: 403,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/m6r3-r1-remediation.test.js:347:5
✖ lists own and shared packs but never a foreign customer pack (7.065916ms)
  AssertionError [ERR_ASSERTION]: own customer pack must be listed
      at TestContext.<anonymous> (/Users/gcb/Projects/Lihok-Technologies/.worktrees/atm-001-sec-106-b1-grant-authority/tests/m6r3-r1-remediation.test.js:358:14)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
INTEGRATION_EXIT:1
```

**Exact test names (5):**

1. `tests/invitation-resend-authorization.test.js` — *04. an administrator without
   org.user_admin cannot resend*
2. `tests/invitation-resend-authorization.test.js` — *20. an explicit grant WITHOUT
   org.user_admin does not authorize resend*
3. `tests/invitation-resend-authorization.test.js` — *22-25. refusals create no row,
   issue no token, cancel nothing and deliver nothing*
4. `tests/invitation-resend-authorization.test.js` — *R1-07. a principal without
   org.user_admin cannot resend any role*
5. `tests/invitation-list-authorization.test.js` — *8. an administrator holding an
   unrelated explicit grant does NOT hold org.user_admin*

Each failure is the same delta: the assertion expects **403** and the candidate answers
**200** — i.e. the principal *does* hold `org.user_admin` and the resend *does* issue a
new live invitation token (credential redacted above).

---

## 3. Pre-change behaviour of the authority-granting principal (direct resolver probe)

Read-only probe against the real fixture row, before any change:

```text
PROBE principal: {"id":473,"username":"sec104-f3-admin-granted","role":"admin","is_organization_admin":true,"organization_id":159,"active_grants":"knowledge.author"}
PROBE mode: EXPLICIT_GRANTS reason: null
PROBE capabilities: ["knowledge.author","org.config_admin","org.user_admin"]
PROBE holds org.user_admin: true
PROBE holds org.config_admin: true
```

**Reading (VERIFIED).** A principal with `role='admin'` **and**
`is_organization_admin=true` holding exactly one *unrelated* explicit grant
(`knowledge.author`) resolves in `EXPLICIT_GRANTS` mode and holds
`org.user_admin` **and** `org.config_admin` in addition to that grant.

---

## 4. The contradictory PASS outcomes this evidence reconciles

* **ATM-001-SEC-104-R2 (F3)** — independently PASSed — deliberately **preserves** the
  ATM-003-R1 §4 Tenant Administrator profile for exactly that principal shape, in both
  resolution modes (`src/services/capability.service.js`
  `withTenantAdministratorProfile`). Its own tests (`organization-security-policies.test.js`
  section I: I1–I6) PASS at this candidate and pin 200 + persisted write for the
  granted tenant administrator.
* **Bundle 2 B** — independently PASSed — asserts the same principal must **not** hold
  `org.user_admin` and must be refused 403. Its tests are the 5 above, RED here.

Both cannot hold. This is the B-1 conflict, recorded at
`docs/ATM-001-SEC-B3D-INTEGRATION-CANDIDATE.md` §8 (`B-1`, lines 322–347).

---

## 5. Label note (evidence hygiene)

The B3-A register (`docs/ATM-001-SEC-B3-OWNER-DECISION-REGISTER.md`, branch
`atm-001-sec-b3a-decision-register`, commit `3a32052`) also uses the label **"B-1"** for a
*different* item — the #93/D-1 retirement-mechanism merge (`§6.2`, `§7` decision 5). The
register's twelve requested decisions are recorded there and were retrieved for this
mission. MISSION #106's **B-1 is the capability-authority conflict** stated in the B3-D
integration-candidate record, not the register's merge item. The collision is recorded
here so no reader conflates them.

---

## 6. Non-approval statement

This is evidence, not an approval. It decides no policy, ratifies nothing, and carries no
`OWNER-RATIFIED:` line. The correction and its reconciliation are recorded separately.
