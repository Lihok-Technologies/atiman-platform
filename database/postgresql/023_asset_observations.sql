-- ATM-002-I2B — Observation Operational Foundation (migration 023)
--
-- Creates the capture-before-obligation primitive required by the ratified
-- ATM-002 experience architecture:
--
--   docs/architecture/ATM-002-R5-Finding-Experience-Architecture.md §2
--
-- An Observation is "what the operator recorded in the moment: a condition,
-- reading, photograph, note". It creates NO obligation by itself. A Finding is a
-- governed operational assertion that requires assessment and carries an
-- outcome. R5 §2 is explicit that conflating the two either over-governs routine
-- evidence or under-governs real findings, so they are separate objects and the
-- transition between them is an explicit, accountable act.
--
-- WHY A NEW TABLE (ATM-002-I2A findings, treated as implementation inputs)
--   * `inspection_readings` cannot serve: `work_order_id` is NOT NULL, so a
--     reading is structurally a work-order child — technician/maintenance
--     execution coupling that is EAM-owned (ATM-002-R2 §4).
--   * `inspection_results` cannot serve: `task_template_id` and
--     `task_template_step_id` are both NOT NULL, so a procedure-less observation
--     is unrepresentable.
--   * `findings` must not double as Observation: an Observation carries no
--     obligation and a Finding does.
--   * No observations object exists anywhere in the schema or in the legacy
--     MySQL artifacts.
--
-- STRUCTURE ONLY. This migration:
--   * creates no rows and performs no backfill of any kind;
--   * modifies no existing table, column, constraint, index or trigger;
--   * adds no severity, risk, priority, Finding status, Finding outcome, SAP
--     notification, work-order, maintenance-plan, schedule, assignment,
--     technician, due-date, cost, inventory, procurement, AI, health or
--     reliability column;
--   * adds no photo, attachment or media column, and no offline/sync or
--     integration-state column;
--   * is not referenced by any route, controller, capability or permission.
--     A later bounded milestone applies authorization at the calling surface.
--
-- Idempotency: scripts/migrate-postgres.js reapplies every migration on every run
-- and keeps no applied-migrations ledger, so this file must be safe to execute
-- repeatedly.

-- ===========================================================================
-- PART 1 — captured field observations
-- ===========================================================================
-- Column types follow the repository's existing measurement conventions:
-- NUMERIC(12,4) and VARCHAR(50) for unit match inspection_results, so a value
-- captured here has the same shape and precision as an existing recorded value.

CREATE TABLE IF NOT EXISTS asset_observations (
    id                     BIGSERIAL PRIMARY KEY,
    organization_id        INTEGER NOT NULL,
    facility_id            INTEGER NOT NULL,
    asset_id               INTEGER NOT NULL,
    recorded_by_user_id    INTEGER NOT NULL,
    observed_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observation_text       TEXT,
    measured_value         NUMERIC(12,4),
    unit                   VARCHAR(50),
    task_template_id       INTEGER,
    task_template_step_id  INTEGER,
    frozen_at              TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- An Observation is evidence. Nothing it references may be removed while the
-- evidence exists, so every reference is RESTRICT rather than CASCADE:
--   * organization / facility / asset — deleting any of them would silently
--     destroy recorded field evidence, which contradicts "Evidence Before
--     Assumption";
--   * recorded_by_user_id — attribution is part of the evidence, and RESTRICT
--     here matches migration 022's treatment of `granted_by_user_id`.
-- This is a deliberate divergence from 022's CASCADE on `organization_id`: a
-- capability grant is authority state, an observation is evidence.
--
-- Drop-then-add: ADD CONSTRAINT is not idempotent (migration 002's idiom).

ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS fk_asset_observations_organization;
ALTER TABLE asset_observations ADD CONSTRAINT fk_asset_observations_organization
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS fk_asset_observations_facility;
ALTER TABLE asset_observations ADD CONSTRAINT fk_asset_observations_facility
    FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE RESTRICT;

ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS fk_asset_observations_asset;
ALTER TABLE asset_observations ADD CONSTRAINT fk_asset_observations_asset
    FOREIGN KEY (asset_id) REFERENCES equipment(id) ON DELETE RESTRICT;

ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS fk_asset_observations_recorder;
ALTER TABLE asset_observations ADD CONSTRAINT fk_asset_observations_recorder
    FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS fk_asset_observations_task_template;
ALTER TABLE asset_observations ADD CONSTRAINT fk_asset_observations_task_template
    FOREIGN KEY (task_template_id) REFERENCES task_templates(id) ON DELETE RESTRICT;

ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS fk_asset_observations_task_template_step;
ALTER TABLE asset_observations ADD CONSTRAINT fk_asset_observations_task_template_step
    FOREIGN KEY (task_template_step_id) REFERENCES task_template_steps(id) ON DELETE RESTRICT;

-- ===========================================================================
-- PART 2 — an Observation must contain captured content
-- ===========================================================================
-- A completely empty Observation is not a record of anything, and a unit with no
-- value is not content either. Whitespace-only text (spaces, tabs, newlines,
-- carriage returns, form feeds, vertical tabs) does not count.
--
-- BOUND, stated rather than implied: PostgreSQL's whitespace classes do not
-- include U+00A0 (no-break space), so text consisting only of no-break spaces
-- satisfies this constraint. The service additionally refuses it, because
-- JavaScript trimming does treat U+00A0 as whitespace; this check is the
-- portable backstop for the ordinary cases, not a Unicode normaliser. Handling
-- Unicode whitespace here would require encoding-sensitive expressions that
-- fail on non-UTF8 databases, which is a worse trade for a path no product
-- writer takes.
--
-- Drop-then-add: ADD CONSTRAINT is not idempotent (migration 002's idiom).

ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS chk_asset_observations_content;
ALTER TABLE asset_observations ADD CONSTRAINT chk_asset_observations_content
    CHECK (
        (observation_text IS NOT NULL AND btrim(observation_text, E' \t\n\r\f\v') <> '')
        OR measured_value IS NOT NULL
    );

-- A unit describes a measured value. Supplying a unit without one is refused
-- rather than silently normalized away: discarding operator input would
-- misrepresent what was recorded, and ATM-002-R7 §8.1 requires that no input is
-- ever lost. A blank or whitespace-only unit is equally meaningless.
ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS chk_asset_observations_unit_requires_value;
ALTER TABLE asset_observations ADD CONSTRAINT chk_asset_observations_unit_requires_value
    CHECK (
        unit IS NULL
        OR (measured_value IS NOT NULL AND btrim(unit, E' \t\n\r\f\v') <> '')
    );

-- A step reference without its template is incoherent: the template is what
-- carries the governed scope, and the step cannot be resolved without it.
ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS chk_asset_observations_step_requires_template;
ALTER TABLE asset_observations ADD CONSTRAINT chk_asset_observations_step_requires_template
    CHECK (task_template_step_id IS NULL OR task_template_id IS NOT NULL);

-- The freeze marker is coherent or absent (migration 022's revocation idiom): it
-- cannot predate the record it freezes.
ALTER TABLE asset_observations DROP CONSTRAINT IF EXISTS chk_asset_observations_frozen_after_creation;
ALTER TABLE asset_observations ADD CONSTRAINT chk_asset_observations_frozen_after_creation
    CHECK (frozen_at IS NULL OR frozen_at >= created_at);

-- ===========================================================================
-- PART 3 — indexes
-- ===========================================================================
-- Four indexes, each answering a question the product actually asks: the
-- tenant's observations in time order, one asset's observation history, one
-- principal's own capture, and the set of observations still open to amendment.

CREATE INDEX IF NOT EXISTS idx_asset_observations_org_observed
    ON asset_observations (organization_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_asset_observations_asset_observed
    ON asset_observations (asset_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_asset_observations_recorder
    ON asset_observations (recorded_by_user_id);

CREATE INDEX IF NOT EXISTS idx_asset_observations_open
    ON asset_observations (organization_id)
    WHERE frozen_at IS NULL;

-- ===========================================================================
-- PART 4 — tenancy and reference integrity are structural
-- ===========================================================================
-- `equipment.organization_id`, `facilities.organization_id` and
-- `users.organization_id` are all nullable in this schema, so a composite
-- foreign key cannot express tenant agreement, and altering those tables is out
-- of scope for this milestone. The guard below makes an incoherent Observation
-- unrepresentable instead:
--
--   * the asset must exist, must have an organization, and that organization
--     must be the Observation's organization;
--   * the asset must have a facility, and it must be the Observation's facility;
--   * the facility must belong to the Observation's organization;
--   * the recorder must exist and belong to the Observation's organization;
--   * an optional template must be legitimate for ATM-001's global/tenant scope
--     rule (global when `organization_id IS NULL`, otherwise the tenant's own);
--   * an optional step must actually belong to that template.
--
-- `organization_id` is never taken from a client body: the service resolves it
-- from the trusted call context, and this trigger refuses any row that disagrees
-- with the referenced rows regardless of who supplied it.
--
-- Runs on UPDATE as well as INSERT because the substance fields — including the
-- optional procedure references — are amendable while the capture is open.

CREATE OR REPLACE FUNCTION asset_observation_context_check()
RETURNS TRIGGER AS $$
DECLARE
    asset_org       INTEGER;
    asset_facility  INTEGER;
    facility_org    INTEGER;
    recorder_org    INTEGER;
    template_org    INTEGER;
    step_template   INTEGER;
BEGIN
    SELECT organization_id, facility_id INTO asset_org, asset_facility
      FROM equipment WHERE id = NEW.asset_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'observation % refused: asset % does not exist', NEW.id, NEW.asset_id;
    END IF;
    IF asset_org IS NULL THEN
        RAISE EXCEPTION 'observation % refused: asset % belongs to no organization', NEW.id, NEW.asset_id;
    END IF;
    IF asset_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'observation % refused: organization % is not the organization of asset % (%)',
            NEW.id, NEW.organization_id, NEW.asset_id, asset_org;
    END IF;
    IF asset_facility IS NULL THEN
        RAISE EXCEPTION 'observation % refused: asset % is assigned to no facility', NEW.id, NEW.asset_id;
    END IF;
    IF asset_facility <> NEW.facility_id THEN
        RAISE EXCEPTION 'observation % refused: facility % is not the facility of asset % (%)',
            NEW.id, NEW.facility_id, NEW.asset_id, asset_facility;
    END IF;

    SELECT organization_id INTO facility_org FROM facilities WHERE id = NEW.facility_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'observation % refused: facility % does not exist', NEW.id, NEW.facility_id;
    END IF;
    IF facility_org IS NULL THEN
        RAISE EXCEPTION 'observation % refused: facility % belongs to no organization', NEW.id, NEW.facility_id;
    END IF;
    IF facility_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'observation % refused: organization % is not the organization of facility % (%)',
            NEW.id, NEW.organization_id, NEW.facility_id, facility_org;
    END IF;

    SELECT organization_id INTO recorder_org FROM users WHERE id = NEW.recorded_by_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'observation % refused: recorder % does not exist', NEW.id, NEW.recorded_by_user_id;
    END IF;
    IF recorder_org IS NULL THEN
        RAISE EXCEPTION 'observation % refused: recorder % belongs to no organization', NEW.id, NEW.recorded_by_user_id;
    END IF;
    IF recorder_org <> NEW.organization_id THEN
        RAISE EXCEPTION 'observation % refused: recorder % does not belong to organization %',
            NEW.id, NEW.recorded_by_user_id, NEW.organization_id;
    END IF;

    -- Optional governed procedure context. ATM-001 owns knowledge scope and
    -- publication: this guard applies only the global-vs-tenant rule and invents
    -- no version, pack or publication semantics.
    IF NEW.task_template_id IS NOT NULL THEN
        SELECT organization_id INTO template_org FROM task_templates WHERE id = NEW.task_template_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'observation % refused: task template % does not exist',
                NEW.id, NEW.task_template_id;
        END IF;
        IF template_org IS NOT NULL AND template_org <> NEW.organization_id THEN
            RAISE EXCEPTION 'observation % refused: task template % is not available to organization %',
                NEW.id, NEW.task_template_id, NEW.organization_id;
        END IF;
    END IF;

    IF NEW.task_template_step_id IS NOT NULL THEN
        SELECT task_template_id INTO step_template
          FROM task_template_steps WHERE id = NEW.task_template_step_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'observation % refused: task template step % does not exist',
                NEW.id, NEW.task_template_step_id;
        END IF;
        IF step_template <> NEW.task_template_id THEN
            RAISE EXCEPTION 'observation % refused: task template step % does not belong to task template %',
                NEW.id, NEW.task_template_step_id, NEW.task_template_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asset_observations_context ON asset_observations;
CREATE TRIGGER trg_asset_observations_context
    BEFORE INSERT OR UPDATE ON asset_observations
    FOR EACH ROW EXECUTE FUNCTION asset_observation_context_check();

-- ===========================================================================
-- PART 5 — amendability boundary
-- ===========================================================================
-- R5 §2 distinguishes the two objects partly by lifecycle. An Observation is
-- "freely amendable while the work is in progress"; a Finding is "immutable in
-- its reported substance". The mechanism below is the smallest one that makes
-- that boundary real without implementing promotion:
--
--   * identity and ownership are never mutable — id, organization, facility,
--     asset, recorder and creation time are fixed for the life of the row;
--   * while the row is open (`frozen_at IS NULL`) the captured substance is
--     amendable: observed_at, observation_text, measured_value, unit and the
--     optional procedure references;
--   * `frozen_at` is a one-way marker: NULL -> NOT NULL, never backwards. It
--     carries no outcome, no severity and no Finding reference;
--   * once frozen the row is fully immutable;
--   * discard is controlled rather than arbitrary: an open capture may be
--     removed (a mistaken capture cannot be corrected by amendment, because the
--     asset it was recorded against is immutable), and a frozen capture never
--     can be.
--
-- Promotion itself is deliberately NOT implemented here; a later milestone sets
-- `frozen_at` as part of the promotion act. No service operation in this
-- milestone sets it.

CREATE OR REPLACE FUNCTION asset_observation_lifecycle_check()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.frozen_at IS NOT NULL THEN
            RAISE EXCEPTION 'observation % was frozen at % and is never deleted; recorded evidence is preserved', OLD.id, OLD.frozen_at;
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.frozen_at IS NOT NULL THEN
        RAISE EXCEPTION 'observation % was frozen at % and is immutable', OLD.id, OLD.frozen_at;
    END IF;

    IF NEW.id <> OLD.id
       OR NEW.organization_id <> OLD.organization_id
       OR NEW.facility_id <> OLD.facility_id
       OR NEW.asset_id <> OLD.asset_id
       OR NEW.recorded_by_user_id <> OLD.recorded_by_user_id
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'observation % identity, tenant, asset and recorder are immutable', OLD.id;
    END IF;

    -- Still open: the captured substance may be amended, and `frozen_at` may be
    -- set once. The reverse transition is already unreachable, because a frozen
    -- row never reaches this point.
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asset_observations_lifecycle ON asset_observations;
CREATE TRIGGER trg_asset_observations_lifecycle
    BEFORE UPDATE OR DELETE ON asset_observations
    FOR EACH ROW EXECUTE FUNCTION asset_observation_lifecycle_check();

-- ===========================================================================
-- PART 6 — no backfill
-- ===========================================================================
-- There is intentionally no INSERT and no UPDATE in this migration. No
-- observation exists, no production fixture is created, and no observation is
-- derived from any legacy inspection, reading, result or finding row.
