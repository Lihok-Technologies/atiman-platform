/**
 * Subscription Controller
 * 
 * Handles subscription management endpoints for organizations.
 */

const subscriptionService = require('../services/subscription.service');
// ATM-001-SEC-104-R2 F1: this was `const pool = require('../config/database')`,
// i.e. the MODULE, so `pool.execute(...)` was `undefined` and threw. In
// updateOrganizationSubscription that throw happened AFTER changePlan() and
// setExtraUsers() had already committed, so a real cross-tenant write was
// reported as HTTP 500 — an error that concealed a persisted mutation. The
// route now also requires platform.admin, so the defect is not reachable from
// HTTP by a human principal either way; it is fixed so the failure mode cannot
// outlive the guard.
const { pool } = require('../config/database');

class SubscriptionController {
  /**
   * Get available subscription plans
   * GET /api/subscriptions/plans
   */
  async getPlans(req, res, next) {
    try {
      const includePrivate = req.user?.role === 'superadmin';
      const plans = await subscriptionService.getPlans(includePrivate);
      
      res.json({
        success: true,
        data: { plans }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get current organization's subscription
   * GET /api/subscriptions/current
   */
  async getCurrentSubscription(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      let billing = await subscriptionService.getBillingInfo(organizationId);
      let seats = await subscriptionService.getSeatUsage(organizationId);
      
      // If no subscription exists, create default free subscription
      if (!billing) {
        await subscriptionService.createDefaultSubscription(organizationId);
        billing = await subscriptionService.getBillingInfo(organizationId);
        seats = await subscriptionService.getSeatUsage(organizationId);
      }
      
      if (!billing) {
        return res.status(500).json({
          success: false,
          message: 'Failed to create subscription'
        });
      }

      res.json({
        success: true,
        data: {
          subscription: billing,
          seats
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get seat usage for current organization
   * GET /api/subscriptions/seats
   */
  async getSeatUsage(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      let usage = await subscriptionService.getSeatUsage(organizationId);
      
      // If no subscription, return default free plan seat usage
      if (!usage) {
        const { getDb } = require('../config/database');
        const db = getDb();
        
        // Count active users
        const [result] = await db.query(
          `SELECT COUNT(*) as count FROM users WHERE organization_id = ? AND status IN ('active', 'invited')`,
          [organizationId]
        );
        const used = result[0]?.count || 0;
        const total = 5; // Free plan default
        
        usage = {
          includedUsers: 3,
          extraUsers: 0,
          totalAllowedUsers: 5,
          total: total,
          maxUsers: 5,
          activeUsers: used,
          used: used,
          availableSeats: Math.max(0, total - used),
          available: Math.max(0, total - used),
          overHardLimit: false,
          isFull: used >= total,
          plan: { code: 'free', name: 'Free' }
        };
      }

      res.json({
        success: true,
        data: usage
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Change subscription plan (admin only)
   * PUT /api/subscriptions/plan
   */
  async changePlan(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      const { planId, plan_code, billingCycle } = req.body;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      if (!planId && !plan_code) {
        return res.status(400).json({
          success: false,
          message: 'Plan ID or plan code is required'
        });
      }

      const billing = await subscriptionService.changePlan(organizationId, planId || plan_code, {
        billingCycle: billingCycle || 'monthly'
      });

      res.json({
        success: true,
        message: 'Plan updated successfully',
        data: { subscription: billing }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add extra users to subscription (admin only)
   * PUT /api/subscriptions/extra-users
   */
  async setExtraUsers(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      const { extraUsers } = req.body;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      if (extraUsers === undefined || extraUsers === null) {
        return res.status(400).json({
          success: false,
          message: 'extraUsers is required'
        });
      }

      const billing = await subscriptionService.setExtraUsers(organizationId, extraUsers);

      res.json({
        success: true,
        message: 'Extra users updated successfully',
        data: { subscription: billing }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel subscription (admin only)
   * POST /api/subscriptions/cancel
   */
  async cancelSubscription(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      const { reason } = req.body;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      // Get current subscription
      const billing = await subscriptionService.getBillingInfo(organizationId);
      
      if (!billing) {
        return res.status(404).json({
          success: false,
          message: 'Subscription not found'
        });
      }

      // Mark for cancellation at period end
      await pool.execute(
        `UPDATE organization_subscriptions 
         SET cancel_at_period_end = TRUE, 
             cancellation_reason = ?,
             cancelled_at = NOW(),
             updated_at = NOW()
         WHERE organization_id = ?`,
        [reason || null, organizationId]
      );

      res.json({
        success: true,
        message: 'Subscription will be cancelled at the end of the current billing period',
        data: {
          currentPeriodEnd: billing.currentPeriodEnd,
          cancelAtPeriodEnd: true
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reactivate cancelled subscription (admin only)
   * POST /api/subscriptions/reactivate
   */
  async reactivateSubscription(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }

      await pool.execute(
        `UPDATE organization_subscriptions 
         SET cancel_at_period_end = FALSE, 
             cancelled_at = NULL,
             cancellation_reason = NULL,
             status = 'active',
             updated_at = NOW()
         WHERE organization_id = ?`,
        [organizationId]
      );

      const billing = await subscriptionService.getBillingInfo(organizationId);

      res.json({
        success: true,
        message: 'Subscription reactivated successfully',
        data: { subscription: billing }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Get subscription for any organization
   * GET /api/admin/organizations/:id/subscription
   */
  async getOrganizationSubscription(req, res, next) {
    try {
      const organizationId = req.params.id;

      const [org] = await pool.execute(
        'SELECT id, name FROM organizations WHERE id = ?',
        [organizationId]
      );

      if (!org[0]) {
        return res.status(404).json({
          success: false,
          message: 'Organization not found'
        });
      }

      const billing = await subscriptionService.getBillingInfo(organizationId);
      const seats = await subscriptionService.getSeatUsage(organizationId);

      res.json({
        success: true,
        data: {
          organization: org[0],
          subscription: billing,
          seats
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Update subscription for any organization
   * PUT /api/admin/organizations/:id/subscription
   */
  async updateOrganizationSubscription(req, res, next) {
    try {
      const organizationId = req.params.id;
      const { planId, extraUsers, status } = req.body;

      if (planId) {
        await subscriptionService.changePlan(organizationId, planId);
      }

      if (extraUsers !== undefined) {
        await subscriptionService.setExtraUsers(organizationId, extraUsers);
      }

      if (status) {
        await pool.execute(
          `UPDATE organization_subscriptions 
           SET status = ?, updated_at = NOW()
           WHERE organization_id = ?`,
          [status, organizationId]
        );
      }

      const billing = await subscriptionService.getBillingInfo(organizationId);
      const seats = await subscriptionService.getSeatUsage(organizationId);

      res.json({
        success: true,
        message: 'Subscription updated successfully',
        data: {
          subscription: billing,
          seats
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SubscriptionController();
