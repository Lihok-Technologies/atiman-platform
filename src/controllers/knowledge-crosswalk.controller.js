/**
 * Governed External Classification Crosswalk Controller
 *
 * ATM-001 M5R.3E — HTTP surface for the governed crosswalk application layer.
 *
 * Authorization is enforced by requirePermission on the routes. These handlers
 * validate route and query parameters, delegate every domain rule to the
 * model/service layer, and map domain errors to HTTP. No governance state is
 * decided here, and no attribution is ever taken from the request body: the
 * authenticated principal is the only source of reviewer and approver identity.
 *
 * The read representation deliberately exposes `review_state` and
 * `mapping_outcome` as separate fields alongside the derived `lifecycle` label.
 * A caller can therefore distinguish proposed, in-review, approved-mapping,
 * approved-NO_DIRECT_MAPPING, rejected and superseded knowledge without reading
 * one collapsed status. "Never investigated" is the ABSENCE of a row and is
 * reported as such by the query routes, never invented.
 */

const {
  EquipmentTypeExternalClassification,
  ExternalClassificationCrosswalkEvidence,
  CrosswalkNotFoundError,
  CrosswalkConflictError
} = require('../models/knowledge-crosswalk.model');
const { KnowledgeCrosswalkValidationError } = require('../services/knowledge-crosswalk.service');

/** Parse a positive integer route/query parameter, or return null. */
const parseId = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Map a domain error to an HTTP response. Returns true when handled. */
function handleDomainError(error, res) {
  if (error instanceof KnowledgeCrosswalkValidationError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      failures: error.failures
    });
    return true;
  }
  if (error instanceof CrosswalkNotFoundError) {
    res.status(error.statusCode).json({ success: false, message: error.message });
    return true;
  }
  if (error instanceof CrosswalkConflictError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code
    });
    return true;
  }
  return false;
}

/** The authenticated principal — the only source of attribution. */
const caller = (req) => ({ userId: req.user ? req.user.id : null });

/** A request body object, never an array or undefined. */
const bodyOf = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

/**
 * GET /api/knowledge-crosswalks
 *
 * List crosswalks for one Atiman equipment type. Current truth by default;
 * `includeHistory=true` additionally returns superseded rows, which are retained
 * rather than deleted.
 */
const listCrosswalks = async (req, res, next) => {
  try {
    const equipmentTypeId = parseId(req.query.equipmentTypeId);
    if (!equipmentTypeId) {
      return res.status(400).json({
        success: false,
        message: 'equipmentTypeId is required and must be a positive integer'
      });
    }

    const includeHistory = String(req.query.includeHistory || '').toLowerCase() === 'true';
    const crosswalks = await EquipmentTypeExternalClassification.listCrosswalksForEquipmentType(
      equipmentTypeId, { includeHistory }
    );

    // Absence of rows is a real answer: this type has not been investigated
    // against any authority edition. It is reported, never fabricated.
    res.json({
      success: true,
      data: {
        equipmentTypeId,
        includeHistory,
        investigated: crosswalks.length > 0,
        crosswalks
      }
    });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** GET /api/knowledge-crosswalks/:id — one crosswalk with its provenance. */
const getCrosswalk = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid crosswalk id' });
    }

    const crosswalk = await EquipmentTypeExternalClassification.findCrosswalkById(id);
    if (!crosswalk) {
      return res.status(404).json({ success: false, message: 'Crosswalk not found' });
    }

    const evidence = await ExternalClassificationCrosswalkEvidence.listEvidenceForCrosswalk(id);
    res.json({ success: true, data: { crosswalk, evidence } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** GET /api/knowledge-crosswalks/:id/history — the supersession chain. */
const getCrosswalkHistory = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid crosswalk id' });
    }

    const chain = await EquipmentTypeExternalClassification.getSupersessionChain(id);
    if (chain.length === 0) {
      return res.status(404).json({ success: false, message: 'Crosswalk not found' });
    }

    res.json({
      success: true,
      data: {
        crosswalkId: id,
        // Oldest first; the LAST entry is the current truth of this chain.
        history: chain,
        currentId: chain[chain.length - 1].id
      }
    });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** GET /api/knowledge-crosswalks/:id/evidence — relationship evidence. */
const listEvidence = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid crosswalk id' });
    }

    const crosswalk = await EquipmentTypeExternalClassification.findCrosswalkById(id);
    if (!crosswalk) {
      return res.status(404).json({ success: false, message: 'Crosswalk not found' });
    }

    const evidence = await ExternalClassificationCrosswalkEvidence.listEvidenceForCrosswalk(id);
    res.json({
      success: true,
      data: { crosswalkId: id, subject: 'crosswalk', evidence }
    });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** POST /api/knowledge-crosswalks — propose a draft proposition. */
const proposeCrosswalk = async (req, res, next) => {
  try {
    const crosswalk = await EquipmentTypeExternalClassification.proposeCrosswalk(
      bodyOf(req), caller(req)
    );
    res.status(201).json({ success: true, data: { crosswalk } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** PATCH /api/knowledge-crosswalks/:id — edit a draft proposition. */
const updateDraftCrosswalk = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid crosswalk id' });
    }

    const crosswalk = await EquipmentTypeExternalClassification.updateDraftCrosswalk(
      id, bodyOf(req), caller(req)
    );
    res.json({ success: true, data: { crosswalk } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** POST /api/knowledge-crosswalks/:id/submit — draft -> under_review. */
const submitCrosswalk = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid crosswalk id' });
    }

    const crosswalk = await EquipmentTypeExternalClassification.submitForReview(id, caller(req));
    res.json({ success: true, data: { crosswalk } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/**
 * POST /api/knowledge-crosswalks/:id/approve — under_review -> approved.
 *
 * Refused unless the crosswalk carries relationship evidence. The approver is
 * always the authenticated principal; nothing in the body can influence it.
 */
const approveCrosswalk = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid crosswalk id' });
    }

    const { crosswalk, relationshipEvidence } = await EquipmentTypeExternalClassification
      .approveCrosswalk(id, caller(req));
    res.json({ success: true, data: { crosswalk, relationshipEvidence } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** POST /api/knowledge-crosswalks/:id/reject — under_review -> rejected. */
const rejectCrosswalk = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid crosswalk id' });
    }

    const crosswalk = await EquipmentTypeExternalClassification.rejectCrosswalk(id, caller(req));
    res.json({ success: true, data: { crosswalk } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/**
 * POST /api/knowledge-crosswalks/:id/supersede — link an approved successor.
 *
 * This links an EXISTING approved crosswalk; it never creates one. A replacement
 * must therefore pass through the governed workflow AND the evidence-backed
 * approval rule before it can retire anything.
 */
const supersedeCrosswalk = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid crosswalk id' });
    }

    const body = bodyOf(req);
    const successorId = parseId(body.successorCrosswalkId);
    const crosswalk = await EquipmentTypeExternalClassification.supersedeCrosswalk(
      id, successorId, caller(req)
    );
    res.json({ success: true, data: { crosswalk } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** POST /api/knowledge-crosswalks/:id/evidence — attach relationship evidence. */
const attachEvidence = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid crosswalk id' });
    }

    const evidence = await ExternalClassificationCrosswalkEvidence.attachEvidence(
      id, bodyOf(req), caller(req)
    );
    res.status(201).json({ success: true, data: { evidence } });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

/** DELETE /api/knowledge-crosswalks/:id/evidence/:evidenceId — detach evidence. */
const detachEvidence = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const evidenceId = parseId(req.params.evidenceId);
    if (!id || !evidenceId) {
      return res.status(400).json({ success: false, message: 'Invalid evidence reference' });
    }

    const result = await ExternalClassificationCrosswalkEvidence.detachEvidence(
      evidenceId, id, caller(req)
    );
    res.json({ success: true, data: result });
  } catch (error) {
    if (handleDomainError(error, res)) return;
    next(error);
  }
};

module.exports = {
  listCrosswalks,
  getCrosswalk,
  getCrosswalkHistory,
  listEvidence,
  proposeCrosswalk,
  updateDraftCrosswalk,
  submitCrosswalk,
  approveCrosswalk,
  rejectCrosswalk,
  supersedeCrosswalk,
  attachEvidence,
  detachEvidence
};
