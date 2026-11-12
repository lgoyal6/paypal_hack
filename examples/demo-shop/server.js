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
// Visual language from openmotion.design: violet accent, heavy tight system type,
// soft violet surfaces, pill buttons. Light only, on purpose.
const CSS = `
:root { --ink:#17151d; --muted:#6f6c78; --surface:#fff; --surface-soft:#f7f6fa; --surface-violet:#f2efff;
  --line:#261d3d1c; --purple:#6848e8; --purple-dark:#5232c6; --purple-soft:#ebe6ff; --pink:#ec579d; color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: linear-gradient(180deg, var(--surface-violet), var(--surface) 360px) no-repeat, var(--surface); color: var(--ink);
  font: 16px/1.5 -apple-system, system-ui, "SF Pro Text", "Segoe UI", sans-serif; }
.wrap { max-width: 960px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }
nav { display: flex; align-items: center; justify-content: space-between; padding-block: 18px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); text-decoration: none; }
.brand i { width: 22px; height: 22px; border-radius: 7px; background: linear-gradient(135deg, var(--purple), var(--pink)); }
h1 { font-size: clamp(40px, 7vw, 64px); font-weight: 740; letter-spacing: -0.04em; line-height: 1.02; margin: 56px 0 12px; text-wrap: balance; }
.lede { color: var(--muted); max-width: 52ch; margin: 0 0 40px; }
ul.grid { list-style: none; padding: 0; margin: 0 0 64px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.product { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
.swatch { aspect-ratio: 4 / 3; border-radius: 14px; background: var(--surface-soft); display: grid; place-items: center; }
.swatch span { width: 44%; aspect-ratio: 1; border-radius: 50%; box-shadow: inset 0 -10px 0 #0000001f; }
.product h2 { font-size: 17px; font-weight: 650; letter-spacing: -0.01em; margin: 0; }
.product form { margin-top: auto; }
.price { margin: 0; font-variant-numeric: tabular-nums; color: var(--muted); }
.price a { color: var(--purple); }
button, .pill { appearance: none; border: 0; cursor: pointer; border-radius: 999px; padding: 10px 18px; font-family: inherit;
  font-size: 13px; font-weight: 650; line-height: 1; letter-spacing: -0.01em; background: var(--purple); color: #fff; text-decoration: none; display: inline-block; }
button:hover, .pill:hover { background: var(--purple-dark); }
button:focus-visible, a:focus-visible { outline: 3px solid var(--purple-soft); outline-offset: 2px; }
.ghost { background: var(--purple-soft); color: var(--purple-dark); }
.ghost:hover { background: #ddd5ff; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 24px; padding: 24px; max-width: 520px; margin-bottom: 64px; }
.card ul { list-style: none; padding: 0; margin: 0 0 16px; }
.card li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
#total { display: flex; justify-content: space-between; font-weight: 700; font-size: 20px; letter-spacing: -0.02em; margin: 0 0 20px; }
#captcha { background: var(--surface-soft); border-radius: 16px; padding: 16px; margin-bottom: 20px; color: var(--muted); }
.empty { color: var(--muted); }
@media (prefers-reduced-motion: no-preference) {
  .product { transition: transform .2s ease, box-shadow .2s ease; }
  .product:hover { transform: translateY(-2px); box-shadow: 0 12px 32px #261d3d14; }
}`;
const SWATCH = { blue: '#4f7cf7', red: '#ec579d', black: '#17151d' };
const page = (title, head, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${CSS}</style>${head}</head>
  <body><div class="wrap"><nav><a class="brand" href="/"><i></i>Demo Shop</a><a class="pill ghost" href="/checkout">Cart</a></nav>${body}</div></body></html>`;

app.get('/', (req, res) => {
  const loggedIn = req.query.session === 'demo';
  const items = PRODUCTS.map((p) => {
    const price = BLOCKERS.has('login-price') && !loggedIn ? '<a href="/login">Log in to see price</a>' : `$${p.price}`;
    return `<li class="product" data-sku="${p.sku}"><div class="swatch"><span style="background:${SWATCH[p.color]}"></span></div>
      <h2>${p.name}</h2><p class="price">${price}</p>
      <form method="post" action="/cart"><input type="hidden" name="sku" value="${p.sku}"><button>Add to cart</button></form></li>`;
  }).join('');
  const ld = BLOCKERS.has('no-structured-data') ? '' : `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@graph': PRODUCTS.map((p) => ({
      '@type': 'Product', sku: p.sku, name: p.name, color: p.color,
      offers: { '@type': 'Offer', price: p.price, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    })),
  })}</script>`;
  res.send(page('Demo Shop', ld, `<h1>Things for your desk.</h1>
    <p class="lede">A small store that takes PayPal. Its webhook handler has four bugs planted on purpose for paydrill to find.</p>
    <ul class="grid">${items}</ul>`));
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
  const lines = cart.map((p) => `<li><span>${p.name}</span><span>$${p.price}</span></li>`).join('') || '<li class="empty">Your cart is empty.</li>';
  res.send(page('Checkout', `<script src="https://www.paypal.com/sdk/js?client-id=${process.env.PAYPAL_CLIENT_ID ?? 'sb'}&currency=USD"></script>`,
    `<h1>Checkout</h1><div class="card"><ul>${lines}</ul>
    <p id="total"><span>Total</span><span>$${total}</span></p>${captcha}<div id="paypal-buttons"></div></div>
    <script>paypal.Buttons({
      createOrder: () => fetch('/api/orders', { method: 'POST' }).then(r => r.json()).then(o => o.id),
      onApprove: (d) => fetch('/api/orders/' + d.orderID + '/capture', { method: 'POST' })
        .then(r => r.json()).then(() => { document.querySelector('.card').innerHTML = '<h2 id="thanks">Thank you for your order</h2>'; }),
    }).render('#paypal-buttons');</script>`));
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
