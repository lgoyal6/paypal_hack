// Demo shop for paydrill. A small store that takes PayPal payments.
//
// It has FOUR PLANTED BUGS in the webhook handler, on purpose, so the drill has
// something real to find. Say so in the demo video.
//   1. No signature check: a forged PAYMENT.CAPTURE.COMPLETED marks an order paid.
//   2. Disputes read resource.amount (PayPal sends dispute_amount): crash, 500.
//   3. Unknown event types throw: 500, so PayPal keeps retrying.
//   4. No idempotency: a redelivered capture ships the order twice.
//
// Business effects (fulfillOrder, markRefunded, ...) are recorded in `effects`
// and exposed at GET /_effects, so drills and the migrate parity run can compare
// what the shop actually did, not just the HTTP status.
//
// Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (sandbox), PORT (default 4242),
// SHOP_BLOCKERS=captcha,login-price,no-structured-data (agent-readiness demo).
import express from 'express';

const PORT = Number(process.env.PORT ?? 4242);
const API = 'https://api-m.sandbox.paypal.com';
const BLOCKERS = new Set((process.env.SHOP_BLOCKERS ?? '').split(',').filter(Boolean));

const PRODUCTS = [
  { sku: 'mug-blue', name: 'Blue ceramic mug', price: '14.00', color: 'blue' },
  { sku: 'mug-red', name: 'Red ceramic mug', price: '12.00', color: 'red' },
  { sku: 'mug-xl-blue', name: 'Large blue mug', price: '22.00', color: 'blue' },
  { sku: 'tee-black', name: 'Black t-shirt', price: '25.00', color: 'black' },
];

// ---------- business functions (spied on by drills and migrate parity) ----------
const effects = [];
const orders = new Map(); // custom_id -> { status, amount }

function record(fn, ...args) {
  effects.push({ fn, args, at: new Date().toISOString() });
}
function fulfillOrder(orderId, amount) {
  record('fulfillOrder', orderId, amount);
  orders.set(orderId, { status: 'paid', amount });
}
function markRefunded(orderId, amount) {
  record('markRefunded', orderId, amount);
  const o = orders.get(orderId);
  if (o) o.status = 'refunded';
}
function flagDispute(orderId, amount, reason) {
  record('flagDispute', orderId, amount, reason);
}

// ---------- PayPal REST (the shop's own integration) ----------
async function token() {
  const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox)');
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  return (await res.json()).access_token;
}
async function paypal(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal ${path} failed: ${res.status} ${data.debug_id ?? ''}`);
  return data;
}

const app = express();
app.use(express.json());

// ---------- storefront ----------
app.get('/', (req, res) => {
  const loggedIn = req.query.session === 'demo';
  const items = PRODUCTS.map((p) => {
    const price = BLOCKERS.has('login-price') && !loggedIn ? '<a href="/login">Log in to see price</a>' : `$${p.price}`;
    return `<li class="product" data-sku="${p.sku}"><h2>${p.name}</h2><p class="price">${price}</p>
      <form method="post" action="/cart"><input type="hidden" name="sku" value="${p.sku}"><button>Add to cart</button></form></li>`;
  }).join('');
  const ld = BLOCKERS.has('no-structured-data') ? '' : `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@graph': PRODUCTS.map((p) => ({
      '@type': 'Product', sku: p.sku, name: p.name, color: p.color,
      offers: { '@type': 'Offer', price: p.price, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    })),
  })}</script>`;
  res.send(`<!doctype html><html><head><title>Demo Shop</title>${ld}</head><body>
    <h1>Demo Shop</h1><ul>${items}</ul><a href="/checkout">Checkout</a></body></html>`);
});

app.use(express.urlencoded({ extended: false }));
let cart = [];
app.post('/cart', (req, res) => {
  const p = PRODUCTS.find((x) => x.sku === req.body.sku);
  if (p) cart.push(p);
  res.redirect('/checkout');
});

app.get('/checkout', (_req, res) => {
  const total = cart.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
  const captcha = BLOCKERS.has('captcha')
    ? '<div id="captcha"><p>Prove you are human: select all images with traffic lights.</p><img alt="captcha grid" src="data:,"></div>' : '';
  res.send(`<!doctype html><html><head><title>Checkout</title>
    <script src="https://www.paypal.com/sdk/js?client-id=${process.env.PAYPAL_CLIENT_ID ?? 'sb'}&currency=USD"></script></head><body>
    <h1>Checkout</h1><ul>${cart.map((p) => `<li>${p.name} $${p.price}</li>`).join('')}</ul>
    <p id="total">Total: $${total}</p>${captcha}<div id="paypal-buttons"></div>
    <script>paypal.Buttons({
      createOrder: () => fetch('/api/orders', { method: 'POST' }).then(r => r.json()).then(o => o.id),
      onApprove: (d) => fetch('/api/orders/' + d.orderID + '/capture', { method: 'POST' })
        .then(r => r.json()).then(() => { document.body.innerHTML = '<h1 id="thanks">Thank you for your order</h1>'; }),
    }).render('#paypal-buttons');</script></body></html>`);
});

let nextOrder = 1042;
app.post('/api/orders', async (_req, res) => {
  const total = cart.reduce((s, p) => s + Number(p.price), 0).toFixed(2);
  const customId = `order_${nextOrder++}`;
  orders.set(customId, { status: 'created', amount: total });
  const order = await paypal('/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{ custom_id: customId, amount: { currency_code: 'USD', value: total } }],
  });
  res.json(order);
});
app.post('/api/orders/:id/capture', async (req, res) => {
  res.json(await paypal(`/v2/checkout/orders/${req.params.id}/capture`));
  cart = [];
});

// ---------- webhook handler (the code paydrill drills) ----------
app.post('/webhooks/paypal', (req, res) => {
  const event = req.body;
  // BUG 1: no signature verification. Anyone can POST a fake "payment completed".

  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const r = event.resource;
      // BUG 4: no idempotency. A redelivered event (same event.id) ships twice.
      fulfillOrder(r.custom_id, r.amount.value);
      break;
    }
    case 'PAYMENT.CAPTURE.REFUNDED': {
      const r = event.resource;
      markRefunded(r.custom_id, r.amount.value);
      break;
    }
    case 'CUSTOMER.DISPUTE.CREATED': {
      const r = event.resource;
      // BUG 2: disputes carry dispute_amount, not amount. This throws.
      flagDispute(r.disputed_transactions[0].custom, r.amount.value, r.reason);
      break;
    }
    default:
      // BUG 3: unknown event types should be acknowledged with 2xx.
      throw new Error(`Unhandled event type ${event.event_type}`);
  }
  res.sendStatus(200);
});

// Dev-only spy endpoint for drills and migrate parity.
app.get('/_effects', (_req, res) => res.json(effects));
app.delete('/_effects', (_req, res) => { effects.length = 0; res.sendStatus(204); });

app.listen(PORT, () => console.log(`demo shop on http://localhost:${PORT}`));
