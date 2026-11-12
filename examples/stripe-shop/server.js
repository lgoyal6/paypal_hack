// A small Stripe store: the target for `paydrill migrate`.
// Written for this repo (not copied from a Stripe sample) so there is no license question.
// It uses one-time payments, refunds, webhooks and idempotency (all migratable),
// metadata and a saved customer (partial), and Stripe Tax (not supported by PayPal).
//
// Env: STRIPE_SECRET_KEY (test mode), STRIPE_WEBHOOK_SECRET, PORT (default 4343).
import express from 'express';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PORT = Number(process.env.PORT ?? 4343);

const PRODUCTS = { 'mug-blue': { name: 'Blue ceramic mug', cents: 1400 }, 'tee-black': { name: 'Black t-shirt', cents: 2500 } };

// ---------- business functions (spied on by the parity drill) ----------
const effects = [];
const processed = new Set();
const record = (fn, ...args) => effects.push({ fn, args, at: new Date().toISOString() });
const fulfillOrder = (orderId, amount) => record('fulfillOrder', orderId, amount);
const markRefunded = (orderId, amount) => record('markRefunded', orderId, amount);
const flagDispute = (orderId, amount, reason) => record('flagDispute', orderId, amount, reason);

const app = express();

app.post('/api/checkout', express.json(), async (req, res) => {
  const product = PRODUCTS[req.body.sku];
  const orderId = `order_${Date.now()}`;
  const customer = await stripe.customers.create({ email: req.body.email });
  const tax = await stripe.tax.calculations.create({
    currency: 'usd',
    line_items: [{ amount: product.cents, reference: req.body.sku }],
    customer_details: { address: req.body.address, address_source: 'shipping' },
  });
  const intent = await stripe.paymentIntents.create(
    {
      amount: product.cents + tax.tax_amount_exclusive,
      currency: 'usd',
      customer: customer.id,
      metadata: { order_id: orderId },
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: orderId },
  );
  res.json({ clientSecret: intent.client_secret, orderId });
});

app.post('/api/refund', express.json(), async (req, res) => {
  const refund = await stripe.refunds.create({ payment_intent: req.body.paymentIntentId, amount: req.body.cents });
  res.json({ id: refund.id, status: refund.status });
});

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.sendStatus(400);
  }
  if (processed.has(event.id)) return res.sendStatus(200);
  processed.add(event.id);

  const obj = event.data.object;
  switch (event.type) {
    case 'payment_intent.succeeded':
      fulfillOrder(obj.metadata.order_id, (obj.amount / 100).toFixed(2));
      break;
    case 'charge.refunded':
      markRefunded(obj.metadata.order_id, (obj.amount_refunded / 100).toFixed(2));
      break;
    case 'charge.dispute.created':
      flagDispute(obj.metadata.order_id, (obj.amount / 100).toFixed(2), obj.reason);
      break;
    default:
      break;
  }
  res.sendStatus(200);
});

app.get('/_effects', (_req, res) => res.json(effects));
app.delete('/_effects', (_req, res) => { effects.length = 0; res.sendStatus(204); });

app.listen(PORT, () => console.log(`stripe shop on http://localhost:${PORT}`));
