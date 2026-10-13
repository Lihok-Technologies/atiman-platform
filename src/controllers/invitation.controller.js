/**
 * Invitation Controller
 * Manages organization invitations
 */

const { Invitation, User, Organization, OrganizationSubscription } = require('../models');
const { pool } = require('../config/database');
const { hashPassword } = require('../utils/helpers');
const subscriptionService = require('../services/subscription.service');
const emailService = require('../services/email.service');
const { roleIssuanceAuthority } = require('../middleware/rbac');

/**
 * Largest value the `invitations.id` column can hold.
 *
 * ATM-001-SEC-93-D. `invitations.id` is a PostgreSQL `integer` (int4), so the
 * widest identifier it can name is 2^31 - 1. A digit-only identifier ABOVE that
 * bound passes a bare `/^\d+$/` shape check, but PostgreSQL refuses the
 * comparison when the tenant-scoped lookup binds it and answers with a raw
 * driver message:
 *
 *   value "99999999999" is out of range for type integer
 *
 * Reproduced on 203b36a against the disposable cluster: both
 * `DELETE /api/invitations/99999999999` and
 * `POST /api/invitations/99999999999/resend` returned HTTP 500 carrying exactly
 * that text (and `2147483648` behaved identically). A shape guard that does not
 * bound the type it feeds is not a guard; the identifier must be refused before
 * it reaches the database, exactly as a non-numeric one already is.
 */
const MAX_INVITATION_ID = 2147483647;

/**
 * An identifier that can name an invitation row.
 *
 * An ALLOW-list: digits only AND within the int4 bound. Applied identically by
 * the two invitation-id handlers (`cancel` and `resend`) so neither route can
 * reach the lookup with a value the column cannot represent. A value refused
 * here is answered with the SAME non-disclosing 404 those handlers already give
 * a missing invitation, so "malformed", "too large" and "does not exist" are
 * indistinguishable to the caller and no driver text is disclosed.
 */
const isInvitationId = (value) => {
  const text = String(value);
  return /^\d+$/.test(text) && Number(text) <= MAX_INVITATION_ID;
};

/**
 * Project an invitation row for the administration LISTING.
 *
 * ATM-001-SEC-00G. The listing previously spread the raw database row into the
 * response, so every record carried its `token`. An invitation token is a usable
 * enrollment credential: `POST /api/invitations/accept` is public and creates
 * the account with the invitation's role, so disclosure of the token is
 * disclosure of the ability to enroll. Listing is an administration view, not a
 * delivery channel, and must not be a credential channel.
 *
 * The `token` is therefore dropped here. Every other field is preserved, because
 * the administration view needs them. The listing is deliberately NOT a
 * delivery channel, and that route is separately restricted to `org.user_admin`.
 *
 * ATM-001-SEC-93-D (c2): WHAT THIS DOES AND DOES NOT RESTORE. The remaining
 * delivery paths are `POST /api/invitations` (create) and
 * `POST /api/invitations/:id/resend`, which are the only responses that carry a
 * token. Under the UNREPAIRED pre-existing defect D-1 (`BaseModel.create` never
 * reads the INSERT's generated id, so `Invitation.createInvitation` throws at
 * `result.id`), BOTH of those responses are HTTP 500 with no token and no
 * delivered email:
 *
 *   - create commits the invitation row, then throws at
 *     `Invitation.createInvitation` BEFORE `emailService.sendInvitation` is
 *     called, so no token is returned and no email is sent;
 *   - resend commits the replacement row, then throws at the same call; the
 *     resend handler never calls `emailService.sendInvitation` at all, so it
 *     would deliver nothing even on success.
 *
 * The listing is token-free, so there is currently NO path by which an
 * administrator can obtain a link for an EXISTING pending invitation. This
 * correction does NOT repair D-1 and does NOT restore that delivery path; the
 * token-free listing is a credential-disclosure control, not a delivery
 * channel, and it must not become one again to work around D-1. See condition
 * c2 / section G of tests/invitation-lifecycle-residuals.test.js for the
 * recorded escalation.
 */
const toInvitationListingView = (invitation) => {
  // eslint-disable-next-line no-unused-vars
  const { token, ...listing } = invitation;
  return listing;
};

/**
 * Project the account created by an acceptance for the PUBLIC accept response.
 *
 * ATM-001-SEC-93-C. `POST /api/invitations/accept` is unauthenticated, and the
 * handler answered with `data: { user }` — the object `User.create` returned.
 * `User.create` is `BaseModel.create`, which ends in `this.findById(insertId)`,
 * i.e. `SELECT * FROM users`. That row carries `password_hash`, so the moment
 * the pre-existing D-1 defect is repaired the public acceptance response would
 * return the invitee's bcrypt hash (verified against a real row: the hash is
 * present at `user.password_hash`). A response that only fails to disclose a
 * credential because an unrelated write defect suppresses the whole response
 * body is not a redaction control.
 *
 * The projection is an ALLOW-LIST. A field added to `users` later — a reset
 * token, an SSO subject, a second credential column — is therefore absent by
 * default rather than disclosed by default.
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

      const invitationRows = await Invitation.getByOrganization(organizationId);
      const rawStats = await Invitation.getStats(organizationId);
      
      // Get seat availability
      const subscriptionService = require('../services/subscription.service');
      const seatUsage = await subscriptionService.getSeatUsage(organizationId);
      
      // Format stats for UI
      const stats = {
        total: invitationRows.length,
        pending: rawStats.pending_count || 0,
        accepted: rawStats.accepted_count || 0,
        expired: rawStats.expired_count || 0,
        availableSeats: seatUsage?.availableSeats || 0
      };

      // ATM-001-SEC-00G: never disclose a usable enrollment credential in a listing.
      const invitations = invitationRows.map(toInvitationListingView);

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
      //
      // ATM-001-SEC-93-D (c2). Under the UNREPAIRED defect D-1 this call throws
      // AFTER the INSERT has committed, because `BaseModel.create` never reads
      // the generated id and `createInvitation` dereferences `result.id`. The
      // row is therefore persisted with a live token while the response is a
      // 500 that carries no token, and the throw happens BEFORE the
      // `emailService.sendInvitation` call below — so no email is sent either.
      // This handler is NOT repaired here: the instance-only RETURNING fix would
      // leave the public accept path on `User.create` (BaseModel.create on
      // `users`) still failing, so it would not close the gap and must not be
      // claimed to. Recorded, not repaired.
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
   *
   * ATM-001-SEC-93-A. Authority for this operation is the route's
   * `requireCapability('org.user_admin')` guard (src/routes/invitation.routes.js),
   * the same approved invitation-management authority the listing and the resend
   * route carry. This handler enforces SCOPE: the invitation must belong to the
   * caller's own tenant, and only a still-pending invitation may be cancelled.
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

      // ATM-001-SEC-93-A2 / SEC-93-D. The same shape guard the resend handler
      // applies, now bounded by the int4 range the `invitations.id` column can
      // represent. Without the shape check a non-numeric id reached the
      // tenant-scoped lookup and PostgreSQL refused the comparison itself, so the
      // handler answered 500 carrying a raw driver message ("invalid input syntax
      // for type integer: \"abc\"") — reproduced against the disposable cluster.
      // Without the BOUND an all-digit id above 2^31 - 1 did the same
      // ("value \"99999999999\" is out of range for type integer"). A malformed
      // or unrepresentable identifier cannot name an invitation and must be
      // indistinguishable from one that does not exist, exactly as resend
      // already answers it.
      if (!isInvitationId(invitationId)) {
        return res.status(404).json({
          success: false,
          message: 'Invitation not found'
        });
      }

      // Get invitation. Server-side tenant scoping: "not found" and "belongs to
      // another tenant" are deliberately indistinguishable, so no foreign
      // invitation is disclosed.
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
   * ATM-001-SEC-93-B. This route is PUBLIC: possession of the token is the whole
   * of the caller's claim. The handler therefore derives everything that carries
   * authority from the PERSISTED invitation row and from nothing else:
   *
   *   - the granted `role` is `invitation.role`, never a request-body field;
   *   - the tenant is `invitation.organization_id`, never a request-body field;
   *   - `is_organization_admin` is not accepted from the caller at all, so the
   *     account is created with the column default (false) and acceptance can
   *     never confer organization-administrator authority.
   *
   * The body is read for `token`, `username`, `password`, `full_name` and
   * `phone` only.
   *
   * ATM-001-SEC-93-B2 (PRESERVED, B3-D condition 1). `users.email` carries a
   * global UNIQUE constraint (`uq_users_email`), so an already-registered
   * invitee address is refused with a 409 BEFORE the claim. Without it the
   * conflict surfaced as HTTP 500 carrying the raw `uq_users_email` driver
   * text, and a public caller could burn a live invitation by asking a
   * duplicate address to accept it.
   *
   * DEFECT D-1 (REPAIRED at the class level in src/models/base.model.js). At the
   * pinned head this handler created the account row (which COMMITTED) and then
   * threw on `user.id`, because `User.create` returned null: `BaseModel.create`
   * issued its INSERT without `RETURNING id` under the PostgreSQL adapter. The
   * invitation was therefore NEVER retired and stayed `pending` and reusable,
   * so the single-use control the invitation is supposed to carry was defeated.
   *
   * ATOMICITY (ATM-001-SEC-D1). The eligibility re-read under lock, the single
   * retirement, the account INSERT and the seat recalculation run in ONE
   * transaction, so a failure in any step commits neither a half-created
   * account, nor a consumed-but-unusable invitation, nor a stale seat count.
   *
   * SINGLE RETIREMENT MECHANISM (ATM-001-SEC-B3D condition 1). Exactly ONE
   * mechanism retires the invitation: `Invitation.claimForAcceptance`, the
   * conditional `UPDATE ... WHERE status = 'pending' AND expires_at > NOW()`
   * from ATM-001-SEC-93-B, executed here INSIDE the transaction so that it is
   * both single-use and rollback-safe. `Invitation.accept` is ATTRIBUTION ONLY
   * (it records `accepted_by_user_id` and cannot move the row back to
   * `pending`), and `Invitation.findByTokenForUpdate` is an eligibility read
   * that takes the row lock - it does not itself retire anything. Both
   * independently-verified controls are retained and neither is duplicated: a
   * textual merge that also kept D-1's status transition in `accept()` would
   * have shipped TWO retirement mechanisms, and taking either side wholesale
   * would have lost one control.
   *
   * Re-validation of the ISSUING principal's current authority at acceptance time
   * is deliberately NOT added: it is a product-policy question about invitations
   * that already exist (and it is recorded as a residual by
   * tests/invitation-role-authority.test.js test 28). Inventing it here would
   * change who may enroll, which this mission forbids. It is escalated instead.
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

      // ATM-001-SEC-93-B2. `users.email` carries a global UNIQUE constraint
      // (`uq_users_email`, database/postgresql/001_core.sql), and acceptance
      // inserts `invitation.email` verbatim. The creation path already refuses
      // that conflict explicitly (`User.findByEmail` -> 409); acceptance did not,
      // so an already-registered invitee address surfaced as an unhandled driver
      // error (reproduced: 500 "duplicate key value violates unique constraint
      // uq_users_email"). Refusing it HERE, before the claim, matters for more
      // than the status code: a predictable conflict must not consume the
      // invitation, or a public caller could burn a live invitation by asking a
      // duplicate address to accept it.
      const emailTaken = await User.findByEmail(invitation.email);
      if (emailTaken) {
        return res.status(409).json({
          success: false,
          message: 'A user with this email already exists'
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

      // ---------------------------------------------------------------------
      // ATOMIC ONBOARDING + ONE RETIREMENT MECHANISM (B3-D condition 1)
      // ---------------------------------------------------------------------
      // Everything from the row lock onwards commits together or not at all.
      // The lock serializes concurrent acceptances; the claim is the SINGLE
      // retirement; the account INSERT and the seat recalculation join them in
      // the same transaction so no partial onboarding can be committed.
      const conn = await pool.getConnection();
      let accepted;
      try {
        // ELIGIBILITY RE-READ UNDER LOCK (ATM-001-SEC-D1, retained). This is not
        // the retirement decision: a concurrent acceptance blocks here and, once
        // the first commits, this statement re-evaluates its `status = 'pending'`
        // predicate against the committed row and matches nothing.
        const locked = await Invitation.findByTokenForUpdate(token, conn);
        if (!locked) {
          await conn.rollback();
          return res.status(409).json({
            success: false,
            message: 'This invitation is no longer available',
            code: 'INVITATION_NOT_AVAILABLE'
          });
        }

        // THE SINGLE RETIREMENT (ATM-001-SEC-93-B). One conditional write, run
        // inside this transaction: exactly one caller can observe
        // `affectedRows === 1`, and a rollback below returns the row to
        // `pending` rather than leaving it consumed-and-unusable. Every refusal
        // above this line runs before the claim, so a refusal persists nothing.
        const claimed = await Invitation.claimForAcceptance(locked.id, conn);
        if (!claimed) {
          await conn.rollback();
          return res.status(409).json({
            success: false,
            message: 'This invitation is no longer available',
            code: 'INVITATION_NOT_AVAILABLE'
          });
        }

        // Create user. Tenant and role come from the locked persisted row and
        // never from the request body.
        const user = await User.create({
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

        // ATTRIBUTION ONLY (ATM-001-SEC-93-B). The status transition already
        // happened in the claim, so this only records WHO accepted and cannot
        // re-open the row. It is deliberately NOT a second retirement mechanism.
        await Invitation.accept(locked.id, user.id, conn);

        // Seat usage joins the same transaction, so no seat count is committed
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
   *
   * ATM-001-SEC-00H. Resend is a RE-ISSUE, not a revival.
   *
   * The route is authorized by `requireCapability('org.user_admin')` (see
   * src/routes/invitation.routes.js). This handler enforces ELIGIBILITY. Every
   * check runs BEFORE any mutation, so a refusal persists no invitation, issues
   * no token, cancels nothing and delivers nothing.
   *
   * The replacement's role is the PERSISTED role of the invitation being
   * replaced. This handler never reads `req.body`, `req.query` or `req.params`
   * for a role, a tenant or an administrator flag, so none of those can widen
   * what the resend grants.
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

      // ATM-001-SEC-93-D. An identifier that cannot name an invitation — not
      // digits only, or beyond the int4 range `invitations.id` can hold — is
      // refused before it reaches the database, so it cannot disclose driver or
      // schema detail through an error, cannot reach PostgreSQL with a value it
      // would refuse as "out of range for type integer", and cannot be
      // distinguished from an invitation that does not exist. Reproduced on
      // 203b36a: `/resend` with `99999999999` returned HTTP 500 carrying the raw
      // driver text before this bound was added.
      if (!isInvitationId(invitationId)) {
        return res.status(404).json({
          success: false,
          message: 'Invitation not found'
        });
      }

      // Server-side tenant-scoped lookup. "Not found" and "belongs to another
      // tenant" are deliberately indistinguishable, so no foreign invitation is
      // disclosed.
      const [invitation] = await Invitation.findAll({ id: invitationId, organization_id: organizationId });

      if (!invitation) {
        return res.status(404).json({
          success: false,
          message: 'Invitation not found'
        });
      }

      // Eligibility. Only an invitation that is still capable of being accepted
      // may be replaced: the same predicate `Invitation.findByToken` applies.
      // A cancelled, accepted or expired invitation is terminal and must not be
      // revived into a fresh usable token.
      if (invitation.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: 'Only pending invitations can be resent'
        });
      }

      if (invitation.expires_at && new Date(invitation.expires_at).getTime() <= Date.now()) {
        return res.status(400).json({
          success: false,
          message: 'An expired invitation cannot be resent'
        });
      }

      // ATM-001-SEC-00H-R1. `org.user_admin` answers "may this principal manage
      // invitations at all"; it does NOT answer "may this principal issue THIS
      // role". A resend re-issues the STORED role, so the approved creation-time
      // role-assignment authority (ATM-001-SEC-00E: the same policy
      // `POST /api/invitations` applies at creation) must also hold here.
      // Without it, a principal who may not create an administrator invitation
      // could re-issue one - independent finding F-2 of ATM-001-SEC-00H-VUDA-01.
      //
      // The decision is taken from `invitation.role`, the persisted row, and
      // never from the request body, query or headers. It runs BEFORE any
      // mutation, so a refusal persists no invitation, issues no token, cancels
      // nothing and delivers nothing. It is evaluated AFTER the lifecycle checks
      // so that a terminal invitation keeps the response SEC-00H already gives
      // it, and the remediation is strictly additive: only requests that would
      // otherwise have proceeded to mutation can be newly refused.
      const roleRefusal = roleIssuanceAuthority(req.user, invitation.role);
      if (roleRefusal) {
        return res.status(roleRefusal.status).json({
          success: false,
          message: roleRefusal.message
        });
      }

      // DEFECT D-1 (REPAIRED) + ATOMICITY (ATM-001-SEC-D1). At the pinned head
      // `Invitation.createInvitation` threw on `result.id` after its INSERT had
      // committed, so the replacement was persisted and the `Invitation.cancel`
      // below never ran: a resend left TWO live pending invitations for the same
      // address (same role, so no privilege delta, but two usable enrollment
      // credentials where the operator asked for one). `BaseModel.create` is
      // repaired at the class level, and the issue-then-retire pair runs in ONE
      // transaction so a failure in either half cannot leave a replacement
      // without retiring its predecessor - nor retire the predecessor without
      // leaving a usable replacement.
      //
      // RELEASE BLOCKER (ATM-001-SEC-B3D condition 4): this transactional form is
      // the correct one, but the D-1 suite carries NO failure-injection case for
      // it. Mutation M8 (make this resend non-transactional) therefore escapes
      // the suite and yields two live pending tokens. That missing detector is
      // carried as an explicit release blocker and is NOT authored here.
      const conn = await pool.getConnection();
      let newInvitation;
      try {
        // Re-issue with the STORED role and a new token.
        newInvitation = await Invitation.createInvitation({
          organization_id: organizationId,
          email: invitation.email,
          role: invitation.role,
          invited_by: req.user.id
        }, conn);

        // Retire the invitation being replaced, in the same transaction.
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
