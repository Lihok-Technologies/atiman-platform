/**
 * Finding Assessment Controller
 *
 * Assessment stage of the Atiman operational flow
 * (ATM-000 sections 9-10, ATM-002 sections 7.2-7.3 and 8.2-8.3).
 *
 * Endpoints expose the accountable decision that gives a finding one outcome:
 * Operator Corrected, Monitor, or Escalate.
 *
 * Business rules live in src/models/finding-assessment.model.js and, as defence
 * in depth, in database/postgresql/013_finding_assessment.sql. The controller
 * only validates transport shape and delegates.
 */

const { FindingAssessment } = require('../models');

const OUTCOMES = ['operator_corrected', 'monitor', 'escalate'];

const parseId = (value) => {
  const id = parseInt(value, 10);
  return Number.isInteger(id) && id > 0 && String(id) === String(value).replace(/^\+/, '') ? id : null;
};

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * POST /api/findings/:id/assessments
 * Record a recommendation, opening a pending assessment.
 */
const openAssessment = async (req, res, next) => {
  try {
    const findingId = parseId(req.params.id);
    if (!findingId) {
      return res.status(400).json({ success: false, message: 'Invalid finding id' });
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const {
      recommended_outcome: recommendedOutcome,
      engineering_context: engineeringContext
    } = body;

    if (!OUTCOMES.includes(recommendedOutcome)) {
      return res.status(400).json({
        success: false,
        message: 'recommended_outcome must be one of: operator_corrected, monitor, escalate'
      });
    }

    const assessment = await FindingAssessment.openAssessment(
      findingId,
      req.user.organization_id,
      {
        recommendedOutcome,
        recommendedByUserId: req.user.id,
        engineeringContext: engineeringContext ?? null
      }
    );

    res.status(201).json({ success: true, data: { assessment } });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/findings/assessments/:id/confirm
 * Confirm or override the recommendation, producing the finding outcome.
 */
const confirmAssessment = async (req, res, next) => {
  try {
    const assessmentId = parseId(req.params.id);
    if (!assessmentId) {
      return res.status(400).json({ success: false, message: 'Invalid assessment id' });
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const {
      confirmed_outcome: confirmedOutcome,
      engineering_context: engineeringContext,
      override_reason: overrideReason,
      monitor_interval_days: monitorIntervalDaysRaw,
      escalation_reference: escalationReference
    } = body;

    if (!OUTCOMES.includes(confirmedOutcome)) {
      return res.status(400).json({
        success: false,
        message: 'confirmed_outcome must be one of: operator_corrected, monitor, escalate'
      });
    }

    let monitorIntervalDays = null;
    if (monitorIntervalDaysRaw !== undefined && monitorIntervalDaysRaw !== null) {
      monitorIntervalDays = parseInt(monitorIntervalDaysRaw, 10);
      if (!Number.isInteger(monitorIntervalDays) || monitorIntervalDays <= 0) {
        return res.status(400).json({
          success: false,
          message: 'monitor_interval_days must be a positive integer'
        });
      }
    }

    const assessment = await FindingAssessment.confirmAssessment(
      assessmentId,
      req.user.organization_id,
      {
        assessorUserId: req.user.id,
        confirmedOutcome,
        engineeringContext: engineeringContext ?? null,
        overrideReason: overrideReason ?? null,
        monitorIntervalDays,
        escalationReference: escalationReference ?? null
      }
    );

    res.json({ success: true, data: { assessment } });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/findings/assessments/:id/reject
 * Reject an assessment; a reason is required.
 */
const rejectAssessment = async (req, res, next) => {
  try {
    const assessmentId = parseId(req.params.id);
    if (!assessmentId) {
      return res.status(400).json({ success: false, message: 'Invalid assessment id' });
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const { rejection_reason: rejectionReason } = body;

    if (!(typeof rejectionReason === 'string' && rejectionReason.trim())) {
      return res.status(400).json({ success: false, message: 'rejection_reason is required' });
    }

    const assessment = await FindingAssessment.rejectAssessment(
      assessmentId,
      req.user.organization_id,
      { assessorUserId: req.user.id, rejectionReason }
    );

    res.json({ success: true, data: { assessment } });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/findings/assessments/:id/request-evidence
 * Request more evidence before deciding.
 */
const requestMoreEvidence = async (req, res, next) => {
  try {
    const assessmentId = parseId(req.params.id);
    if (!assessmentId) {
      return res.status(400).json({ success: false, message: 'Invalid assessment id' });
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const { engineering_context: engineeringContext } = body;

    const assessment = await FindingAssessment.requestMoreEvidence(
      assessmentId,
      req.user.organization_id,
      { assessorUserId: req.user.id, engineeringContext: engineeringContext ?? null }
    );

    res.json({ success: true, data: { assessment } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/findings/assessments/queue
 * Findings awaiting an assessment decision (supervisor queue).
 */
const getAssessmentQueue = async (req, res, next) => {
  try {
    const { facility_id: facilityId, severity } = req.query;
    const filters = {};
    if (facilityId) {
      const parsed = parseId(facilityId);
      if (!parsed) {
        return res.status(400).json({ success: false, message: 'Invalid facility_id' });
      }
      filters.facilityId = parsed;
    }
    if (severity) filters.severity = severity;

    const assessments = await FindingAssessment.listPending(req.user.organization_id, filters);

    res.json({ success: true, data: { count: assessments.length, assessments } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/findings/:id/assessments
 * Assessment history for a finding.
 */
const getAssessmentHistory = async (req, res, next) => {
  try {
    const findingId = parseId(req.params.id);
    if (!findingId) {
      return res.status(400).json({ success: false, message: 'Invalid finding id' });
    }

    const organizationId = req.user.organization_id;

    const finding = await FindingAssessment.getScopedFinding(findingId, organizationId);
    if (!finding) {
      return res.status(404).json({ success: false, message: 'Finding not found' });
    }

    const assessments = await FindingAssessment.getHistoryForFinding(findingId, organizationId);

    res.json({
      success: true,
      data: { finding, assessments }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  openAssessment,
  confirmAssessment,
  rejectAssessment,
  requestMoreEvidence,
  getAssessmentQueue,
  getAssessmentHistory
};
