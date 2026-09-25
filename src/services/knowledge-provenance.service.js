/**
 * Knowledge Provenance Service
 *
 * ATM-001 M3 — governed provenance authoring.
 *
 * Responsibility: validate provenance authoring input against the schema
 * invariants that migration 011 already established. Pure functions only; the
 * database access lives in src/models/knowledge-provenance.model.js, mirroring
 * the M1 split between validation and persistence.
 *
 * This service deliberately does NOT redefine provenance. Migration 011 is the
 * provenance model:
 *   knowledge_sources                  stable source identity
 *   knowledge_source_versions          immutable exact revision / citation
 *   knowledge_template_evidence        editable WORKING provenance
 *   knowledge_template_version_evidence frozen PUBLISHED provenance
 *
 * M3 exposes an authoring path over that model. It adds no new provenance
 * concept, and it never mutates frozen evidence.
 */

// Mirrors chk_knowledge_sources_source_category in migration 011.
const SOURCE_CATEGORIES = Object.freeze([
  'manufacturer_manual',
  'engineering_standard',
  'internal_standard',
  'regulatory_source',
  'legacy_migration',
  'engineering_authored'
]);

// Mirrors chk_knowledge_template_evidence_confidence in migration 011.
const CONFIDENCE_LEVELS = Object.freeze([
  'established',
  'provisional',
  'experimental',
  'uncertain'
]);

// Mirrors chk_knowledge_template_evidence_role in migration 011.
const SUPPORTING_ROLES = Object.freeze(['primary', 'supporting']);

const MAX_CODE_LENGTH = 100;
const MAX_TITLE_LENGTH = 500;
const MAX_VERSION_DESIGNATION_LENGTH = 100;
const MAX_REFERENCE_NUMBER_LENGTH = 255;
const MAX_LOCATOR_LENGTH = 255;

/** Structured validation failure carrying every reason, not just the first. */
class ProvenanceValidationError extends Error {
  constructor(failures) {
    super(`Provenance validation failed: ${failures.map((f) => f.rule).join(', ')}`);
    this.name = 'ProvenanceValidationError';
    this.statusCode = 400;
    this.code = 'PROVENANCE_VALIDATION_FAILED';
    this.failures = failures;
  }
}

const failure = (rule, message, detail) => ({
  rule,
  message,
  ...(detail === undefined ? {} : { detail })
});

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

/** A required, length-bounded string. Rejects blanks rather than coercing them. */
function checkRequiredString(failures, value, rule, field, label, maxLength) {
  if (isBlank(value)) {
    failures.push(failure(rule, `${label} is required`, { field }));
    return;
  }
  if (String(value).length > maxLength) {
    failures.push(failure(rule, `${label} must be at most ${maxLength} characters`, { field }));
  }
}

/** An optional enum field; an absent value is left to the schema default. */
function checkOptionalEnum(failures, value, allowed, rule, field, label) {
  if (value === undefined || value === null) return;
  if (!allowed.includes(value)) {
    failures.push(failure(rule, `${label} must be one of: ${allowed.join(', ')}`, { field, value }));
  }
}

/** An optional ISO date (YYYY-MM-DD), matching the DATE columns in migration 011. */
function checkOptionalDate(failures, value, rule, field, label) {
  if (value === undefined || value === null || value === '') return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    failures.push(failure(rule, `${label} must be an ISO date (YYYY-MM-DD)`, { field, value }));
  }
}

/**
 * Validate a knowledge source identity.
 *
 * organization_id is NOT accepted from the caller: it is always derived from the
 * authenticated principal, so a tenant can never create a global source.
 *
 * @param {Object} input
 * @returns {Array<Object>} failures (empty when valid)
 */
function validateSourceInput(input = {}) {
  const failures = [];

  checkRequiredString(failures, input.sourceCode, 'SOURCE_CODE_REQUIRED', 'sourceCode', 'source_code', MAX_CODE_LENGTH);
  checkRequiredString(failures, input.sourceCategory, 'SOURCE_CATEGORY_REQUIRED', 'sourceCategory', 'source_category', 50);
  checkRequiredString(failures, input.defaultTitle, 'SOURCE_TITLE_REQUIRED', 'defaultTitle', 'default_title', MAX_TITLE_LENGTH);

  if (isBlank(input.sourceCategory)) {
    // already reported; do not double-report the enum
  } else if (!SOURCE_CATEGORIES.includes(input.sourceCategory)) {
    failures.push(failure(
      'SOURCE_CATEGORY_INVALID',
      `source_category must be one of: ${SOURCE_CATEGORIES.join(', ')}`,
      { field: 'sourceCategory', value: input.sourceCategory }
    ));
  }

  if (!isBlank(input.issuingOrganization) && String(input.issuingOrganization).length > 255) {
    failures.push(failure(
      'SOURCE_ISSUING_ORGANIZATION_TOO_LONG',
      'issuing_organization must be at most 255 characters',
      { field: 'issuingOrganization' }
    ));
  }

  return failures;
}

/**
 * Validate an immutable source version.
 *
 * @param {Object} input
 * @returns {Array<Object>} failures (empty when valid)
 */
function validateSourceVersionInput(input = {}) {
  const failures = [];

  checkRequiredString(
    failures, input.versionDesignation, 'SOURCE_VERSION_DESIGNATION_REQUIRED',
    'versionDesignation', 'version_designation', MAX_VERSION_DESIGNATION_LENGTH
  );
  checkRequiredString(
    failures, input.title, 'SOURCE_VERSION_TITLE_REQUIRED',
    'title', 'title', MAX_TITLE_LENGTH
  );

  if (!isBlank(input.referenceNumber) && String(input.referenceNumber).length > MAX_REFERENCE_NUMBER_LENGTH) {
    failures.push(failure(
      'SOURCE_VERSION_REFERENCE_TOO_LONG',
      `reference_number must be at most ${MAX_REFERENCE_NUMBER_LENGTH} characters`,
      { field: 'referenceNumber' }
    ));
  }

  checkOptionalDate(failures, input.publicationDate, 'SOURCE_VERSION_PUBLICATION_DATE_INVALID', 'publicationDate', 'publication_date');
  checkOptionalDate(failures, input.effectiveDate, 'SOURCE_VERSION_EFFECTIVE_DATE_INVALID', 'effectiveDate', 'effective_date');

  // content_sha256 mirrors the varchar(64) column.
  if (!isBlank(input.contentSha256) && !/^[0-9a-fA-F]{64}$/.test(String(input.contentSha256))) {
    failures.push(failure(
      'SOURCE_VERSION_CONTENT_SHA_INVALID',
      'content_sha256 must be a 64-character hexadecimal sha256 digest',
      { field: 'contentSha256' }
    ));
  }

  // uploaded_file_id is intentionally NOT authorable through M3: M3 does not
  // build file storage. Attempting to set it is a scope violation.
  if (input.uploadedFileId !== undefined && input.uploadedFileId !== null) {
    failures.push(failure(
      'SOURCE_VERSION_FILE_UPLOAD_NOT_SUPPORTED',
      'uploaded_file_id is not authorable through this capability; M3 exposes provenance authoring only',
      { field: 'uploadedFileId' }
    ));
  }

  return failures;
}

/**
 * Validate a WORKING evidence association.
 *
 * Mirrors chk_knowledge_template_evidence_exactly_one_subject: evidence belongs
 * to either a working template or a working step, never both, never neither.
 *
 * @param {Object} input
 * @returns {Array<Object>} failures (empty when valid)
 */
function validateEvidenceInput(input = {}) {
  const failures = [];

  const hasTemplate = !isBlank(input.taskTemplateId);
  const hasStep = !isBlank(input.taskTemplateStepId);

  if (hasTemplate && hasStep) {
    failures.push(failure(
      'EVIDENCE_SUBJECT_AMBIGUOUS',
      'evidence must reference either a task template or a task template step, not both',
      { taskTemplateId: input.taskTemplateId, taskTemplateStepId: input.taskTemplateStepId }
    ));
  } else if (!hasTemplate && !hasStep) {
    failures.push(failure(
      'EVIDENCE_SUBJECT_REQUIRED',
      'evidence must reference a task template or a task template step'
    ));
  }

  if (isBlank(input.knowledgeSourceVersionId)) {
    failures.push(failure(
      'EVIDENCE_SOURCE_VERSION_REQUIRED',
      'evidence must reference an immutable knowledge source version, not a mutable source',
      { field: 'knowledgeSourceVersionId' }
    ));
  } else if (!Number.isInteger(Number(input.knowledgeSourceVersionId)) || Number(input.knowledgeSourceVersionId) <= 0) {
    failures.push(failure(
      'EVIDENCE_SOURCE_VERSION_INVALID',
      'knowledgeSourceVersionId must be a positive integer',
      { field: 'knowledgeSourceVersionId', value: input.knowledgeSourceVersionId }
    ));
  }

  checkOptionalEnum(failures, input.confidenceLevel, CONFIDENCE_LEVELS, 'EVIDENCE_CONFIDENCE_INVALID', 'confidenceLevel', 'confidence_level');
  checkOptionalEnum(failures, input.supportingRole, SUPPORTING_ROLES, 'EVIDENCE_ROLE_INVALID', 'supportingRole', 'supporting_role');

  for (const [field, label] of [['sectionOrClause', 'section_or_clause'], ['pageOrParagraph', 'page_or_paragraph']]) {
    if (!isBlank(input[field]) && String(input[field]).length > MAX_LOCATOR_LENGTH) {
      failures.push(failure(
        'EVIDENCE_LOCATOR_TOO_LONG',
        `${label} must be at most ${MAX_LOCATOR_LENGTH} characters`,
        { field }
      ));
    }
  }

  // Migration 011 requires at least one of these for M1 admission
  // (EVIDENCE_ATTRIBUTION_INCOMPLETE). Rejecting it here gives the author an
  // immediate, actionable error instead of a failure at publication time.
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
    throw new ProvenanceValidationError(failures);
  }
}

module.exports = {
  SOURCE_CATEGORIES,
  CONFIDENCE_LEVELS,
  SUPPORTING_ROLES,
  validateSourceInput,
  validateSourceVersionInput,
  validateEvidenceInput,
  assertValid,
  ProvenanceValidationError,
  failure
};
