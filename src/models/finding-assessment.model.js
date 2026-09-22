/**
 * Finding Assessment Model
 *
 * Implements the Assessment stage of the Atiman operational flow
 * (ATM-000 sections 9-10, ATM-002 sections 7.2-7.3 and 8.2-8.3):
 *
 *   Inspection -> Finding -> Assessment -> Action -> Closure
 *
 * An assessment is the accountable decision that gives a finding exactly one
 * outcome: Operator Corrected, Monitor, or Escalate. A recommendation is
 * recorded first; the accountable party then confirms it or overrides it.
 * Overrides require a reason, and every decision is attributed and timestamped
 * (ATM-002 section 8.3).
 *
 * Records are append-only: a decision never rewrites history, it transitions
 * the assessment row it decides on. Re-assessment opens a new row.
 *
 * Every read and write is scoped by organization_id.
 */

const BaseModel = require('./base.model');

const OUTCOMES = Object.freeze(['operator_corrected', 'monitor', 'escalate']);

/** Outcome -> resulting finding status (ATM-002 section 7.1 lifecycle). */
const OUTCOME_STATUS = Object.freeze({
  operator_corrected: 'resolved',
  monitor: 'monitored',
  escalate: 'escalated'
});

/** Finding statuses that must not receive a new assessment. */
const TERMINAL_FINDING_STATUSES = Object.freeze(['closed', 'cancelled', 'resolved']);

class FindingAssessmentModel extends BaseModel {
  constructor() {
    super('finding_assessments');
  }

  /**
   * Load a finding, scoped to the organization.
   * @returns {Promise<Object|null>}
   */
  async getScopedFinding(findingId, organizationId) {
    const rows = await this.query(
      'SELECT id, organization_id, status, assessment_state, outcome FROM findings WHERE id = ? AND organization_id = ?',
      [findingId, organizationId]
    );
    return rows[0] || null;
  }

  /**
   * Record a recommendation against a finding, opening a pending assessment.
   *
   * @param {number} findingId
   * @param {number} organizationId
   * @param {Object} data
   * @param {string} data.recommendedOutcome - operator_corrected | monitor | escalate
   * @param {number} data.recommendedByUserId
   * @param {string} [data.engineeringContext]
   */
  async openAssessment(findingId, organizationId, data = {}) {
    const { recommendedOutcome, recommendedByUserId, engineeringContext = null } = data;

    if (!OUTCOMES.includes(recommendedOutcome)) {
      throw Object.assign(new Error('Invalid recommended outcome'), { statusCode: 400 });
    }

    const finding = await this.getScopedFinding(findingId, organizationId);
    if (!finding) {
      throw Object.assign(new Error('Finding not found'), { statusCode: 404 });
    }
    if (TERMINAL_FINDING_STATUSES.includes(finding.status)) {
      throw Object.assign(
        new Error(`Finding is ${finding.status} and cannot be assessed`),
        { statusCode: 409 }
      );
    }
    if (finding.assessment_state === 'pending') {
      throw Object.assign(
        new Error('Finding already has an assessment awaiting decision'),
        { statusCode: 409 }
      );
    }

    const created = await this.query(
      `INSERT INTO finding_assessments (
         organization_id, finding_id, recommended_outcome, assessment_state,
         recommended_by_user_id, engineering_context
       ) VALUES (?, ?, ?, 'pending', ?, ?)
       RETURNING id`,
      [organizationId, findingId, recommendedOutcome, recommendedByUserId, engineeringContext]
    );

    await this.query(
      `UPDATE findings
          SET assessment_state = 'pending', updated_at = NOW()
        WHERE id = ? AND organization_id = ?`,
      [findingId, organizationId]
    );

    return this.getAssessment(created.insertId, organizationId);
  }

  /**
   * Confirm an assessment, producing the finding outcome.
   * The accountable party may confirm the recommendation or override it; an
   * override requires a reason. Monitor requires an interval; Escalate requires
   * an escalation reference.
   *
   * @param {number} assessmentId
   * @param {number} organizationId
   * @param {Object} data
   * @param {number} data.assessorUserId
   * @param {string} data.confirmedOutcome
   * @param {string} [data.engineeringContext]
   * @param {string} [data.overrideReason]
   * @param {number} [data.monitorIntervalDays]
   * @param {string} [data.escalationReference]
   */
  async confirmAssessment(assessmentId, organizationId, data = {}) {
    const {
      assessorUserId,
      confirmedOutcome,
      engineeringContext,
      overrideReason = null,
      monitorIntervalDays = null,
      escalationReference = null
    } = data;

    if (!OUTCOMES.includes(confirmedOutcome)) {
      throw Object.assign(new Error('Invalid confirmed outcome'), { statusCode: 400 });
    }

    const assessment = await this.getAssessment(assessmentId, organizationId);
    if (!assessment) {
      throw Object.assign(new Error('Assessment not found'), { statusCode: 404 });
    }
    if (assessment.assessment_state !== 'pending') {
      throw Object.assign(
        new Error(`Assessment is already ${assessment.assessment_state}`),
        { statusCode: 409 }
      );
    }

    const finding = await this.getScopedFinding(assessment.finding_id, organizationId);
    if (!finding) {
      throw Object.assign(new Error('Finding not found'), { statusCode: 404 });
    }
    if (TERMINAL_FINDING_STATUSES.includes(finding.status)) {
      throw Object.assign(
        new Error(`Finding is ${finding.status} and cannot be assessed`),
        { statusCode: 409 }
      );
    }

    const isOverride = confirmedOutcome !== assessment.recommended_outcome;
    if (isOverride && !(typeof overrideReason === 'string' && overrideReason.trim())) {
      throw Object.assign(
        new Error('Overriding the recommended outcome requires a reason'),
        { statusCode: 400 }
      );
    }
    if (confirmedOutcome === 'monitor' && !(Number.isInteger(monitorIntervalDays) && monitorIntervalDays > 0)) {
      throw Object.assign(
        new Error('Monitor outcome requires a positive monitor interval in days'),
        { statusCode: 400 }
      );
    }
    if (confirmedOutcome === 'escalate' && !(typeof escalationReference === 'string' && escalationReference.trim())) {
      throw Object.assign(
        new Error('Escalate outcome requires an escalation reference'),
        { statusCode: 400 }
      );
    }

    await this.query(
      `UPDATE finding_assessments
          SET assessment_state = 'confirmed',
              confirmed_outcome = ?,
              assessor_user_id = ?,
              engineering_context = COALESCE(?, engineering_context),
              override_reason = ?,
              monitor_interval_days = ?,
              escalation_reference = ?,
              assessed_at = NOW(),
              updated_at = NOW()
        WHERE id = ? AND organization_id = ? AND assessment_state = 'pending'`,
      [
        confirmedOutcome, assessorUserId, engineeringContext ?? null, overrideReason,
        confirmedOutcome === 'monitor' ? monitorIntervalDays : null,
        confirmedOutcome === 'escalate' ? escalationReference : null,
        assessmentId, organizationId
      ]
    );

    await this.query(
      `UPDATE findings
          SET outcome = ?,
              assessment_state = 'assessed',
              assessed_at = NOW(),
              status = ?,
              updated_at = NOW()
        WHERE id = ? AND organization_id = ?`,
      [confirmedOutcome, OUTCOME_STATUS[confirmedOutcome], assessment.finding_id, organizationId]
    );

    return this.getAssessment(assessmentId, organizationId);
  }

  /**
   * Reject an assessment. A rejection must be explained (ATM-002 section 8.2).
   */
  async rejectAssessment(assessmentId, organizationId, data = {}) {
    const { assessorUserId, rejectionReason } = data;

    if (!(typeof rejectionReason === 'string' && rejectionReason.trim())) {
      throw Object.assign(new Error('Rejecting an assessment requires a reason'), { statusCode: 400 });
    }

    const assessment = await this.getAssessment(assessmentId, organizationId);
    if (!assessment) {
      throw Object.assign(new Error('Assessment not found'), { statusCode: 404 });
    }
    if (assessment.assessment_state !== 'pending') {
      throw Object.assign(
        new Error(`Assessment is already ${assessment.assessment_state}`),
        { statusCode: 409 }
      );
    }

    await this.query(
      `UPDATE finding_assessments
          SET assessment_state = 'rejected',
              assessor_user_id = ?,
              rejection_reason = ?,
              assessed_at = NOW(),
              updated_at = NOW()
        WHERE id = ? AND organization_id = ? AND assessment_state = 'pending'`,
      [assessorUserId, rejectionReason, assessmentId, organizationId]
    );

    await this.query(
      `UPDATE findings
          SET assessment_state = 'rejected', updated_at = NOW()
        WHERE id = ? AND organization_id = ?`,
      [assessment.finding_id, organizationId]
    );

    return this.getAssessment(assessmentId, organizationId);
  }

  /**
   * Request more evidence before deciding (ATM-002 section 8.2).
   */
  async requestMoreEvidence(assessmentId, organizationId, data = {}) {
    const { assessorUserId, engineeringContext } = data;

    const assessment = await this.getAssessment(assessmentId, organizationId);
    if (!assessment) {
      throw Object.assign(new Error('Assessment not found'), { statusCode: 404 });
    }
    if (assessment.assessment_state !== 'pending') {
      throw Object.assign(
        new Error(`Assessment is already ${assessment.assessment_state}`),
        { statusCode: 409 }
      );
    }

    await this.query(
      `UPDATE finding_assessments
          SET assessment_state = 'more_evidence_requested',
              assessor_user_id = ?,
              engineering_context = COALESCE(?, engineering_context),
              assessed_at = NOW(),
              updated_at = NOW()
        WHERE id = ? AND organization_id = ? AND assessment_state = 'pending'`,
      [assessorUserId, engineeringContext ?? null, assessmentId, organizationId]
    );

    await this.query(
      `UPDATE findings
          SET assessment_state = 'more_evidence_requested', updated_at = NOW()
        WHERE id = ? AND organization_id = ?`,
      [assessment.finding_id, organizationId]
    );

    return this.getAssessment(assessmentId, organizationId);
  }

  /**
   * Load one assessment, scoped to the organization.
   */
  async getAssessment(assessmentId, organizationId) {
    const rows = await this.query(
      `SELECT * FROM finding_assessments WHERE id = ? AND organization_id = ?`,
      [assessmentId, organizationId]
    );
    return rows[0] || null;
  }

  /**
   * Assessment history for a finding, newest first.
   */
  async getHistoryForFinding(findingId, organizationId) {
    return this.query(
      `SELECT * FROM finding_assessments
        WHERE finding_id = ? AND organization_id = ?
        ORDER BY created_at DESC, id DESC`,
      [findingId, organizationId]
    );
  }

  /**
   * The finding's current open assessment, if any.
   */
  async getPendingForFinding(findingId, organizationId) {
    const rows = await this.query(
      `SELECT * FROM finding_assessments
        WHERE finding_id = ? AND organization_id = ? AND assessment_state = 'pending'`,
      [findingId, organizationId]
    );
    return rows[0] || null;
  }

  /**
   * The supervisor assessment queue: findings awaiting a decision.
   */
  async listPending(organizationId, filters = {}) {
    const params = [organizationId];
    let sql = `
      SELECT a.*, f.finding_description, f.severity, f.status AS finding_status,
             f.asset_id, f.facility_id
        FROM finding_assessments a
        JOIN findings f ON f.id = a.finding_id AND f.organization_id = a.organization_id
       WHERE a.organization_id = ? AND a.assessment_state = 'pending'
    `;

    if (filters.facilityId) {
      sql += ' AND f.facility_id = ?';
      params.push(filters.facilityId);
    }
    if (filters.severity) {
      sql += ' AND f.severity = ?';
      params.push(filters.severity);
    }

    sql += ' ORDER BY a.created_at ASC, a.id ASC';
    return this.query(sql, params);
  }
}

module.exports = new FindingAssessmentModel();
module.exports.OUTCOMES = OUTCOMES;
module.exports.OUTCOME_STATUS = OUTCOME_STATUS;
