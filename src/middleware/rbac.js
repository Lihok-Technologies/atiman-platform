/**
 * Role-Based Access Control (RBAC) Middleware
 */

const { checkPermission, hasPermission } = require('../config/permissions');

/**
 * Middleware factory to check permission for a resource/action
 * @param {string} resource - Resource name (e.g., 'WORK_ORDERS')
 * @param {string} action - Action name (e.g., 'CREATE')
 * @param {Function} ownershipCheck - Optional function to determine ownership (req) => boolean
 */
const requirePermission = (resource, action, ownershipCheck = null) => {
  return (req, res, next) => {
    const role = req.user?.role;
    
    if (!role) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const level = checkPermission(role, resource, action);
    
    if (level === 'all') {
      return next();
    }
    
    if (level === 'own') {
      // If ownership check function provided, use it
      if (ownershipCheck) {
        const isOwn = ownershipCheck(req);
        if (isOwn) {
          return next();
        }
      } else {
        // Default: allow (route handler should verify ownership)
        req.checkOwnership = true;
        return next();
      }
    }
    
    return res.status(403).json({
      success: false,
      message: `Access denied: ${action} permission required for ${resource}`
    });
  };
};

/**
 * Middleware to check if user can update work order status
 * Operators can only update their own assigned work orders
 * Supervisors must complete inspection before marking as completed
 * Admin can complete without inspection (override)
 */
const canUpdateWorkOrderStatus = async (req, res, next) => {
  const role = req.user?.role;
  const userId = req.user?.id;
  const workOrderId = req.params.id;
  const newStatus = req.body.status;
  
  const { WorkOrder } = require('../models');
  const workOrder = await WorkOrder.findById(workOrderId);
  
  if (!workOrder) {
    return res.status(404).json({
      success: false,
      message: 'Work order not found'
    });
  }
  
  // Admin can update any work order (no inspection required - override)
  if (role === 'admin') {
    return next();
  }
  
  // Check if trying to mark as completed/closed - require inspection for supervisor and operator
  if (newStatus === 'completed' || newStatus === 'closed') {
    const hasReadings = await WorkOrder.hasInspectionReadings(workOrderId);
    if (!hasReadings) {
      return res.status(400).json({
        success: false,
        message: 'Inspection must be completed before marking work order as complete'
      });
    }
  }
  
  // Supervisor can update any work order (after inspection check)
  if (role === 'supervisor') {
    return next();
  }
  
  // Operator can only update their own work orders
  if (role === 'operator') {
    if (workOrder.assigned_to !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update work orders assigned to you'
      });
    }
    
    return next();
  }
  
  return res.status(403).json({
    success: false,
    message: 'Access denied'
  });
};

/**
 * Middleware to check if user can add notes to work order
 */
const canAddWorkOrderNote = async (req, res, next) => {
  const role = req.user?.role;
  const userId = req.user?.id;
  const workOrderId = req.params.id;
  
  // Admin and supervisor can add notes to any work order
  if (role === 'admin' || role === 'supervisor') {
    return next();
  }
  
  // Operator can only add notes to their own work orders
  if (role === 'operator') {
    const { WorkOrder } = require('../models');
    const workOrder = await WorkOrder.findById(workOrderId);
    
    if (!workOrder) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }
    
    if (workOrder.assigned_to !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only add notes to work orders assigned to you'
      });
    }
    
    return next();
  }
  
  return res.status(403).json({
    success: false,
    message: 'Access denied'
  });
};

/**
 * Middleware to check if user can submit inspection readings
 * Admins CANNOT perform inspections - they can only manage work orders
 */
const canSubmitInspection = async (req, res, next) => {
  const role = req.user?.role;
  const userId = req.user?.id;
  const workOrderId = req.params.workOrderId;
  
  // Admin cannot perform inspections - they can only view/manage work orders
  if (role === 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin users cannot perform inspections. Please re-assign this work order to a technician or supervisor.'
    });
  }
  
  // Supervisor can submit for any work order
  if (role === 'supervisor') {
    return next();
  }
  
  // Operator can only submit for their own work orders
  if (role === 'operator') {
    const { WorkOrder } = require('../models');
    const workOrder = await WorkOrder.findById(workOrderId);
    
    if (!workOrder) {
      return res.status(404).json({
        success: false,
        message: 'Work order not found'
      });
    }
    
    if (workOrder.assigned_to !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only submit inspections for work orders assigned to you'
      });
    }
    
    // Check work order status
    if (workOrder.status === 'completed' || workOrder.status === 'closed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot submit inspection for completed work order'
      });
    }
    
    return next();
  }
  
  return res.status(403).json({
    success: false,
    message: 'Access denied'
  });
};

/**
 * Get user permissions for frontend
 */
const getUserPermissions = (req, res) => {
  const role = req.user?.role;
  
  if (!role) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  
  const { getRolePermissions } = require('../config/permissions');
  const permissions = getRolePermissions(role);
  
  res.json({
    success: true,
    data: {
      role,
      permissions
    }
  });
};

/**
 * Middleware to check if user can assign/reassign work orders
 * Supervisors can only assign to users in their own facility
 * Admins can assign to any user
 */
const canAssignWorkOrder = async (req, res, next) => {
  const role = req.user?.role;
  const userId = req.user?.id;
  const userFacilityId = req.user?.facility_id;
  const { assigned_to } = req.body;
  
  // Admin can assign to anyone
  if (role === 'admin') {
    return next();
  }
  
  // Supervisor can only assign to users in their facility
  if (role === 'supervisor') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Supervisor must be assigned to a facility'
      });
    }
    
    // If no assigned_to specified, allow (might be unassigning)
    if (!assigned_to) {
      return next();
    }
    
    // Check if target user is in the same facility
    const { User } = require('../models');
    const targetUser = await User.findById(assigned_to);
    
    if (!targetUser) {
      return res.status(400).json({
        success: false,
        message: 'Target user not found'
      });
    }
    
    if (!targetUser.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign to inactive user'
      });
    }
    
    if (targetUser.facility_id !== userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Can only assign to users in your facility'
      });
    }
    
    return next();
  }
  
  // Operators cannot assign work orders
  return res.status(403).json({
    success: false,
    message: 'Access denied: assignment permission required'
  });
};

/**
 * Middleware to check if supervisor can access work order in their facility
 */
const canAccessFacilityWorkOrder = async (req, res, next) => {
  const role = req.user?.role;
  const userFacilityId = req.user?.facility_id;
  const workOrderId = req.params.id;
  
  // Admin can access any work order
  if (role === 'admin') {
    return next();
  }
  
  // Supervisor can only access work orders in their facility
  if (role === 'supervisor') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Supervisor must be assigned to a facility'
      });
    }
    
    const { WorkOrder } = require('../models');
    const belongs = await WorkOrder.belongsToFacility(workOrderId, userFacilityId);
    
    if (!belongs) {
      return res.status(403).json({
        success: false,
        message: 'Work order not found in your facility'
      });
    }
    
    return next();
  }
  
  // For operators, let other middleware handle it
  return next();
};

/**
 * Middleware to check if user can create work order/schedule in their facility
 * Ensures supervisors can only create for equipment in their facility
 */
const canCreateInFacility = async (req, res, next) => {
  const role = req.user?.role;
  const userFacilityId = req.user?.facility_id;
  const { equipment_id } = req.body;
  
  // Admin can create for any equipment
  if (role === 'admin') {
    return next();
  }
  
  // Supervisor can only create for equipment in their facility
  if (role === 'supervisor') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Supervisor must be assigned to a facility'
      });
    }
    
    if (!equipment_id) {
      return res.status(400).json({
        success: false,
        message: 'Equipment ID is required'
      });
    }
    
    const { Equipment } = require('../models');
    const belongs = await Equipment.belongsToFacility(equipment_id, userFacilityId);
    
    if (!belongs) {
      return res.status(403).json({
        success: false,
        message: 'Equipment not found in your facility'
      });
    }
    
    return next();
  }
  
  // Operators cannot create work orders or schedules
  return res.status(403).json({
    success: false,
    message: 'Access denied: creation permission required'
  });
};

/**
 * Middleware to check if supervisor can manage schedule in their facility
 */
const canManageSchedule = async (req, res, next) => {
  const role = req.user?.role;
  const userFacilityId = req.user?.facility_id;
  const scheduleId = req.params.id;
  
  // Admin can manage any schedule
  if (role === 'admin') {
    return next();
  }
  
  // Supervisor can only manage schedules in their facility
  if (role === 'supervisor') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Supervisor must be assigned to a facility'
      });
    }
    
    const { Schedule } = require('../models');
    const belongs = await Schedule.belongsToFacility(scheduleId, userFacilityId);
    
    if (!belongs) {
      return res.status(403).json({
        success: false,
        message: 'Schedule not found in your facility'
      });
    }
    
    return next();
  }
  
  // Operators cannot manage schedules
  return res.status(403).json({
    success: false,
    message: 'Access denied'
  });
};

/**
 * Middleware to check if supervisor can create user in their facility
 */
const canCreateUser = async (req, res, next) => {
  const role = req.user?.role;
  const userFacilityId = req.user?.facility_id;
  const isOrgAdmin = req.user?.is_organization_admin;
  const { facility_id, role: newUserRole } = req.body;
  
  console.log('[canCreateUser] User role:', role, 'Facility:', userFacilityId, 'IsOrgAdmin:', isOrgAdmin);
  console.log('[canCreateUser] Request body:', { facility_id, newUserRole });
  
  // Admin can create users, but NOT other admins (prevents privilege escalation)
  // Only organization admins can create other admins within their organization
  if (role === 'admin') {
    // Check if trying to create an admin
    if (newUserRole === 'admin') {
      // Only organization admins can create other admins
      if (!isOrgAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only organization administrators can create admin accounts'
        });
      }
      
      // Limit number of admins per organization (optional safety measure)
      const { User } = require('../models');
      const organizationId = req.user.organization_id;
      const adminCount = await User.countByOrganization(organizationId, { role: 'admin' });
      
      if (adminCount >= 3) {
        return res.status(403).json({
          success: false,
          message: 'Maximum number of admin accounts (3) reached for this organization'
        });
      }
    }
    
    return next();
  }
  
  // Supervisor can only create users in their facility
  if (role === 'supervisor') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Supervisor must be assigned to a facility'
      });
    }
    
    // Supervisor can only create operators (not other supervisors or admins)
    if (newUserRole && newUserRole !== 'operator') {
      return res.status(403).json({
        success: false,
        message: 'Can only create operator users'
      });
    }
    
    // If facility_id is provided, it must match supervisor's facility
    if (facility_id && parseInt(facility_id) !== userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Can only create users in your facility'
      });
    }
    
    // Auto-assign supervisor's facility if not provided
    if (!facility_id) {
      req.body.facility_id = userFacilityId;
      console.log('[canCreateUser] Auto-assigned facility:', userFacilityId);
    }
    
    return next();
  }
  
  // Operators cannot create users
  return res.status(403).json({
    success: false,
    message: 'Access denied'
  });
};

/**
 * Middleware to check if supervisor can view/manage a specific user in their facility
 */
const canManageUser = async (req, res, next) => {
  const role = req.user?.role;
  const userFacilityId = req.user?.facility_id;
  const targetUserId = req.params.id;
  
  // Admin can manage any user
  if (role === 'admin') {
    return next();
  }
  
  // Supervisor can only manage users in their facility
  if (role === 'supervisor') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Supervisor must be assigned to a facility'
      });
    }
    
    // Supervisors can view their own profile
    if (parseInt(targetUserId) === req.user.id) {
      return next();
    }
    
    const { User } = require('../models');
    const targetUser = await User.findById(targetUserId);
    
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (targetUser.facility_id !== userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'User not found in your facility'
      });
    }
    
    return next();
  }
  
  // For operators viewing own profile
  return next();
};

/**
 * ATM-001-SEC-00B: authorization for deleting a single user record
 * (DELETE /users/:id).
 *
 * The route previously relied on `requireAdmin`, which admits a supervisor as
 * well as an administrator (src/middleware/auth.js), and neither the handler
 * nor `User.delete` applied any organization or facility predicate. A
 * supervisor of one tenant could therefore delete another tenant's user, and no
 * accepted permission contract was consulted at all.
 *
 * This guard supplies the boundary the approved contract cannot express. It
 * runs *after* `requirePermission('USERS', 'DELETE')`, so the resource/action
 * matrix (`admin: 'all'`, `supervisor: 'none'`, `operator: 'none'`) has already
 * refused every non-administrator before any database access - which is why an
 * operator or supervisor targeting any identifier, existing or not, receives the
 * same 403 and cannot use this route as an oracle.
 *
 * For a caller who does reach the lookup (today: an administrator), the tenant
 * rule of the approved architecture is applied: a role is not a cross-tenant
 * grant, and joining another tenant fails closed.
 *
 *   - role operator / supervisor  -> 403 at the permission gate, no lookup
 *   - same organization, admin    -> allowed for the handler to delete
 *   - any other organization      -> 404
 *   - a record that does not exist -> 404
 *   - malformed / out-of-range id  -> 404
 *
 * Every out-of-scope outcome collapses into the identical 404 body, so the
 * endpoint cannot be used to test whether a user exists in another tenant.
 * Deleting one's own account remains the handler's separate 400 refusal.
 */
const canDeleteUser = async (req, res, next) => {
  const notFound = () => res.status(404).json({
    success: false,
    message: 'User not found'
  });

  const role = req.user?.role;

  if (!role) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // Only a plain positive integer inside the PostgreSQL INTEGER range is a user
  // identifier. Rejecting anything else before the lookup keeps malformed input
  // off the database, makes an out-of-range value a clean 404 instead of a
  // database error, and leaves every rejected form indistinguishable from a
  // record that does not exist.
  const rawUserId = String(req.params.id ?? '');
  if (!/^\d+$/.test(rawUserId)) {
    return notFound();
  }
  const targetUserId = Number(rawUserId);
  if (!Number.isSafeInteger(targetUserId) || targetUserId < 1 || targetUserId > 2147483647) {
    return notFound();
  }

  const { User } = require('../models');
  const targetUser = await User.findById(targetUserId);

  if (!targetUser) {
    return notFound();
  }

  const sameOrganization = targetUser.organization_id != null
    && req.user.organization_id != null
    && targetUser.organization_id === req.user.organization_id;

  // Fail closed on a foreign tenant, and on either side missing an organization.
  // The response is identical to an absent record, so the outcome cannot be used
  // to test whether a record exists in another tenant.
  if (!sameOrganization) {
    return notFound();
  }

  req.targetUser = targetUser;
  return next();
};

/**
 * Middleware to filter reports by facility for supervisors and operators
 * Admins can view all facilities
 */
const filterReportsByFacility = async (req, res, next) => {
  const role = req.user?.role;
  const userFacilityId = req.user?.facility_id;
  
  console.log(`[RBAC] filterReportsByFacility - Role: ${role}, User Facility: ${userFacilityId}`);
  
  // Admin can view all facilities - no filtering needed
  if (role === 'admin') {
    console.log('[RBAC] Admin - no facility filter applied');
    return next();
  }
  
  // Supervisor and Operator can only view their own facility's reports
  if (role === 'supervisor' || role === 'operator') {
    if (!userFacilityId) {
      console.log('[RBAC] No facility assigned - access denied');
      return res.status(403).json({
        success: false,
        message: 'You must be assigned to a facility to view reports'
      });
    }
    
    // Override any facility_id in query to restrict to user's facility
    console.log(`[RBAC] Applying facility filter: ${userFacilityId}`);
    req.query.facility_id = userFacilityId.toString();
    
    return next();
  }
  
  return next();
};

/**
 * Middleware to enforce facility-based filtering for equipment
 * Admin sees all, Supervisor sees only their facility's equipment
 */
const filterEquipmentByFacility = async (req, res, next) => {
  const role = req.user?.role;
  const userFacilityId = req.user?.facility_id;
  
  // Admin can see all equipment - no filtering needed
  if (role === 'admin') {
    return next();
  }
  
  // Supervisor can only see equipment in their facility
  if (role === 'supervisor') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Supervisor must be assigned to a facility to view equipment'
      });
    }
    
    // Override any facility_id in query to restrict to supervisor's facility
    req.query.facility_id = userFacilityId.toString();
    return next();
  }
  
  // Operator can only see equipment in their facility (if assigned)
  if (role === 'operator') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'You must be assigned to a facility to view equipment'
      });
    }
    
    req.query.facility_id = userFacilityId.toString();
    return next();
  }
  
  return next();
};

/**
 * Middleware to enforce facility-based filtering for facilities list
 * Admin sees all, Supervisor/Operator sees only their facility
 */
const filterFacilitiesByAccess = async (req, res, next) => {
  const role = req.user?.role;
  const userFacilityId = req.user?.facility_id;
  
  // Admin can see all facilities - no filtering needed
  if (role === 'admin') {
    return next();
  }
  
  // Supervisor and Operator can only see their assigned facility
  if (role === 'supervisor' || role === 'operator') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'You must be assigned to a facility'
      });
    }
    
    // Add filter to only show their facility
    req.query._facilityFilter = userFacilityId;
    return next();
  }
  
  return next();
};

/**
 * Middleware to filter work orders by role
 * Admin sees all in org, Supervisor sees facility's work orders, Operator sees only their assigned
 */
const filterWorkOrdersByRole = async (req, res, next) => {
  const role = req.user?.role;
  const userId = req.user?.id;
  const userFacilityId = req.user?.facility_id;
  
  // Admin can see all work orders - no additional filtering
  if (role === 'admin') {
    return next();
  }
  
  // Supervisor can only see work orders in their facility
  if (role === 'supervisor') {
    if (!userFacilityId) {
      return res.status(403).json({
        success: false,
        message: 'Supervisor must be assigned to a facility to view work orders'
      });
    }
    
    // Get equipment IDs in supervisor's facility and filter work orders
    req.query._supervisorFacilityId = userFacilityId;
    return next();
  }
  
  // Operator can only see their own assigned work orders
  if (role === 'operator') {
    req.query.assigned_to = userId.toString();
    return next();
  }
  
  return next();
};

module.exports = {
  requirePermission,
  canUpdateWorkOrderStatus,
  canAddWorkOrderNote,
  canSubmitInspection,
  canAssignWorkOrder,
  canAccessFacilityWorkOrder,
  canCreateInFacility,
  canManageSchedule,
  canCreateUser,
  canManageUser,
  canDeleteUser,
  filterReportsByFacility,
  filterEquipmentByFacility,
  filterFacilitiesByAccess,
  filterWorkOrdersByRole,
  getUserPermissions
};
