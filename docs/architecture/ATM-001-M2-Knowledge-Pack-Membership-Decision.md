# ATM-001 M2 — Knowledge Pack Membership Decision

**Decision record for ATM-001 M2 (Immutable Knowledge Pack Membership).**

Implementation: `database/postgresql/014_knowledge_pack_membership.sql`.

## Decision

1. **Knowledge Pack membership uses type-specific membership tables.**
   M2 introduces `knowledge_pack_version_task_template_versions`. Each future
   immutable knowledge type gets its own membership table when that type's
   version model actually exists.

2. **M2 supports exactly one member type: `task_template_versions`.**
   A template version already fixes its relevant versioned content — steps,
   safety controls, evidence/provenance and governance attribution — and is the
   atomic publication boundary. Pack membership therefore references the
   template version only; no separate membership rows are created for those
   child objects, and no content is duplicated.

3. **Polymorphic membership was rejected for M2.**
   A single `(item_type, item_version_id)` pair cannot carry a native foreign
   key, so referential integrity could only be approximated by triggers or
   application logic. ATM-013D2 acknowledged this weakness in its own risk
   register ("referential integrity is enforced via version tables; `item_type`
   documents intent") and anticipated separate tables as a stricter future
   design. M2 adopts that stricter design now because the invariant —
   membership may only reference immutable knowledge — must not be bypassable.

4. **No generic immutable-version registry or snapshot architecture is
   introduced.**
   The snapshot/registry designs (`knowledge_published_snapshots`,
   `knowledge_pack_snapshots`) are rejected architecture from ATM-013D and
   superseded by ATM-013D2's normalized immutable version tables. M2 does not
   reintroduce them, and does not add a general knowledge-version identity
   abstraction for elegance.

5. **`task_template_versions` remains independent of Knowledge Packs.**
   M2 deliberately does **not** add `task_template_versions.knowledge_pack_version_id`,
   and does not modify `TaskTemplate.publishVersion()`. Publication requires no
   pack. Its absence is an intentional architecture boundary and is asserted by
   test, not merely left unimplemented. This keeps the closed M1 publication
   contract unchanged: a task template publishes on its own terms, and a
   published version may subsequently be selected as a member of a
   pre-publication pack version.

6. **Pack composition references immutable constituent versions.**
   A pack version is composed by reference, never by copy. Historical pack
   contents therefore cannot drift when working knowledge is edited: the
   membership row points at an immutable version, and the working record is not
   part of the package.

7. **This decision does not decide tenant deployment or adoption.**
   Composition and deployment are separate concerns. ATM-001 §6.4 and §10.3
   (snapshot copy, reference with overlay, or hybrid) remain open, and M2
   implements none of them. No deployment, overlay, synchronisation, import,
   export or marketplace behaviour is defined here.

8. **Future knowledge types must earn pack membership.**
   An object may become a pack member only once it has a proper immutable
   version model. Taxonomy, reliability data and other domains currently have
   none — taxonomy tables are mutable master data — so they are excluded from
   M2 rather than approximated. Membership of those domains requires their own
   versioning work first.

## Invariants enforced

Enforced in PostgreSQL by migration 014's guard function
(`knowledge_pack_membership_guard`) and foreign keys, with the existing
migration 009 pack-version immutability triggers left untouched:

| Invariant | Enforced by |
|---|---|
| A pack version may gain members only while `draft`, `under_review` or `approved` | Guard trigger (INSERT) |
| A released pack version cannot lose members | Guard trigger (DELETE) |
| Membership is never retargeted or rewritten | Guard trigger (UPDATE, always rejected) |
| Membership can only reference immutable knowledge | Foreign key to `task_template_versions` (only ever holds published/superseded/retired rows) |
| A member can never be deleted out from under a pack | `ON DELETE RESTRICT` on both sides |
| Membership attribution is never silently erased | `added_by_user_id` `ON DELETE RESTRICT` (not `SET NULL`) |
| Working-knowledge edits cannot alter pack contents | Composition by reference |
| A task-template version appears at most once per pack version | `UNIQUE (knowledge_pack_version_id, task_template_version_id)` |

## Out of scope

Pack lifecycle orchestration, pack publication service, API routes,
controllers, UI, AI metadata, taxonomy versioning, tenant deployment,
adoption, overlays, synchronisation, marketplace distribution, import/export,
and membership for any knowledge type other than `task_template_versions`.
