# ATM-001-KF-04B — Historical Version Attribution: Ratified Architecture and Implementation Contract

**Document ID:** ATM-001-KF-04B
**Mission:** ATM-001-KF-FINAL (workstream KF-04B); ratification recorded under ATM-001-KF-04B-ADR-RATIFICATION
**Status:** **RATIFIED BY THE OWNER (2026-10-10). Q-1 … Q-5 approved (§6).** Implementation remains gated on the single open mechanism decision **D-1** (§7). No code and no migration exist for this record.
**Ratification date:** 2026-10-10
**Architectural authority:** ChatGPT — Atiman Chief Architect · **OWNER:** Lihok Technologies OPC
**Baseline:** `origin/main` = `f156aa4479efe783eefd4f13fd62171647f83b7f`; approved review baseline (PR #82 head) = `206fa62ba7447bde4aa4cfe586665d4bea6ed0f0`
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
  version.**"*
- §8.2 — *"Historical versions remain readable."*
- §8.3 — *"Operational apps may continue using an explicitly selected older version."*
- `ATM-002-R6` §6 — the *"mid-task version change rule"*: content must not be silently swapped
  mid-task, and a task completes against the version it started with.

KF-04A (PR #81) supplies the **read** side: a resolver that serves an immutable published version and
refuses drafts, superseded and retired rows. It cannot yet **record** which version a capture used.
That recording is this workstream.

---

## 2. What "correct" looks like

1. **Point-in-time truth.** The exact published version (and, where the capture is step-scoped, the
   exact frozen step version) is written **at capture time**. It is not inferred later.
2. **No retroactive reinterpretation.** Existing rows keep NULL attribution. Nothing is backfilled by
   inference; an existing record's version is genuinely unknown and must stay unknown.
3. **Additive and non-destructive.** New nullable columns and FKs. No column dropped, no type narrowed,
   no data rewritten. Forward-only, like every migration in this repository.
4. **Immutable once written.** Attribution is evidence; it must not be editable after the fact, in the
   same way `asset_observations.frozen_at` is already protected.
5. **Tenant-safe.** A recorded version must be readable in the record's tenant scope (global
   `organization_id IS NULL`, or the record's own organization).
6. **Legacy-safe, and mandatory only on the governed path.** A procedure-less observation (migration
   `023` explicitly supports one) has no version, and legacy rows keep NULL. Attribution is **nullable in
   the schema**; it is **required only for new captures executed through the governed published-knowledge
   path** (ratified Q-3, §6).
7. **Pinned at task start (ratified Q-4).** The version is established **server-side when the task
   starts**, not when the last step is submitted, and never from a client-supplied version id.

---

## 3. Ratified migration `024_operational_knowledge_version_attribution.sql`

> **Not written, not applied.** The column/FK/trigger design below is now **ratified in shape** by Q-1,
> Q-2 and Q-5; the wording, column names and index names remain implementation detail. Applying `024` to
> production is a schema change that requires the normal release authority and **must never be run
> manually**.

### 3.1 Additive columns (ratified Q-1, Q-2)

```sql
-- asset_observations: the observation-level version and (optionally) the step-level version.
ALTER TABLE asset_observations
    ADD COLUMN IF NOT EXISTS task_template_version_id      INTEGER DEFAULT NULL;
ALTER TABLE asset_observations
    ADD COLUMN IF NOT EXISTS task_template_step_version_id INTEGER DEFAULT NULL;

-- inspection_results: the legacy field-workflow record. Both refs are NOT NULL today,
-- so a version reference is added the same way — nullable, to preserve history.
-- Q-2: both tables are attributed; the tables are NOT consolidated by this mission.
ALTER TABLE inspection_results
    ADD COLUMN IF NOT EXISTS task_template_version_id      INTEGER DEFAULT NULL;
ALTER TABLE inspection_results
    ADD COLUMN IF NOT EXISTS task_template_step_version_id INTEGER DEFAULT NULL;
```

### 3.2 Referential integrity — RESTRICT (ratified Q-5)

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
it. (`task_template_versions` is already delete-protected by
`immutable_version_delete_check`, so this is defence in depth, matching migration `023`'s stated rule
that *"nothing it references may be removed while the evidence exists."*)

### 3.3 Coherence and immutability trigger (ratified Q-5; revised by Q-4)

A cross-table `CHECK` cannot express these, so a `BEFORE INSERT OR UPDATE` trigger enforces:

| Rule | Rationale |
|---|---|
| `task_template_step_version_id` may only be set when `task_template_version_id` is set | a step version has no meaning without its version |
| the version's `task_template_id` equals the record's `task_template_id` | **version/template coherence** (Q-5) |
| the step version belongs to the cited version | **step-version membership** (Q-5) |
| the version is in scope: `organization_id IS NULL OR = NEW.organization_id` | **frozen tenant-scope compatibility** (Q-5) |
| the cited version is `published` **at pin creation**, and is `published` **or `superseded`** at completion write — **never `retired`** | ratified Q-4: a task is pinned under current published guidance and may complete under that pin if it is superseded mid-task; retirement stops execution |
| the write presents **server-side pin evidence** for the resolved version (never a bare client-supplied id) | ratified Q-4: *"Do not treat a client-supplied version ID as proof of legitimate task-start pinning."* The mechanism is the open decision **D-1** (§7) |
| attribution columns are immutable after first write | **immutable attribution** (Q-5); *legitimate amendments to unfrozen observation content remain permitted* (Q-5) |
| no UPDATE may set attribution on an existing NULL row | **no fabricated historical backfill** (Q-5) |

> **Amendability boundary note.** `asset_observations` today makes the captured substance amendable while
> `frozen_at IS NULL` (migration `023`, `asset_observation_lifecycle_check`). Q-5 keeps that for content
> but makes **attribution** immutable from first write. Attaining both requires extending the `023`
> lifecycle check (or adding a dedicated trigger) — a real, bounded change to the amendability boundary,
> not a free-standing addition.

### 3.4 Indexes

A partial index on each new version column where NOT NULL, for "which captures used version X" analysis.

---

## 4. Impact and safety analysis

| Question | Answer |
|---|---|
| Existing rows | Unchanged; new columns NULL. **No backfill, no inference, no reinterpretation** (Q-5). |
| Existing application paths | Unaffected. A path that does not opt in writes NULL; only the **governed published-knowledge path** must attribute (Q-3). |
| Destructive operations | **None.** Additive columns, additive constraints, additive trigger. Forward-only. |
| Migration re-runnability | `ADD COLUMN IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` idiom — idempotent, like migrations `020` and `023`. |
| Rollback readiness | A follow-up migration could drop the columns; the repository's forward-only policy means that is itself a reviewed migration. |
| Performance | Nullable columns and partial indexes; the write path gains one indexed FK check. |
| Pack compatibility | None. Packs compose `task_template_versions` and are unaffected. |
| Test impact | New focused suite + registration in the sanctioned runner and the database-test guard. |
| Production | Applying `024` would be a production schema change. **Nothing is applied by this record, and no production migration may be run manually.** |

---

## 5. What this record does and does not decide

**Decided (OWNER, 2026-10-10, §6):** the attribution columns exist (Q-1); they live on both tables and
the tables are not consolidated (Q-2); legacy/procedure-less rows may stay unattributed while governed
captures must attribute (Q-3); the version is pinned server-side at task start with defined supersession
and retirement behaviour (Q-4); and the referential/immutability posture is `RESTRICT` + immutable
attribution (Q-5).

**Still open:**

- **D-1 — the pinning mechanism** (§7): a persisted pin entity versus a server-issued signed pin
  credential. **This is the one gating decision; the affected portion is STOPPED.**
- The `effective_from`/`effective_to` "active default" that `ATM-001 §8.3` reserves. KF-04A resolves
  explicitly; an active default remains unimplemented and unclaimed.
- The operational UI. That is KF-04C, inside the existing inspection/observation work surface.
- The legacy `inspection_results` `ON DELETE CASCADE` evidence-loss risk (§8) — recorded, **not**
  remediated here, and recommended for a separate bounded investigation.

---

## 6. OWNER ratification (2026-10-10)

The five questions raised by this design were put to the OWNER and **approved** as follows. The text in
the "Ratified decision" column is the decision of record.

| # | Question (as asked) | Ratified decision | Effect on this design |
|---|---|---|---|
| **Q-1** | Approve adding version-attribution columns to `asset_observations` and `inspection_results` as designed (§3)? | **APPROVED.** Add nullable version-attribution columns. | §3.1 ratified |
| **Q-2** | Should the columns live on both tables, or is one of them the single operational record of the future? | **APPROVED.** Apply attribution to **both** `asset_observations` and `inspection_results`. **Do not consolidate the tables in this mission.** | §3.1 ratified for both tables; no consolidation |
| **Q-3** | Is attribution optional (nullable, as designed) or mandatory whenever a capture is driven by published knowledge? | **APPROVED.** Legacy and procedure-less records **may remain without** version attribution. **New captures executed through the governed published-knowledge path must retain the exact resolved version.** Preserve backward compatibility. | §2.6 and §4 updated: nullable in schema, mandatory on the governed path only |
| **Q-4** | On insert, must the cited version be `published` only, or may a superseded version be cited when a task started under it (ATM-002-R6 §6)? | **APPROVED.** **Pin the published version at task start.** Never silently substitute a newer version. A **superseded** version may be used for completion **only when trustworthy task-start pinning exists** and continuation remains authorized and safe. A **newly initiated** task must **not** select an already-superseded version. **Retirement stops execution** pending explicit disposition. **Do not treat a client-supplied version ID as proof of legitimate task-start pinning.** | §3.3 lifecycle rule revised; §7 pinning contract added; needs a server-side pin (**D-1**) |
| **Q-5** | Approve the `RESTRICT` FK + immutability trigger posture? | **APPROVED.** Use **`RESTRICT` version foreign keys.** Enforce: version/template coherence; step-version membership; frozen tenant-scope compatibility; **immutable attribution after first write**; **no fabricated historical backfill**. **Preserve legitimate amendments to unfrozen observation content.** | §3.2 and §3.3 ratified; §3.3 amendability note added |

**No contradiction with the approved sources.** Q-4 implements `ATM-002-R6` §6 directly (pin at start,
no silent substitution, retirement stops). Q-1/Q-2/Q-5 implement `ATM-001` §8.2 ("operational references
point to a specific published version"; "historical versions remain readable"; published versions
immutable). Q-3 keeps `ATM-000` axiom 4 and migration `023`'s procedure-less observation intact. Q-3's
"governed path must attribute" is a **ratified OWNER decision**, not an unapproved business rule.

---

## 7. Task-start pinning contract (ratified Q-4; mechanism decision **D-1** OPEN)

### 7.1 Why this section exists — the current implementation has no task-start record

Ratified Q-4 demands **server-side** pinning and forbids trusting a client-supplied version id.
Investigation of the current implementation at the baseline establishes that **no server-side
task/session/pin entity exists**:

| Surface | Current behaviour |
|---|---|
| `POST /m/asset/:assetId/inspect` (`mobile-inspection.controller.js`) | Accepts `{ template_id, results[], started_at, completed_at }` **from the client** and writes `inspection_results` rows immediately. The server never records that a task *started*, and `started_at` is client-supplied |
| `GET /m/asset/:assetId/inspect/:templateId` | Resolves the **working** definition via `TaskTemplate.getWithDetails`; persists nothing |
| `POST /api/observations` (`observation.service.js`) | `proveProcedure` checks only that the **working** template is global-or-same-tenant and that the step belongs to it. No version, no pin |
| `work_orders` (004) / `inspection_points` (004) | Exist, but are **not linked** to this flow; `inspection_points` anchors on legacy `task_master_id`, not `task_templates` |
| Published-version resolution | **Absent from `main`** — KF-04A (PR #81) is unmerged, so no published version can be resolved at all yet |

Therefore a trustworthy pin cannot be derived from anything that exists today. The smallest
architecture-correct mechanism is **either** a new persisted pin entity **or** a server-issued signed pin
credential. Choosing between them is an architectural decision, so this contract fixes the required
**properties** and **stops the mechanism choice at D-1**.

### 7.2 Required properties

| # | Requirement |
|---|---|
| **A. Pin creation authority** | The pin is created **by the server**, for the authenticated principal authorized to execute the task (`INSPECTIONS.EXECUTE` / `INSPECTIONS.SUBMIT`). A client may *request* task start; it may never *assert* the pin. Mechanism: **D-1**. |
| **B. Server-side pin evidence** | The evidence must be independent of the client and must at minimum establish: the tenant; the asset; the working template; the **immutable `task_template_version_id` resolved by the server through the KF-04A resolver at pin time**; the resolving principal; and the resolution timestamp. A client-supplied `template_version_id` is **never** pin evidence. |
| **C. Pin identity and lifecycle** | A pin is identifiable and has a lifecycle: `active → completed` (task finished) and `active → abandoned`/`expired` (task not completed). Immutable facts: version id, tenant, asset, template, created-by, created-at. Mechanism: **D-1**. |
| **D. Supersession behaviour** | At **creation** the resolved version must be `published`. If it becomes `superseded` before completion, a capture may cite it **only** with valid pin evidence and only while continuation remains authorized and safe (`ATM-002-R6` §6). A **newly initiated** task must never pin an already-`superseded` version. |
| **E. Retirement behaviour** | A `retired` pinned version **stops execution**: the write is refused and the runner must surface it as no-longer-applicable (`ATM-002-R6` §6). No silent fallback to a newer version. |
| **F. Resume / interruption** | `ATM-003-R2` §3.5 requires interruption-safe resume with the work's evidence intact. The pin must survive navigation and session expiry. This is a **strong argument for a persisted pin entity over a short-lived token** (see D-1). |
| **G. Attribution write validation** | Service **and** database enforcement of §3.3, plus: the write must present server-verified pin evidence; the cited version must equal the pin's version; `retired` → refuse; tenant/asset/template must match the pin. |
| **H. Legacy compatibility** | Columns nullable; legacy rows stay NULL; no backfill; the pin requirement applies only to new captures on the governed path (Q-3). |
| **I. Tenant isolation** | Pin and write are tenant-bound; the cited version must be global (`organization_id IS NULL`) or the record's tenant; a cross-tenant write is a **non-disclosing** refusal. |
| **J. Failure behaviour (fail closed)** | No resolvable published version at pin time → the **governed** capture does not proceed (it may not be silently written unattributed on that path). Pin/write mismatch → **409**. `retired` → **409**. Out-of-scope version → **404**. Missing pin evidence on the governed path → **refuse**, never silently NULL. |
| **K. Required tests** | See §7.3. |
| **L. Migration requirements** | `024` (attribution columns, FKs, indexes, coherence/immutability trigger) is implementable **without** D-1. The pin entity, if chosen, requires its **own** migration (`025`) and its own approval. The two must not be combined into one migration or one PR. |

### 7.3 Required tests (K)

1. Attributed capture writes the **resolved** version and step version; read-back is exact.
2. Legacy / procedure-less capture writes NULL and is accepted.
3. Governed-path capture **without** pin evidence is refused (fail closed) and writes no row.
4. A client-supplied version id is **ignored/rejected** and cannot substitute for pin evidence.
5. Version/template mismatch → refused; step version not in the cited version → refused.
6. Cross-tenant version → non-disclosing refusal, no row.
7. `retired` pinned version → refused; no silent fallback.
8. `superseded` completion under a valid pin → accepted; `superseded` **new** pin → refused.
9. Attribution immutability: an UPDATE attempting to change attribution on an existing row is refused; an UPDATE of unfrozen *content* (text/measurement) still succeeds (Q-5).
10. No fabricated backfill: an UPDATE setting attribution on a legacy NULL row is refused.
11. Concurrency: two captures for one pin resolve the same version; supersession mid-flight does not change an existing pin.
12. Tenant isolation across organisations for both tables.

### 7.4 D-1 — OPEN DECISION (STOPPED FOR ARCHITECTURAL APPROVAL)

| Option | Description | Strengths | Costs |
|---|---|---|---|
| **D-1(a) Persisted pin entity** — *PROPOSED* | A server-owned record, e.g. `task_knowledge_pins` (tenant, asset, working template, resolved version, created-by, created-at, lifecycle). | Satisfies **F** (survives interruption/session expiry), **C** (real lifecycle and audit), and revocation-on-retirement; single source of truth for mid-task continuity. | New operational entity → new migration `025`; needs architectural approval. |
| **D-1(b) Server-issued signed pin credential** | The task-start endpoint issues a signed token carrying tenant/asset/template/version/issued-at/expiry; the capture verifies it server-side. | No new table; reuses the existing JWT signing infrastructure. | Weaker on **F** (short-lived tokens vs long tasks), no central revocation/lifecycle, and the token becomes a de-facto operational artifact. |

**PROPOSED (not decided): D-1(a), the persisted pin entity.** Per the mission rule, **this portion is
STOPPED** until the architect ratifies D-1. No pin entity, token, table, migration `025`, route or code is
created by this record.

---

## 8. Legacy evidence-integrity finding (recorded, NOT remediated)

| Field | Record |
|---|---|
| Finding | **`inspection_results` uses `ON DELETE CASCADE` for `task_template_id` and `task_template_step_id`** (`database/postgresql/004_work_management.sql`, `fk_inspection_results_inspection_results_ibfk_4` / `…_ibfk_5`), and likewise for `organization_id`, `facility_id` and `asset_id` |
| Risk | Deleting a **working** task template (or step) **destroys inspection evidence** that references it. This contradicts `ATM-000` *"Evidence Before Assumption"* and the RESTRICT posture migration `023` adopted precisely to avoid it ("*nothing it references may be removed while the evidence exists*") |
| Relationship to KF-04B | Adding a `RESTRICT` **version** FK does **not** fix this: the version is the FK *target*, not the deleted row. Attribution exposes the gap; it does not create it |
| Pre-existing? | **Yes** — migration `004`, unchanged by KF-06, KF-04A, KF-04B or PR #79 |
| Disposition | **Recorded only. Not remediated in PR #82.** Recommended: a separate bounded investigation and remediation mission covering (i) whether `inspection_results` is still the strategic record beside `asset_observations`, (ii) the correct delete posture per FK, and (iii) a non-destructive migration path. Requires architectural approval before any change |

---

## 9. Interim state

- **KF-04A (PR #81)** is the read half; complete, tested, awaiting review. It changes no schema.
- **KF-04B (this record)** is **ratified in design**; no implementation, and the pinning mechanism
  (**D-1**) is open.
- **KF-04C** is not started; it depends on D-1 and on `024` being implemented.
- Requirement 14 (G-14) remains **PARTIAL**. Requirement 15 (G-15) remains **PARTIAL**. Neither is
  upgraded by this record; only merged, independently verified implementation may upgrade them.

## 10. Non-actions

No code changed, no test changed, no migration written or applied, no schema touched, no production
access or migration, no deployment, no knowledge authored/approved/published, no capability or bundle
change, no API contract change, no PR #27/#81/#83/#84 change, and no merge.
