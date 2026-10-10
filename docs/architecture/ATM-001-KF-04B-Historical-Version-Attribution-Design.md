# ATM-001-KF-04B — Historical Version Attribution: Ratified Architecture and Implementation Contract

**Document ID:** ATM-001-KF-04B
**Mission:** ATM-001-KF-FINAL (workstream KF-04B); OWNER ratification recorded under ATM-001-KF-04B-ADR-RATIFICATION; D-1 direction recorded under ATM-001-KF-04B-D1-CLOSURE
**Status:** **RATIFIED (Q-1 … Q-5, §6) AND D-1 CLOSED (§7.3 — persisted, server-controlled task-start pin).** No code and no migration exist; implementation still requires the normal review, and the remaining policy decisions in §8.H are flagged, not assumed.
**Ratification date:** 2026-10-10 · **D-1 closure date:** 2026-10-10
**Architectural authority:** ChatGPT — Atiman Chief Architect · **OWNER:** Lihok Technologies OPC
**Baseline:** `origin/main` = `f156aa4479efe783eefd4f13fd62171647f83b7f`; approved review baseline = `21414273765541d2d3093771dc1da647e29e9e26`
**Authorisation:** documentation only. This record authorises **no** code, **no** migration, **no** production change and **no** deployment.
**Addresses:** Knowledge Foundation V1 requirement 14 (G-14), and the recording half of requirement 15 (G-15).
**Depends on:** KF-04A (published knowledge resolution — PR #81, read-only resolver, awaiting review).

---

## 1. The gap (G-14)

Operational records today point at the **mutable working definition**:

| Record | Reference today | Migration |
|---|---|---|
| `inspection_results` | `task_template_id` **NOT NULL**, `task_template_step_id` **NOT NULL** | `004` |
| `asset_observations` | `task_template_id` NULL, `task_template_step_id` NULL | `023` |

Neither carries a **version** reference. When the working definition is later edited, every historical
record silently reinterprets against the new text. The approved architecture says this must not happen:

- `ATM-001-Knowledge-Foundation.md` §8.2 — *"**Operational references point to a specific published
  version.**"* · *"Historical versions remain readable."*
- §8.3 — *"Operational apps may continue using an explicitly selected older version."*
- `ATM-002-R6` §6 — *"if the governing knowledge changes while a user is executing it, the experience
  **must not silently swap the content mid-step** … it either completes the step against the version it
  started with, or stops and explains."*
- `ATM-000` axiomatic frame — **Knowledge Before Transactions**, **Evidence Before Assumption**,
  **Findings Before Work Orders**, **Experience Follows Work**.

KF-04A (PR #81) supplies the **read** side. This record designs the **recording** side.

---

## 2. What "correct" looks like

1. **Point-in-time truth.** The exact published version — and, where the capture is step-scoped, the exact
   frozen step version — is fixed **server-side when the task starts**, not inferred later.
2. **No retroactive reinterpretation.** Existing rows keep NULL attribution; nothing is backfilled by
   inference.
3. **Additive and non-destructive.** Nullable columns and `RESTRICT` FKs; forward-only.
4. **Immutable once written.** Attribution is evidence and is immutable from first write.
5. **Tenant-safe.** A recorded version must be global (`organization_id IS NULL`) or the record's tenant.
6. **Legacy-safe, mandatory only on the governed path** (ratified Q-3).
7. **Pinned at task start, server-side** (ratified Q-4, closed D-1): never from a client-supplied version
   id, and never silently re-pointed.
8. **No new primary operational object.** The pin is an **execution-context record** subordinate to the
   work; Findings remain the primary operational object (D-1 directive, §7.3).

---

## 3. Ratified migration `024_operational_knowledge_version_attribution.sql`

> **Not written, not applied.** The shape below is ratified by Q-1, Q-2 and Q-5.

### 3.1 Additive columns (Q-1, Q-2)

```sql
ALTER TABLE asset_observations
    ADD COLUMN IF NOT EXISTS task_template_version_id      INTEGER DEFAULT NULL;
ALTER TABLE asset_observations
    ADD COLUMN IF NOT EXISTS task_template_step_version_id INTEGER DEFAULT NULL;

-- Q-2: both tables are attributed; the tables are NOT consolidated by this mission.
ALTER TABLE inspection_results
    ADD COLUMN IF NOT EXISTS task_template_version_id      INTEGER DEFAULT NULL;
ALTER TABLE inspection_results
    ADD COLUMN IF NOT EXISTS task_template_step_version_id INTEGER DEFAULT NULL;
```

### 3.2 Referential integrity — RESTRICT (Q-5)

```sql
ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS fk_asset_observations_template_version;
ALTER TABLE asset_observations ADD CONSTRAINT fk_asset_observations_template_version
    FOREIGN KEY (task_template_version_id) REFERENCES task_template_versions(id) ON DELETE RESTRICT;
ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS fk_asset_observations_template_step_version;
ALTER TABLE asset_observations ADD CONSTRAINT fk_asset_observations_template_step_version
    FOREIGN KEY (task_template_step_version_id) REFERENCES task_template_step_versions(id) ON DELETE RESTRICT;
-- ... the same pair for inspection_results.
```

`RESTRICT`, not `CASCADE`: an immutable version must never be removed while an operational record cites
it (defence in depth over `immutable_version_delete_check`, matching migration `023`'s stated rule).

### 3.3 Coherence and immutability trigger (Q-5; lifecycle revised by Q-4)

A cross-table `CHECK` cannot express these, so a `BEFORE INSERT OR UPDATE` trigger enforces:

| Rule | Rationale |
|---|---|
| step version set ⇒ version set | a step version has no meaning alone |
| version's `task_template_id` equals the record's | **version/template coherence** (Q-5) |
| step version belongs to the cited version | **step-version membership** (Q-5) |
| version in scope: `organization_id IS NULL OR = NEW.organization_id` | **frozen tenant-scope compatibility** (Q-5) |
| version is `published` **at pin creation**, `published` **or `superseded`** at completion write — **never `retired`** | ratified Q-4 |
| the governed write presents **server-side pin evidence**; client-supplied ids are never evidence | ratified Q-4 |
| attribution immutable after first write | **immutable attribution** (Q-5) |
| no UPDATE may set attribution on an existing NULL row | **no fabricated historical backfill** (Q-5) |
| legitimate amendments to **unfrozen observation content** still permitted | Q-5 (amendment is not attribution) |

> **Amendability boundary note.** `asset_observations` makes the captured substance amendable while
> `frozen_at IS NULL` (`023`, `asset_observation_lifecycle_check`). Q-5 keeps that for content but makes
> **attribution** immutable from first write, so `024` must extend that check (or add a dedicated
> trigger). This is a bounded change to the amendability boundary, not a free-standing addition.

### 3.4 Indexes

A partial index on each new version column where NOT NULL, for "which captures used version X" analysis.

---

## 4. Impact and safety analysis

| Question | Answer |
|---|---|
| Existing rows | Unchanged; new columns NULL. **No backfill, no inference, no reinterpretation** (Q-5). |
| Existing application paths | Unaffected; only the **governed published-knowledge path** must attribute (Q-3). |
| Destructive operations | **None.** Forward-only, idempotent (`ADD COLUMN IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS`). |
| Pack compatibility | None. Packs compose `task_template_versions` and are unaffected. |
| Test impact | New focused suite + registration in the sanctioned runner and the database-test guard. |
| Production | Applying `024` (and later `025`) is a production schema change requiring normal release authority. **Never run manually.** |

---

## 5. What this record decides, and what remains open

**Decided:** attribution columns (Q-1); both tables, no consolidation (Q-2); nullable schema / mandatory
governed path (Q-3); server-side task-start pinning with defined supersession and retirement behaviour
(Q-4); `RESTRICT` + immutable attribution + no backfill (Q-5); and **D-1 — a persisted, server-controlled
task-start pin that is an execution-context record** (§7.3).

**Still open (flagged, not assumed):** the remaining policy decisions in **§8.H** (notably the pin
creation trigger point and the one-active-pin rule). The `effective_from`/`effective_to` active default
(`ATM-001` §8.3) remains unimplemented and unclaimed. The operational UI is KF-04C. The legacy
`inspection_results` CASCADE risk (§9) is recorded, not remediated.

---

## 6. OWNER ratification (2026-10-10)

| # | Question (as asked) | Ratified decision | Effect |
|---|---|---|---|
| **Q-1** | Approve adding version-attribution columns? | **APPROVED.** Add nullable version-attribution columns. | §3.1 |
| **Q-2** | Both tables, or one record of the future? | **APPROVED.** Both `asset_observations` and `inspection_results`. **Do not consolidate the tables in this mission.** | §3.1 |
| **Q-3** | Optional or mandatory? | **APPROVED.** Legacy and procedure-less records may remain unattributed. **New captures through the governed published-knowledge path must retain the exact resolved version.** Preserve backward compatibility. | §2.6 |
| **Q-4** | `published` only, or may a superseded version be cited? | **APPROVED.** **Pin the published version at task start.** Never silently substitute a newer version. A **superseded** version may complete **only with trustworthy task-start pinning** and authorized, safe continuation. A **newly initiated** task must not select an already-superseded version. **Retirement stops execution** pending explicit disposition. **A client-supplied version ID is not proof of pinning.** | §3.3, §7 |
| **Q-5** | Approve the `RESTRICT` FK + immutability posture? | **APPROVED.** `RESTRICT` version FKs; version/template coherence; step-version membership; frozen tenant-scope compatibility; **immutable attribution after first write**; **no fabricated historical backfill**; **preserve legitimate amendments to unfrozen observation content**. | §3.2, §3.3 |

**No contradiction with the approved sources.** Q-4 implements `ATM-002-R6` §6; Q-1/Q-2/Q-5 implement
`ATM-001` §8.2; Q-3 preserves `ATM-000` axiom 4 and migration `023`'s procedure-less observation. Q-3's
governed-path obligation is a **ratified OWNER decision**, not an unapproved business rule.

---

## 7. Task-start pinning contract (ratified Q-4; D-1 closed)

### 7.1 Why a pin is required — the current implementation has no task-start record

| Surface | Current behaviour |
|---|---|
| `POST /m/asset/:assetId/inspect` (`mobile-inspection.controller.js`) | Accepts `{ template_id, results[], started_at, completed_at }` **from the client** and writes `inspection_results` immediately; `started_at` is client-supplied. Guard: `INSPECTIONS.SUBMIT` + `preventAdminInspection` |
| `GET /m/asset/:assetId/inspect/:templateId` | Resolves the **working** definition; persists nothing. Guard: `INSPECTIONS.VIEW` |
| `POST /atiman/report` (`report-capture.controller.js`) | Writes `asset_observations`; `proveProcedure` checks only the working template's global-or-same-tenant scope. Guard: the `finding.report` capability |
| `work_orders` / `inspection_points` (004) | Exist but are **not linked** to either flow; `inspection_points` anchors on legacy `task_master_id`, not `task_templates` |
| Published-version resolution | **Absent from `main`** — KF-04A (PR #81) is unmerged |

Nothing that exists today can prove *when a task started* or *under which immutable version*. Hence a
server-owned pin.

### 7.2 Required properties

| # | Requirement |
|---|---|
| **A. Creation authority** | The pin is created **by the server**, for the authenticated principal authorized to perform the capture on that path. A client may *request* task start; it may never *assert* a pin. |
| **B. Server-side evidence** | Minimum evidence, independent of the client: tenant; asset; working template; the **immutable `task_template_version_id` resolved by the server through the KF-04A resolver at pin time**; the resolving principal; a **server-generated creation timestamp**. A client-supplied `template_version_id` or timestamp is **never** evidence. |
| **C. Identity and lifecycle** | The pin is an **execution-context record**: immutable creation facts, plus at most a single one-way terminal marker. **No expiration, abandonment or retirement-override state is introduced** (directive 10). |
| **D. Supersession** | `published` at **creation**. If it becomes `superseded`, a capture may cite it **only with legitimate existing pin evidence** and only while continuation is authorized and safe (`ATM-002-R6` §6). A newly initiated task must never pin an already-`superseded` version. |
| **E. Retirement** | A `retired` pinned version **stops execution**; the write is refused and surfaced as no-longer-applicable. **The pin is not mutated to "override" retirement** — the stop is the behaviour. |
| **F. Resume / interruption** | The pin must survive navigation and session expiry (`ATM-003-R2` §3.5); a resumed task re-reads the **same** pinned version. This is why D-1 selected persistence over a short-lived credential. |
| **G. Write validation** | Service **and** database enforcement of §3.3, plus: the write presents server-verified pin evidence; the cited version equals the pin's version; `retired` → refuse; tenant/asset/template must match the pin. |
| **H. Legacy compatibility** | Columns nullable; legacy rows stay NULL; no backfill; the pin requirement applies only to new governed-path captures (Q-3). |
| **I. Tenant isolation** | Pin and write are tenant-bound; the version is global or the record's tenant; cross-tenant is a **non-disclosing** refusal. |
| **J. Failure behaviour (fail closed)** | No resolvable published version at pin time → the governed capture does not proceed; pin/write mismatch → **409**; `retired` → **409**; out-of-scope version → **404**; missing pin evidence on the governed path → **refuse**, never silently NULL. |
| **K. Required tests** | §8.G. |
| **L. Migration requirements** | `024` (columns, FKs, indexes, coherence/immutability trigger) is independent of the pin. The pin is **migration `025`**, a separate review and a separate PR. |

### 7.3 D-1 closure — ratified direction (2026-10-10)

> **Use a persisted, server-controlled task-start knowledge-version pin. The pin is an
> execution-context record, not a Work Order and not a new primary operational object.**

Consequences recorded from the direction:

1. Server-side pin creation authority is preserved (§8.E).
2. The pin persists: organization/tenant, asset, task template, **exact published version**, executing
   principal, and a **server-generated** creation timestamp (§8.A).
3. Lifecycle evidence is preserved (§8.D) — without inventing expiry or abandonment.
4. Interruption-safe resume is supported by durability (§7.2 F).
5. Superseded-version continuation requires **legitimate existing pin evidence** plus authorized, safe
   continuation (§7.2 D).
6. Retirement **stops execution** pending explicit disposition — no override (§7.2 E).
7. A client-supplied version ID is **never** proof of pinning (§7.2 B).
8. **Finding-first architecture is preserved**: the pin is subordinate execution context, not a primary
   operational object; Findings remain primary (§2.8).
9. **Existing authorization boundaries are preserved** — no new capability (§8.E).
10. **No arbitrary expiration, abandonment, or retirement-override policy** is introduced (§8.D).

**Rejected alternative.** A server-issued signed pin credential was considered and **not** selected: it
is weaker on resume/interruption, has no durable lifecycle evidence, and provides no central revocation.

---

## 8. Proposed pin schema and enforcement (D-1 closure deliverable)

> **Proposal only. Not written, not applied.** Presented as DDL so the decision is concrete; names and
> wording remain implementation detail. Nothing here is a new business rule.

### 8.A Minimal proposed pin schema

```sql
CREATE TABLE IF NOT EXISTS task_knowledge_pins (
    id                       BIGSERIAL PRIMARY KEY,
    organization_id          INTEGER     NOT NULL,
    asset_id                 INTEGER     NOT NULL,
    task_template_id         INTEGER     NOT NULL,
    task_template_version_id INTEGER     NOT NULL,
    created_by_user_id       INTEGER     NOT NULL,
    -- Server-generated only. A client-supplied timestamp is never accepted.
    created_at               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Single one-way terminal marker. No expires_at, no abandoned_at, no override column.
    completed_at             TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT fk_tkp_organization FOREIGN KEY (organization_id)
        REFERENCES organizations(id)          ON DELETE RESTRICT,
    CONSTRAINT fk_tkp_asset        FOREIGN KEY (asset_id)
        REFERENCES equipment(id)              ON DELETE RESTRICT,
    CONSTRAINT fk_tkp_template     FOREIGN KEY (task_template_id)
        REFERENCES task_templates(id)         ON DELETE RESTRICT,
    CONSTRAINT fk_tkp_version      FOREIGN KEY (task_template_version_id)
        REFERENCES task_template_versions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_tkp_user         FOREIGN KEY (created_by_user_id)
        REFERENCES users(id)                  ON DELETE RESTRICT,
    CONSTRAINT chk_tkp_completed_after_creation
        CHECK (completed_at IS NULL OR completed_at >= created_at)
);
```

**Exactly the persisted facts required by the direction** — tenant, asset, template, exact published
version, executing principal, server timestamp — and nothing that would create a policy (no expiry, no
abandonment, no priority, no status vocabulary beyond the one-way terminal marker).

### 8.B Required relationships and constraints

| Relationship | Constraint |
|---|---|
| `organization_id` → `organizations` | `RESTRICT` (a pin is execution evidence; it must not vanish with its tenant) |
| `asset_id` → `equipment` | `RESTRICT` |
| `task_template_id` → `task_templates` | `RESTRICT` (note: this deliberately does **not** inherit `inspection_results`' `CASCADE`; see §9) |
| `task_template_version_id` → `task_template_versions` | `RESTRICT` (the version is already delete-protected) |
| `created_by_user_id` → `users` | `RESTRICT` (attribution is part of the evidence) |
| `created_at` | server `DEFAULT`; never client-supplied |

**Coherence trigger `task_knowledge_pin_context_check` (`BEFORE INSERT OR UPDATE`)** — mirrors the
`asset_observation_context_check` idiom:

| Rule |
|---|
| asset exists, has an organization, and `equipment.organization_id = pin.organization_id` |
| asset's facility chain is consistent with the organization (as `023` already enforces for observations) |
| template exists and is `organization_id IS NULL` or `= pin.organization_id` |
| version exists; `task_template_versions.task_template_id = pin.task_template_id` |
| version `organization_id IS NULL` or `= pin.organization_id` |
| version `lifecycle_state_at_publish = 'published'` **at pin creation** |
| creating user exists and `users.organization_id = pin.organization_id` |
| **identity immutability**: `id`, `organization_id`, `asset_id`, `task_template_id`, `task_template_version_id`, `created_by_user_id`, `created_at` are never updatable |
| **one-way terminal marker**: `completed_at` NULL → NOT NULL only; once set, no further update at all |
| **no other update path** exists (no expiry, no abandonment, no override) |

**Indexes:** `(organization_id, asset_id, task_template_id)`; `(task_template_version_id)`;
partial index on `completed_at IS NULL` for open pins.

### 8.C Tenant-isolation enforcement

1. `organization_id NOT NULL`; every read and write is scoped to the authenticated principal's tenant.
2. The coherence trigger refuses any cross-tenant asset, template, version or user.
3. The capture write must reference a pin whose `(organization_id, asset_id, task_template_id,
   task_template_version_id)` match the record exactly; a mismatch is refused, not silently dropped.
4. Cross-tenant lookups return a **non-disclosing** 404, matching the established provenance and
   observation behaviour.
5. Global (`organization_id IS NULL`) versions remain citable by any tenant without granting write
   authority over them (`ATM-000` axiom 4).

### 8.D Pin lifecycle transitions

| From | To | Trigger | Notes |
|---|---|---|---|
| *(created)* | **open** | server creates the pin at task start | creation facts immutable forever |
| open | **completed** | server sets `completed_at` once, when the task completes | one-way; no content change beyond the marker |
| open | **open** | resumed after interruption | the pin is re-read; the version is **never** re-resolved |

**Explicitly NOT modelled:** `expired`, `abandoned`, `cancelled`, `superseded_by`, `released`, or any
retirement override. A pin whose version is later superseded stays open and may complete under §7.2 D; a
pin whose version is retired does not change state — the **capture** is refused (§7.2 E). Adding any
state beyond the above is a **new policy decision requiring approval**.

### 8.E Authorization requirements

**No new capability and no bundle change.** The pin is created and read under the **existing authority
of the path being executed**:

| Path | Capture authority (existing) | Pin authority (proposed) |
|---|---|---|
| `/atiman/report` → `asset_observations` | `finding.report` (capability) | same |
| `/m/asset/:assetId/inspect` → `inspection_results` | `INSPECTIONS.SUBMIT` + `preventAdminInspection` | same |
| Runner read (`/m/asset/:assetId/inspect/:templateId`) | `INSPECTIONS.VIEW` | unchanged; **the read path does not create a pin** (a GET that writes would be prefetch-unsafe) |

If a single shared task-start endpoint is later chosen, it must authorize **per path** — never by a union
that would widen access to either authority. This is flagged as **§8.H H-1**.

Administrators remain unable to execute (`INSPECTIONS.SUBMIT: admin none`; `preventAdminInspection`).

### 8.F Migration `025` implications

- New table + five `RESTRICT` FKs + the coherence/immutability trigger + three indexes. Additive; no seed;
  no backfill; idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`).
- **Independent of `024`.** `024` (attribution columns) must be implementable and reviewable on its own;
  `025` (pin) is a separate migration, separate PR and separate review. The canonical runner would move
  `023 → 024 → 025`; migration-runner and schema-readiness suites must be updated per PR.
- No production application, no manual migration; the release authority applies.

### 8.G Required tests

1. Pin creation persists exactly tenant, asset, template, **server-resolved published version**, principal
   and a **server-generated timestamp**; a client-supplied timestamp/version is ignored or rejected.
2. Pin creation refuses a non-`published` version, a cross-template version, a cross-tenant asset/template/
   version/user, and an unknown asset/template.
3. A capture with valid pin evidence writes the pinned version and step version; read-back is exact.
4. A governed-path capture **without** pin evidence is refused and writes no row.
5. Pin/write mismatch (different version, asset or template) → 409, no row.
6. `superseded` version: completion under a pre-existing pin is accepted; a **new** pin is refused.
7. `retired` version: capture is refused (409) and no row is written; no fallback.
8. Attribution immutability: UPDATE changing attribution is refused; UPDATE of **unfrozen content**
   (text/measurement) still succeeds.
9. No fabricated backfill: UPDATE setting attribution on a legacy NULL row is refused.
10. Pin identity immutability and one-way `completed_at`; no other update path.
11. Interruption-safe resume: reopening a task re-reads the **same** pinned version even if a newer
    published version now exists.
12. Tenant isolation across organisations for pins, captures and discovery.
13. Authorization: admin cannot create a pin or capture (path-specific denial); operator/supervisor can
    per the existing matrix; no capability vocabulary or bundle change.

### 8.H Remaining policy decisions (flagged — none assumed)

| # | Decision | Why it needs a decision | Status |
|---|---|---|---|
| **H-1** | **Pin creation trigger point**: an explicit task-start endpoint, versus creation at the first governed capture. | An explicit endpoint satisfies "pin at task start" cleanly (the runner read is already resolved under that pin) but adds an API surface; first-capture creation adds none but leaves a window between reading the runner and pinning. | **OPEN — requires approval** |
| **H-2** | **One open pin per `(organization, asset, template, principal)`?** Concurrent task starts for the same tuple could create two pins. | Determines whether a partial unique index is added; a uniqueness rule is a workflow constraint | **OPEN — requires approval** |
| **H-3** | **Is the one-way `completed_at` marker required at all?** | A purely immutable creation record is smaller; the marker adds terminal evidence (`ATM-002-R6` "completes against the version it started with") | **OPEN — minor** |
| **H-4** | **Store `facility_id` on the pin?** | Observations carry facility; the pin could, but the asset implies it | **OPEN — minor** |
| **H-5** | **Display of a retired-pin stop** (copy and next action) | Experience wording, not schema; belongs to KF-04C | Deferred to KF-04C |

No item above is implemented or presumed. **H-1 and H-2 are flagged for approval before any `025` work.**

---

## 9. Legacy evidence-integrity finding (recorded, NOT remediated)

| Field | Record |
|---|---|
| Finding | **`inspection_results` uses `ON DELETE CASCADE`** for `task_template_id`, `task_template_step_id`, `organization_id`, `facility_id`, `asset_id` (migration `004`) |
| Risk | Deleting a **working** definition (or step) **destroys inspection evidence**, contradicting *Evidence Before Assumption* and the `RESTRICT` posture migration `023` adopted precisely to avoid it |
| Relationship to KF-04B | A `RESTRICT` **version** FK does not fix this (the version is the target, not the deleted row). Attribution exposes the gap; it does not create it |
| Disposition | **Recorded only.** Recommended: a separate bounded investigation and remediation mission. Requires architectural approval before any change |

---

## 10. Interim state

- **KF-04A (PR #81)** — read half; complete, tested, awaiting review.
- **KF-04B** — ratified in design (Q-1 … Q-5); **D-1 closed** as a persisted pin; no implementation;
  `024`/`025` unwritten; **H-1/H-2 open**.
- **KF-04C** — not started; depends on H-1/H-2 and on `024`/`025`.
- Requirement 14 (G-14) and requirement 15 (G-15) remain **PARTIAL**; only merged, independently verified
  implementation may upgrade them.

## 11. Non-actions

No code changed, no test changed, no migration written or applied, no schema touched, no production
access or migration, no deployment, no knowledge authored/approved/published, no capability or bundle
change, no API contract change, no PR #27/#81/#83/#84 change, and no merge.
