/**
 * User Routes
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { User, Facility } = require('../models');
const { authenticate, requireSupervisor } = require('../middleware/auth');
const {
  requirePermission,
  canCreateUser,
  canViewUser,
  canUpdateUser,
  canDeleteUser,
  authorizeFacilityAssignment,
  getUserPermissions
} = require('../middleware/rbac');
const { validateAvailableSeats, validateReactivation, checkSeatUsage } = require('../middleware/seat-validation');
const { getMyCapabilities } = require('../controllers/capability.controller');
const { sanitizeUser, redactSensitiveFields } = require('../utils/helpers');

/**
 * ATM-001-SEC-LEGACY-01-R1 defence in depth.
 *
 * Every JSON response this router produces passes through `redactSensitiveFields`
 * before serialisation, so credential material cannot leave through a handler
 * that forgets to sanitise explicitly - including the JSON error paths. The
 * explicit `sanitizeUser(...)` calls below remain the primary, reviewable
 * protection; this guard is the backstop.
 */
router.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = (body) => sendJson(redactSensitiveFields(body));
  next();
});

router.use(authenticate);

/**
 * Get current user permissions (legacy role-shaped view; presentation only)
 */
router.get('/me/permissions', getUserPermissions);

/**
 * ATM-003 capability presentation descriptor.
 *
 * Presentation only: it tells the UI what to show. Every protected operation is
 * authorized server-side by the capability guard from the same resolver.
 */
router.get('/me/capabilities', getMyCapabilities);

/**
 * Get all users (with facility info) - admin and supervisor only
 * Admin sees all users in organization, Supervisor sees only their facility's users
 */
router.get('/', requirePermission('USERS', 'VIEW'), async (req, res, next) => {
  try {
    const { role, facility_id, id, organization_id } = req.user;
    
    console.log('[USERS API] Request from user:', id, 'Role:', role, 'Facility:', facility_id, 'Org:', organization_id);
    
    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to an organization'
      });
    }
    
    let users;
    if (role === 'supervisor' && facility_id) {
      // Supervisor only sees users in their facility
      console.log('[USERS API] Supervisor - fetching users for facility:', facility_id);
      users = await User.getByFacility(facility_id, organization_id);
      console.log('[USERS API] Found', users.length, 'users in facility');
    } else {
      // Admin sees all users in organization
      console.log('[USERS API] Admin - fetching all users in org:', organization_id);
      users = await User.getAllWithFacility(organization_id);
      console.log('[USERS API] Found', users.length, 'total users');
    }
    
    res.json({
      success: true,
      data: { users: redactSensitiveFields(users) }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get users in my facility (for supervisors to assign work orders)
 * Returns active operators in the supervisor's facility
 */
router.get('/facility/operators', requireSupervisor, async (req, res, next) => {
  try {
    const { facility_id, organization_id } = req.user;
    
    if (!facility_id) {
      return res.status(400).json({
        success: false,
        message: 'You are not assigned to a facility'
      });
    }
    
    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to an organization'
      });
    }
    
    const operators = await User.getActiveOperatorsByFacility(facility_id, organization_id);
    
    res.json({
      success: true,
      data: { users: redactSensitiveFields(operators) }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get user by ID.
 *
 * ATM-001-SEC-LEGACY-01-R1, reconciled with R2 and 00B by
 * ATM-001-SEC-LEGACY-01-R3: the endpoint previously relied on `canManageUser`
 * alone, which let an operator through with no ownership check (any record, in
 * any tenant) and let an administrator read records outside the caller's
 * organization. It now applies the approved USERS.VIEW permission contract and
 * then the shared tenant/facility boundary (`canViewUser` ->
 * `authorizeUserScope`). Every out-of-scope outcome is the same 404, and
 * credential material is redacted from the response.
 */
router.get('/:id', requirePermission('USERS', 'VIEW'), canViewUser, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: { user: sanitizeUser(req.targetUser) }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Create new user (admin and supervisor)
 * Admin can create any user in any facility
 * Supervisor can only create operators in their facility
 * Seat validation ensures subscription limits are respected
 */
router.post('/', requirePermission('USERS', 'CREATE'), canCreateUser, validateAvailableSeats, async (req, res, next) => {
  try {
    const { username, email, password, full_name, role, facility_id } = req.body;
    const { organization_id } = req.user;
    
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, email and password are required'
      });
    }
    
    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to an organization'
      });
    }

    // ATM-001-SEC-LEGACY-01-R3: the approved facility policy's tenant bound
    // applies to creation as well. `canCreateUser` bounds a supervisor to its own
    // facility but imposes no organization check on an administrator's request,
    // so without this an administrator could attach a user of its own tenant to
    // another tenant's facility in one call. The facility must belong to the
    // creator's organization; anything else is reported exactly like an absent
    // facility.
    if (facility_id) {
      const facility = await Facility.findById(facility_id);

      if (!facility
          || facility.organization_id == null
          || Number(facility.organization_id) !== Number(organization_id)) {
        return res.status(404).json({
          success: false,
          message: 'Facility not found'
        });
      }
    }

    // Check if username exists (globally for now)
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Username already exists'
      });
    }
    
    // Hash password
    const password_hash = await bcrypt.hash(password, 10);
    
    // Determine if new user should be organization admin
    // Only if creator is org admin AND new role is admin
    const isNewUserOrgAdmin = (role === 'admin' && req.user.is_organization_admin) ? true : false;
    
    const user = await User.create({
      username,
      email,
      password_hash,
      full_name,
      role: role || 'operator',
      facility_id: facility_id || null,
      organization_id,
      is_organization_admin: isNewUserOrgAdmin,
      is_active: true
    });
    
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { user: sanitizeUser(user) }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Update user (administrators within their organization, supervisors within
 * their own facility, and a user's own record).
 *
 * ATM-001-SEC-LEGACY-01-R3 reconciles R2 (USERS.UPDATE + tenant scope) with R1
 * (response sanitation and the shared guard shape) and 00B (the shared tenant
 * predicate):
 *
 *   - `requirePermission('USERS', 'UPDATE')` applies the approved matrix
 *     (admin 'all', supervisor 'own', operator 'own') before any database work.
 *   - `canUpdateUser` then applies the single shared tenant / ownership /
 *     facility rule (`authorizeUserScope`): a foreign-tenant target is never
 *     writable, an operator may write only its own record, a supervisor is
 *     bounded to its own facility, and every out-of-scope target is the same 404.
 *   - `authorizeFacilityAssignment` enforces the approved USERS.ASSIGN_FACILITY
 *     policy: only an authorized principal may change `facility_id`, and only to
 *     a facility of its own organization.
 *
 * Two handler defects that R2 made live are closed here:
 *
 *   - `updateData` was built from every column the handler knew, so an omitted
 *     `role` or `facility_id` was written as NULL on a 200 - silent data loss for
 *     any API caller that did not resend the whole record. `updateData` now
 *     carries only fields the request actually provided. (The shipped mobile
 *     admin form always posts both, so the UI is unaffected.)
 *   - `is_active: is_active !== undefined ? is_active : true` activated a
 *     suspended account on ANY request that omitted `is_active`; the review
 *     demonstrated a suspended, billable user being reactivated with no seat
 *     check and no seat consumption. An omitted `is_active` now leaves the
 *     persisted value unchanged, and the reactivation branch below is driven by
 *     the activation the request actually performs.
 *
 * RECORDED, NOT CHANGED (an OWNER decision is required):
 *
 *   - `status` is part of this route's legacy request vocabulary but is not a
 *     writable field here (it is deliberately absent from `updateData`). A
 *     successful reactivation therefore sets `is_active` without advancing
 *     `status`, and `OrganizationSubscription.updateSeatUsage` counts seats by
 *     `status IN ('active','invited')`. The seat check now runs, but the
 *     reactivated row still does not consume a seat, so the reactivation control
 *     remains incomplete. Advancing `status` on reactivation is a business
 *     decision, so it is recorded rather than invented.
 *   - Granting `is_organization_admin` is governed only by the pre-existing
 *     "caller must be an organization administrator" rule below. The approved
 *     permission matrix has no ASSIGN_ORGANIZATION_ADMIN action, so this
 *     reconciliation does not invent one; whether that grant needs a distinct
 *     permission is an OWNER decision.
 */
router.put('/:id', requirePermission('USERS', 'UPDATE'), canUpdateUser, authorizeFacilityAssignment, async (req, res, next) => {
  try {
    const { username, email, full_name, role, is_active, password, is_organization_admin } = req.body;
    // `canUpdateUser` authorized this exact record; reuse it so the record that
    // was authorized is the record that is written.
    const { User } = require('../models');
    const targetUser = req.targetUser;
    const id = Number(targetUser.id);
    const currentUserId = Number(req.user.id);
    const currentUserRole = req.user.role;
    const currentUserIsOrgAdmin = req.user.is_organization_admin;

    // `is_active` is a boolean control, so a non-boolean spelling must not be
    // written: the database would coerce `'true'`, while the self-deactivation
    // check and the reactivation branch below compare strictly and would both
    // read it as false, skipping the control. The accepted spellings are the
    // JSON booleans the shipped UI sends, plus their string forms for
    // form-encoded callers; anything else is refused with no write.
    const requestedIsActive = is_active === undefined
      ? undefined
      : (is_active === true || is_active === 'true' ? true
        : (is_active === false || is_active === 'false' ? false : null));

    if (requestedIsActive === null) {
      return res.status(400).json({
        success: false,
        message: 'Invalid is_active'
      });
    }

    // `is_organization_admin` is normalized for the same reason: the
    // self-demotion guard and the escalate-only-to-an-organization-admin guard
    // below compare strictly, so a coerced spelling must not slip past them.
    const requestedOrgAdmin = is_organization_admin === undefined
      ? undefined
      : (is_organization_admin === true || is_organization_admin === 'true' ? true
        : (is_organization_admin === false || is_organization_admin === 'false' ? false : null));

    if (requestedOrgAdmin === null) {
      return res.status(400).json({
        success: false,
        message: 'Invalid is_organization_admin'
      });
    }

    // Prevent users from changing their own role or active status
    if (id === currentUserId) {
      if (role && role !== currentUserRole) {
        return res.status(403).json({
          success: false,
          message: 'Cannot change your own role'
        });
      }
      if (requestedIsActive === false) {
        return res.status(403).json({
          success: false,
          message: 'Cannot deactivate your own account'
        });
      }
      // Prevent self-demotion from org admin
      if (requestedOrgAdmin === false && currentUserIsOrgAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Cannot remove your own organization admin privileges'
        });
      }
    }

    // Security: Only organization admins can:
    // 1. Promote users to admin role
    // 2. Demote admins to other roles
    // 3. Grant/revoke organization admin privileges
    if (role === 'admin' || targetUser.role === 'admin' || requestedOrgAdmin !== undefined) {
      if (!currentUserIsOrgAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only organization administrators can modify admin privileges'
        });
      }
    }

    // Seat validation: the branch is driven by the activation this request
    // actually performs, not by the raw body. `status` is not a writable field
    // on this route, so `is_active` is the only activation control.
    const effectiveIsActive = requestedIsActive !== undefined
      ? requestedIsActive
      : targetUser.is_active === true;

    const isReactivating = effectiveIsActive === true
      && ['suspended', 'archived'].includes(targetUser.status)
      && targetUser.is_billable === true;

    if (isReactivating) {
      const { OrganizationSubscription } = require('../models');
      const organizationId = req.user.organization_id;

      const subscription = await OrganizationSubscription.getWithPlan(organizationId);
      if (!subscription || !['active', 'trial'].includes(subscription.status)) {
        return res.status(403).json({
          success: false,
          message: 'Subscription is not active. Cannot reactivate user.',
          code: 'SUBSCRIPTION_INACTIVE'
        });
      }

      await OrganizationSubscription.updateSeatUsage(organizationId);
      const seatCheck = await OrganizationSubscription.hasAvailableSeats(organizationId, 1);

      if (!seatCheck.allowed) {
        return res.status(403).json({
          success: false,
          message: 'Cannot reactivate user. Seat limit reached. Please add more seats or upgrade your plan.',
          code: 'SEAT_LIMIT_REACHED',
          seats_available: seatCheck.seatsAvailable,
          can_add_seats: true
        });
      }
    }

    // Only fields the request actually provided are written. An omitted field is
    // left at its persisted value; it is never written as NULL.
    const updateData = {};
    if (username !== undefined) updateData.username = username;
    if (email !== undefined) updateData.email = email;
    if (full_name !== undefined) updateData.full_name = full_name;
    if (role !== undefined) updateData.role = role;
    if (req.facilityAssignment.provided) {
      // `authorizeFacilityAssignment` normalized and authorized this value.
      updateData.facility_id = req.facilityAssignment.facilityId;
    }
    if (requestedIsActive !== undefined) updateData.is_active = requestedIsActive;

    // Only org admins can set is_organization_admin flag
    if (requestedOrgAdmin !== undefined && currentUserIsOrgAdmin) {
      updateData.is_organization_admin = requestedOrgAdmin;
    }

    // If password provided, hash it
    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No updatable fields were provided'
      });
    }

    const user = await User.update(id, updateData);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: sanitizeUser(user) }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete user (administrators only, within their own organization).
 *
 * ATM-001-SEC-00B, reconciled into the users lane by ATM-001-SEC-LEGACY-01-R3:
 * this route previously relied on `requireAdmin`, which admits a supervisor as
 * well as an administrator (src/middleware/auth.js) and applied no organization
 * or facility predicate, so a supervisor of one tenant could delete another
 * tenant's user - demonstrated live. It now applies the approved USERS.DELETE
 * contract (admin 'all', supervisor 'none', operator 'none') and then the shared
 * tenant boundary (`canDeleteUser` -> `authorizeUserScope`).
 *
 * The deletion itself is scoped: `deleteForOrganization` carries the tenant
 * predicate into the destructive statement, so the effect of the delete cannot
 * outlive a change to the authorization layer above it. A target that no longer
 * exists, or that was never in the caller's organization, yields the same 404
 * the guard produces - never a success and never a distinguishing error.
 */
router.delete('/:id', requirePermission('USERS', 'DELETE'), canDeleteUser, async (req, res, next) => {
  try {
    const id = Number(req.targetUser.id);

    // Prevent deleting self
    if (id === Number(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const deleted = await User.deleteForOrganization(id, req.user.organization_id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
