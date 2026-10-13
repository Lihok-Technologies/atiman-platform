/**
 * Invitation Controller
 * Manages organization invitations
 */

const { Invitation, User, Organization, OrganizationSubscription } = require('../models');
const { pool } = require('../config/database');
const { hashPassword } = require('../utils/helpers');
const subscriptionService = require('../services/subscription.service');
const emailService = require('../services/email.service');

/**
 * Project the account created by an acceptance for the PUBLIC accept response.
 *
 * `POST /api/invitations/accept` is unauthenticated and answered with
 * `data: { user }` — the object `User.create` returned. `BaseModel.create` ends
 * in `findById`, i.e. `SELECT * FROM users`, so that row carries `password_hash`.
 * `BaseModel.create` already withholds `password_hash` (see
 * PROTECTED_CREATE_COLUMNS in src/models/base.model.js), and this allow-list is
 * the second, independent layer at the boundary itself: a field added to `users`
 * later — a reset token, an SSO subject, a second credential column — is absent
 * by default instead of disclosed by default.
 *
 * Independently reached by ATM-001-SEC-93 (consolidated invitation correction),
 * which is not an ancestor of this base; the two are the same control and merge
 * as one.
 */
const toAcceptedUserView = (user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  full_name: user.full_name,
  role: user.role,
  organization_id: user.organization_id,
  facility_id: user.facility_id,
  is_active: user.is_active,
  status: user.status,
  is_organization_admin: user.is_organization_admin,
  created_at: user.created_at
});

class InvitationController {
  /**
   * Get all invitations for current organization
   * GET /api/invitations
   */
  async getAll(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      const invitations = await Invitation.getByOrganization(organizationId);
      const rawStats = await Invitation.getStats(organizationId);
      
      // Get seat availability
      const subscriptionService = require('../services/subscription.service');
      const seatUsage = await subscriptionService.getSeatUsage(organizationId);
      
      // Format stats for UI
      const stats = {
        total: invitations.length,
        pending: rawStats.pending_count || 0,
        accepted: rawStats.accepted_count || 0,
        expired: rawStats.expired_count || 0,
        availableSeats: seatUsage?.availableSeats || 0
      };

      res.json({
        success: true,
        data: { invitations, stats }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new invitation
   * POST /api/invitations
   */
  async create(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      const invitedBy = req.user?.id;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      const { email, role } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      // Check if user already exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'A user with this email already exists'
        });
      }

      // Check if there's already a pending invitation
      const hasPending = await Invitation.hasPendingInvitation(email, organizationId);
      if (hasPending) {
        return res.status(409).json({
          success: false,
          message: 'An invitation has already been sent to this email'
        });
      }

      // Check seat availability
      const canAdd = await subscriptionService.canAddUser(organizationId);
      if (!canAdd) {
        const usage = await subscriptionService.getSeatUsage(organizationId);
        return res.status(403).json({
          success: false,
          message: 'Seat limit reached. Cannot invite more users.',
          data: {
            activeUsers: usage.activeUsers,
            allowedUsers: usage.totalAllowedUsers,
            availableSeats: usage.availableSeats
          }
        });
      }

      // Create invitation
      const invitation = await Invitation.createInvitation({
        organization_id: organizationId,
        email: email.toLowerCase(),
        role: role || 'operator',
        invited_by: invitedBy
      });

      // Get organization name for email
      const organization = await Organization.findById(organizationId);
      const inviter = await User.findById(invitedBy);

      // Send invitation email
      try {
        await emailService.sendInvitation({
          to: email,
          organizationName: organization?.organization_name || 'Your Organization',
          role: role || 'operator',
          token: invitation.token,
          invitedBy: inviter?.full_name || 'Admin'
        });
      } catch (emailError) {
        console.error('Failed to send invitation email:', emailError);
        // Don't fail the request if email fails - user can still see invitation in UI
      }

      res.status(201).json({
        success: true,
        message: 'Invitation sent successfully',
        data: { 
          invitation: {
            ...invitation,
            invitationLink: `${process.env.APP_URL || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`}/signup?token=${invitation.token}`
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel an invitation
   * DELETE /api/invitations/:id
   */
  async cancel(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      const invitationId = req.params.id;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      // Get invitation
      const [invitation] = await Invitation.findAll({ id: invitationId, organization_id: organizationId });
      
      if (!invitation) {
        return res.status(404).json({
          success: false,
          message: 'Invitation not found'
        });
      }

      if (invitation.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Can only cancel pending invitations'
        });
      }

      await Invitation.cancel(invitationId);

      res.json({
        success: true,
        message: 'Invitation cancelled successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Validate invitation token
   * GET /api/invitations/validate/:token
   */
  async validate(req, res, next) {
    try {
      const { token } = req.params;

      const invitation = await Invitation.findByToken(token);

      if (!invitation) {
        return res.status(404).json({
          success: false,
          message: 'Invalid or expired invitation'
        });
      }

      res.json({
        success: true,
        data: {
          invitation: {
            token: invitation.token,
            email: invitation.email,
            role: invitation.role,
            organization: {
              id: invitation.organization_id,
              name: invitation.organization_name
            },
            invited_by: invitation.invited_by_name,
            expires_at: invitation.expires_at
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Accept invitation and create account
   * POST /api/invitations/accept
   *
   * DEFECT D-1 (repaired). At the pinned head this handler created the account
   * row (which COMMITTED) and then threw on `user.id`, because `User.create`
   * returned null — `BaseModel.create` issued its INSERT without `RETURNING id`
   * under the PostgreSQL adapter. The invitation was therefore NEVER retired and
   * stayed `pending` and reusable, so the single-use control the invitation is
   * supposed to carry was defeated. `BaseModel.create` is repaired at the class
   * level (src/models/base.model.js).
   *
   * Repairing the null return alone still leaves the flow non-atomic: the account
   * INSERT and the invitation retirement are independent autocommit statements, so
   * a failure between them commits an account whose invitation is still usable, and
   * a failure after them commits an account with stale seat counters. The
   * eligibility re-read, the account INSERT, the retirement and the seat
   * recalculation therefore run in ONE transaction.
   *
   * Single use is decided by the LOCK, not by the earlier read: the invitation row
   * is re-read `FOR UPDATE` inside the transaction, so two concurrent acceptances
   * cannot both consume one token. A refusal must not burn the invitation, and a
   * consumed invitation must not be left unusable — both hold because every
   * refusal returns before COMMIT (rolling back) and every failure rolls back the
   * retirement with the account.
   *
   * Untouched by this repair, and deliberately so: the granted tenant and role
   * still come from the PERSISTED invitation row and never from the request body,
   * and `is_organization_admin` is still not accepted from the caller. Authorized
   * role issuance is preserved.
   */
  async accept(req, res, next) {
    try {
      const { token, username, password, full_name, phone } = req.body;

      if (!token || !username || !password || !full_name) {
        return res.status(400).json({
          success: false,
          message: 'Token, username, password, and full name are required'
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters'
        });
      }

      // Eligibility read (no lock): a refusal here must persist nothing.
      const invitation = await Invitation.findByToken(token);

      if (!invitation) {
        return res.status(404).json({
          success: false,
          message: 'Invalid or expired invitation'
        });
      }

      // Check if username exists
      const existingUser = await User.findByUsername(username);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Username already exists'
        });
      }

      // Check seat availability
      const canAdd = await subscriptionService.canAddUser(invitation.organization_id);
      if (!canAdd) {
        return res.status(403).json({
          success: false,
          message: 'Seat limit reached. Cannot join organization.',
          code: 'SEAT_LIMIT_REACHED'
        });
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // Everything from the lock onwards commits together or not at all.
      const conn = await pool.getConnection();
      let user;
      let accepted;
      try {
        // Re-read under a row lock. This is the decision, not the read above: a
        // concurrent acceptance blocks here and, once the first commits, this
        // statement re-evaluates its `status = 'pending'` predicate against the
        // committed row and matches nothing.
        const locked = await Invitation.findByTokenForUpdate(token, conn);
        if (!locked) {
          await conn.rollback();
          return res.status(409).json({
            success: false,
            message: 'This invitation is no longer available',
            code: 'INVITATION_NOT_AVAILABLE'
          });
        }

        // Create user. Tenant and role come from the locked persisted row.
        user = await User.create({
          username,
          email: locked.email,
          password_hash: passwordHash,
          full_name,
          phone,
          role: locked.role,
          organization_id: locked.organization_id,
          is_active: true,
          status: 'active',
          is_billable: true
        }, conn);

        // Retire the invitation in the same transaction that created the account.
        await Invitation.accept(locked.id, user.id, conn);

        // Update seat usage inside the transaction, so no seat count is committed
        // for an acceptance that rolls back.
        await subscriptionService.recalculateSeats(locked.organization_id, conn);

        await conn.commit();
        accepted = { user, organizationId: locked.organization_id };
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }

      res.json({
        success: true,
        message: 'Invitation accepted! Account created successfully.',
        data: { user: toAcceptedUserView(accepted.user) }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Resend invitation
   * POST /api/invitations/:id/resend
   */
  async resend(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      const invitationId = req.params.id;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      // Get invitation
      const [invitation] = await Invitation.findAll({ id: invitationId, organization_id: organizationId });
      
      if (!invitation) {
        return res.status(404).json({
          success: false,
          message: 'Invitation not found'
        });
      }

      // DEFECT D-1 (repaired). At the pinned head `Invitation.createInvitation`
      // threw on `result.id` after its INSERT had committed, so the replacement
      // was persisted and the `Invitation.cancel` below never ran: a resend left
      // TWO live pending invitations for the same address (same role, so no
      // privilege delta, but two usable enrollment credentials where the operator
      // asked for one). `BaseModel.create` is repaired at the class level, and the
      // issue-then-retire pair runs in ONE transaction so a failure in either half
      // cannot leave a replacement without retiring its predecessor - nor retire
      // the predecessor without leaving a usable replacement.
      const conn = await pool.getConnection();
      let newInvitation;
      try {
        // Create new invitation with new token
        newInvitation = await Invitation.createInvitation({
          organization_id: organizationId,
          email: invitation.email,
          role: invitation.role,
          invited_by: req.user.id
        }, conn);

        // Cancel old invitation
        await Invitation.cancel(invitationId, conn);

        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }

      res.json({
        success: true,
        message: 'Invitation resent successfully',
        data: { invitation: newInvitation }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new InvitationController();
