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
// `requireAdmin` admits both `admin` and `supervisor` (src/middleware/auth.js:62-70),
// and `authController.register` persists the client-supplied `role` verbatim. Without a
// role-issuance authority a supervisor could therefore create an `admin` account inside
// their own organization — a privilege escalation.
//
// `canCreateUser` is the approved authority already applied to user creation at
// `POST /api/users` (src/routes/user.routes.js:132). It enforces exactly the missing
// rule: a supervisor may create operators only, an admin may create another admin only
// when `is_organization_admin` is true, and an operator may create nobody. Reusing it
// keeps a single authority model for user creation instead of introducing a second one.
router.post('/register', authenticate, requireAdmin, canCreateUser, registerValidation, authController.register);

module.exports = router;
