/**
 * Authentication Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { canCreateUser } = require('../middleware/rbac');
const { loginValidation, registerValidation } = require('../middleware/validation');

// Public routes
router.post('/login', loginValidation, authController.login);
router.post('/signup', authController.signup);
router.post('/organization-signup', authController.organizationSignup);
router.post('/logout', authController.logout);

// Protected routes
router.get('/profile', authenticate, authController.getProfile);
router.put('/profile', authenticate, authController.updateProfile);
router.post('/change-password', authenticate, authController.changePassword);

// Admin only routes
//
// ATM-001-SEC-00D. `POST /api/auth/register` was guarded by `requireAdmin`
// alone, which admits a supervisor (src/middleware/auth.js) and does not
// distinguish an organization administrator from any other administrator. The
// handler then took `role` from the request body and persisted it, so a
// supervisor - or a plain administrator with `is_organization_admin = false` -
// could create an administrator account, with a password of their own choosing,
// in their own organization.
//
// `canCreateUser` is the approved role-assignment authority this codebase
// already expresses, and `POST /api/users` already applies it:
//
//   - a supervisor may create only `operator`, and must be assigned to a
//     facility (their facility is applied to the new record);
//   - an administrator may create users, but creating an `admin` requires
//     `is_organization_admin` on the caller, and is capped per organization;
//   - an operator may not create users.
//
// This route now applies that same authority rather than inventing a new one.
// No permission, role, capability or tenant rule is changed, and the handler
// continues to derive `organization_id` from the authenticated session, so a
// request-body organization can never redirect the tenant.
router.post('/register', authenticate, requireAdmin, canCreateUser, registerValidation, authController.register);

module.exports = router;
