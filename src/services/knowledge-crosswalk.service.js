/**
 * Governed External Classification Crosswalk Service
 *
 * ATM-001 M5R.3E — domain rules for the governed crosswalk application layer.
 *
 * This module holds VALIDATION and DERIVATION only. It performs no database
 * access: the model layer owns persistence, exactly as the M3 provenance split
 * does. Keeping the rules here means the same rules apply to every caller and
 * can be tested without a database.
 *
 * The two governing facts this layer refuses to conflate (M5R.3 sections H.1,
 * H.3, P):
 *
 *   review_state     "Has this conclusion been GOVERNED?"
 *   mapping_outcome  "What engineering conclusion was REACHED?"
 *
 * They are separate dimensions, so `approved + NO_DIRECT_MAPPING` is a
 * first-class positive finding rather than a pseudo-state. `lifecycle` is a
 * DERIVED convenience label for the seven caller-visible states; it never
 * replaces those two columns, and "never investigated" is represented by the
 * ABSENCE of a row, never by a row containing nulls.
 */

const REVIEW_STATES = Object.freeze(['draft', 'under_review', 'approved', 'rejected']);

/** The four governed relationships (section H.2: four, not six). */
const RELATIONSHIPS = Object.freeze([
  'DIRECT_EQUIVALENT',
  'RELATED_TO',
  'BROADER_THAN',
  'NARROWER_THAN'
]);

/** The four relationships plus the NO_DIRECT_MAPPING outcome. */
const MAPPING_OUTCOMES = Object.freeze([...RELATIONSHIPS, 'NO_DIRECT_MAPPING']);

/** Mirrors chk_equipment_type_external_classification_evidence_confidence (migration 018). */
const CONFIDENCE_LEVELS = Object.freeze(['established', 'provisional', 'experimental', 'uncertain']);

/** Mirrors chk_equipment_type_external_classification_evidence_role (migration 018). */
const SUPPORTING_ROLES = Object.freeze(['primary', 'supporting']);

/**
 * The seven caller-visible states of a crosswalk proposition.
 *
 * NEVER_INVESTIGATED is deliberately listed here even though no row carries it:
 * it is the state of a (equipment type, authority edition) pair with no
 * crosswalk row at all, and callers must be able to name it.
 */
const LIFECYCLE = Object.freeze({
  NEVER_INVESTIGATED: 'never_investigated',
  PROPOSED: 'proposed',
  IN_REVIEW: 'in_review',
  APPROVED_MAPPING: 'approved_mapping',
  APPROVED_NO_DIRECT_MAPPING: 'approved_no_direct_mapping',
  REJECTED: 'rejected',
  SUPERSEDED: 'superseded'
});

const MAX_NOTE_LENGTH = 4000;
const MAX_LOCATOR_LENGTH = 255;

/** Structured validation failure carrying every reason, not just the first. */
class KnowledgeCrosswalkValidationError extends Error {
  constructor(failures) {
    super(`Crosswalk validation failed: ${failures.map((f) => f.rule).join(', ')}`);
    this.name = 'KnowledgeCrosswalkValidationError';
    this.statusCode = 400;
    this.code = 'CROSSWALK_VALIDATION_FAILED';
    this.failures = failures;
  }
}

const failure = (rule, message, detail) => ({
  rule,
  message,
  ...(detail === undefined ? {} : { detail })
});

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

/** A positive integer id, or null when absent/invalid. */
function parsePositiveInt(value) {
  if (isBlank(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function checkOptionalEnum(failures, value, allowed, rule, field, label) {
  if (value === undefined || value === null) return;
  if (!allowed.includes(value)) {
    failures.push(failure(rule, `${label} must be one of: ${allowed.join(', ')}`, { field, value }));
  }
}

/**
 * Validate the proposition itself: outcome, classification and relationship
 * coherence, applicability and confidence.
 *
 * The OUTCOME is authoritative. Migration 017's `relationship` column is a
 * constrained mirror of it (the coherence CHECK requires
 * `relationship = mapping_outcome` for a mapped row and NULL for
 * NO_DIRECT_MAPPING), so the application layer derives it rather than asking a
 * caller to restate it. A caller that nevertheless supplies a relationship is
 * held to it, so an incoherent payload is refused instead of silently corrected.
 *
 * This mirrors the NORMATIVE database CHECK from migration 017 so an author gets
 * an actionable 400 instead of a raw constraint violation. The CHECK remains the
 * real enforcement; this is the same rule expressed earlier and more legibly.
 */
function validateProposition(failures, input = {}) {
  const hasClassification = !isBlank(input.externalClassificationId);

  if (isBlank(input.mappingOutcome)) {
    failures.push(failure(
      'CROSSWALK_OUTCOME_REQUIRED',
      'mappingOutcome is required: a crosswalk row states a conclusion, never a placeholder',
      { field: 'mappingOutcome' }
    ));
    return;
  }

  if (!MAPPING_OUTCOMES.includes(input.mappingOutcome)) {
    failures.push(failure(
      'CROSSWALK_OUTCOME_INVALID',
      `mappingOutcome must be one of: ${MAPPING_OUTCOMES.join(', ')}`,
      { field: 'mappingOutcome', value: input.mappingOutcome }
    ));
    return;
  }

  const isNoDirectMapping = input.mappingOutcome === 'NO_DIRECT_MAPPING';

  if (isNoDirectMapping) {
    if (hasClassification) {
      failures.push(failure(
        'CROSSWALK_NDM_HAS_CLASSIFICATION',
        'NO_DIRECT_MAPPING must not carry an external classification: '
          + 'absence of a mapping is never represented as a fabricated concept',
        { field: 'externalClassificationId' }
      ));
    }
    if (!isBlank(input.relationship)) {
      failures.push(failure(
        'CROSSWALK_NDM_HAS_RELATIONSHIP',
        'NO_DIRECT_MAPPING must not carry a relationship; it is an outcome, not a relationship',
        { field: 'relationship' }
      ));
    }
    return;
  }

  // A mapped outcome.
  if (!hasClassification) {
    failures.push(failure(
      'CROSSWALK_MAPPING_REQUIRES_CLASSIFICATION',
      'a mapped outcome must reference the external classification it relates to',
      { field: 'externalClassificationId' }
    ));
  } else if (parsePositiveInt(input.externalClassificationId) === null) {
    failures.push(failure(
      'CROSSWALK_CLASSIFICATION_INVALID',
      'externalClassificationId must be a positive integer',
      { field: 'externalClassificationId', value: input.externalClassificationId }
    ));
  }

  if (!RELATIONSHIPS.includes(input.mappingOutcome)) {
    failures.push(failure(
      'CROSSWALK_RELATIONSHIP_INVALID',
      `a mapped outcome must be one of: ${RELATIONSHIPS.join(', ')}`,
      { field: 'mappingOutcome', value: input.mappingOutcome }
    ));
  }

  if (!isBlank(input.relationship) && input.relationship !== input.mappingOutcome) {
    failures.push(failure(
      'CROSSWALK_RELATIONSHIP_MISMATCH',
      'relationship and mapping_outcome must agree for a mapped row',
      { relationship: input.relationship, mappingOutcome: input.mappingOutcome }
    ));
  }
}

/** Applicability is INDUSTRY ONLY for V1 (M5R.3 section R / AI item 3). */
function validateApplicability(failures, input = {}) {
  const industryId = parsePositiveInt(input.applicabilityIndustryId);
  if (!isBlank(input.applicabilityIndustryId) && industryId === null) {
    failures.push(failure(
      'CROSSWALK_APPLICABILITY_INVALID',
      'applicabilityIndustryId must be a positive integer',
      { field: 'applicabilityIndustryId', value: input.applicabilityIndustryId }
    ));
  }
  if (!isBlank(input.applicabilityNote) && String(input.applicabilityNote).length > MAX_NOTE_LENGTH) {
    failures.push(failure(
      'CROSSWALK_APPLICABILITY_NOTE_TOO_LONG',
      `applicability_note must be at most ${MAX_NOTE_LENGTH} characters`,
      { field: 'applicabilityNote' }
    ));
  }
}

/** Confidence, supporting role and the AI-assistance attribution boundary. */
function validateAssertion(failures, input = {}) {
  checkOptionalEnum(failures, input.confidenceLevel, CONFIDENCE_LEVELS,
    'CROSSWALK_CONFIDENCE_INVALID', 'confidenceLevel', 'confidence_level');
  checkOptionalEnum(failures, input.supportingRole, SUPPORTING_ROLES,
    'CROSSWALK_ROLE_INVALID', 'supportingRole', 'supporting_role');

  if (input.aiAssisted !== undefined && typeof input.aiAssisted !== 'boolean') {
    failures.push(failure(
      'CROSSWALK_AI_FLAG_INVALID',
      'aiAssisted must be a boolean',
      { field: 'aiAssisted', value: input.aiAssisted }
    ));
  }

  // ai_assistance_detail is a JSONB column. An AI-assisted row must say what was
  // assisted, and a non-AI row must not carry AI detail: the two are a single
  // attribution fact and must not contradict each other.
  if (input.aiAssistanceDetail !== undefined
    && input.aiAssistanceDetail !== null
    && typeof input.aiAssistanceDetail !== 'object') {
    failures.push(failure(
      'CROSSWALK_AI_DETAIL_INVALID',
      'aiAssistanceDetail must be an object when supplied',
      { field: 'aiAssistanceDetail' }
    ));
  }
  if (input.aiAssisted === true && isBlank(input.aiAssistanceDetail)) {
    failures.push(failure(
      'CROSSWALK_AI_DETAIL_REQUIRED',
      'an AI-assisted proposal must record what was AI-assisted',
      { field: 'aiAssistanceDetail' }
    ));
  }
}

/**
 * Validate a NEW proposal.
 *
 * equipment_type_id and knowledge_source_version_id are required here and are
 * NOT editable afterwards: a different subject or a different investigated
 * edition is a NEW proposition (M5R.3 section J: a new edition produces a new
 * row), not an edit of the old one.
 */
function validateProposalInput(input = {}) {
  const failures = [];

  if (parsePositiveInt(input.equipmentTypeId) === null) {
    failures.push(failure(
      'CROSSWALK_EQUIPMENT_TYPE_REQUIRED',
      'equipmentTypeId must be the positive id of the Atiman equipment type',
      { field: 'equipmentTypeId' }
    ));
  }
  if (parsePositiveInt(input.knowledgeSourceVersionId) === null) {
    failures.push(failure(
      'CROSSWALK_SOURCE_VERSION_REQUIRED',
      'knowledgeSourceVersionId must name the exact external authority edition investigated',
      { field: 'knowledgeSourceVersionId' }
    ));
  }

  validateProposition(failures, input);
  validateApplicability(failures, input);
  validateAssertion(failures, input);

  return failures;
}

/**
 * Validate an EDIT of a draft proposition — PAYLOAD SHAPE ONLY.
 *
 * Cross-field coherence is deliberately NOT checked here, because a partial edit
 * is not a complete proposition: changing only the outcome of an existing mapped
 * draft must be judged against the row's CURRENT classification, not against an
 * absent payload field. The model therefore loads the draft, merges the edit over
 * it, and validates the MERGED state with `validatePropositionCoherence`.
 *
 * The subject (equipment type) and the investigated edition are deliberately not
 * editable: changing either produces a different proposition, and M5R.3 section J
 * requires a new row for a new edition so that history cannot be rewritten in
 * place. The status fields, the attribution and the supersession pointer are
 * likewise unreachable here — they move only through the governed operations.
 */
function validateDraftEditInput(input = {}) {
  const failures = [];

  const editable = [
    'mappingOutcome', 'relationship', 'externalClassificationId',
    'applicabilityIndustryId', 'applicabilityNote',
    'confidenceLevel', 'supportingRole', 'aiAssisted', 'aiAssistanceDetail'
  ];
  if (!editable.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
    failures.push(failure(
      'CROSSWALK_EDIT_EMPTY',
      `a draft edit must change at least one of: ${editable.join(', ')}`
    ));
  }

  if (Object.prototype.hasOwnProperty.call(input, 'mappingOutcome')
    && !isBlank(input.mappingOutcome)
    && !MAPPING_OUTCOMES.includes(input.mappingOutcome)) {
    failures.push(failure(
      'CROSSWALK_OUTCOME_INVALID',
      `mappingOutcome must be one of: ${MAPPING_OUTCOMES.join(', ')}`,
      { field: 'mappingOutcome', value: input.mappingOutcome }
    ));
  }

  if (Object.prototype.hasOwnProperty.call(input, 'externalClassificationId')
    && !isBlank(input.externalClassificationId)
    && parsePositiveInt(input.externalClassificationId) === null) {
    failures.push(failure(
      'CROSSWALK_CLASSIFICATION_INVALID',
      'externalClassificationId must be a positive integer',
      { field: 'externalClassificationId', value: input.externalClassificationId }
    ));
  }

  validateApplicability(failures, input);
  validateAssertion(failures, input);

  return failures;
}

/**
 * Validate that a COMPLETE proposition is coherent.
 *
 * Called with the payload for a new proposal, and with the row-plus-edit MERGED
 * state for a draft edit, so the same rule governs both paths. `relationship` is
 * optional: the outcome is authoritative and the mirror column is derived.
 */
function validatePropositionCoherence(proposition = {}) {
  const failures = [];
  validateProposition(failures, {
    mappingOutcome: proposition.mappingOutcome,
    externalClassificationId: proposition.externalClassificationId,
    relationship: proposition.relationship
  });
  return failures;
}

/**
 * Validate RELATIONSHIP evidence attached to a crosswalk.
 *
 * The crosswalk is the subject and is taken from the route, so the payload can
 * never set two subjects. Concept evidence (external_classification_id) is NOT
 * reachable through this path: M5R.3 section P keeps the two propositions apart,
 * and section AC exposes only crosswalk-scoped evidence attachment.
 */
function validateCrosswalkEvidenceInput(input = {}) {
  const failures = [];

  if (parsePositiveInt(input.knowledgeSourceVersionId) === null) {
    failures.push(failure(
      'EVIDENCE_SOURCE_VERSION_REQUIRED',
      'evidence must reference an immutable knowledge source version, not a mutable source',
      { field: 'knowledgeSourceVersionId' }
    ));
  }

  checkOptionalEnum(failures, input.confidenceLevel, CONFIDENCE_LEVELS,
    'EVIDENCE_CONFIDENCE_INVALID', 'confidenceLevel', 'confidence_level');
  checkOptionalEnum(failures, input.supportingRole, SUPPORTING_ROLES,
    'EVIDENCE_ROLE_INVALID', 'supportingRole', 'supporting_role');

  for (const [field, label] of [['sectionOrClause', 'section_or_clause'], ['pageOrParagraph', 'page_or_paragraph']]) {
    if (!isBlank(input[field]) && String(input[field]).length > MAX_LOCATOR_LENGTH) {
      failures.push(failure(
        'EVIDENCE_LOCATOR_TOO_LONG',
        `${label} must be at most ${MAX_LOCATOR_LENGTH} characters`,
        { field }
      ));
    }
  }

  if (isBlank(input.sectionOrClause) && isBlank(input.pageOrParagraph) && isBlank(input.derivationNotes)) {
    failures.push(failure(
      'EVIDENCE_ATTRIBUTION_INCOMPLETE',
      'evidence must state where in the source it is derived from '
        + '(section_or_clause, page_or_paragraph, or derivation_notes)'
    ));
  }

  return failures;
}

/** Throw when a validation produced failures. */
function assertValid(failures) {
  if (failures.length > 0) {
    throw new KnowledgeCrosswalkValidationError(failures);
  }
}

/**
 * Derive the caller-visible lifecycle label from a crosswalk row.
 *
 * `superseded` takes precedence over `approved_*`: a superseded row is retained
 * history, not current truth. The underlying columns are never collapsed — this
 * is an additional, derived label.
 *
 * @param {Object|null} row
 * @returns {string|null} null when there is no row (never investigated)
 */
function deriveLifecycle(row) {
  if (!row) return null;
  if (row.review_state === 'approved') {
    if (row.superseded_by_crosswalk_id !== null && row.superseded_by_crosswalk_id !== undefined) {
      return LIFECYCLE.SUPERSEDED;
    }
    return row.mapping_outcome === 'NO_DIRECT_MAPPING'
      ? LIFECYCLE.APPROVED_NO_DIRECT_MAPPING
      : LIFECYCLE.APPROVED_MAPPING;
  }
  if (row.review_state === 'under_review') return LIFECYCLE.IN_REVIEW;
  if (row.review_state === 'rejected') return LIFECYCLE.REJECTED;
  return LIFECYCLE.PROPOSED;
}

module.exports = {
  REVIEW_STATES,
  RELATIONSHIPS,
  MAPPING_OUTCOMES,
  CONFIDENCE_LEVELS,
  SUPPORTING_ROLES,
  LIFECYCLE,
  MAX_NOTE_LENGTH,
  MAX_LOCATOR_LENGTH,
  KnowledgeCrosswalkValidationError,
  failure,
  parsePositiveInt,
  validateProposalInput,
  validateDraftEditInput,
  validatePropositionCoherence,
  validateCrosswalkEvidenceInput,
  assertValid,
  deriveLifecycle
};
