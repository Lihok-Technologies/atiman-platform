/**
 * Knowledge Provenance Controller
 *
 * ATM-001 M3 — governed provenance authoring.
 *
 * Authorization is enforced by requirePermission on the routes. These handlers
 * validate route ids, delegate domain rules to the model/service layer, and map
 * domain errors to HTTP. Free-text provenance is never fabricated here: the
 * payload is whatever the authenticated author supplied.
 */

const {
  KnowledgeSource,
  KnowledgeSourceVersion,
  KnowledgeTemplateEvidence,
  ProvenanceNotFoundError,
  ProvenanceConflictError
} = require('../models/knowledge-provenance.model');
const { ProvenanceValidationError } = require('../services/knowledge-provenance.service');

/** Parse a positive integer route parameter, or return null. */
const parseId = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Map a domain error to an HTTP response. Returns true when handled. */
function handleDomainError(error, res) {
  if (error instanceof ProvenanceValidationError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      failures: error.failures
    });
    return true;
  }
  if (error instanceof ProvenanceNotFoundError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return true;
  }
  if (error instanceof ProvenanceConflictError) {
    res.status(error.statusCode).json({ success: false, message: error.message, code: error.code });
    return true;
  }
  // Duplicate source_code within a tenant scope, or duplicate source version
  // designation, surfaces as a PostgreSQL unique violation.
  if (error && error.code === '23505') {
    res.status(409).json({
      success: false,
      message: 'A provenance record with that identity already exists in this organization',
      code: 'PROVENANCE_DUPLICATE'
    });
    return true;
  }
  return false;
}

/** Resolve the caller's tenant scope from the authenticated principal. */
const callerScope = (req) => ({
  organizationId: req.user ? req.user.organization_id : null,
  userId: req.user ? req.user.id : null
});

/** POST /api/knowledge-provenance/sources */
const createSource = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const source = await KnowledgeSource.createSource(body, callerScope(req));
    res.status(201).json({ success: true, data: { source } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** GET /api/knowledge-provenance/sources */
const listSources = async (req, res, next) => {
  try {
    const sources = await KnowledgeSource.listSources(callerScope(req).organizationId);
    res.json({ success: true, data: { sources } });
  } catch (error) {
    next(error);
  }
};

/** POST /api/knowledge-provenance/sources/:id/versions */
const createSourceVersion = async (req, res, next) => {
  try {
    const sourceId = parseId(req.params.id);
    if (!sourceId) {
      return res.status(400).json({ success: false, message: 'Invalid knowledge source id' });
    }

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const version = await KnowledgeSourceVersion.createVersion(sourceId, body, callerScope(req));
    res.status(201).json({ success: true, data: { version } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** GET /api/knowledge-provenance/sources/:id/versions */
const listSourceVersions = async (req, res, next) => {
  try {
    const sourceId = parseId(req.params.id);
    if (!sourceId) {
      return res.status(400).json({ success: false, message: 'Invalid knowledge source id' });
    }

    const versions = await KnowledgeSourceVersion.listVersionsForSource(sourceId, callerScope(req).organizationId);
    res.json({ success: true, data: { versions } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** POST /api/knowledge-provenance/templates/:templateId/evidence */
const attachEvidence = async (req, res, next) => {
  try {
    const templateId = parseId(req.params.templateId);
    if (!templateId) {
      return res.status(400).json({ success: false, message: 'Invalid task template id' });
    }

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

    // The route fixes the template subject. A step may be targeted by supplying
    // taskTemplateStepId, which the validator reconciles with the subject rule.
    const evidence = await KnowledgeTemplateEvidence.attachEvidence(
      { taskTemplateId: templateId },
      body,
      callerScope(req)
    );
    res.status(201).json({ success: true, data: { evidence } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** GET /api/knowledge-provenance/templates/:templateId/evidence */
const listWorkingEvidence = async (req, res, next) => {
  try {
    const templateId = parseId(req.params.templateId);
    if (!templateId) {
      return res.status(400).json({ success: false, message: 'Invalid task template id' });
    }

    const evidence = await KnowledgeTemplateEvidence.listWorkingEvidenceForTemplate(
      templateId, callerScope(req).organizationId
    );
    res.json({ success: true, data: { evidence } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** DELETE /api/knowledge-provenance/templates/:templateId/evidence/:evidenceId */
const detachEvidence = async (req, res, next) => {
  try {
    const templateId = parseId(req.params.templateId);
    const evidenceId = parseId(req.params.evidenceId);
    if (!templateId || !evidenceId) {
      return res.status(400).json({ success: false, message: 'Invalid evidence reference' });
    }

    const result = await KnowledgeTemplateEvidence.detachWorkingEvidence(
      evidenceId, callerScope(req).organizationId
    );
    res.json({ success: true, data: result });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

module.exports = {
  createSource,
  listSources,
  createSourceVersion,
  listSourceVersions,
  attachEvidence,
  listWorkingEvidence,
  detachEvidence
};
