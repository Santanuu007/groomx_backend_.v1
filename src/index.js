import 'dotenv/config';
import express from 'express';
import { PORT, FRONTEND_URL } from './config.js';
import paymentRoutes from './routes/paymentRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import settlementRoutes from './routes/settlementRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import {razorpayClient} from './services/razorpayClient.js';

const app = express();

// ─── Raw body parser for webhook signature verification ──────────────────────
// Must be BEFORE express.json()
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

// JSON parser for all other routes
app.use(express.json());

// ─── CORS ────────────────────────────────────────────────────────────────────
// app.use((req, res, next) => {
//   res.header('Access-Control-Allow-Origin', FRONTEND_URL);
//   res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Razorpay-Account, Idempotency-Key');
//   if (req.method === 'OPTIONS') return res.sendStatus(200);
//   next();
// });
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Razorpay-Account, Idempotency-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/payments', paymentRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/settlements', settlementRoutes);
app.use('/api/accounts', accountRoutes);

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(err.code && { code: err.code }),
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`\n🏦 GroomX Razorpay Backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Key ID: ${process.env.RAZORPAY_KEY_ID ? '✓ Configured' : '✗ NOT SET (check .env)'}`);
  console.log(`   Platform Account: ${process.env.PLATFORM_RAZORPAY_ACCOUNT ? '✓ Configured' : '✗ NOT SET (check .env)'}`);
  console.log(`\n📋 Endpoints:`);
  console.log(`   POST /api/payments/create-order`);
  console.log(`   POST /api/payments/capture`);
  console.log(`   POST /api/payments/verify`);
  console.log(`   POST /api/webhooks/razorpay`);
  console.log(`   POST /api/settlements/initiate`);
  console.log(`   GET  /api/settlements/:bookingId`);
  console.log(`   POST /api/accounts/register`);
  console.log(`   GET  /api/accounts/balance/:accountId`);
  console.log('');
});