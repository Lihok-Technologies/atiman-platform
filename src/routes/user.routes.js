/**
 * User Routes
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { User, Facility } = require('../models');
const { authenticate, requireAdmin, requireSupervisor } = require('../middleware/auth');
const { requirePermission, canCreateUser, canManageUser, getUserPermissions } = require('../middleware/rbac');
const { validateAvailableSeats, validateReactivation, checkSeatUsage } = require('../middleware/seat-validation');
const { getMyCapabilities } = require('../controllers/capability.controller');

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
      data: { users }
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
      data: { users: operators }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get user by ID - users can view their own, admins/supervisors can view users in their facility
 */
router.get('/:id', canManageUser, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      data: { user }
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
      data: { user }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Update user (admin and supervisor)
 * Admin can update any user
 * Supervisor can only update users in their facility
 */
router.put('/:id', canManageUser, async (req, res, next) => {
  try {
    const { username, email, full_name, role, facility_id, is_active, password, is_organization_admin } = req.body;
    const id = parseInt(req.params.id);
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    const currentUserIsOrgAdmin = req.user.is_organization_admin;
    
    // Get target user to check current role
    const { User } = require('../models');
    const targetUser = await User.findById(id);
    
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
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
      if (is_active === false) {
        return res.status(403).json({
          success: false,
          message: 'Cannot deactivate your own account'
        });
      }
      // Prevent self-demotion from org admin
      if (is_organization_admin === false && currentUserIsOrgAdmin) {
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
    if (role === 'admin' || targetUser.role === 'admin' || is_organization_admin !== undefined) {
      if (!currentUserIsOrgAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only organization administrators can modify admin privileges'
        });
      }
    }
    
    // Seat validation: Check if reactivating a suspended/archived user
    const isReactivating = (status === 'active' || is_active === true) && 
                           ['suspended', 'archived'].includes(targetUser.status) &&
                           targetUser.is_billable;
    
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
    
    const updateData = {
      username,
      email,
      full_name,
      role,
      facility_id: facility_id ? parseInt(facility_id) : null,
      is_active: is_active !== undefined ? is_active : true
    };
    
    // Only org admins can set is_organization_admin flag
    if (is_organization_admin !== undefined && currentUserIsOrgAdmin) {
      updateData.is_organization_admin = is_organization_admin;
    }
    
    // If password provided, hash it
    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10);
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
      data: { user }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete user (admin only)
 * Only admins can delete users
 */
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;
    
    // Prevent deleting self
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }
    
    await User.delete(id);
    
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
