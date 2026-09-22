/**
 * Task Template Controller
 * ISO 14224-aligned maintenance task templates
 * Linked to equipment types (not SMP Families)
 * 
 * Step 2: Added cloning, industry support, task kinds, immutability
 */

const { TaskTemplate, EquipmentType, Industry, TASK_KINDS } = require('../models');

/**
 * Get all task templates (with optional filters)
 */
const getAll = async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    const { scheduled, is_active, task_kind, industry_id, is_system } = req.query;
    
    let sql = `
      SELECT 
        tt.*,
        et.type_name,
        et.type_code,
        i.name as industry_name,
        i.code as industry_code,
        pt.template_name as parent_template_name
      FROM task_templates tt
      JOIN equipment_types et ON tt.equipment_type_id = et.id
      LEFT JOIN industries i ON tt.industry_id = i.id
      LEFT JOIN task_templates pt ON tt.parent_template_id = pt.id
      WHERE (
        tt.organization_id IS NULL 
        OR tt.organization_id = ?
      )
    `;
    
    const params = [organizationId];
    
    // Filter for scheduled templates only
    if (scheduled === 'true') {
      sql += ' AND tt.frequency_type IS NOT NULL';
    }
    
    // Filter by active status
    if (is_active !== undefined) {
      sql += ' AND tt.is_active = ?';
      params.push(is_active === 'true');
    }

    // Filter by task kind
    if (task_kind) {
      sql += ' AND tt.task_kind = ?';
      params.push(task_kind);
    }

    // Filter by industry
    if (industry_id) {
      sql += ' AND tt.industry_id = ?';
      params.push(industry_id);
    }

    // Filter by system template flag
    if (is_system !== undefined) {
      sql += ' AND tt.is_system = ?';
      params.push(is_system === 'true');
    }
    
    sql += ' ORDER BY tt.template_name';
    
    const templates = await TaskTemplate.query(sql, params);
    
    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get task templates for an equipment type
 */
const getByEquipmentType = async (req, res, next) => {
  try {
    const { equipmentTypeId } = req.params;
    const organizationId = req.user.organization_id;
    const { maintenance_type, is_active, task_kind, industry_id } = req.query;
    
    const filters = {};
    if (maintenance_type) filters.maintenance_type = maintenance_type;
    if (is_active !== undefined) filters.is_active = is_active === 'true';
    if (task_kind) filters.task_kind = task_kind;
    if (industry_id) filters.industry_id = industry_id;
    
    const templates = await TaskTemplate.findByEquipmentType(
      equipmentTypeId, 
      organizationId, 
      filters
    );
    
    res.json({
      success: true,
      data: { templates }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get task templates applicable to an asset
 */
const getForAsset = async (req, res, next) => {
  try {
    const { assetId } = req.params;
    const organizationId = req.user.organization_id;
    const { task_kind } = req.query;
    
    // Get asset's equipment type
    const { Equipment } = require('../models');
    const asset = await Equipment.findById(assetId);
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }
    
    if (!asset.equipment_type_id) {
      return res.status(400).json({
        success: false,
        message: 'Asset does not have ISO equipment classification'
      });
    }
    
    const filters = {};
    if (task_kind) filters.task_kind = task_kind;
    
    const templates = await TaskTemplate.getTemplatesForAsset(
      asset.equipment_type_id,
      organizationId,
      filters
    );
    
    res.json({
      success: true,
      data: { 
        templates,
        asset: {
          id: asset.id,
          name: asset.name,
          code: asset.code,
          equipment_type_id: asset.equipment_type_id
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get task template details with steps and safety controls
 */
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    
    const template = await TaskTemplate.getWithDetails(id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Task template not found'
      });
    }
    
    // Check access: global templates or organization's own templates
    if (template.organization_id !== null && template.organization_id !== organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    res.json({
      success: true,
      data: { template }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new task template
 */
const create = async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    const userId = req.user.id;
    
    const {
      equipment_type_id,
      industry_id,
      template_code,
      template_name,
      maintenance_type,
      task_kind,
      task_scope,
      description,
      frequency_value,
      frequency_unit,
      estimated_duration_minutes,
      required_skills,
      required_tools,
      steps,
      safety_controls
    } = req.body;
    
    // Validate required fields
    if (!equipment_type_id || !template_name || !maintenance_type) {
      return res.status(400).json({
        success: false,
        message: 'equipment_type_id, template_name, and maintenance_type are required'
      });
    }
    
    // Validate task_kind if provided
    if (task_kind && !Object.values(TASK_KINDS).includes(task_kind)) {
      return res.status(400).json({
        success: false,
        message: `Invalid task_kind. Must be one of: ${Object.values(TASK_KINDS).join(', ')}`
      });
    }
    
    // Verify equipment type exists
    const equipType = await EquipmentType.findById(equipment_type_id);
    if (!equipType) {
      return res.status(400).json({
        success: false,
        message: 'Invalid equipment type'
      });
    }
    
    // Verify industry if provided
    if (industry_id) {
      const industry = await Industry.findById(industry_id);
      if (!industry) {
        return res.status(400).json({
          success: false,
          message: 'Invalid industry'
        });
      }
    }
    
    const template = await TaskTemplate.createWithDetails(
      {
        organization_id: organizationId,
        equipment_type_id,
        industry_id,
        template_code,
        template_name,
        maintenance_type,
        task_kind,
        task_scope,
        description,
        frequency_value,
        frequency_unit,
        estimated_duration_minutes,
        required_skills,
        required_tools,
        is_system: false,
        is_editable: true,
        created_by: userId
      },
      steps || [],
      safety_controls || []
    );
    
    res.status(201).json({
      success: true,
      message: 'Task template created successfully',
      data: { template }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Clone a system template to organization
 * RESTRICTION: Only system templates can be cloned (Step 2)
 */
const clone = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    const userId = req.user.id;
    
    const {
      template_name,
      template_code,
      description
    } = req.body;
    
    // Get source template
    const source = await TaskTemplate.getWithDetails(id);
    if (!source) {
      return res.status(404).json({
        success: false,
        message: 'Source template not found'
      });
    }
    
    // RESTRICTION: Only system templates can be cloned (Step 2)
    if (!source.is_system) {
      return res.status(403).json({
        success: false,
        message: 'Only system templates can be cloned',
        code: 'CLONE_RESTRICTION_SYSTEM_ONLY'
      });
    }
    
    // Clone the template
    const cloned = await TaskTemplate.cloneTemplate(
      id,
      organizationId,
      userId,
      { template_name, template_code, description }
    );
    
    res.status(201).json({
      success: true,
      message: 'Template cloned successfully',
      data: { template: cloned }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search task templates
 */
const search = async (req, res, next) => {
  try {
    const { q, task_kind, industry_id, is_system } = req.query;
    const organizationId = req.user.organization_id;
    
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search term must be at least 2 characters'
      });
    }
    
    const filters = {};
    if (task_kind) filters.task_kind = task_kind;
    if (industry_id) filters.industry_id = industry_id;
    if (is_system !== undefined) filters.is_system = is_system === 'true';
    
    const templates = await TaskTemplate.search(q, organizationId, filters);
    
    res.json({
      success: true,
      data: { templates }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get task template statistics
 */
const getStats = async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    
    const stats = await TaskTemplate.getStats(organizationId);
    
    res.json({
      success: true,
      data: { stats, task_kinds: TASK_KINDS }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get available task kinds
 */
const getTaskKinds = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: { task_kinds: TASK_KINDS }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update task template
 * Uses new immutability check
 */
const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    
    // Check template exists
    const existing = await TaskTemplate.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Task template not found'
      });
    }
    
    // Check if editable (system templates cannot be modified)
    const isEditable = await TaskTemplate.isEditable(id);
    if (!isEditable) {
      return res.status(403).json({
        success: false,
        message: 'System templates cannot be modified. Clone the template to make changes.',
        code: 'SYSTEM_TEMPLATE_IMMUTABLE',
        data: {
          clone_url: `/api/task-templates/${id}/clone`
        }
      });
    }
    
    // Verify organization ownership
    if (existing.organization_id !== organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Validate task_kind if provided
    if (req.body.task_kind && !Object.values(TASK_KINDS).includes(req.body.task_kind)) {
      return res.status(400).json({
        success: false,
        message: `Invalid task_kind. Must be one of: ${Object.values(TASK_KINDS).join(', ')}`
      });
    }
    
    const updated = await TaskTemplate.updateIfEditable(id, req.body);
    
    if (!updated) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }
    
    const template = await TaskTemplate.getWithDetails(id);
    
    res.json({
      success: true,
      message: 'Task template updated successfully',
      data: { template }
    });
  } catch (error) {
    if (error.message.includes('System templates cannot be modified')) {
      return res.status(403).json({
        success: false,
        message: error.message,
        code: 'SYSTEM_TEMPLATE_IMMUTABLE'
      });
    }
    next(error);
  }
};

/**
 * Delete task template
 * Uses new immutability check
 */
const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    
    // Check template exists
    const existing = await TaskTemplate.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Task template not found'
      });
    }
    
    // Check if system template
    const isSystem = await TaskTemplate.isSystemTemplate(id);
    if (isSystem) {
      return res.status(403).json({
        success: false,
        message: 'System templates cannot be deleted',
        code: 'SYSTEM_TEMPLATE_IMMUTABLE'
      });
    }
    
    // Verify organization ownership
    if (existing.organization_id !== organizationId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    await TaskTemplate.deleteIfEditable(id);
    
    res.json({
      success: true,
      message: 'Task template deleted successfully'
    });
  } catch (error) {
    if (error.message.includes('System templates cannot be deleted')) {
      return res.status(403).json({
        success: false,
        message: error.message,
        code: 'SYSTEM_TEMPLATE_IMMUTABLE'
      });
    }
    next(error);
  }
};


/**
 * Publish a task template version
 * Creates an immutable task_template_versions record with steps, safety controls,
 * and frozen provenance copied from the working template.
 */
const publish = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const organizationId = req.user.organization_id;
    const {
      change_rationale,
      ai_assisted,
      ai_assistance_detail
    } = req.body || {};

    // Route ID validation: must be a positive integer.
    const templateId = parseInt(id, 10);
    if (!Number.isFinite(templateId) || templateId <= 0 || String(templateId) !== String(id).replace(/^\+/, '')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid template id'
      });
    }

    // ai_assisted validation: omitted defaults to false; if supplied, must be a JSON boolean.
    let normalizedAiAssisted;
    if (ai_assisted === undefined) {
      normalizedAiAssisted = false;
    } else if (typeof ai_assisted !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'ai_assisted must be a boolean'
      });
    } else {
      normalizedAiAssisted = ai_assisted;
    }

    // ai_assistance_detail validation: explicit null or undefined is allowed; otherwise must be a plain object.
    if (ai_assistance_detail !== undefined && ai_assistance_detail !== null) {
      if (typeof ai_assistance_detail !== 'object' || Array.isArray(ai_assistance_detail)) {
        return res.status(400).json({
          success: false,
          message: 'ai_assistance_detail must be an object'
        });
      }
    }

    const result = await TaskTemplate.publishVersion(templateId, userId, {
      changeRationale: change_rationale,
      aiAssisted: normalizedAiAssisted,
      aiAssistanceDetail: ai_assistance_detail,
      publishedByOrganizationId: organizationId
    });

    res.status(201).json({
      success: true,
      message: 'Task template published successfully',
      data: result
    });
  } catch (error) {
    if (error.message === 'Task template not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Access denied' || error.message === 'Template is not publishable' || error.message === 'Cannot publish template with no steps') {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
    // ATM-001 M1: the publication admission gate fails closed with every reason
    // it found, so the caller can correct the knowledge rather than guess.
    if (error.code === 'PUBLICATION_ADMISSION_FAILED') {
      return res.status(409).json({
        success: false,
        message: error.message,
        code: error.code,
        failures: error.failures
      });
    }
    next(error);
  }
};

/**
 * ATM-001 M1 — Knowledge governance lifecycle handlers.
 *
 * Authorization is enforced by requirePermission on the routes; these handlers
 * delegate the domain rules (valid transitions, mandatory rejection reason,
 * approval binding to content) to the model, and map domain errors to HTTP.
 */
const governanceAction = (modelMethod) => async (req, res, next) => {
  try {
    const templateId = parseInt(req.params.id, 10);
    if (!Number.isFinite(templateId) || templateId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid template id' });
    }

    const template = await TaskTemplate[modelMethod](
      templateId,
      req.user.id,
      req.user.organization_id,
      req.body && req.body.reason
    );

    res.json({ success: true, data: { template } });
  } catch (error) {
    next(error);
  }
};

const submitForReview = governanceAction('submitForReview');
const approve = governanceAction('approveTemplate');
const reopenForRework = governanceAction('reopenForRework');

/**
 * Reject a template under review. A reason is mandatory.
 */
const reject = async (req, res, next) => {
  try {
    const templateId = parseInt(req.params.id, 10);
    if (!Number.isFinite(templateId) || templateId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid template id' });
    }

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const reason = body.rejection_reason || body.reason;
    if (!(typeof reason === 'string' && reason.trim())) {
      return res.status(400).json({ success: false, message: 'rejection_reason is required' });
    }

    const template = await TaskTemplate.rejectTemplate(
      templateId,
      req.user.id,
      req.user.organization_id,
      reason
    );

    res.json({ success: true, data: { template } });
  } catch (error) {
    next(error);
  }
};

/**
 * Record an explicit safety review of the working template.
 */
const recordSafetyReview = async (req, res, next) => {
  try {
    const templateId = parseInt(req.params.id, 10);
    if (!Number.isFinite(templateId) || templateId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid template id' });
    }

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const safetyReviewState = body.safety_review_state;

    const template = await TaskTemplate.recordSafetyReview(
      templateId,
      req.user.id,
      req.user.organization_id,
      safetyReviewState
    );

    res.json({ success: true, data: { template } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAll,
  getByEquipmentType,
  getForAsset,
  getById,
  create,
  clone,
  search,
  getStats,
  getTaskKinds,
  update,
  remove,
  publish,
  submitForReview,
  approve,
  reject,
  reopenForRework,
  recordSafetyReview
};
