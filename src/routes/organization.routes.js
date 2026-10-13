/**
 * Organization Routes
 * Multi-tenant organization management endpoints
 *
 * Authority model (ATM-001-SEC-104, five OWNER-approved V1 organization
 * security policies). Every route below states the authority it now uses:
 *
 *   GET  /public                public signup directory (unchanged, pre-auth)
 *   GET  /                      platform.admin      — cross-tenant listing
 *   POST /                      platform.admin      — provisioning
 *   GET  /my                    authenticated own tenant (no :id, unchanged)
 *   GET  /:id                   own tenant only     — strict tenant scope
 *   PUT  /:id                   org.config_admin + own tenant only
 *   PUT  /:id/subscription      platform.admin      — subscription authority
 *   GET  /:id/stats             own tenant only     — strict tenant scope
 *   DELETE /:id                 DENIED for every caller (containment)
 *   POST /logo                  org.config_admin + own tenant only
 *
 * Two authorities are used, both already in the approved ATM-003 vocabulary
 * (src/config/capabilities.js): `org.config_admin` is TENANT-scoped and
 * `platform.admin` is PLATFORM-scoped. No capability was invented and no role
 * was made human-grantable.
 *
 * ── What "fail-closed" does and does not mean here (F2 claim correction) ─────
 *
 * `platform.admin` is deliberately NOT human-grantable in V1
 * (NON_HUMAN_GRANTABLE in src/config/capabilities.js and the CHECK constraint in
 * database/postgresql/022_capability_grant_foundation.sql). Every route above
 * that requires it is therefore unreachable by a human principal: the
 * platform-scoped acts — administrative provisioning through THIS endpoint,
 * cross-tenant listing, and subscription/capacity change — have no admitted human
 * actor in V1. That is the intended outcome of policies 1 and 3.
 *
 * It is NOT true that "all human organization creation is prohibited in V1", and
 * an earlier version of this comment said exactly that. Tenant self-registration
 * exists, is approved, and is deliberately separate:
 *
 *   POST /api/auth/organization-signup  (src/routes/auth.routes.js)
 *
 * is the pre-authentication self-service tenant-registration endpoint reached by
 * views/signup.ejs. It is approved, it is deliberately anonymous, and it neither
 * requires nor should require `platform.admin`. Policy 1 restricts the
 * ADMINISTRATIVE provisioning endpoint — POST /api/organizations, which mints a
 * tenant under a caller-supplied plan, capacity and administrator password — not
 * self-service registration.
 *
 * CORRECTED CLAIM (ATM-001-SEC-104-R3). An earlier version of this comment said
 * the endpoint "creates an organization, its first administrator
 * (`role = 'admin'`, `is_organization_admin = true`) and a default Free
 * subscription". That is FALSE at this head and has been removed. Verified by
 * live request against disposable PostgreSQL
 * (tests/organization-signup.integration.test.js): an anonymous
 * POST /api/auth/organization-signup answers HTTP 500
 * `Cannot read properties of null (reading 'id')` and PERSISTS ONE ORGANIZATION
 * ROW WITH ZERO USERS AND ZERO SUBSCRIPTIONS. The cause is defect D-1:
 * `BaseModel.create` (src/models/base.model.js) reads `result.insertId`, which
 * the PostgreSQL adapter never populates, so `Organization.create` returns null
 * after its INSERT has already committed and the handler throws at
 * `organization.id`. The write is not rolled back, so the endpoint is
 * non-atomic, and the orphan permanently blocks re-registration of the same
 * organization name (HTTP 409 "Organization name already exists").
 *
 * Intended contract (NOT observed at this head, and deliberately NOT repaired
 * here): a 201 that creates the organization, its first administrator with
 * `role = 'admin'` and `is_organization_admin = true`, and a default Free
 * subscription, atomically. Repairing D-1 changes the shared write-path
 * semantics of every `BaseModel.create` caller, which is outside this mission's
 * envelope, so it is PROPOSED and escalated to the OWNER rather than silently
 * applied. The endpoint stays mounted: disabling approved self-service
 * onboarding is not a policy-1 outcome.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { resolveOrganization, requireOwnOrganization } = require('../middleware/tenant');
const { requireCapability } = require('../middleware/capability.middleware');
const organizationController = require('../controllers/organization.controller');

/**
 * Public route - get organizations for signup.
 *
 * Deliberately anonymous and deliberately still anonymous: it is the pre-auth
 * signup directory consumed by views/signup.ejs, it returns only an id and an
 * organization_name, and it carries no tenant-, subscription- or
 * capacity-scoped field. It is a public surface, not a tenant-scoped read, so
 * policy 4's tenant isolation does not reach it and restricting it would remove
 * a business behaviour none of the five policies authorises removing.
 */
router.get('/public', organizationController.getPublicOrganizations);

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/organizations
 * @desc    List every organization with stats (platform-scoped, cross-tenant)
 * @access  Private (platform.admin)
 *
 * Policy 4 (tenant isolation, listing). This is a cross-tenant aggregate: it
 * returns every tenant's billing and capacity fields. No tenant-scoped
 * principal may reach it, and there is no tenant-scoped form of it, so the
 * authority is the platform-scoped capability.
 */
router.get('/', requireCapability('platform.admin'), organizationController.getAll);

/**
 * @route   POST /api/organizations
 * @desc    Create new organization and its first administrator
 * @access  Private (platform.admin)
 *
 * Policy 1 (restrict ADMINISTRATIVE organization creation to platform.admin).
 * The legacy `requireAdmin` guard admitted `supervisor` as well as `admin`
 * (src/middleware/auth.js:62-70), and the controller then minted a first user
 * with role 'admin' and is_organization_admin true under a caller-supplied
 * password — tenant provisioning performed by a tenant principal. Provisioning
 * is a platform-scoped act, so it now requires the platform-scoped capability.
 *
 * This is not a prohibition on tenant self-registration: the approved
 * self-service endpoint POST /api/auth/organization-signup (see the header) is a
 * different act, on a different route, and remains available to anonymous
 * signup.
 */
router.post('/', requireCapability('platform.admin'), organizationController.create);

/**
 * @route   GET /api/organizations/my
 * @desc    Get current user's organization
 * @access  Private
 *
 * Already tenant-exact: the controller reads req.user.organization_id and
 * accepts no identifier, so no cross-tenant address exists. Unchanged.
 */
router.get('/my', resolveOrganization, organizationController.getMyOrganization);

/**
 * @route   GET /api/organizations/:id
 * @desc    Get organization by ID
 * @access  Private (own organization only)
 *
 * Policy 4 (tenant isolation, reading). The removed controller disjunct
 * `userRole !== 'admin'` let any administrator read any tenant. The strict
 * tenant predicate now runs before any model call, so a foreign id and an
 * absent id are refused identically.
 */
router.get('/:id', resolveOrganization, requireOwnOrganization, organizationController.getById);

/**
 * @route   PUT /api/organizations/:id
 * @desc    Update the caller's own organization profile
 * @access  Private (org.config_admin + own organization only)
 *
 * Policy 2 (org.config_admin + strict tenant scope) and policy 3 (a tenant
 * administrator may not change subscription or capacity fields). The route had
 * NO role gate at all — only a controller disjunct with a full cross-tenant
 * `userRole !== 'admin'` bypass — and spread req.body straight into the UPDATE.
 * The tenant predicate is evaluated before the capability resolver so a foreign
 * identifier is refused without a lookup, and the controller now filters the
 * body through an explicit profile allowlist.
 */
router.put(
  '/:id',
  resolveOrganization,
  requireOwnOrganization,
  requireCapability('org.config_admin'),
  organizationController.update
);

/**
 * @route   PUT /api/organizations/:id/subscription
 * @desc    Change an organization's subscription plan, status or limits
 * @access  Private (platform.admin)
 *
 * Policy 3 (prevent tenant administrators from changing subscription and
 * capacity fields). The route was `requireAdmin` with no ownership check, so
 * any tenant administrator OR supervisor could rewrite any tenant's plan and
 * limits. Subscription and capacity are neither profile nor tenant-scoped:
 * they are platform-scoped provisioning, so the platform authority is
 * required and no tenant-scoped principal — administrator included — can
 * reach these fields here.
 */
router.put(
  '/:id/subscription',
  requireCapability('platform.admin'),
  organizationController.updateSubscription
);

/**
 * @route   GET /api/organizations/:id/stats
 * @desc    Get organization usage stats
 * @access  Private (own organization only)
 *
 * Policy 4 (tenant isolation, statistics). Same removal of the `admin`
 * cross-tenant bypass as GET /:id, enforced before the model or the billing
 * lookup runs.
 */
router.get('/:id/stats', resolveOrganization, requireOwnOrganization, organizationController.getUsageStats);

/**
 * @route   DELETE /api/organizations/:id
 * @desc    Organization deletion - DENIED FOR EVERY CALLER (ATM-001-SEC-00C)
 * @access  Denied (fail-closed containment)
 *
 * ATM-001-SEC-00C emergency containment, preserved unchanged by
 * ATM-001-SEC-104 policy 5 (disable direct organization deletion in V1). This
 * endpoint is denied until the OWNER approves a permanent organization-deletion
 * policy. The denial is decided here, before any controller or model call, so a
 * request to this route neither reads nor modifies an organization, a user, or
 * any cascaded record.
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
 * @access  Private (org.config_admin)
 *
 * Policy 4 (tenant isolation, logo management) and policy 2 (logo_url is an
 * organization profile field). The `org.config_admin` requirement is what the
 * route was missing — it had no role gate at all, so any authenticated operator
 * could rewrite the organization logo. The paid-plan check is unchanged.
 *
 * There is no `:id` on this route, so tenant scope is enforced in the handler:
 * the write target is `req.user.organization_id`, and a body that addresses a
 * DIFFERENT organization is refused with 403 rather than ignored
 * (ATM-001-SEC-104-R2 F4). The suite's cross-tenant logo case exists precisely so
 * that making this handler honour `req.body.organization_id` — which would be a
 * full cross-tenant logo write — cannot pass unnoticed.
 */
router.post('/logo', resolveOrganization, requireCapability('org.config_admin'), organizationController.uploadLogo);

module.exports = router;
