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
 * Role-issuance AUTHORITY.
 *
 * Answers: may this principal issue an account or invitation for `role`?
 *
 * This is the single expression of the approved role-assignment authority that
 * `POST /api/users` and the ATM-001-SEC-00E invitation-creation route already
 * apply at creation time. It is pure and synchronous, so the SAME authority can
 * also be applied to a role that does not come from the client - in particular
 * the role stored on an existing invitation, which ATM-001-SEC-00H-R1 requires
 * before an invitation may be re-issued.
 *
 * It decides AUTHORITY only. Creation-only capacity limits (the per-organization
 * administrator cap) and request-shape constraints (a supervisor's facility
 * match) are not authority: `canCreateUser` applies them on the creation path
 * and they are deliberately NOT applied to a resend, which creates no new
 * account.
 *
 * Returns `null` when the principal may issue `role`, otherwise a refusal
 * `{ status, message }` identical to the one creation returns.
 */
const roleIssuanceAuthority = (user, role) => {
  const userRole = user?.role;

  if (userRole === 'admin') {
    // An administrator may create users, but NOT other administrators: only an
    // organization administrator may issue the administrator role. This is the
    // pre-existing privilege-escalation control the creation policy enforces.
    if (role === 'admin' && !user?.is_organization_admin) {
      return { status: 403, message: 'Only organization administrators can create admin accounts' };
    }
    return null;
  }

  if (userRole === 'supervisor') {
    if (!user?.facility_id) {
      return { status: 403, message: 'Supervisor must be assigned to a facility' };
    }
    // A supervisor may create operators only (not other supervisors or admins).
    if (role && role !== 'operator') {
      return { status: 403, message: 'Can only create operator users' };
    }
    return null;
  }

  // Operators cannot create users; no other role may issue a role.
  return { status: 403, message: 'Access denied' };
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

  // Approved role-assignment authority, shared with the invitation resend path.
  const refusal = roleIssuanceAuthority(req.user, newUserRole);
  if (refusal) {
    return res.status(refusal.status).json({
      success: false,
      message: refusal.message
    });
  }

  // Limit number of admins per organization (optional safety measure).
  // Creation-only CAPACITY, not authority: a resend re-issues an invitation that
  // already exists and is therefore not subject to this cap.
  if (role === 'admin' && newUserRole === 'admin') {
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

  // Supervisor can only create users in their facility
  if (role === 'supervisor') {
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
  }

  return next();
};

/**
 * LEGACY, SUPERSEDED, RETAINED FOR REFERENCE ONLY.
 *
 * Middleware to check if a supervisor can view/manage a specific user in their
 * facility. This guard is deliberately no longer used by any single-user route:
 * it admits an operator for ANY record in ANY tenant (the final
 * `return next()`), admits an administrator with no organization check at all,
 * and answers 403 where the reconciliation core answers 404, so it is an
 * existence oracle. `GET`, `PUT` and `DELETE /api/users/:id` now use
 * `canViewUser` / `canUpdateUser` / `canDeleteUser`, which share
 * `authorizeUserScope` (ATM-001-SEC-LEGACY-01-R3). Do not attach this guard to
 * a user route; it has no tenant predicate.
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
 * ATM-001-SEC-LEGACY-01-R3: ONE authorization core for the single-user routes
 * `GET /api/users/:id` (R1 / PR #85), `PUT /api/users/:id` (R2) and
 * `DELETE /api/users/:id` (00B / PR #87).
 *
 * Those three remediations were authored independently against the same anchor
 * and each grew its own copy of the same rules. That is how the lane drifted:
 * `canViewUser` answered 403 where `canUpdateUser` answered 404 for the same
 * out-of-scope target. This file now ships the rule once - identifier
 * normalisation, the not-found response, the tenant comparison and target
 * resolution - and the three guards below are thin, role-shaped applications of
 * it. A change to the tenant rule can no longer land on one route only.
 *
 * The rule, in one place:
 *
 *   - only a plain positive integer inside the PostgreSQL INTEGER range is a
 *     user identifier; every other form collapses into the same 404 before any
 *     lookup, so malformed input never reaches the database and cannot be told
 *     apart from an absent record;
 *   - a caller with no resolved role is 401;
 *   - a supervisor with no facility has no managed-user scope at all. That is
 *     decided from the caller's OWN state before the lookup, so the denial is
 *     byte-identical for every non-self identifier and discloses nothing about
 *     the target; it is a 403 because it says nothing about which record was
 *     addressed;
 *   - a caller may always address its own record (`isSelf`); the PUT handler
 *     keeps its existing self-service restrictions (no self-role change, no
 *     self-deactivation, no self-demotion, no self-delete);
 *   - an operator may address ONLY its own record. `USERS.VIEW` and
 *     `USERS.DELETE` are 'none' for an operator, so those two routes never reach
 *     this core, but the core still refuses a non-self operator target with the
 *     same 404 a foreign tenant produces - never a distinguishable 403. That is
 *     the drift this reconciliation removes;
 *   - every non-self target must share the caller's organization, and a missing
 *     organization on either side fails closed: a role is not a cross-tenant
 *     grant;
 *   - within the tenant, a supervisor is bounded to its own facility;
 *   - every out-of-scope target - foreign tenant, foreign facility, absent
 *     record, malformed identifier - collapses into the identical 404 body, so
 *     none of the three routes is an existence oracle.
 *
 * The resolved record is attached as `req.targetUser`, so the record that was
 * authorized is the record that is read, written or deleted.
 */

// PostgreSQL INTEGER upper bound. An identifier above it is not a user id and
// must be refused before the database sees an out-of-range value.
const USER_ID_MAX = 2147483647;

const respondUserNotFound = (res) => res.status(404).json({
  success: false,
  message: 'User not found'
});

/**
 * Normalise a route parameter into a user identifier.
 * @param {*} rawParam - the raw `req.params.id`
 * @returns {number|null} the identifier, or null when the value is not a plain
 *   positive integer inside the PostgreSQL INTEGER range
 */
const parseUserIdParam = (rawParam) => {
  const raw = String(rawParam ?? '');
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1 || id > USER_ID_MAX) {
    return null;
  }
  return id;
};

/**
 * True only when both sides carry an organization and it is the same one. A
 * missing organization on either side is NOT a match: it fails closed.
 */
const isSameOrganization = (caller, target) => target.organization_id != null
  && caller.organization_id != null
  && target.organization_id === caller.organization_id;

/**
 * The single users-scope core. Responds and returns null when the caller is out
 * of scope; otherwise attaches the resolved record to `req.targetUser` and
 * returns it.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<Object|null>}
 */
const authorizeUserScope = async (req, res) => {
  const role = req.user?.role;

  if (!role) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return null;
  }

  const targetUserId = parseUserIdParam(req.params.id);
  if (targetUserId === null) {
    respondUserNotFound(res);
    return null;
  }

  // `req.params.id` is always a string while `req.user.id` is whatever the
  // adapter returned, so compare numerically rather than relying on both being
  // the same JS type.
  const isSelf = Number(req.user.id) === targetUserId;

  // A supervisor with no facility has no managed-user scope at all. Deciding
  // this from the caller's own state BEFORE the lookup keeps the denial
  // byte-identical for every non-self identifier.
  if (role === 'supervisor' && !isSelf && !req.user.facility_id) {
    res.status(403).json({
      success: false,
      message: 'Supervisor must be assigned to a facility'
    });
    return null;
  }

  const { User } = require('../models');
  const targetUser = await User.findById(targetUserId);

  if (!targetUser) {
    respondUserNotFound(res);
    return null;
  }

  if (!isSelf) {
    // An operator's USERS.VIEW/UPDATE/DELETE level is at most 'own', so a
    // colleague is refused exactly like a foreign record.
    if (role === 'operator') {
      respondUserNotFound(res);
      return null;
    }

    // Fail closed on a foreign tenant, and on either side missing an
    // organization.
    if (!isSameOrganization(req.user, targetUser)) {
      respondUserNotFound(res);
      return null;
    }

    // Supervisor keeps the legacy facility boundary, now bounded to its tenant.
    if (role === 'supervisor' && targetUser.facility_id !== req.user.facility_id) {
      respondUserNotFound(res);
      return null;
    }

    // Unknown role: fail closed without becoming an existence oracle.
    if (role !== 'admin' && role !== 'supervisor') {
      respondUserNotFound(res);
      return null;
    }
  }

  req.targetUser = targetUser;
  return targetUser;
};

/**
 * GET /api/users/:id - the USERS.VIEW tenant/facility boundary.
 * Thin wrapper: the rule lives in `authorizeUserScope`.
 */
const canViewUser = async (req, res, next) => {
  try {
    if (await authorizeUserScope(req, res)) {
      return next();
    }
  } catch (error) {
    return next(error);
  }
};

/**
 * PUT /api/users/:id - the USERS.UPDATE tenant/facility/ownership boundary.
 * Thin wrapper: the rule lives in `authorizeUserScope`. The approved
 * USERS.ASSIGN_FACILITY policy on the same route is enforced separately by
 * `authorizeFacilityAssignment` below.
 */
const canUpdateUser = async (req, res, next) => {
  try {
    if (await authorizeUserScope(req, res)) {
      return next();
    }
  } catch (error) {
    return next(error);
  }
};

/**
 * DELETE /api/users/:id - the USERS.DELETE tenant boundary.
 * Thin wrapper: the rule lives in `authorizeUserScope`.
 */
const canDeleteUser = async (req, res, next) => {
  try {
    if (await authorizeUserScope(req, res)) {
      return next();
    }
  } catch (error) {
    return next(error);
  }
};

/**
 * ATM-001-SEC-LEGACY-01-R3: the approved USERS.ASSIGN_FACILITY policy on the
 * user write path.
 *
 * OWNER-APPROVED POLICY: "Only explicitly authorized USERS.ASSIGN_FACILITY
 * principals can modify facility assignments within their authorized tenant and
 * facility scope; ordinary operators cannot assign to self/others."
 *
 * The authority is the existing matrix, not a new one:
 *   `src/config/permissions.js` -> USERS.ASSIGN_FACILITY
 *     = { admin: 'all', supervisor: 'none', operator: 'none' }
 *
 * This middleware runs AFTER `canUpdateUser`, so `req.targetUser` is the record
 * the caller has already been authorized to write. It enforces three things:
 *
 *   1. An explicit `facility_id` that does not change the persisted value is not
 *      a modification. The shipped mobile admin form always posts the target's
 *      current facility, so an authorized edit of other fields keeps working.
 *   2. A real change - including clearing the assignment - requires
 *      USERS.ASSIGN_FACILITY. A level of 'none' (supervisor, operator) is
 *      refused with 403 and the stored assignment is untouched. This closes
 *      operator self-repointing and operator-to-colleague repointing.
 *   3. A principal who does hold the permission may only assign a facility of
 *      its own organization. A facility that does not exist, or that belongs to
 *      another tenant, yields the same 404 the user routes use for an absent
 *      record, so the route is not a cross-tenant facility oracle.
 *
 * The normalised value is attached as `req.facilityAssignment` and is the only
 * value the handler uses to write `facility_id`, so authorization and effect
 * cannot diverge.
 */
const parseFacilityIdParam = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    return undefined;
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1 || id > USER_ID_MAX) {
    return undefined;
  }
  return id;
};

const authorizeFacilityAssignment = async (req, res, next) => {
  try {
    const role = req.user?.role;
    const targetUser = req.targetUser;

    // Route order is part of the contract: without a resolved, authorized
    // target there is nothing to compare against. Fail closed rather than
    // assume.
    if (!targetUser) {
      return res.status(500).json({
        success: false,
        message: 'User scope was not resolved before facility authorization'
      });
    }

    const provided = Object.prototype.hasOwnProperty.call(req.body || {}, 'facility_id');

    if (!provided) {
      // Not an assignment request. The handler leaves the stored value alone.
      req.facilityAssignment = { provided: false, facilityId: null };
      return next();
    }

    const requestedFacilityId = parseFacilityIdParam(req.body.facility_id);

    if (requestedFacilityId === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Invalid facility_id'
      });
    }

    const currentFacilityId = targetUser.facility_id == null
      ? null
      : Number(targetUser.facility_id);

    if (requestedFacilityId === currentFacilityId) {
      // Re-sending the current value is not a modification of the assignment.
      req.facilityAssignment = { provided: true, facilityId: requestedFacilityId };
      return next();
    }

    if (checkPermission(role, 'USERS', 'ASSIGN_FACILITY') !== 'all') {
      return res.status(403).json({
        success: false,
        message: 'Access denied: facility assignment requires an authorized principal'
      });
    }

    if (requestedFacilityId !== null) {
      const { Facility } = require('../models');
      const facility = req.user.organization_id == null
        ? null
        : await Facility.findById(requestedFacilityId);

      if (!facility
          || facility.organization_id == null
          || Number(facility.organization_id) !== Number(req.user.organization_id)) {
        return res.status(404).json({
          success: false,
          message: 'Facility not found'
        });
      }
    }

    req.facilityAssignment = { provided: true, facilityId: requestedFacilityId };
    return next();
  } catch (error) {
    return next(error);
  }
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
  roleIssuanceAuthority,
  canManageUser,
  canViewUser,
  canUpdateUser,
  canDeleteUser,
  authorizeFacilityAssignment,
  filterReportsByFacility,
  filterEquipmentByFacility,
  filterFacilitiesByAccess,
  filterWorkOrdersByRole,
  getUserPermissions
};
