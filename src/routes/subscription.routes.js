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
 * `POST /reactivate` also write subscription state, but their authority is the
 * TENANT-scoped subscription authority recorded in the legacy resource/action
 * matrix (src/config/permissions.js), not the platform-scoped capability. No
 * claim about `platform.admin` covers them.
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
 * `POST /cancel` and `POST /reactivate` were, at candidate b795a04, an
 * out-of-scope residual (ATM-001-SEC-104-R2 §I): they wrote subscription state
 * with only `authenticate`, so any authenticated principal — tenant operator,
 * tenant supervisor or tenant administrator — could set `cancel_at_period_end`,
 * a cancellation reason, `cancelled_at` and `status = 'active'` on its own
 * tenant's row. An independent reviewer reproduced that by database effect: a
 * tenant OPERATOR reactivated a suspended subscription (status suspended ->
 * active) and persisted a cancellation request. ATM-001-SEC-104-R3 closes it
 * with the existing approved vocabulary, and does NOT use `platform.admin`,
 * because the tenant's sanctioned "cancel at period end" request
 * (views/mobile/admin/subscription.ejs) must keep working:
 *
 *   POST /cancel      requirePermission('SUBSCRIPTION', 'CANCEL')
 *   POST /reactivate  requirePermission('SUBSCRIPTION', 'UPDATE')
 *
 * Authority provenance (determined, not invented):
 *   * `SUBSCRIPTION.CANCEL` is an explicit action in the approved legacy matrix
 *     (src/config/permissions.js), `admin: 'all'`, `supervisor: 'none'`,
 *     `operator: 'none'`. It is the matrix's cancellation authority and is
 *     applied verbatim. The route's own `@access` line always said
 *     "Organization Admin"; the code simply never enforced it.
 *   * The approved CAPABILITY vocabulary contains no subscription capability at
 *     all (src/config/capabilities.js enumerates 21; ATM-003-R1 §3.3/§4 define
 *     no subscription capability and no subscription profile), so the legacy
 *     matrix is the only approved source that names an authority for these two
 *     acts. `SUBSCRIPTION.CANCEL` is NOT reused for reactivation — that would
 *     name the wrong act. Of the matrix's three SUBSCRIPTION actions, `VIEW` is
 *     read-only and `CANCEL` is the cancellation authority, so `UPDATE` is the
 *     remaining enumerated modification authority. It admits exactly the same
 *     principal set as `CANCEL` (`admin: 'all'` only), so the selection cannot
 *     broaden authority in either direction, and a tenant operator or
 *     supervisor is refused by an existing matrix entry rather than by a new
 *     role or a new capability.
 *
 * Both handlers take the tenant from `req.user.organization_id` and accept no
 * tenant identifier from the URL or body, so a cross-tenant subscription write
 * is not addressable at all; that is asserted directly in the suite.
 *
 * UNRESOLVED GOVERNANCE POINT, ESCALATED — NOT SILENTLY RECONCILED.
 * `POST /reactivate` sets `status = 'active'`. R2 (F1) treated subscription
 * `status` as platform-scoped provisioning and pinned, for the
 * `PUT /api/subscriptions/admin/organizations/:id` form, that even a
 * same-tenant administrator is refused (tests/organization-security-policies
 * .test.js case H5). This route now admits a tenant-scoped administrator write
 * of that same column. The two positions are left in conflict on purpose rather
 * than reconciled here: the mission directed the tenant-scoped authority to
 * preserve the tenant workflow, and the approved sources do not name a separate
 * reactivation authority that would settle it. The OWNER must adjudicate
 * whether tenant reactivation is a sanctioned act (tenant-scoped `UPDATE`), a
 * platform act (then `platform.admin`, which no V1 human may hold, and the
 * route becomes unreachable), or a distinct capability. No code here presumes
 * the answer beyond the mission's explicit direction.
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
const { requirePermission } = require('../middleware/rbac');
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
 * ATM-001-SEC-104-R3 (policy 3, residual §I closed). The tenant-side
 * cancellation-request workflow is PRESERVED: `SUBSCRIPTION.CANCEL` is
 * `admin: 'all'` in the approved legacy matrix, so the tenant administrator
 * that views/mobile/admin/subscription.ejs runs as keeps working, while the
 * supervisor and operator entries are `'none'` and are refused by the matrix
 * itself. The guard is `requirePermission`, the same legacy-matrix adapter the
 * sanctioned paid path uses (src/routes/payment.routes.js), because the
 * approved capability vocabulary names no subscription capability. The act is
 * not platform provisioning: it is the tenant's own request, and
 * `platform.admin` would have removed it.
 */
router.post('/cancel', requirePermission('SUBSCRIPTION', 'CANCEL'),
  subscriptionController.cancelSubscription);

/**
 * @route   POST /api/subscriptions/reactivate
 * @desc    Reactivate a cancelled subscription
 * @access  Private (Organization Admin)
 *
 * ATM-001-SEC-104-R3 (policy 3, residual §I closed). The authority is
 * `SUBSCRIPTION.UPDATE` (`admin: 'all'`, supervisor/operator `'none'` in
 * src/config/permissions.js) — the matrix's remaining enumerated modification
 * authority for this resource, determined rather than invented; see the header
 * for the full provenance and for the unresolved `status` question that is
 * escalated to the OWNER rather than reconciled here. `SUBSCRIPTION.CANCEL` is
 * deliberately NOT reused: reactivation is not cancellation.
 */
router.post('/reactivate', requirePermission('SUBSCRIPTION', 'UPDATE'),
  subscriptionController.reactivateSubscription);

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
