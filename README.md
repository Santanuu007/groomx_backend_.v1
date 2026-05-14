# GroomX Razorpay Backend

Node.js/Express backend for Razorpay payments with **Platform Hold Model**.

## Platform Hold Model

```
Customer pays ₹200
    ↓
Money → GroomX Platform Account
    ↓
Service completes
    ↓
₹40 (20%) → GroomX keeps as commission
₹160 → Barber/Partner's account
```

## Quick Start

### 1. Install dependencies

```bash
cd razorpay-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Razorpay credentials
```

### 3. Start the server

```bash
npm run dev
# Server runs on http://localhost:3000
```

### 4. Set webhook in Razorpay Dashboard

1. Go to **Dashboard → Settings → Webhooks**
2. Add webhook: `https://your-backend-url.com/api/webhooks/razorpay`
3. Enable events: `payment.captured`, `payment.failed`, `transfer.created`, `transfer.credited`, `transfer.reversed`, `refund.created`

## API Endpoints

### Payments

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/payments/create-order` | POST | Create a Razorpay order (holds payment in platform account) |
| `/api/payments/verify` | POST | Verify payment signature after checkout |
| `/api/payments/capture` | POST | Capture an authorized payment (for delayed capture) |
| `/api/payments/:orderId` | GET | Get order details |
| `/api/payments/payment/:paymentId` | GET | Get payment details |

### Settlements

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settlements/initiate` | POST | Transfer money to barber after service completion |
| `/api/settlements/transfer/:transferId` | GET | Check settlement status |
| `/api/settlements/reverse` | POST | Reverse a settlement (refund/dispute) |
| `/api/settlements/payment/:paymentId/transfers` | GET | Get all transfers for a payment |

### Accounts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/accounts/register` | POST | Register partner's Razorpay account for settlements |
| `/api/accounts/balance/:accountId` | GET | Check account balance |
| `/api/accounts/create-onboarding-link` | POST | Create RazorpayX onboarding link for partner |
| `/api/accounts/:accountId/status` | GET | Get KYC and account status |

### Webhooks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/webhooks/razorpay` | POST | Receive Razorpay events (payment.captured, etc.) |

## Full Payment → Settlement Flow

```
1. Customer selects services and proceeds to book
   → Frontend calls POST /api/payments/create-order
   → Backend creates Razorpay order with ₹200 amount
   → Returns orderId to frontend

2. Frontend opens Razorpay checkout with orderId
   → Customer completes payment (UPI/Card)

3. Payment captured automatically
   → ₹200 received in GroomX platform account
   → Razorpay sends 'payment.captured' webhook

4. Partner marks booking as "completed" in dashboard
   → Frontend calls POST /api/settlements/initiate
   → Backend creates transfer: ₹160 → barber's account

5. Settlement completes
   → Barber receives ₹160 in their account
   → GroomX keeps ₹40 commission
```

## Example Requests

### Create Order

```bash
curl -X POST http://localhost:3000/api/payments/create-order \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 200,
    "bookingId": "bk_abc123",
    "shopId": "shop_xyz",
    "userId": "user_123",
    "shopName": "StyleHub Salon",
    "services": ["Haircut", "Shave"],
    "customerPhone": "9876543210"
  }'
```

### Initiate Settlement

```bash
curl -X POST http://localhost:3000/api/settlements/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "bookingId": "bk_abc123",
    "paymentId": "pay_xxxxxxxxxxxx",
    "orderId": "order_xxxxxxxxxxxx",
    "amount": 200,
    "partnerRazorpayAccountId": "pl_xxxxxxxxxxxxxxxx",
    "partnerId": "user_456",
    "shopName": "StyleHub Salon"
  }'
```

### Verify Payment

```bash
curl -X POST http://localhost:3000/api/payments/verify \
  -H "Content-Type: application/json" \
  -d '{
    "razorpay_order_id": "order_xxx",
    "razorpay_payment_id": "pay_xxx",
    "razorpay_signature": "xxxxxxxx"
  }'
```

## Environment Variables

See `.env.example` for all required variables.

## Razorpay Setup Guide

See `RAZORPAY_SETUP_GUIDE.md` for step-by-step instructions on configuring your Razorpay dashboard.

## Deployment

```bash
# Deploy to any Node.js hosting (Railway, Render, Fly.io, etc.)
npm install --production
npm start
```

Set all environment variables in your hosting provider's dashboard.