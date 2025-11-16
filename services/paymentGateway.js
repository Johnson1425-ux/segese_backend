import Stripe from 'stripe';
import logger from '../utils/logger.js';

// Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_your_test_key', {
  apiVersion: '2023-10-16',
});

class PaymentGatewayService {
  /**
   * Create a payment intent for card payments
   */
  async createPaymentIntent(amount, currency = 'usd', metadata = {}) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString()
        }
      });

      return {
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount / 100
      };
    } catch (error) {
      logger.error('Stripe payment intent creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Confirm a payment
   */
  async confirmPayment(paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      
      if (paymentIntent.status === 'succeeded') {
        return {
          success: true,
          transactionId: paymentIntent.id,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency,
          status: paymentIntent.status,
          paymentMethod: paymentIntent.payment_method,
          receiptUrl: paymentIntent.charges?.data[0]?.receipt_url
        };
      } else {
        return {
          success: false,
          status: paymentIntent.status,
          error: 'Payment not completed'
        };
      }
    } catch (error) {
      logger.error('Stripe payment confirmation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create a refund
   */
  async createRefund(paymentIntentId, amount = null, reason = 'requested_by_customer') {
    try {
      const refundData = {
        payment_intent: paymentIntentId,
        reason
      };

      if (amount) {
        refundData.amount = Math.round(amount * 100); // Partial refund
      }

      const refund = await stripe.refunds.create(refundData);

      return {
        success: true,
        refundId: refund.id,
        amount: refund.amount / 100,
        currency: refund.currency,
        status: refund.status,
        reason: refund.reason
      };
    } catch (error) {
      logger.error('Stripe refund error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create a customer
   */
  async createCustomer(customerData) {
    try {
      const customer = await stripe.customers.create({
        email: customerData.email,
        name: `${customerData.firstName} ${customerData.lastName}`,
        phone: customerData.phone,
        metadata: {
          patientId: customerData.patientId
        }
      });

      return {
        success: true,
        customerId: customer.id
      };
    } catch (error) {
      logger.error('Stripe customer creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create a subscription for recurring payments
   */
  async createSubscription(customerId, priceId, metadata = {}) {
    try {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
        metadata
      });

      return {
        success: true,
        subscriptionId: subscription.id,
        status: subscription.status,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret
      };
    } catch (error) {
      logger.error('Stripe subscription creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.cancel(subscriptionId);

      return {
        success: true,
        subscriptionId: subscription.id,
        status: subscription.status,
        canceledAt: new Date(subscription.canceled_at * 1000)
      };
    } catch (error) {
      logger.error('Stripe subscription cancellation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create a payment link for invoice payments
   */
  async createPaymentLink(invoiceData) {
    try {
      const paymentLink = await stripe.paymentLinks.create({
        line_items: invoiceData.items.map(item => ({
          price_data: {
            currency: 'usd',
            product_data: {
              name: item.description,
              description: `Type: ${item.type}`
            },
            unit_amount: Math.round(item.unitPrice * 100)
          },
          quantity: item.quantity
        })),
        metadata: {
          invoiceId: invoiceData.invoiceId,
          patientId: invoiceData.patientId
        },
        after_completion: {
          type: 'redirect',
          redirect: {
            url: `${process.env.FRONTEND_URL}/billing/payment-success?invoice=${invoiceData.invoiceId}`
          }
        }
      });

      return {
        success: true,
        paymentUrl: paymentLink.url,
        paymentLinkId: paymentLink.id
      };
    } catch (error) {
      logger.error('Stripe payment link creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload, signature) {
    try {
      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      return { success: true, event };
    } catch (error) {
      logger.error('Stripe webhook verification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle webhook events
   */
  async handleWebhookEvent(event) {
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          // Handle successful payment
          logger.info('Payment succeeded:', event.data.object.id);
          return { success: true, action: 'payment_completed' };

        case 'payment_intent.payment_failed':
          // Handle failed payment
          logger.error('Payment failed:', event.data.object.id);
          return { success: true, action: 'payment_failed' };

        case 'charge.refunded':
          // Handle refund
          logger.info('Refund processed:', event.data.object.id);
          return { success: true, action: 'refund_processed' };

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          // Handle subscription events
          logger.info(`Subscription ${event.type}:`, event.data.object.id);
          return { success: true, action: 'subscription_updated' };

        default:
          logger.info('Unhandled webhook event type:', event.type);
          return { success: true, action: 'unhandled' };
      }
    } catch (error) {
      logger.error('Webhook handling error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default new PaymentGatewayService();
