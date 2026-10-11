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
router.get('/', invitationController.getAll);

// Create new invitation (admin only)
router.post('/', requireAdmin, invitationController.create);

// Cancel invitation (admin only)
router.delete('/:id', requireAdmin, invitationController.cancel);

// Resend invitation
//
// ATM-001-SEC-00H. This route was guarded by `requireAdmin` alone, which admits
// a supervisor (src/middleware/auth.js) and does not distinguish an organization
// administrator from any other administrator. The handler re-issues the stored
// invitation with a fresh token, so a supervisor could reissue an ADMINISTRATOR
// invitation - and could revive a cancelled, expired or already-accepted one,
// because the handler performed no status or expiry check. That bypassed the
// authority ATM-001-SEC-00E applied to invitation creation.
//
// `org.user_admin` is the approved invitation-management authority (ATM-003-R1
// section 3.3: "Manage users, invitations, roles", Tenant scope, held by the
// Tenant Administrator profile). ATM-003-R3 section 4 records that the
// supervisor compatibility bundle deliberately EXCLUDES it. The canonical
// ATM-003 primitive decides, using the principal's effective capabilities.
//
// `requireAdmin` is NOT retained: it is neither necessary nor sufficient here,
// and the capability is strictly narrower (it denies supervisors, while an
// explicit `org.user_admin` grant is honoured regardless of the legacy role,
// which is the resolver's adjudicated behaviour).
router.post('/:id/resend', requireCapability('org.user_admin'), invitationController.resend);

module.exports = router;
