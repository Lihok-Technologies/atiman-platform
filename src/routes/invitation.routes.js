/**
 * Invitation Routes
 * Organization invitation management
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
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
router.post('/', requireAdmin, invitationController.create);

// Cancel invitation (admin only)
router.delete('/:id', requireAdmin, invitationController.cancel);

// Resend invitation (admin only)
router.post('/:id/resend', requireAdmin, invitationController.resend);

module.exports = router;
