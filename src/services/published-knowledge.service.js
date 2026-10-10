/**
 * Published Knowledge Resolution — read-only service (ATM-001-KF-04A)
 *
 * Turns the immutable published-version read model into an operational contract.
 * It decides nothing about publication: it only refuses anything that is not an
 * already-published, already-sealed, in-scope immutable version, and it never
 * falls back to the mutable working definition.
 *
 * Fail-closed rules enforced here:
 *   1. The version must exist                        -> 404 (non-disclosing)
 *   2. The version must be in the caller's scope     -> 404 (non-disclosing)
 *      (global `organization_id IS NULL`, or the caller's tenant). A scope
 *      that is MISSING or malformed fails closed: only an explicit database
 *      NULL is global, so an absent column cannot widen a tenant read.
 *   3. `lifecycle_state_at_publish` must be          -> 409 PUBLISHED_VERSION_NOT_CURRENT
 *      `published` (superseded/retired are refused, and a draft cannot
 *      reach this table at all)
 *   4. The step set must be sealed and non-empty     -> 409 PUBLISHED_VERSION_INCOMPLETE
 *
 * Deliberate non-behaviour: there is no implicit "current"/"latest" selection.
 * ATM-001 §8.2 fixes the rule that *operational references point to a specific
 * published version*, and §8.3 reserves `effective_from`/`effective_to` for an
 * "active default" that the schema does not implement. Choosing one here would
 * introduce an unapproved business rule, so callers select explicitly.
 *
 * Historical reads of `superseded`/`retired` rows (ATM-001 §8.2 "historical
 * versions remain readable") are intentionally NOT served by this operational
 * resolver; they are the subject of the separate historical-attribution
 * workstream (KF-04B). This resolver answers only "what may be used now".
 */

const {
  PublishedKnowledge,
  PUBLISHED_LIFECYCLE_STATE
} = require('../models/published-knowledge.model');

/** Caller supplied an unusable identifier. */
class PublishedKnowledgeValidationError extends Error {
  constructor(message, failures = []) {
    super(message);
    this.name = 'PublishedKnowledgeValidationError';
    this.statusCode = 400;
    this.code = 'PUBLISHED_KNOWLEDGE_VALIDATION_FAILED';
    this.failures = failures;
  }
}

/** Nothing readable at that identity, in this scope. Non-disclosing. */
class PublishedKnowledgeNotFoundError extends Error {
  constructor(message = 'Published knowledge version not found') {
    super(message);
    this.name = 'PublishedKnowledgeNotFoundError';
    this.statusCode = 404;
    this.code = 'PUBLISHED_VERSION_NOT_FOUND';
  }
}

/** The identity exists in scope but is not servable as current guidance. */
class PublishedKnowledgeConflictError extends Error {
  constructor(message, code = 'PUBLISHED_VERSION_NOT_CURRENT') {
    super(message);
    this.name = 'PublishedKnowledgeConflictError';
    this.statusCode = 409;
    this.code = code;
  }
}

/**
 * Upper bound of a PostgreSQL `integer` (int4) column.
 *
 * A larger value cannot be a valid primary key, and passing one to the driver
 * raises SQLSTATE 22003 ("value ... is out of range for type integer"), which
 * would otherwise surface as an unhandled 500 carrying the raw database
 * message. Identifiers are therefore bounded HERE, before the database is
 * touched.
 */
const MAX_POSTGRES_INTEGER = 2147483647;

/**
 * Strict positive-identifier parse for route parameters.
 *
 * Deliberately NOT `parseInt`. `parseInt` silently accepts and truncates
 * malformed input ("17.9" -> 17, "1abc" -> 1, "1e3" -> 1, "1 OR 1=1" -> 1),
 * which both violates the "invalid identifier => 400" contract and hides caller
 * mistakes. This accepts only a plain unsigned decimal integer within the
 * PostgreSQL `integer` range:
 *
 *   - digits only: no sign, whitespace, decimal point, exponent or suffix;
 *   - a safe JS integer, so an arbitrarily long digit string cannot silently
 *     round into a different, in-range value;
 *   - 1 <= value <= 2147483647.
 *
 * @returns {number|null} the identifier, or null when it is not well formed.
 */
const toPositiveInt = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value);
  if (!/^[0-9]+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return null;
  if (parsed < 1 || parsed > MAX_POSTGRES_INTEGER) return null;
  return parsed;
};

/** Human-readable identifier requirement, shared by the three endpoints. */
const IDENTIFIER_REQUIREMENT =
  'must be a positive integer within the PostgreSQL INTEGER range (1-2147483647)';

/**
 * Canonical organization scope id, or null when the value is not a valid scope.
 *
 * Accepts a positive integer or a plain decimal integer string (a PostgreSQL
 * `integer` column may be returned as either). `0`, negatives, fractions,
 * booleans, blanks and non-numeric strings are rejected rather than coerced into
 * a value that could compare equal to a real tenant.
 */
const toScopeId = (value) => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
};

/**
 * A row is in scope when its FROZEN organization scope is EXPLICITLY global
 * (database NULL) or EXPLICITLY the caller's tenant.
 *
 * Fail closed, never open: only an explicit database NULL is global. Migration
 * 020 models shared reference knowledge as `organization_id IS NULL`, and
 * `chk_task_template_versions_scope_organization` binds a non-null scope to a
 * real organization — so a scope that is MISSING or malformed is never global.
 * An absent column must not widen a tenant read; a caller with no tenant scope
 * therefore sees only global knowledge.
 */
const isInScope = (row, organizationId) => {
  if (row.organization_id === null) return true;
  const scope = toScopeId(row.organization_id);
  if (scope === null) return false;
  return scope === toScopeId(organizationId);
};

const isPublished = (row) => row.lifecycle_state_at_publish === PUBLISHED_LIFECYCLE_STATE;

/**
 * Refuse anything that is not an immutable, sealed, published version.
 * Exposed for tests and for reuse by operational consumers.
 */
function assertServableVersion(header) {
  if (!isPublished(header)) {
    throw new PublishedKnowledgeConflictError(
      `Knowledge version ${header.id} is '${header.lifecycle_state_at_publish}' and is not current `
        + 'published guidance; it must not be served for operational use',
      'PUBLISHED_VERSION_NOT_CURRENT'
    );
  }
  if (header.is_step_set_sealed !== true) {
    throw new PublishedKnowledgeConflictError(
      `Knowledge version ${header.id} is published but its step set is not sealed; refusing to serve `
        + 'an incomplete immutable record',
      'PUBLISHED_VERSION_INCOMPLETE'
    );
  }
}

/** Public, operational projection of a frozen version header. No hashes. */
function toVersionDto(header) {
  return {
    id: Number(header.id),
    taskTemplateId: Number(header.task_template_id),
    versionNumber: Number(header.version_number),
    templateCode: header.template_code,
    templateName: header.template_name,
    equipmentTypeId: Number(header.equipment_type_id),
    maintenanceType: header.maintenance_type,
    taskScope: header.task_scope,
    description: header.description,
    priority: header.priority,
    taskKind: header.task_kind,
    frequency: {
      value: header.frequency_value === null ? null : Number(header.frequency_value),
      unit: header.frequency_unit
    },
    estimatedDurationMinutes: header.estimated_duration_minutes === null
      ? null
      : Number(header.estimated_duration_minutes),
    requiredSkills: header.required_skills,
    requiredTools: header.required_tools,
    lifecycleState: header.lifecycle_state_at_publish,
    isStepSetSealed: header.is_step_set_sealed === true,
    publishedAt: header.published_at,
    supersededByVersionId: header.superseded_by_version_id === null
      ? null
      : Number(header.superseded_by_version_id),
    changeRationale: header.change_rationale,
    knowledgeScope: header.knowledge_scope,
    organizationScope: header.organization_id === null ? 'global' : 'tenant',
    governedClassification: {
      knowledgeTypeId: header.knowledge_type_id === null ? null : Number(header.knowledge_type_id),
      taskFamilyId: header.task_family_id === null ? null : Number(header.task_family_id),
      maintenanceStrategy: header.maintenance_strategy
    },
    trigger: {
      mechanism: header.trigger_mechanism,
      conditionParameter: header.trigger_condition_parameter,
      conditionOperator: header.trigger_condition_operator,
      conditionValue: header.trigger_condition_value === null
        ? null
        : Number(header.trigger_condition_value),
      conditionUnit: header.trigger_condition_unit,
      conditionContext: header.trigger_condition_context,
      eventDescription: header.trigger_event_description,
      basisSourceVersionId: header.trigger_basis_source_version_id === null
        ? null
        : Number(header.trigger_basis_source_version_id)
    },
    // Disclosure is frozen on the version, never recomputed from the working
    // definition. NULL is preserved as NULL (never coerced to false).
    aiAssisted: header.ai_assisted,
    aiAssistanceDetail: header.ai_assistance_detail,
    safetyReview: {
      state: header.safety_review_state,
      reviewedAt: header.safety_reviewed_at,
      reviewedByUserId: header.safety_reviewed_by_user_id === null
        ? null
        : Number(header.safety_reviewed_by_user_id)
    },
    governance: {
      reviewerUserId: header.reviewer_user_id === null ? null : Number(header.reviewer_user_id),
      reviewedAt: header.reviewed_at,
      approverUserId: header.approver_user_id === null ? null : Number(header.approver_user_id),
      approvedAt: header.approved_at
    }
  };
}

function toStepDto(step) {
  return {
    id: Number(step.id),
    stepNo: Number(step.step_no),
    sourceStepId: Number(step.task_template_step_id),
    stepType: step.step_type,
    activityCodeId: step.activity_code_id === null ? null : Number(step.activity_code_id),
    instruction: step.instruction,
    dataType: step.data_type,
    expectedValue: step.expected_value,
    minValue: step.min_value === null ? null : Number(step.min_value),
    maxValue: step.max_value === null ? null : Number(step.max_value),
    unit: step.unit,
    isRequired: step.is_required === true,
    options: step.options,
    safetyNote: step.safety_note,
    isVisualOnly: step.is_visual_only === true,
    requiresEquipmentStopped: step.requires_equipment_stopped === true,
    prohibitIfRunning: step.prohibit_if_running === true,
    prohibitOpeningCovers: step.prohibit_opening_covers === true,
    aiAssisted: step.ai_assisted,
    aiAssistanceDetail: step.ai_assistance_detail
  };
}

function toEvidenceDto(e) {
  return {
    id: Number(e.id),
    subject: e.task_template_step_version_id === null ? 'version' : 'step',
    stepVersionId: e.task_template_step_version_id === null
      ? null
      : Number(e.task_template_step_version_id),
    knowledgeSourceVersionId: Number(e.knowledge_source_version_id),
    sourceCode: e.source_code,
    sourceCategory: e.source_category,
    sourceTitle: e.source_title,
    issuingOrganization: e.issuing_organization,
    versionDesignation: e.version_designation,
    sourceVersionTitle: e.source_version_title,
    sourceVersionReference: e.source_version_reference,
    sectionOrClause: e.section_or_clause,
    pageOrParagraph: e.page_or_paragraph,
    derivationNotes: e.derivation_notes,
    confidenceLevel: e.confidence_level,
    supportingRole: e.supporting_role
  };
}

const toVersionSummary = (row) => ({
  id: Number(row.id),
  taskTemplateId: Number(row.task_template_id),
  versionNumber: Number(row.version_number),
  templateCode: row.template_code,
  templateName: row.template_name,
  equipmentTypeId: Number(row.equipment_type_id),
  lifecycleState: row.lifecycle_state_at_publish,
  isStepSetSealed: row.is_step_set_sealed === true,
  publishedAt: row.published_at,
  supersededByVersionId: row.superseded_by_version_id === null
    ? null
    : Number(row.superseded_by_version_id),
  knowledgeScope: row.knowledge_scope,
  organizationScope: row.organization_id === null ? 'global' : 'tenant',
  isPrimaryApplicability: row.is_primary === undefined ? undefined : row.is_primary === true
});

/**
 * Resolve ONE explicitly identified published, sealed, in-scope version and
 * return its frozen content. Never falls back to the working definition.
 *
 * @param {number|string} versionId
 * @param {{organizationId?: number|null}} scope
 */
async function resolvePublishedVersion(versionId, { organizationId = null } = {}) {
  const id = toPositiveInt(versionId);
  if (!id) {
    throw new PublishedKnowledgeValidationError('A positive knowledge version id is required', [
      { field: 'versionId', message: IDENTIFIER_REQUIREMENT }
    ]);
  }

  const header = await PublishedKnowledge.findVersionHeader(id);
  if (!header || !isInScope(header, organizationId)) {
    // Not-found rather than forbidden: scope is never disclosed.
    throw new PublishedKnowledgeNotFoundError();
  }

  assertServableVersion(header);

  const [steps, safetyControls, applicability, evidence] = await Promise.all([
    PublishedKnowledge.listVersionSteps(id),
    PublishedKnowledge.listVersionSafetyControls(id),
    PublishedKnowledge.listVersionApplicability(id),
    // Evidence sources are scoped to the caller, so a globally readable version
    // can never disclose another tenant's private source identity.
    PublishedKnowledge.listVersionEvidence(id, toScopeId(organizationId))
  ]);

  if (steps.length === 0) {
    throw new PublishedKnowledgeConflictError(
      `Knowledge version ${id} has no frozen step set; refusing to serve an incomplete immutable record`,
      'PUBLISHED_VERSION_INCOMPLETE'
    );
  }

  return {
    version: toVersionDto(header),
    steps: steps.map(toStepDto),
    safetyControls: safetyControls.map((c) => ({
      id: Number(c.id),
      safetyType: c.safety_type,
      description: c.description,
      isMandatory: c.is_mandatory === true
    })),
    applicability: applicability.map((a) => ({
      equipmentTypeId: Number(a.equipment_type_id),
      typeCode: a.type_code,
      typeName: a.type_name,
      isPrimary: a.is_primary === true
    })),
    evidence: evidence.map(toEvidenceDto)
  };
}

/** Published, sealed, in-scope versions of a working definition (explicit selection). */
async function listPublishedVersionsForTemplate(templateId, { organizationId = null } = {}) {
  const id = toPositiveInt(templateId);
  if (!id) {
    throw new PublishedKnowledgeValidationError('A positive task template id is required', [
      { field: 'templateId', message: IDENTIFIER_REQUIREMENT }
    ]);
  }
  // A malformed caller scope must not reach SQL as a raw value: it is normalized
  // to NULL, which the list predicate reads as "global rows only" — the same
  // fail-closed answer isInScope gives, rather than a driver-level type error.
  const rows = await PublishedKnowledge.listPublishedVersionsForTemplate(id, toScopeId(organizationId));
  return rows.map(toVersionSummary);
}

/** Published, sealed, in-scope versions whose frozen applicability covers a Type. */
async function listPublishedVersionsForEquipmentType(equipmentTypeId, { organizationId = null } = {}) {
  const id = toPositiveInt(equipmentTypeId);
  if (!id) {
    throw new PublishedKnowledgeValidationError('A positive equipment type id is required', [
      { field: 'equipmentTypeId', message: IDENTIFIER_REQUIREMENT }
    ]);
  }
  const rows = await PublishedKnowledge.listPublishedVersionsForEquipmentType(id, toScopeId(organizationId));
  return rows.map(toVersionSummary);
}

module.exports = {
  resolvePublishedVersion,
  listPublishedVersionsForTemplate,
  listPublishedVersionsForEquipmentType,
  assertServableVersion,
  isInScope,
  toPositiveInt,
  MAX_POSTGRES_INTEGER,
  PublishedKnowledgeValidationError,
  PublishedKnowledgeNotFoundError,
  PublishedKnowledgeConflictError
};
