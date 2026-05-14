import { razorpayClient, calculateCommission, isTransferInitiated, setTransferInitiated } from './razorpayClient.js';
import { PLATFORM_RAZORPAY_ACCOUNT, PLATFORM_COMMISSION_PERCENT } from '../config.js';

/**
 * SettlementService
 *
 * Handles the core platform hold model:
 * 1. Customer pays → money goes to platform Razorpay account
 * 2. Service completes → platform transfers (amount - commission) to barber
 *
 * This uses Razorpay Transfers API to move money from the platform
 * account to the partner/barber's Razorpay account.
 *
 * IMPORTANT: For this to work:
 * - Partners need a RazorpayX account (or linked Razorpay account)
 * - Partner's Razorpay account ID needs to be stored in the GroomX database
 * - Partner's account must be KYC verified and active
 */

/**
 * Initiates a settlement transfer to the barber.
 * Called when a booking is marked as "completed" by the partner.
 *
 * @param {Object} params
 * @param {string} params.bookingId - The GroomX booking ID
 * @param {string} params.paymentId - Razorpay payment ID (captured)
 * @param {string} params.orderId - Razorpay order ID
 * @param {number} params.amount - Total booking amount in rupees
 * @param {string} params.partnerRazorpayAccountId - Partner's Razorpay account ID
 * @param {string} params.partnerId - Partner's user ID in GroomX
 * @param {string} params.shopName - Name of the shop
 * @param {string} [params.idempotencyKey] - Idempotency key (auto-generated if not provided)
 * @returns {Promise<Object>} Transfer details
 */
export async function initiateSettlement({
  bookingId,
  paymentId,
  orderId,
  amount,
  partnerRazorpayAccountId,
  partnerId,
  shopName,
  idempotencyKey,
}) {
  if (!bookingId) throw new Error('bookingId is required');
  if (!paymentId) throw new Error('paymentId is required');
  if (!partnerRazorpayAccountId) throw new Error('Partner Razorpay account ID is required. Partner must register their Razorpay account.');

  const amountInPaise = Math.round(amount * 100);
  const { commission, partnerAmount } = calculateCommission(amount);

  // Idempotency: prevent duplicate transfers for the same booking
  const ik = idempotencyKey || `settlement_${bookingId}`;
  const existingTransfer = isTransferInitiated(ik);
  if (existingTransfer) {
    console.log(`[Settlement] Already initiated for booking ${bookingId}: ${existingTransfer}`);
    return { transferId: existingTransfer, status: 'already_initiated', message: 'Transfer already initiated for this booking.' };
  }

  // If no platform account configured, log warning but continue
  if (!PLATFORM_RAZORPAY_ACCOUNT || PLATFORM_RAZORPAY_ACCOUNT === 'YOUR_PLATFORM_RAZORPAY_ACCOUNT_ID') {
    console.warn(`[Settlement] Platform account not configured. Skipping settlement for booking ${bookingId}.`);
    return {
      success: false,
      status: 'not_configured',
      message: 'Platform Razorpay account not configured. Settlement skipped.',
      commission,
      partnerAmount,
    };
  }

  // ─── Create Transfer ─────────────────────────────────────────────────────
  // Transfer money from platform account to partner's account
  // The transfer is linked to the original payment
  const transferPayload = {
    account: partnerRazorpayAccountId,
    amount: Math.round(partnerAmount * 100), // Partner gets: amount - commission (in paise)
    currency: 'INR',
    notes: {
      bookingId,
      partnerId,
      shopName: shopName || '',
      totalAmount: amount,
      platformCommission: commission,
      commissionPercent: PLATFORM_COMMISSION_PERCENT,
      partnerAmount,
    },
    // linkedAccountPhone: '9999999999',  // Optional: partner's phone
    // linkedAccountEmail: 'partner@example.com', // Optional: partner's email
  };

  // If we have the payment ID from the captured payment, link it
  if (paymentId) {
    transferPayload.source = `pay_${paymentId}`;
    transferPayload.source_type = 'payment';
  }

  console.log(`[Settlement] Initiating transfer for booking ${bookingId}:`);
  console.log(`  Total: ₹${amount} | Commission: ₹${commission} (${PLATFORM_COMMISSION_PERCENT}%) | Partner: ₹${partnerAmount}`);
  console.log(`  Partner account: ${partnerRazorpayAccountId}`);

  try {
    const transfer = await razorpayClient.transfers.create(transferPayload);

    setTransferInitiated(ik, transfer.id);

    console.log(`[Settlement] Transfer created: ${transfer.id} for booking ${bookingId}`);

    return {
      success: true,
      transferId: transfer.id,
      status: transfer.status,
      amount: transfer.amount,
      amountInRupees: transfer.amount / 100,
      partnerAccount: partnerRazorpayAccountId,
      commission,
      commissionPercent: PLATFORM_COMMISSION_PERCENT,
      partnerAmount,
      recipientAmount: partnerAmount,
      notes: transfer.notes,
      createdAt: transfer.created_at,
    };
  } catch (err) {
    // Handle specific Razorpay errors
    if (err.statusCode === 400 && err.error?.code === 'BAD_REQUEST_ERROR') {
      const message = err.error?.description || err.message;

      // Check if it's a linked account error
      if (message.includes('account') || message.includes('invalid') || message.includes('KYC')) {
        console.error(`[Settlement] Partner account error: ${message}`);
        return {
          success: false,
          status: 'account_error',
          error: 'Partner Razorpay account is invalid or not KYC verified.',
          message,
          commission,
          partnerAmount,
        };
      }
    }

    throw err;
  }
}

/**
 * Gets the status of a settlement transfer.
 */
export async function getSettlementStatus(transferId) {
  try {
    const transfer = await razorpayClient.transfers.fetch(transferId);
    return {
      transferId: transfer.id,
      status: transfer.status,
      amount: transfer.amount,
      amountInRupees: transfer.amount / 100,
      recipientAccount: transfer.account,
      createdAt: transfer.created_at,
      settledAt: transfer.settled_at,
      notes: transfer.notes,
    };
  } catch (err) {
    if (err.statusCode === 400 && err.error?.code === 'BAD_REQUEST_ERROR') {
      return { error: 'Transfer not found', transferId };
    }
    throw err;
  }
}

/**
 * Reverses a settlement transfer.
 * Called when a booking is cancelled after settlement was initiated,
 * or when a dispute/refund is raised.
 *
 * Note: Transfers can only be reversed if the settlement is in 'credited' status.
 * If the partner has already withdrawn, reversal may not be possible.
 */
export async function reverseSettlement(transferId, reason) {
  try {
    const transfer = await razorpayClient.transfers.fetch(transferId);

    if (transfer.status === 'reversed' || transfer.status === 'rejected') {
      return { success: true, status: transfer.status, message: 'Transfer already reversed/rejected.' };
    }

    // Create a reversal
    const reversal = await razorpayClient.transfers.createReverseTransfer(transferId, {
      notes: {
        reason: reason || 'Manual reversal',
        originalTransferId: transferId,
      },
    });

    console.log(`[Settlement] Reversal initiated for transfer ${transferId}: ${reason}`);

    return {
      success: true,
      reversalId: reversal.id,
      status: reversal.status,
      amount: reversal.amount,
    };
  } catch (err) {
    if (err.statusCode === 400 && err.error?.code === 'BAD_REQUEST_ERROR') {
      return {
        success: false,
        error: 'Cannot reverse this transfer.',
        message: err.error?.description || 'Transfer may already be settled or rejected.',
      };
    }
    throw err;
  }
}

/**
 * Gets all transfers for a specific payment.
 * Useful for auditing — to see all transfers linked to a payment.
 */
export async function getTransfersForPayment(paymentId) {
  try {
    const transfers = await razorpayClient.transfers.fetchAll({
      source: `pay_${paymentId}`,
    });
    return transfers;
  } catch (err) {
    if (err.statusCode === 400) {
      return [];
    }
    throw err;
  }
}

/**
 * Gets the balance of a Razorpay account.
 * Used for checking platform or partner account balances.
 */
export async function getAccountBalance(accountId) {
  try {
    const balance = await razorpayClient.razorpayx.getAccountBalance(accountId);
    return {
      accountId: balance.estatized_balance ? 'razorpayx' : accountId,
      balance: balance.balance,
      balanceInRupees: balance.balance / 100,
      currency: balance.currency,
      creditedBalance: balance.credited_balance,
      creditedBalanceInRupees: balance.credited_balance / 100,
    };
  } catch (err) {
    throw err;
  }
}