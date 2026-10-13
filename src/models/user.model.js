/**
 * User Model
 * Multi-tenant aware user management
 */

const BaseModel = require('./base.model');

class UserModel extends BaseModel {
  constructor() {
    super('users');
  }

  /**
   * Find user by username (organization-aware)
   * @param {string} username
   * @param {number} organizationId - Optional organization filter
   * @returns {Promise<Object|null>}
   */
  async findByUsername(username, organizationId = null) {
    let sql = `SELECT * FROM ${this.tableName} WHERE username = ?`;
    const params = [username];
    
    if (organizationId) {
      sql += ' AND organization_id = ?';
      params.push(organizationId);
    }
    
    const [row] = await this.query(sql, params);
    return row || null;
  }

  /**
   * Find user by email (organization-aware)
   * @param {string} email
   * @param {number} organizationId - Optional organization filter
   * @returns {Promise<Object|null>}
   */
  async findByEmail(email, organizationId = null) {
    let sql = `SELECT * FROM ${this.tableName} WHERE email = ?`;
    const params = [email];
    
    if (organizationId) {
      sql += ' AND organization_id = ?';
      params.push(organizationId);
    }
    
    const [row] = await this.query(sql, params);
    return row || null;
  }

  /**
   * Find user by phone number
   * @param {string} phone
   * @param {number} organizationId - Optional organization filter
   * @returns {Promise<Object|null>}
   */
  async findByPhone(phone, organizationId = null) {
    let sql = `SELECT * FROM ${this.tableName} WHERE phone = ?`;
    const params = [phone];
    
    if (organizationId) {
      sql += ' AND organization_id = ?';
      params.push(organizationId);
    }
    
    const [row] = await this.query(sql, params);
    return row || null;
  }

  /**
   * Find user by email or phone (for login)
   * @param {string} identifier - email or phone
   * @returns {Promise<Object|null>}
   */
  async findByEmailOrPhone(identifier) {
    const sql = `SELECT * FROM ${this.tableName} WHERE email = ? OR phone = ?`;
    const [row] = await this.query(sql, [identifier, identifier]);
    return row || null;
  }

  /**
   * Update last login time
   * @param {number} userId
   * @returns {Promise}
   */
  async updateLastLogin(userId) {
    return this.update(userId, { last_login: new Date() });
  }

  /**
   * Get users by role (organization-aware)
   * @param {string} role
   * @param {number} organizationId
   * @returns {Promise<Array>}
   */
  async findByRole(role, organizationId) {
    return this.findAll({ role, organization_id: organizationId, is_active: true });
  }

  /**
   * Get active operators (organization-aware)
   * @param {number} organizationId
   * @returns {Promise<Array>}
   */
  async getActiveOperators(organizationId) {
    return this.findAll(
      { role: 'operator', organization_id: organizationId, is_active: true }, 
      { orderBy: 'full_name' }
    );
  }

  /**
   * Search users (organization-aware)
   * @param {string} searchTerm
   * @param {number} organizationId
   * @returns {Promise<Array>}
   */
  async search(searchTerm, organizationId) {
    const sql = `
      SELECT u.*, o.organization_name
      FROM ${this.tableName} u
      JOIN organizations o ON u.organization_id = o.id
      WHERE u.organization_id = ?
      AND u.is_active = TRUE 
      AND (u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)
      ORDER BY u.full_name
    `;
    const likeTerm = `%${searchTerm}%`;
    return this.query(sql, [organizationId, likeTerm, likeTerm, likeTerm]);
  }

  /**
   * Get all users with facility information (organization-aware)
   * @param {number} organizationId
   * @returns {Promise<Array>}
   */
  async getAllWithFacility(organizationId) {
    const sql = `
      SELECT u.*, f.name as facility_name, f.code as facility_code,
             o.organization_name
      FROM ${this.tableName} u
      LEFT JOIN facilities f ON u.facility_id = f.id
      JOIN organizations o ON u.organization_id = o.id
      WHERE u.organization_id = ?
      ORDER BY u.full_name
    `;
    return this.query(sql, [organizationId]);
  }

  /**
   * Get users by facility (organization-aware)
   * @param {number} facilityId
   * @param {number} organizationId
   * @param {Object} filters
   * @returns {Promise<Array>}
   */
  async getByFacility(facilityId, organizationId, filters = {}) {
    let sql = `
      SELECT u.*, f.name as facility_name, f.code as facility_code
      FROM ${this.tableName} u
      LEFT JOIN facilities f ON u.facility_id = f.id
      WHERE u.facility_id = ? 
      AND u.organization_id = ?
      AND u.is_active = TRUE
    `;
    const params = [facilityId, organizationId];

    if (filters.role) {
      sql += ' AND u.role = ?';
      params.push(filters.role);
    }

    sql += ' ORDER BY u.full_name';
    return this.query(sql, params);
  }

  /**
   * Get active operators by facility (organization-aware)
   * @param {number} facilityId
   * @param {number} organizationId
   * @returns {Promise<Array>}
   */
  async getActiveOperatorsByFacility(facilityId, organizationId) {
    return this.getByFacility(facilityId, organizationId, { role: 'operator' });
  }

  /**
   * Get all users for organization
   * @param {number} organizationId
   * @param {Object} filters
   * @returns {Promise<Array>}
   */
  async getByOrganization(organizationId, filters = {}) {
    const filterConditions = { organization_id: organizationId };
    
    if (filters.is_active !== undefined) {
      filterConditions.is_active = filters.is_active;
    }
    if (filters.role) {
      filterConditions.role = filters.role;
    }

    return this.findAll(filterConditions, { orderBy: filters.orderBy || 'full_name' });
  }

  /**
   * Check if email exists in organization
   * @param {string} email
   * @param {number} organizationId
   * @param {number} excludeUserId - Optional user ID to exclude (for updates)
   * @returns {Promise<boolean>}
   */
  async emailExistsInOrganization(email, organizationId, excludeUserId = null) {
    let sql = `
      SELECT COUNT(*) as count 
      FROM ${this.tableName} 
      WHERE email = ? AND organization_id = ?
    `;
    const params = [email, organizationId];
    
    if (excludeUserId) {
      sql += ' AND id != ?';
      params.push(excludeUserId);
    }
    
    const [result] = await this.query(sql, params);
    return result.count > 0;
  }

  /**
   * Check if username exists in organization
   * @param {string} username
   * @param {number} organizationId
   * @param {number} excludeUserId - Optional user ID to exclude (for updates)
   * @returns {Promise<boolean>}
   */
  async usernameExistsInOrganization(username, organizationId, excludeUserId = null) {
    let sql = `
      SELECT COUNT(*) as count 
      FROM ${this.tableName} 
      WHERE username = ? AND organization_id = ?
    `;
    const params = [username, organizationId];
    
    if (excludeUserId) {
      sql += ' AND id != ?';
      params.push(excludeUserId);
    }
    
    const [result] = await this.query(sql, params);
    return result.count > 0;
  }

  /**
   * Count users in organization
   * @param {number} organizationId
   * @param {Object} filters
   * @returns {Promise<number>}
   */
  async countByOrganization(organizationId, filters = {}) {
    const filterConditions = { organization_id: organizationId };
    
    if (filters.is_active !== undefined) {
      filterConditions.is_active = filters.is_active;
    }
    if (filters.role) {
      filterConditions.role = filters.role;
    }
    if (filters.status) {
      filterConditions.status = filters.status;
    }
    if (filters.is_billable !== undefined) {
      filterConditions.is_billable = filters.is_billable;
    }

    return this.count(filterConditions);
  }

  /**
   * Count billable active/invited users for seat calculation
   * @param {number} organizationId
   * @returns {Promise<number>}
   */
  async countBillableUsers(organizationId) {
    const sql = `
      SELECT COUNT(*) as count 
      FROM ${this.tableName} 
      WHERE organization_id = ? 
      AND is_billable = TRUE 
      AND status IN ('active', 'invited')
    `;
    const [result] = await this.query(sql, [organizationId]);
    return result.count;
  }

  /**
   * Get users by status
   * @param {number} organizationId
   * @param {string} status
   * @returns {Promise<Array>}
   */
  async getByStatus(organizationId, status) {
    return this.findAll(
      { organization_id: organizationId, status },
      { orderBy: 'created_at', order: 'desc' }
    );
  }

  /**
   * Invite a new user
   * @param {Object} data
   * @param {number} invitedBy
   * @returns {Promise<Object>}
   */
  async inviteUser(data, invitedBy) {
    const userData = {
      ...data,
      status: 'invited',
      invited_by: invitedBy,
      invited_at: new Date(),
      is_active: false,
      is_billable: data.is_billable !== false // Default to billable
    };
    return this.create(userData);
  }

  /**
   * Activate an invited user
   * @param {number} userId
   * @param {Object} activationData
   * @returns {Promise<Object>}
   */
  async activateUser(userId, activationData = {}) {
    return this.update(userId, {
      status: 'active',
      is_active: true,
      ...activationData
    });
  }

  /**
   * Suspend a user
   * @param {number} userId
   * @param {string} reason
   * @returns {Promise<Object>}
   */
  async suspendUser(userId, reason = null) {
    return this.update(userId, {
      status: 'suspended',
      is_active: false,
      suspension_reason: reason
    });
  }

  /**
   * Archive a user (soft delete)
   * @param {number} userId
   * @returns {Promise<Object>}
   */
  async archiveUser(userId) {
    return this.update(userId, {
      status: 'archived',
      is_active: false,
      is_billable: false,
      archived_at: new Date()
    });
  }

  /**
   * Delete a user only within the given organization (ATM-001-SEC-00B).
   *
   * The tenant predicate is part of the destructive statement rather than only
   * of the authorization middleware that precedes it, so the *effect* of the
   * delete cannot be widened by a later change to that middleware. This does not
   * modify the inherited, tenant-agnostic `BaseModel.delete`.
   *
   * @param {number} id
   * @param {number} organizationId
   * @returns {Promise<boolean>} true only when a row of that tenant was removed
   */
  async deleteForOrganization(id, organizationId) {
    const result = await this.query(
      `DELETE FROM ${this.tableName} WHERE id = ? AND organization_id = ?`,
      [id, organizationId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Set user as organization admin
   * @param {number} userId
   * @param {boolean} isAdmin
   * @returns {Promise<Object>}
   */
  async setOrganizationAdmin(userId, isAdmin) {
    return this.update(userId, { is_organization_admin: isAdmin });
  }
}

module.exports = new UserModel();
