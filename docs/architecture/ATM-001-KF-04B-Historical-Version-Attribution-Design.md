# ATM-001-KF-04B — Historical Version Attribution: Migration Design and Approval Request

**Document ID:** ATM-001-KF-04B
**Mission:** ATM-001-KF-FINAL — Knowledge Foundation V1 completion (workstream KF-04B)
**Status:** **DESIGN — NOT IMPLEMENTED. REQUIRES ARCHITECTURAL APPROVAL BEFORE ANY CODE OR MIGRATION.**
**Baseline:** `origin/main` = `f156aa4479efe783eefd4f13fd62171647f83b7f`
**Authorisation:** none to implement. This record requests a decision; it changes nothing.
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
6. **Legacy-safe and optional at first.** A procedure-less observation (migration `023` explicitly
   supports one) has no version. Attribution is therefore **nullable**; whether it becomes *mandatory*
   for published-knowledge-driven captures is a business-rule decision for the OWNER (§6, Q-3).

---

## 3. Proposed migration `024_operational_knowledge_version_attribution.sql`

> **Not written, not applied. This is a proposal attached to an approval request.** It is expressed as
> DDL so the decision is concrete; the wording, column names and constraints are all open to the
> architect's direction.

### 3.1 Additive columns

```sql
-- asset_observations: the observation-level version and (optionally) the step-level version.
ALTER TABLE asset_observations
    ADD COLUMN IF NOT EXISTS task_template_version_id      INTEGER DEFAULT NULL;
ALTER TABLE asset_observations
    ADD COLUMN IF NOT EXISTS task_template_step_version_id INTEGER DEFAULT NULL;

-- inspection_results: the legacy field-workflow record. Both refs are NOT NULL today,
-- so a version reference is added the same way — nullable, to preserve history.
ALTER TABLE inspection_results
    ADD COLUMN IF NOT EXISTS task_template_version_id      INTEGER DEFAULT NULL;
ALTER TABLE inspection_results
    ADD COLUMN IF NOT EXISTS task_template_step_version_id INTEGER DEFAULT NULL;
```

### 3.2 Referential integrity (RESTRICT, matching every other evidence reference)

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

### 3.3 Coherence and immutability trigger (sketch)

A cross-table `CHECK` cannot express these, so a `BEFORE INSERT OR UPDATE` trigger would enforce:

| Rule | Rationale |
|---|---|
| `task_template_step_version_id` may only be set when `task_template_version_id` is set | a step version has no meaning without its version |
| the version's `task_template_id` equals the record's `task_template_id` | no cross-definition attribution |
| the version's `lifecycle_state_at_publish = 'published'` **at insert** | a capture may only cite current published guidance; historical reads of superseded rows are a read concern, not a new-capture concern |
| the version is in scope: `organization_id IS NULL OR = NEW.organization_id` | tenant safety, enforced at the database boundary |
| the step version belongs to the cited version | no fabricated step attribution |
| attribution columns are immutable after insert | attribution is evidence |

### 3.4 Indexes

A partial index on each new column where NOT NULL, for "which captures used version X" analysis.

---

## 4. Impact and safety analysis

| Question | Answer |
|---|---|
| Existing rows | Unchanged; new columns NULL. **No backfill, no inference, no reinterpretation.** |
| Existing application paths | Unaffected. A path that does not opt in writes NULL. |
| Destructive operations | **None.** Additive columns, additive constraints, additive trigger. Forward-only. |
| Migration re-runnability | `ADD COLUMN IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` idiom — idempotent, like migrations `020` and `023`. |
| Rollback readiness | A follow-up migration could drop the columns; the repository's forward-only policy means that is itself a reviewed migration. |
| Performance | Nullable columns and partial indexes; the write path gains one indexed FK check. |
| Pack compatibility | None. Packs compose `task_template_versions` and are unaffected. |
| Test impact | New focused suite + registration in the sanctioned runner and the database-test guard. |
| Production | Applying `024` would be a production schema change. **Nothing is applied by this record, and no production migration may be run manually.** |

---

## 5. What this design deliberately does **not** decide

- It does **not** decide whether attribution is mandatory. (See Q-3.)
- It does **not** decide whether `inspection_results` and `asset_observations` both need step-level
  attribution, or whether one of them is superseded. That is an ATM-002 information-architecture
  question.
- It does **not** design the `effective_from`/`effective_to` "active default" that
  `ATM-001 §8.3` reserves. KF-04A resolves explicitly; an active default remains unimplemented and
  unclaimed.
- It does **not** design the operational UI. That is KF-04C, and it stays inside the existing
  inspection/observation work surface.

---

## 6. Approval questions (the STOP gate)

Mission rule (§12): *"Stop the affected workstream when a schema redesign is necessary / a new business
rule is required / a production action is required."* All three are engaged. Decisions requested:

| # | Question | Why it needs the architect |
|---|---|---|
| **Q-1** | Approve adding version-attribution columns to `asset_observations` and `inspection_results` as designed (§3)? | new operational data model surface (G-14) |
| **Q-2** | Should the columns live on both tables, or is one of them the single operational record of the future? | ATM-002 information architecture |
| **Q-3** | Is attribution **optional** (nullable, as designed) or **mandatory** whenever a capture is driven by published knowledge? | mandatory would be a new business rule and would need a back-compat strategy for legacy rows |
| **Q-4** | On insert, must the cited version be `published` only (as designed), or may a superseded version be cited when a task started under it (ATM-002-R6 §6 "completes against the version it started with")? | this is the mid-task version-change rule; the design's insert-time `published`-only rule is the conservative reading, but a long-running task could legitimately finish under a newly superseded version |
| **Q-5** | Approve the `RESTRICT` FK + immutability trigger posture? | evidence integrity semantics |

Until Q-1 … Q-5 are answered, **no code and no migration for KF-04B will be written**, and KF-04C
(operational consumption, which must record the resolved version) stays blocked behind this gate.

---

## 7. Interim state

- **KF-04A (PR #81)** is the read half and is complete, tested and awaiting review. It changes no
  schema.
- **KF-04B** is this design. No implementation.
- **KF-04C** is not started; it depends on Q-1 … Q-5.
- Requirement 14 (G-14) remains **PARTIAL**. Requirement 15 (G-15) remains **PARTIAL**. Neither is
  upgraded by this record.

## 8. Non-actions

No code changed, no migration added, no schema touched, no production access, no deployment, no
knowledge authored, approved or published, no capability or bundle change, no PR #27 change.
