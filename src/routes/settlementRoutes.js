import express from 'express';
import {
  initiateSettlement,
  getSettlementStatus,
  reverseSettlement,
  getTransfersForPayment,
} from '../services/settlementService.js';

const router = express.Router();

/**
 * POST /api/settlements/initiate
 *
 * Initiates a settlement transfer to the barber/partner.
 * Called by the GroomX frontend (or partner dashboard) when a
 * booking is marked as "completed" by the shop.
 *
 * The flow:
 * 1. Partner marks booking as "completed" → frontend calls this endpoint
 * 2. Backend creates a Razorpay Transfer from platform → partner
 * 3. Partner receives the money (amount - 20% commission) in their account
 */
router.post('/initiate', async (req, res, next) => {
  try {
    const {
      bookingId,
      paymentId,
      orderId,
      amount,
      partnerRazorpayAccountId,
      partnerId,
      shopName,
    } = req.body;

    if (!bookingId) {
      return res.status(400).json({ error: 'bookingId is required.' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount.' });
    }
    if (!partnerRazorpayAccountId) {
      return res.status(400).json({
        error: 'Partner Razorpay account ID is required. Partner must register their Razorpay account first.',
        code: 'PARTNER_ACCOUNT_NOT_REGISTERED',
      });
    }

    const result = await initiateSettlement({
      bookingId,
      paymentId,
      orderId,
      amount,
      partnerRazorpayAccountId,
      partnerId,
      shopName,
    });

    if (!result.success && result.status === 'account_error') {
      return res.status(400).json(result);
    }

    if (!result.success && result.status === 'not_configured') {
      return res.status(503).json(result);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settlements/:bookingId
 *
 * Gets the settlement status for a booking.
 * Queries Razorpay for the transfer linked to the booking.
 */
router.get('/:bookingId', async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    // Note: In production, you'd store the transfer ID in your database
    // and fetch it directly. This endpoint demonstrates the lookup flow.
    // For now, we return a message to use the transfer ID.
    res.json({
      bookingId,
      message: 'Use the transferId returned from /api/settlements/initiate to check status.',
      note: 'In production, store transferId in your database when initiating settlement.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settlements/transfer/:transferId
 *
 * Gets the details and status of a specific transfer.
 */
router.get('/transfer/:transferId', async (req, res, next) => {
  try {
    const { transferId } = req.params;
    const status = await getSettlementStatus(transferId);
    if (status.error) {
      return res.status(404).json(status);
    }
    res.json(status);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settlements/reverse
 *
 * Reverses a settlement transfer.
 * Called when a booking is cancelled post-settlement,
 * or when a dispute/refund is raised.
 */
router.post('/reverse', async (req, res, next) => {
  try {
    const { transferId, reason } = req.body;

    if (!transferId) {
      return res.status(400).json({ error: 'transferId is required.' });
    }

    const result = await reverseSettlement(transferId, reason);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settlements/payment/:paymentId/transfers
 *
 * Gets all settlement transfers for a payment.
 * Useful for auditing.
 */
router.get('/payment/:paymentId/transfers', async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const transfers = await getTransfersForPayment(paymentId);
    res.json(transfers);
  } catch (err) {
    next(err);
  }
});

export default router;