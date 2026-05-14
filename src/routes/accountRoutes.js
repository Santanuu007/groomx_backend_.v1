import express from 'express';
import { razorpayClient } from '../services/razorpayClient.js';
import { getAccountBalance } from '../services/settlementService.js';

const router = express.Router();

/**
 * POST /api/accounts/register
 *
 * Registers a partner's Razorpay account for settlements.
 * The partner provides their Razorpay account ID (for RazorpayX accounts)
 * or linked Razorpay account details.
 *
 * In production, this would:
 * 1. Validate the Razorpay account exists and is active
 * 2. Store the account ID in Supabase partners table
 * 3. Optionally initiate KYC verification if not complete
 *
 * For RazorpayX (full split model):
 * - Partner creates a RazorpayX Current Account
 * - They share their RazorpayX account ID (starts with 'pl...')
 * - This account receives settlements from the platform
 *
 * For standard Razorpay accounts:
 * - Partner links their bank account to Razorpay
 * - Settlements can be pushed to their linked bank account
 */
router.post('/register', async (req, res, next) => {
  try {
    const {
      partnerId,       // GroomX partner ID (from auth.users)
      razorpayAccountId, // Partner's RazorpayX account ID (starts with 'pl...')
      shopName,
      contactEmail,
      contactPhone,
    } = req.body;

    if (!partnerId) {
      return res.status(400).json({ error: 'partnerId is required.' });
    }
    if (!razorpayAccountId) {
      return res.status(400).json({
        error: 'razorpayAccountId is required.',
        hint: 'Partner must create a RazorpayX account and provide the account ID (starts with "pl...").',
      });
    }

    // ─── Validate account exists ───────────────────────────────────────────
    try {
      // Try to get balance to validate account is active
      // Note: This requires the platform to have access to the partner's account
      // For full RazorpayX, you can use razorpayClient.razorpayx methods
      const balance = await razorpayClient.razorpayx.getAccountBalance(razorpayAccountId);

      res.json({
        success: true,
        message: 'Razorpay account linked successfully.',
        accountId: razorpayAccountId,
        accountType: razorpayAccountId.startsWith('pl') ? 'razorpayx' : 'standard',
        balance: balance.balance / 100,
        currency: balance.currency,
        kycStatus: balance.kyc_status || 'pending',
        shopName,
      });
    } catch (err) {
      if (err.statusCode === 400 || err.statusCode === 401) {
        return res.status(400).json({
          error: 'Invalid Razorpay account ID or account not accessible.',
          message: err.error?.description || 'Please check the account ID and ensure KYC is complete.',
          hint: 'Partner must: 1) Have a RazorpayX account, 2) Share the account ID, 3) Complete KYC',
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/accounts/balance/:accountId
 *
 * Gets the balance of a Razorpay account.
 * Used to check platform or partner account balance.
 */
router.get('/balance/:accountId', async (req, res, next) => {
  try {
    const { accountId } = req.params;

    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required.' });
    }

    const balance = await getAccountBalance(accountId);
    res.json(balance);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/accounts/create-onboarding-link
 *
 * Creates a RazorpayX onboarding link for a partner.
 * This generates a link that the partner can use to create their
 * RazorpayX account and complete KYC.
 *
 * The partner clicks the link → fills details → gets RazorpayX account
 * → shares account ID → stored in GroomX database
 */
router.post('/create-onboarding-link', async (req, res, next) => {
  try {
    const {
      partnerId,
      partnerEmail,
      partnerPhone,
      partnerName,
      shopName,
      returnUrl, // URL to redirect after onboarding
    } = req.body;

    if (!partnerEmail) {
      return res.status(400).json({ error: 'partnerEmail is required.' });
    }

    // Create a partner onboarding link
    // Note: This uses Razorpay's Account API feature
    // You need to be a platform/reseller to use this

    try {
      const account = await razorpayClient.accounts.create({
        email: partnerEmail,
        phone: partnerPhone || '9999999999',
        legal_business_name: shopName || partnerName || 'Business',
        business_type: 'partnership',
        contact_name: partnerName,
        return_url: returnUrl || `${process.env.FRONTEND_URL}/partner/settings`,
        // ... additional params
      });

      res.json({
        success: true,
        accountId: account.id,
        onboardingUrl: account.onboarding_url,
        email: account.email,
      });
    } catch (err) {
      // Razorpay Account API requires special platform access
      // If not available, provide manual instructions instead
      res.status(501).json({
        success: false,
        message: 'Automated onboarding requires Razorpay Platform/Reseller access.',
        hint: 'Partners should manually create a RazorpayX account at https://dashboard.razorpay.com/app/razorpayx',
        manualSteps: [
          '1. Go to https://dashboard.razorpay.com/app/razorpayx',
          '2. Create a Current Account',
          '3. Complete KYC verification',
          '4. Share the Account ID (starts with "pl...") with GroomX',
          '5. Store it in Partner Settings',
        ],
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/accounts/:accountId/status
 *
 * Gets the KYC and account status of a partner's Razorpay account.
 */
router.get('/:accountId/status', async (req, res, next) => {
  try {
    const { accountId } = req.params;

    try {
      const account = await razorpayClient.razorpayx.getAccountBalance(accountId);
      res.json({
        accountId,
        balance: account.balance / 100,
        creditedBalance: account.credited_balance / 100,
        currency: account.currency,
        kycStatus: account.kyc_status,
        accountStatus: account.status,
      });
    } catch (err) {
      if (err.statusCode === 400) {
        return res.status(404).json({
          error: 'Account not found or not accessible.',
          message: err.error?.description,
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

export default router;