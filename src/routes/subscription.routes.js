/**
 * Subscription Routes
 * Organization subscription management and billing
 *
 * Authority model (ATM-001-SEC-104 policies 3 and 4; ATM-001-SEC-104-R2 F1).
 *
 * Subscription and capacity state is PLATFORM-scoped provisioning. The approved
 * ATM-003 vocabulary has exactly one platform-scoped capability — `platform.admin`
 * ("Provisioning, cross-tenant health, platform configuration", ATM-003-R1 §3.3)
 * — and it is deliberately NOT human-grantable in V1 (NON_HUMAN_GRANTABLE in
 * src/config/capabilities.js). The four routes listed below therefore require it,
 * and each is accordingly unreachable by any human principal:
 *
 *   PUT  /plan                        platform.admin  (plan + capacity)
 *   PUT  /extra-users                 platform.admin  (capacity lever)
 *   GET  /admin/organizations/:id     platform.admin  (cross-tenant read)
 *   PUT  /admin/organizations/:id     platform.admin  (cross-tenant plan/status/capacity)
 *
 * That is a statement about those four routes only. `POST /cancel` and
 * `POST /reactivate` also write subscription state and are deliberately NOT
 * platform-scoped — see the residual note below. No claim on this file covers
 * them.
 *
 * The routes that read or request state for the caller's OWN tenant keep working
 * for an authenticated principal (`GET /current`, `/plans`, `/seats`), and the
 * sanctioned paid-plan and extra-seat paths are unchanged: a tenant administrator
 * requests a change through POST /api/payments/checkout or
 * POST /api/payments/extra-seats (`requirePermission('SUBSCRIPTION','UPDATE')`,
 * admin only), the payment provider takes the money, and the signature-validated
 * webhook applies the change server-side through services/subscription.service.js
 * — which no route guard can weaken, because it is not an HTTP caller.
 *
 * `POST /cancel` and `POST /reactivate` are deliberately NOT changed here. They
 * are an out-of-scope residual (ATM-001-SEC-104-R2 §I): they still write
 * subscription state with only `authenticate`, the approved vocabulary contains no
 * subscription capability other than `platform.admin`, and applying `platform.admin`
 * would remove the tenant's sanctioned "cancel at period end" request workflow that
 * views/mobile/admin/subscription.ejs performs. Closing that gap needs an OWNER
 * decision (a tenant-scoped subscription-request capability, or platform-only
 * cancellation), not a silent mapping invented by this correction.
 *
 * The former guard on the two /admin routes was `requireAdmin`
 * (src/middleware/auth.js), which admits `supervisor` as well as `admin`, so any
 * tenant principal reached another tenant's billing; and the PUT route performed
 * its writes before failing, so a cross-tenant change persisted behind HTTP 500.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capability.middleware');
const subscriptionController = require('../controllers/subscription.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/subscriptions/current
 * @desc    Get current organization's subscription
 * @access  Private
 */
router.get('/current', subscriptionController.getCurrentSubscription);

/**
 * @route   GET /api/subscriptions/plans
 * @desc    Get available subscription plans
 * @access  Private
 */
router.get('/plans', subscriptionController.getPlans);

/**
 * @route   GET /api/subscriptions/seats
 * @desc    Get seat usage
 * @access  Private
 */
router.get('/seats', subscriptionController.getSeatUsage);

/**
 * @route   PUT /api/subscriptions/plan
 * @desc    Change the caller's organization subscription plan
 * @access  Private (platform.admin)
 *
 * Policy 3. The route had NO role guard at all — only `authenticate` — so a
 * tenant operator, supervisor or administrator could rewrite its own
 * `organization_subscriptions` row (plan, included/max users, max facilities,
 * max equipment, base price) and persist it. A plan change is provisioning, so
 * the platform-scoped capability is required. The tenant is taken from
 * `req.user.organization_id` in the controller, so there is no cross-tenant
 * address here; the boundary is who may take the act at all.
 */
router.put('/plan', requireCapability('platform.admin'), subscriptionController.changePlan);

/**
 * @route   PUT /api/subscriptions/extra-users
 * @desc    Set the caller's organization extra-users count
 * @access  Private (platform.admin)
 *
 * Policy 3. Also unguarded before this correction. `extra_users` is a paid
 * capacity lever (`totalAllowedUsers = included_users + extra_users`), so an
 * operator could buy seats without paying — an unauthorized capacity increase,
 * not merely a settings edit.
 */
router.put('/extra-users', requireCapability('platform.admin'), subscriptionController.setExtraUsers);

/**
 * @route   POST /api/subscriptions/cancel
 * @desc    Cancel subscription at period end
 * @access  Private (Organization Admin)
 *
 * UNCHANGED — see the header. Tenant-side cancellation-request workflow; the
 * residual is escalated, not silently re-mapped.
 */
router.post('/cancel', subscriptionController.cancelSubscription);

/**
 * @route   POST /api/subscriptions/reactivate
 * @desc    Reactivate a cancelled subscription
 * @access  Private (Organization Admin)
 *
 * UNCHANGED — see the header. Note this one writes `status` (a protected field),
 * which is why the residual is recorded rather than dismissed.
 */
router.post('/reactivate', subscriptionController.reactivateSubscription);

// Platform-scoped (cross-tenant) routes

/**
 * @route   GET /api/subscriptions/admin/organizations/:id
 * @desc    Get subscription for any organization
 * @access  Private (platform.admin)
 *
 * Policy 4 (tenant isolation, reading). The former `requireAdmin` admitted a
 * tenant supervisor, so any supervisor could read any tenant's plan, price,
 * status and capacity. `:id` is a foreign tenant by definition, so the authority
 * is the platform-scoped capability, as on GET /api/organizations.
 */
router.get('/admin/organizations/:id', requireCapability('platform.admin'),
  subscriptionController.getOrganizationSubscription);

/**
 * @route   PUT /api/subscriptions/admin/organizations/:id
 * @desc    Update subscription for any organization
 * @access  Private (platform.admin)
 *
 * Policy 3 (F1). This is the cross-tenant form of the two routes above: the
 * tenant came straight from the URL with no ownership predicate, so any tenant
 * administrator — or supervisor — could rewrite a foreign tenant's plan,
 * capacity and status. Reproduced: a foreign administrator's request persisted
 * `extra_users` and then answered HTTP 500, because the controller called
 * `pool.execute` on the database MODULE instead of the pool (a defect that hid
 * the committed write behind an error). Both the authority and the defect are
 * corrected.
 */
router.put('/admin/organizations/:id', requireCapability('platform.admin'),
  subscriptionController.updateOrganizationSubscription);

module.exports = router;
