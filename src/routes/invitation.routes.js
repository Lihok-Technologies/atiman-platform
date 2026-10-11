/**
 * Invitation Routes
 * Organization invitation management
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { canCreateUser } = require('../middleware/rbac');
const invitationController = require('../controllers/invitation.controller');

// Public routes (no authentication required)
router.get('/validate/:token', invitationController.validate);
router.post('/accept', invitationController.accept);

// Protected routes (authentication required)
router.use(authenticate);

// Get all invitations for current organization
router.get('/', invitationController.getAll);

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
