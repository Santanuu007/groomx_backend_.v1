import express from 'express';
import { razorpayClient, calculateCommission, generateReceiptId, isOrderCreated, setOrderCreated } from '../services/razorpayClient.js';
import { PLATFORM_COMMISSION_PERCENT } from '../config.js';
import crypto from 'crypto';
const router = express.Router();

/**
 * POST /api/payments/create-order
 *
 * Creates a Razorpay order for the booking.
 * The money goes to the PLATFORM account (not directly to the barber).
 *
 * Platform Hold Model:
 * - Customer pays ₹200 for a haircut
 * - ₹200 goes to GroomX platform Razorpay account
 * - After service → ₹40 GroomX keeps, ₹160 transfers to barber
 */
router.post('/create-order', async (req, res, next) => {
  try {
    const {
      amount,           // Amount in rupees (₹)
      bookingId,        // GroomX booking ID
      shopId,           // Shop/partner ID (for tracking)
      userId,           // User ID
      shopName,         // Shop name (for description)
      services,         // Array of service names (for description)
      notes,            // Additional notes
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
    } = req.body;

    // ─── Validation ─────────────────────────────────────────────────────────
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount. Must be > 0.' });
    }
    if (!bookingId) {
      return res.status(400).json({ error: 'bookingId is required.' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'userId is required.' });
    }

    // Idempotency key (prevents duplicate order creation)
    const idempotencyKey = req.headers['idempotency-key'] || `order_${bookingId}`;

    // Check if already created (idempotent)
    const existingOrderId = isOrderCreated(idempotencyKey);
    if (existingOrderId) {
      return res.json({
        orderId: existingOrderId,
        amount,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID,
        status: 'already_created',
        message: 'Order was already created for this booking.',
      });
    }

    // ─── Calculate amounts ──────────────────────────────────────────────────
    const amountInPaise = Math.round(amount * 100); // Razorpay uses paise
    const { commission, partnerAmount } = calculateCommission(amount);

    // Generate receipt ID
    const receiptId = generateReceiptId(bookingId);

    // Build description
    const serviceList = Array.isArray(services) ? services.join(', ') : (services || 'GroomX Service');
    const description = `${shopName || 'GroomX'} • ${serviceList}`;

    // ─── Create Razorpay Order ───────────────────────────────────────────────
    const orderPayload = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: receiptId,
      notes: {
        bookingId,
        shopId: shopId || '',
        userId,
        shopName: shopName || '',
        services: serviceList,
        commissionPercent: PLATFORM_COMMISSION_PERCENT,
        commissionAmount: commission,
        partnerAmount,
        ...(notes || {}),
      },
      // Method: If you want to allow only specific methods
      // method: 'upi', // uncomment to restrict to UPI only
    };

    // Add customer details to notes (for reference)
    if (customerName || customerEmail || customerPhone) {
      orderPayload.notes.customerName = customerName || '';
      orderPayload.notes.customerEmail = customerEmail || '';
      orderPayload.notes.customerPhone = customerPhone || '';
    }

    console.log(`[Order] Creating order for booking ${bookingId}: ₹${amount} (commission: ₹${commission})`);

    const order = await razorpayClient.orders.create(orderPayload);

    // Store idempotency
    setOrderCreated(idempotencyKey, order.id);

    console.log(`[Order] Created: ${order.id} for booking ${bookingId}`);

    res.json({
      orderId: order.id,
      amount: amountInPaise,
      amountInRupees: amount,
      currency: 'INR',
      receipt: order.receipt,
      keyId: process.env.RAZORPAY_KEY_ID,
      commission,
      commissionPercent: PLATFORM_COMMISSION_PERCENT,
      partnerAmount,
      status: 'created',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/capture
 *
 * Captures a payment that was authorized (but not captured) on the first pass.
 * Not needed for standard checkout — this is for split payments where
 * you authorize first, then capture after service completion.
 *
 * Most platforms use this for "pay after service" model, but we use
 * "pay before service" so capture is usually automatic. This endpoint
 * exists for delayed capture scenarios.
 */
router.post('/capture', async (req, res, next) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, amount } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id) {
      return res.status(400).json({ error: 'razorpay_payment_id and razorpay_order_id are required.' });
    }

    // In the "platform holds payment" model, capture happens automatically
    // when customer completes payment. This endpoint is for scenarios
    // where you authorized but didn't capture (e.g., pay-after-service model).

    const captureAmount = amount ? Math.round(amount * 100) : undefined;

    const payment = await razorpayClient.payments.capture(
      razorpay_payment_id,
      captureAmount,
    );

    res.json({
      success: true,
      paymentId: payment.id,
      status: payment.status,
      amount: payment.amount,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payments/verify
 *
 * Verifies the payment signature after customer completes checkout.
 * This confirms the payment is legitimate and was not tampered with.
 *
 * Called by the frontend after Razorpay checkout completes.
 */
router.post('/verify', async (req, res, next) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing signature fields.' });
    }

    // Verify using the key secret
    
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      console.warn(`[Verify] Signature mismatch for order ${razorpay_order_id}`);
      return res.status(400).json({ success: false, error: 'Invalid signature.' });
    }

    // Optionally fetch payment details to confirm status
    const payment = await razorpayClient.payments.fetch(razorpay_payment_id);

    if (payment.status !== 'captured') {
      console.warn(`[Verify] Payment not captured: ${payment.status}`);
      return res.json({
        success: true,
        verified: false,
        status: payment.status,
        message: 'Payment not yet captured.',
      });
    }

    console.log(`[Verify] Payment verified: ${razorpay_payment_id} (order: ${razorpay_order_id})`);

    res.json({
      success: true,
      verified: true,
      paymentId: payment.id,
      orderId: razorpay_order_id,
      status: payment.status,
      amount: payment.amount,
      method: payment.method,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/:orderId
 *
 * Fetches order details from Razorpay.
 */
router.get('/:orderId', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await razorpayClient.orders.fetch(orderId);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/payment/:paymentId
 *
 * Fetches payment details from Razorpay.
 */
router.get('/payment/:paymentId', async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const payment = await razorpayClient.payments.fetch(paymentId);
    res.json(payment);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payments/config
 *
 * Returns the platform configuration including commission rate.
 * Frontend uses this to get the current commission percentage.
 */
router.get('/config', (req, res) => {
  res.json({
    commissionPercent: PLATFORM_COMMISSION_PERCENT,
    currency: 'INR',
    platformName: 'GroomX',
  });
});

// ─── Trailing-slash fallbacks (Render/Vercel may add trailing slashes) ────
router.post('/create-order/', (req, res, next) => {
  router.post('/create-order')(req, res, next);
});
router.post('/capture/', (req, res, next) => {
  router.post('/capture')(req, res, next);
});
router.post('/verify/', (req, res, next) => {
  router.post('/verify')(req, res, next);
});
router.get('/config/', (req, res, next) => {
  router.get('/config')(req, res, next);
});

export default router;