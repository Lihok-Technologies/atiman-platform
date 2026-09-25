-- =====================================================
-- ATM-001 M5R.3D — Crosswalk Evidence Foundation
--
-- WHY THIS MIGRATION EXISTS
--
-- The approved standards-crosswalk architecture (see
-- docs/architecture/ATM-001-M5R3-Standards-Crosswalk-Architecture-Decision.md,
-- Option C, APPROVED) requires governed knowledge to be traceable to evidence
-- (MUST 7), while keeping two DIFFERENT propositions distinguishable (MUST 8).
-- Migration 016 built the external concept. Migration 017 built the governed
-- relationship. This migration builds the EVIDENCE that substantiates them.
--
-- TWO PROPOSITIONS THAT MUST NEVER COLLAPSE (M5R.3 section P)
--
--   external_classification_id -> "This external concept exists and denotes X."
--   crosswalk_id               -> "Atiman's relationship to it is defensible."
--
-- Exactly-one-subject is enforced by CHECK: a row substantiates EITHER the
-- external concept OR the Atiman relationship — never both, never neither. So
-- concept evidence can never silently become relationship evidence, and
-- relationship evidence can never silently redefine an external concept.
--
-- PROVENANCE IS REUSED, NOT DUPLICATED (M5R.3 sections I, P)
--
-- Every evidence row MUST name the exact knowledge_source_version it draws on.
-- No authority, publisher, edition, standard name or reference number is copied
-- onto this relation; all of that already resolves through
-- knowledge_source_versions -> knowledge_sources. No second registry is created.
--
-- SOURCE-VERSION COHERENCE — DELIBERATELY NOT ENFORCED AS EQUALITY
--
-- Evidence's knowledge_source_version_id is deliberately NOT constrained to
-- equal the subject's own edition. The ADR requires edition equality exactly
-- where it says so — for the crosswalk and the classification it references
-- (section W.3.3, enforced by migration 017) — and says nothing of the kind for
-- evidence. Evidence exists to corroborate a proposition, and a corroborating
-- source is legitimately a different governed edition (a manufacturer manual
-- supporting a standard's concept, a second standard supporting a relationship).
-- Inventing equality here would silently narrow the approved architecture.
-- What IS enforced is that the cited edition is globally admissible (below).
--
-- THE "APPROVED REQUIRES EVIDENCE" INVARIANT IS NOT A DATABASE RULE
--
-- The ADR states (section O) that an approved NO_DIRECT_MAPPING must carry
-- relationship evidence, and section AG records the resolution explicitly:
--
--   "Corrected: attribution CHECK; plus a policy requirement that approval is
--    evidence-backed (sections O, P). Note: enforcing '>=1 evidence row' is
--    cross-table and remains a service/domain rule — consistent with migration
--    013's documented boundary."
--
-- So the requirement is REAL but its enforcement is deliberately NOT placed in
-- the database. Adding a trigger that blocked approval until evidence existed
-- would invent consequential workflow semantics the ADR never authorised, and
-- would contradict the ADR's own stated boundary. This migration therefore does
-- NOT enforce it; the boundary is recorded here so the next slice cannot
-- mistake its absence for an oversight. Enforcement belongs to M5R.3E, which
-- also owns the approved "attach / detach evidence" capability (section AC).
--
-- GLOBAL-SOURCE ENFORCEMENT (M5R.3 section R.1) — MANDATORY
--
-- Section R.1 states the mitigation explicitly: "a future trigger must reject
-- any crosswalk OR EVIDENCE row whose referenced
-- knowledge_source_versions.knowledge_source.organization_id IS NOT NULL."
-- Every evidence row must therefore resolve to a GLOBAL source. Tenant/customer
-- evidence cannot enter global Atiman knowledge; customer classification systems
-- belong to a separate tenant-scoped alias layer that is NOT built here
-- (section S).
--
-- DELETION / HISTORY BEHAVIOR (M5R.3 section W, mirroring migration 011)
--
--   source version  -> ON DELETE RESTRICT : an edition that evidence depends on
--                     cannot be deleted. (Section AG: "Evidence deleted |
--                     ON DELETE RESTRICT on source versions".)
--   subjects        -> ON DELETE CASCADE  : evidence dies with the subject it
--                     substantiates, exactly as migration 011's working
--                     template evidence dies with its template.
--
-- Governed evidence cannot disappear through the subject cascade in practice,
-- and that is architecture, not luck: migration 017 permits deleting only DRAFT
-- crosswalks, so an approved or superseded crosswalk is undeletable and its
-- evidence is permanent. Supersession does not delete anything — evidence stays
-- attached to the predecessor and does NOT migrate to the successor (section Q,
-- acceptance case 23). Evidence attached to a superseded crosswalk therefore
-- remains auditable history.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
--   - No AI behaviour of any kind: no model call, embeddings, vector search,
--     summarisation, scoring or automatic approval.
--   - No extracted full text, OCR content, document chunks or arbitrary
--     metadata JSON. Evidence records LOCATORS and engineering notes only.
--   - No review/publication lifecycle of its own. Evidence is inspectable
--     engineering provenance; governance lives on the crosswalk.
--   - No service, model, controller, route or UI (M5R.3E).
--   - No standards content and no populated rows: STRUCTURE ONLY.
--   - No use of the legacy iso_* reference columns. No taxonomy change.
--
-- NAMING NOTE
--
-- This table's name is 47 characters, so several object names would exceed
-- PostgreSQL's 63-byte identifier limit — and PostgreSQL TRUNCATES silently
-- rather than failing (observed and corrected during M5R.3C). Every identifier
-- below is therefore audited to fit with margin; `_src_version` and
-- `_ext_class` are deliberate short forms of `source_version` and
-- `external_classification`.
--
-- Idempotent deployment: CREATE IF NOT EXISTS / DROP IF NOT EXISTS throughout.
-- =====================================================

-- ============================================================
-- equipment_type_external_classification_evidence
-- ============================================================
CREATE TABLE IF NOT EXISTS equipment_type_external_classification_evidence (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    -- The exact governed source edition this evidence draws on. A source NAME
    -- is never sufficient: only a resolvable edition is auditable.
    knowledge_source_version_id INTEGER NOT NULL,
    -- Subject A: the external concept. NULL when this row substantiates a
    -- relationship instead.
    external_classification_id INTEGER DEFAULT NULL,
    -- Subject B: the Atiman relationship/conclusion. NULL when this row
    -- substantiates an external concept instead. This is also how an approved
    -- NO_DIRECT_MAPPING conclusion is evidenced: it is positive engineering
    -- knowledge, and no fake classification is fabricated to hold its evidence.
    crosswalk_id INTEGER DEFAULT NULL,
    -- Locators, not content. These identify WHERE the support came from; they
    -- are not authorisation to reproduce standards text.
    section_or_clause VARCHAR(255) DEFAULT NULL,
    page_or_paragraph VARCHAR(255) DEFAULT NULL,
    derivation_notes TEXT DEFAULT NULL,
    -- Existing repository vocabulary (migrations 011/013/015). No new
    -- evidence-strength language is invented.
    confidence_level VARCHAR(50) NOT NULL DEFAULT 'provisional'
        CONSTRAINT chk_equipment_type_external_classification_evidence_confidence
        CHECK (confidence_level IN ('established', 'provisional', 'experimental', 'uncertain')),
    supporting_role VARCHAR(50) NOT NULL DEFAULT 'supporting'
        CONSTRAINT chk_equipment_type_external_classification_evidence_role
        CHECK (supporting_role IN ('primary', 'supporting')),
    added_by_user_id INTEGER DEFAULT NULL,
    added_at TIMESTAMPTZ NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),

    -- EXACTLY ONE SUBJECT. Both NULL is unrepresentable (evidence that
    -- substantiates nothing is not evidence), and both non-NULL is
    -- unrepresentable (that is precisely the conflation section P forbids).
    CONSTRAINT chk_equipment_type_external_classification_evidence_subject
        CHECK (
            (external_classification_id IS NOT NULL AND crosswalk_id IS NULL)
            OR
            (external_classification_id IS NULL AND crosswalk_id IS NOT NULL)
        ),

    -- An edition that evidence depends on is not deletable (section AG).
    CONSTRAINT fk_equipment_type_external_classification_evidence_src_version
        FOREIGN KEY (knowledge_source_version_id) REFERENCES knowledge_source_versions(id) ON DELETE RESTRICT,
    -- Evidence dies with the subject it substantiates, mirroring migration 011's
    -- working template evidence. Governed subjects are undeletable anyway.
    CONSTRAINT fk_equipment_type_external_classification_evidence_ext_class
        FOREIGN KEY (external_classification_id) REFERENCES external_classification(id) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_type_external_classification_evidence_crosswalk
        FOREIGN KEY (crosswalk_id) REFERENCES equipment_type_external_classification(id) ON DELETE CASCADE
);

-- ============================================================
-- Indexes for the approved read paths (M5R.3 section W.2), which also serve
-- the foreign-key delete checks PostgreSQL would otherwise scan for.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_equipment_type_external_classification_evidence_crosswalk
    ON equipment_type_external_classification_evidence (crosswalk_id);

CREATE INDEX IF NOT EXISTS idx_equipment_type_external_classification_evidence_ext_class
    ON equipment_type_external_classification_evidence (external_classification_id);

-- ============================================================
-- Global-source enforcement (M5R.3 section R.1) — MANDATORY
--
-- Evidence must never carry customer terminology into global Atiman knowledge.
-- Resolving knowledge_source_version -> knowledge_source is the only accepted
-- proof of global scope, mirroring the provenance_tenant_scope_check idiom in
-- migration 011 and the equivalent guard M5R.3C placed on the crosswalk itself.
-- ============================================================
CREATE OR REPLACE FUNCTION crosswalk_evidence_global_scope_check()
RETURNS TRIGGER AS $$
DECLARE
    source_org_id INTEGER;
BEGIN
    SELECT s.organization_id INTO source_org_id
    FROM knowledge_source_versions v
    JOIN knowledge_sources s ON s.id = v.knowledge_source_id
    WHERE v.id = NEW.knowledge_source_version_id;

    -- A missing version is left to the foreign key, which reports it precisely.
    IF source_org_id IS NOT NULL THEN
        RAISE EXCEPTION 'crosswalk evidence % may not cite tenant-scoped knowledge_source (organization_id %); global crosswalk knowledge must not be contaminated by customer terminology', NEW.id, source_org_id
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_type_external_classification_evidence_scope
    ON equipment_type_external_classification_evidence;

CREATE TRIGGER trg_equipment_type_external_classification_evidence_scope
    BEFORE INSERT OR UPDATE ON equipment_type_external_classification_evidence
    FOR EACH ROW
    EXECUTE FUNCTION crosswalk_evidence_global_scope_check();
