# ATM-001 M4 — Knowledge Pack Publication Admission Decision

Status: implemented on branch `atm-001-m4-pack-publication-admission`; **not merged**.
Baseline: `origin/main` = `2caef23bd13a149abefbecb620b19ceafa2ced17` (M3 merged).

## Decision

A Knowledge Pack is the unit that composes governed immutable knowledge. A Pack
must therefore not be publishable at a weaker governance standard than the
knowledge it contains.

Migrations 009–013 established that standard for task template publication and
migration 014 established immutable, reference-only Pack membership. Migration
013 contains **zero** references to Knowledge Packs, so `knowledge_pack_versions`
carried the governed lifecycle vocabulary with none of its constraints. A
published Pack version was consequently an **unattributed governed version** —
exactly the state migration 013 declares unrepresentable:

> "The required attribution for a governed version is therefore complete:
> reviewer, reviewer time, approver, approval time, safety-review state, safety
> reviewer, safety-review time, and the publishing principal. An unattributed
> governed version is unrepresentable."

Two defects followed from that gap:

**D1 — Publisher attribution was unrepresentable.** `knowledge_pack_versions`
had no publishing-principal column, so `approver <> publisher` could only ever be
checked against a transient request actor and could never be enforced by the
database.

**D2 — Membership could mutate across the publication boundary.** The M2 guard
(migration 014) read the parent lifecycle state with a plain `SELECT`, holding no
lock on the row it was reasoning about. A concurrent membership `INSERT` could
pass its lifecycle check and commit *after* a publication transition, leaving a
published Pack whose composition changed after the boundary. Publication could
not block it by row locking, because the writer held no lock on the parent row.

The Chief Architect approved closing both gaps (decision **R2**) with a strictly
limited scope. Migration 015 implements it.

## Migration 015 — exact schema changes

Limited to four parts. No other schema redesign is included.

| Part | Change |
|---|---|
| 2A | `knowledge_pack_versions.published_by_user_id` — nullable before publication, FK → `users(id)` **ON DELETE RESTRICT**, plus an index serving the RESTRICT check |
| 2B | `chk_knowledge_pack_versions_requires_governance` — for `published` / `superseded` / `retired`, require `reviewer_user_id`, `reviewed_at`, `approver_user_id`, `approved_at`, `published_by_user_id` |
| 2C | `chk_knowledge_pack_versions_approver_not_publisher` — `approver_user_id <> published_by_user_id` when both are present |
| 2D | `knowledge_pack_membership_guard()` takes `FOR SHARE` on the parent `knowledge_pack_versions` row while deciding |

`RESTRICT` rather than `SET NULL` matches migration 013's convergence: a publisher
is governed historical attribution and must stay attributable, and erasing it
would leave a governed row violating 2B after an unrelated user deletion.

### Why `FOR SHARE` and not `FOR UPDATE`

`FOR SHARE` conflicts with the exclusive row lock a publication `UPDATE` takes, so
publication waits for an in-flight membership mutation and can never freeze a
composition that is still being written. It does **not** conflict with itself, so
two legitimate concurrent membership mutations on the same pre-publication Pack
version still proceed in parallel; `FOR UPDATE` would serialize composition
authoring needlessly. Once publication has committed, a waiting guard re-reads the
committed row under READ COMMITTED and rejects the mutation, because the parent is
no longer in an authorized pre-publication state.

The M2 lifecycle rules are unchanged: `INSERT`/`DELETE` remain authorized exactly
while the parent is `draft` / `under_review` / `approved`, `UPDATE` remains always
rejected, and `published` / `superseded` / `retired` remain frozen.

### The lock is necessary but not sufficient on its own

The parent-row lock in the guard stops membership landing **after** publication.
It cannot stop membership landing **between** the publication gate's validation
and its transition, because that is a validate-then-write gap rather than a lock
conflict. The application publication path therefore takes `SELECT ... FOR UPDATE`
on the Pack version row **before** reading and validating the composition, inside
one transaction. Together the two produce the invariant:

> A published Pack's composition is exactly the composition the publication gate
> validated.

## Pack publication invariants

Publication executes as one controlled transaction and refuses, with **every**
reason found and nothing written, unless all of the following hold:

1. the Pack version exists;
2. its lifecycle state is `approved` (release is the transition `approved → published`);
3. reviewer attribution exists;
4. the review timestamp exists;
5. approver attribution exists;
6. the approval timestamp exists;
7. the publisher is the authenticated publishing principal;
8. the publisher is not the approver;
9. the Pack has at least one member;
10. every member is an existing immutable **published** `task_template_version`;
11. the composition is protected against concurrent mutation by the locked row.

Publisher attribution, publication timestamp and lifecycle state are written in
the **same** UPDATE. Post-publication backfill of publisher identity is
impossible: migration 009 permits no content change once published, and migration
015 requires the publisher to be present for a governed state.

## Member eligibility

Membership remains exactly what migration 014 established: type-specific,
**by reference**, never polymorphic, and never a working template. The membership
column is a foreign key to `task_template_versions`, so a working
`task_templates` row is structurally unrepresentable as a member.

M4 narrows this to **published, globally applicable** versions:

- a **superseded** or **retired** version is immutable but no longer current, so
  it is not composable;
- a **tenant-scoped** version is refused, because `knowledge_packs` is shared
  knowledge — it has no `organization_id` column and migration 009 never gave it
  one — so composing one tenant's private published knowledge into a shared Pack
  would publish that tenant's knowledge to every consumer of the Pack.

M4 never publishes a task template as a side effect of composition, and never
mutates the knowledge it composes.

## Lifecycle

`draft → under_review → approved → published`, with every transition an atomic
compare-and-set on the current state (`WHERE ... AND lifecycle_state = <expected>`),
so two concurrent callers cannot both observe a stale state and advance twice.

Review records attribution without advancing the state; approval is a separate
accountable act by a separate capability and is refused unless a review was
actually recorded.

**`rejected` is deliberately not implemented.** Rejection and resubmission
semantics are a separate future product decision, and migration 015 does not add
the state. No supersession or retirement workflow is exposed either; the schema
continues to support those states without M4 providing an API for them.

## Authorization

Reuses the existing capability model. No new framework, and no capability broadened.

| Operation | Capability | Admitted roles |
|---|---|---|
| create Pack, create Pack version, add/remove membership | `TASKS.CREATE` / `TASKS.UPDATE` | admin |
| submit for review, record review | `KNOWLEDGE.REVIEW` | supervisor, admin |
| approve | `KNOWLEDGE.APPROVE` | supervisor, admin |
| publish | `requireAdmin` (the M1 publication pattern) | supervisor, admin |
| read Pack, versions, membership | `KNOWLEDGE.VIEW` | all roles |

An accountable act is always attributed to the authenticated principal
(`req.user.id`) and never to a value supplied by the caller in the request body.
Publication does not reuse the Pack-authoring guard: releasing governed shared
knowledge is authorized by the M1 publication pattern, not by the authoring
capability.

## Model mutation surface

`KnowledgePack.update`/`delete` and `KnowledgePackVersion.update`/`delete` are
explicitly refused rather than inherited from `BaseModel`. Inheriting them would
advertise a mutation surface M4 must not have: a Pack version is a governed
lifecycle record that transitions through its states and is immutable once
published, and a Pack identity is not renamed in place. This follows the boundary
honesty established in M3.

## Explicit non-goals

- Pack UI, Pack marketplace, Pack search.
- Tenant adoption, deployment, installation, snapshot/overlay, synchronisation.
- Import/export, Pack dependencies, taxonomy versioning or membership.
- AI recommendations, document management.
- Candidate curation or publication.
- Operational Findings, and any change to PR #27.
- `rejected` lifecycle and rejection/resubmission semantics.
- Supersession/retirement application workflows.
- Any change to migrations 001–014, to M1 template publication admission, to the
  M2 membership architecture, or to M3 provenance authoring behaviour.

## Compatibility consequence

Adding 2B makes an unattributed governed Pack version unrepresentable, which
obliged pre-existing raw-SQL fixtures in `tests/knowledge-versioning.test.js` and
`tests/knowledge-pack-membership.test.js` to supply the attribution that the new
invariant requires. Migration 013 recorded the same consequence and the same
ruling for task template versions:

> "This is enforced in PostgreSQL even though it obliged the pre-existing
> knowledge-versioning suite to adapt its fixtures … fixtures do not define the
> product architecture, and a governance invariant that only the service can
> uphold would not survive a direct SQL write."

No fixture was rewritten to bypass the invariant; only governed-state fixtures
gained attribution, and pre-publication states deliberately carry none, because
recording an approval for a version that was never approved would be false
attribution rather than a fixture convenience.
