/**
 * Invitation Model
 * Manages organization invitations for users
 */

const BaseModel = require('./base.model');
const crypto = require('crypto');

class InvitationModel extends BaseModel {
  constructor() {
    super('invitations');
  }

  /**
   * Generate a unique invitation token
   */
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new invitation
   * @param {Object} data
   * @param {Object} [conn] Optional transaction connection (see BaseModel.query()).
   * @returns {Promise<Object>}
   */
  async createInvitation(data, conn = null) {
    const token = this.generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

    const invitationData = {
      organization_id: data.organization_id,
      email: data.email.toLowerCase(),
      role: data.role || 'operator',
      invited_by: data.invited_by,
      token,
      status: 'pending',
      expires_at: expiresAt
    };

    const result = await this.create(invitationData, conn);
    return { ...invitationData, id: result.id };
  }

  /**
   * Find invitation by token
   * @param {string} token
   * @returns {Promise<Object|null>}
   */
  async findByToken(token) {
    const sql = `
      SELECT i.*, 
        o.organization_name,
        u.full_name as invited_by_name,
        u.email as invited_by_email
      FROM ${this.tableName} i
      JOIN organizations o ON i.organization_id = o.id
      JOIN users u ON i.invited_by = u.id
      WHERE i.token = ? AND i.status = 'pending' AND i.expires_at > NOW()
    `;
    const [row] = await this.query(sql, [token]);
    return row || null;
  }

  /**
   * Find a still-acceptable invitation by token and LOCK its row for the duration
   * of the caller's transaction.
   *
   * `findByToken` is an eligibility READ: it establishes that an invitation was
   * acceptable a moment ago. Two concurrent acceptances both pass it, and a token
   * revoked between that read and the account INSERT still passed it. Single use
   * is therefore decided by `FOR UPDATE` inside the transaction that performs the
   * acceptance: the second caller blocks on the row lock, and once the first
   * commits the retirement the blocked statement re-evaluates its predicate
   * against the committed row and returns no row at all, so the token cannot be
   * consumed twice.
   *
   * Must be called only with a transaction connection (see BaseModel.query()).
   *
   * @param {string} token
   * @param {Object} conn Transaction connection.
   * @returns {Promise<Object|null>}
   */
  async findByTokenForUpdate(token, conn) {
    const sql = `
      SELECT i.*,
        o.organization_name,
        u.full_name as invited_by_name,
        u.email as invited_by_email
      FROM ${this.tableName} i
      JOIN organizations o ON i.organization_id = o.id
      JOIN users u ON i.invited_by = u.id
      WHERE i.token = ? AND i.status = 'pending' AND i.expires_at > NOW()
      FOR UPDATE OF i
    `;
    const [row] = await this.query(sql, [token], conn);
    return row || null;
  }

  /**
   * Find pending invitations by email
   * @param {string} email
   * @returns {Promise<Array>}
   */
  async findByEmail(email) {
    const sql = `
      SELECT i.*, o.organization_name
      FROM ${this.tableName} i
      JOIN organizations o ON i.organization_id = o.id
      WHERE i.email = ? AND i.status = 'pending' AND i.expires_at > NOW()
      ORDER BY i.created_at DESC
    `;
    return this.query(sql, [email.toLowerCase()]);
  }

  /**
   * Get all invitations for an organization
   * @param {number} organizationId
   * @param {Object} filters
   * @returns {Promise<Array>}
   */
  async getByOrganization(organizationId, filters = {}) {
    let sql = `
      SELECT i.*, 
        u.full_name as invited_by_name,
        u.email as invited_by_email,
        au.username as accepted_by_username
      FROM ${this.tableName} i
      JOIN users u ON i.invited_by = u.id
      LEFT JOIN users au ON i.accepted_by_user_id = au.id
      WHERE i.organization_id = ?
    `;
    const params = [organizationId];

    if (filters.status) {
      sql += ' AND i.status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY i.created_at DESC';
    return this.query(sql, params);
  }

  /**
   * Atomically consume a still-acceptable invitation.
   *
   * ATM-001-SEC-93-B (MISSION 3 residual B: double-accept, reuse after
   * revoke/expiry).
   *
   * `findByToken` is a READ: it establishes that an invitation was acceptable a
   * moment ago, and every check the accept handler performs between that read
   * and the account insert is time the invitation stays open. Two concurrent
   * acceptances both pass the read; a revoked, expired or already-consumed
   * invitation passed the read before the revocation landed. Single-use must
   * therefore be decided by the WRITE, in one statement, against the same
   * predicate `findByToken` applies:
   *
   *   status = 'pending' AND expires_at > NOW()
   *
   * Exactly one caller can observe `affectedRows === 1`. Every other caller
   * observes 0 and must refuse, so the invitation cannot be consumed twice and
   * cannot be consumed after a revoke or an expiry.
   *
   * This is deliberately independent of the pre-existing D-1 defect
   * (`BaseModel.create` never reads the INSERT's id, so `User.create` returns
   * null and the accept handler throws AFTER the account row commits). That
   * defect previously left the invitation `pending` forever, which made the
   * token permanently reusable. Deciding single-use here, BEFORE the account is
   * created, means the security property holds whether or not D-1 is repaired.
   *
   * `accepted_by_user_id` is attributed separately, once the account id is
   * known, by `accept()`.
   *
   * ATM-001-SEC-B3D condition 1: this is the SINGLE retirement mechanism in the
   * acceptance path. `accept()` is attribution-only and `findByTokenForUpdate()`
   * is an eligibility read that takes the row lock, so neither of them retires
   * anything. The optional `conn` lets the caller run the claim inside its
   * onboarding transaction (ATM-001-SEC-D1), which makes the conditional
   * transition both single-use AND rollback-safe: a failure later in the same
   * transaction returns the row to `pending` instead of leaving it
   * consumed-and-unusable.
   *
   * @param {number} invitationId
   * @param {Object} [conn] Optional transaction connection (see BaseModel.query()).
   * @returns {Promise<boolean>} true only for the call that performed the claim
   */
  async claimForAcceptance(invitationId, conn = null) {
    const sql = `
      UPDATE ${this.tableName}
      SET status = 'accepted', accepted_at = NOW()
      WHERE id = ? AND status = 'pending' AND expires_at > NOW()
    `;
    const result = await this.query(sql, [invitationId], conn);
    return Number(result?.affectedRows || 0) === 1;
  }

  /**
   * Record the account an invitation was accepted by.
   *
   * The status transition is `claimForAcceptance`'s. This method is ATTRIBUTION
   * ONLY and is deliberately NOT a guard: it updates by id with no status
   * predicate, so it must only be called after `claimForAcceptance` has returned
   * true for the same invitation. What makes that safe is the claim — this
   * method cannot move a row back to `pending` and never creates a credential,
   * so it cannot re-open an invitation the claim retired.
   *
   * @param {number} invitationId
   * @param {number} userId
   * @param {Object} [conn] Optional transaction connection (see BaseModel.query()).
   */
  async accept(invitationId, userId, conn = null) {
    return this.update(invitationId, {
      accepted_by_user_id: userId
    }, conn);
  }

  /**
   * Cancel an invitation
   * @param {number} invitationId
   * @param {Object} [conn] Optional transaction connection (see BaseModel.query()).
   */
  async cancel(invitationId, conn = null) {
    return this.update(invitationId, {
      status: 'cancelled'
    }, conn);
  }

  /**
   * Expire old pending invitations
   */
  async expireOldInvitations() {
    const sql = `
      UPDATE ${this.tableName} 
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= NOW()
    `;
    return this.query(sql);
  }

  /**
   * Check if email has pending invitation for organization
   * @param {string} email
   * @param {number} organizationId
   */
  async hasPendingInvitation(email, organizationId) {
    const sql = `
      SELECT COUNT(*) as count 
      FROM ${this.tableName} 
      WHERE email = ? AND organization_id = ? AND status = 'pending' AND expires_at > NOW()
    `;
    const [result] = await this.query(sql, [email.toLowerCase(), organizationId]);
    return result.count > 0;
  }

  /**
   * Get invitation statistics for organization
   * @param {number} organizationId
   */
  async getStats(organizationId) {
    const sql = `
      SELECT 
        COUNT(CASE WHEN status = 'pending' AND expires_at > NOW() THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted_count,
        COUNT(CASE WHEN status = 'expired' OR (status = 'pending' AND expires_at <= NOW()) THEN 1 END) as expired_count,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count,
        COUNT(*) as total_count
      FROM ${this.tableName}
      WHERE organization_id = ?
    `;
    const [result] = await this.query(sql, [organizationId]);
    return result;
  }
}

module.exports = new InvitationModel();
