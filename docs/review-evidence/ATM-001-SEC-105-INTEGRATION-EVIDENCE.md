# ATM-001-SEC-105 — Security integration branch: evidence for independent Arena VUDA

> **REVIEW-ONLY.** This document is authored by the **implementing** agent. It is **not** its own
> review. No `OWNER-RATIFIED:` line exists here and none may be inferred. The branch is a
> **non-main** branch: no merge to `main`, no PR against `main`, no deploy.
>
> **The final independent VUDA must assess the exact code tree identified in §1.** Arena is asked
> for a verdict, not for implementation.

**Mission:** security integration workstream under Issue #105 (Architect execution checkpoint
2026-10-14). **Frozen main:** `f156aa4479efe783eefd4f13fd62171647f83b7f` — left untouched; no
branch, ref or worktree of `main` was modified.

---

## 1. Artefact identity

| Item | Value |
|---|---|
| Branch | `atm-001-sec-integration-105-vuda` (non-main) |
| Tested **code tree** | `0dcf749dca0bdf511680859ac7205bd9494cf7d9` at commit `2cd999a965019b450ae1cc5235fc619b8c3860cd` |
| Frozen base | `f156aa4479efe783eefd4f13fd62171647f83b7f` |
| Verified B3-D base | `b0ce6b01a7a6a9926f5ada99639fac853e064341` / tree `de1bbb5e70627b4a44ef8a8449e5da4893a5109a` |
| #106 source | `933701e85a49bc191b4061663ec955ee35eb656c` / tree `327a19076c8c90a0e804dd6b278693b233953e67` |
| B3-B source | `f53dac739461a547bde69e81c435cb06d05ac841` / tree `aa31818c39e3fa4b6a1e120e45bba3289139e381` |
| B3-A source | `3a3205224679dc16f783ea3234b7fd194c72776e` / tree `4cd9dda72180c3b0f323f00869513a5091bb8843` |

A commit cannot contain its own SHA. The **final published tip** (this code tree plus this
documentation-only evidence file) and the **remote SHA** are reported in the mission handoff, not
inside this file. The `src/` and `tests/` subtrees of the published tip are byte-identical to
`0dcf749d`; prove it with:

```bash
git diff --stat 0dcf749dca0bdf511680859ac7205bd9494cf7d9 <published-tip>   # docs only
git diff --stat 0dcf749dca0bdf511680859ac7205bd9494cf7d9 <published-tip> -- src tests   # empty
```

---

## 2. STEP 0 — what `b0ce6b01` actually is (contradiction resolved)

The Architect checkpoint states verbatim that B3-D commit `b0ce6b01…` is *"documentation-only
integration record, NOT a tested merged code candidate."* The B3-D implementer report claims
`b0ce6b01` contains an integrated **code** tree with `npm test` 195/195.

**Empirical determination (VERIFIED):**

```bash
git rev-parse b0ce6b01a7a6a9926f5ada99639fac853e064341            # -> b0ce6b01a7a6a9926f5ada99639fac853e064341
git rev-parse 'b0ce6b01a7a6a9926f5ada99639fac853e064341^{tree}'   # -> de1bbb5e70627b4a44ef8a8449e5da4893a5109a
git diff --stat f156aa4479efe783eefd4f13fd62171647f83b7f b0ce6b01a7a6a9926f5ada99639fac853e064341
#   34 files changed, 11178 insertions(+), 435 deletions(-)
git show --stat b0ce6b01a7a6a9926f5ada99639fac853e064341
#   docs/ATM-001-SEC-B3D-INTEGRATION-CANDIDATE.md | 495 +++++  (its OWN diff: docs only)
git ls-tree -r --name-only b0ce6b01… -- tests | grep -c '\.test\.js$'   # -> 51   (frozen main: 42)
```

| Dimension | Finding |
|---|---|
| Commit exists / resolves | **PASS** |
| Carries `src/` code changes vs frozen main | **YES** — `rbac.js` +469, `invitation.controller.js` +441, `user.routes.js` +309, `base.model.js` +101, `invitation.model.js` +115, plus 15 more |
| Carries new test files | **YES** — 9 new `tests/*.test.js` (51 total vs main's 42) |
| Its **terminal commit's own** diff | **documentation only** — 1 file, `docs/ATM-001-SEC-B3D-INTEGRATION-CANDIDATE.md`, +495 |
| `npm test` on a `/tmp` scratch checkout | **195 tests / 61 suites → 195 pass / 0 fail, exit 0** |
| Merged into `main` | **NO** — `git merge-base --is-ancestor b0ce6b01 f156aa44` fails; merge-base is `f156aa44` |
| Releasable | **NO** — its own doc carries blockers B-1…B-12 |

**Which account is correct:** the **B3-D implementer report** is correct that `b0ce6b01` is a real,
tested code tree (`npm test` 195/195 reproduced). The **Architect checkpoint is incorrect** if read
as "`b0ce6b01` contains no code / is not a tested code candidate". The checkpoint's wording is only
defensible about the **terminal commit's own diff** being a documentation record, and about the
candidate **not being merged into main and not being releasable**. It must not be used to describe
the tree as documentation-only.

Because the content matches one of the two named accounts, the **STEP 0 STOP condition is not
triggered**; integration proceeded on the verified base `b0ce6b01`.

---

## 3. Identity verification table (all resolved to full SHAs)

Every value below was produced by `git rev-parse '<sha>'` and `git rev-parse '<sha>^{tree}'`; no
abbreviation was assumed.

| Source | Commit (full) | Tree | Commit check | Tree check |
|---|---|---|---|---|
| #106 B-1 fix | `933701e85a49bc191b4061663ec955ee35eb656c` | `327a19076c8c90a0e804dd6b278693b233953e67` | PASS | PASS |
| #106 evidence commit | `e7d2ade17b9b041a59828acbd48d3c41057b7863` | `123e8aaeeacce8625f7210060b55300218b410a8` | PASS | PASS |
| B3-B sensitive-data | `f53dac739461a547bde69e81c435cb06d05ac841` | `aa31818c39e3fa4b6a1e120e45bba3289139e381` | PASS | PASS |
| B3-A register | `3a3205224679dc16f783ea3234b7fd194c72776e` | `4cd9dda72180c3b0f323f00869513a5091bb8843` | PASS | PASS |
| #102 users lane | `749043b7a0aadc6d6b2f8a37ff53d2b59cd1cda5` | `149221d0e92ee96917a8e84feed4466e0dcf0e40` | PASS | PASS |
| B2B invitation closure | `0e6f8f9a2501b2f4a754eb4e1e7df1174cb59c82` | `1c7663427827446c8d65638e4e55c693dfa41f9e` | PASS | PASS |
| base PR #93 | `24b3f485f0c2eb73184015ff4160001c54c3c4f2` | `0a7e40b495aac0bd4b436405afa9415c8688bcb1` | PASS | n/a (not supplied) |
| D-1 repair | `7b0d6f4c2baac1109e94325550588cefaaafcb82` | `c55c9c70ad2e54266fbbd26c0e216081ebbd1f4e` | PASS | PASS |
| #98 F-3 isolation | `5077c2d2b011b115976940bcc100e66dbe415b8c` | `e9173db25489f6b22fbd42daff36721e36ff7f2d` | PASS | n/a (not supplied) |
| #99 mysql2 patch | `042aa33df6b01b70b564187e0119b09bfb1873f8` | `7db62d87aa7b035e67ca223c99654dae9a80e7b2` | PASS | n/a (not supplied) |
| #95 transitive deps | `391756795533e194898564848218f73b36aa29bc` | `fbc1fcb0d4ae72423a32a572f7e13457d42d9054` | PASS | n/a (not supplied) |
| #96 multer patch | `60ca148bb345ebaaca7c56d2b99f2c0870bb3b6c` | `883fad946335c9f89eaf0df022d44404bd480adb` | PASS | n/a (not supplied) |
| B3-D base | `b0ce6b01a7a6a9926f5ada99639fac853e064341` | `de1bbb5e70627b4a44ef8a8449e5da4893a5109a` | PASS | PASS |
| frozen main | `f156aa4479efe783eefd4f13fd62171647f83b7f` | `fd1aa33a49e1678890cbaa377be35453d0185634` | PASS | PASS |

**Lineage check:** `git merge-base --is-ancestor <src> 933701e` is **TRUE** for #102, B2B, PR #93,
D-1 repair, #98, #99, #95, #96, #104-R3 and B3-D — i.e. the integrated lineage already contained
all of them. Only **B3-B** and **B3-A** were genuinely missing and were integrated here.

**No identity check failed.**

---

## 4. Integration order and conflict plan

### 4.1 Order actually used

```
f156aa44 (frozen main)
  └─ b0ce6b01  B3-D verified CODE tree (de1bbb5e)          [verified base, not re-merged]
       └─ 933701e  #106 B-1 grant-authority fix            [STEP 1]
            └─ 4b184af  integration merge of #106
                 └─ ecda654  integration merge of B3-B      [STEP 2, conflicts resolved]
                      └─ 2cd999a  integration merge of B3-A (docs) [STEP 3]
```

Worktree created **from the verified base**, as required:

```bash
git worktree add -b atm-001-sec-integration-105-vuda /tmp/atiman-sec-integ \
    b0ce6b01a7a6a9926f5ada99639fac853e064341
```

### 4.2 `git merge-tree --write-tree --name-only` results for every pair integrated

| Pair | Exit | Written tree | Conflicted files (hunks) |
|---|---|---|---|
| `b0ce6b01` × `933701e` (#106) | **0** | `327a1907…` (= #106's own tree) | **none** — fast-forward-equivalent |
| `933701e` × `f53dac7` (B3-B) | **1** | `c61cd89c…` (discarded) | 4 files / **13 hunks** |
| `ecda654` × `3a32052` (B3-A) | **0** | `0dcf749d…` | **none** |

Pair 2 detail:

```
CONFLICT (content): scripts/run-integration-tests.js      (1 hunk)  — registry append
CONFLICT (content): tests/database-test-guard.test.js     (2 hunks) — registry append
CONFLICT (content): src/routes/user.routes.js             (6 hunks)
CONFLICT (content): src/utils/helpers.js                  (4 hunks)
Auto-merging (clean): src/models/base.model.js
Auto-merging (clean): src/middleware/error-handler.js
```

**Hotspots named in the brief that did NOT conflict in these pairs:** `src/middleware/rbac.js`,
`src/controllers/invitation.controller.js`, `src/controllers/auth.controller.js`. They conflict
across the *historical* 105-pair matrix recorded by B3-D (because #85/#87/#102/#88/D-1/#104-R3 all
anchor there), but the pairs integrated here do not touch them on both sides, so no resolution was
required. Reporting this rather than implying the hotspots were hit.

### 4.3 Resolutions (no side chosen on any OWNER item; no assertion weakened)

1. **`src/utils/helpers.js` → THEIRS (B3-B).** Verified by function inventory: B3-B's version is a
   **strict superset** of the integrated tree's. Every shared function body (`isSensitiveField`,
   `redactSensitiveFields`, `sanitizeUser`) is byte-identical; only JSDoc wording differs. B3-B adds
   6 exports: `REDACTED`, `looksLikeCredentialValue`, `redactCredentialText`, `boundParamNames`,
   `redactSensitiveParams`, `describeStatement`. **No #102 control is lost.**
2. **`src/routes/user.routes.js` → OURS (integrated).** Verified: **both** sides carry the same six
   redaction sites (router-level `res.json` backstop + 5 handlers). OURS additionally carries the
   accepted #102/R3 authorization reconciliation (`requirePermission('USERS','VIEW')` + `canViewUser`)
   and uses `sanitizeUser(req.targetUser)`; THEIRS still used the weaker `canManageUser` lane
   (which B3-B's own commit body assigns to the #102 lane) and referenced an undefined `user`.
   The remaining 2 hunks were **comment-only**. B3-B's user.routes change is fully **subsumed**,
   not dropped.
3. **`scripts/run-integration-tests.js` and `tests/database-test-guard.test.js` → UNION (append).**
   Both registries keep every `933701e` entry and gain `user-credential-disclosure.test.js` with
   B3-B's comment. Static check: `SANCTIONED_POSTGRES_INTEGRATION_SUITES` (36) remains a **subset**
   of `DB_MUTATING_SUITES` (41); the 5-entry difference is the pre-existing `step6-*` set.

### 4.4 "Clean but incoherent" auto-merge check (the B3-D `invitation.model.js` failure class)

| File | Merged by | Verdict |
|---|---|---|
| `src/models/base.model.js` | clean auto-merge | **COHERENT.** B3-B's log redaction is self-contained (requires `redactSensitiveParams` / `describeStatement` / `REDACTED`, all verified exported) and does not touch the D-1 `conn` atomicity additions. |
| `src/middleware/error-handler.js` | clean auto-merge | **COHERENT.** Single-use `redactCredentialText(util.inspect(err))`; requires one export, present. |
| `src/models/invitation.model.js` | **not touched by this integration** | The B3-D condition-1 incoherence (two retention mechanisms) is **not re-introduced**. Only one mechanism is present: `Invitation.claimForAcceptance` (`src/models/invitation.model.js:188`), invoked inside the D-1 transaction at `src/controllers/invitation.controller.js:540`; `accept()` is attribution-only. The 409 duplicate-email guard is retained (2 sites). |

Additional machine check: every `require('../utils/helpers')` destructure across `src/` resolves
against the merged export set — **all resolve; 0 missing**.

---

## 5. Test results (exact counts, run by the implementing agent)

### 5.1 Non-destructive profile (`/tmp/atiman-sec-integ`)

| Command | Result |
|---|---|
| `npm ci` | **exit 0**; `package-lock.json` **not** rewritten (`git status` clean) |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `npm test` | **221 tests / 70 suites → 221 pass, 0 fail, 0 skipped, 0 todo**, exit 0 |
| `node --test tests/database-test-guard.test.js` | **134 tests / 4 suites → 134 pass, 0 fail**, exit 0 |
| `node scripts/assert-test-coverage.js` | **NOT RUN — the file does not exist in this tree.** Absent from frozen `main` (`f156aa44`), absent from the integrated tree (`0dcf749d`). It exists only on the unrelated `88939c6` (`atm-001-sec-103-b3c-oob-assurance`) branch. Not invented. |
| MySQL legacy compatibility | **NOT EXERCISED — no MySQL 8 / MariaDB available.** No `mysql`/`mysqld`/`mariadb` binary, no Homebrew `mysql`/`mariadb`, nothing listening on 3306. |

`npm test` grew from 195 (at `b0ce6b01`) to 221 because #106 adds a suite and the guard test's
own matrix runs; nothing was skipped to reach it (`skipped 0`, `todo 0`).

### 5.2 Sanctioned disposable-PostgreSQL integration

Environment: disposable PostgreSQL 16.14, `data_directory = /tmp/atiman104-pg`,
`inet_server_port() = 55435`, database `atiman_test`. **Port 5432 was never touched** (a live
server does answer there; it was not used). JWT secret read from `src/config/auth.js`;
`JWT_SECRET` deliberately **not** set so the suites' hard-coded test secret applies.

```bash
env -u JWT_SECRET NODE_ENV=test RUN_DB_TESTS=true \
  TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55435 TEST_DB_NAME=atiman_test \
  TEST_DB_USER=<test-db-user> TEST_DB_PASSWORD=<disposable-test-only> \
  npm run test:integration
```

| Group | Count |
|---|---|
| Sanctioned group | **241 tests / 33 suites → 241 pass / 0 fail** |
| **Full run** | **1014 tests / 243 suites → 1012 pass / 2 fail** |

---

## 6. RED-TEST INVENTORY (complete, with reasons)

Exactly **2** red tests on the integrated code tree. **Neither was weakened, skipped, deleted,
relaxed or relabelled.**

### R-1 — NEW BLOCKER R-1 / "B3-B × #102 authorization conflict" (1 test)

```
tests/user-credential-disclosure.test.js
  ✖ 7. an operator reading its own record        (expected 200, actual 403)
```

**Reason:** two accepted artefacts assert **opposite** outcomes for the same principal and route.

* B3-B (`f53dac7`) test 7: an operator `GET /api/users/<self>` must be **200**.
* Accepted #102/R3 `tests/user-authorization-reconciliation.test.js:438-441` (test 7): the *same*
  call must be **403** — *"USERS.VIEW is none for an operator, so the permission gate refuses every
  identifier alike."*

Both cannot hold. This is structurally the same class as blocker B-1 (two independently-PASSed
artefacts disagreeing about who holds an authority), but for the operator/self-read case instead of
the tenant-administrator/`org.user_admin` case. Resolving it either way means **choosing a side on
an authorization outcome**, so **it was not resolved**. `#102`'s authorization was **not** weakened
and B3-B's assertion was **not** edited. **OWNER adjudication required.**

**Side effect (reported, not hidden):** on the integrated tree B3-B's cases **3, 4, 5, 6, 12a, 12b**
now assert only `status !== 500` plus "no credential in body". Under #102 they receive **403/404**,
so they remain green **vacuously** — they no longer exercise the response-projection layer. Genuine,
non-vacuous redaction coverage survives via tests **8, 9, 10, 11, 13, 14, 15** (administrator /
own-tenant / list / create / update paths) and **16** (the real `BaseModel` INSERT stdout capture).
That reduction in detection power is a condition on this integration, not a clearance.

### R-2 — KNOWN PRE-EXISTING failure (1 test)

```
tests/m6r3-r1-remediation.test.js
  ✖ lists own and shared packs but never a foreign customer pack
```

**Reason:** database accumulation. `knowledge_packs` holds **2250** rows and the suite queries
`limit: '500'` (`tests/m6r3-r1-remediation.test.js:354`), so the fixture pack falls outside the
page. **Proved pre-existing**, not caused by this integration: run at `b0ce6b01` (pre-#106) the
suite gives **25 tests / 24 pass / 1 fail** with the *same* test name. Reported, not fixed;
fixing it would mean changing an acceptance expectation, which is out of scope.

### 6.1 Green BY CORRECTION — the five former B-1 reds (no assertion converted)

The mission required verification that #106 turns the five former B-1 reds green **by correction**.
Reproduced with before/after on the same two suites against the same cluster:

```
PRE-#106  (b0ce6b01): node --test tests/invitation-resend-authorization.test.js \
                                 tests/invitation-list-authorization.test.js
  -> 74 tests / 19 suites -> 69 pass / 5 FAIL

POST-#106 (0dcf749d): same command
  -> 74 tests / 19 suites -> 74 pass / 0 fail
```

| # | Former red test (verbatim, still present and unmodified) | Suite |
|---|---|---|
| 1 | `8. an administrator holding an unrelated explicit grant does NOT hold org.user_admin` | `invitation-list-authorization` |
| 2 | `04. an administrator without org.user_admin cannot resend` | `invitation-resend-authorization` |
| 3 | `20. an explicit grant WITHOUT org.user_admin does not authorize resend` | `invitation-resend-authorization` |
| 4 | `22-25. refusals create no row, issue no token, cancel nothing and deliver nothing` | `invitation-resend-authorization` |
| 5 | `R1-07. a principal without org.user_admin cannot resend any role` | `invitation-resend-authorization` |

This matches B3-D's documented B-1 set (`04, 20, 22-25, R1-07` + list `8`) exactly.
**Before/after for converted assertions: NONE — no assertion was converted, because the authorized
fix (#106) corrects the behaviour the assertions pin.** The assertions are byte-identical
pre- and post-integration.

---

## 7. Release blockers carried by this branch

**No reader may mistake this branch for releasable.**

* **Blocker R-1 (NEW, unresolved, OWNER decision).** B3-B test 7 (operator self-read = 200) vs
  accepted #102/R3 test 7 (operator self-read = 403). One red test. Not resolved.
* **Blocker R-1b (condition, not cleared).** B3-B cases 3/4/5/6/12a/12b are green vacuously on the
  integrated tree (403/404 instead of a projected user record), so the redaction layer is not
  exercised for those principals.
* **B-1 — RESOLVED BY AUTHORIZED CORRECTION (#106).** Was: tenant-administrator capability-resolution
  conflict between #104-R2/F3 and Bundle 2 B, 5 red tests. Now green by correction; see §6.1.
* **B-2 — Condition 1 (B3-D's semantic reconciliation) is implementer-authored, not independently
  confirmed.** Inherited from `b0ce6b01` unchanged.
* **B-3 — Condition 3 residuals ACCEPTED, not repaired:** non-`BaseModel` `insertId` INSERT sites;
  the un-transacted `POST /api/organizations` org+admin window; `BaseModel.query` parameter logging
  (B3-B reduces the credential exposure in this log, but the log line itself and the residual
  channels B3-B documents as open findings remain).
* **B-4 — Condition 4: the resend failure-injection detector (mutation M8) is still MISSING.**
  Verified absent. **Not authored here**: authoring the test that clears a condition on the
  integration one is performing would manufacture evidence and breach reviewer separation.
* **B-5 — Bundle 2 B's residual OWNER act** (E1 legacy pending *administrator* invitations, E3/E4
  scope questions, E2 confirmation) unresolved.
* **B-6 — D-2 activation ordering live and un-repaired.** The `getSeatUsage` case-folded-alias defect
  masks invitation paths; repairing D-2 *activates* them. Six call sites (B3-D's corrected count).
* **B-7 — #86 excluded:** `POST /api/auth/signup` still reads `organization_id` and `role` from the
  body — a live privilege-escalation path, no independent verdict.
* **B-8 — #89 excluded:** `POST /api/auth/register` still lacks role-assignment authority.
* **B-9 — Bundle 2 C excluded:** `scripts/assert-test-coverage.js` and the CI trust-boundary files
  are absent from this tree, so the coverage assertion cannot be performed at all.
* **B-10 — the in-repo CI evidence gate is NOT trustworthy and is NOT cited as assurance here.**
  **No CI result is used anywhere in this document.** Every number was produced locally.
* **B-11 — this branch is not independently verified.** Every "independent PASS" for a source is an
  **asserted external verdict**; identity was verified, verdict was not.
* **B-12 — no independent verdict exists for #85/#87/#86/#88/#89**; their exclusion is a scope
  decision, not an OWNER ruling.

### 7.1 Migration / residue note

Migration **022 makes capability grants undeletable**. No grant was created by this integration.
The #104 F3 fixture (`sec104-f3-*` in the 'ATM-001-SEC-104-R2 F3 Tenant' organization) and the
#106 B-1 fixture (`sec106-b1-*` in the 'ATM-001-SEC-106-B1 Tenant' organization) are **stable,
idempotent, undeletable residue** by design and were reused, not recreated. The disposable
`atiman_test` database is accumulated (2250 `knowledge_packs`), which is what makes R-2 fail.

---

## 8. Reproducible adversarial commands

Redact/replace `<disposable-test-only>`. Never point these at 5432 or any shared database.

```bash
# identity (STEP 0)
cd /Users/gcb/Projects/Lihok-Technologies/atiman-platform
git rev-parse b0ce6b01a7a6a9926f5ada99639fac853e064341
git rev-parse 'b0ce6b01a7a6a9926f5ada99639fac853e064341^{tree}'
git diff --stat f156aa4479efe783eefd4f13fd62171647f83b7f b0ce6b01a7a6a9926f5ada99639fac853e064341
git ls-tree -r --name-only b0ce6b01a7a6a9926f5ada99639fac853e064341 -- tests | grep -c '\.test\.js$'

# b0ce6b01 is a real, passing code tree (independent re-run)
git worktree add --detach /tmp/b3d-verify b0ce6b01a7a6a9926f5ada99639fac853e064341
cd /tmp/b3d-verify && npm ci && npm test        # expect: 195 tests / 61 suites / 195 pass / 0 fail

# conflict plan
cd /Users/gcb/Projects/Lihok-Technologies/atiman-platform
git merge-tree --write-tree --name-only b0ce6b01a7a6a9926f5ada99639fac853e064341 933701e85a49bc191b4061663ec955ee35eb656c
git merge-tree --write-tree --name-only 933701e85a49bc191b4061663ec955ee35eb656c f53dac739461a547bde69e81c435cb06d05ac841

# the integrated artefact
cd /tmp/atiman-sec-integ && git rev-parse HEAD && git rev-parse 'HEAD^{tree}'
npm ci && npm audit --omit=dev && npm test
node --test tests/database-test-guard.test.js

# the two red tests, isolated
env -u JWT_SECRET NODE_ENV=test RUN_DB_TESTS=true \
  TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55435 TEST_DB_NAME=atiman_test \
  TEST_DB_USER=<test-db-user> TEST_DB_PASSWORD=<disposable-test-only> \
  node --test tests/user-credential-disclosure.test.js
#   expect 21 tests / 20 pass / 1 fail -> "7. an operator reading its own record"

# prove R-2 is pre-existing
cd /tmp/b3d-verify && env -u JWT_SECRET NODE_ENV=test RUN_DB_TESTS=true \
  TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55435 TEST_DB_NAME=atiman_test \
  TEST_DB_USER=<test-db-user> TEST_DB_PASSWORD=<disposable-test-only> \
  node --test tests/m6r3-r1-remediation.test.js
#   expect 25 tests / 24 pass / 1 fail -> same test name

# the contradiction behind R-1
grep -n "no USERS.VIEW at all" -A4 tests/user-authorization-reconciliation.test.js
grep -n "an operator reading its own record" -A3 tests/user-credential-disclosure.test.js
```

---

## 9. What was deliberately NOT done

**OWNER-decision items — none implemented.** Items 1 (E1 legacy pending administrator invitations),
3 (E3/E4 — original definitions not in primary artefacts and required verbatim), 4 (c2 delivery
mechanism), 9 (first-administrator signup ceremony), 10 (duplicate organization name), 11 (signup
anti-abuse / rate limiting / verification) and 12 (D-2 activation) are **held**; the affected lanes
remain in whatever state the accepted work left them. No new capability, role, permission,
vocabulary or business behaviour was introduced.

**Engineering-executable items (5–8) — reported precisely:**

| Item | State in this branch | By whom |
|---|---|---|
| 5 — retain #93 `claimForAcceptance` + 409 guard | **PRESENT**, inherited unchanged | B3-D condition 1 (`b0ce6b01`); **not re-authored** |
| 6 — invert #104's obsolete S2–S4 D-1 pins, activate S9 | **DONE**, inherited unchanged. `organization-signup.integration.test.js`: S2 "D-1 repaired; pin inverted", S3 "the write IS transactional", S4 409, S9 strict (todo marker removed). `organization-security-policies.test.js` asserts D-1 REPAIRED. | B3-D condition 2 (`b0ce6b01`); **not re-authored** |
| 7 — disposition D-1 residuals by proof | **Dispositioned as ACCEPTED residuals** (B-3), inherited unchanged | B3-D §6; **not re-authored** |
| 8 — require the M8 resend mutation control | **NOT DONE.** Detector verified absent. Deliberately not authored (reviewer separation; would manufacture evidence clearing a condition on this integration). | — |

Also deliberately not done: no merge to `main`, no PR against `main`, no deploy, no
ruleset/branch-protection change, no `Render` change, `.gitignore` **not modified**, no production
or shared database touched, no CI result cited as assurance, no PR/issue review state altered.

---

## 10. Limitations

1. **No verdict is claimed.** No Arena verdict exists for this artefact. Identity of the sources was
   verified; their "independent PASS" status is an **asserted external verdict**, not reproduced here.
2. Everything authored here — the conflict resolutions of §4.3, the coherence analysis of §4.4 —
   is **implementer evidence** and needs independent adversarial assessment of the **exact** tree.
3. The `src/routes/user.routes.js` resolution *subsumed* B3-B's change (its own commit body assigns
   the user-route authorization to the #102 lane). That is a judgement call submitted for review; a
   reviewer who reads B3-B's intent as "project the router response independently" may reach a
   different conclusion.
4. The §6 "vacuous green" analysis is static reading of the suite's assertions plus the observed
   statuses; it is evidence of reduced detection power, not a proof about every case.
5. **MySQL legacy compatibility was not exercised** — no MySQL 8 available (§5.1).
6. `scripts/assert-test-coverage.js` could not be run at all rather than run and failed (§5.1).
7. The integration run shares one accumulated database; R-2 is a property of that accumulation.
8. This document is tracked Markdown, not `.log`, because `.gitignore:17` is `*.log` and would
   silently untrack it. `.gitignore` was not modified.
9. The five B-1 greens of §6.1 were re-verified on the exact code tree `0dcf749d`; the published tip
   differs from it only by this Markdown file.

---

## 11. Non-approval statement

This integration branch is **prepared**, not **approved**. The implementing agent did not
self-approve, did not ratify, and did not mark anything `Ratified` or `Approved`. Merge and deploy
are OWNER acts. **Arena must return an explicit verdict on the exact code tree before this branch is
integrated anywhere**, and the R-1 blocker must be adjudicated by the OWNER independently of any
Arena verdict.
