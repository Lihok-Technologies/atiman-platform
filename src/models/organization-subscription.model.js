/**
 * Organization Subscription Model
 * Manages seat-based subscriptions for organizations
 */

const BaseModel = require('./base.model');

class OrganizationSubscriptionModel extends BaseModel {
  constructor() {
    super('organization_subscriptions');
  }

  /**
   * Get subscription by organization ID
   * @param {number} organizationId
   * @param {Object} [conn] Optional transaction connection (see BaseModel.query()).
   */
  async findByOrganization(organizationId, conn = null) {
    const [row] = await this.query(
      `SELECT os.*, sp.plan_code, sp.plan_name, sp.description, sp.features
       FROM ${this.tableName} os
       JOIN subscription_plans sp ON os.plan_id = sp.id
       WHERE os.organization_id = ?`,
      [organizationId],
      conn
    );
    return row || null;
  }

  /**
   * Get subscription with plan details
   */
  async getWithPlan(organizationId) {
    const sql = `
      SELECT os.*, 
        sp.plan_code, sp.plan_name, sp.description,
        sp.included_users as plan_included_users,
        sp.max_users as plan_max_users,
        sp.features
      FROM ${this.tableName} os
      JOIN subscription_plans sp ON os.plan_id = sp.id
      WHERE os.organization_id = ?
    `;
    const [row] = await this.query(sql, [organizationId]);
    
    if (!row) return null;

    return {
      ...row,
      features: this.parseFeatures(row.features),
      computed: this.computeBilling(row)
    };
  }

  /**
   * Calculate billing details
   */
  computeBilling(subscription) {
    const includedUsers = subscription.included_users;
    const extraUsers = subscription.extra_users;
    const totalSeats = includedUsers + extraUsers;
    const seatsUsed = subscription.seats_used || 0;
    const seatsAvailable = totalSeats - seatsUsed;
    
    const additionalCost = extraUsers * subscription.price_per_additional_user;
    const totalPrice = subscription.base_price + additionalCost;

    return {
      included_users: includedUsers,
      extra_users: extraUsers,
      total_seats: totalSeats,
      seats_used: seatsUsed,
      seats_available: Math.max(0, seatsAvailable),
      base_price: subscription.base_price,
      additional_cost: additionalCost,
      total_price: totalPrice,
      price_per_additional_user: subscription.price_per_additional_user,
      is_over_limit: seatsUsed > totalSeats && subscription.max_users !== null
    };
  }

  /**
   * Check if organization has available seats
   */
  async hasAvailableSeats(organizationId, requestedSeats = 1) {
    const subscription = await this.getWithPlan(organizationId);
    if (!subscription) return { allowed: false, reason: 'No subscription found' };

    // Check if plan allows unlimited users
    if (subscription.max_users === null) {
      return { allowed: true, seatsAvailable: Infinity };
    }

    const totalSeats = subscription.included_users + subscription.extra_users;
    const currentUsage = subscription.seats_used || 0;
    const seatsAvailable = totalSeats - currentUsage;

    if (seatsAvailable < requestedSeats) {
      return {
        allowed: false,
        reason: 'Seat limit exceeded',
        seatsAvailable,
        seatsNeeded: requestedSeats,
        totalSeats,
        currentUsage,
        canUpgrade: true
      };
    }

    return {
      allowed: true,
      seatsAvailable,
      totalSeats,
      currentUsage
    };
  }

  /**
   * Update seat usage count
   */
  async updateSeatUsage(organizationId) {
    const sql = `
      UPDATE ${this.tableName} 
      SET seats_used = (
        SELECT COUNT(*) 
        FROM users 
        WHERE organization_id = ? 
        AND is_billable = TRUE 
        AND status IN ('active', 'invited')
      ),
      seats_available = (included_users + extra_users) - (
        SELECT COUNT(*) 
        FROM users 
        WHERE organization_id = ? 
        AND is_billable = TRUE 
        AND status IN ('active', 'invited')
      )
      WHERE organization_id = ?
    `;
    return this.query(sql, [organizationId, organizationId, organizationId]);
  }

  /**
   * Add extra seats
   */
  async addSeats(organizationId, additionalSeats) {
    const sql = `
      UPDATE ${this.tableName} 
      SET extra_users = extra_users + ?,
          updated_at = NOW()
      WHERE organization_id = ?
    `;
    return this.query(sql, [additionalSeats, organizationId]);
  }

  /**
   * Update subscription status
   */
  async updateStatus(organizationId, status) {
    return this.updateByOrganization(organizationId, { status });
  }

  /**
   * Update subscription by organization ID
   */
  async updateByOrganization(organizationId, data) {
    const sql = `UPDATE ${this.tableName} SET ? WHERE organization_id = ?`;
    return this.query(sql, [data, organizationId]);
  }

  /**
   * Create subscription for organization
   * @param {number} organizationId
   * @param {number} planId
   * @param {Object} [options]
   * @param {Object} [conn] Optional transaction connection (see BaseModel.query()).
   */
  async createForOrganization(organizationId, planId, options = {}, conn = null) {
    const plan = await this.query(
      'SELECT * FROM subscription_plans WHERE id = ?',
      [planId],
      conn
    ).then(([p]) => p);

    if (!plan) throw new Error('Invalid plan');

    const data = {
      organization_id: organizationId,
      plan_id: planId,
      included_users: options.included_users || plan.included_users,
      extra_users: options.extra_users || 0,
      max_users: plan.max_users,
      base_price: options.base_price || plan.base_price,
      price_per_additional_user: options.price_per_additional_user || plan.price_per_additional_user,
      status: options.status || 'trial',
      billing_cycle: options.billing_cycle || 'monthly',
      current_period_start: options.current_period_start || new Date(),
      current_period_end: options.current_period_end || this.addMonths(new Date(), 1),
      seats_used: 0,
      seats_available: plan.included_users
    };

    const result = await this.create(data, conn);
    
    // Update organization with subscription reference
    await this.query(
      'UPDATE organizations SET subscription_id = ? WHERE id = ?',
      [result.id, organizationId],
      conn
    );

    return result;
  }

  /**
   * Get subscriptions nearing renewal
   */
  async getRenewalsDue(daysBefore = 7) {
    const sql = `
      SELECT os.*, o.organization_name, o.email as org_email
      FROM ${this.tableName} os
      JOIN organizations o ON os.organization_id = o.id
      WHERE os.status IN ('active', 'trial')
      AND os.current_period_end <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
      AND os.current_period_end >= CURDATE()
      AND os.cancel_at_period_end = FALSE
    `;
    return this.query(sql, [daysBefore]);
  }

  /**
   * Get overdue subscriptions
   */
  async getOverdue() {
    const sql = `
      SELECT os.*, o.organization_name
      FROM ${this.tableName} os
      JOIN organizations o ON os.organization_id = o.id
      WHERE os.status IN ('trial', 'active')
      AND os.current_period_end < CURDATE()
    `;
    return this.query(sql);
  }

  /**
   * Parse features JSON
   */
  parseFeatures(featuresJson) {
    try {
      return featuresJson ? JSON.parse(featuresJson) : [];
    } catch {
      return [];
    }
  }

  /**
   * Add months to date
   */
  addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }
}

module.exports = new OrganizationSubscriptionModel();
