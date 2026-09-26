-- ATM-001 M5R.4B — Governed Taxonomy Identity Lifecycle Mechanism
-- Implements the MECHANISM approved by the OWNER-ratified architecture record
--   docs/architecture/ATM-001-M5R4B1-Taxonomy-Identity-Lifecycle-Architecture.md
-- §9 (preferred architecture), §10 (proposed data semantics), §11 (invariants),
-- §12 (provenance/governance) and §21.14 (the ratified decision set).
--
-- MECHANISM ONLY. This file creates structure and inserts nothing. It does NOT
-- apply the ratified M5R.4A / M5R.4B1 taxonomy decisions: it does not create the
-- `Mining Equipment` category, the five ratified classes, `Submersible Pump`,
-- the 55 identity-resolution records or the 65 terminology records, and it does
-- not rename, reclassify, supersede or retire a single equipment type. Applying
-- that content is a separate governed step (M5R.4B2, not started, not
-- authorised). After this migration alone, every existing equipment type is
-- operationally equivalent to its pre-migration state.
--
-- ---------------------------------------------------------------------------
-- OPTION D — the ratified architecture, and how each part lands here
-- ---------------------------------------------------------------------------
--
--   1. CANONICAL IDENTITY stays in equipment_types. No second canonical Type
--      table is introduced.
--
--   2. IDENTITY LIFECYCLE is one ADDITIVE column, equipment_types.identity_state,
--      with exactly three values: canonical / superseded / retired. Existing rows
--      backfill to 'canonical' through the column DEFAULT, so the migration
--      preserves existing semantics by construction.
--      There is deliberately NO fourth value. Uncertainty is NOT a lifecycle
--      state: `pending`, `under_review`, `unresolved` and `ratified` are refused
--      by the CHECK, and RULING 2 keeps ratification separate from lifecycle.
--
--   3. GOVERNED IDENTITY RESOLUTION is equipment_type_identity_resolution.
--      Endpoints are immutable Type IDs (from_type_id / to_type_id); type_name
--      and type_code are never used as a relationship key.
--
--   4. GOVERNED TERMINOLOGY is equipment_type_term, preserving historical and
--      alternate engineering vocabulary without creating duplicate canonical
--      Types. ABBREVIATION is deliberately NOT a term kind: it is orthogonal to
--      the relationship (a term can be both an abbreviation and a merged-identity
--      term), so modelling it as a kind would create a false dichotomy.
--
-- ---------------------------------------------------------------------------
-- GOVERNANCE — reused, not reinvented
-- ---------------------------------------------------------------------------
--
-- The governance shape is migration 017's, because 017 already solves the same
-- concerns for a governed relationship about an equipment type:
--   review_state vocabulary (draft/under_review/approved/rejected);
--   full human attribution with an approved-requires-attribution CHECK;
--   ai_assisted + ai_assistance_detail disclosure;
--   partial uniqueness among ACTIVE APPROVED rows only, so competing proposals
--   and full history stay representable and uniqueness is never achieved by
--   deleting knowledge;
--   RESTRICT on every governed reference;
--   a delete guard that permits hard deletion only while a row is a draft;
--   whole-row immutability once approved.
-- Migration 018's exactly-one-subject / coherence CHECK idiom is used for the
-- kind-to-target coherence rules.
--
-- AI CANNOT APPROVE. approved_by_user_id references users(id); an AI principal
-- is not a users row, so an unattributable approval is unrepresentable rather
-- than merely forbidden by policy.
--
-- ---------------------------------------------------------------------------
-- COHERENCE INVARIANTS ENFORCED HERE (ratified §11)
-- ---------------------------------------------------------------------------
--   I1  a Type may not resolve to itself                     (CHECK + trigger)
--   I2  a resolution with a target must target a CANONICAL Type   (trigger)
--   I3  resolution chains are forbidden: depth is exactly 1        (trigger)
--   I4  A -> B while B -> A is unrepresentable                     (trigger)
--   I5  at most one active approved resolution per source Type  (partial index)
--   I6  approved target -> source 'superseded'; approved no-target -> 'retired'
--                                                                 (trigger)
--   I6b [BLOCKER-1] at COMMIT a non-canonical Type carries EXACTLY ONE active
--       approved resolution, and it agrees with the standing's kind/target
--       semantics; supersession can therefore never strand a standing without
--       a governed conclusion                          (DEFERRED constraint trigger)
--   I6c [BLOCKER-1] supersession is append-only and well-formed: only an
--       approved conclusion may be superseded, by a resolution about the SAME
--       source type, never itself, never closing a cycle          (trigger)
--   I7  a 'canonical' Type has no active approved resolution       (trigger)
--   I8  an approved row carries attribution and a rationale        (CHECK)
--   I9  AI cannot satisfy the approver requirement                  (FK + CHECK)
--   I10 an approved row cannot be deleted                          (trigger)
--   I11 governed history cannot vanish through a taxonomy delete   (RESTRICT)
--   I14 external classification remains external — no FK path exists here
--
-- RULING 1 is enforced STRUCTURALLY, not by convention: an INSUFFICIENT_EVIDENCE
-- record must have a NULL target and may never be approved, so it can never
-- coerce a lifecycle transition. "We cannot conclude" can never become "retired".
--
-- ---------------------------------------------------------------------------
-- DELIBERATELY NOT DONE
-- ---------------------------------------------------------------------------
--   - No taxonomy population, no corpus application, no seed data.
--   - No tenant / customer alias column: M5R.1 §6.2 defers that architecture and
--     M5R.4A produced zero CUSTOMER_SPECIFIC rows. Both new tables are GLOBAL.
--   - No AI behaviour of any kind: no model call, scoring or automatic approval.
--   - No change to asset-import.service.js and no false-provenance remediation.
--   - No hardening of the pre-existing equipment_classes / equipment_categories
--     CASCADE behaviour. That broader delete-hardening problem stays deferred;
--     only the new structures are protected here.
--   - No migration framework change and no applied-migrations ledger.
--
-- ---------------------------------------------------------------------------
-- IDENTIFIER LENGTH
-- ---------------------------------------------------------------------------
-- PostgreSQL silently TRUNCATES identifiers at 63 bytes rather than failing —
-- the defect observed during M5R.3C. AUTO-GENERATED constraint names are the
-- hazard: an inline self-reference on
-- equipment_type_identity_resolution.superseded_by_resolution_id would be named
-- equipment_type_identity_resolution_superseded_by_resolution_id_fkey (67 bytes)
-- and silently truncated. Every constraint, index, trigger and function below is
-- therefore NAMED EXPLICITLY and audited; the longest identifier introduced by
-- this migration is 59 bytes
-- (chk_equipment_type_identity_resolution_insufficient_pending). The
-- supersession-safety objects added in §6 are shorter still, so the measured
-- maximum is unchanged.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENCY
-- ---------------------------------------------------------------------------
-- scripts/migrate-postgres.js keeps NO applied-migrations ledger and re-applies
-- EVERY file on EVERY run, so this file must be safe to execute repeatedly:
-- CREATE ... IF NOT EXISTS, DROP ... IF EXISTS before CREATE TRIGGER, and
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS. Functions use CREATE OR REPLACE.
-- Re-running must not duplicate an object, must not destroy data, and must not
-- re-backfill or reset identity_state on rows that have already moved.

-- ============================================================
-- 1. Identity lifecycle standing on equipment_types
-- ============================================================
-- Additive and backfilled through the DEFAULT, which is what makes existing rows
-- 'canonical' without a data migration and without a table rewrite on repeat
-- runs. The column is NOT NULL so an unstated standing is unrepresentable.
ALTER TABLE equipment_types
    ADD COLUMN IF NOT EXISTS identity_state VARCHAR(20) NOT NULL DEFAULT 'canonical';

-- ADD CONSTRAINT is not idempotent, so drop first (migration 002's idiom).
ALTER TABLE equipment_types
    DROP CONSTRAINT IF EXISTS chk_equipment_types_identity_state;

ALTER TABLE equipment_types
    ADD CONSTRAINT chk_equipment_types_identity_state
    CHECK (identity_state IN ('canonical', 'superseded', 'retired'));

-- Read-path support for the ratified discovery/selection split (invariant I16):
-- selection offers CANONICAL types only, while discovery must still reach
-- superseded and retired vocabulary. Ratified §15.15 names this index as the
-- mitigation for the risk that a read path silently offers a revoked identity.
CREATE INDEX IF NOT EXISTS idx_equipment_types_canonical
    ON equipment_types (class_id)
    WHERE identity_state = 'canonical';

-- ============================================================
-- 2. Governed identity resolution
-- ============================================================
-- One row = one governed conclusion about ONE source type's identity standing.
--
-- resolution_kind semantics (ratified §10.2):
--   MERGED_DUPLICATE      the source was not a distinct identity; two rows once
--                         claimed one identity                      target REQUIRED
--   SYNONYM_OF            pure naming variant; the source's term remains valid
--                         vocabulary for the target                target REQUIRED
--   SUPERSEDED_BY         an identity formally replaced by a newer identity
--                                                                  target REQUIRED
--   NOT_AN_EQUIPMENT_TYPE the concept is an attribute, component, linear asset,
--                         duty qualifier or process designation — NOT a type.
--                         Where it belongs is recorded in the rationale, never
--                         asserted here.                            target FORBIDDEN
--   TOO_BROAD_FOR_TYPE    the concept is a container appropriate to class level
--                                                                  target FORBIDDEN
--   INSUFFICIENT_EVIDENCE we cannot conclude. PENDING ONLY.        target FORBIDDEN
CREATE TABLE IF NOT EXISTS equipment_type_identity_resolution (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    -- Subject: the equipment type whose standing is under governance.
    from_type_id INTEGER NOT NULL,
    -- Target: the canonical successor. NULL is a CONCLUSION, not an absence —
    -- this is migration 017's NO_DIRECT_MAPPING precedent, where a negative
    -- result is positive engineering knowledge and no fake target is fabricated.
    to_type_id INTEGER DEFAULT NULL,
    resolution_kind VARCHAR(30) NOT NULL,
    -- Mandatory for approval, optional while drafting (see the attribution
    -- CHECK). A governed conclusion with no stated reasoning is unrepresentable.
    rationale TEXT DEFAULT NULL,
    review_state VARCHAR(20) NOT NULL DEFAULT 'draft',
    proposed_by_user_id INTEGER DEFAULT NULL,
    reviewed_by_user_id INTEGER DEFAULT NULL,
    reviewed_at TIMESTAMPTZ DEFAULT NULL,
    approved_by_user_id INTEGER DEFAULT NULL,
    approved_at TIMESTAMPTZ DEFAULT NULL,
    -- Discloses that a proposal was AI-assisted. It never substitutes for human
    -- approval; see the attribution CHECK below and approved_by_user_id.
    ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
    ai_assistance_detail JSONB DEFAULT NULL,
    -- Reuses migration 011's source/edition substrate. NULL is permitted here
    -- because a M5R.4A-class decision rests on the legacy corpus plus Atiman
    -- engineering reasoning; where a source IS cited it must resolve to a real
    -- edition (RESTRICT), so "a source NAME is never sufficient" still holds.
    knowledge_source_version_id INTEGER DEFAULT NULL,
    effective_from TIMESTAMPTZ DEFAULT NULL,
    -- Supersession of a governed conclusion is a NEW row plus this back-link,
    -- never an in-place rewrite (migration 017's rule).
    superseded_by_resolution_id INTEGER DEFAULT NULL,
    created_at TIMESTAMPTZ NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),

    -- NORMATIVE kind/target coherence (migration 018's CHECK idiom): a kind that
    -- requires a target without one, and a no-successor conclusion carrying a
    -- fabricated target, are both UNREPRESENTABLE.
    CONSTRAINT chk_equipment_type_identity_resolution_coherence
        CHECK (
            (to_type_id IS NOT NULL AND resolution_kind IN
                ('MERGED_DUPLICATE', 'SYNONYM_OF', 'SUPERSEDED_BY'))
            OR
            (to_type_id IS NULL AND resolution_kind IN
                ('NOT_AN_EQUIPMENT_TYPE', 'TOO_BROAD_FOR_TYPE', 'INSUFFICIENT_EVIDENCE'))
        ),

    -- A type may not resolve to itself (invariant I1).
    CONSTRAINT chk_equipment_type_identity_resolution_no_self
        CHECK (to_type_id IS NULL OR to_type_id <> from_type_id),

    -- RULING 1, enforced structurally: insufficient evidence is a PENDING
    -- governance condition, never an approved one. Because the standing trigger
    -- coerces lifecycle only on approval, an approvable INSUFFICIENT_EVIDENCE row
    -- would be the one way to turn "we cannot conclude" into a retirement. This
    -- CHECK makes that path unrepresentable rather than merely discouraged.
    CONSTRAINT chk_equipment_type_identity_resolution_insufficient_pending
        CHECK (resolution_kind <> 'INSUFFICIENT_EVIDENCE'
               OR review_state IN ('draft', 'under_review')),

    -- Governance completeness (migration 017's approved-attribution rule): an
    -- approved row carries accountable human review and approval AND a stated
    -- rationale, so an unattributed or unreasoned governed conclusion is
    -- unrepresentable. An AI principal is not a users row, so this CHECK is also
    -- what makes AI approval impossible rather than merely prohibited.
    CONSTRAINT chk_equipment_type_identity_resolution_approved_attributed
        CHECK (
            review_state <> 'approved' OR (
                reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND
                approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND
                rationale IS NOT NULL AND btrim(rationale) <> ''
            )
        ),

    -- RESTRICT throughout: governed identity history must never disappear through
    -- a cascading delete of the taxonomy it concerns or the edition it cites.
    -- Every constraint is named explicitly because an auto-generated name for the
    -- self-reference below would exceed PostgreSQL's 63-byte identifier limit and
    -- be silently truncated.
    CONSTRAINT fk_equipment_type_identity_resolution_from_type
        FOREIGN KEY (from_type_id) REFERENCES equipment_types(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_type_identity_resolution_to_type
        FOREIGN KEY (to_type_id) REFERENCES equipment_types(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_type_identity_resolution_source_version
        FOREIGN KEY (knowledge_source_version_id) REFERENCES knowledge_source_versions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_type_identity_resolution_proposed_by
        FOREIGN KEY (proposed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_type_identity_resolution_reviewed_by
        FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_type_identity_resolution_approved_by
        FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_type_identity_resolution_superseded_by
        FOREIGN KEY (superseded_by_resolution_id) REFERENCES equipment_type_identity_resolution(id) ON DELETE SET NULL
);

-- ============================================================
-- Uniqueness — deliberately PARTIAL (invariant I5)
--
-- Only simultaneously ACTIVE and APPROVED rows are constrained. draft,
-- under_review and rejected rows may coexist freely, so competing proposals and
-- full history remain representable and uniqueness is never achieved by deleting
-- old knowledge (migration 017 §W.1).
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_type_identity_resolution_active
    ON equipment_type_identity_resolution (from_type_id)
    WHERE review_state = 'approved'
      AND superseded_by_resolution_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_type_identity_resolution_from_type
    ON equipment_type_identity_resolution (from_type_id);

CREATE INDEX IF NOT EXISTS idx_equipment_type_identity_resolution_to_type
    ON equipment_type_identity_resolution (to_type_id);

CREATE INDEX IF NOT EXISTS idx_equipment_type_identity_resolution_review_state
    ON equipment_type_identity_resolution (review_state);

-- ============================================================
-- 3. Governed terminology
-- ============================================================
-- Preserves historical and alternate engineering vocabulary WITHOUT creating a
-- duplicate canonical Type. The canonical Type remains the equipment_types row;
-- a term only says "this piece of vocabulary denotes that type".
CREATE TABLE IF NOT EXISTS equipment_type_term (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    -- The term as written. Preserved verbatim: normalisation is for MATCHING and
    -- must never be the stored form, or the historical spelling is destroyed.
    term VARCHAR(255) NOT NULL,
    -- The matching form: case-folded and whitespace-collapsed. Stored alongside
    -- the original so a lookup never has to guess, and constrained to be
    -- self-consistent so the two columns cannot drift apart into a false key.
    normalized_term VARCHAR(255) NOT NULL,
    -- The canonical type this vocabulary denotes.
    canonical_type_id INTEGER NOT NULL,
    -- The historical type row this term came from, where one exists. For a
    -- LEGACY_NAME created by renaming a type in place this equals
    -- canonical_type_id; for a merged or synonymised identity it is the retired
    -- source row, which is how the term's origin stays traceable.
    source_type_id INTEGER DEFAULT NULL,
    term_kind VARCHAR(30) NOT NULL,
    rationale TEXT DEFAULT NULL,
    review_state VARCHAR(20) NOT NULL DEFAULT 'draft',
    proposed_by_user_id INTEGER DEFAULT NULL,
    reviewed_by_user_id INTEGER DEFAULT NULL,
    reviewed_at TIMESTAMPTZ DEFAULT NULL,
    approved_by_user_id INTEGER DEFAULT NULL,
    approved_at TIMESTAMPTZ DEFAULT NULL,
    ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
    ai_assistance_detail JSONB DEFAULT NULL,
    knowledge_source_version_id INTEGER DEFAULT NULL,
    effective_from TIMESTAMPTZ DEFAULT NULL,
    superseded_by_term_id INTEGER DEFAULT NULL,
    created_at TIMESTAMPTZ NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),

    -- The ratified terminology kinds. ABBREVIATION is deliberately absent: it is
    -- a characterisation orthogonal to the relationship, not a competing kind.
    CONSTRAINT chk_equipment_type_term_term_kind
        CHECK (term_kind IN ('LEGACY_NAME', 'SYNONYM', 'MERGED_IDENTITY_TERM')),

    CONSTRAINT chk_equipment_type_term_review_state
        CHECK (review_state IN ('draft', 'under_review', 'approved', 'rejected')),

    -- A term must carry vocabulary and a matching form. The normalised column is
    -- required to already BE normalised, so a caller cannot smuggle a second
    -- distinct key in through casing or stray whitespace.
    CONSTRAINT chk_equipment_type_term_normalized_form
        CHECK (
            btrim(term) <> ''
            AND normalized_term <> ''
            AND normalized_term = lower(btrim(regexp_replace(normalized_term, '\s+', ' ', 'g')))
        ),

    CONSTRAINT chk_equipment_type_term_approved_attributed
        CHECK (
            review_state <> 'approved' OR (
                reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND
                approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND
                rationale IS NOT NULL AND btrim(rationale) <> ''
            )
        ),

    CONSTRAINT fk_equipment_type_term_canonical_type
        FOREIGN KEY (canonical_type_id) REFERENCES equipment_types(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_type_term_source_type
        FOREIGN KEY (source_type_id) REFERENCES equipment_types(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_type_term_source_version
        FOREIGN KEY (knowledge_source_version_id) REFERENCES knowledge_source_versions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_type_term_proposed_by
        FOREIGN KEY (proposed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_type_term_reviewed_by
        FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_type_term_approved_by
        FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_type_term_superseded_by
        FOREIGN KEY (superseded_by_term_id) REFERENCES equipment_type_term(id) ON DELETE SET NULL
);

-- Partial uniqueness among active approved rows. This is the ratified rule
-- (architecture §10.4). It prevents the same (term, canonical type) pair twice.
--
-- It deliberately does NOT make a term globally unique across ALL canonical
-- types. Ratified architecture §15.5 records that residual as REAL and defers a
-- hard constraint, because the live corpus already carries duplicate vocabulary
-- (`Pressure Filter` on two rows, `COMPACT` on two rows) and a global unique
-- index could not be deployed without first resolving it. Constraining that here
-- would contradict the ratified architecture, so this migration does not.
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_type_term_active
    ON equipment_type_term (normalized_term, canonical_type_id)
    WHERE review_state = 'approved'
      AND superseded_by_term_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_type_term_normalized
    ON equipment_type_term (normalized_term);

CREATE INDEX IF NOT EXISTS idx_equipment_type_term_canonical_type
    ON equipment_type_term (canonical_type_id);

CREATE INDEX IF NOT EXISTS idx_equipment_type_term_review_state
    ON equipment_type_term (review_state);

-- ============================================================
-- 4. Trigger functions — resolution
-- ============================================================

-- ------------------------------------------------------------
-- 4.1 Resolution coherence: self-reference, chains, cycles and target standing
--
-- A CHECK cannot see other rows, so the cross-row rules need a trigger. The
-- chain walk is migration 009's / 017's algorithm: follow the resolution chain
-- from the proposed target and refuse if it returns to the subject.
--
-- The chain rule is what makes resolution depth EXACTLY ONE (ratified I3): a
-- target must itself be canonical, and a canonical type carries no active
-- approved resolution, so A -> B -> C is unrepresentable and no recursive
-- resolution can ever be needed at query time.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION taxonomy_identity_resolution_coherence_check()
RETURNS TRIGGER AS $$
DECLARE
    target_state VARCHAR(20);
    incoming_count INTEGER;
    next_id INTEGER;
    visited INTEGER[];
BEGIN
    -- Invariant I3, the direction a chain actually forms in. A type that is
    -- ALREADY the canonical target of another approved resolution may not itself
    -- resolve onward: B -> A followed by A -> C would leave B pointing at A,
    -- which its own approved conclusion promised was canonical. Refusing here is
    -- what keeps resolution depth exactly one. A governed rebase is still
    -- expressible: supersede B -> A with a new B -> C, then resolve A onward.
    IF NEW.review_state = 'approved' THEN
        SELECT count(*) INTO incoming_count
        FROM equipment_type_identity_resolution r
        WHERE r.to_type_id = NEW.from_type_id
          AND r.review_state = 'approved'
          AND r.superseded_by_resolution_id IS NULL
          AND r.id IS DISTINCT FROM NEW.id;

        IF incoming_count > 0 THEN
            RAISE EXCEPTION 'equipment type % is already the canonical target of an approved resolution and may not itself resolve onward; that would create a resolution chain',
                NEW.from_type_id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF NEW.to_type_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Belt and braces with the CHECK; this gives a named, legible refusal.
    IF NEW.to_type_id = NEW.from_type_id THEN
        RAISE EXCEPTION 'equipment type % cannot resolve to itself', NEW.from_type_id
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT identity_state INTO target_state
    FROM equipment_types
    WHERE id = NEW.to_type_id;

    -- to_type_id is NOT NULL here, so a NULL target_state means no such row.
    IF target_state IS NULL THEN
        RAISE EXCEPTION 'to_type_id must reference an existing equipment type'
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- Invariant I2: an approved resolution must resolve DIRECTLY to a canonical
    -- type. Only approval carries that meaning; a draft may legitimately point at
    -- a target whose own standing is still being decided.
    IF NEW.review_state = 'approved' AND target_state <> 'canonical' THEN
        RAISE EXCEPTION 'approved resolution % may only resolve to a canonical equipment type; target % is %',
            NEW.from_type_id, NEW.to_type_id, target_state
            USING ERRCODE = 'check_violation';
    END IF;

    -- Chain and cycle detection (invariants I3 and I4).
    next_id := NEW.to_type_id;
    visited := ARRAY[NEW.from_type_id];
    LOOP
        IF next_id = ANY(visited) THEN
            RAISE EXCEPTION 'resolution for equipment type % would create a chain or cycle involving type %',
                NEW.from_type_id, next_id
                USING ERRCODE = 'check_violation';
        END IF;
        visited := array_append(visited, next_id);
        SELECT r.to_type_id INTO next_id
        FROM equipment_type_identity_resolution r
        WHERE r.from_type_id = next_id
          AND r.review_state = 'approved'
          AND r.superseded_by_resolution_id IS NULL;
        EXIT WHEN next_id IS NULL;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_type_identity_resolution_coherence
    ON equipment_type_identity_resolution;

CREATE TRIGGER trg_equipment_type_identity_resolution_coherence
    BEFORE INSERT OR UPDATE ON equipment_type_identity_resolution
    FOR EACH ROW
    EXECUTE FUNCTION taxonomy_identity_resolution_coherence_check();

-- ------------------------------------------------------------
-- 4.2 Resolution standing: lifecycle coercion on APPROVAL only (invariants I6/I7)
--
-- Runs AFTER so the row is visible to the equipment_types guard, which validates
-- that a non-canonical standing is always backed by an approved resolution.
--
-- Coercion fires ONLY on approval. That is precisely what keeps a pending
-- INSUFFICIENT_EVIDENCE record from touching the source type's standing, so
-- "we cannot conclude" can never become "retired" as a side effect of recording
-- the uncertainty (RULING 1 / VUDA H).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION taxonomy_identity_resolution_standing_check()
RETURNS TRIGGER AS $$
DECLARE
    new_state VARCHAR(20);
BEGIN
    IF NEW.review_state <> 'approved' THEN
        RETURN NULL;
    END IF;

    IF NEW.superseded_by_resolution_id IS NOT NULL THEN
        RETURN NULL;
    END IF;

    -- A conclusion WITH a successor leaves the identity interpretable through
    -- that successor: 'superseded'. A conclusion with NO successor says the
    -- concept is not an equipment type at all: 'retired'.
    IF NEW.to_type_id IS NOT NULL THEN
        new_state := 'superseded';
    ELSE
        new_state := 'retired';
    END IF;

    UPDATE equipment_types
    SET identity_state = new_state,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.from_type_id
      AND identity_state IS DISTINCT FROM new_state;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_type_identity_resolution_standing
    ON equipment_type_identity_resolution;

CREATE TRIGGER trg_equipment_type_identity_resolution_standing
    AFTER INSERT OR UPDATE ON equipment_type_identity_resolution
    FOR EACH ROW
    EXECUTE FUNCTION taxonomy_identity_resolution_standing_check();

-- ------------------------------------------------------------
-- 4.3 Equipment type standing guard (invariant I7, converse)
--
-- A standing may not be moved off 'canonical' by hand. Every non-canonical
-- standing must be justified by an approved resolution, so the two structures
-- cannot disagree and "why is this retired?" always has a governed answer.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION taxonomy_type_standing_guard()
RETURNS TRIGGER AS $$
DECLARE
    approved_count INTEGER;
BEGIN
    IF NEW.identity_state IS NOT DISTINCT FROM OLD.identity_state THEN
        RETURN NEW;
    END IF;

    -- Only the two governed non-canonical standings are guarded here. Any other
    -- value is not a lifecycle standing at all and is left to the
    -- chk_equipment_types_identity_state CHECK, so an invalid value reports the
    -- constraint that actually forbids it instead of this trigger's message.
    IF NEW.identity_state NOT IN ('superseded', 'retired') THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO approved_count
    FROM equipment_type_identity_resolution r
    WHERE r.from_type_id = NEW.id
      AND r.review_state = 'approved'
      AND r.superseded_by_resolution_id IS NULL;

    IF approved_count = 0 THEN
        RAISE EXCEPTION 'equipment type % cannot be set to % without an approved identity resolution',
            NEW.id, NEW.identity_state
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_types_standing_guard ON equipment_types;

CREATE TRIGGER trg_equipment_types_standing_guard
    BEFORE UPDATE ON equipment_types
    FOR EACH ROW
    EXECUTE FUNCTION taxonomy_type_standing_guard();

-- ------------------------------------------------------------
-- 4.4 Resolution immutability once approved (migration 017's rule)
--
-- A governed conclusion may not be silently rewritten. Implemented as a
-- whole-row comparison so a column added later cannot be left silently mutable.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION taxonomy_identity_resolution_immutability_check()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.review_state = 'approved' THEN
        IF (to_jsonb(NEW) - 'superseded_by_resolution_id' - 'updated_at')
           IS DISTINCT FROM
           (to_jsonb(OLD) - 'superseded_by_resolution_id' - 'updated_at') THEN
            RAISE EXCEPTION 'approved identity resolution % is immutable except its supersession pointer', OLD.id
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_type_identity_resolution_immutable
    ON equipment_type_identity_resolution;

CREATE TRIGGER trg_equipment_type_identity_resolution_immutable
    BEFORE UPDATE ON equipment_type_identity_resolution
    FOR EACH ROW
    EXECUTE FUNCTION taxonomy_identity_resolution_immutability_check();

-- ------------------------------------------------------------
-- 4.5 Resolution delete guard (invariant I10)
--
-- Hard delete only while a row is still a draft proposal. Once submitted,
-- reviewed, approved or rejected the row is governed knowledge and is retained:
-- "this conclusion was considered and refused" must stay visible.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION taxonomy_identity_resolution_delete_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.review_state <> 'draft' THEN
        RAISE EXCEPTION 'identity resolution % is % and cannot be deleted; only draft proposals are deletable',
            OLD.id, OLD.review_state
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_type_identity_resolution_delete_guard
    ON equipment_type_identity_resolution;

CREATE TRIGGER trg_equipment_type_identity_resolution_delete_guard
    BEFORE DELETE ON equipment_type_identity_resolution
    FOR EACH ROW
    EXECUTE FUNCTION taxonomy_identity_resolution_delete_guard();

-- ============================================================
-- 5. Trigger functions — terminology
-- ============================================================

-- ------------------------------------------------------------
-- 5.1 Terminology immutability once approved
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION taxonomy_term_immutability_check()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.review_state = 'approved' THEN
        IF (to_jsonb(NEW) - 'superseded_by_term_id' - 'updated_at')
           IS DISTINCT FROM
           (to_jsonb(OLD) - 'superseded_by_term_id' - 'updated_at') THEN
            RAISE EXCEPTION 'approved terminology row % is immutable except its supersession pointer', OLD.id
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_type_term_immutable ON equipment_type_term;

CREATE TRIGGER trg_equipment_type_term_immutable
    BEFORE UPDATE ON equipment_type_term
    FOR EACH ROW
    EXECUTE FUNCTION taxonomy_term_immutability_check();

-- ------------------------------------------------------------
-- 5.2 Terminology delete guard
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION taxonomy_term_delete_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.review_state <> 'draft' THEN
        RAISE EXCEPTION 'terminology row % is % and cannot be deleted; only draft proposals are deletable',
            OLD.id, OLD.review_state
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_type_term_delete_guard ON equipment_type_term;

CREATE TRIGGER trg_equipment_type_term_delete_guard
    BEFORE DELETE ON equipment_type_term
    FOR EACH ROW
    EXECUTE FUNCTION taxonomy_term_delete_guard();

-- ============================================================
-- 6. Supersession safety and commit-time lifecycle coherence
--    (BLOCKER-1 remediation)
-- ============================================================
--
-- THE DEFECT THIS CLOSES
--
-- A governed conclusion is "active" only while
--     review_state = 'approved' AND superseded_by_resolution_id IS NULL.
-- The only column an approved row may still change is its supersession pointer
-- (whole-row immutability, §4 above). That pointer change therefore DEACTIVATES
-- the row — and nothing reconciled equipment_types.identity_state when it did.
-- Observed consequence: approving A -> B sets A to 'superseded'; setting that
-- resolution's supersession pointer left A 'superseded' with ZERO active
-- approved resolutions. The standing then had no active governed conclusion
-- supporting it, which the ratified lifecycle/resolution coherence forbids.
-- taxonomy_type_standing_guard() did not catch it because that guard runs on
-- updates to equipment_types, not when a resolution's pointer moves.
--
-- THE REPAIR — two mechanisms, both in the database, neither in application code
--
-- (a) §6.1 makes supersession WELL-FORMED: only an approved conclusion may be
--     superseded; the successor must exist, concern the SAME source type, not
--     be the row itself, and not close a supersession cycle; and the pointer,
--     once set, can never be cleared, because clearing it would silently
--     un-supersede governed history.
--
-- (b) §6.2 makes the lifecycle/resolution agreement a COMMIT-TIME property via
--     a DEFERRABLE INITIALLY DEFERRED constraint trigger (the idiom migration
--     009 uses for its seal). At COMMIT it asserts, for the affected type:
--         canonical  -> 0 active approved resolutions
--         superseded -> exactly 1 active approved, and it must carry a target
--         retired    -> exactly 1 active approved, and it must carry no target
--
-- WHY COMMIT TIME IS THE CORRECT BOUNDARY
--
-- A governed REPLACEMENT is inherently two steps — withdraw the predecessor,
-- then approve the successor — and the partial unique index
-- uq_equipment_type_identity_resolution_active correctly forbids two active
-- approved conclusions for one type, so the successor cannot be pre-approved.
-- Between the two steps the type legitimately has zero active conclusions. That
-- transient state is invisible to other transactions and must not be mistaken
-- for the committed one. Deferring the assertion to COMMIT therefore lets a
-- governed rebase commit atomically, while a transaction that ends with an
-- unsupported standing is refused outright.
--
-- The operational consequence, and the reason it is safe: a bare pointer change
-- with no approved replacement is not a rebase and is refused. The governed
-- sequence is, in ONE transaction:
--     UPDATE predecessor SET superseded_by_resolution_id = successor;
--     UPDATE successor SET review_state = 'approved', ... ;
--     COMMIT;
--
-- Nothing here weakens the lifecycle invariant: the states themselves are
-- unchanged (canonical / superseded / retired only), no uncertainty state is
-- introduced, INSUFFICIENT_EVIDENCE still cannot coexist with approval, and
-- approved history stays immutable except for the pointer.

-- ------------------------------------------------------------
-- 6.1 Supersession well-formedness
--
-- Deliberately does NOT require the successor to be APPROVED. It cannot: the
-- partial unique index forbids a second active approved conclusion for the same
-- type, so a replacement can only be approved after its predecessor is
-- withdrawn. Requiring approval here would deadlock every rebase. Whether the
-- committed outcome is governed is therefore decided by §6.2, which is the
-- correct place for it: a pointer to a draft, an under-review row or a rejected
-- row leaves the type with no active approved conclusion and is refused there.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION taxonomy_identity_resolution_supersession_check()
RETURNS TRIGGER AS $$
DECLARE
    successor_from_type INTEGER;
    successor_review_state VARCHAR(20);
    next_id INTEGER;
    visited INTEGER[];
BEGIN
    -- Only a change to the supersession pointer is governed by this trigger.
    IF NEW.superseded_by_resolution_id IS NOT DISTINCT FROM OLD.superseded_by_resolution_id THEN
        RETURN NEW;
    END IF;

    -- Supersession is append-only. Clearing the pointer would resurrect a
    -- withdrawn conclusion without any governed act, and would leave the
    -- successor's own governance meaningless.
    IF OLD.superseded_by_resolution_id IS NOT NULL
       AND NEW.superseded_by_resolution_id IS NULL THEN
        RAISE EXCEPTION 'identity resolution % cannot clear its supersession pointer; supersession is append-only', OLD.id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Only a GOVERNED conclusion confers the meaning "no longer current", so
    -- only an approved row may be superseded.
    IF OLD.review_state <> 'approved' THEN
        RAISE EXCEPTION 'identity resolution % is % and cannot be superseded; only approved conclusions are superseded', OLD.id, OLD.review_state
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.id = NEW.superseded_by_resolution_id THEN
        RAISE EXCEPTION 'identity resolution % cannot supersede itself', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT from_type_id, review_state
    INTO successor_from_type, successor_review_state
    FROM equipment_type_identity_resolution
    WHERE id = NEW.superseded_by_resolution_id;

    -- review_state is NOT NULL, so a NULL here means the successor is absent.
    IF successor_review_state IS NULL THEN
        RAISE EXCEPTION 'superseded_by_resolution_id must reference an existing identity resolution'
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- A conclusion about one type can only be replaced by a conclusion about the
    -- SAME type. A pointer across types would withdraw one type's only
    -- justification while nothing took its place.
    IF successor_from_type IS DISTINCT FROM NEW.from_type_id THEN
        RAISE EXCEPTION 'identity resolution % may only be superseded by a resolution about the same source type; successor % concerns type %',
            NEW.id, NEW.superseded_by_resolution_id, successor_from_type
            USING ERRCODE = 'check_violation';
    END IF;

    -- Cycle detection over the supersession graph, mirroring migration 009.
    next_id := NEW.superseded_by_resolution_id;
    visited := ARRAY[NEW.id];
    LOOP
        IF next_id = ANY(visited) THEN
            RAISE EXCEPTION 'supersession assignment would create a cycle involving identity resolution %', NEW.id
                USING ERRCODE = 'check_violation';
        END IF;
        visited := array_append(visited, next_id);
        SELECT superseded_by_resolution_id INTO next_id
        FROM equipment_type_identity_resolution
        WHERE id = next_id;
        EXIT WHEN next_id IS NULL;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_type_identity_resolution_supersession
    ON equipment_type_identity_resolution;

CREATE TRIGGER trg_equipment_type_identity_resolution_supersession
    BEFORE UPDATE ON equipment_type_identity_resolution
    FOR EACH ROW
    EXECUTE FUNCTION taxonomy_identity_resolution_supersession_check();

-- ------------------------------------------------------------
-- 6.2 Commit-time lifecycle coherence (DEFERRABLE INITIALLY DEFERRED)
--
-- The single statement of the ratified invariant, asserted rather than assumed:
-- a type's lifecycle standing must agree exactly with its active approved
-- conclusion set. Being deferred, it is evaluated at COMMIT against the final
-- visibility of every row the transaction touched, so an atomic rebase is legal
-- and an unsupported standing is impossible.
--
-- The check is per affected type, so a multi-type transaction validates each
-- type it touched and no others.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION taxonomy_identity_resolution_lifecycle_check()
RETURNS TRIGGER AS $$
DECLARE
    subject_type_id INTEGER;
    current_standing VARCHAR(20);
    active_count INTEGER;
    active_with_target INTEGER;
BEGIN
    subject_type_id := COALESCE(NEW.from_type_id, OLD.from_type_id);

    SELECT identity_state INTO current_standing
    FROM equipment_types
    WHERE id = subject_type_id;

    -- The type itself is gone: its deletion is governed by the RESTRICT foreign
    -- keys and the delete guard, not by this coherence rule.
    IF current_standing IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT count(*), count(*) FILTER (WHERE to_type_id IS NOT NULL)
    INTO active_count, active_with_target
    FROM equipment_type_identity_resolution
    WHERE from_type_id = subject_type_id
      AND review_state = 'approved'
      AND superseded_by_resolution_id IS NULL;

    IF current_standing = 'canonical' THEN
        IF active_count <> 0 THEN
            RAISE EXCEPTION 'equipment type % is canonical but carries % active approved identity resolution(s)', subject_type_id, active_count
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF current_standing = 'superseded' THEN
        IF active_count <> 1 OR active_with_target <> 1 THEN
            RAISE EXCEPTION 'equipment type % is superseded but has % active approved identity resolution(s), % of them target-bearing; a superseded type requires exactly one active approved target-bearing resolution', subject_type_id, active_count, active_with_target
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF current_standing = 'retired' THEN
        IF active_count <> 1 OR active_with_target <> 0 THEN
            RAISE EXCEPTION 'equipment type % is retired but has % active approved identity resolution(s), % of them target-bearing; a retired type requires exactly one active approved resolution with no target', subject_type_id, active_count, active_with_target
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- CREATE CONSTRAINT TRIGGER has no IF NOT EXISTS form, so drop first to keep the
-- migration re-runnable.
DROP TRIGGER IF EXISTS trg_equipment_type_identity_resolution_lifecycle
    ON equipment_type_identity_resolution;

CREATE CONSTRAINT TRIGGER trg_equipment_type_identity_resolution_lifecycle
    AFTER INSERT OR UPDATE OR DELETE ON equipment_type_identity_resolution
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION taxonomy_identity_resolution_lifecycle_check();

