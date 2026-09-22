/**
 * Task Template Model
 * ISO 14224-aligned maintenance task templates
 * Linked to equipment types (not SMP Families)
 * 
 * Step 2: Added industry layer, task kinds, immutability, and cloning
 */

const BaseModel = require('./base.model');
const { getConnection } = require('../config/database');
const {
  computeContentSha,
  validatePublicationAdmission,
  AdmissionError,
  SAFETY_REVIEW_STATES
} = require('../services/knowledge-governance.service');

class TaskTemplate extends BaseModel {
  constructor() {
    super('task_templates');
  }

  /**
   * TASK KINDS ENUM
   * Template-level classification for ODM task types
   */
  static TASK_KINDS = {
    INSPECTION: 'inspection',
    MEASUREMENT: 'measurement',
    CLEANING: 'cleaning',
    LUBRICATION: 'lubrication',
    ADJUSTMENT: 'adjustment',
    TIGHTENING: 'tightening',
    TESTING: 'testing',
    CALIBRATION: 'calibration',
    SAFETY_CHECK: 'safety_check'
  };

  /**
   * Find templates by equipment type
   * Returns both global templates (organization_id IS NULL) 
   * and organization-specific templates
   * 
   * @param {number} equipmentTypeId - Equipment type ID
   * @param {number} organizationId - Organization ID (optional)
   * @param {Object} filters - Optional filters (maintenance_type, is_active, task_kind, industry_id)
   */
  async findByEquipmentType(equipmentTypeId, organizationId = null, filters = {}) {
    let sql = `
      SELECT 
        tt.*,
        et.type_name,
        et.type_code,
        cl.class_name,
        c.category_name,
        i.name as industry_name,
        i.code as industry_code,
        u.full_name as created_by_name,
        pt.template_name as parent_template_name
      FROM task_templates tt
      JOIN equipment_types et ON tt.equipment_type_id = et.id
      JOIN equipment_classes cl ON et.class_id = cl.id
      JOIN equipment_categories c ON cl.category_id = c.id
      LEFT JOIN industries i ON tt.industry_id = i.id
      LEFT JOIN users u ON tt.created_by = u.id
      LEFT JOIN task_templates pt ON tt.parent_template_id = pt.id
      WHERE tt.equipment_type_id = ?
        AND (
          tt.organization_id IS NULL
          ${organizationId ? 'OR tt.organization_id = ?' : ''}
        )
    `;
    
    const params = [equipmentTypeId];
    if (organizationId) params.push(organizationId);
    
    // Apply filters
    if (filters.maintenance_type) {
      sql += ' AND tt.maintenance_type = ?';
      params.push(filters.maintenance_type);
    }
    
    if (filters.is_active !== undefined) {
      sql += ' AND tt.is_active = ?';
      params.push(filters.is_active);
    }

    if (filters.task_kind) {
      sql += ' AND tt.task_kind = ?';
      params.push(filters.task_kind);
    }

    if (filters.industry_id) {
      sql += ' AND tt.industry_id = ?';
      params.push(filters.industry_id);
    }
    
    sql += ' ORDER BY tt.template_name';
    
    return await this.query(sql, params);
  }

  /**
   * Get templates applicable to an asset
   * Based on asset's equipment_type_id
   * 
   * @param {number} equipmentTypeId - Asset's equipment type ID
   * @param {number} organizationId - Organization ID
   * @param {Object} filters - Optional filters
   */
  async getTemplatesForAsset(equipmentTypeId, organizationId, filters = {}) {
    let sql = `
      SELECT 
        tt.*,
        et.type_name,
        et.type_code,
        cl.class_name,
        c.category_name,
        i.name as industry_name,
        CASE 
          WHEN tt.is_system = TRUE THEN 'System'
          WHEN tt.organization_id = ? THEN 'Organization'
          ELSE 'Global'
        END as template_source
      FROM task_templates tt
      JOIN equipment_types et ON tt.equipment_type_id = et.id
      JOIN equipment_classes cl ON et.class_id = cl.id
      JOIN equipment_categories c ON cl.category_id = c.id
      LEFT JOIN industries i ON tt.industry_id = i.id
      WHERE tt.equipment_type_id = ?
        AND tt.is_active = TRUE
        AND (
          tt.organization_id IS NULL
          OR tt.organization_id = ?
        )
    `;
    
    const params = [organizationId, equipmentTypeId, organizationId];

    if (filters.task_kind) {
      sql += ' AND tt.task_kind = ?';
      params.push(filters.task_kind);
    }

    if (filters.industry_id) {
      sql += ' AND tt.industry_id = ?';
      params.push(filters.industry_id);
    }
    
    sql += `
      ORDER BY 
        CASE WHEN tt.organization_id = ? THEN 0 ELSE 1 END,
        tt.maintenance_type,
        tt.template_name
    `;
    params.push(organizationId);
    
    return await this.query(sql, params);
  }

  /**
   * Get template with all details including steps and safety controls
   * @param {number} id - Template ID
   */
  async getSharedWithDetails(id) {
    // Get template only if it belongs to shared/global knowledge
    const [template] = await this.query(`
      SELECT
        tt.*,
        et.type_name,
        et.type_code,
        et.typical_components,
        cl.class_name,
        cl.class_code,
        c.category_name,
        c.category_code,
        i.name as industry_name,
        i.code as industry_code,
        u.full_name as created_by_name,
        pt.template_name as parent_template_name
      FROM task_templates tt
      JOIN equipment_types et ON tt.equipment_type_id = et.id
      JOIN equipment_classes cl ON et.class_id = cl.id
      JOIN equipment_categories c ON cl.category_id = c.id
      LEFT JOIN industries i ON tt.industry_id = i.id
      LEFT JOIN users u ON tt.created_by = u.id
      LEFT JOIN task_templates pt ON tt.parent_template_id = pt.id
      WHERE tt.id = ?
        AND tt.organization_id IS NULL
    `, [id]);

    if (!template) return null;

    // Get steps with safety metadata
    template.steps = await this.query(`
      SELECT
        id, task_template_id, step_no, step_type, instruction,
        data_type, expected_value, min_value, max_value, unit,
        is_required, options,
        safety_note, is_visual_only, requires_equipment_stopped,
        prohibit_if_running, prohibit_opening_covers
      FROM task_template_steps
      WHERE task_template_id = ?
      ORDER BY step_no
    `, [id]);

    // Get safety controls
    template.safety_controls = await this.query(`
      SELECT * FROM task_template_safety_controls
      WHERE task_template_id = ?
      ORDER BY id
    `, [id]);

    return template;
  }

  /**
   * Get template with all details including steps and safety controls
   * @param {number} id - Template ID
   */
  async getWithDetails(id) {
    // Get template
    const [template] = await this.query(`
      SELECT 
        tt.*,
        et.type_name,
        et.type_code,
        et.typical_components,
        cl.class_name,
        cl.class_code,
        c.category_name,
        c.category_code,
        i.name as industry_name,
        i.code as industry_code,
        u.full_name as created_by_name,
        pt.template_name as parent_template_name
      FROM task_templates tt
      JOIN equipment_types et ON tt.equipment_type_id = et.id
      JOIN equipment_classes cl ON et.class_id = cl.id
      JOIN equipment_categories c ON cl.category_id = c.id
      LEFT JOIN industries i ON tt.industry_id = i.id
      LEFT JOIN users u ON tt.created_by = u.id
      LEFT JOIN task_templates pt ON tt.parent_template_id = pt.id
      WHERE tt.id = ?
    `, [id]);
    
    if (!template) return null;
    
    // Get steps with safety metadata
    template.steps = await this.query(`
      SELECT 
        id, task_template_id, step_no, step_type, instruction,
        data_type, expected_value, min_value, max_value, unit,
        is_required, options,
        safety_note, is_visual_only, requires_equipment_stopped,
        prohibit_if_running, prohibit_opening_covers
      FROM task_template_steps
      WHERE task_template_id = ?
      ORDER BY step_no
    `, [id]);
    
    // Get safety controls
    template.safety_controls = await this.query(`
      SELECT * FROM task_template_safety_controls
      WHERE task_template_id = ?
      ORDER BY id
    `, [id]);
    
    return template;
  }

  /**
   * Check if template can be edited (not a system template)
   * @param {number} id - Template ID
   */
  async isEditable(id) {
    const [template] = await this.query(
      'SELECT is_system, is_editable FROM task_templates WHERE id = ?',
      [id]
    );
    if (!template) return false;
    return template.is_system !== true && template.is_editable !== false;
  }

  /**
   * Check if template is a system template
   * @param {number} id - Template ID
   */
  async isSystemTemplate(id) {
    const [template] = await this.query(
      'SELECT is_system FROM task_templates WHERE id = ?',
      [id]
    );
    return template ? template.is_system === true : false;
  }

  /**
   * Create template with steps and safety controls
   * @param {Object} data - Template data
   * @param {Array} steps - Template steps
   * @param {Array} safetyControls - Safety controls
   */
  async createWithDetails(data, steps = [], safetyControls = []) {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Create template with new fields
      const [templateResult] = await connection.execute(`
        INSERT INTO task_templates (
          organization_id, equipment_type_id, industry_id, template_code, template_name,
          maintenance_type, task_kind, task_scope, description, frequency_value, frequency_unit,
          estimated_duration_minutes, required_skills, required_tools,
          is_system, is_editable, parent_template_id,
          is_active, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        data.organization_id || null,
        data.equipment_type_id,
        data.industry_id || null,
        data.template_code || null,
        data.template_name,
        data.maintenance_type,
        data.task_kind || null,
        data.task_scope || null,
        data.description || null,
        data.frequency_value || null,
        data.frequency_unit || null,
        data.estimated_duration_minutes || null,
        data.required_skills || null,
        data.required_tools || null,
        data.is_system !== undefined ? data.is_system : false,
        data.is_editable !== undefined ? data.is_editable : true,
        data.parent_template_id || null,
        data.is_active !== undefined ? data.is_active : true,
        data.created_by
      ]);
      
      const templateId = templateResult.insertId;
      
      // Create steps with safety metadata
      if (steps.length > 0) {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          await connection.execute(`
            INSERT INTO task_template_steps (
              task_template_id, step_no, step_type, instruction,
              data_type, expected_value, min_value, max_value, unit,
              is_required, options,
              safety_note, is_visual_only, requires_equipment_stopped,
              prohibit_if_running, prohibit_opening_covers
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            templateId,
            step.step_no || (i + 1),
            step.step_type,
            step.instruction,
            step.data_type || null,
            step.expected_value || null,
            step.min_value || null,
            step.max_value || null,
            step.unit || null,
            step.is_required !== undefined ? step.is_required : true,
            step.options ? JSON.stringify(step.options) : null,
            step.safety_note || null,
            step.is_visual_only !== undefined ? step.is_visual_only : true,
            step.requires_equipment_stopped !== undefined ? step.requires_equipment_stopped : false,
            step.prohibit_if_running !== undefined ? step.prohibit_if_running : false,
            step.prohibit_opening_covers !== undefined ? step.prohibit_opening_covers : false
          ]);
        }
      }
      
      // Create safety controls
      if (safetyControls.length > 0) {
        for (const sc of safetyControls) {
          await connection.execute(`
            INSERT INTO task_template_safety_controls (
              task_template_id, safety_type, description, is_mandatory
            ) VALUES (?, ?, ?, ?)
          `, [
            templateId,
            sc.safety_type,
            sc.description,
            sc.is_mandatory !== undefined ? sc.is_mandatory : false
          ]);
        }
      }
      
      await connection.commit();
      
      return {
        id: templateId,
        ...data,
        steps: steps,
        safety_controls: safetyControls
      };
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Clone a template from system template to organization
   * Creates a full copy: template + steps + safety controls
   * @param {number} sourceTemplateId - System template to clone
   * @param {number} organizationId - Target organization
   * @param {number} userId - User creating the clone
   * @param {Object} overrides - Optional overrides (template_name, etc.)
   */
  async cloneTemplate(sourceTemplateId, organizationId, userId, overrides = {}) {
    // Get source template with all details
    const source = await this.getWithDetails(sourceTemplateId);
    if (!source) {
      throw new Error('Source template not found');
    }

    // Verify source is a system template (optional - can clone org templates too)
    if (source.is_system !== true) {
      console.warn(`[TaskTemplate] Cloning non-system template ${sourceTemplateId}`);
    }

    // Prepare clone data
    const cloneData = {
      organization_id: organizationId,
      equipment_type_id: source.equipment_type_id,
      industry_id: source.industry_id,
      template_code: overrides.template_code || `${source.template_code}_CLONE`,
      template_name: overrides.template_name || `${source.template_name} (Copy)`,
      maintenance_type: source.maintenance_type,
      task_kind: source.task_kind,
      task_scope: source.task_scope,
      description: overrides.description || source.description,
      frequency_value: source.frequency_value,
      frequency_unit: source.frequency_unit,
      estimated_duration_minutes: source.estimated_duration_minutes,
      required_skills: source.required_skills,
      required_tools: source.required_tools,
      is_system: false,
      is_editable: true,
      parent_template_id: sourceTemplateId,
      is_active: true,
      created_by: userId
    };

    // Prepare steps with safety metadata
    const cloneSteps = source.steps.map(step => ({
      step_no: step.step_no,
      step_type: step.step_type,
      instruction: step.instruction,
      data_type: step.data_type,
      expected_value: step.expected_value,
      min_value: step.min_value,
      max_value: step.max_value,
      unit: step.unit,
      is_required: step.is_required,
      options: step.options ? JSON.parse(step.options) : null,
      // Safety metadata
      safety_note: step.safety_note,
      is_visual_only: step.is_visual_only,
      requires_equipment_stopped: step.requires_equipment_stopped,
      prohibit_if_running: step.prohibit_if_running,
      prohibit_opening_covers: step.prohibit_opening_covers
    }));

    // Prepare safety controls
    const cloneSafetyControls = source.safety_controls.map(sc => ({
      safety_type: sc.safety_type,
      description: sc.description,
      is_mandatory: sc.is_mandatory
    }));

    // Create the cloned template
    return this.createWithDetails(cloneData, cloneSteps, cloneSafetyControls);
  }

  /**
   * Update template (only if editable)
   * @param {number} id - Template ID
   * @param {Object} data - Update data
   */
  async updateIfEditable(id, data) {
    // Check if editable
    const isEditable = await this.isEditable(id);
    if (!isEditable) {
      throw new Error('System templates cannot be modified. Clone the template to make changes.');
    }

    // Filter allowed fields
    const allowedFields = [
      'industry_id', 'template_code', 'template_name', 'maintenance_type', 'task_kind',
      'task_scope', 'description', 'frequency_value', 'frequency_unit',
      'estimated_duration_minutes', 'required_skills', 'required_tools',
      'is_active'
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return null;
    }

    return this.update(id, updateData);
  }

  /**
   * Delete template (only if editable and not system)
   * @param {number} id - Template ID
   */
  async deleteIfEditable(id) {
    const isSystem = await this.isSystemTemplate(id);
    if (isSystem) {
      throw new Error('System templates cannot be deleted.');
    }

    return this.delete(id);
  }

  /**
   * Search templates with new filters
   * @param {string} searchTerm - Search term
   * @param {number} organizationId - Organization ID (optional)
   * @param {Object} filters - Optional filters (task_kind, industry_id, is_system)
   */
  async search(searchTerm, organizationId = null, filters = {}) {
    let sql = `
      SELECT 
        tt.*,
        et.type_name,
        et.type_code,
        cl.class_name,
        c.category_name,
        i.name as industry_name,
        i.code as industry_code
      FROM task_templates tt
      JOIN equipment_types et ON tt.equipment_type_id = et.id
      JOIN equipment_classes cl ON et.class_id = cl.id
      JOIN equipment_categories c ON cl.category_id = c.id
      LEFT JOIN industries i ON tt.industry_id = i.id
      WHERE (
        tt.template_name LIKE ? 
        OR tt.template_code LIKE ?
        OR tt.description LIKE ?
        OR et.type_name LIKE ?
      )
    `;
    
    const params = [`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`];
    
    if (organizationId) {
      sql += ' AND (tt.organization_id IS NULL OR tt.organization_id = ?)';
      params.push(organizationId);
    }

    if (filters.task_kind) {
      sql += ' AND tt.task_kind = ?';
      params.push(filters.task_kind);
    }

    if (filters.industry_id) {
      sql += ' AND tt.industry_id = ?';
      params.push(filters.industry_id);
    }

    if (filters.is_system !== undefined) {
      sql += ' AND tt.is_system = ?';
      params.push(filters.is_system);
    }
    
    sql += ' ORDER BY tt.template_name';
    
    return await this.query(sql, params);
  }

  /**
   * Get templates by industry
   * @param {number} industryId - Industry ID
   * @param {Object} filters - Optional filters
   */
  async getByIndustry(industryId, filters = {}) {
    let sql = `
      SELECT 
        tt.*,
        et.type_name,
        et.type_code,
        cl.class_name,
        c.category_name,
        i.name as industry_name
      FROM task_templates tt
      JOIN equipment_types et ON tt.equipment_type_id = et.id
      JOIN equipment_classes cl ON et.class_id = cl.id
      JOIN equipment_categories c ON cl.category_id = c.id
      JOIN industries i ON tt.industry_id = i.id
      WHERE tt.industry_id = ?
    `;
    
    const params = [industryId];

    if (filters.is_system !== undefined) {
      sql += ' AND tt.is_system = ?';
      params.push(filters.is_system);
    }

    if (filters.is_active !== undefined) {
      sql += ' AND tt.is_active = ?';
      params.push(filters.is_active);
    }
    
    sql += ' ORDER BY tt.template_name';
    
    return await this.query(sql, params);
  }

  /**
   * Get templates statistics for an organization with new fields
   * @param {number} organizationId - Organization ID
   */
  async getStats(organizationId) {
    const [result] = await this.query(`
      SELECT 
        COUNT(*) as total_templates,
        COUNT(CASE WHEN is_system = TRUE THEN 1 END) as system_templates,
        COUNT(CASE WHEN organization_id = ? THEN 1 END) as org_templates,
        COUNT(CASE WHEN task_kind = 'inspection' THEN 1 END) as inspection_templates,
        COUNT(CASE WHEN task_kind = 'measurement' THEN 1 END) as measurement_templates,
        COUNT(CASE WHEN task_kind = 'cleaning' THEN 1 END) as cleaning_templates,
        COUNT(CASE WHEN task_kind = 'lubrication' THEN 1 END) as lubrication_templates,
        COUNT(CASE WHEN task_kind = 'adjustment' THEN 1 END) as adjustment_templates,
        COUNT(CASE WHEN task_kind = 'tightening' THEN 1 END) as tightening_templates,
        COUNT(CASE WHEN task_kind = 'testing' THEN 1 END) as testing_templates,
        COUNT(CASE WHEN task_kind = 'calibration' THEN 1 END) as calibration_templates,
        COUNT(CASE WHEN task_kind = 'safety_check' THEN 1 END) as safety_check_templates,
        COUNT(CASE WHEN task_kind IS NULL THEN 1 END) as unclassified_templates
      FROM task_templates
      WHERE organization_id IS NULL OR organization_id = ?
    `, [organizationId, organizationId]);
    
    return result;
  }

  /**
   * Load a working template plus its ordered steps for governance decisions.
   * Scoped to the organization so governance cannot cross tenants.
   */
  async loadWorkingContent(templateId, organizationId, conn = null) {
    const runner = conn || { query: (sql, params) => this.query(sql, params) };

    const [templates] = await Promise.all([
      runner.query(
        `SELECT * FROM task_templates WHERE id = ? AND (organization_id IS NULL OR organization_id = ?)`,
        [templateId, organizationId]
      )
    ]);

    const template = (Array.isArray(templates) ? templates[0] : templates) || null;
    if (!template) {
      throw Object.assign(new Error('Task template not found'), { statusCode: 404 });
    }

    const rawSteps = await runner.query(
      `SELECT * FROM task_template_steps WHERE task_template_id = ? ORDER BY step_no`,
      [templateId]
    );
    const steps = Array.isArray(rawSteps) ? rawSteps : [];

    return { template, steps };
  }

  /**
   * Submit a draft template for governance review (draft -> under_review).
   * System templates are never governed here; they are immutable reference data.
   */
  async submitForReview(templateId, userId, organizationId) {
    const { template } = await this.loadWorkingContent(templateId, organizationId);

    if (template.is_system) {
      throw Object.assign(new Error('System templates are not submitted for review'), { statusCode: 409 });
    }
    if (template.review_state !== 'draft') {
      throw Object.assign(
        new Error(`Only a draft template can be submitted for review; current state is '${template.review_state}'`),
        { statusCode: 409 }
      );
    }

    await this.query(
      `UPDATE task_templates
          SET review_state = 'under_review',
              submitted_for_review_by_user_id = ?,
              submitted_for_review_at = NOW(),
              updated_at = NOW()
        WHERE id = ? AND review_state = 'draft'`,
      [userId, templateId]
    );

    return this.getWithDetails(templateId);
  }

  /**
   * Approve a template under review (under_review -> approved).
   *
   * The approval is bound to the material content that was reviewed: the
   * fingerprint computed here is re-verified at publication, so knowledge edited
   * after approval cannot be published under the stale approval.
   */
  async approveTemplate(templateId, userId, organizationId) {
    const { template, steps } = await this.loadWorkingContent(templateId, organizationId);

    if (template.review_state !== 'under_review') {
      throw Object.assign(
        new Error(`Only a template under review can be approved; current state is '${template.review_state}'`),
        { statusCode: 409 }
      );
    }

    const contentSha = computeContentSha(template, steps);

    await this.query(
      `UPDATE task_templates
          SET review_state = 'approved',
              reviewer_user_id = ?,
              reviewed_at = NOW(),
              approver_user_id = ?,
              approved_at = NOW(),
              approved_content_sha = ?,
              rejection_reason = NULL,
              updated_at = NOW()
        WHERE id = ? AND review_state = 'under_review'`,
      [userId, userId, contentSha, templateId]
    );

    return this.getWithDetails(templateId);
  }

  /**
   * Reject a template under review (under_review -> rejected). A reason is
   * mandatory: an unexplained rejection is not an accountable decision.
   */
  async rejectTemplate(templateId, userId, organizationId, rejectionReason) {
    if (!(typeof rejectionReason === 'string' && rejectionReason.trim())) {
      throw Object.assign(new Error('Rejecting a template requires a reason'), { statusCode: 400 });
    }

    const { template } = await this.loadWorkingContent(templateId, organizationId);

    if (template.review_state !== 'under_review') {
      throw Object.assign(
        new Error(`Only a template under review can be rejected; current state is '${template.review_state}'`),
        { statusCode: 409 }
      );
    }

    await this.query(
      `UPDATE task_templates
          SET review_state = 'rejected',
              reviewer_user_id = ?,
              reviewed_at = NOW(),
              rejection_reason = ?,
              approver_user_id = NULL,
              approved_at = NULL,
              approved_content_sha = NULL,
              updated_at = NOW()
        WHERE id = ? AND review_state = 'under_review'`,
      [userId, rejectionReason, templateId]
    );

    return this.getWithDetails(templateId);
  }

  /**
   * Return a rejected template to draft so it can be corrected and resubmitted.
   * This is the explicit rework path: a rejected template is never silently made
   * publishable, and re-approval is always required after rework.
   */
  async reopenForRework(templateId, userId, organizationId) {
    const { template } = await this.loadWorkingContent(templateId, organizationId);

    if (template.review_state !== 'rejected') {
      throw Object.assign(
        new Error(`Only a rejected template can be reopened for rework; current state is '${template.review_state}'`),
        { statusCode: 409 }
      );
    }

    await this.query(
      `UPDATE task_templates
          SET review_state = 'draft',
              reviewer_user_id = NULL,
              reviewed_at = NULL,
              approver_user_id = NULL,
              approved_at = NULL,
              approved_content_sha = NULL,
              rejection_reason = NULL,
              updated_at = NOW()
        WHERE id = ? AND review_state = 'rejected'`,
      [templateId]
    );

    return this.getWithDetails(templateId);
  }

  /**
   * Record an explicit safety review of the working template.
   *
   * 'reviewed_no_control_required' and 'reviewed_controls_defined' both assert
   * that a human reviewed safety; 'not_assessed' asserts that no review has
   * happened. This is what makes "no controls required" distinguishable from
   * "safety never considered" (ATM-001 M1).
   */
  async recordSafetyReview(templateId, userId, organizationId, safetyReviewState) {
    if (!SAFETY_REVIEW_STATES.includes(safetyReviewState)) {
      throw Object.assign(
        new Error(`Unknown safety review state: ${safetyReviewState}`),
        { statusCode: 400 }
      );
    }

    const { template } = await this.loadWorkingContent(templateId, organizationId);

    if (!template.is_editable) {
      throw Object.assign(new Error('Template is not editable'), { statusCode: 409 });
    }

    if (safetyReviewState === 'not_assessed') {
      await this.query(
        `UPDATE task_templates
            SET safety_review_state = 'not_assessed',
                safety_reviewed_by_user_id = NULL,
                safety_reviewed_at = NULL,
                updated_at = NOW()
          WHERE id = ?`,
        [templateId]
      );
    } else {
      await this.query(
        `UPDATE task_templates
            SET safety_review_state = ?,
                safety_reviewed_by_user_id = ?,
                safety_reviewed_at = NOW(),
                updated_at = NOW()
          WHERE id = ?`,
        [safetyReviewState, userId, templateId]
      );
    }

    return this.getWithDetails(templateId);
  }

  /**
   * Publish a working task template as an immutable version.
   * This creates task_template_versions, task_template_step_versions,
   * task_template_safety_control_versions, and frozen knowledge_template_version_evidence
   * in a single atomic PostgreSQL transaction, then seals the version.
   *
   * @param {number} templateId - Working task_templates.id to publish
   * @param {number} userId - Publisher user id
   * @param {Object} options - Publication options
   * @param {string} options.changeRationale - Optional rationale
   * @param {boolean} options.aiAssisted - Optional AI assistance flag (default FALSE)
   * @param {Object} options.aiAssistanceDetail - Optional AI assistance detail JSONB
   * @param {number} options.publishedByOrganizationId - Required organization scope for authorization
   * @returns {Promise<Object>} Publication result with versionId, versionNumber, counts
   */
  async publishVersion(templateId, userId, options = {}) {
    const {
      changeRationale = null,
      aiAssisted = false,
      aiAssistanceDetail = null,
      publishedByOrganizationId,
      connection = null
    } = options;

    if (!templateId || !userId) {
      throw new Error('templateId and userId are required');
    }

    if (publishedByOrganizationId === undefined) {
      throw new Error('publishedByOrganizationId is required for authorization');
    }

    const ownsConnection = !connection;
    const conn = connection || await getConnection();
    try {
      // Serialize concurrent publications for this template using an advisory lock.
      await conn.query(`
        SELECT pg_advisory_xact_lock(hashtextextended('publish_template:' || $1, 0))
      `, [templateId]);

      // Capture a single consistent snapshot of the working template and all
      // of its publication children. Everything after this point is published
      // exclusively from the snapshot.
      const [snapshot] = await conn.query(`
        SELECT
          to_jsonb(t) AS template,
          (SELECT COALESCE(MAX(version_number), 0) + 1
           FROM task_template_versions
           WHERE task_template_id = t.id) AS next_version_number,
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', id,
              'step_no', step_no,
              'activity_code_id', activity_code_id,
              'step_type', step_type,
              'instruction', instruction,
              'data_type', data_type,
              'expected_value', expected_value,
              'min_value', min_value,
              'max_value', max_value,
              'unit', unit,
              'is_required', is_required,
              'options', options,
              'safety_note', safety_note,
              'is_visual_only', is_visual_only,
              'requires_equipment_stopped', requires_equipment_stopped,
              'prohibit_if_running', prohibit_if_running,
              'prohibit_opening_covers', prohibit_opening_covers
            ) ORDER BY step_no)
            FROM task_template_steps
            WHERE task_template_id = t.id), '[]'::jsonb) AS steps,
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', id,
              'safety_type', safety_type,
              'description', description,
              'is_mandatory', is_mandatory
            ) ORDER BY id)
            FROM task_template_safety_controls
            WHERE task_template_id = t.id), '[]'::jsonb) AS safety_controls,
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', id,
              'knowledge_source_version_id', knowledge_source_version_id,
              'section_or_clause', section_or_clause,
              'page_or_paragraph', page_or_paragraph,
              'derivation_notes', derivation_notes,
              'confidence_level', confidence_level,
              'supporting_role', supporting_role
            ) ORDER BY id)
            FROM knowledge_template_evidence
            WHERE task_template_id = t.id AND task_template_step_id IS NULL), '[]'::jsonb) AS template_evidence,
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', id,
              'task_template_step_id', task_template_step_id,
              'knowledge_source_version_id', knowledge_source_version_id,
              'section_or_clause', section_or_clause,
              'page_or_paragraph', page_or_paragraph,
              'derivation_notes', derivation_notes,
              'confidence_level', confidence_level,
              'supporting_role', supporting_role
            ) ORDER BY id)
            FROM knowledge_template_evidence
            WHERE task_template_step_id IN (SELECT id FROM task_template_steps WHERE task_template_id = t.id)
              AND task_template_id IS NULL), '[]'::jsonb) AS step_evidence
        FROM task_templates t
        WHERE t.id = $1
      `, [templateId]);

      if (!snapshot) {
        throw new Error('Task template not found');
      }

      const template = snapshot.template;

      // Authorization: tenant templates may only be published by their organization.
      // Global templates (organization_id IS NULL) may be published by admin.
      if (template.organization_id !== null && template.organization_id !== publishedByOrganizationId) {
        throw new Error('Access denied');
      }

      if (!template.is_editable) {
        throw new Error('Template is not publishable');
      }

      const steps = snapshot.steps || [];
      if (steps.length === 0) {
        throw new Error('Cannot publish template with no steps');
      }

      const versionNumber = snapshot.next_version_number;

      // ---- ATM-001 M1: publication admission gate -------------------------
      // Everything below this point writes to the database. The admission
      // validator therefore runs here, before the first irreversible write, so
      // a failed admission leaves no version, step-version, safety-control or
      // evidence rows behind and leaves the working knowledge editable.
      const allEvidence = [
        ...(snapshot.template_evidence || []),
        ...(snapshot.step_evidence || [])
      ];

      const activityCodes = await conn.query(`SELECT id FROM activity_codes`);
      const scopedSourceVersions = await conn.query(
        `SELECT ksv.id
           FROM knowledge_source_versions ksv
           JOIN knowledge_sources ks ON ks.id = ksv.knowledge_source_id
          WHERE ks.organization_id IS NULL
             OR ks.organization_id = $1`,
        [template.organization_id]
      );

      const admissionFailures = validatePublicationAdmission({
        template,
        steps,
        safetyControls: snapshot.safety_controls || [],
        evidence: allEvidence,
        publisherUserId: userId,
        validActivityCodeIds: new Set(activityCodes.map((row) => Number(row.id))),
        validSourceVersionIds: new Set(scopedSourceVersions.map((row) => Number(row.id)))
      });

      if (admissionFailures.length > 0) {
        throw new AdmissionError(admissionFailures);
      }

      // 1. Insert the unsealed version header. Governance attribution is frozen
      // here so the published version remains historically correct even if the
      // working template is later edited or re-reviewed (ATM-001 M1).
      const [versionHeader] = await conn.query(`
        INSERT INTO task_template_versions (
          task_template_id, version_number, equipment_type_id, industry_id,
          activity_code_id, template_code, template_name, maintenance_type,
          task_scope, description, frequency_value, frequency_unit,
          estimated_duration_minutes, required_skills, required_tools,
          priority, task_kind, is_system, is_editable, parent_template_id,
          lifecycle_state_at_publish, is_step_set_sealed, published_by_user_id,
          published_at, superseded_by_version_id, change_rationale,
          ai_assisted, ai_assistance_detail,
          reviewer_user_id, reviewed_at, approver_user_id, approved_at,
          approved_content_sha, safety_reviewed_by_user_id, safety_reviewed_at,
          safety_review_state
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15,
          $16, $17, $18, $19, $20,
          'published', FALSE, $21,
          CURRENT_TIMESTAMP, NULL, $22,
          $23, $24,
          $25, $26, $27, $28,
          $29, $30, $31,
          $32
        )
        RETURNING id
      `, [
        template.id, versionNumber, template.equipment_type_id, template.industry_id,
        template.activity_code_id, template.template_code, template.template_name, template.maintenance_type,
        template.task_scope, template.description, template.frequency_value, template.frequency_unit,
        template.estimated_duration_minutes, template.required_skills, template.required_tools,
        template.priority, template.task_kind, template.is_system, template.is_editable, template.parent_template_id,
        userId, changeRationale,
        aiAssisted, aiAssistanceDetail,
        template.reviewer_user_id, template.reviewed_at,
        template.approver_user_id, template.approved_at,
        template.approved_content_sha,
        template.safety_reviewed_by_user_id, template.safety_reviewed_at,
        template.safety_review_state
      ]);

      const versionId = versionHeader.id;

      // 2. Insert step versions and build a map from working step id to version step id.
      const stepVersionMap = new Map();
      for (const step of steps) {
        const [stepVersion] = await conn.query(`
          INSERT INTO task_template_step_versions (
            task_template_version_id, step_no, task_template_step_id,
            activity_code_id, step_type, instruction, data_type, expected_value, min_value, max_value,
            unit, is_required, options, safety_note, is_visual_only,
            requires_equipment_stopped, prohibit_if_running, prohibit_opening_covers,
            ai_assisted, ai_assistance_detail
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, FALSE, NULL)
          RETURNING id
        `, [
          versionId, step.step_no, step.id, step.activity_code_id, step.step_type, step.instruction,
          step.data_type, step.expected_value, step.min_value, step.max_value,
          step.unit, step.is_required, step.options, step.safety_note, step.is_visual_only,
          step.requires_equipment_stopped, step.prohibit_if_running, step.prohibit_opening_covers
        ]);
        stepVersionMap.set(step.id, stepVersion.id);
      }

      // 3. Insert safety control versions.
      const safetyControls = snapshot.safety_controls || [];
      let safetyControlVersionCount = 0;
      for (const sc of safetyControls) {
        await conn.query(`
          INSERT INTO task_template_safety_control_versions (
            task_template_version_id, task_template_safety_control_id,
            safety_type, description, is_mandatory
          ) VALUES ($1, $2, $3, $4, $5)
        `, [versionId, sc.id, sc.safety_type, sc.description, sc.is_mandatory]);
        safetyControlVersionCount += 1;
      }

      // 4. Copy working template evidence to frozen version evidence from the snapshot.
      const templateEvidenceRows = snapshot.template_evidence || [];
      let templateEvidenceCount = 0;
      for (const ev of templateEvidenceRows) {
        await conn.query(`
          INSERT INTO knowledge_template_version_evidence (
            task_template_version_id, knowledge_source_version_id,
            section_or_clause, page_or_paragraph, derivation_notes,
            confidence_level, supporting_role, copied_from_template_evidence_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          versionId, ev.knowledge_source_version_id, ev.section_or_clause,
          ev.page_or_paragraph, ev.derivation_notes, ev.confidence_level,
          ev.supporting_role, ev.id
        ]);
        templateEvidenceCount += 1;
      }

      // 5. Copy working step evidence, mapping each step to its new version step id.
      const stepEvidenceRows = snapshot.step_evidence || [];
      let stepEvidenceCount = 0;
      for (const ev of stepEvidenceRows) {
        const stepVersionId = stepVersionMap.get(ev.task_template_step_id);
        if (!stepVersionId) {
          throw new Error(`Working step ${ev.task_template_step_id} not found in published step set`);
        }
        await conn.query(`
          INSERT INTO knowledge_template_version_evidence (
            task_template_step_version_id, knowledge_source_version_id,
            section_or_clause, page_or_paragraph, derivation_notes,
            confidence_level, supporting_role, copied_from_template_evidence_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          stepVersionId, ev.knowledge_source_version_id, ev.section_or_clause,
          ev.page_or_paragraph, ev.derivation_notes, ev.confidence_level,
          ev.supporting_role, ev.id
        ]);
        stepEvidenceCount += 1;
      }

      // 6. Seal the version. This commits only if at least one step version exists.
      await conn.query(`
        UPDATE task_template_versions
        SET is_step_set_sealed = TRUE
        WHERE id = $1
      `, [versionId]);

      if (ownsConnection) {
        await conn.commit();
      }

      return {
        versionId,
        versionNumber,
        stepCount: steps.length,
        safetyControlVersionCount,
        templateEvidenceCount,
        stepEvidenceCount,
        totalEvidenceCount: templateEvidenceCount + stepEvidenceCount
      };
    } catch (error) {
      if (ownsConnection) {
        await conn.rollback();
      }
      throw error;
    } finally {
      if (ownsConnection) {
        conn.release();
      }
    }
  }
}

class TaskTemplateStep extends BaseModel {
  constructor() {
    super('task_template_steps');
  }

  /**
   * Update step with safety metadata
   * @param {number} stepId - Step ID
   * @param {Object} data - Update data including safety fields
   */
  async updateWithSafety(stepId, data) {
    const allowedFields = [
      'step_type', 'instruction', 'data_type', 'expected_value',
      'min_value', 'max_value', 'unit', 'is_required', 'options',
      'safety_note', 'is_visual_only', 'requires_equipment_stopped',
      'prohibit_if_running', 'prohibit_opening_covers'
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    if (data.options !== undefined && typeof data.options !== 'string') {
      updateData.options = JSON.stringify(data.options);
    }

    if (Object.keys(updateData).length === 0) {
      return null;
    }

    return this.update(stepId, updateData);
  }
}

class TaskTemplateSafetyControl extends BaseModel {
  constructor() {
    super('task_template_safety_controls');
  }
}

module.exports = {
  TaskTemplate: new TaskTemplate(),
  TaskTemplateStep: new TaskTemplateStep(),
  TaskTemplateSafetyControl: new TaskTemplateSafetyControl(),
  TASK_KINDS: TaskTemplate.TASK_KINDS
};
