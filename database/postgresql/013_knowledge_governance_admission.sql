-- =====================================================
-- Atiman Knowledge Governance — Publication Admission
-- ATM-001 M1: governed knowledge publication admission gate.
--
-- A published task-template version represents governed knowledge. This
-- migration adds the two things the model lacked to make that true:
--
--   1. A working-template review lifecycle (draft -> under_review ->
--      approved | rejected) so that publication requires an ALREADY approved
--      template, rather than approval asserted at publish time.
--   2. An explicit safety-review state on the working template, so that
--      "reviewed - no control required" is distinguishable from
--      "safety never assessed".
--
-- It also freezes the governance attribution onto the immutable published
-- version, so a later change to the working template cannot alter what was
-- approved and published.
--
-- Scope:
-- - task_templates: review lifecycle + attribution + safety review state.
-- - task_template_versions: frozen governance attribution.
--
-- Out of scope (explicitly deferred):
-- - Knowledge Pack membership.
-- - Authoring or publishing corpus knowledge.
-- - Generic workflow/state-machine infrastructure.
-- - A user qualification model (V1 maps capability onto existing roles).
--
-- Forward-only: migrations 001-012 are not modified. Idempotent:
-- ADD COLUMN IF NOT EXISTS / guarded constraint creation.
-- =====================================================

-- =====================================================
-- PART 1 — task_templates: governed review lifecycle
-- =====================================================

ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS review_state varchar(20) NOT NULL DEFAULT 'draft';

ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS submitted_for_review_by_user_id INTEGER DEFAULT NULL;
ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS submitted_for_review_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS reviewer_user_id INTEGER DEFAULT NULL;
ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS approver_user_id INTEGER DEFAULT NULL;
ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT NULL;

-- The material-content fingerprint captured at approval. Publication recomputes
-- it and refuses to proceed if the working knowledge changed after approval, so
-- an approval can never be applied to content the approver did not see.
ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS approved_content_sha varchar(64) DEFAULT NULL;

ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS safety_review_state varchar(40) NOT NULL DEFAULT 'not_assessed';
ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS safety_reviewed_by_user_id INTEGER DEFAULT NULL;
ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS safety_reviewed_at TIMESTAMPTZ DEFAULT NULL;

-- =====================================================
-- PART 2 — task_template_versions: frozen governance attribution
-- =====================================================

ALTER TABLE task_template_versions
    ADD COLUMN IF NOT EXISTS reviewer_user_id INTEGER DEFAULT NULL;
ALTER TABLE task_template_versions
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE task_template_versions
    ADD COLUMN IF NOT EXISTS approver_user_id INTEGER DEFAULT NULL;
ALTER TABLE task_template_versions
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE task_template_versions
    ADD COLUMN IF NOT EXISTS approved_content_sha varchar(64) DEFAULT NULL;
ALTER TABLE task_template_versions
    ADD COLUMN IF NOT EXISTS safety_reviewed_by_user_id INTEGER DEFAULT NULL;
ALTER TABLE task_template_versions
    ADD COLUMN IF NOT EXISTS safety_reviewed_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE task_template_versions
    ADD COLUMN IF NOT EXISTS safety_review_state varchar(40) DEFAULT NULL;

-- =====================================================
-- PART 3 — Row-local constraints (safe and unambiguous only)
-- =====================================================
-- Cross-table invariants (for example "reviewed_controls_defined requires at
-- least one task_template_safety_controls row") are deliberately NOT encoded
-- here: a CHECK constraint cannot express them without a trigger, and the
-- admission validator enforces them transactionally instead.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_task_templates_review_state'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT chk_task_templates_review_state
            CHECK (review_state IN ('draft', 'under_review', 'approved', 'rejected'));
    END IF;
END
$$;

-- Submitted knowledge records who submitted it and when.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_task_templates_submitted_requires_attribution'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT chk_task_templates_submitted_requires_attribution
            CHECK (
                review_state NOT IN ('under_review', 'approved', 'rejected')
                OR (submitted_for_review_by_user_id IS NOT NULL AND submitted_for_review_at IS NOT NULL)
            );
    END IF;
END
$$;

-- An approval is only meaningful with a reviewer decision, an approver, a
-- timestamp, and the fingerprint of the content that was approved.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_task_templates_approved_requires_attribution'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT chk_task_templates_approved_requires_attribution
            CHECK (
                review_state <> 'approved'
                OR (
                    reviewer_user_id IS NOT NULL
                    AND reviewed_at IS NOT NULL
                    AND approver_user_id IS NOT NULL
                    AND approved_at IS NOT NULL
                    AND approved_content_sha IS NOT NULL
                )
            );
    END IF;
END
$$;

-- A rejection must state why, and must carry the reviewing decision.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_task_templates_rejected_requires_reason'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT chk_task_templates_rejected_requires_reason
            CHECK (
                review_state <> 'rejected'
                OR (
                    rejection_reason IS NOT NULL
                    AND length(btrim(rejection_reason)) > 0
                    AND reviewer_user_id IS NOT NULL
                    AND reviewed_at IS NOT NULL
                )
            );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_task_templates_safety_review_state'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT chk_task_templates_safety_review_state
            CHECK (safety_review_state IN (
                'not_assessed', 'reviewed_no_control_required', 'reviewed_controls_defined'
            ));
    END IF;
END
$$;

-- "not_assessed" is the only state that may lack a safety reviewer, because it
-- is the state that asserts no safety review has happened.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_task_templates_safety_review_requires_attribution'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT chk_task_templates_safety_review_requires_attribution
            CHECK (
                safety_review_state = 'not_assessed'
                OR (safety_reviewed_by_user_id IS NOT NULL AND safety_reviewed_at IS NOT NULL)
            );
    END IF;
END
$$;

-- =====================================================
-- Published-version governance invariant (row-local)
-- =====================================================
-- A row that claims to be a governed published knowledge version must not be
-- representable without its mandatory frozen governance attribution. This is
-- intrinsic row-level truth and therefore belongs in PostgreSQL, not only in
-- the publication service.
--
-- Only row-local truths appear here. The following are deliberately NOT encoded
-- because they require traversal, context, or application workflow, and remain
-- service/domain responsibilities:
--   - evidence sufficiency and source-version traversal;
--   - "reviewed_controls_defined requires >= 1 safety control row" (cross-table);
--   - parent-template cycle detection (cross-row);
--   - permission and qualified-reviewer checks;
--   - approval content-hash / staleness verification;
--   - step and rule conformance.
--
-- NOTE: an earlier revision of this migration claimed that "approver != publisher"
-- could not be encoded here because publisher identity is not a column of this
-- row. That claim was factually wrong: task_template_versions.published_by_user_id
-- (migration 009) IS on this row and IS the publishing principal, so the
-- segregation rule is intrinsic row-local truth. It is enforced below.
--
-- The required attribution for a governed version is therefore complete:
--   reviewer, reviewer time, approver, approval time, safety-review state,
--   safety reviewer, safety-review time, and the publishing principal.
-- An unattributed governed version is unrepresentable.
--
-- Converge on reruns, following the precedent set by migration 009 for
-- chk_task_template_versions_lifecycle_state: an earlier revision of this
-- migration already installed this constraint without the publisher
-- requirement, so a plain IF NOT EXISTS guard would silently leave such a
-- database ungoverned. DROP + ADD installs the current definition either way.
--
-- Consequence, stated deliberately: the ADD validates existing rows, so this
-- migration FAILS on a database that already contains a governed
-- task_template_versions row with a NULL publisher. That is fail-closed by
-- design — such rows are precisely what the invariant forbids — and any
-- database in that state must be remediated before this migration is applied.
-- No such row exists in the Atiman corpus (task_template_versions is empty and
-- no version has ever been published).
ALTER TABLE task_template_versions
    DROP CONSTRAINT IF EXISTS chk_task_template_versions_requires_governance;

ALTER TABLE task_template_versions
    ADD CONSTRAINT chk_task_template_versions_requires_governance
    CHECK (lifecycle_state_at_publish NOT IN ('published', 'superseded', 'retired') OR (
        reviewer_user_id IS NOT NULL
        AND reviewed_at IS NOT NULL
        AND approver_user_id IS NOT NULL
        AND approved_at IS NOT NULL
        AND safety_review_state IN ('reviewed_no_control_required', 'reviewed_controls_defined')
        AND safety_reviewed_by_user_id IS NOT NULL
        AND safety_reviewed_at IS NOT NULL
        AND published_by_user_id IS NOT NULL
    ));

-- The invariant deliberately applies to every value that
-- chk_task_template_versions_lifecycle_state permits. There is no lifecycle
-- state in which a task_template_versions row may exist without this
-- attribution, so no published, superseded or retired row can be inserted,
-- promoted or left behind ungoverned.
--
-- This is enforced in PostgreSQL even though it obliged the pre-existing
-- knowledge-versioning suite to adapt its fixtures (see
-- tests/knowledge-versioning.test.js): fixtures do not define the product
-- architecture, and a governance invariant that only the service can uphold
-- would not survive a direct SQL write.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_task_template_versions_safety_review_state'
          AND conrelid = 'task_template_versions'::regclass
    ) THEN
        ALTER TABLE task_template_versions
            ADD CONSTRAINT chk_task_template_versions_safety_review_state
            CHECK (safety_review_state IS NULL OR safety_review_state IN (
                'not_assessed', 'reviewed_no_control_required', 'reviewed_controls_defined'
            ));
    END IF;
END
$$;

-- =====================================================
-- Segregation of duties: approver != publisher (row-local)
-- =====================================================
-- ATM-001 M1 requires that whoever approves governed knowledge is not the
-- principal who publishes it. Both identities are columns of this same row —
-- approver_user_id is the frozen approver, published_by_user_id (migration 009)
-- is the publishing principal — so the rule is intrinsic row-local truth and
-- PostgreSQL must not permit direct SQL to construct a governed published
-- version that violates it.
--
-- Scope of this constraint: it applies when BOTH identities are present. That is
-- not a loophole, because a governed version is now required to carry a
-- publisher at all (chk_task_template_versions_requires_governance above makes
-- published_by_user_id NOT NULL for every governed lifecycle state). Between the
-- two constraints an unattributed governed version is unrepresentable and a
-- governed version whose approver is its publisher is unrepresentable.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_task_template_versions_approver_not_publisher'
          AND conrelid = 'task_template_versions'::regclass
    ) THEN
        ALTER TABLE task_template_versions
            ADD CONSTRAINT chk_task_template_versions_approver_not_publisher
            CHECK (
                lifecycle_state_at_publish NOT IN ('published', 'superseded', 'retired')
                OR published_by_user_id IS NULL
                OR approver_user_id IS NULL
                OR approver_user_id <> published_by_user_id
            );
    END IF;
END
$$;

-- =====================================================
-- PART 4 — Foreign keys to users
-- =====================================================

-- =====================================================
-- Publisher attribution durability (ON DELETE SET NULL -> RESTRICT)
-- =====================================================
-- The accountable publisher of immutable governed knowledge must stay
-- historically attributable. Migration 009 created this foreign key as
-- ON DELETE SET NULL, which would silently erase the publisher of already
-- published knowledge when the user row was removed — and, now that a governed
-- version requires a non-null publisher, would also make such a row violate the
-- governance constraint on an unrelated user deletion.
--
-- This aligns publisher accountability with the frozen reviewer, approver and
-- safety-review attribution added above, all of which are already
-- ON DELETE RESTRICT.
--
-- The existing constraint name and delete action are read from the catalog
-- rather than assumed: migration 009 declares it as
-- fk_task_template_versions_published_by. confdeltype 'r' is RESTRICT; the DROP
-- is therefore skipped once the database is already converged, which keeps
-- migration 013 safe to reapply.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_task_template_versions_published_by'
          AND conrelid = 'task_template_versions'::regclass
          AND contype = 'f'
          AND confdeltype <> 'r'
    ) THEN
        ALTER TABLE task_template_versions
            DROP CONSTRAINT fk_task_template_versions_published_by;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_task_template_versions_published_by'
          AND conrelid = 'task_template_versions'::regclass
    ) THEN
        ALTER TABLE task_template_versions
            ADD CONSTRAINT fk_task_template_versions_published_by
            FOREIGN KEY (published_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_task_templates_reviewer_user'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT fk_task_templates_reviewer_user
            FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_task_templates_approver_user'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT fk_task_templates_approver_user
            FOREIGN KEY (approver_user_id) REFERENCES users(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_task_templates_submitted_by_user'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT fk_task_templates_submitted_by_user
            FOREIGN KEY (submitted_for_review_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_task_templates_safety_reviewed_by_user'
          AND conrelid = 'task_templates'::regclass
    ) THEN
        ALTER TABLE task_templates
            ADD CONSTRAINT fk_task_templates_safety_reviewed_by_user
            FOREIGN KEY (safety_reviewed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_task_template_versions_reviewer_user'
          AND conrelid = 'task_template_versions'::regclass
    ) THEN
        ALTER TABLE task_template_versions
            ADD CONSTRAINT fk_task_template_versions_reviewer_user
            FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_task_template_versions_approver_user'
          AND conrelid = 'task_template_versions'::regclass
    ) THEN
        ALTER TABLE task_template_versions
            ADD CONSTRAINT fk_task_template_versions_approver_user
            FOREIGN KEY (approver_user_id) REFERENCES users(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_task_template_versions_safety_reviewed_by_user'
          AND conrelid = 'task_template_versions'::regclass
    ) THEN
        ALTER TABLE task_template_versions
            ADD CONSTRAINT fk_task_template_versions_safety_reviewed_by_user
            FOREIGN KEY (safety_reviewed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_task_templates_review_state
    ON task_templates (review_state);

CREATE INDEX IF NOT EXISTS idx_task_templates_organization_review_state
    ON task_templates (organization_id, review_state);
