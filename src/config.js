// Razorpay credentials from dashboard
// Get these from https://dashboard.razorpay.com/app/keys
export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'YOUR_RAZORPAY_KEY_ID';
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'YOUR_RAZORPAY_KEY_SECRET';

// Platform commission percentage (10% of booking amount)
// CHANGE THIS VALUE HERE - it will reflect everywhere
export const PLATFORM_COMMISSION_PERCENT = process.env.PLATFORM_COMMISSION_PERCENT ? parseInt(process.env.PLATFORM_COMMISSION_PERCENT) : 10;

// Server config
export const PORT = process.env.PORT || 3000;
export const FRONTEND_URL = process.env.FRONTEND_URL || 'https://groomx-frontend1-v1.vercel.app';

// Webhook secret (set in Razorpay Dashboard → Webhooks)
// This is used to verify webhook authenticity
export const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'YOUR_WEBHOOK_SECRET';

// RazorpayX Account Details for settlements
// Create a RazorpayX Current Account at https://dashboard.razorpay.com/app/razorpayx
// The platform keeps its commission here, and this is where money is transferred FROM
export const PLATFORM_RAZORPAY_ACCOUNT = process.env.PLATFORM_RAZORPAY_ACCOUNT || 'YOUR_PLATFORM_RAZORPAY_ACCOUNT_ID';

// Note: For full split payment model, partner/barber RazorpayX accounts are needed.
// Each partner registers their RazorpayX account number in the GroomX database.
// When a booking completes, the platform transfers (booking_amount - commission) to the partner.
// See src/services/settlementService.js for the settlement logic.
