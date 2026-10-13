/**
 * Organization Controller
 * Multi-tenant organization management
 */

const { Organization, User } = require('../models');
const { hashPassword } = require('../utils/helpers');
const subscriptionService = require('../services/subscription.service');

/**
 * The organization-profile fields a tenant-scoped principal may change.
 *
 * ATM-001-SEC-104 policy 3. This is an explicit ALLOWLIST, replacing the raw
 * `{ ...req.body }` spread and its five-key denylist. Everything not listed is
 * unrepresentable in the UPDATE statement, so these can never be reached by a
 * tenant administrator through this route:
 *
 *   subscription_plan, subscription_status, subscription_id — subscription
 *   max_users, max_facilities, max_equipment              — capacity
 *   id                                                    — the primary key
 *   created_at, updated_at                                — server-owned
 *
 * The list is exactly the non-subscription, non-capacity profile columns of
 * `organizations` (database/postgresql/001_core.sql). It preserves the
 * legitimate self-service profile edit already performed by
 * views/mobile/admin/organization.ejs (organization_name, industry,
 * billing_email, phone).
 */
const TENANT_EDITABLE_ORGANIZATION_FIELDS = Object.freeze([
  'organization_name',
  'industry',
  'billing_email',
  'billing_address',
  'phone',
  'logo_url'
]);

/**
 * Partition a request body into the fields a tenant principal may change and
 * the fields it may not.
 *
 * `Object.prototype.hasOwnProperty` is used deliberately: an inherited or
 * prototype-polluted key is not a submitted field, and only own properties are
 * considered.
 */
const partitionOrganizationProfileFields = (body) => {
  const permitted = {};
  const refused = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { permitted, refused };
  }

  for (const key of Object.keys(body)) {
    if (TENANT_EDITABLE_ORGANIZATION_FIELDS.includes(key)) {
      permitted[key] = body[key];
    } else {
      refused.push(key);
    }
  }

  return { permitted, refused };
};

/**
 * Get all organizations (system admin only)
 */
const getAll = async (req, res, next) => {
  try {
    const { subscription_status, subscription_plan } = req.query;
    
    const filters = {};
    if (subscription_status) filters.subscription_status = subscription_status;
    if (subscription_plan) filters.subscription_plan = subscription_plan;
    
    const organizations = await Organization.getAllWithStats(filters);
    
    res.json({
      success: true,
      data: { organizations }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get public organizations list (for signup page)
 * Returns organizations with minimal info
 */
const getPublicOrganizations = async (req, res, next) => {
  try {
    // Get all organizations
    const sql = `
      SELECT id, organization_name
      FROM organizations
      ORDER BY organization_name ASC
    `;
    const organizations = await Organization.query(sql);
    
    res.json({
      success: true,
      data: { organizations }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get organization by ID
 * Users can only view their own organization.
 *
 * Tenant scope is enforced by `requireOwnOrganization` in the route chain,
 * before this controller runs (ATM-001-SEC-104 policy 4). The former
 * `parseInt(id) !== userOrgId && userRole !== 'admin'` check is deliberately
 * gone: its `userRole !== 'admin'` disjunct was a full cross-tenant read
 * bypass, and duplicating a weaker check here would leave that defect latent.
 */
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const organization = await Organization.findByIdWithStats(id);
    
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    res.json({
      success: true,
      data: { organization }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user's organization
 */
const getMyOrganization = async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'User is not associated with an organization'
      });
    }
    
    const organization = await Organization.findByIdWithStats(organizationId);
    const usage = await Organization.getUsageStats(organizationId);
    
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    res.json({
      success: true,
      data: { 
        organization: {
          ...organization,
          usage
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new organization (system admin only)
 * Also creates the first admin user for the organization
 */
const create = async (req, res, next) => {
  try {
    const { 
      organization_name, 
      subscription_plan = 'basic',
      subscription_status = 'active',
      billing_email,
      max_users = 10,
      max_facilities = 5,
      max_equipment = 100,
      admin_username,
      admin_email,
      admin_password,
      admin_full_name
    } = req.body;

    // Validate required fields
    if (!organization_name) {
      return res.status(400).json({
        success: false,
        message: 'Organization name is required'
      });
    }

    if (!admin_username || !admin_email || !admin_password || !admin_full_name) {
      return res.status(400).json({
        success: false,
        message: 'Admin details (username, email, password, full_name) are required'
      });
    }

    // Check if admin username exists
    const existingUsername = await User.findByUsername(admin_username);
    if (existingUsername) {
      return res.status(409).json({
        success: false,
        message: 'Admin username already exists'
      });
    }

    // Check if admin email exists
    const existingEmail = await User.findByEmail(admin_email);
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: 'Admin email already exists'
      });
    }

    // Create organization
    const organization = await Organization.create({
      organization_name,
      subscription_plan,
      subscription_status,
      billing_email,
      max_users,
      max_facilities,
      max_equipment
    });

    // Create admin user for the organization
    const passwordHash = await hashPassword(admin_password);
    const admin = await User.create({
      username: admin_username,
      email: admin_email,
      password_hash: passwordHash,
      full_name: admin_full_name,
      role: 'admin',
      organization_id: organization.id,
      is_organization_admin: true,
      is_active: true
    });

    res.status(201).json({
      success: true,
      message: 'Organization created successfully',
      data: { 
        organization,
        admin: {
          id: admin.id,
          username: admin.username,
          email: admin.email,
          full_name: admin.full_name
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update organization
 *
 * Authority: `requireOwnOrganization` + `requireCapability('org.config_admin')`
 * in the route chain (ATM-001-SEC-104 policies 2 and 3). This controller only
 * decides which profile fields the request may carry.
 *
 * The body is partitioned against `TENANT_EDITABLE_ORGANIZATION_FIELDS`. A
 * request that asks for any field outside the allowlist is refused whole rather
 * than partially applied: silently dropping a subscription or capacity field
 * would let a caller believe a change it is not authorised to make had been
 * considered, and the refusal is what makes the field-level denial observable.
 */
const update = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { permitted, refused } = partitionOrganizationProfileFields(req.body);

    if (refused.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'ORGANIZATION_UPDATE_FIELD_NOT_PERMITTED',
        message: `These organization fields cannot be changed through this endpoint: ${refused.join(', ')}`
      });
    }

    if (Object.keys(permitted).length === 0) {
      return res.status(400).json({
        success: false,
        code: 'ORGANIZATION_UPDATE_NO_FIELDS',
        message: 'No editable organization profile fields were provided'
      });
    }

    const organization = await Organization.update(id, permitted);
    
    res.json({
      success: true,
      message: 'Organization updated successfully',
      data: { organization }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update organization subscription (system admin only)
 */
const updateSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subscription_plan, subscription_status, max_users, max_facilities, max_equipment } = req.body;
    
    const updateData = {};
    if (subscription_plan) updateData.subscription_plan = subscription_plan;
    if (subscription_status) updateData.subscription_status = subscription_status;
    if (max_users) updateData.max_users = max_users;
    if (max_facilities) updateData.max_facilities = max_facilities;
    if (max_equipment) updateData.max_equipment = max_equipment;
    
    const organization = await Organization.update(id, updateData);
    
    res.json({
      success: true,
      message: 'Subscription updated successfully',
      data: { organization }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete organization (system admin only)
 */
const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Prevent deleting the default organization (id=1)
    if (parseInt(id) === 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the default organization'
      });
    }
    
    await Organization.delete(id);
    
    res.json({
      success: true,
      message: 'Organization deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get organization usage stats
 *
 * Tenant scope is enforced by `requireOwnOrganization` in the route chain,
 * before this controller runs (ATM-001-SEC-104 policy 4). The former
 * `userRole !== 'admin'` disjunct was a full cross-tenant statistics bypass.
 */
const getUsageStats = async (req, res, next) => {
  try {
    const { id } = req.params;

    const stats = await Organization.getUsageStats(id);
    
    if (!stats) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    // Get limits from subscription service (not from organization table)
    const billingInfo = await subscriptionService.getBillingInfo(id);
    const planCode = billingInfo?.plan?.code || 'free';
    
    // For unlimited plans (Enterprise), use null. For others, use plan limits
    const planHasUnlimited = planCode === 'enterprise' || planCode === 'utility';
    
    // Use plan limits. For unlimited plans, these will be null
    const limits = {
      max_users: planHasUnlimited ? null : (billingInfo?.plan?.max_users ?? 5),
      max_facilities: planHasUnlimited ? null : (billingInfo?.plan?.max_facilities ?? 1),
      max_equipment: planHasUnlimited ? null : (billingInfo?.plan?.max_equipment ?? 10)
    };
    
    // Calculate percentages (0% for unlimited plans)
    const usagePercentages = {
      users: limits.max_users > 0 ? Math.round((stats.user_count / limits.max_users) * 100) : 0,
      facilities: limits.max_facilities > 0 ? Math.round((stats.facility_count / limits.max_facilities) * 100) : 0,
      equipment: limits.max_equipment > 0 ? Math.round((stats.equipment_count / limits.max_equipment) * 100) : 0
    };

    res.json({
      success: true,
      data: { 
        stats: {
          ...stats,
          limits: {
            max_users: limits.max_users,
            max_facilities: limits.max_facilities,
            max_equipment: limits.max_equipment
          },
          usage_percentages: usagePercentages
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Upload organization logo
 * Only for paid plans
 */
const uploadLogo = async (req, res, next) => {
  try {
    const organizationId = req.user.organization_id;
    
    // Check if paid plan
    const billingInfo = await subscriptionService.getBillingInfo(organizationId);
    const planCode = billingInfo?.plan?.code || 'free';
    
    if (planCode === 'free') {
      return res.status(403).json({
        success: false,
        message: 'Logo upload requires a paid subscription'
      });
    }
    
    // For now, just store the base64 data URL in the database
    // In production, you'd upload to S3/cloud storage
    if (!req.body.logo && !req.file) {
      return res.status(400).json({
        success: false,
        message: 'No logo provided'
      });
    }
    
    // If using multer, req.file would exist
    // For now, we expect base64 from the client
    let logoUrl = req.body.logo;
    
    // Limit size (2MB)
    if (logoUrl && logoUrl.length > 2 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'Logo must be less than 2MB'
      });
    }
    
    // Update organization with logo URL
    await Organization.update(organizationId, { logo_url: logoUrl });
    
    res.json({
      success: true,
      message: 'Logo uploaded successfully',
      data: { logo_url: logoUrl }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAll,
  getPublicOrganizations,
  getById,
  getMyOrganization,
  create,
  update,
  updateSubscription,
  remove,
  getUsageStats,
  uploadLogo,
  // Exposed for the ATM-001-SEC-104 suite: the allowlist is the authority for
  // field-level authorization, so it must be assertable directly.
  TENANT_EDITABLE_ORGANIZATION_FIELDS
};
