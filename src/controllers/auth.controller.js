/**
 * Authentication Controller
 * Multi-tenant aware authentication
 */

const jwt = require('jsonwebtoken');
const authConfig = require('../config/auth');
const { User, Organization, OrganizationSubscription } = require('../models');
const subscriptionService = require('../services/subscription.service');
const { hashPassword, comparePassword, sanitizeUser } = require('../utils/helpers');

/**
 * Generate JWT token
 * @param {Object} user
 * @returns {string}
 */
const generateToken = (user) => {
  return jwt.sign(
    { 
      userId: user.id, 
      organizationId: user.organization_id,
      role: user.role,
      isOrgAdmin: user.is_organization_admin
    },
    authConfig.jwt.secret,
    { expiresIn: authConfig.jwt.expiresIn }
  );
};

/**
 * Login user
 * Supports login by username, email, or phone number
 */
const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Try to find user by username first, then by email/phone
    let user = await User.findByUsername(username);
    
    if (!user) {
      // Try to find by email or phone
      user = await User.findByEmailOrPhone(username);
    }
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username, email, phone, or password'
      });
    }

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is disabled'
      });
    }

    // Check if organization is active (if user belongs to an organization)
    if (user.organization_id) {
      const isOrgActive = await Organization.isActive(user.organization_id);
      if (!isOrgActive) {
        return res.status(403).json({
          success: false,
          message: 'Organization is not active'
        });
      }
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Update last login
    await User.updateLastLogin(user.id);

    // Get fresh user data with organization info
    const sql = `
      SELECT u.*, o.organization_name
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.id = ?
    `;
    const [userWithOrg] = await User.query(sql, [user.id]);

    // Generate token
    const token = generateToken(userWithOrg);

    // Set cookie
    res.cookie(authConfig.cookie.name, token, authConfig.cookie.options);

    // Return success with user data
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: sanitizeUser(userWithOrg),
        token,
        organization_id: userWithOrg.organization_id
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Public signup (self-registration)
 * Allows signup with email OR phone number (or both)
 */
const signup = async (req, res, next) => {
  try {
    let { username, email, password, full_name, phone, role, organization_id } = req.body;
    
    // Normalize empty strings to null
    email = email || null;
    phone = phone || null;

    // Validate required fields
    if (!username || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, and full name are required'
      });
    }

    // Validate that at least one contact method is provided
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone number is required'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    // Check if username exists (globally for now)
    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: 'Username already exists'
      });
    }

    // Check if email exists (if provided)
    if (email) {
      const existingEmail = await User.findByEmail(email);
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: 'Email already exists'
        });
      }
    }

    // Check if phone exists (if provided)
    if (phone) {
      const existingPhone = await User.findByPhone(phone);
      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message: 'Phone number already exists'
        });
      }
    }

    // Restrict self-registration to operator and supervisor only
    // Admin accounts must be created by existing admins
    const allowedRoles = ['operator', 'supervisor'];
    const userRole = allowedRoles.includes(role) ? role : 'operator';

    // Hash password
    const passwordHash = await hashPassword(password);

    // Use selected organization or default to org 1
    const targetOrgId = organization_id ? parseInt(organization_id) : 1;

    // Check if organization exists
    const org = await Organization.findById(targetOrgId);
    if (!org) {
      return res.status(404).json({
        success: false,
        message: 'Selected organization not found'
      });
    }

    // Check seat availability for the target organization
    const canAdd = await subscriptionService.canAddUser(targetOrgId);
    if (!canAdd) {
      return res.status(403).json({
        success: false,
        message: 'This organization has reached its seat limit. Please contact the organization admin.',
        code: 'SEAT_LIMIT_REACHED'
      });
    }

    // Create user
    const user = await User.create({
      username,
      email,
      password_hash: passwordHash,
      full_name,
      phone,
      role: userRole,
      organization_id: targetOrgId,
      is_active: true,
      status: 'active',
      is_billable: true
    });

    // Update seat usage
    await subscriptionService.recalculateSeats(targetOrgId);

    res.status(201).json({
      success: true,
      message: 'Account created successfully. Please sign in.',
      data: { user: sanitizeUser(user) }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Register new user (admin only, within same organization)
 */
const register = async (req, res, next) => {
  try {
    const { username, email, password, full_name, phone, role } = req.body;

    // Get admin's organization
    const organizationId = req.user.organization_id;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Admin must belong to an organization'
      });
    }

    // Check if username exists in this organization
    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: 'Username already exists'
      });
    }

    // Check if email exists in this organization
    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: 'Email already exists'
      });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user in same organization as admin
    const user = await User.create({
      username,
      email,
      password_hash: passwordHash,
      full_name,
      phone,
      role: role || 'operator',
      organization_id: organizationId,
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
};

/**
 * Logout user
 */
const logout = (req, res) => {
  res.clearCookie(authConfig.cookie.name);
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

/**
 * Get current user profile
 */
const getProfile = async (req, res, next) => {
  try {
    // Include organization info
    const sql = `
      SELECT u.*, o.organization_name, o.subscription_plan, o.subscription_status
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.id = ?
    `;
    const [user] = await User.query(sql, [req.user.id]);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      data: { user: sanitizeUser(user) }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update user profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { full_name, phone, email } = req.body;
    
    const updateData = {};
    if (full_name) updateData.full_name = full_name;
    if (phone) updateData.phone = phone;
    if (email) updateData.email = email;

    const user = await User.update(req.user.id, updateData);
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: sanitizeUser(user) }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Change password
 */
const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    // Verify current password
    const user = await User.findById(req.user.id);
    const isValid = await comparePassword(current_password, user.password_hash);
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash and update new password
    const newHash = await hashPassword(new_password);
    await User.update(req.user.id, { password_hash: newHash });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Public organization signup
 *
 * INTENDED contract: create a new organization with the first user as
 * `role = 'admin'` / `is_organization_admin = true`, and assign a default Free
 * subscription.
 *
 * OBSERVED contract at this head (ATM-001-SEC-104-R3; verified live in
 * tests/organization-signup.integration.test.js): HTTP 500
 * `Cannot read properties of null (reading 'id')`, with ONE organization row
 * committed and ZERO users and ZERO subscriptions. Defect D-1 — `BaseModel.create`
 * reads `result.insertId`, which the PostgreSQL adapter never populates, so
 * `Organization.create` returns null after its INSERT has committed and the
 * handler throws on `organization.id` below. The failure is NOT rolled back.
 * This is pinned, not repaired: the fix belongs to the shared `BaseModel.create`
 * write path and is escalated to the OWNER. See the header of
 * src/routes/organization.routes.js.
 */
const organizationSignup = async (req, res, next) => {
  try {
    let { 
      organization_name,
      industry,
      username, 
      email, 
      password, 
      full_name, 
      phone 
    } = req.body;
    
    // Normalize empty strings to null
    email = email || null;
    phone = phone || null;

    // Validate required fields
    if (!organization_name || !username || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message: 'Organization name, username, password, and full name are required'
      });
    }
    
    // Validate industry selection
    if (!industry) {
      return res.status(400).json({
        success: false,
        message: 'Please select an industry for your organization'
      });
    }

    // Validate that at least one contact method is provided
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone number is required'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    // Check if username exists
    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: 'Username already exists'
      });
    }

    // Check if email exists (if provided)
    if (email) {
      const existingEmail = await User.findByEmail(email);
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: 'Email already exists'
        });
      }
    }

    // Check if phone exists (if provided)
    if (phone) {
      const existingPhone = await User.findByPhone(phone);
      if (existingPhone) {
        return res.status(409).json({
          success: false,
          message: 'Phone number already exists'
        });
      }
    }

    // Check if organization name exists
    const existingOrg = await Organization.findByName(organization_name);
    if (existingOrg) {
      return res.status(409).json({
        success: false,
        message: 'Organization name already exists'
      });
    }

    // Create organization
    const organization = await Organization.create({
      organization_name,
      industry: industry || 'other',
      billing_email: email || null
    });

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create admin user for the organization
    const admin = await User.create({
      username,
      email,
      password_hash: passwordHash,
      full_name,
      phone,
      role: 'admin',
      organization_id: organization.id,
      is_organization_admin: true,
      is_active: true,
      status: 'active',
      is_billable: true
    });

    // Get the Free plan
    const freePlan = await subscriptionService.getPlanByCode('free');
    
    if (freePlan) {
      // Create subscription for the organization
      await OrganizationSubscription.createForOrganization(
        organization.id,
        freePlan.id,
        {
          status: 'active',
          billing_cycle: 'monthly',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
        }
      );
      
      // Update organization with subscription reference
      await Organization.update(organization.id, {
        subscription_id: (await OrganizationSubscription.findByOrganization(organization.id))?.id
      });
    }

    // Get fresh user data with organization info for token
    const [adminWithOrg] = await User.query(`
      SELECT u.*, o.organization_name
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.id = ?
    `, [admin.id]);

    // Generate token for auto-login
    const token = generateToken(adminWithOrg);
    
    // Set cookie for web access
    res.cookie(authConfig.cookie.name, token, authConfig.cookie.options);

    res.status(201).json({
      success: true,
      message: 'Organization created successfully. Welcome!',
      data: { 
        organization: {
          id: organization.id,
          organization_name: organization.organization_name,
          industry: industry || 'other'
        },
        user: sanitizeUser(adminWithOrg),
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  signup,
  organizationSignup,
  register,
  logout,
  getProfile,
  updateProfile,
  changePassword
};
