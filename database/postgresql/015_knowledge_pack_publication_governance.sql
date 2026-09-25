-- ATM-001 M4 — Knowledge Pack Publication Governance
--
-- WHY THIS MIGRATION EXISTS
--
-- Migration 013 established the governance standard for governed immutable
-- knowledge: a version in a governed state (published / superseded / retired)
-- must durably attribute its reviewer, its approver, and the accountable human
-- who published it; the approver must not be the publisher; and those
-- constraints are enforced by PostgreSQL so that direct SQL cannot construct a
-- non-conformant governed row. Migration 013 states the standard explicitly:
-- "An unattributed governed version is unrepresentable."
--
-- knowledge_pack_versions carries the same governed lifecycle vocabulary
-- (migration 009) but received none of those constraints. A published pack
-- version was therefore an UNATTRIBUTED GOVERNED VERSION: migration 013
-- contains zero references to Knowledge Packs. Because a Knowledge Pack is the
-- unit that composes governed immutable knowledge, allowing Pack publication to
-- operate at a weaker standard than the knowledge it contains is not
-- architecturally defensible. This migration closes that gap.
--
-- The Chief Architect approved this closure (decision "R2") with a strictly
-- limited scope. Two defects are closed:
--
--   D1 — Publisher attribution was unrepresentable. knowledge_pack_versions had
--        no publishing-principal column at all, so the segregation-of-duties
--        rule (approver != publisher) could only ever be checked against a
--        transient request actor and could never be enforced by the database.
--
--   D2 — The M2 membership guard (migration 014) read the parent pack version's
--        lifecycle_state with a plain SELECT, taking no lock on the parent row.
--        A concurrent membership INSERT could therefore pass its lifecycle
--        check, and commit AFTER a publication transition, leaving a published
--        pack whose composition changed after the publication boundary. The
--        guard could not be serialized against publication by row locking
--        because it held no lock on the row it was reasoning about.
--
-- SCOPE — strictly limited to:
--   A. durable publisher attribution
--   B. governed-state attribution constraints
--   C. approver/publisher separation
--   D. closing the M2 membership/publication concurrency race
--
-- DELIBERATELY OUT OF SCOPE:
--   - No `rejected` lifecycle state. Rejection/resubmission semantics are a
--     separate future product decision. The lifecycle remains exactly
--     draft / under_review / approved / published / superseded / retired.
--   - No attribution table, no polymorphic membership, no knowledge-version
--     registry, no taxonomy version model.
--   - No change to migration 001-014, to M1 template publication admission, to
--     the M2 membership architecture (type-specific membership by reference),
--     or to M3 provenance authoring.
--   - No application workflow for supersession/retirement. The schema continues
--     to support those states; M4 exposes no API for them.
--
-- IDEMPOTENT DEPLOYMENT
--
-- scripts/migrate-postgres.js keeps no applied-migrations ledger: EVERY run
-- re-applies EVERY discovered file in ascending order. Each statement below is
-- therefore safe to re-execute. Constraints use DROP IF EXISTS + ADD rather
-- than a plain existence guard, following the convergence precedent set by
-- migration 013: if an earlier revision of this file ever installed a weaker
-- definition, a bare existence check would silently leave such a database
-- ungoverned.
--
-- Adding these constraints VALIDATES existing rows, so this migration fails on a
-- database that already contains a governed knowledge_pack_versions row without
-- the required attribution. That is fail-closed by design: such rows are
-- precisely what the invariant forbids.
--
-- ============================================================
-- PART 2A — Durable publisher attribution
-- ============================================================
-- The accountable publisher of a released pack must stay historically
-- attributable, exactly as for task_template_versions (migration 013 PART 4).
-- Nullable before publication; required by the governed-state constraint below.

ALTER TABLE knowledge_pack_versions
    ADD COLUMN IF NOT EXISTS published_by_user_id INTEGER DEFAULT NULL;

-- RESTRICT rather than SET NULL: a publisher is governed historical
-- attribution. SET NULL would silently erase who released already-published
-- knowledge when the user row was removed, and would leave a governed row
-- violating chk_knowledge_pack_versions_requires_governance after an unrelated
-- user deletion.
ALTER TABLE knowledge_pack_versions
    DROP CONSTRAINT IF EXISTS fk_knowledge_pack_versions_published_by;
ALTER TABLE knowledge_pack_versions
    ADD CONSTRAINT fk_knowledge_pack_versions_published_by
    FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- The RESTRICT check scans the referencing side when a user row is removed, and
-- no existing index leads with this column. Migration 014 introduced the same
-- index for the same reason on its RESTRICT FK. This index serves only the
-- referential-integrity check; it is not a query index.
CREATE INDEX IF NOT EXISTS idx_knowledge_pack_versions_published_by
    ON knowledge_pack_versions (published_by_user_id);

-- ============================================================
-- PART 2B — Governed-state attribution
-- ============================================================
-- Equivalent in intent to chk_task_template_versions_requires_governance
-- (migration 013). A pack version in a governed state must carry the complete
-- governance attribution; a pack version still being prepared (draft,
-- under_review, approved) carries whatever attribution has accrued so far and
-- is unconstrained here.
--
-- reviewer/approver timestamps are required alongside the identities so that a
-- governed pack version records WHEN each accountable act occurred, not merely
-- who performed it.

ALTER TABLE knowledge_pack_versions
    DROP CONSTRAINT IF EXISTS chk_knowledge_pack_versions_requires_governance;
ALTER TABLE knowledge_pack_versions
    ADD CONSTRAINT chk_knowledge_pack_versions_requires_governance
    CHECK (
        lifecycle_state NOT IN ('published', 'superseded', 'retired')
        OR (
            reviewer_user_id IS NOT NULL
            AND reviewed_at IS NOT NULL
            AND approver_user_id IS NOT NULL
            AND approved_at IS NOT NULL
            AND published_by_user_id IS NOT NULL
        )
    );

-- ============================================================
-- PART 2C — Segregation of duties: approver != publisher
-- ============================================================
-- Both identities are columns of this same row, so the rule is intrinsic
-- row-local truth and PostgreSQL must not permit direct SQL to construct a
-- governed published pack version whose approver is also its publisher.
--
-- The constraint is written as "when both identities are present" and mirrors
-- the wording of chk_task_template_versions_approver_not_publisher (migration
-- 013). That is not a loophole: chk_knowledge_pack_versions_requires_governance
-- above makes BOTH columns NOT NULL for every governed state. Between the two
-- constraints, an unattributed governed pack version is unrepresentable and a
-- governed pack version whose approver is its publisher is unrepresentable.
--
-- Enforced here rather than only in the publication admission service so that
-- the invariant survives any future caller, script, or manual SQL.

ALTER TABLE knowledge_pack_versions
    DROP CONSTRAINT IF EXISTS chk_knowledge_pack_versions_approver_not_publisher;
ALTER TABLE knowledge_pack_versions
    ADD CONSTRAINT chk_knowledge_pack_versions_approver_not_publisher
    CHECK (
        lifecycle_state NOT IN ('published', 'superseded', 'retired')
        OR approver_user_id IS NULL
        OR published_by_user_id IS NULL
        OR approver_user_id <> published_by_user_id
    );

-- ============================================================
-- PART 2D — Membership concurrency integrity
-- ============================================================
-- Closes D2. The guard now takes a row-level lock on the parent pack version
-- while it decides whether a membership mutation is permitted, so the lifecycle
-- decision and the mutation are serialized against a concurrent publication
-- transition on the SAME row.
--
-- Lock mode FOR SHARE (not FOR UPDATE) is the smallest sufficient mechanism:
--   - FOR SHARE conflicts with the exclusive row lock that the publication
--     UPDATE takes, so publication waits for an in-flight membership mutation
--     and can therefore never freeze a composition that is still being written;
--   - it does NOT conflict with itself, so two legitimate concurrent membership
--     mutations on the same pre-publication pack version still proceed in
--     parallel. FOR UPDATE would needlessly serialize composition authoring.
--   - when publication has already committed, the waiting guard re-reads the
--     committed row under READ COMMITTED and rejects the mutation, because the
--     parent is no longer in an authorized pre-publication state.
--
-- The lifecycle rules are UNCHANGED and are not weakened: INSERT and DELETE are
-- still permitted exactly while the parent is draft / under_review / approved,
-- UPDATE is still always rejected, and published / superseded / retired remain
-- frozen.
--
-- This mirrors migration 014's convention of DROP + CREATE for triggers to
-- stay idempotent.

CREATE OR REPLACE FUNCTION knowledge_pack_membership_guard()
RETURNS TRIGGER AS $$
DECLARE
    parent_lifecycle TEXT;
    parent_version_id INTEGER;
BEGIN
    -- Membership is immutable in the strict sense: it may never be retargeted.
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'knowledge_pack_version_task_template_versions rows are immutable and cannot be updated'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF TG_OP = 'DELETE' THEN
        parent_version_id := OLD.knowledge_pack_version_id;
    ELSE
        parent_version_id := NEW.knowledge_pack_version_id;
    END IF;

    -- FOR SHARE serializes this decision against a concurrent publication
    -- transition of the same pack version. Without the lock, a membership
    -- mutation could pass this check and commit after publication, mutating the
    -- composition of an already-released pack.
    SELECT lifecycle_state INTO parent_lifecycle
    FROM knowledge_pack_versions
    WHERE id = parent_version_id
    FOR SHARE;

    -- A non-existent parent is left to the foreign key to report, so native
    -- referential-integrity semantics produce the canonical FK violation.
    IF parent_lifecycle IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF parent_lifecycle NOT IN ('draft', 'under_review', 'approved') THEN
        RAISE EXCEPTION 'cannot % knowledge pack membership while knowledge_pack_version % is %; membership is frozen once a pack version is released',
            lower(TG_OP), parent_version_id, parent_lifecycle
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kpvtv_membership_guard_insert
    ON knowledge_pack_version_task_template_versions;
DROP TRIGGER IF EXISTS trg_kpvtv_membership_guard_update
    ON knowledge_pack_version_task_template_versions;
DROP TRIGGER IF EXISTS trg_kpvtv_membership_guard_delete
    ON knowledge_pack_version_task_template_versions;

CREATE TRIGGER trg_kpvtv_membership_guard_insert
    BEFORE INSERT ON knowledge_pack_version_task_template_versions
    FOR EACH ROW
    EXECUTE FUNCTION knowledge_pack_membership_guard();

CREATE TRIGGER trg_kpvtv_membership_guard_update
    BEFORE UPDATE ON knowledge_pack_version_task_template_versions
    FOR EACH ROW
    EXECUTE FUNCTION knowledge_pack_membership_guard();

CREATE TRIGGER trg_kpvtv_membership_guard_delete
    BEFORE DELETE ON knowledge_pack_version_task_template_versions
    FOR EACH ROW
    EXECUTE FUNCTION knowledge_pack_membership_guard();
