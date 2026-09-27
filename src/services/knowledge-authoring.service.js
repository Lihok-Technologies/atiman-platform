/**
 * Knowledge Authoring Service
 *
 * ATM-001 M6.4 — governed DRAFT definition authoring primitive.
 *
 * Responsibility: create and edit a GOVERNED DRAFT knowledge definition —
 * the working definition, its governed vocabulary, its Equipment-Type
 * applicability, its steps and its working safety controls — with durable
 * accountable-human attribution.
 *
 * This service owns DRAFT AUTHORING ONLY. It deliberately does NOT own:
 *
 *   * review                          (TaskTemplate.submitForReview)
 *   * safety-review attestation       (TaskTemplate.recordSafetyReview)
 *   * approval                        (TaskTemplate.approveTemplate)
 *   * immutable version publication   (TaskTemplate.publishVersion)
 *   * evidence authoring              (KnowledgeProvenance.attachEvidence)
 *
 * Those remain the exclusive responsibility of the existing governed methods,
 * and none of them is reimplemented, wrapped or bypassed here. This service can
 * never set review_state, a reviewer/approver/safety attribution, a publication
 * state, or a published version row. It cannot approve and it cannot publish.
 *
 * Why this exists
 * ---------------
 * Migration 020 established the governed substrate (knowledge types, task
 * families, maintenance strategy, the structured trigger model, explicit scope
 * and content origin, Equipment-Type applicability) and the publication
 * admission gate that fails closed without it. Until M6.4 there was no product
 * surface that could author those governed values: `createWithDetails` writes
 * only legacy columns, `updateIfEditable`'s field whitelist excludes every
 * governed column, and `task_template_equipment_types` had no writer at all.
 *
 * This primitive is the reusable seam. A controlled application script, a future
 * authenticated API, a future task-first UI and future AI-assisted authoring all
 * call these functions rather than manipulating tables directly.
 *
 * Constitutional boundaries preserved
 * -----------------------------------
 *   * Evidence Before Assumption — no governed semantic value is inferred. Every
 *     governed choice is supplied explicitly by the caller; a draft may be
 *     incomplete, and incompleteness is reported rather than filled in.
 *   * AI Augments Human Judgment — AI assistance is declared, never silently
 *     assumed, and this service cannot approve anything.
 *   * Accountable humans — every mutating operation requires an explicit
 *     `actorUserId` that resolves to a real user. There is no "system" actor and
 *     no anonymous authoring.
 *   * AI disclosure — declared here, on the working definition, because that is
 *     where an accountable author can state it truthfully and a human approver can
 *     see it (ATM-001 M6.4 Step 3B-B). The disclosure is a provenance dimension
 *     independent of `content_origin`: `authored` means accountable-human-authored
 *     and says nothing about whether AI assisted. The primitive never infers it
 *     and never writes `ai_assisted = false` on an author's behalf: an undeclared
 *     disclosure stays NULL, which publication admission refuses for authored
 *     knowledge.
 *   * Legacy provenance clarity — an authored definition is a NEW identity with
 *     `content_origin = 'authored'`. Legacy (`legacy_generated`) definitions and
 *     system templates are never rewritten through this service, so a generated
 *     placeholder can never be silently presented as human-authored knowledge.
 */

const { getConnection } = require('../config/database');
const { TASK_KINDS } = require('../models/task-template.model');
const {
  SUPPORTED_STEP_DATA_TYPES,
  failure
} = require('./knowledge-governance.service');

// ---------------------------------------------------------------------------
// Governed vocabularies
//
// Each mirrors a migration 020 CHECK constraint exactly. They are mirrored (not
// re-invented) so that an authoring mistake surfaces as a structured domain
// failure rather than as a raw constraint violation, and so that the database
// remains the final authority. Nothing here is stricter than the schema except
// where noted.
// ---------------------------------------------------------------------------

/** Mirrors chk_task_templates_maintenance_strategy. */
const MAINTENANCE_STRATEGIES = Object.freeze([
  'preventive', 'predictive', 'condition_based', 'compliance', 'corrective'
]);

/** Mirrors chk_task_templates_trigger_mechanism. */
const TRIGGER_MECHANISMS = Object.freeze([
  'calendar', 'hours_based', 'condition_based', 'event', 'no_fixed_interval'
]);

/** Mirrors chk_task_templates_trigger_condition_operator. */
const TRIGGER_CONDITION_OPERATORS = Object.freeze(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']);

/**
 * Assignable knowledge scopes. Mirrors chk_task_templates_knowledge_scope and
 * chk_task_templates_marketplace_not_assignable: `marketplace` is represented in
 * the schema vocabulary but is NOT assignable, exactly as in M6.3.
 */
const ASSIGNABLE_KNOWLEDGE_SCOPES = Object.freeze(['shared', 'customer']);

/** Mirrors chk_task_templates_priority. */
const PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent']);

/**
 * The only content origin this primitive may create. Mirrors
 * chk_task_templates_content_origin, restricted to the authored half: this
 * service creates authored knowledge, and it never rewrites an established
 * origin (chk + trg_task_templates_origin_immutable).
 */
const AUTHORED_CONTENT_ORIGIN = 'authored';

/** Mirrors task_template_steps.step_type / instruction bounds without a vocabulary. */
const MAX_STEP_TYPE_LENGTH = 50;
const MAX_UNIT_LENGTH = 50;
const MAX_TEMPLATE_NAME_LENGTH = 255;
const MAX_MAINTENANCE_TYPE_LENGTH = 50;
const MAX_TASK_SCOPE_LENGTH = 100;
const MAX_CONTEXT_LENGTH = 2000;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_SAFETY_TYPE_LENGTH = 50;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Malformed authoring input: structurally invalid or incoherent. */
class AuthoringValidationError extends Error {
  constructor(failures) {
    super(`Knowledge authoring input is invalid: ${failures.map((f) => f.rule).join(', ')}`);
    this.name = 'AuthoringValidationError';
    this.statusCode = 400;
    this.code = 'KNOWLEDGE_AUTHORING_INVALID';
    this.failures = failures;
  }
}

/** The operation conflicts with the definition's current governance state. */
class AuthoringConflictError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AuthoringConflictError';
    this.statusCode = 409;
    this.code = code;
  }
}

/** The addressed definition, actor or referenced row does not exist. */
class AuthoringNotFoundError extends Error {
  constructor(message, code = 'KNOWLEDGE_AUTHORING_NOT_FOUND') {
    super(message);
    this.name = 'AuthoringNotFoundError';
    this.statusCode = 404;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

const trimOrNull = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

/** A positive integer id, or null when absent. Rejects junk rather than coercing. */
const asPositiveInt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : NaN;
};

const asNullableNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
};

const assertValid = (failures) => {
  if (failures.length) throw new AuthoringValidationError(failures);
};

/**
 * Run `fn` inside one transaction owned by this service.
 *
 * `getConnection()` opens the transaction immediately and its `query` returns the
 * rows array directly. Every authoring operation is therefore atomic: either the
 * whole authored change lands, or nothing does. No nested transaction is opened,
 * so a failure anywhere rolls the whole operation back.
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

/**
 * Resolve and validate the accountable actor.
 *
 * Every mutating operation requires a real, existing user. There is deliberately
 * no system/anonymous fallback: an authored engineering definition must always be
 * attributable to the person who authored it.
 */
async function resolveActor(conn, actorUserId) {
  const failures = [];
  const actorId = asPositiveInt(actorUserId);

  if (actorUserId === undefined || actorUserId === null || actorUserId === '') {
    failures.push(failure('ACTOR_REQUIRED',
      'An accountable actorUserId is required for every authoring operation'));
  } else if (Number.isNaN(actorId)) {
    failures.push(failure('ACTOR_INVALID',
      'actorUserId must be a positive integer identifying a real user',
      { actorUserId }));
  }
  assertValid(failures);

  const rows = await conn.query(
    `SELECT id, organization_id, is_active FROM users WHERE id = $1`, [actorId]
  );
  if (!rows[0]) {
    throw new AuthoringNotFoundError(
      `Accountable actor ${actorId} does not exist; authorship cannot be attributed`,
      'ACTOR_NOT_FOUND'
    );
  }
  // An inactive principal may not author. Authorship is an accountable human act,
  // and a deactivated account is not an accountable principal: accepting its
  // attribution would record accountability against someone who cannot be held to
  // it.
  if (rows[0].is_active !== true) {
    throw new AuthoringConflictError(
      `Accountable actor ${actorId} is inactive and may not author governed knowledge`,
      'ACTOR_INACTIVE'
    );
  }
  return rows[0];
}

/**
 * Load a working definition, tenant-scoped exactly as the rest of the governed
 * code is: a global definition (organization_id IS NULL) is visible to any
 * caller, and a customer-scoped definition is visible only to its own
 * organization. When no organization is supplied, a customer-scoped definition
 * is simply not reachable — it is not silently readable.
 */
async function loadDefinitionRow(conn, templateId, organizationId = null, { forUpdate = false } = {}) {
  const id = asPositiveInt(templateId);
  if (Number.isNaN(id)) {
    throw new AuthoringValidationError([
      failure('TEMPLATE_ID_INVALID', 'templateId must be a positive integer', { templateId })
    ]);
  }
  if (id === null) {
    throw new AuthoringValidationError([
      failure('TEMPLATE_ID_REQUIRED', 'templateId is required')
    ]);
  }

  const orgId = organizationId === undefined ? null : organizationId;
  const rows = await conn.query(
    `SELECT t.*,
            kt.type_code   AS knowledge_type_code,
            kt.type_name   AS knowledge_type_name,
            tf.family_code AS task_family_code,
            tf.family_name AS task_family_name,
            et.type_code   AS declared_equipment_type_code,
            et.type_name   AS declared_equipment_type_name,
            et.identity_state AS declared_equipment_type_identity_state
       FROM task_templates t
       LEFT JOIN knowledge_types kt ON kt.id = t.knowledge_type_id
       LEFT JOIN task_families  tf ON tf.id = t.task_family_id
       LEFT JOIN equipment_types et ON et.id = t.equipment_type_id
      WHERE t.id = $1
        AND (t.organization_id IS NULL OR t.organization_id = $2)
      ${forUpdate ? 'FOR UPDATE OF t' : ''}`,
    [id, orgId]
  );
  const row = rows[0];
  if (!row) {
    throw new AuthoringNotFoundError(`Knowledge definition ${id} was not found`);
  }
  return row;
}

/**
 * Acquire the definition row for authoring, serializing against the governed
 * lifecycle.
 *
 * Every mutating operation loads the definition `FOR UPDATE` inside its own
 * transaction — BEFORE authorability and draft state are evaluated — and holds
 * that lock until commit. Without it, `load -> assertDraft -> write` is a stale
 * read: a concurrent `submitForReview` could commit `under_review` between the
 * read and the write, and the authoring mutation would then land on a definition
 * that is no longer a draft. The lock makes the read and the write one atomic
 * decision against the lifecycle.
 *
 * `FOR UPDATE OF t` is required because the query LEFT JOINs the governed
 * vocabularies; locking the whole row set would be rejected for the nullable side
 * of an outer join and would lock rows this operation has no business locking.
 *
 * The read path (`loadAuthoredDefinition`) does not lock: it makes no decision
 * that a later write depends on.
 */
async function loadDefinitionRowForAuthoring(conn, templateId, organizationId) {
  return loadDefinitionRow(conn, templateId, organizationId, { forUpdate: true });
}

/**
 * Refuse to author over anything this primitive must never rewrite.
 *
 * Two protections, both required by the M6.4 policy:
 *
 *   1. `legacy_generated` — authored knowledge is a NEW identity. Rewriting a
 *      generated legacy record into `authored` would assert authorship that did
 *      not happen and would destroy the provenance distinction migration 020
 *      exists to protect. Legacy clearance is a separate governed event.
 *   2. `is_system` — system templates are reference/drafting identities. They
 *      are cloned, never transformed in place.
 *
 * The second check is also enforced by `isEditable()` for the legacy update path,
 * but it is asserted here so this primitive cannot depend on that behaviour.
 */
function assertAuthorable(row) {
  if (row.content_origin === 'legacy_generated') {
    throw new AuthoringConflictError(
      `Knowledge definition ${row.id} is legacy_generated and cannot be authored through this service; `
      + 'create a new authored definition instead',
      'LEGACY_DEFINITION_IMMUTABLE'
    );
  }
  if (row.is_system === true) {
    throw new AuthoringConflictError(
      `Knowledge definition ${row.id} is a system template and cannot be authored in place; `
      + 'create a new authored definition instead',
      'SYSTEM_TEMPLATE_IMMUTABLE'
    );
  }
  if (row.content_origin !== AUTHORED_CONTENT_ORIGIN) {
    throw new AuthoringConflictError(
      `Knowledge definition ${row.id} has content_origin ${row.content_origin}; `
      + `only ${AUTHORED_CONTENT_ORIGIN} definitions may be authored here`,
      'CONTENT_ORIGIN_NOT_AUTHORED'
    );
  }
}

/**
 * A tenant-scoped definition may only be authored by a principal that belongs to
 * the owning organization.
 *
 * Without this guard a caller in one tenant could create — or later edit — a
 * customer-scoped definition owned by a different tenant, which is a cross-tenant
 * write even though no existing row was addressed. Shared knowledge (no
 * organization) is unaffected.
 */
function assertActorMayOwn(actor, organizationId) {
  const target = organizationId === undefined ? null : organizationId;
  if (target === null) return;
  if (Number(actor.organization_id) !== Number(target)) {
    throw new AuthoringConflictError(
      `the accountable actor does not belong to organization ${target}; `
      + 'a customer-scoped definition may only be authored by its owning organization',
      'ACTOR_ORGANIZATION_MISMATCH'
    );
  }
}

/**
 * Only a draft may be authored.
 *
 * Once a definition enters review it belongs to the governed lifecycle. Returning
 * it to draft is an explicit lifecycle act (`reopenForRework`) performed by the
 * lifecycle methods, never a side effect of authoring.
 */
function assertDraft(row) {
  if (row.review_state !== 'draft') {
    throw new AuthoringConflictError(
      `Knowledge definition ${row.id} is '${row.review_state}'; authoring is permitted only while it is 'draft'`,
      'DRAFT_ONLY'
    );
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the merged (current + proposed) governed state.
 *
 * Only values that are PRESENT are validated, plus coherence among present
 * values. A draft is allowed to be incomplete: absence is not an authoring
 * error, and publication admission remains the final fail-closed authority on
 * completeness. This function therefore distinguishes INVALID input from an
 * INCOMPLETE BUT VALID draft, and never fills a gap in.
 */
async function validateGovernedState(conn, state, context = {}) {
  const failures = [];

  // ---- required structural columns (NOT NULL in the schema) ----------------
  if (isBlank(state.template_name)) {
    failures.push(failure('TEMPLATE_NAME_REQUIRED', 'templateName is required'));
  } else if (String(state.template_name).trim().length > MAX_TEMPLATE_NAME_LENGTH) {
    failures.push(failure('TEMPLATE_NAME_TOO_LONG',
      `templateName must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters`));
  }

  if (isBlank(state.maintenance_type)) {
    failures.push(failure('MAINTENANCE_TYPE_REQUIRED',
      'maintenanceType is required (the legacy structural classification column)'));
  } else if (String(state.maintenance_type).trim().length > MAX_MAINTENANCE_TYPE_LENGTH) {
    failures.push(failure('MAINTENANCE_TYPE_TOO_LONG',
      `maintenanceType must be at most ${MAX_MAINTENANCE_TYPE_LENGTH} characters`));
  }

  if (isBlank(state.description) === false
      && String(state.description).length > MAX_DESCRIPTION_LENGTH) {
    failures.push(failure('DESCRIPTION_TOO_LONG',
      `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`));
  }

  if (isBlank(state.task_scope) === false
      && String(state.task_scope).length > MAX_TASK_SCOPE_LENGTH) {
    failures.push(failure('TASK_SCOPE_TOO_LONG',
      `taskScope must be at most ${MAX_TASK_SCOPE_LENGTH} characters`));
  }

  // `priority` is a MATERIAL field: it participates in the approval fingerprint,
  // so it is never silently defaulted. The caller states it.
  if (isBlank(state.priority)) {
    failures.push(failure('PRIORITY_REQUIRED',
      `priority is required and must be one of ${PRIORITIES.join(', ')}`));
  } else if (!PRIORITIES.includes(String(state.priority).trim())) {
    failures.push(failure('PRIORITY_INVALID',
      `priority must be one of ${PRIORITIES.join(', ')}`, { priority: state.priority }));
  }

  // task_kind mirrors the existing controller-level rule; it is not a schema CHECK.
  if (hasOwn(state, 'task_kind') && !isBlank(state.task_kind)
      && !Object.values(TASK_KINDS).includes(String(state.task_kind).trim())) {
    failures.push(failure('TASK_KIND_INVALID',
      `task_kind must be one of ${Object.values(TASK_KINDS).join(', ')}`, { task_kind: state.task_kind }));
  }

  // `equipment_type_id` is NOT NULL in the schema and participates in the approval
  // fingerprint. It is the legacy structural declaration of the definition and is
  // DISTINCT from the governed applicability set; this primitive never derives one
  // from the other, so the caller states it explicitly.
  if (state.equipment_type_id === null || state.equipment_type_id === undefined) {
    failures.push(failure('EQUIPMENT_TYPE_REQUIRED',
      'equipmentTypeId is required (the legacy structural type declaration)'));
  } else if (Number.isNaN(asPositiveInt(state.equipment_type_id))) {
    failures.push(failure('EQUIPMENT_TYPE_INVALID',
      'equipmentTypeId must be a positive integer', { equipmentTypeId: state.equipment_type_id }));
  }

  // ---- governed vocabulary ------------------------------------------------
  if (!isBlank(state.maintenance_strategy)
      && !MAINTENANCE_STRATEGIES.includes(String(state.maintenance_strategy).trim())) {
    failures.push(failure('MAINTENANCE_STRATEGY_INVALID',
      `maintenanceStrategy must be one of ${MAINTENANCE_STRATEGIES.join(', ')}`,
      { maintenanceStrategy: state.maintenance_strategy }));
  }

  if (!isBlank(state.trigger_mechanism)
      && !TRIGGER_MECHANISMS.includes(String(state.trigger_mechanism).trim())) {
    failures.push(failure('TRIGGER_MECHANISM_INVALID',
      `triggerMechanism must be one of ${TRIGGER_MECHANISMS.join(', ')}`,
      { triggerMechanism: state.trigger_mechanism }));
  }

  if (!isBlank(state.trigger_condition_operator)
      && !TRIGGER_CONDITION_OPERATORS.includes(String(state.trigger_condition_operator).trim())) {
    failures.push(failure('TRIGGER_CONDITION_OPERATOR_INVALID',
      `triggerConditionOperator must be one of ${TRIGGER_CONDITION_OPERATORS.join(', ')}`,
      { triggerConditionOperator: state.trigger_condition_operator }));
  }

  if (!isBlank(state.trigger_condition_value)) {
    const value = asNullableNumber(state.trigger_condition_value);
    if (Number.isNaN(value)) {
      failures.push(failure('TRIGGER_CONDITION_VALUE_INVALID',
        'triggerConditionValue must be numeric', { triggerConditionValue: state.trigger_condition_value }));
    }
  }

  if (!isBlank(state.trigger_condition_context)
      && String(state.trigger_condition_context).length > MAX_CONTEXT_LENGTH) {
    failures.push(failure('TRIGGER_CONDITION_CONTEXT_TOO_LONG',
      `triggerConditionContext must be at most ${MAX_CONTEXT_LENGTH} characters`));
  }

  // ---- knowledge scope (no default; marketplace is non-assignable) ---------
  if (!isBlank(state.knowledge_scope)) {
    const scope = String(state.knowledge_scope).trim();
    if (!ASSIGNABLE_KNOWLEDGE_SCOPES.includes(scope)) {
      failures.push(failure('KNOWLEDGE_SCOPE_NOT_ASSIGNABLE',
        `knowledgeScope must be one of ${ASSIGNABLE_KNOWLEDGE_SCOPES.join(', ')}`,
        { knowledgeScope: state.knowledge_scope }));
    }
  }

  // ---- content origin: authored is an invariant of this primitive ----------
  // Never accepted from the caller and never rewritten; asserted so a future
  // edit cannot quietly relax it.
  if (state.content_origin !== AUTHORED_CONTENT_ORIGIN) {
    failures.push(failure('CONTENT_ORIGIN_IMMUTABLE',
      `this primitive authors ${AUTHORED_CONTENT_ORIGIN} definitions only and never rewrites an established origin`,
      { contentOrigin: state.content_origin }));
  }

  // ---- AI-assistance disclosure coherence (ATM-001 M6.4 Step 3B-B) --------
  // The flag and its detail are a single attribution fact and must not contradict
  // each other, in either direction — the same rule the governed crosswalk layer
  // already applies to its own AI disclosure. The database enforces the structural
  // half; this enforces the semantics ("meaningfully present"), so an author sees a
  // structured domain error rather than a raw constraint violation.
  failures.push(...validateAiDisclosure(state));

  // ---- trigger coherence (mirrors chk_task_templates_trigger_consistency) --
  failures.push(...validateTriggerCoherence(state));

  // ---- scope/organization coherence (mirrors scope_organization) ----------
  const scope = isBlank(state.knowledge_scope) ? null : String(state.knowledge_scope).trim();
  const organizationId = state.organization_id === undefined ? null : state.organization_id;
  if (scope === 'shared' && organizationId !== null) {
    failures.push(failure('SCOPE_ORGANIZATION_NOT_ALLOWED',
      'a shared definition must not carry an organizationId'));
  }
  if (scope === 'customer' && (organizationId === null || organizationId === undefined)) {
    failures.push(failure('SCOPE_ORGANIZATION_REQUIRED',
      'a customer-scoped definition requires its owning organizationId'));
  }
  if (organizationId !== null && organizationId !== undefined
      && Number.isNaN(asPositiveInt(organizationId))) {
    failures.push(failure('SCOPE_ORGANIZATION_INVALID',
      'organizationId must be a positive integer', { organizationId }));
  }

  // ---- referenced rows must exist ----------------------------------------
  failures.push(...await validateReferences(conn, state, context));

  return failures;
}

/**
 * Normalise a disclosure detail for validation.
 *
 * The semantic value is a JSON object, but it reaches this primitive in two shapes:
 * as the caller supplied it, and as the column-shaped state `buildDefinitionFields`
 * produces, where it is JSON text because that is what a JSONB write takes. The
 * rules must judge both identically, so JSON text is parsed back first.
 *
 * Returns `{ state: 'absent' | 'record' | 'invalid', value }`. `absent` is NULL — the
 * disclosure was not captured. `invalid` is a supplied value that is not a record.
 */
function normaliseDisclosureDetail(detail) {
  if (detail === null || detail === undefined) return { state: 'absent', value: null };
  let value = detail;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return { state: 'invalid', value: detail };
    try {
      value = JSON.parse(text);
    } catch {
      return { state: 'invalid', value: detail };
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { state: 'invalid', value };
  }
  return { state: 'record', value };
}

/**
 * Is a disclosure detail "meaningfully present"?
 *
 * The disclosure must SAY what was assisted. A plain object carrying at least one
 * non-blank value does; `{}`, an array, a scalar, or an object whose values are all
 * null/blank/empty does not. This mirrors the crosswalk rule that "an AI-assisted
 * row must say what was assisted".
 */
function isMeaningfullyPresentDisclosure(detail) {
  if (detail === null || detail === undefined) return false;
  if (typeof detail !== 'object' || Array.isArray(detail)) return false;
  const values = Object.values(detail);
  if (values.length === 0) return false;
  return values.some((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });
}

/**
 * AI-assistance disclosure coherence.
 *
 *   ai_assisted = TRUE  -> detail must be meaningfully present
 *   ai_assisted = FALSE -> detail must be absent (NULL)
 *   ai_assisted = NULL  -> detail must be absent (NULL)
 *
 * NULL is not "false": it means the status was not captured under this regime, and
 * is the truthful state for knowledge that predates it.
 */
function validateAiDisclosure(state) {
  const failures = [];
  const assisted = state.ai_assisted === undefined ? null : state.ai_assisted;
  const detail = normaliseDisclosureDetail(state.ai_assistance_detail);

  if (assisted !== null && typeof assisted !== 'boolean') {
    failures.push(failure('AI_ASSISTED_INVALID',
      'aiAssisted must be true, false, or absent (never captured)', { aiAssisted: assisted }));
    return failures;
  }

  // A supplied detail that is not a record is neither a valid disclosure nor an
  // absent one. This is stricter than chk_task_templates_ai_assistance_coherence,
  // which only refuses an EMPTY value; the schema permits any non-empty JSON,
  // while the governed coherence rule requires the disclosure to be a record.
  if (detail.state === 'invalid') {
    failures.push(failure('AI_ASSISTANCE_DETAIL_INVALID',
      'aiAssistanceDetail must be an object describing what AI materially assisted',
      { field: 'aiAssistanceDetail' }));
    return failures;
  }

  if (assisted === true && !isMeaningfullyPresentDisclosure(detail.value)) {
    failures.push(failure('AI_ASSISTANCE_DETAIL_REQUIRED',
      'an AI-assisted definition must record what AI materially assisted'));
  }
  if (assisted !== true && detail.state !== 'absent') {
    failures.push(failure('AI_ASSISTANCE_DETAIL_NOT_ALLOWED',
      'AI-assistance detail is only meaningful when AI assistance is disclosed; a '
      + 'non-assisted or undeclared definition must not carry it'));
  }

  return failures;
}

/**
 * Trigger coherence, mirroring chk_task_templates_trigger_consistency exactly.
 *
 * The schema permits an incomplete draft, so an absent mechanism is not an error.
 * A DECLARED mechanism must carry exactly the fields that mechanism allows, and
 * nothing else. No interval is ever inferred, and no date may be expressed: the
 * model has no date column and this primitive has no date field.
 *
 * Note on basis: migration 020 requires `trigger_basis_source_version_id` only
 * for an APPROVED record (chk_task_templates_trigger_basis_required). A draft may
 * therefore assert a mechanism before its basis is attached; publication
 * admission still refuses the publication. This primitive mirrors the schema
 * rather than inventing a stricter draft rule, and reports the missing basis as
 * incompleteness (see describeDraftCompleteness).
 */
function validateTriggerCoherence(state) {
  const failures = [];
  const mechanism = isBlank(state.trigger_mechanism) ? null : String(state.trigger_mechanism).trim();
  if (mechanism === null) {
    // No mechanism declared. Any trigger detail is therefore incoherent, because
    // detail without a mechanism states nothing.
    const hasDetail = !isBlank(state.trigger_condition_parameter)
      || !isBlank(state.trigger_condition_operator)
      || !isBlank(state.trigger_condition_value)
      || !isBlank(state.trigger_condition_unit)
      || !isBlank(state.trigger_condition_context)
      || !isBlank(state.trigger_event_description);
    if (hasDetail) {
      failures.push(failure('TRIGGER_DETAIL_WITHOUT_MECHANISM',
        'trigger detail requires an explicit triggerMechanism'));
    }
    return failures;
  }

  const parameter = isBlank(state.trigger_condition_parameter) ? null : String(state.trigger_condition_parameter).trim();
  const operator = isBlank(state.trigger_condition_operator) ? null : String(state.trigger_condition_operator).trim();
  const value = asNullableNumber(state.trigger_condition_value);
  const unit = isBlank(state.trigger_condition_unit) ? null : String(state.trigger_condition_unit).trim();
  const context = isBlank(state.trigger_condition_context) ? null : String(state.trigger_condition_context).trim();
  const event = isBlank(state.trigger_event_description) ? null : String(state.trigger_event_description).trim();

  const hasValue = value !== null && !Number.isNaN(value);

  if (unit !== null && unit.length > MAX_UNIT_LENGTH) {
    failures.push(failure('TRIGGER_CONDITION_UNIT_TOO_LONG',
      `triggerConditionUnit must be at most ${MAX_UNIT_LENGTH} characters`));
  }

  if (mechanism === 'calendar' || mechanism === 'hours_based') {
    // A declared interval mechanism must carry its magnitude and unit, and must
    // not carry condition or event detail.
    if (!hasValue || unit === null) {
      failures.push(failure('TRIGGER_INTERVAL_MAGNITUDE_REQUIRED',
        `a ${mechanism} trigger must declare a numeric triggerConditionValue and a triggerConditionUnit`));
    }
    if (parameter || operator || context || event) {
      failures.push(failure('TRIGGER_INTERVAL_CARRIES_CRITERION',
        `a ${mechanism} trigger must not carry a condition criterion or event description`));
    }
  } else if (mechanism === 'condition_based') {
    if (parameter === null || operator === null || !hasValue || unit === null) {
      failures.push(failure('TRIGGER_CRITERION_INCOMPLETE',
        'a condition_based trigger requires parameter, operator, numeric value and unit'));
    }
    if (event) {
      failures.push(failure('TRIGGER_CRITERION_CARRIES_EVENT',
        'a condition_based trigger must not also carry an event description'));
    }
  } else if (mechanism === 'event') {
    if (event === null) {
      failures.push(failure('TRIGGER_EVENT_DESCRIPTION_REQUIRED',
        'an event trigger requires triggerEventDescription'));
    }
    if (parameter || operator || hasValue || unit || context) {
      failures.push(failure('TRIGGER_EVENT_CARRIES_CRITERION',
        'an event trigger must not carry a condition criterion'));
    }
  } else if (mechanism === 'no_fixed_interval') {
    // The explicit absence of a recommendation. Any detail would contradict it.
    if (parameter || operator || hasValue || unit || context || event) {
      failures.push(failure('TRIGGER_ABSENCE_CARRIES_DETAIL',
        'no_fixed_interval is the explicit absence of a trigger and must carry no detail'));
    }
  }

  // Context is meaningful only for a condition-based trigger.
  if (context !== null && mechanism !== 'condition_based') {
    failures.push(failure('TRIGGER_CONTEXT_REQUIRES_CONDITION',
      'triggerConditionContext is only meaningful for a condition_based trigger'));
  }

  // Basis is optional while drafting (schema requires it for approved records),
  // but when supplied it must be coherent: an explicit absence of a trigger has
  // no basis to cite.
  if (mechanism === 'no_fixed_interval' && !isBlank(state.trigger_basis_source_version_id)) {
    failures.push(failure('TRIGGER_ABSENCE_BASIS_NOT_ALLOWED',
      'no_fixed_interval carries no trigger recommendation and therefore no basis'));
  }

  return failures;
}

/** Referenced rows must exist. Absence is not validated; presence must resolve. */
async function validateReferences(conn, state, context) {
  const failures = [];

  if (state.knowledge_type_id !== null && state.knowledge_type_id !== undefined) {
    const rows = await conn.query(
      `SELECT id, is_active FROM knowledge_types WHERE id = $1`, [state.knowledge_type_id]
    );
    if (!rows[0]) {
      failures.push(failure('KNOWLEDGE_TYPE_NOT_FOUND',
        `knowledge type ${state.knowledge_type_id} does not exist`, { knowledgeTypeId: state.knowledge_type_id }));
    } else if (rows[0].is_active !== true) {
      failures.push(failure('KNOWLEDGE_TYPE_INACTIVE',
        `knowledge type ${state.knowledge_type_id} is not active`));
    }
  }

  if (state.task_family_id !== null && state.task_family_id !== undefined) {
    const rows = await conn.query(
      `SELECT id, is_active FROM task_families WHERE id = $1`, [state.task_family_id]
    );
    if (!rows[0]) {
      failures.push(failure('TASK_FAMILY_NOT_FOUND',
        `task family ${state.task_family_id} does not exist`, { taskFamilyId: state.task_family_id }));
    } else if (rows[0].is_active !== true) {
      failures.push(failure('TASK_FAMILY_INACTIVE',
        `task family ${state.task_family_id} is not active`));
    }
  }

  if (state.equipment_type_id !== null && state.equipment_type_id !== undefined) {
    const rows = await conn.query(
      `SELECT id FROM equipment_types WHERE id = $1`, [state.equipment_type_id]
    );
    if (!rows[0]) {
      failures.push(failure('EQUIPMENT_TYPE_NOT_FOUND',
        `equipment type ${state.equipment_type_id} does not exist`,
        { equipmentTypeId: state.equipment_type_id }));
    }
  }

  if (!isBlank(state.trigger_basis_source_version_id)) {
    const rows = await conn.query(
      `SELECT id FROM knowledge_source_versions WHERE id = $1`,
      [state.trigger_basis_source_version_id]
    );
    if (!rows[0]) {
      failures.push(failure('TRIGGER_BASIS_NOT_FOUND',
        `trigger basis source version ${state.trigger_basis_source_version_id} does not exist`,
        { triggerBasisSourceVersionId: state.trigger_basis_source_version_id }));
    }
  }

  if (context.parentTemplateId !== null && context.parentTemplateId !== undefined) {
    const rows = await conn.query(
      `SELECT id FROM task_templates WHERE id = $1`, [context.parentTemplateId]
    );
    if (!rows[0]) {
      failures.push(failure('PARENT_TEMPLATE_NOT_FOUND',
        `parent_template_id ${context.parentTemplateId} does not exist`,
        { parentTemplateId: context.parentTemplateId }));
    }
  }

  return failures;
}

/** Validate an ordered step set. Absent acceptance criteria stay absent. */
function validateSteps(steps) {
  const failures = [];

  if (!Array.isArray(steps)) {
    failures.push(failure('STEPS_NOT_ARRAY', 'steps must be an array'));
    return failures;
  }

  const seen = new Set();
  steps.forEach((step, index) => {
    const where = { index };
    if (step === null || typeof step !== 'object') {
      failures.push(failure('STEP_NOT_OBJECT', 'each step must be an object', where));
      return;
    }

    if (isBlank(step.instruction)) {
      failures.push(failure('STEP_INSTRUCTION_REQUIRED', 'every step requires an instruction', where));
    }
    if (isBlank(step.step_type)) {
      failures.push(failure('STEP_TYPE_REQUIRED', 'every step requires a step_type', where));
    } else if (String(step.step_type).trim().length > MAX_STEP_TYPE_LENGTH) {
      failures.push(failure('STEP_TYPE_TOO_LONG',
        `step_type must be at most ${MAX_STEP_TYPE_LENGTH} characters`, where));
    }

    if (step.step_no !== undefined && step.step_no !== null) {
      const stepNo = asPositiveInt(step.step_no);
      if (Number.isNaN(stepNo) || stepNo === null) {
        failures.push(failure('STEP_ORDER_INVALID', 'step_no must be a positive integer', where));
      } else if (seen.has(stepNo)) {
        failures.push(failure('STEP_ORDER_DUPLICATE', 'duplicate step_no within the step set', { step_no: stepNo }));
      } else {
        seen.add(stepNo);
      }
    }

    if (!isBlank(step.data_type) && !SUPPORTED_STEP_DATA_TYPES.includes(String(step.data_type).trim())) {
      failures.push(failure('STEP_DATA_TYPE_UNSUPPORTED',
        `unsupported step data type: ${step.data_type}`, where));
    }

    const min = asNullableNumber(step.min_value);
    const max = asNullableNumber(step.max_value);
    if (Number.isNaN(min) || Number.isNaN(max)) {
      failures.push(failure('STEP_LIMIT_NOT_NUMERIC', 'measurement limits must be numeric', where));
    } else if (min !== null && max !== null && min > max) {
      failures.push(failure('STEP_LIMITS_INCOHERENT', 'min_value must not exceed max_value', where));
    }

    if (!isBlank(step.unit) && String(step.unit).trim().length > MAX_UNIT_LENGTH) {
      failures.push(failure('STEP_UNIT_TOO_LONG',
        `unit must be at most ${MAX_UNIT_LENGTH} characters`, where));
    }

    if (step.options !== undefined && step.options !== null
        && typeof step.options !== 'object') {
      failures.push(failure('STEP_OPTIONS_INVALID',
        'options must be an array or an object (a JSON value)', where));
    }
  });

  return failures;
}

/** Validate working safety controls. No vocabulary is invented: the schema has none. */
function validateSafetyControls(safetyControls) {
  const failures = [];

  if (!Array.isArray(safetyControls)) {
    failures.push(failure('SAFETY_CONTROLS_NOT_ARRAY', 'safetyControls must be an array'));
    return failures;
  }

  safetyControls.forEach((control, index) => {
    const where = { index };
    if (control === null || typeof control !== 'object') {
      failures.push(failure('SAFETY_CONTROL_NOT_OBJECT', 'each safety control must be an object', where));
      return;
    }
    if (isBlank(control.safety_type)) {
      failures.push(failure('SAFETY_TYPE_REQUIRED', 'each safety control requires a safety_type', where));
    } else if (String(control.safety_type).trim().length > MAX_SAFETY_TYPE_LENGTH) {
      failures.push(failure('SAFETY_TYPE_TOO_LONG',
        `safety_type must be at most ${MAX_SAFETY_TYPE_LENGTH} characters`, where));
    }
    if (isBlank(control.description)) {
      failures.push(failure('SAFETY_DESCRIPTION_REQUIRED', 'each safety control requires a description', where));
    }
    if (control.is_mandatory !== undefined && control.is_mandatory !== null
        && typeof control.is_mandatory !== 'boolean') {
      failures.push(failure('SAFETY_MANDATORY_INVALID', 'is_mandatory must be a boolean', where));
    }
  });

  return failures;
}

/**
 * Validate a complete applicability set.
 *
 * The governed claim is an enumerated set of Equipment Type identities with
 * exactly one primary anchor. Nothing is remapped, nothing is inferred, and a
 * superseded or retired Equipment Type is NOT rejected here: migration 020 has no
 * such invariant, the ratified legacy manifest itself asserts applicability to
 * superseded types, and reconciliation is a human act. The target's identity
 * state is exposed to callers instead of being silently filtered.
 */
async function validateApplicability(conn, applicability) {
  const failures = [];

  if (!Array.isArray(applicability)) {
    failures.push(failure('APPLICABILITY_NOT_ARRAY', 'applicability must be an array'));
    return failures;
  }

  const seen = new Set();
  let primaryCount = 0;

  for (let index = 0; index < applicability.length; index += 1) {
    const entry = applicability[index];
    const where = { index };

    if (entry === null || typeof entry !== 'object') {
      failures.push(failure('APPLICABILITY_ENTRY_INVALID', 'each applicability entry must be an object', where));
      continue;
    }

    const equipmentTypeId = asPositiveInt(entry.equipment_type_id);
    if (equipmentTypeId === null || Number.isNaN(equipmentTypeId)) {
      failures.push(failure('APPLICABILITY_TYPE_REQUIRED',
        'each applicability entry requires a positive equipment_type_id', where));
      continue;
    }
    if (seen.has(equipmentTypeId)) {
      failures.push(failure('APPLICABILITY_DUPLICATE',
        `equipment type ${equipmentTypeId} appears more than once in the applicability set`,
        { equipmentTypeId }));
      continue;
    }
    seen.add(equipmentTypeId);

    const rows = await conn.query(
      `SELECT id, type_code, type_name, identity_state FROM equipment_types WHERE id = $1`,
      [equipmentTypeId]
    );
    if (!rows[0]) {
      failures.push(failure('APPLICABILITY_TYPE_NOT_FOUND',
        `equipment type ${equipmentTypeId} does not exist`, { equipmentTypeId }));
      continue;
    }

    if (entry.is_primary === true) primaryCount += 1;
    else if (entry.is_primary !== undefined && entry.is_primary !== null
             && typeof entry.is_primary !== 'boolean') {
      failures.push(failure('APPLICABILITY_PRIMARY_INVALID', 'is_primary must be a boolean', where));
    }
  }

  // A complete (non-empty) applicability set must name exactly one primary
  // anchor. The anchor is never inferred from position or from a single entry:
  // the caller states it.
  if (applicability.length > 0 && primaryCount === 0) {
    failures.push(failure('APPLICABILITY_PRIMARY_REQUIRED',
      'a complete applicability set must designate exactly one primary anchor explicitly'));
  }
  if (primaryCount > 1) {
    failures.push(failure('APPLICABILITY_MULTIPLE_PRIMARY',
      'an applicability set may designate exactly one primary anchor', { primaryCount }));
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Normalise governed-field input into a column-shaped object. Absent keys stay absent. */
function normaliseGovernedFields(input = {}) {
  const fields = {};

  const take = (source, target, transform = (v) => v) => {
    if (hasOwn(input, source)) fields[target] = transform(input[source]);
  };

  take('templateName', 'template_name', trimOrNull);
  take('templateCode', 'template_code', trimOrNull);
  take('description', 'description', trimOrNull);
  take('taskKind', 'task_kind', trimOrNull);
  take('taskScope', 'task_scope', trimOrNull);
  take('maintenanceType', 'maintenance_type', trimOrNull);
  take('priority', 'priority', trimOrNull);
  take('equipmentTypeId', 'equipment_type_id', asPositiveInt);
  take('organizationId', 'organization_id', asPositiveInt);
  take('knowledgeTypeId', 'knowledge_type_id', asPositiveInt);
  take('taskFamilyId', 'task_family_id', asPositiveInt);
  take('maintenanceStrategy', 'maintenance_strategy', trimOrNull);
  take('triggerMechanism', 'trigger_mechanism', trimOrNull);
  take('triggerConditionParameter', 'trigger_condition_parameter', trimOrNull);
  take('triggerConditionOperator', 'trigger_condition_operator', trimOrNull);
  take('triggerConditionValue', 'trigger_condition_value', asNullableNumber);
  take('triggerConditionUnit', 'trigger_condition_unit', trimOrNull);
  take('triggerConditionContext', 'trigger_condition_context', trimOrNull);
  take('triggerEventDescription', 'trigger_event_description', trimOrNull);
  take('triggerBasisSourceVersionId', 'trigger_basis_source_version_id', asPositiveInt);
  take('knowledgeScope', 'knowledge_scope', trimOrNull);
  // AI-assistance disclosure (ATM-001 M6.4 Step 3B-B). Declared explicitly by the
  // accountable author; never inferred, and never defaulted to false.
  // An explicitly undefined declaration is "not declared" (NULL), matching the
  // house convention for optional governed fields and keeping a JSON body spread
  // from reaching the driver as an unbound parameter.
  take('aiAssisted', 'ai_assisted', (v) => (v === undefined ? null : v));
  take('aiAssistanceDetail', 'ai_assistance_detail',
    (v) => (v === undefined || v === null ? null : JSON.stringify(v)));

  // `content_origin` is deliberately absent: it is an invariant of this
  // primitive, never caller input, and never rewritten.
  // `frequency_*` and scheduling columns are deliberately absent: governed
  // knowledge must not carry scheduling, and no interval may be expressed here.

  return fields;
}

/** Merge a loaded definition row with proposed column-shaped fields. */
function mergeState(row, proposed) {
  const state = {
    template_name: row.template_name,
    template_code: row.template_code,
    description: row.description,
    task_kind: row.task_kind,
    task_scope: row.task_scope,
    maintenance_type: row.maintenance_type,
    priority: row.priority,
    equipment_type_id: row.equipment_type_id,
    organization_id: row.organization_id,
    knowledge_type_id: row.knowledge_type_id,
    task_family_id: row.task_family_id,
    maintenance_strategy: row.maintenance_strategy,
    trigger_mechanism: row.trigger_mechanism,
    trigger_condition_parameter: row.trigger_condition_parameter,
    trigger_condition_operator: row.trigger_condition_operator,
    trigger_condition_value: row.trigger_condition_value,
    trigger_condition_unit: row.trigger_condition_unit,
    trigger_condition_context: row.trigger_condition_context,
    trigger_event_description: row.trigger_event_description,
    trigger_basis_source_version_id: row.trigger_basis_source_version_id,
    knowledge_scope: row.knowledge_scope,
    content_origin: row.content_origin,
    ai_assisted: row.ai_assisted,
    ai_assistance_detail: row.ai_assistance_detail
  };
  for (const [key, value] of Object.entries(proposed)) {
    state[key] = value;
  }
  return state;
}

/** Columns this primitive may write on `task_templates`. Nothing else is writable. */
const WRITABLE_DEFINITION_COLUMNS = Object.freeze([
  'template_name', 'template_code', 'description', 'task_kind', 'task_scope',
  'maintenance_type', 'priority', 'equipment_type_id', 'organization_id',
  'knowledge_type_id', 'task_family_id', 'maintenance_strategy',
  'trigger_mechanism', 'trigger_condition_parameter', 'trigger_condition_operator',
  'trigger_condition_value', 'trigger_condition_unit', 'trigger_condition_context',
  'trigger_event_description', 'trigger_basis_source_version_id',
  'knowledge_scope', 'ai_assisted', 'ai_assistance_detail'
]);

// ---------------------------------------------------------------------------
// Public API — reads
// ---------------------------------------------------------------------------

/**
 * Load a governed definition with its working steps, working safety controls,
 * applicability, attached working evidence and an advisory completeness report.
 *
 * Read-only. `review_state`, `content_origin` and the attribution columns are
 * returned so a caller can see exactly what state it is looking at; nothing is
 * mutated and no governed meaning is derived.
 */
async function loadAuthoredDefinition(templateId, { organizationId = null } = {}) {
  const conn = await getConnection();
  try {
    const row = await loadDefinitionRow(conn, templateId, organizationId);

    const steps = await conn.query(
      `SELECT * FROM task_template_steps WHERE task_template_id = $1 ORDER BY step_no, id`,
      [row.id]
    );
    const safetyControls = await conn.query(
      `SELECT * FROM task_template_safety_controls WHERE task_template_id = $1 ORDER BY id`,
      [row.id]
    );
    const applicability = await conn.query(
      `SELECT a.equipment_type_id, a.is_primary, a.added_by_user_id, a.created_at,
              et.type_code, et.type_name, et.identity_state
         FROM task_template_equipment_types a
         JOIN equipment_types et ON et.id = a.equipment_type_id
        WHERE a.task_template_id = $1
        ORDER BY a.equipment_type_id`,
      [row.id]
    );
    // Working evidence is READ here and authored elsewhere: this primitive does
    // not implement provenance. Attachment belongs to the governed provenance
    // path, which owns source validation, source-scope enforcement and the
    // frozen-evidence guard.
    const evidence = await conn.query(
      `SELECT e.id, e.task_template_id, e.task_template_step_id,
              e.knowledge_source_version_id, e.section_or_clause, e.page_or_paragraph,
              e.derivation_notes, e.confidence_level, e.supporting_role,
              e.added_by_user_id, e.added_at
         FROM knowledge_template_evidence e
        WHERE e.task_template_id = $1
        ORDER BY e.id`,
      [row.id]
    );

    const definition = {
      id: row.id,
      template_code: row.template_code,
      template_name: row.template_name,
      description: row.description,
      task_kind: row.task_kind,
      task_scope: row.task_scope,
      maintenance_type: row.maintenance_type,
      priority: row.priority,
      is_system: row.is_system,
      is_editable: row.is_editable,
      is_active: row.is_active,
      organization_id: row.organization_id,
      content_origin: row.content_origin,
      review_state: row.review_state,
      safety_review_state: row.safety_review_state,
      created_by: row.created_by,
      parent_template_id: row.parent_template_id,
      equipment_type_id: row.equipment_type_id,
      declared_equipment_type: row.declared_equipment_type_code === null ? null : {
        id: row.equipment_type_id,
        type_code: row.declared_equipment_type_code,
        type_name: row.declared_equipment_type_name,
        identity_state: row.declared_equipment_type_identity_state
      },
      knowledge_type: row.knowledge_type_id === null ? null : {
        id: row.knowledge_type_id,
        type_code: row.knowledge_type_code,
        type_name: row.knowledge_type_name
      },
      task_family: row.task_family_id === null ? null : {
        id: row.task_family_id,
        family_code: row.task_family_code,
        family_name: row.task_family_name
      },
      maintenance_strategy: row.maintenance_strategy,
      trigger: {
        mechanism: row.trigger_mechanism,
        condition_parameter: row.trigger_condition_parameter,
        condition_operator: row.trigger_condition_operator,
        condition_value: row.trigger_condition_value,
        condition_unit: row.trigger_condition_unit,
        condition_context: row.trigger_condition_context,
        event_description: row.trigger_event_description,
        basis_source_version_id: row.trigger_basis_source_version_id
      },
      knowledge_scope: row.knowledge_scope,
      ai_assistance: {
        assisted: row.ai_assisted,
        detail: row.ai_assistance_detail
      },
      steps,
      safety_controls: safetyControls,
      applicability,
      evidence,
      authorable: row.content_origin === AUTHORED_CONTENT_ORIGIN
        && row.is_system !== true
        && row.review_state === 'draft'
    };

    definition.completeness = describeDraftCompleteness(definition);
    return definition;
  } finally {
    // A read-only transaction must still be ended explicitly. node-pg's
    // `release()` returns the client to the pool WITHOUT rolling back an open
    // transaction, so closing the read transaction here prevents a leaked
    // transaction (and its snapshot) from being handed to the next borrower.
    await conn.rollback();
    conn.release();
  }
}

/**
 * Advisory completeness report.
 *
 * This is NOT a governance gate and deliberately does not duplicate publication
 * admission: admission remains the single fail-closed authority, and it checks
 * far more than presence. This only tells an author (or a future UI) which
 * governed prerequisites are still absent, so an INCOMPLETE draft is visible
 * rather than mysterious. It never fills anything in.
 */
function describeDraftCompleteness(definition) {
  const missing = [];
  if (!definition.knowledge_type) missing.push('knowledge_type');
  if (!definition.task_family) missing.push('task_family');
  if (!definition.maintenance_strategy) missing.push('maintenance_strategy');
  if (!definition.trigger.mechanism) missing.push('trigger_mechanism');
  if (!definition.knowledge_scope) missing.push('knowledge_scope');
  if (definition.steps.length === 0) missing.push('steps');
  if (definition.applicability.length === 0) missing.push('applicability');
  if (definition.evidence.length === 0) missing.push('template_or_step_evidence');
  // Authored knowledge must declare whether AI materially assisted: publication
  // admission refuses an undeclared disclosure. Reported here as incompleteness so
  // an author sees the gap while drafting rather than at publication.
  if (definition.content_origin === AUTHORED_CONTENT_ORIGIN
      && (definition.ai_assistance.assisted === null
          || definition.ai_assistance.assisted === undefined)) {
    missing.push('ai_assistance_disclosure');
  }

  const trigger = definition.trigger;
  const mechanism = trigger.mechanism;
  const assertsTrigger = mechanism !== null && mechanism !== undefined
    && mechanism !== 'no_fixed_interval';
  if (assertsTrigger && (trigger.basis_source_version_id === null || trigger.basis_source_version_id === undefined)) {
    missing.push('trigger_basis_for_asserted_trigger');
  }

  return {
    is_complete_for_publication_candidate: missing.length === 0,
    missing,
    note: 'Advisory only. Publication admission is the fail-closed authority and '
      + 'checks substantially more than presence.'
  };
}

// ---------------------------------------------------------------------------
// Public API — mutations (all draft-only, all attributed, all atomic)
// ---------------------------------------------------------------------------

/**
 * Create a NEW authored governed draft definition.
 *
 * The definition, its governed vocabulary, its steps, its working safety
 * controls and its applicability set are written in ONE transaction: a failure
 * anywhere leaves no partial definition.
 *
 * `content_origin` is set to `authored` as an invariant. No governed semantic
 * value is inferred from the template code, the title, a legacy frequency or
 * duration, the parent, the Equipment-Type name or the task kind — every one is
 * supplied explicitly, and an incomplete draft is valid.
 */
async function createAuthoredDefinition(input = {}, { actorUserId } = {}) {
  const fields = normaliseGovernedFields(input);
  const steps = hasOwn(input, 'steps') ? input.steps : [];
  const safetyControls = hasOwn(input, 'safetyControls') ? input.safetyControls : [];
  const applicability = hasOwn(input, 'applicability') ? input.applicability : [];
  const parentTemplateId = hasOwn(input, 'parentTemplateId')
    ? asPositiveInt(input.parentTemplateId)
    : null;

  return withTransaction(async (conn) => {
    const actor = await resolveActor(conn, actorUserId);

    // Scope: an authored definition states its own scope. It is never taken from
    // the actor's organization implicitly — the caller declares it.
    if (!hasOwn(fields, 'knowledge_scope')) fields.knowledge_scope = null;
    if (!hasOwn(fields, 'organization_id')) fields.organization_id = null;
    fields.content_origin = AUTHORED_CONTENT_ORIGIN;

    const state = mergeState({
      template_name: null, template_code: null, description: null, task_kind: null,
      task_scope: null, maintenance_type: null, priority: null, equipment_type_id: null,
      organization_id: null, knowledge_type_id: null, task_family_id: null,
      maintenance_strategy: null, trigger_mechanism: null,
      trigger_condition_parameter: null, trigger_condition_operator: null,
      trigger_condition_value: null, trigger_condition_unit: null,
      trigger_condition_context: null, trigger_event_description: null,
      trigger_basis_source_version_id: null, knowledge_scope: null,
      content_origin: AUTHORED_CONTENT_ORIGIN,
      ai_assisted: null, ai_assistance_detail: null
    }, fields);

    assertValid(await validateGovernedState(conn, state, { parentTemplateId }));
    assertActorMayOwn(actor, state.organization_id);
    assertValid(validateSteps(steps));
    assertValid(validateSafetyControls(safetyControls));
    assertValid(await validateApplicability(conn, applicability));

    // The legacy structural columns the schema requires are stated by the caller;
    // no default is applied on the caller's behalf.
    const columns = [
      'template_name', 'template_code', 'description', 'task_kind', 'task_scope',
      'maintenance_type', 'priority', 'equipment_type_id', 'organization_id',
      'knowledge_type_id', 'task_family_id', 'maintenance_strategy',
      'trigger_mechanism', 'trigger_condition_parameter', 'trigger_condition_operator',
      'trigger_condition_value', 'trigger_condition_unit', 'trigger_condition_context',
      'trigger_event_description', 'trigger_basis_source_version_id',
      'knowledge_scope', 'content_origin',
      'ai_assisted', 'ai_assistance_detail',
      'parent_template_id', 'is_system', 'is_editable', 'is_active', 'created_by'
    ];
    const values = [
      state.template_name, state.template_code, state.description, state.task_kind,
      state.task_scope, state.maintenance_type, state.priority, state.equipment_type_id,
      state.organization_id, state.knowledge_type_id, state.task_family_id,
      state.maintenance_strategy, state.trigger_mechanism,
      state.trigger_condition_parameter, state.trigger_condition_operator,
      state.trigger_condition_value, state.trigger_condition_unit,
      state.trigger_condition_context, state.trigger_event_description,
      state.trigger_basis_source_version_id, state.knowledge_scope,
      AUTHORED_CONTENT_ORIGIN,
      state.ai_assisted, state.ai_assistance_detail,
      parentTemplateId, false, true, true, actor.id
    ];
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

    const inserted = await conn.query(
      `INSERT INTO task_templates (${columns.join(', ')})
       VALUES (${placeholders})
       RETURNING id`,
      values
    );
    const templateId = inserted[0].id;

    await writeSteps(conn, templateId, steps);
    await writeSafetyControls(conn, templateId, safetyControls);
    await writeApplicability(conn, templateId, applicability, actor.id);

    return templateId;
  }).then((templateId) => loadAuthoredDefinition(templateId, {
    organizationId: fields.organization_id === undefined ? null : fields.organization_id
  }));
}

/**
 * Update governed draft fields.
 *
 * Only the explicit whitelist in WRITABLE_DEFINITION_COLUMNS may be written.
 * `content_origin` is not writable, and neither `review_state` nor any
 * reviewer/approver/safety-review attribution nor any publication or version
 * state is reachable from here. The merged state is validated, so a partial
 * update cannot leave the definition incoherent.
 */
async function updateGovernedDraft(templateId, input = {}, { actorUserId, organizationId = null } = {}) {
  const proposed = normaliseGovernedFields(input);
  const supplied = Object.keys(proposed).filter((key) => WRITABLE_DEFINITION_COLUMNS.includes(key));

  if (supplied.length === 0) {
    throw new AuthoringValidationError([
      failure('NO_WRITABLE_FIELDS',
        'no writable governed field was supplied; this operation does not accept arbitrary mutation')
    ]);
  }

  return withTransaction(async (conn) => {
    const actor = await resolveActor(conn, actorUserId);
    const row = await loadDefinitionRowForAuthoring(conn, templateId, organizationId);
    assertAuthorable(row);
    assertActorMayOwn(actor, row.organization_id);
    assertDraft(row);

    const state = mergeState(row, proposed);
    state.content_origin = row.content_origin;

    // Ownership is validated against the RESULTING state, not only the current
    // one. `organization_id` is writable, so checking only the loaded row would
    // let an actor who belongs to the current owner TRANSFER the definition to a
    // different organization — including converting a shared definition into
    // another tenant's knowledge. The invariant is that a customer-scoped
    // definition is never created, transferred or modified into ownership by an
    // organization other than the accountable actor's own.
    assertActorMayOwn(actor, state.organization_id);

    assertValid(await validateGovernedState(conn, state, {}));

    const setClause = supplied.map((column, index) => `${column} = $${index + 1}`).join(', ');
    const params = supplied.map((column) => proposed[column]);
    params.push(row.id);

    await conn.query(
      `UPDATE task_templates
          SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${params.length}`,
      params
    );

    // `task_templates` has no per-edit attribution column, so the accountable
    // actor is enforced (a real user must exist and no anonymous or system edit
    // is possible) rather than recorded on this row. Durable attribution is held
    // by created_by, by added_by_user_id on applicability and evidence, and in
    // full by the accountable chain frozen into the published version.
    void actor;
    return row.id;
  }).then((id) => loadAuthoredDefinition(id, { organizationId }));
}

/**
 * Replace the draft's Equipment-Type applicability set transactionally.
 *
 * A complete (non-empty) set must name exactly one primary anchor, stated
 * explicitly by the caller. The primary anchor is never inferred. Duplicates and
 * unknown Equipment Types are refused. Applicability on a superseded or retired
 * Equipment Type is permitted — migration 020 has no invariant against it and the
 * ratified legacy manifest asserts it — and the target's `identity_state` is
 * exposed to callers rather than silently filtered.
 *
 * Frozen version applicability lives in a different table and is never touched.
 */
async function setApplicability(templateId, applicability, { actorUserId, organizationId = null } = {}) {
  return withTransaction(async (conn) => {
    const actor = await resolveActor(conn, actorUserId);
    const row = await loadDefinitionRowForAuthoring(conn, templateId, organizationId);
    assertAuthorable(row);
    assertActorMayOwn(actor, row.organization_id);
    assertDraft(row);

    assertValid(await validateApplicability(conn, applicability));
    await writeApplicability(conn, row.id, applicability, actor.id);
    return row.id;
  }).then((id) => loadAuthoredDefinition(id, { organizationId }));
}

/**
 * Replace the draft's ordered step set.
 *
 * Ordering is deterministic: an explicit `step_no` is honoured, and otherwise
 * steps are numbered 1..n in the order supplied. Acceptance criteria are written
 * only when supplied — no expected value, limit, tolerance or unit is ever
 * invented, and absent criteria remain absent.
 *
 * Removing a step would CASCADE-delete any working evidence attached to it
 * (fk_knowledge_template_evidence_step is ON DELETE CASCADE), which would destroy
 * provenance silently. This operation therefore refuses to remove a step that
 * carries working evidence: the caller detaches evidence explicitly through the
 * governed provenance path first.
 */
async function replaceSteps(templateId, steps, { actorUserId, organizationId = null } = {}) {
  return withTransaction(async (conn) => {
    const actor = await resolveActor(conn, actorUserId);
    const row = await loadDefinitionRowForAuthoring(conn, templateId, organizationId);
    assertAuthorable(row);
    assertActorMayOwn(actor, row.organization_id);
    assertDraft(row);

    assertValid(validateSteps(steps));

    const existing = await conn.query(
      `SELECT id FROM task_template_steps WHERE task_template_id = $1`, [row.id]
    );
    if (existing.length > 0) {
      const evidenceRows = await conn.query(
        `SELECT e.id, e.task_template_step_id
           FROM knowledge_template_evidence e
          WHERE e.task_template_step_id = ANY($1::int[])`,
        [existing.map((step) => step.id)]
      );
      if (evidenceRows.length > 0) {
        throw new AuthoringConflictError(
          `Knowledge definition ${row.id} has ${evidenceRows.length} working evidence row(s) attached to steps; `
          + 'detach that evidence explicitly before replacing the step set, so provenance is never removed silently',
          'STEP_EVIDENCE_PRESENT'
        );
      }
      await conn.query(`DELETE FROM task_template_steps WHERE task_template_id = $1`, [row.id]);
    }

    await writeSteps(conn, row.id, steps);
    void actor;
    return row.id;
  }).then((id) => loadAuthoredDefinition(id, { organizationId }));
}

/**
 * Replace the draft's working safety controls.
 *
 * This writes only what the caller supplies. No control is invented, none is
 * inferred from legacy material, and the 47 provenance-free legacy safety inputs
 * are not treated as evidence. Safety-review lifecycle semantics are untouched:
 * this operation never records or alters `safety_review_state`, and a versioned
 * control cannot be deleted out from under a published version because the
 * version FK is ON DELETE RESTRICT.
 */
async function setSafetyControls(templateId, safetyControls, { actorUserId, organizationId = null } = {}) {
  return withTransaction(async (conn) => {
    const actor = await resolveActor(conn, actorUserId);
    const row = await loadDefinitionRowForAuthoring(conn, templateId, organizationId);
    assertAuthorable(row);
    assertActorMayOwn(actor, row.organization_id);
    assertDraft(row);

    assertValid(validateSafetyControls(safetyControls));
    await writeSafetyControls(conn, row.id, safetyControls);
    void actor;
    return row.id;
  }).then((id) => loadAuthoredDefinition(id, { organizationId }));
}

// ---------------------------------------------------------------------------
// Internal writers — explicit, scoped SQL inside the caller's transaction
//
// Deliberately not BaseModel.update/delete: those are `WHERE id = ?` only, with
// no validation, no lifecycle guard and no tenant scoping, and making them more
// powerful for governed knowledge would be the wrong direction.
// ---------------------------------------------------------------------------

async function writeSteps(conn, templateId, steps) {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepNo = step.step_no === undefined || step.step_no === null
      ? index + 1
      : asPositiveInt(step.step_no);

    const options = step.options === undefined || step.options === null
      ? null
      : JSON.stringify(step.options);

    await conn.query(
      `INSERT INTO task_template_steps (
         task_template_id, step_no, step_type, activity_code_id, instruction,
         data_type, expected_value, min_value, max_value, unit, is_required, options,
         safety_note, is_visual_only, requires_equipment_stopped,
         prohibit_if_running, prohibit_opening_covers
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15,
         $16, $17
       )`,
      [
        templateId,
        stepNo,
        trimOrNull(step.step_type),
        step.activity_code_id === undefined ? null : asPositiveInt(step.activity_code_id),
        trimOrNull(step.instruction),
        trimOrNull(step.data_type),
        step.expected_value === undefined ? null : trimOrNull(String(step.expected_value)),
        asNullableNumber(step.min_value),
        asNullableNumber(step.max_value),
        trimOrNull(step.unit),
        step.is_required === undefined || step.is_required === null ? true : step.is_required,
        options,
        trimOrNull(step.safety_note),
        step.is_visual_only === undefined || step.is_visual_only === null ? false : step.is_visual_only,
        step.requires_equipment_stopped === undefined || step.requires_equipment_stopped === null
          ? false : step.requires_equipment_stopped,
        step.prohibit_if_running === undefined || step.prohibit_if_running === null
          ? false : step.prohibit_if_running,
        step.prohibit_opening_covers === undefined || step.prohibit_opening_covers === null
          ? false : step.prohibit_opening_covers
      ]
    );
  }
}

async function writeSafetyControls(conn, templateId, safetyControls) {
  if (!Array.isArray(safetyControls)) return;
  await conn.query(
    `DELETE FROM task_template_safety_controls WHERE task_template_id = $1`, [templateId]
  );
  for (const control of safetyControls) {
    await conn.query(
      `INSERT INTO task_template_safety_controls (task_template_id, safety_type, description, is_mandatory)
       VALUES ($1, $2, $3, $4)`,
      [
        templateId,
        trimOrNull(control.safety_type),
        trimOrNull(control.description),
        control.is_mandatory === undefined || control.is_mandatory === null ? false : control.is_mandatory
      ]
    );
  }
}

async function writeApplicability(conn, templateId, applicability, actorUserId) {
  if (!Array.isArray(applicability)) return;
  await conn.query(
    `DELETE FROM task_template_equipment_types WHERE task_template_id = $1`, [templateId]
  );
  for (const entry of applicability) {
    await conn.query(
      `INSERT INTO task_template_equipment_types
         (task_template_id, equipment_type_id, is_primary, added_by_user_id)
       VALUES ($1, $2, $3, $4)`,
      [
        templateId,
        asPositiveInt(entry.equipment_type_id),
        entry.is_primary === true,
        actorUserId
      ]
    );
  }
}

module.exports = {
  createAuthoredDefinition,
  loadAuthoredDefinition,
  updateGovernedDraft,
  setApplicability,
  replaceSteps,
  setSafetyControls,
  describeDraftCompleteness,
  AuthoringValidationError,
  AuthoringConflictError,
  AuthoringNotFoundError,
  MAINTENANCE_STRATEGIES,
  TRIGGER_MECHANISMS,
  TRIGGER_CONDITION_OPERATORS,
  ASSIGNABLE_KNOWLEDGE_SCOPES,
  PRIORITIES,
  AUTHORED_CONTENT_ORIGIN
};
