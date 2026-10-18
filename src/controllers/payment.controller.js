/**
 * Payment Controller
 * Handles Stripe checkout and payment processing
 */

const paymentService = require('../services/payment.service');
const { getPublicBaseUrl } = require('../utils/helpers');

class PaymentController {
  /**
   * POST /api/payments/checkout
   * Create checkout session for subscription upgrade
   */
  async createCheckout(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      const { planCode } = req.body;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }
      
      if (!planCode) {
        return res.status(400).json({
          success: false,
          message: 'Plan code is required'
        });
      }
      
      // Build return URLs
      const baseUrl = getPublicBaseUrl();
      
      const successUrl = `${baseUrl}/mobile/admin/subscription?payment=success`;
      const cancelUrl = `${baseUrl}/mobile/admin/subscription?payment=cancelled`;
      
      const checkout = await paymentService.createCheckoutSession(
        organizationId,
        planCode,
        successUrl,
        cancelUrl
      );
      
      res.json({
        success: true,
        data: {
          sessionId: checkout.sessionId,
          url: checkout.url
        }
      });
    } catch (error) {
      console.error('Create checkout error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create checkout session'
      });
    }
  }
  
  /**
   * POST /api/payments/extra-seats
   * Create checkout session for extra seats
   */
  async createSeatPayment(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      const { seatCount } = req.body;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }
      
      if (!seatCount || seatCount < 1) {
        return res.status(400).json({
          success: false,
          message: 'Valid seat count is required'
        });
      }
      
      // Build return URLs
      const baseUrl = getPublicBaseUrl();
      
      const successUrl = `${baseUrl}/mobile/admin/subscription?payment=seats_success`;
      const cancelUrl = `${baseUrl}/mobile/admin/subscription?payment=cancelled`;
      
      const checkout = await paymentService.createSeatCheckoutSession(
        organizationId,
        parseInt(seatCount),
        successUrl,
        cancelUrl
      );
      
      res.json({
        success: true,
        data: {
          sessionId: checkout.sessionId,
          url: checkout.url
        }
      });
    } catch (error) {
      console.error('Create seat payment error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to create payment'
      });
    }
  }
  
  /**
   * GET /api/payments/history
   * Get payment history for organization
   */
  async getHistory(req, res, next) {
    try {
      const organizationId = req.user?.organization_id;
      
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'User must belong to an organization'
        });
      }
      
      const history = await paymentService.getPaymentHistory(organizationId);
      
      res.json({
        success: true,
        data: { payments: history }
      });
    } catch (error) {
      console.error('Get payment history error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to load payment history'
      });
    }
  }
  
  /**
   * POST /api/payments/webhook
   * Handle Stripe webhooks
   */
  async handleWebhook(req, res, next) {
    try {
      const signature = req.headers['stripe-signature'];
      
      if (!signature) {
        return res.status(400).json({
          success: false,
          message: 'Stripe signature required'
        });
      }
      
      const event = await paymentService.handleWebhook(req.body, signature);
      
      res.json({
        success: true,
        received: true,
        type: event.type
      });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(400).json({
        success: false,
        message: 'Webhook error: ' + error.message
      });
    }
  }
  
  /**
   * GET /mobile/checkout
   * Checkout page (redirects to Stripe)
   */
  async checkoutPage(req, res) {
    try {
      const { plan } = req.query;
      
      if (!plan) {
        return res.redirect('/mobile/admin/subscription');
      }
      
      const organizationId = req.user?.organization_id;
      
      if (!organizationId) {
        return res.redirect('/login');
      }
      
      const baseUrl = getPublicBaseUrl();
      
      const successUrl = `${baseUrl}/mobile/admin/subscription?payment=success`;
      const cancelUrl = `${baseUrl}/mobile/admin/subscription?payment=cancelled`;
      
      const checkout = await paymentService.createCheckoutSession(
        organizationId,
        plan,
        successUrl,
        cancelUrl
      );
      
      // Redirect to Stripe Checkout
      res.redirect(checkout.url);
    } catch (error) {
      console.error('Checkout page error:', error);
      res.redirect('/mobile/admin/subscription?error=' + encodeURIComponent(error.message));
    }
  }
}

module.exports = new PaymentController();
