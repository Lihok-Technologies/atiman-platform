/**
 * Invitation Routes
 * Organization invitation management
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { canCreateUser } = require('../middleware/rbac');
const { requireCapability } = require('../middleware/capability.middleware');
const invitationController = require('../controllers/invitation.controller');

// Public routes (no authentication required)
router.get('/validate/:token', invitationController.validate);
router.post('/accept', invitationController.accept);

// Protected routes (authentication required)
router.use(authenticate);

// Get all invitations for current organization
//
// ATM-001-SEC-00G. This route required only `authenticate`, so ANY authenticated
// principal - including an operator - received every invitation record for the
// tenant, raw `token` field included. Those tokens are usable enrollment
// credentials: `POST /api/invitations/accept` is public and creates the account
// with the invitation's role. An operator could therefore read an administrator
// invitation and consume it. The seat defect (D-2) masked only the final
// acceptance step, and is not an authorization control.
//
// Invitation management is `org.user_admin` in the approved ATM-003-R1
// architecture ("Manage users, invitations, roles", Tenant scope, held by the
// Tenant Administrator profile), and `CAPABILITY_FOR_PERMISSION` in the
// capability middleware maps `USERS.VIEW` to that same capability. The canonical
// ATM-003 primitive decides the authorization; nothing here reads authority from
// a request body, query or header.
//
// Consequence accepted by the OWNER for this mission: `resolveCapabilities`
// resolves a principal in exactly ONE mode, and an explicit grant discards the
// legacy compatibility bundle. An administrator who holds ANY explicit
// capability grant therefore does not hold `org.user_admin` implicitly and must
// be granted it explicitly. That is the adjudicated behaviour of the resolver,
// not a new rule introduced here.
router.get('/', requireCapability('org.user_admin'), invitationController.getAll);

// Create new invitation (admin only)
//
// ATM-001-SEC-00E. `POST /api/invitations` was guarded by `requireAdmin` alone,
// which admits a supervisor (src/middleware/auth.js) and does not distinguish an
// organization administrator from any other administrator. The handler then took
// `role` from the request body and persisted it as the role the invitation
// grants (`invitation.controller.js`), and acceptance creates the account with
// that role (`POST /api/invitations/accept`). The invitation schema admits
// `admin` (database/postgresql/001_core.sql, `chk_invitations_role`), so a
// supervisor - or a plain administrator with `is_organization_admin = false` -
// could issue an invitation that grants administrator privileges.
//
// `canCreateUser` is the approved role-assignment authority this codebase
// already expresses, and `POST /api/users` already applies it. The invitation
// body carries the invited role in `role`, which is the same field
// `canCreateUser` reads, so the authority applies to this route unchanged:
//
//   - a supervisor may invite only `operator`, and must be assigned to a
//     facility;
//   - an administrator may invite users, but inviting an `admin` requires
//     `is_organization_admin` on the caller, and is capped per organization;
//   - an operator may not invite anyone.
//
// The check runs before the handler, so a refused request persists no
// invitation, issues no token and triggers no delivery. No permission, role,
// capability, schema, migration or tenant rule is changed, and the handler
// continues to derive `organization_id` from the authenticated session, so a
// request-body organization can never redirect the tenant.
router.post('/', requireAdmin, canCreateUser, invitationController.create);

// Cancel invitation (admin only)
router.delete('/:id', requireAdmin, invitationController.cancel);

// Resend invitation (admin only)
router.post('/:id/resend', requireAdmin, invitationController.resend);

module.exports = router;
