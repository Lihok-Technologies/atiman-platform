/**
 * Published Knowledge Resolution Controller (ATM-001-KF-04A)
 *
 * Read-only operational surface over IMMUTABLE PUBLISHED knowledge versions.
 * Authorization is enforced on the routes (`KNOWLEDGE.VIEW`), the caller's
 * tenant scope comes from the authenticated principal (never from the request
 * body or query), and every domain refusal is mapped to an honest HTTP status.
 *
 * This controller performs no write and cannot alter publication semantics.
 */

const {
  resolvePublishedVersion,
  listPublishedVersionsForTemplate,
  listPublishedVersionsForEquipmentType,
  PublishedKnowledgeValidationError,
  PublishedKnowledgeNotFoundError,
  PublishedKnowledgeConflictError
} = require('../services/published-knowledge.service');

/** Map a published-knowledge domain error to HTTP. Returns true when handled. */
function handleDomainError(error, res) {
  if (error instanceof PublishedKnowledgeValidationError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      failures: error.failures
    });
    return true;
  }
  if (error instanceof PublishedKnowledgeNotFoundError) {
    res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
    return true;
  }
  if (error instanceof PublishedKnowledgeConflictError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code
    });
    return true;
  }
  return false;
}

/** Tenant scope is always the authenticated principal, never request input. */
const callerScope = (req) => ({
  organizationId: req.user ? req.user.organization_id : null
});

/** GET /api/knowledge-published/versions/:versionId */
const getVersion = async (req, res, next) => {
  try {
    const resolved = await resolvePublishedVersion(req.params.versionId, callerScope(req));
    res.json({ success: true, data: resolved });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** GET /api/knowledge-published/templates/:templateId/versions */
const listVersionsForTemplate = async (req, res, next) => {
  try {
    const versions = await listPublishedVersionsForTemplate(req.params.templateId, callerScope(req));
    res.json({ success: true, data: { versions } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** GET /api/knowledge-published/equipment-types/:equipmentTypeId/versions */
const listVersionsForEquipmentType = async (req, res, next) => {
  try {
    const versions = await listPublishedVersionsForEquipmentType(
      req.params.equipmentTypeId,
      callerScope(req)
    );
    res.json({ success: true, data: { versions } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

module.exports = {
  getVersion,
  listVersionsForTemplate,
  listVersionsForEquipmentType
};
