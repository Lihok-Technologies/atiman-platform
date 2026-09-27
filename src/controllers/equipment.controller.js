/**
 * Equipment Controller
 * Multi-tenant aware equipment management
 */

const { Equipment } = require('../models');
const {
  resolveAsset,
  IDENTIFIER_TYPES,
  RESOLUTION_OUTCOMES
} = require('../services/asset-context.service');
const qrLabelService = require('../services/qr-label.service');

/**
 * Get all equipment (organization-aware, role-based filtering)
 * Admin sees all in org, Supervisor/Operator sees only their facility's equipment
 */
const getAll = async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    const userRole = req.user?.role;
    const userFacilityId = req.user?.facility_id;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to an organization'
      });
    }
    
    // Build filters from query params
    const filters = {
      facility_id: req.query.facility_id,
      status: req.query.status,
      category: req.query.category,
      criticality: req.query.criticality,
      equipment_category_id: req.query.equipment_category_id,
      equipment_class_id: req.query.equipment_class_id,
      equipment_type_id: req.query.equipment_type_id
    };
    
    // Apply role-based facility filtering
    if (userRole === 'supervisor' || userRole === 'operator') {
      if (!userFacilityId) {
        return res.status(403).json({
          success: false,
          message: 'You must be assigned to a facility to view equipment'
        });
      }
      
      // Override facility_id to restrict to user's facility
      filters.facility_id = userFacilityId.toString();
    }

    // Use ISO classification aware method
    const equipment = await Equipment.getAllWithIsoClassification(organizationId, filters);
    res.json({
      success: true,
      data: { equipment }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get equipment by ID (organization-aware)
 * Includes ISO 14224 classification
 */
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    
    // Use ISO classification aware method
    const equipment = await Equipment.getWithIsoClassification(id, organizationId);
    
    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found'
      });
    }

    res.json({
      success: true,
      data: { equipment }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new equipment (organization-aware)
 */
const create = async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to an organization'
      });
    }

    const data = {
      ...req.body,
      organization_id: organizationId,
      created_by: req.user.id
    };

    const equipment = await Equipment.create(data);
    
    // Auto-generate QR code for new asset
    try {
      await qrLabelService.generateForAsset(equipment.id);
      const updatedEquipment = await Equipment.getWithQRInfo(equipment.id, organizationId);
      res.status(201).json({
        success: true,
        message: 'Equipment created successfully',
        data: { equipment: updatedEquipment || equipment }
      });
    } catch (qrError) {
      console.error('Auto QR generation failed:', qrError);
      res.status(201).json({
        success: true,
        message: 'Equipment created successfully (QR generation pending)',
        data: { equipment }
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Update equipment (organization-aware)
 */
const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    
    // Verify equipment belongs to user's organization
    const belongs = await Equipment.belongsToOrganization(id, organizationId);
    if (!belongs) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found'
      });
    }
    
    const equipment = await Equipment.update(id, req.body);
    
    res.json({
      success: true,
      message: 'Equipment updated successfully',
      data: { equipment }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete equipment (organization-aware)
 */
const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    
    // Verify equipment belongs to user's organization
    const belongs = await Equipment.belongsToOrganization(id, organizationId);
    if (!belongs) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found'
      });
    }
    
    await Equipment.delete(id);
    
    res.json({
      success: true,
      message: 'Equipment deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get equipment statistics (organization-aware)
 * Admin sees all org stats, Supervisor sees only their facility's stats
 */
const getStats = async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    const { role, facility_id } = req.user;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to an organization'
      });
    }
    
    let stats;
    if (role === 'supervisor' && facility_id) {
      stats = await Equipment.getStatsByFacility(facility_id, organizationId);
    } else {
      stats = await Equipment.getStats(organizationId);
    }
    
    const categories = await Equipment.getCategories(organizationId);
    
    res.json({
      success: true,
      data: { stats, categories }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search equipment (organization-aware)
 */
const search = async (req, res, next) => {
  try {
    const { q } = req.query;
    const organizationId = req.user.organization_id;
    
    const equipment = await Equipment.search(q, organizationId);
    
    res.json({
      success: true,
      data: { equipment }
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================
// QR Code Methods
// ============================================================

/**
 * Get QR code data for equipment
 */
const getQRCode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    
    // Get base URL from request
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    
    const qrData = await Equipment.getQRCodeData(id, organizationId, baseUrl);
    
    if (!qrData) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found'
      });
    }
    
    res.json({
      success: true,
      data: qrData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate new QR token for equipment
 */
const generateQRToken = async (req, res, next) => {
  try {
    const { id } = req.params;
    const organizationId = req.user.organization_id;
    
    // Verify equipment belongs to organization
    const belongs = await Equipment.belongsToOrganization(id, organizationId);
    if (!belongs) {
      return res.status(404).json({
        success: false,
        message: 'Equipment not found'
      });
    }
    
    const token = await Equipment.generateQRToken(id, organizationId);
    
    // Get base URL from request
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    
    res.json({
      success: true,
      message: 'QR token generated successfully',
      data: {
        qr_token: token,
        qr_url: `${baseUrl}/m/asset/${token}`
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Lookup equipment by QR token.
 *
 * DEFECT A (ATM-002-I2A) — this handler called `Equipment.getByQRToken(token)`,
 * whose query is `WHERE e.qr_token = ?` with no organization predicate, and then
 * performed no organization comparison of its own. Any authenticated principal of
 * any tenant holding a token received another tenant's full equipment row,
 * including its SAP references.
 *
 * It now resolves through the single authoritative tenant-safe resolver. The
 * payload is the resolver's owned Atiman asset-context projection rather than the
 * database row, and every outcome other than RESOLVED is refused with the same
 * non-disclosing response, so this endpoint cannot be used to establish whether a
 * token exists in another organization.
 */
const lookupByQRToken = async (req, res, next) => {
  try {
    const { token } = req.params;

    const resolution = await resolveAsset(
      { organizationId: req.user?.organization_id ?? null },
      { type: IDENTIFIER_TYPES.QR_TOKEN, value: token }
    );

    if (resolution.outcome !== RESOLUTION_OUTCOMES.RESOLVED) {
      return res.status(404).json({
        success: false,
        message: 'Invalid QR code or equipment not found'
      });
    }

    res.json({
      success: true,
      data: { equipment: resolution.asset }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get equipment without QR tokens (for batch generation)
 */
const getWithoutQRToken = async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    
    const equipment = await Equipment.getWithoutQRToken(organizationId);
    
    res.json({
      success: true,
      data: { equipment }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getStats,
  search,
  // QR Code methods
  getQRCode,
  generateQRToken,
  lookupByQRToken,
  getWithoutQRToken
};
