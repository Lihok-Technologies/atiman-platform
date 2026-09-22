/**
 * Finding Model
 * ODM Findings / Defects with SAP catalog coding and notification traceability
 * 
 * Supports ISO 14224 reliability data collection and SAP S/4HANA PM integration.
 * Findings are manually raised as SAP notifications - ODM does NOT auto-create them.
 */

const BaseModel = require('./base.model');

/**
 * Finding statuses produced by a confirmed assessment. They must never be set
 * directly, or the Assessment stage would be bypassed.
 * See database/postgresql/013_finding_assessment.sql.
 */
const ASSESSMENT_DERIVED_STATUSES = Object.freeze([
  'assessed', 'monitored', 'escalated', 'resolved'
]);

class FindingModel extends BaseModel {
  constructor() {
    super('findings');
  }

  /**
   * Get findings with full details including catalog descriptions
   * @param {number} organizationId - Organization ID
   * @param {Object} filters - Optional filters
   */
  async getFindingsWithDetails(organizationId, filters = {}) {
    let sql = `
      SELECT 
        f.*,
        fac.name as facility_name,
        fac.sap_reference_code as facility_sap_ref,
        eq.name as asset_name,
        eq.code as asset_code,
        eq.sap_equipment_reference as asset_sap_ref,
        eq.sap_floc_hint,
        et.type_name as equipment_type_name,
        et.type_code as equipment_type_code,
        op.object_part_name,
        op.object_part_code,
        dc.damage_name,
        dc.damage_code,
        cc.cause_name,
        cc.cause_code,
        ac.activity_name,
        ac.activity_code,
        tt.template_name,
        tts.step_no,
        tts.instruction as step_instruction,
        reporter.full_name as reported_by_name,
        reporter.email as reported_by_email
      FROM ${this.tableName} f
      JOIN facilities fac ON f.facility_id = fac.id
      JOIN equipment eq ON f.asset_id = eq.id
      LEFT JOIN equipment_types et ON eq.equipment_type_id = et.id
      LEFT JOIN object_parts op ON f.object_part_id = op.id
      LEFT JOIN damage_codes dc ON f.damage_code_id = dc.id
      LEFT JOIN cause_codes cc ON f.cause_code_id = cc.id
      LEFT JOIN activity_codes ac ON f.activity_code_id = ac.id
      LEFT JOIN task_templates tt ON f.task_template_id = tt.id
      LEFT JOIN task_template_steps tts ON f.task_template_step_id = tts.id
      LEFT JOIN users reporter ON f.reported_by_user_id = reporter.id
      WHERE f.organization_id = ?
    `;
    
    const params = [organizationId];

    if (filters.facility_id) {
      sql += ' AND f.facility_id = ?';
      params.push(filters.facility_id);
    }
    if (filters.asset_id) {
      sql += ' AND f.asset_id = ?';
      params.push(filters.asset_id);
    }
    if (filters.severity) {
      sql += ' AND f.severity = ?';
      params.push(filters.severity);
    }
    if (filters.status) {
      sql += ' AND f.status = ?';
      params.push(filters.status);
    }
    if (filters.requires_sap_notification !== undefined) {
      sql += ' AND f.requires_sap_notification = ?';
      params.push(filters.requires_sap_notification);
    }
    if (filters.has_sap_notification !== undefined) {
      if (filters.has_sap_notification) {
        sql += ' AND f.sap_notification_no IS NOT NULL';
      } else {
        sql += ' AND f.sap_notification_no IS NULL';
      }
    }

    sql += ' ORDER BY f.reported_at DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(filters.limit));
    }

    return this.query(sql, params);
  }

  /**
   * Get a single finding with full details
   * @param {number} findingId - Finding ID
   * @param {number} organizationId - Organization ID
   */
  async getFindingWithDetails(findingId, organizationId) {
    const sql = `
      SELECT 
        f.*,
        fac.name as facility_name,
        fac.sap_reference_code as facility_sap_ref,
        eq.name as asset_name,
        eq.code as asset_code,
        eq.sap_equipment_reference as asset_sap_ref,
        eq.sap_floc_hint,
        et.type_name as equipment_type_name,
        et.type_code as equipment_type_code,
        op.object_part_name,
        op.object_part_code,
        dc.damage_name,
        dc.damage_code,
        dc.severity_level as damage_severity,
        cc.cause_name,
        cc.cause_code,
        cc.cause_category,
        ac.activity_name,
        ac.activity_code,
        ac.activity_category,
        tt.template_name,
        tts.step_no,
        tts.instruction as step_instruction,
        reporter.full_name as reported_by_name,
        reporter.email as reported_by_email
      FROM ${this.tableName} f
      JOIN facilities fac ON f.facility_id = fac.id
      JOIN equipment eq ON f.asset_id = eq.id
      LEFT JOIN equipment_types et ON eq.equipment_type_id = et.id
      LEFT JOIN object_parts op ON f.object_part_id = op.id
      LEFT JOIN damage_codes dc ON f.damage_code_id = dc.id
      LEFT JOIN cause_codes cc ON f.cause_code_id = cc.id
      LEFT JOIN activity_codes ac ON f.activity_code_id = ac.id
      LEFT JOIN task_templates tt ON f.task_template_id = tt.id
      LEFT JOIN task_template_steps tts ON f.task_template_step_id = tts.id
      LEFT JOIN users reporter ON f.reported_by_user_id = reporter.id
      WHERE f.id = ? AND f.organization_id = ?
    `;
    
    const [result] = await this.query(sql, [findingId, organizationId]);
    return result || null;
  }

  /**
   * Create a new finding
   * @param {Object} data - Finding data
   * @param {number} organizationId - Organization ID
   */
  async createFinding(data, organizationId) {
    const fields = [
      'organization_id', 'facility_id', 'asset_id',
      'task_template_id', 'task_template_step_id',
      'object_part_id', 'damage_code_id', 'cause_code_id', 'activity_code_id',
      'finding_description', 'severity', 'status',
      'equipment_function_impact', 'operating_condition',
      'recommendation', 'requires_sap_notification',
      'reported_by_user_id'
    ];

    const values = fields.map(f => {
      if (f === 'organization_id') return organizationId;
      return data[f] !== undefined ? data[f] : null;
    });

    const placeholders = fields.map(() => '?').join(', ');
    
    const sql = `INSERT INTO ${this.tableName} (${fields.join(', ')}) VALUES (${placeholders})`;
    
    const result = await this.query(sql, values);
    return this.getFindingWithDetails(result.insertId, organizationId);
  }

  /**
   * Update SAP notification reference
   * @param {number} findingId - Finding ID
   * @param {string} notificationNo - SAP notification number
   * @param {number} organizationId - Organization ID
   */
  async linkSapNotification(findingId, notificationNo, organizationId) {
    const sql = `
      UPDATE ${this.tableName}
      SET sap_notification_no = ?,
          sap_notification_created_at = NOW(),
          status = 'notified',
          updated_at = NOW()
      WHERE id = ? AND organization_id = ?
    `;
    
    await this.query(sql, [notificationNo, findingId, organizationId]);
    return this.getFindingWithDetails(findingId, organizationId);
  }

  /**
   * Update finding status
   *
   * The Atiman lifecycle statuses (assessed / monitored / escalated / resolved)
   * are derived from a confirmed assessment and cannot be set directly here,
   * because doing so would bypass the Assessment stage entirely
   * (ATM-000 section 10, ATM-002 section 8.3). Database constraint
   * chk_findings_outcome_status_coherence enforces the same rule.
   *
   * @param {number} findingId - Finding ID
   * @param {string} status - New status
   * @param {number} organizationId - Organization ID
   */
  async updateStatus(findingId, status, organizationId) {
    if (ASSESSMENT_DERIVED_STATUSES.includes(status)) {
      throw Object.assign(
        new Error(
          `Status '${status}' is produced by a confirmed finding assessment; `
          + 'use POST /api/findings/:id/assessments and confirm the outcome instead'
        ),
        { statusCode: 409 }
      );
    }

    const sql = `
      UPDATE ${this.tableName}
      SET status = ?, updated_at = NOW()
      WHERE id = ? AND organization_id = ?
    `;
    
    await this.query(sql, [status, findingId, organizationId]);
    return this.getFindingWithDetails(findingId, organizationId);
  }

  /**
   * Get findings statistics for an organization
   * @param {number} organizationId - Organization ID
   * @param {Object} filters - Optional filters
   */
  async getStats(organizationId, filters = {}) {
    let sql = `
      SELECT 
        COUNT(*) as total_findings,
        COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
        COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_count,
        COUNT(CASE WHEN severity = 'medium' THEN 1 END) as medium_count,
        COUNT(CASE WHEN severity = 'low' THEN 1 END) as low_count,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN status = 'notified' THEN 1 END) as notified_count,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count,
        COUNT(CASE WHEN requires_sap_notification = TRUE AND sap_notification_no IS NULL THEN 1 END) as pending_sap_notification,
        COUNT(CASE WHEN sap_notification_no IS NOT NULL THEN 1 END) as with_sap_notification
      FROM ${this.tableName}
      WHERE organization_id = ?
    `;
    
    const params = [organizationId];

    if (filters.facility_id) {
      sql += ' AND facility_id = ?';
      params.push(filters.facility_id);
    }
    if (filters.asset_id) {
      sql += ' AND asset_id = ?';
      params.push(filters.asset_id);
    }

    const [result] = await this.query(sql, params);
    return result;
  }

  /**
   * Get findings requiring SAP notification
   * @param {number} organizationId - Organization ID
   */
  async getPendingSapNotifications(organizationId) {
    return this.getFindingsWithDetails(organizationId, {
      requires_sap_notification: true,
      has_sap_notification: false
    });
  }

  /**
   * Check if finding belongs to organization
   * @param {number} findingId - Finding ID
   * @param {number} organizationId - Organization ID
   */
  async belongsToOrganization(findingId, organizationId) {
    const sql = `
      SELECT COUNT(*) as count
      FROM ${this.tableName}
      WHERE id = ? AND organization_id = ?
    `;
    const [result] = await this.query(sql, [findingId, organizationId]);
    return result.count > 0;
  }

  /**
   * Get findings for an asset
   * @param {number} assetId - Asset ID
   * @param {number} organizationId - Organization ID
   */
  async getByAsset(assetId, organizationId) {
    return this.getFindingsWithDetails(organizationId, { asset_id: assetId });
  }

  /**
   * Get findings for a facility
   * @param {number} facilityId - Facility ID
   * @param {number} organizationId - Organization ID
   * @param {Object} filters - Optional filters
   */
  async getByFacility(facilityId, organizationId, filters = {}) {
    return this.getFindingsWithDetails(organizationId, { 
      facility_id: facilityId,
      ...filters 
    });
  }

  /**
   * Search findings
   * @param {string} searchTerm - Search term
   * @param {number} organizationId - Organization ID
   */
  async search(searchTerm, organizationId) {
    const sql = `
      SELECT 
        f.*,
        fac.name as facility_name,
        eq.name as asset_name,
        eq.code as asset_code,
        op.object_part_name,
        dc.damage_name,
        cc.cause_name,
        ac.activity_name,
        reporter.full_name as reported_by_name
      FROM ${this.tableName} f
      JOIN facilities fac ON f.facility_id = fac.id
      JOIN equipment eq ON f.asset_id = eq.id
      LEFT JOIN object_parts op ON f.object_part_id = op.id
      LEFT JOIN damage_codes dc ON f.damage_code_id = dc.id
      LEFT JOIN cause_codes cc ON f.cause_code_id = cc.id
      LEFT JOIN activity_codes ac ON f.activity_code_id = ac.id
      LEFT JOIN users reporter ON f.reported_by_user_id = reporter.id
      WHERE f.organization_id = ?
        AND (
          f.finding_description LIKE ?
          OR f.recommendation LIKE ?
          OR eq.name LIKE ?
          OR eq.code LIKE ?
          OR f.sap_notification_no LIKE ?
        )
      ORDER BY f.reported_at DESC
    `;
    
    const likeTerm = `%${searchTerm}%`;
    return this.query(sql, [organizationId, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm]);
  }
}

module.exports = new FindingModel();
