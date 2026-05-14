import express from 'express';
import crypto from 'crypto';
import { RAZORPAY_WEBHOOK_SECRET } from '../config.js';
import { initiateSettlement } from '../services/settlementService.js';

const router = express.Router();

/**
 * POST /api/webhooks/razorpay
 *
 * Receives Razorpay webhook events.
 * IMPORTANT: This route uses express.raw() parser (set in index.js)
 * to get the raw body for signature verification.
 *
 * Events handled:
 * - payment.captured      → Booking confirmed, ready for service
 * - payment.failed        → Log failure, notify customer (optional)
 * - transfer.created      → Settlement transfer completed
 * - transfer.credited     → Partner received their money
 * - transfer.reversed     → Settlement reversed (refund/dispute)
 */
router.post('/razorpay', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];

    // ─── Verify Signature ───────────────────────────────────────────────────
    if (!signature) {
      console.warn('[Webhook] Missing signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }

    const isValid = verifySignature(req.body, signature, RAZORPAY_WEBHOOK_SECRET);
    if (!isValid) {
      console.warn('[Webhook] Invalid signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    const payload = event.payload;
    const eventType = event.event;

    console.log(`[Webhook] Received event: ${eventType}`);
    console.log(`[Webhook] Event ID: ${event.webhook_id}`);
    console.log(`[Webhook] Timestamp: ${new Date(event.created_at * 1000).toISOString()}`);

    // ─── Handle Events ─────────────────────────────────────────────────────
    switch (eventType) {
      case 'payment.captured': {
        // Customer completed payment → money is in platform account
        const payment = payload.payment.entity;
        console.log(`[Webhook] Payment captured: ${payment.id} | Amount: ₹${payment.amount / 100}`);

        // Store this in your database:
        // - Update booking status to 'confirmed' in Supabase
        // - Store razorpay_payment_id, razorpay_order_id
        // - This event confirms the money was received by the platform

        // Example Supabase call (you'd add this to your frontend integration):
        // await supabase.from('bookings').update({
        //   status: 'confirmed',
        //   deposit_paid: true,
        //   razorpay_payment_id: payment.id,
        //   razorpay_order_id: payment.order_id,
        // }).eq('booking_id', payment.notes.bookingId);

        break;
      }

      case 'payment.failed': {
        const payment = payload.payment.entity;
        console.log(`[Webhook] Payment failed: ${payment.id} | Reason: ${payment.error_description}`);

        // Update booking status to 'cancelled' in your database
        // Optionally notify customer via email/SMS

        break;
      }

      case 'order.paid': {
        // Same as payment.captured — the order is fully paid
        const order = payload.order.entity;
        console.log(`[Webhook] Order paid: ${order.id} | Amount: ₹${order.amount / 100}`);

        break;
      }

      case 'transfer.created': {
        // A settlement transfer was created (money moved to partner)
        const transfer = payload.transfer.entity;
        console.log(`[Webhook] Transfer created: ${transfer.id}`);
        console.log(`  Amount: ₹${transfer.amount / 100} | Account: ${transfer.account}`);

        // Store transfer details in your database:
        // - Update booking with transfer_id
        // - Log commission distribution

        break;
      }

      case 'transfer.credited': {
        // Partner's account was credited (they received the money)
        const transfer = payload.transfer.entity;
        console.log(`[Webhook] Transfer credited to partner: ${transfer.id}`);
        console.log(`  Amount: ₹${transfer.amount / 100}`);

        // Update booking status to 'settled' or 'completed'
        // Optionally send notification to partner

        break;
      }

      case 'transfer.reversed': {
        // A settlement was reversed (refund or dispute)
        const transfer = payload.transfer.entity;
        console.log(`[Webhook] Transfer reversed: ${transfer.id}`);
        console.log(`  Reason: ${transfer.reversal_reason || 'Not specified'}`);

        // Update booking status
        // Log the reversal for audit

        break;
      }

      case 'refund.created': {
        // A refund was processed
        const refund = payload.refund.entity;
        console.log(`[Webhook] Refund created: ${refund.id} | Amount: ₹${refund.amount / 100}`);

        // Update booking status if full refund
        // Log refund details

        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${eventType}`);
    }

    // Always respond 200 quickly to Razorpay (they retry otherwise)
    res.json({ received: true, event: eventType });
  } catch (err) {
    console.error('[Webhook] Error processing webhook:', err);
    // Respond 200 anyway to prevent Razorpay from retrying forever
    // Log the error and handle it manually
    res.json({ received: true, error: 'Processing error (logged)' });
  }
});

/**
 * Verifies the Razorpay webhook signature.
 */
function verifySignature(body, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return expectedSignature === signature;
}

export default router;