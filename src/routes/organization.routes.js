/**
 * Organization Routes
 * Multi-tenant organization management endpoints
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { resolveOrganization } = require('../middleware/tenant');
const organizationController = require('../controllers/organization.controller');

// Public route - get organizations for signup
router.get('/public', organizationController.getPublicOrganizations);

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/organizations
 * @desc    Get all organizations (system admin only)
 * @access  Private (Admin)
 */
router.get('/', requireAdmin, organizationController.getAll);

/**
 * @route   POST /api/organizations
 * @desc    Create new organization (system admin only)
 * @access  Private (Admin)
 */
router.post('/', requireAdmin, organizationController.create);

/**
 * @route   GET /api/organizations/my
 * @desc    Get current user's organization
 * @access  Private
 */
router.get('/my', resolveOrganization, organizationController.getMyOrganization);

/**
 * @route   GET /api/organizations/:id
 * @desc    Get organization by ID
 * @access  Private (Own org or System Admin)
 */
router.get('/:id', resolveOrganization, organizationController.getById);

/**
 * @route   PUT /api/organizations/:id
 * @desc    Update organization
 * @access  Private (Own org admin or System Admin)
 */
router.put('/:id', resolveOrganization, organizationController.update);

/**
 * @route   PUT /api/organizations/:id/subscription
 * @desc    Update organization subscription (system admin only)
 * @access  Private (Admin)
 */
router.put('/:id/subscription', requireAdmin, organizationController.updateSubscription);

/**
 * @route   GET /api/organizations/:id/stats
 * @desc    Get organization usage stats
 * @access  Private (Own org or System Admin)
 */
router.get('/:id/stats', resolveOrganization, organizationController.getUsageStats);

/**
 * @route   DELETE /api/organizations/:id
 * @desc    Organization deletion - DENIED FOR EVERY CALLER (ATM-001-SEC-00C)
 * @access  Denied (fail-closed containment)
 *
 * ATM-001-SEC-00C emergency containment. This endpoint is denied until the
 * OWNER approves a permanent organization-deletion policy. The denial is
 * decided here, before any controller or model call, so a request to this
 * route neither reads nor modifies an organization, a user, or any cascaded
 * record.
 *
 * Defect being contained: the route was guarded by `requireAdmin`, which
 * admits a supervisor (src/middleware/auth.js), and the controller applied no
 * tenant predicate, so an authenticated supervisor could delete a foreign
 * organization and - through `users.organization_id REFERENCES
 * organizations(id) ON DELETE CASCADE` (database/postgresql/001_core.sql) -
 * every user in it.
 *
 * No role is exempt: not operator, not supervisor, not tenant administrator,
 * and not any future platform administrator. No approved architecture record
 * authorises organization deletion (ATM-003-R1 admits no organization-delete
 * capability), so there is nothing to permit. The response is identical for
 * every identifier, including malformed and non-existent ones, and carries no
 * organization data, so it cannot disclose what exists.
 *
 * `organizationController.remove` and `Organization.delete` are deliberately
 * left intact but are unreachable from HTTP; restoring deletion requires an
 * OWNER-approved policy, not a configuration change.
 */
const denyOrganizationDeletion = (req, res) => {
  res.status(403).json({
    success: false,
    code: 'ORGANIZATION_DELETION_DISABLED',
    message: 'Organization deletion is disabled'
  });
};

router.delete('/:id', denyOrganizationDeletion);

/**
 * @route   POST /api/organizations/logo
 * @desc    Upload organization logo (paid plans only)
 * @access  Private (Org Admin)
 */
router.post('/logo', resolveOrganization, organizationController.uploadLogo);

module.exports = router;
