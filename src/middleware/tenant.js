/**
 * Tenant Resolution Middleware
 * Multi-tenant organization context management
 */

const { Organization } = require('../models');

/**
 * Resolve organization from authenticated user
 * Attaches organization_id and organization context to request
 */
const resolveOrganization = async (req, res, next) => {
  try {
    // User must be authenticated first
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get organization_id from user
    const organizationId = req.user.organization_id;
    
    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: 'User is not associated with any organization'
      });
    }

    // Verify organization exists and is active
    const isActive = await Organization.isActive(organizationId);
    if (!isActive) {
      return res.status(403).json({
        success: false,
        message: 'Organization is not active'
      });
    }

    // Attach organization context to request
    req.organization_id = organizationId;
    req.organization = {
      id: organizationId,
      isAdmin: req.user.is_organization_admin || req.user.role === 'admin'
    };

    next();
  } catch (error) {
    console.error('[TENANT] Error resolving organization:', error);
    next(error);
  }
};

/**
 * Require organization admin role
 * User must be organization admin or system admin
 */
const requireOrganizationAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const isOrgAdmin = req.user.is_organization_admin || req.user.role === 'admin';
  
  if (!isOrgAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Organization admin access required'
    });
  }

  next();
};

/**
 * Require that the `:id` route parameter is the caller's own organization.
 *
 * ATM-001-SEC-104 policy 4 (strict tenant scope). The caller's tenant — taken
 * from `req.user.organization_id`, never from a client-supplied value — is the
 * only organization a tenant-scoped principal may address. A role is not
 * authority: there is deliberately no `admin` exemption, because the previous
 * `userRole !== 'admin'` disjunct in the organization controllers was a full
 * cross-tenant bypass.
 *
 * The predicate is a pure comparison and runs BEFORE any controller or model
 * call, so a foreign identifier can neither be read nor modified. It is also
 * independent of whether the identifier exists: a foreign id and an absent id
 * are refused identically (403), so the response cannot disclose what exists.
 */
const requireOwnOrganization = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const ownOrganizationId = Number(req.user.organization_id);
  const requestedOrganizationId = Number(req.params.id);

  if (!Number.isInteger(ownOrganizationId)
      || !Number.isInteger(requestedOrganizationId)
      || requestedOrganizationId !== ownOrganizationId) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  next();
};

/**
 * Optional tenant resolution
 * Sets organization context if available but doesn't require it
 */
const optionalOrganization = async (req, res, next) => {
  try {
    if (req.user && req.user.organization_id) {
      req.organization_id = req.user.organization_id;
      req.organization = {
        id: req.user.organization_id,
        isAdmin: req.user.is_organization_admin || req.user.role === 'admin'
      };
    }
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Validate organization limits before creation
 * Checks if organization has reached limits for users, facilities, equipment
 */
const checkOrganizationLimit = (resourceType) => {
  return async (req, res, next) => {
    try {
      if (!req.organization_id) {
        return res.status(403).json({
          success: false,
          message: 'Organization context required'
        });
      }

      let hasReachedLimit = false;
      let limitMessage = '';

      switch (resourceType) {
        case 'users':
          hasReachedLimit = await Organization.hasReachedUserLimit(req.organization_id);
          limitMessage = 'Organization has reached the maximum number of users';
          break;
        case 'facilities':
          hasReachedLimit = await Organization.hasReachedFacilityLimit(req.organization_id);
          limitMessage = 'Organization has reached the maximum number of facilities';
          break;
        case 'equipment':
          hasReachedLimit = await Organization.hasReachedEquipmentLimit(req.organization_id);
          limitMessage = 'Organization has reached the maximum number of equipment';
          break;
        default:
          return next();
      }

      if (hasReachedLimit) {
        return res.status(403).json({
          success: false,
          message: limitMessage,
          code: 'ORGANIZATION_LIMIT_REACHED'
        });
      }

      next();
    } catch (error) {
      console.error('[TENANT] Error checking organization limit:', error);
      next(error);
    }
  };
};

module.exports = {
  resolveOrganization,
  requireOrganizationAdmin,
  requireOwnOrganization,
  optionalOrganization,
  checkOrganizationLimit
};
