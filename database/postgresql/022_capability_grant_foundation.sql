-- ATM-003 — Capability Grant Foundation (migration 022)
--
-- Implements the storage half of the capability model ratified by
--   docs/architecture/ATM-003-R1-Role-Capability-Architecture.md
-- under the ATM-003 Phase 1 discovery record and the OWNER adjudication of
-- 2026-09-27.
--
-- STRUCTURE ONLY. This migration:
--   * creates no grant rows (no authority backfill of any kind);
--   * migrates no roles and does not alter `users`;
--   * creates no platform-scoped identity, organization or grant;
--   * creates no OWNER/governance authority;
--   * changes no existing authorization behaviour. Nothing reads this table
--     until the capability resolver milestone lands.
--
-- GRANTABLE V1 SUBSET. The architecture recognises 21 capabilities. Three are
-- deliberately NOT human-grantable in V1 and are refused by constraint here, so
-- they cannot be created indirectly by any later writer:
--   * `platform.admin`            — no platform-scoped principal is authorised;
--                                   future ATM-003 Platform Operations Authority.
--   * `knowledge.taxonomy_admin`  — ATM-001 explicitly created no OWNER
--                                   governance authorization.
--   * `integration.service`       — machine authority stays on the existing
--                                   API-key path and is never a human grant.
--
-- TENANT SCOPING. A grant is scoped to an organization and constrained by
-- trigger to the granting user's own organization, so a cross-tenant grant is
-- unrepresentable rather than merely discouraged.
--
-- ATTESTATION. A grant is a record of an accountable act: it carries who granted
-- it and when, is revoked rather than deleted, and cannot be un-revoked or have
-- its substance edited. Revocation is not deletion.
--
-- Idempotency: scripts/migrate-postgres.js reapplies every migration on every run
-- and keeps no applied-migrations ledger, so this file must be safe to execute
-- repeatedly.

-- ===========================================================================
-- PART 1 — explicit human capability grants
-- ===========================================================================

CREATE TABLE IF NOT EXISTS user_capabilities (
    id                   BIGSERIAL PRIMARY KEY,
    user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    capability           VARCHAR(64) NOT NULL,
    source               VARCHAR(32) NOT NULL DEFAULT 'explicit',
    granted_by_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    granted_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at           TIMESTAMPTZ,
    revoked_by_user_id   INTEGER REFERENCES users(id) ON DELETE RESTRICT
);

-- Drop-then-add: ADD CONSTRAINT is not idempotent (migration 002's idiom).
ALTER TABLE user_capabilities DROP CONSTRAINT IF EXISTS chk_user_capabilities_grantable;
ALTER TABLE user_capabilities ADD CONSTRAINT chk_user_capabilities_grantable
    CHECK (capability IN (
        -- knowledge governance (human-grantable subset)
        'knowledge.author', 'knowledge.submit', 'knowledge.review', 'knowledge.approve',
        'knowledge.publish', 'knowledge.safety_review', 'knowledge.legacy_clearance',
        'evidence.attach',
        -- inspection and findings
        'inspection.execute', 'inspection.assign',
        'finding.report', 'finding.assess', 'finding.monitor', 'finding.close',
        'escalation.prepare', 'escalation.approve',
        -- organization administration
        'org.user_admin', 'org.config_admin'
    ));

ALTER TABLE user_capabilities DROP CONSTRAINT IF EXISTS chk_user_capabilities_source;
ALTER TABLE user_capabilities ADD CONSTRAINT chk_user_capabilities_source
    CHECK (source IN ('explicit', 'profile_template'));

-- Revocation is coherent or absent; a half-revocation is unrepresentable.
ALTER TABLE user_capabilities DROP CONSTRAINT IF EXISTS chk_user_capabilities_revocation_coherent;
ALTER TABLE user_capabilities ADD CONSTRAINT chk_user_capabilities_revocation_coherent
    CHECK (
        (revoked_at IS NULL AND revoked_by_user_id IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
    );

ALTER TABLE user_capabilities DROP CONSTRAINT IF EXISTS chk_user_capabilities_revocation_after_grant;
ALTER TABLE user_capabilities ADD CONSTRAINT chk_user_capabilities_revocation_after_grant
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at);

-- ===========================================================================
-- PART 2 — one ACTIVE grant per user / organization / capability
-- ===========================================================================
-- A revoked grant is history and may coexist with a later active grant.

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_capabilities_active
    ON user_capabilities (user_id, organization_id, capability)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_capabilities_active_user
    ON user_capabilities (user_id, organization_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_capabilities_active_org
    ON user_capabilities (organization_id, capability)
    WHERE revoked_at IS NULL;

-- ===========================================================================
-- PART 3 — tenant scoping is structural
-- ===========================================================================
-- A grant must be scoped to the granted user's own organization, and may only be
-- issued by an accountable user of that same organization. Cross-tenant grants
-- are therefore unrepresentable.

CREATE OR REPLACE FUNCTION capability_grant_tenant_check()
RETURNS TRIGGER AS $$
DECLARE
    user_org    INTEGER;
    granter_org INTEGER;
BEGIN
    SELECT organization_id INTO user_org FROM users WHERE id = NEW.user_id;
    IF user_org IS NULL THEN
        RAISE EXCEPTION 'capability grant % refused: user % belongs to no organization', NEW.id, NEW.user_id;
    END IF;
    IF user_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'capability grant % refused: organization % is not the organization of user % (%)',
            NEW.id, NEW.organization_id, NEW.user_id, user_org;
    END IF;

    SELECT organization_id INTO granter_org FROM users WHERE id = NEW.granted_by_user_id;
    IF granter_org IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION 'capability grant % refused: granting user % does not belong to organization %',
            NEW.id, NEW.granted_by_user_id, NEW.organization_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_capabilities_tenant ON user_capabilities;
CREATE TRIGGER trg_user_capabilities_tenant
    BEFORE INSERT ON user_capabilities
    FOR EACH ROW EXECUTE FUNCTION capability_grant_tenant_check();

-- ===========================================================================
-- PART 4 — a grant is a record, not a mutable row
-- ===========================================================================
-- Only revocation may change a grant; it can never be un-revoked or deleted, so
-- the attribution of authority is preserved for audit.

CREATE OR REPLACE FUNCTION capability_grant_immutable_check()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'capability grant % is a record of an accountable act and is never deleted; revoke it instead', OLD.id;
    END IF;

    IF NEW.user_id <> OLD.user_id
       OR NEW.organization_id <> OLD.organization_id
       OR NEW.capability <> OLD.capability
       OR NEW.source <> OLD.source
       OR NEW.granted_by_user_id <> OLD.granted_by_user_id
       OR NEW.granted_at <> OLD.granted_at THEN
        RAISE EXCEPTION 'capability grant % is immutable; only revocation fields may change', OLD.id;
    END IF;

    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
        RAISE EXCEPTION 'capability grant % is already revoked and cannot be un-revoked; issue a new grant instead', OLD.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_capabilities_immutable ON user_capabilities;
CREATE TRIGGER trg_user_capabilities_immutable
    BEFORE UPDATE OR DELETE ON user_capabilities
    FOR EACH ROW EXECUTE FUNCTION capability_grant_immutable_check();

-- ===========================================================================
-- PART 5 — no backfill
-- ===========================================================================
-- There is intentionally no INSERT and no UPDATE in this migration. Every
-- existing user continues to resolve through legacy-role compatibility until an
-- accountable administrator issues an explicit grant, at which point that user
-- resolves through explicit grants alone.
