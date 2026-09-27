-- ATM-001 M6.4 Step 3B-B — AI-assistance disclosure on the working definition
--
-- Records whether AI materially helped produce or modify the maintenance or
-- engineering knowledge that an accountable human is submitting, so that:
--
--   * an accountable author can declare it truthfully while the definition is a
--     draft, where a human reviewer and approver can see it;
--   * publication freezes the disclosure that was actually approved into the
--     immutable version (and its step versions); and
--   * the fact does not silently disappear when knowledge becomes immutable.
--
-- This is a PROVENANCE/ATTRIBUTION dimension, independent of `content_origin`:
--
--   content_origin          answers "who is accountable for this knowledge?"
--   ai_assistance_disclosure answers "was AI materially involved in producing it?"
--
-- `content_origin = 'authored'` therefore means ACCOUNTABLE-HUMAN-AUTHORED and
-- does NOT mean AI was never involved. There is deliberately no `ai_generated`
-- content origin, and `content_origin` is never rewritten because AI assisted.
--
-- Deliberately out of scope: AI generation itself, prompts, models, providers,
-- token usage, sessions, or any interaction history. The frozen version needs the
-- disclosure fact, not an AI observability record.
--
-- NULL vs FALSE — these mean different things and must stay distinct:
--
--   NULL  = the AI-assistance status was never captured under this regime
--   FALSE = AI assistance was explicitly disclosed as not materially used
--
-- Existing rows therefore become NULL. They are NEVER backfilled as FALSE:
-- asserting "AI was not used" for historical knowledge would fabricate a claim no
-- artifact establishes. Adding the columns with no default accomplishes that
-- backfill implicitly, so no UPDATE is issued against historical knowledge at all.
--
-- Idempotency: scripts/migrate-postgres.js reapplies every migration on every run
-- and keeps no applied-migrations ledger, so this file must be safe to execute
-- repeatedly. Both columns use ADD COLUMN IF NOT EXISTS and each constraint is
-- guarded by a pg_constraint existence check.
--
-- Forward-only: additive only; no existing column, constraint or row is altered.

-- ===========================================================================
-- PART 1 — disclosure columns on the working definition
-- ===========================================================================
-- No DEFAULT is declared, deliberately, mirroring migration 020's treatment of
-- knowledge_scope and content_origin: an omitted disclosure must not silently
-- become "no AI was used". Absence is represented by NULL, which asserts nothing.

ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS ai_assisted BOOLEAN DEFAULT NULL;
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS ai_assistance_detail JSONB DEFAULT NULL;

-- ===========================================================================
-- PART 2 — disclosure coherence
-- ===========================================================================
-- The flag and its detail are a single attribution fact and must not contradict
-- each other, in either direction:
--
--   ai_assisted = TRUE  -> detail must be meaningfully present
--   ai_assisted = FALSE -> detail must be NULL
--   ai_assisted = NULL  -> detail must be NULL
--
-- Stated once as a single biconditional rather than as separate checks, so the
-- two directions cannot drift apart. The degenerate JSONB values that carry no
-- statement ('{}', JSON null, empty string) are rejected as "not meaningfully
-- present"; richer emptiness checks live in the authoring validator.
--
-- This mirrors the coherence rule the governed crosswalk layer already applies to
-- its own AI disclosure ("an AI-assisted row must say what was assisted"), applied
-- here to maintenance knowledge.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_task_templates_ai_assistance_coherence'
                     AND conrelid = 'task_templates'::regclass) THEN
        ALTER TABLE task_templates ADD CONSTRAINT chk_task_templates_ai_assistance_coherence
            CHECK (
                (ai_assisted IS NOT TRUE AND ai_assistance_detail IS NULL)
                OR
                (ai_assisted IS TRUE
                 AND ai_assistance_detail IS NOT NULL
                 AND ai_assistance_detail::text NOT IN ('{}', 'null', '""'))
            );
    END IF;
END $$;

-- ===========================================================================
-- PART 3 — disclosure on the immutable step versions
-- ===========================================================================
-- task_template_step_versions.ai_assisted is nullable (migration 009) and its
-- DEFAULT FALSE is harmless here because publication always states an explicit
-- value: the disclosure of the version it belongs to. No schema change is needed;
-- this note records why the existing shape is sufficient.

-- ===========================================================================
-- PART 4 — no backfill
-- ===========================================================================
-- There is intentionally no UPDATE in this migration. Every existing row keeps
-- NULL disclosure (unknown under this regime), including the 846 legacy-generated
-- definitions. Historical AI involvement is not knowable from any controlled
-- artifact, so neither FALSE nor TRUE may be asserted for it.
