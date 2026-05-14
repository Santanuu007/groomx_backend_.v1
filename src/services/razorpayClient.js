import Razorpay from 'razorpay';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, PLATFORM_COMMISSION_PERCENT } from '../config.js';
import crypto from 'crypto';
export const razorpayClient = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// Utility: Calculate commission from amount
// Uses PLATFORM_COMMISSION_PERCENT from config.js - change it there
export function calculateCommission(amount) {
  const commissionPercent = PLATFORM_COMMISSION_PERCENT;
  const commission = Math.round(amount * (commissionPercent / 100));
  const partnerAmount = amount - commission;
  return { commission, partnerAmount, commissionPercent };
}

// Utility: Generate a unique receipt ID
export function generateReceiptId(bookingId) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `GXB${timestamp}${random}`;
}

// Utility: Verify Razorpay webhook signature
export function verifyWebhookSignature(body, signature, secret) {
 
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return expectedSignature === signature;
}

// Utility: Verify payment signature (for payment verification after checkout)
export function verifyPaymentSignature(params) {
  const crypto = require('crypto');
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, key_secret } = params;

  const generatedSignature = crypto
    .createHmac('sha256', key_secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  return generatedSignature === razorpay_signature;
}

// Idempotency: In-memory store (use Redis in production)
// Tracks order creation to prevent duplicate orders
const orderIdempotencyStore = new Map();
// Tracks transfers to prevent duplicate settlements
const transferIdempotencyStore = new Map();

export function isOrderCreated(idempotencyKey) {
  return orderIdempotencyStore.get(idempotencyKey);
}

export function setOrderCreated(idempotencyKey, orderId) {
  orderIdempotencyStore.set(idempotencyKey, orderId);
  // Auto-cleanup after 24 hours
  setTimeout(() => orderIdempotencyStore.delete(idempotencyKey), 86400000);
}

export function isTransferInitiated(idempotencyKey) {
  return transferIdempotencyStore.get(idempotencyKey);
}

export function setTransferInitiated(idempotencyKey, transferId) {
  transferIdempotencyStore.set(idempotencyKey, transferId);
  setTimeout(() => transferIdempotencyStore.delete(idempotencyKey), 86400000);
}