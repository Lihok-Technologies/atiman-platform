/**
 * ATM-002-I2B — Observation operational foundation.
 *
 * An Observation is the capture-before-obligation primitive of the ratified
 * ATM-002 experience architecture (ATM-002-R5 §2):
 *
 *   "What the operator recorded in the moment: a condition, reading,
 *    photograph, note."
 *
 * It creates NO obligation by itself. It carries no severity, no risk class, no
 * Finding status, no Finding outcome, no SAP/EAM state, no work order, no
 * schedule and no assignment — those are either a later governed act (promotion),
 * an assessment decision (not implemented) or outside the Atiman product
 * boundary entirely.
 *
 * WHAT THIS SERVICE IS
 *   * the only writer of `asset_observations`;
 *   * tenant-authoritative: the organization and the recorder come from the
 *     trusted call context, never from the caller's data, and every referenced
 *     row is proven to belong to that tenant before anything is written;
 *   * fail-closed: an unresolvable or incoherent reference is refused, never
 *     repaired by guessing.
 *
 * WHAT THIS SERVICE IS NOT
 *   * it exposes NO HTTP surface, and no route is authorized in this milestone;
 *   * it performs NO authorization: a capability requirement belongs to the
 *     calling surface (ATM-003), not to the domain primitive;
 *   * it does NOT promote an Observation to a Finding, does not freeze an
 *     Observation, and does not implement assessment or any outcome;
 *   * it does NOT create, read or write `findings`, `inspection_readings`,
 *     `inspection_results` or `inspection_points`, and it changes no legacy
 *     behaviour;
 *   * it stores no media and no evidence file: photographic evidence is
 *     separately gated on a durable-storage decision.
 *
 * MEASUREMENT CONTRACT
 * `measuredValue` is returned as the database's exact decimal STRING — never a
 * JavaScript float. NUMERIC(12,4) is a measurement record, and rounding it
 * through a double would compromise evidentiary value. This matches how the
 * existing `inspection_results.recorded_value_number` surfacing already behaves.
 *
 * The accepted INPUT form is a JavaScript number or a plain decimal string with
 * at most 8 integer digits and at most 4 fractional digits. Lexical variants a
 * form field might produce (`.5`, `1.`, `1e3`) are REFUSED rather than guessed
 * at, because the primitive cannot know whether `1e3` was meant as 1000 or as a
 * mistyped unit; formatting user input for a decimal column is the calling
 * surface's responsibility. A double-artifact such as `0.30000000000000004` is
 * likewise refused rather than silently rounded, which is the behaviour a
 * measurement record wants.
 *
 * NORMALIZATION DECISIONS (stated, not implied)
 *   * a blank or whitespace-only `unit` is treated as an ABSENT unit: an empty
 *     optional field carries nothing to lose;
 *   * a non-blank `unit` with no measured value is REFUSED, never silently
 *     dropped (ATM-002-R7 §8.1: no input is ever lost);
 *   * `observedAt` absent on create means "now"; an explicit null or blank is
 *     refused rather than silently replaced, because the schema requires a time
 *     and inventing one would misstate when the condition was seen. On amendment
 *     it likewise cannot be cleared.
 *
 * WHITESPACE BOUND. A zero measured value is a value: `0`, `'0'` and `'0.0000'`
 * satisfy the content requirement, because a recorded zero is evidence and is
 * never treated as absence. Text that is only Unicode whitespace — including
 * U+00A0, which PostgreSQL's whitespace classes exclude but JavaScript trimming
 * removes — is refused here; the database check is the portable backstop for the
 * ordinary whitespace cases, not a Unicode normaliser.
 */

const { getConnection } = require('../config/database');

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
// Only limits the schema itself declares are enforced here. Nothing invented.

/** Matches `unit VARCHAR(50)`. */
const MAX_UNIT_LENGTH = 50;

/** NUMERIC(12,4): at most 8 integer digits and at most 4 fractional digits. */
const MEASURED_VALUE_PATTERN = /^-?\d{1,8}(?:\.\d{1,4})?$/;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The amendable substance keys. Everything else is refused, never ignored. */
const AMENDABLE_KEYS = Object.freeze([
  'observedAt',
  'observationText',
  'measuredValue',
  'unit',
  'taskTemplateId',
  'taskTemplateStepId'
]);

/**
 * Keys that identify the record or its ownership. Naming one of these in an
 * amendment is refused explicitly so that a caller is never left believing an
 * identity change was applied.
 */
const IMMUTABLE_KEYS = Object.freeze([
  'id',
  'organizationId',
  'facilityId',
  'assetId',
  'recordedByUserId',
  'createdAt',
  'updatedAt'
]);

/**
 * Promotion is deliberately not implemented in this milestone. `frozenAt` is the
 * one-way marker a later promotion milestone will set; naming it here is refused
 * with a dedicated failure so the deferral is explicit rather than silent.
 */
const PROMOTION_KEYS = Object.freeze(['frozenAt', 'promotion', 'promotedToFindingId']);

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/**
 * Malformed or incoherent input: structurally invalid, or incoherent against
 * real, tenant-verified state.
 */
class ObservationValidationError extends Error {
  constructor(failures) {
    super(`Observation input is invalid: ${failures.map((f) => f.rule).join(', ')}`);
    this.name = 'ObservationValidationError';
    this.statusCode = 400;
    this.code = 'OBSERVATION_INVALID';
    this.failures = failures;
  }
}

/**
 * A referenced row does not exist, is not visible to this tenant, or is not
 * eligible for capture.
 *
 * Deliberately indistinguishable between "absent" and "another tenant's": a
 * caller must not be able to use this service to probe for the existence of
 * other tenants' assets, facilities, users or knowledge.
 */
class ObservationContextError extends Error {
  constructor(message, code = 'OBSERVATION_CONTEXT_UNRESOLVED', statusCode = 404) {
    super(message);
    this.name = 'ObservationContextError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** The addressed Observation does not exist within this tenant. */
class ObservationNotFoundError extends Error {
  constructor(observationId) {
    super(`Observation ${observationId} does not exist`);
    this.name = 'ObservationNotFoundError';
    this.statusCode = 404;
    this.code = 'OBSERVATION_NOT_FOUND';
  }
}

/**
 * The requested change conflicts with the Observation's lifecycle state. A
 * frozen Observation is immutable: its substance and its attribution are closed.
 */
class ObservationFrozenError extends Error {
  constructor(observationId) {
    super(`Observation ${observationId} is frozen and cannot be amended`);
    this.name = 'ObservationFrozenError';
    this.statusCode = 409;
    this.code = 'OBSERVATION_FROZEN';
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const trimOrNull = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

/** A positive integer id, or NaN when the value is present but junk. */
const asPositiveInt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : NaN;
};

/**
 * Normalize an optional measured value to the exact decimal string the database
 * will store, or to one of: null (absent), NaN (present but malformed).
 */
const asMeasuredValue = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return NaN;
    return asMeasuredValue(String(value));
  }
  const text = String(value).trim();
  if (text === '') return null;
  return MEASURED_VALUE_PATTERN.test(text) ? text : NaN;
};

/** Present-and-parseable -> ISO string; absent -> fallback; junk -> NaN. */
const asTimestamp = (value, fallback) => {
  if (value === undefined) return fallback;
  if (value === null || value === '') return NaN;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? NaN : date.toISOString();
};

/** Normalize a text-like field to a trimmed string or null. */
const textOrNull = (value) => (value === null || value === undefined ? null : String(value));

/**
 * Project a database row into a plain owned object.
 *
 * Only the recorded fields cross the boundary. No live connection, row or
 * derived interpretation is exposed, and no field is computed that the row does
 * not actually hold.
 */
const toObservation = (row) => ({
  id: Number(row.id),
  organizationId: Number(row.organization_id),
  facilityId: Number(row.facility_id),
  assetId: Number(row.asset_id),
  recordedByUserId: Number(row.recorded_by_user_id),
  observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : row.observed_at,
  observationText: row.observation_text,
  measuredValue: row.measured_value === null || row.measured_value === undefined
    ? null
    : String(row.measured_value),
  unit: row.unit,
  taskTemplateId: row.task_template_id === null || row.task_template_id === undefined
    ? null
    : Number(row.task_template_id),
  taskTemplateStepId: row.task_template_step_id === null || row.task_template_step_id === undefined
    ? null
    : Number(row.task_template_step_id),
  frozenAt: row.frozen_at === null || row.frozen_at === undefined
    ? null
    : (row.frozen_at instanceof Date ? row.frozen_at.toISOString() : row.frozen_at),
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
});

const SELECT_COLUMNS = `
  id, organization_id, facility_id, asset_id, recorded_by_user_id,
  observed_at, observation_text, measured_value, unit,
  task_template_id, task_template_step_id, frozen_at, created_at, updated_at
`;

/**
 * Run `fn` inside one transaction owned by this service.
 *
 * Every operation is atomic: the tenant proofs and the write either all land or
 * none does, so a reference can never be validated against state that has moved.
 */
async function withTransaction(fn) {
  const conn = await getConnection();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Trusted context
// ---------------------------------------------------------------------------

/**
 * Resolve the trusted tenant context.
 *
 * `organizationId` comes from the trusted call context and is never read from
 * caller data: this module does not consult `input.organizationId` anywhere, so
 * a caller-supplied organization cannot override it.
 */
const resolveTenantContext = (context) => {
  const failures = [];
  const organizationId = asPositiveInt(context && context.organizationId);
  if (organizationId === null) failures.push({ rule: 'ORGANIZATION_REQUIRED', field: 'organizationId' });
  else if (Number.isNaN(organizationId)) failures.push({ rule: 'ORGANIZATION_INVALID', field: 'organizationId' });
  if (failures.length) throw new ObservationValidationError(failures);
  return { organizationId };
};

/**
 * Resolve the trusted capture context: the tenant AND the accountable recorder.
 *
 * Both come from the trusted call context. There is deliberately no
 * system/anonymous fallback — a captured Observation must always be attributable
 * to the person who recorded it.
 */
const resolveCaptureContext = (context) => {
  const { organizationId } = resolveTenantContext(context);
  const failures = [];
  const recordedByUserId = asPositiveInt(context && context.recordedByUserId);
  if (recordedByUserId === null) failures.push({ rule: 'RECORDER_REQUIRED', field: 'recordedByUserId' });
  else if (Number.isNaN(recordedByUserId)) failures.push({ rule: 'RECORDER_INVALID', field: 'recordedByUserId' });
  if (failures.length) throw new ObservationValidationError(failures);
  return { organizationId, recordedByUserId };
};

// ---------------------------------------------------------------------------
// Tenant and reference proofs
// ---------------------------------------------------------------------------

/**
 * Prove the asset exists AND belongs to this tenant.
 *
 * An absent asset and another tenant's asset are reported identically, so this
 * service cannot be used to enumerate other tenants' assets.
 */
async function proveAsset(conn, assetId, organizationId) {
  const rows = await conn.query(
    'SELECT id, organization_id, facility_id FROM equipment WHERE id = $1', [assetId]
  );
  const asset = rows[0] || null;
  if (!asset || asset.organization_id === null
      || Number(asset.organization_id) !== organizationId) {
    throw new ObservationContextError(
      `Asset ${assetId} does not exist in this organization`, 'OBSERVATION_ASSET_NOT_FOUND');
  }
  return asset;
}

/** Prove the facility exists and belongs to this tenant (same non-disclosure rule). */
async function proveFacility(conn, facilityId, organizationId) {
  const rows = await conn.query(
    'SELECT id, organization_id FROM facilities WHERE id = $1', [facilityId]
  );
  const facility = rows[0] || null;
  if (!facility || facility.organization_id === null
      || Number(facility.organization_id) !== organizationId) {
    throw new ObservationContextError(
      `Facility ${facilityId} does not exist in this organization`, 'OBSERVATION_FACILITY_NOT_FOUND');
  }
  return facility;
}

/** Prove the recorder exists, belongs to this tenant, and may still act. */
async function proveRecorder(conn, recordedByUserId, organizationId) {
  const rows = await conn.query(
    'SELECT id, organization_id, is_active FROM users WHERE id = $1', [recordedByUserId]
  );
  const user = rows[0] || null;
  if (!user || user.organization_id === null
      || Number(user.organization_id) !== organizationId) {
    throw new ObservationContextError(
      `Recorder ${recordedByUserId} does not exist in this organization`,
      'OBSERVATION_RECORDER_NOT_FOUND');
  }
  if (user.is_active === false) {
    throw new ObservationContextError(
      `Recorder ${recordedByUserId} is not an active principal`,
      'OBSERVATION_RECORDER_INACTIVE', 409);
  }
  return user;
}

/**
 * Prove the optional governed procedure context is legitimate.
 *
 * ATM-001's scope rule only: a template is available when it is global
 * (`organization_id IS NULL`) or belongs to this tenant. Publication, version and
 * pack semantics are NOT re-implemented or weakened here — ATM-001 owns them, and
 * they are not operationally present yet. A supplied step must belong to the
 * supplied template.
 */
async function proveProcedure(conn, templateId, stepId, organizationId) {
  if (templateId === null) return;

  const templates = await conn.query(
    'SELECT id, organization_id FROM task_templates WHERE id = $1', [templateId]
  );
  const template = templates[0] || null;
  if (!template) {
    throw new ObservationContextError(
      `Task template ${templateId} does not exist`, 'OBSERVATION_TEMPLATE_NOT_FOUND');
  }
  if (template.organization_id !== null && Number(template.organization_id) !== organizationId) {
    throw new ObservationContextError(
      `Task template ${templateId} is not available to this organization`,
      'OBSERVATION_TEMPLATE_NOT_FOUND');
  }

  if (stepId === null) return;

  const steps = await conn.query(
    'SELECT id, task_template_id FROM task_template_steps WHERE id = $1', [stepId]
  );
  const step = steps[0] || null;
  if (!step || Number(step.task_template_id) !== templateId) {
    throw new ObservationContextError(
      `Task template step ${stepId} does not belong to task template ${templateId}`,
      'OBSERVATION_STEP_NOT_FOUND');
  }
}

/**
 * Prove the asset's facility and the supplied facility are the same, for this
 * tenant. The asset has already been tenant-verified, so these failures leak
 * nothing about other tenants.
 */
function proveAssetFacility(asset, facilityId, failures) {
  if (asset.facility_id === null || asset.facility_id === undefined) {
    failures.push({ rule: 'ASSET_WITHOUT_FACILITY', field: 'assetId' });
    return;
  }
  if (Number(asset.facility_id) !== facilityId) {
    failures.push({ rule: 'ASSET_FACILITY_MISMATCH', field: 'facilityId' });
  }
}

// ---------------------------------------------------------------------------
// Captured-content rules
// ---------------------------------------------------------------------------

/**
 * The captured content of an Observation, and the two rules that make it
 * coherent:
 *
 *   * a completely empty Observation is not a record of anything, so at least
 *     one of a non-blank text or a measured value is required;
 *   * a unit describes a measured value. A non-blank unit without one is REFUSED
 *     rather than silently dropped: discarding operator input would misrepresent
 *     what was recorded, and ATM-002-R7 §8.1 requires that no input is ever lost.
 *     A blank unit is treated as an absent unit instead, because an empty
 *     optional field carries nothing to lose.
 *
 * The database enforces both independently; these are the same rules expressed
 * where a caller can be told precisely what is wrong.
 */
function resolveCapturedContent(observationText, measuredValue, unit, failures) {
  const text = trimOrNull(observationText);
  const unitText = trimOrNull(unit);

  if (unitText !== null && measuredValue === null) {
    failures.push({ rule: 'UNIT_REQUIRES_VALUE', field: 'unit' });
  }
  if (unitText !== null && unitText.length > MAX_UNIT_LENGTH) {
    failures.push({ rule: 'UNIT_TOO_LONG', field: 'unit' });
  }
  if (text === null && measuredValue === null) {
    failures.push({ rule: 'CONTENT_REQUIRED', field: 'observationText' });
  }

  return { text, measuredValue, unit: measuredValue === null ? null : unitText };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Record an Observation against an asset.
 *
 * @param {{organizationId: number, recordedByUserId: number}} context trusted call context
 * @param {Object} input
 * @param {number} input.facilityId
 * @param {number} input.assetId
 * @param {string} [input.observedAt] ISO timestamp; defaults to the recording time
 * @param {string} [input.observationText]
 * @param {number|string} [input.measuredValue]
 * @param {string} [input.unit]
 * @param {number} [input.taskTemplateId] optional governed procedure context
 * @param {number} [input.taskTemplateStepId] optional governed procedure context
 * @returns {Promise<Object>} the recorded Observation
 */
async function createObservation(context, input = {}) {
  const { organizationId, recordedByUserId } = resolveCaptureContext(context);

  const failures = [];
  const assetId = asPositiveInt(input.assetId);
  const facilityId = asPositiveInt(input.facilityId);
  const templateId = asPositiveInt(input.taskTemplateId);
  const stepId = asPositiveInt(input.taskTemplateStepId);

  if (assetId === null) failures.push({ rule: 'ASSET_REQUIRED', field: 'assetId' });
  else if (Number.isNaN(assetId)) failures.push({ rule: 'ASSET_INVALID', field: 'assetId' });
  if (facilityId === null) failures.push({ rule: 'FACILITY_REQUIRED', field: 'facilityId' });
  else if (Number.isNaN(facilityId)) failures.push({ rule: 'FACILITY_INVALID', field: 'facilityId' });
  if (Number.isNaN(templateId)) failures.push({ rule: 'TASK_TEMPLATE_INVALID', field: 'taskTemplateId' });
  if (Number.isNaN(stepId)) failures.push({ rule: 'TASK_TEMPLATE_STEP_INVALID', field: 'taskTemplateStepId' });
  if (stepId !== null && templateId === null) {
    failures.push({ rule: 'STEP_REQUIRES_TEMPLATE', field: 'taskTemplateStepId' });
  }

  const measuredValue = asMeasuredValue(input.measuredValue);
  if (Number.isNaN(measuredValue)) {
    failures.push({ rule: 'MEASURED_VALUE_INVALID', field: 'measuredValue' });
  }

  // An absent observedAt means "now"; an explicitly cleared one is impossible
  // because the schema requires a time.
  const observedAt = asTimestamp(input.observedAt, null);
  if (Number.isNaN(observedAt)) {
    failures.push({ rule: 'OBSERVED_AT_INVALID', field: 'observedAt' });
  }

  const content = Number.isNaN(measuredValue)
    ? { text: trimOrNull(input.observationText), measuredValue: null, unit: null }
    : resolveCapturedContent(input.observationText, measuredValue, input.unit, failures);

  if (failures.length) throw new ObservationValidationError(failures);

  return withTransaction(async (conn) => {
    await proveRecorder(conn, recordedByUserId, organizationId);

    const asset = await proveAsset(conn, assetId, organizationId);
    await proveFacility(conn, facilityId, organizationId);

    const coherence = [];
    proveAssetFacility(asset, facilityId, coherence);
    if (coherence.length) throw new ObservationValidationError(coherence);

    await proveProcedure(conn, templateId, stepId, organizationId);

    const rows = await conn.query(
      `INSERT INTO asset_observations
         (organization_id, facility_id, asset_id, recorded_by_user_id,
          observed_at, observation_text, measured_value, unit,
          task_template_id, task_template_step_id)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, CURRENT_TIMESTAMP), $6, $7, $8, $9, $10)
       RETURNING ${SELECT_COLUMNS}`,
      [organizationId, facilityId, assetId, recordedByUserId,
        observedAt, content.text, content.measuredValue, content.unit,
        templateId, stepId]
    );

    return toObservation(rows[0]);
  });
}

/**
 * Load one Observation within the trusted tenant.
 *
 * @param {{organizationId: number}} context
 * @param {number} observationId
 * @returns {Promise<Object>}
 */
async function getObservation(context, observationId) {
  const { organizationId } = resolveTenantContext(context);
  const id = asPositiveInt(observationId);
  if (id === null || Number.isNaN(id)) {
    throw new ObservationValidationError([{ rule: 'OBSERVATION_ID_REQUIRED', field: 'observationId' }]);
  }

  const rows = await withTransaction((conn) => conn.query(
    `SELECT ${SELECT_COLUMNS} FROM asset_observations
      WHERE id = $1 AND organization_id = $2`, [id, organizationId]
  ));
  if (!rows.length) throw new ObservationNotFoundError(id);
  return toObservation(rows[0]);
}

/**
 * List Observations within the trusted tenant.
 *
 * Only recorded facts are returned. Nothing is derived, ranked, scored or
 * classified, and an unfrozen row is reported as unfrozen rather than as a task.
 *
 * @param {{organizationId: number}} context
 * @param {Object} [filters]
 * @param {number} [filters.assetId]
 * @param {number} [filters.facilityId]
 * @param {boolean} [filters.openOnly] only rows still open to amendment
 * @param {number} [filters.limit] default 50, capped at 200
 * @param {number} [filters.offset]
 * @returns {Promise<{items: Array<Object>, limit: number, offset: number}>}
 */
async function listObservations(context, filters = {}) {
  const { organizationId } = resolveTenantContext(context);

  const failures = [];
  const assetId = asPositiveInt(filters.assetId);
  const facilityId = asPositiveInt(filters.facilityId);
  if (Number.isNaN(assetId)) failures.push({ rule: 'ASSET_INVALID', field: 'assetId' });
  if (Number.isNaN(facilityId)) failures.push({ rule: 'FACILITY_INVALID', field: 'facilityId' });

  let limit = DEFAULT_LIMIT;
  if (filters.limit !== undefined && filters.limit !== null) {
    const requested = Number(filters.limit);
    if (!Number.isInteger(requested) || requested <= 0) {
      failures.push({ rule: 'LIMIT_INVALID', field: 'limit' });
    } else {
      limit = Math.min(requested, MAX_LIMIT);
    }
  }
  let offset = 0;
  if (filters.offset !== undefined && filters.offset !== null) {
    const requested = Number(filters.offset);
    if (!Number.isInteger(requested) || requested < 0) {
      failures.push({ rule: 'OFFSET_INVALID', field: 'offset' });
    } else {
      offset = requested;
    }
  }
  if (filters.openOnly !== undefined && typeof filters.openOnly !== 'boolean') {
    failures.push({ rule: 'OPEN_ONLY_INVALID', field: 'openOnly' });
  }
  if (failures.length) throw new ObservationValidationError(failures);

  const conditions = ['organization_id = $1'];
  const params = [organizationId];
  if (assetId !== null) { params.push(assetId); conditions.push(`asset_id = $${params.length}`); }
  if (facilityId !== null) { params.push(facilityId); conditions.push(`facility_id = $${params.length}`); }
  if (filters.openOnly === true) conditions.push('frozen_at IS NULL');

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;
  params.push(offset);
  const offsetPlaceholder = `$${params.length}`;

  const rows = await withTransaction((conn) => conn.query(
    `SELECT ${SELECT_COLUMNS} FROM asset_observations
      WHERE ${conditions.join(' AND ')}
      ORDER BY observed_at DESC, id DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`, params
  ));

  return { items: rows.map(toObservation), limit, offset };
}

/**
 * Amend an open Observation.
 *
 * Identity, tenant, asset and recorder are immutable and are never accepted as
 * amendments. A frozen Observation is immutable in full — its substance and its
 * attribution are closed, which is the boundary ATM-002-R5 §2 draws between an
 * Observation and a Finding.
 *
 * Only the keys named in `amendment` are changed. An omitted key is left exactly
 * as recorded; `null` explicitly clears a value, subject to the captured-content
 * rules. Promotion is not implemented, so `frozenAt` and any promotion key are
 * refused rather than ignored.
 *
 * @param {{organizationId: number}} context
 * @param {number} observationId
 * @param {Object} amendment
 * @returns {Promise<Object>} the amended Observation
 */
async function updateObservation(context, observationId, amendment = {}) {
  const { organizationId } = resolveTenantContext(context);
  const id = asPositiveInt(observationId);
  if (id === null || Number.isNaN(id)) {
    throw new ObservationValidationError([{ rule: 'OBSERVATION_ID_REQUIRED', field: 'observationId' }]);
  }

  // Refuse unknown and non-amendable keys explicitly. A silently ignored key
  // would leave the caller believing a change was applied.
  const keys = Object.keys(amendment || {});
  const failures = [];
  for (const key of keys) {
    if (PROMOTION_KEYS.includes(key)) {
      failures.push({ rule: 'PROMOTION_NOT_IMPLEMENTED', field: key });
      continue;
    }
    if (IMMUTABLE_KEYS.includes(key)) {
      failures.push({ rule: 'IMMUTABLE_FIELD', field: key });
      continue;
    }
    if (!AMENDABLE_KEYS.includes(key)) {
      failures.push({ rule: 'UNKNOWN_FIELD', field: key });
    }
  }
  if (failures.length) throw new ObservationValidationError(failures);
  if (keys.length === 0) {
    throw new ObservationValidationError([{ rule: 'AMENDMENT_EMPTY', field: null }]);
  }

  return withTransaction(async (conn) => {
    const existingRows = await conn.query(
      `SELECT ${SELECT_COLUMNS} FROM asset_observations
        WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, organizationId]
    );
    if (!existingRows.length) throw new ObservationNotFoundError(id);
    const existing = existingRows[0];
    if (existing.frozen_at !== null && existing.frozen_at !== undefined) {
      throw new ObservationFrozenError(id);
    }

    const nextFailures = [];

    const nextText = hasOwn(amendment, 'observationText')
      ? textOrNull(amendment.observationText)
      : existing.observation_text;

    let nextValue = existing.measured_value === null || existing.measured_value === undefined
      ? null
      : String(existing.measured_value);
    if (hasOwn(amendment, 'measuredValue')) {
      const normalized = asMeasuredValue(amendment.measuredValue);
      if (Number.isNaN(normalized)) {
        nextFailures.push({ rule: 'MEASURED_VALUE_INVALID', field: 'measuredValue' });
      } else {
        nextValue = normalized;
      }
    }

    const nextUnit = hasOwn(amendment, 'unit') ? amendment.unit : existing.unit;

    const content = resolveCapturedContent(nextText, nextValue, nextUnit, nextFailures);

    let nextTemplateId = existing.task_template_id === null || existing.task_template_id === undefined
      ? null
      : Number(existing.task_template_id);
    let nextStepId = existing.task_template_step_id === null || existing.task_template_step_id === undefined
      ? null
      : Number(existing.task_template_step_id);

    if (hasOwn(amendment, 'taskTemplateId')) {
      nextTemplateId = asPositiveInt(amendment.taskTemplateId);
      if (Number.isNaN(nextTemplateId)) {
        nextFailures.push({ rule: 'TASK_TEMPLATE_INVALID', field: 'taskTemplateId' });
      } else if (nextTemplateId === null) {
        // Clearing the template clears a step that would no longer have one.
        nextStepId = null;
      }
    }
    if (hasOwn(amendment, 'taskTemplateStepId')) {
      nextStepId = asPositiveInt(amendment.taskTemplateStepId);
      if (Number.isNaN(nextStepId)) {
        nextFailures.push({ rule: 'TASK_TEMPLATE_STEP_INVALID', field: 'taskTemplateStepId' });
      } else if (nextStepId !== null && nextTemplateId === null) {
        nextFailures.push({ rule: 'STEP_REQUIRES_TEMPLATE', field: 'taskTemplateStepId' });
      }
    }

    const nextObservedAt = hasOwn(amendment, 'observedAt')
      ? asTimestamp(amendment.observedAt, null)
      : (existing.observed_at instanceof Date ? existing.observed_at.toISOString() : existing.observed_at);
    if (Number.isNaN(nextObservedAt)) {
      nextFailures.push({ rule: 'OBSERVED_AT_INVALID', field: 'observedAt' });
    }

    if (nextFailures.length) throw new ObservationValidationError(nextFailures);

    await proveProcedure(conn, nextTemplateId, nextStepId, organizationId);

    const rows = await conn.query(
      `UPDATE asset_observations
          SET observed_at = COALESCE($3::timestamptz, observed_at),
              observation_text = $4,
              measured_value = $5,
              unit = $6,
              task_template_id = $7,
              task_template_step_id = $8,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND organization_id = $2
        RETURNING ${SELECT_COLUMNS}`,
      [id, organizationId, nextObservedAt, content.text, content.measuredValue, content.unit,
        nextTemplateId, nextStepId]
    );
    if (!rows.length) throw new ObservationNotFoundError(id);

    return toObservation(rows[0]);
  });
}

module.exports = {
  createObservation,
  getObservation,
  listObservations,
  updateObservation,
  ObservationValidationError,
  ObservationContextError,
  ObservationNotFoundError,
  ObservationFrozenError,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_UNIT_LENGTH,
  AMENDABLE_KEYS,
  IMMUTABLE_KEYS,
  PROMOTION_KEYS
};
