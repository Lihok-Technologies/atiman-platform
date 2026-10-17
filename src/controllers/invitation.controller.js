/**
 * Invitation Controller
 * Manages organization invitations
 */

const { Invitation, User, Organization, OrganizationSubscription } = require('../models');
const { hashPassword, sanitizeUser } = require('../utils/helpers');
const subscriptionService = require('../services/subscription.service');
const emailService = require('../services/email.service');

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

      // Find invitation
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

      // Create user
      const user = await User.create({
        username,
        email: invitation.email,
        password_hash: passwordHash,
        full_name,
        phone,
        role: invitation.role,
        organization_id: invitation.organization_id,
        is_active: true,
        status: 'active',
        is_billable: true
      });

      // Mark invitation as accepted
      await Invitation.accept(invitation.id, user.id);

      // Update seat usage
      await subscriptionService.recalculateSeats(invitation.organization_id);

      res.json({
        success: true,
        message: 'Invitation accepted! Account created successfully.',
        // ATM-001-SEC-107 C-1: `User.create` returns the `SELECT *` row, so the
        // created account carries its bcrypt `password_hash`. Project it through
        // the same helper the user routes use; the envelope and safe fields stay.
        data: { user: sanitizeUser(user) }
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

      // Create new invitation with new token
      const newInvitation = await Invitation.createInvitation({
        organization_id: organizationId,
        email: invitation.email,
        role: invitation.role,
        invited_by: req.user.id
      });

      // Cancel old invitation
      await Invitation.cancel(invitationId);

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
