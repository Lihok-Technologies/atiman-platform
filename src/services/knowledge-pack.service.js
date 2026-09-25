/**
 * Knowledge Pack Service
 *
 * ATM-001 M4 — pure domain validation for governed Knowledge Pack authoring,
 * composition, review, approval and publication.
 *
 * This module holds NO database access and NO HTTP concern. It mirrors the
 * established layering of knowledge-governance.service.js (M1) and
 * knowledge-provenance.service.js (M3): the service decides what a valid
 * governed Pack operation is, the model persists it, the controller translates.
 *
 * Two distinct concerns live here:
 *
 *   1. INPUT validation — shape and enum checks for authoring requests. A
 *      malformed request is a client error (400).
 *
 *   2. PUBLICATION ADMISSION — the governed gate that must pass before a Pack
 *      version may be released. This is not ordinary validation: it is the
 *      contract that makes a published Pack trustworthy, so it returns EVERY
 *      failure it found rather than the first, and the caller fails closed.
 *
 * Database integrity is the durable guarantee. Migration 015 enforces, in
 * PostgreSQL, that a governed pack version carries complete attribution and that
 * its approver is not its publisher; migration 014's guard (hardened by 015)
 * freezes membership once a pack version is released. The rules below exist to
 * produce actionable errors and to enforce the cross-table invariants that a
 * row-local CHECK cannot express (member existence, member publication state,
 * member tenant scope, and non-empty composition).
 */

/** Every lifecycle state migration 009 permits on knowledge_pack_versions. */
const PACK_LIFECYCLE_STATES = Object.freeze([
  'draft',
  'under_review',
  'approved',
  'published',
  'superseded',
  'retired'
]);

/**
 * The states in which a Pack version is still being prepared, and therefore the
 * only states in which its membership may be composed or its lifecycle advanced.
 * This is exactly the set migration 014's guard authorizes, and M4 does not
 * widen it.
 */
const PRE_PUBLICATION_PACK_STATES = Object.freeze(['draft', 'under_review', 'approved']);

/**
 * A member of a Pack is an immutable publication record. Only a `published`
 * task_template_version is admissible: `superseded` and `retired` are immutable
 * but are no longer current knowledge, and a working task_template is not a
 * version at all and must never be composable.
 */
const MEMBER_TEMPLATE_LIFECYCLE_STATE = 'published';

const MAX_PACK_CODE_LENGTH = 100;
const MAX_VERSION_NUMBER_LENGTH = 50;

/** Malformed request: the caller sent something structurally invalid. */
class PackValidationError extends Error {
  constructor(failures) {
    const summary = failures.map((f) => f.rule).join(', ');
    super(`Knowledge pack request is invalid: ${summary}`);
    this.name = 'PackValidationError';
    this.statusCode = 400;
    this.code = 'PACK_VALIDATION_FAILED';
    this.failures = failures;
  }
}

/**
 * The governed publication gate refused. Fails closed with every reason found,
 * so the caller can correct the Pack rather than guess (M1 precedent).
 */
class PackAdmissionError extends Error {
  constructor(failures) {
    const summary = failures.map((f) => f.rule).join(', ');
    super(`Knowledge pack publication admission failed: ${summary}`);
    this.name = 'PackAdmissionError';
    this.statusCode = 409;
    this.code = 'PACK_PUBLICATION_ADMISSION_FAILED';
    this.failures = failures;
  }
}

/** The addressed Pack or Pack version does not exist within the address given. */
class PackNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PackNotFoundError';
    this.statusCode = 404;
  }
}

/** The operation conflicts with the current lifecycle state or composition. */
class PackConflictError extends Error {
  constructor(message, code = 'PACK_CONFLICT') {
    super(message);
    this.name = 'PackConflictError';
    this.statusCode = 409;
    this.code = code;
  }
}

const failure = (rule, message, detail) => ({ rule, message, detail });

/**
 * Throw when a failure list is non-empty. Returns nothing otherwise.
 * @param {Array<Object>} failures
 */
function assertValid(failures) {
  if (failures.length) {
    throw new PackValidationError(failures);
  }
}

/**
 * Validate the identity of a new Knowledge Pack.
 * @returns {Array<Object>} failures (empty when valid)
 */
function validatePackInput(input = {}) {
  const failures = [];
  const code = typeof input.packCode === 'string' ? input.packCode.trim() : '';
  const name = typeof input.packName === 'string' ? input.packName.trim() : '';

  if (!code) {
    failures.push(failure('PACK_CODE_REQUIRED', 'packCode is required'));
  } else if (code.length > MAX_PACK_CODE_LENGTH) {
    failures.push(failure('PACK_CODE_TOO_LONG',
      `packCode must be at most ${MAX_PACK_CODE_LENGTH} characters`, { length: code.length }));
  }

  if (!name) {
    failures.push(failure('PACK_NAME_REQUIRED', 'packName is required'));
  }

  return failures;
}

/**
 * Validate a new Pack version request.
 * @returns {Array<Object>} failures (empty when valid)
 */
function validatePackVersionInput(input = {}) {
  const failures = [];
  const versionNumber = typeof input.versionNumber === 'string' ? input.versionNumber.trim() : '';

  if (!versionNumber) {
    failures.push(failure('VERSION_NUMBER_REQUIRED', 'versionNumber is required'));
  } else if (versionNumber.length > MAX_VERSION_NUMBER_LENGTH) {
    failures.push(failure('VERSION_NUMBER_TOO_LONG',
      `versionNumber must be at most ${MAX_VERSION_NUMBER_LENGTH} characters`,
      { length: versionNumber.length }));
  }

  return failures;
}

/**
 * The governed publication admission gate for a Knowledge Pack version.
 *
 * Returns every failure found. An empty array means the Pack version may be
 * released. All data must be read inside the publication transaction, after the
 * Pack version row has been locked, so that the composition validated here is
 * the composition that is frozen.
 *
 * @param {Object} input
 * @param {Object|null} input.packVersion the locked knowledge_pack_versions row
 * @param {Array<Object>} input.members rows joining membership to the member
 *        task_template_version, each carrying { task_template_version_id,
 *        lifecycle_state_at_publish, organization_id }
 * @param {number|null} input.publisherUserId the authenticated publishing principal
 * @returns {Array<Object>} failures (empty when admissible)
 */
function validatePublicationAdmission(input = {}) {
  const { packVersion, members = [], publisherUserId } = input;
  const failures = [];

  if (!packVersion) {
    failures.push(failure('PACK_VERSION_NOT_FOUND', 'Knowledge pack version does not exist'));
    // Nothing else can be meaningfully evaluated without the row.
    return failures;
  }

  // --- 2. correct pre-publication lifecycle state --------------------------
  // Release is the transition approved -> published. Every other state is
  // refused: draft/under_review have not been approved, and published and
  // beyond are already released or historical.
  if (packVersion.lifecycle_state === 'published') {
    failures.push(failure('PACK_VERSION_ALREADY_PUBLISHED',
      'Knowledge pack version is already published'));
  } else if (packVersion.lifecycle_state !== 'approved') {
    failures.push(failure('PACK_VERSION_NOT_PUBLISHABLE',
      'Knowledge pack version must be approved before it can be published',
      { lifecycleState: packVersion.lifecycle_state }));
  }

  // --- 3-6. required governance attribution --------------------------------
  if (packVersion.reviewer_user_id === null || packVersion.reviewer_user_id === undefined) {
    failures.push(failure('REVIEW_ATTRIBUTION_MISSING',
      'Knowledge pack version has no accountable reviewer'));
  }
  if (packVersion.reviewed_at === null || packVersion.reviewed_at === undefined) {
    failures.push(failure('REVIEW_TIMESTAMP_MISSING',
      'Knowledge pack version has no review timestamp'));
  }
  if (packVersion.approver_user_id === null || packVersion.approver_user_id === undefined) {
    failures.push(failure('APPROVER_ATTRIBUTION_MISSING',
      'Knowledge pack version has no accountable approver'));
  }
  if (packVersion.approved_at === null || packVersion.approved_at === undefined) {
    failures.push(failure('APPROVAL_TIMESTAMP_MISSING',
      'Knowledge pack version has no approval timestamp'));
  }

  // --- 7. the publisher is the authenticated publishing principal ----------
  // Never inferred from the row and never defaulted: the caller supplies their
  // own accountable action.
  if (!publisherUserId) {
    failures.push(failure('PUBLISHER_REQUIRED',
      'An authenticated publishing principal is required to publish a knowledge pack version'));
  }

  // --- 8. segregation of duties -------------------------------------------
  // Mirrored by chk_knowledge_pack_versions_approver_not_publisher (migration
  // 015); asserted here so the caller receives an actionable reason rather than
  // a raw constraint violation.
  if (publisherUserId
      && packVersion.approver_user_id !== null
      && packVersion.approver_user_id !== undefined
      && Number(packVersion.approver_user_id) === Number(publisherUserId)) {
    failures.push(failure('SEGREGATION_OF_DUTIES_VIOLATION',
      'The approver of a knowledge pack version may not publish it'));
  }

  // --- 9. non-empty composition -------------------------------------------
  if (!Array.isArray(members) || members.length === 0) {
    failures.push(failure('PACK_EMPTY',
      'Cannot publish a knowledge pack version with no members'));
  }

  // --- 10. every member is an existing immutable PUBLISHED version ---------
  members.forEach((member, index) => {
    if (!member || member.task_template_version_id === null || member.task_template_version_id === undefined) {
      failures.push(failure('MEMBER_VERSION_NOT_FOUND',
        'Membership references a task template version that does not exist',
        { index }));
      return;
    }
    if (member.lifecycle_state_at_publish !== MEMBER_TEMPLATE_LIFECYCLE_STATE) {
      failures.push(failure('MEMBER_NOT_PUBLISHED',
        'Every pack member must be an immutable published task template version',
        {
          taskTemplateVersionId: member.task_template_version_id,
          lifecycleState: member.lifecycle_state_at_publish
        }));
    }
    // A published pack is shared, global knowledge. A tenant-scoped member would
    // publish one organization's private knowledge into shared knowledge, so
    // only globally applicable (organization_id IS NULL) members are admissible.
    if (member.organization_id !== null && member.organization_id !== undefined) {
      failures.push(failure('MEMBER_SCOPE_VIOLATION',
        'A pack member must be globally applicable knowledge, not tenant-scoped knowledge',
        { taskTemplateVersionId: member.task_template_version_id, organizationId: member.organization_id }));
    }
  });

  return failures;
}

module.exports = {
  PACK_LIFECYCLE_STATES,
  PRE_PUBLICATION_PACK_STATES,
  MEMBER_TEMPLATE_LIFECYCLE_STATE,
  PackValidationError,
  PackAdmissionError,
  PackNotFoundError,
  PackConflictError,
  failure,
  assertValid,
  validatePackInput,
  validatePackVersionInput,
  validatePublicationAdmission
};
