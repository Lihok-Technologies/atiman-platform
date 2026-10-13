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
   * Accept an invitation
   * @param {number} invitationId
   * @param {number} userId
   * @param {Object} [conn] Optional transaction connection (see BaseModel.query()).
   */
  async accept(invitationId, userId, conn = null) {
    return this.update(invitationId, {
      status: 'accepted',
      accepted_at: new Date(),
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
