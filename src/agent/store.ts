// paydrill store: a small local shop an AI shopper (Tijil's agent-readiness test) can try to buy from.
// Checkout is real: the card form posts to this server, which creates and captures a PayPal sandbox order.
// --blocker plants one thing that stops agents, so the readiness test has something to find.
import http from 'node:http';
import { register } from '../registry.js';
import { paypal } from '../paypal/client.js';

type Blocker = 'none' | 'captcha' | 'login-price' | 'no-structured-data';

const PRODUCTS = [
  { sku: 'mug-blue', name: 'Blue ceramic mug', price: '14.00', color: 'blue' },
  { sku: 'mug-sun', name: 'Sunflower mug', price: '18.00', color: 'yellow' },
  { sku: 'mug-big', name: 'Large blue mug', price: '24.00', color: 'blue' },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{--bg:#fff;--fg:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--acc:#1f5fa8}@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#9c9b95;--line:#2c2c2a;--acc:#7fb0ea}}
body{margin:0 auto;max-width:720px;padding:24px 16px;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--fg)}
.p{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:12px 0}.muted{color:var(--muted)}
a,button{color:var(--acc)}button{font:inherit;padding:8px 14px;border:1px solid var(--acc);border-radius:6px;background:transparent;cursor:pointer}
label{display:block;margin:10px 0 4px}input{font:inherit;padding:8px;width:100%;max-width:320px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--fg)}</style></head>
<body><h1>Mug Shop</h1>${body}</body></html>`;
}

function catalog(blocker: Blocker): string {
  const ld = blocker === 'no-structured-data' ? '' : `<script type="application/ld+json">${JSON.stringify(PRODUCTS.map((p) => ({
    '@context': 'https://schema.org', '@type': 'Product', sku: p.sku, name: p.name, color: p.color,
    offers: { '@type': 'Offer', price: p.price, priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: `/buy/${p.sku}` },
  })))}</script>`;
  const rows = PRODUCTS.map((p) => `<div class="p" data-sku="${p.sku}"><div><strong>${esc(p.name)}</strong><div class="muted">${p.color}</div></div>
<div>${blocker === 'login-price' ? '<span class="muted">Sign in to see price</span>' : `<span itemprop="price">$${p.price}</span>`} <a href="/buy/${p.sku}">Buy</a></div></div>`).join('');
  return shell('Mug Shop', ld + rows);
}

function checkout(sku: string, blocker: Blocker): string {
  const p = PRODUCTS.find((x) => x.sku === sku);
  if (!p) return shell('Not found', '<p>No such product.</p>');
  const captcha = blocker === 'captcha'
    ? '<label for="captcha">Type the characters in the image</label><img alt="distorted characters" width="120" height="40" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><input id="captcha" name="captcha" required>'
    : '';
  return shell(`Checkout: ${p.name}`, `<p>${esc(p.name)}: <strong>$${p.price}</strong></p>
<form method="post" action="/pay/${p.sku}">
<label for="name">Name on card</label><input id="name" name="name" autocomplete="cc-name" required>
<label for="number">Card number</label><input id="number" name="number" autocomplete="cc-number" inputmode="numeric" required>
<label for="expiry">Expiry (YYYY-MM)</label><input id="expiry" name="expiry" autocomplete="cc-exp" placeholder="2030-12" required>
<label for="cvv">CVV</label><input id="cvv" name="cvv" autocomplete="cc-csc" inputmode="numeric" required>
${captcha}<p><button type="submit">Pay $${p.price}</button></p></form>`);
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  let raw = '';
  for await (const c of req) raw += c;
  return new URLSearchParams(raw);
}

export function storeServer(blocker: Blocker, log: (l: string) => void = () => {}): http.Server {
  return http.createServer(async (req, res) => {
    const send = (code: number, html: string) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };
    if (req.method === 'GET' && req.url === '/') return send(200, catalog(blocker));
    if (req.method === 'GET' && req.url === '/products.json') {
      if (blocker === 'no-structured-data') return send(404, shell('Not found', ''));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(PRODUCTS));
    }
    const buy = req.url?.match(/^\/buy\/([\w-]+)$/);
    if (req.method === 'GET' && buy) return send(200, checkout(buy[1], blocker));
    const pay = req.url?.match(/^\/pay\/([\w-]+)$/);
    if (req.method === 'POST' && pay) {
      const p = PRODUCTS.find((x) => x.sku === pay[1]);
      if (!p) return send(404, shell('Not found', ''));
      const f = await readForm(req);
      if (blocker === 'captcha') return send(403, shell('Blocked', '<p>CAPTCHA failed. A human must complete checkout.</p>'));
      try {
        // Sandbox only: the card goes straight to PayPal's sandbox Orders API, never stored.
        const r = await paypal.cardPayment({ currency_code: 'USD', value: p.price }, `Mug Shop: ${p.name}`, {
          number: String(f.get('number') ?? '').replace(/\s/g, ''), expiry: String(f.get('expiry') ?? ''),
          security_code: String(f.get('cvv') ?? ''), name: String(f.get('name') ?? ''),
        });
        log(`sold ${p.sku} for $${p.price}: capture ${r.captureId}`);
        return send(200, shell('Order confirmed', `<h2>Order confirmed</h2><p data-capture="${r.captureId}">Paid $${p.price} for ${esc(p.name)}. PayPal capture <code>${r.captureId}</code>.</p><p><a href="/">Back to shop</a></p>`));
      } catch (e) {
        return send(402, shell('Payment failed', `<p>Payment failed: ${esc((e as Error).message)}</p>`));
      }
    }
    send(404, shell('Not found', '<p>Not found.</p>'));
  });
}

register('store', {
  describe: 'Local sandbox shop for agent-readiness tests: paydrill store [--port 4321] [--blocker captcha|login-price|no-structured-data]',
  async run(args) {
    const i = args.indexOf('--port');
    const port = i >= 0 ? Number(args[i + 1]) : 4321;
    const b = args.indexOf('--blocker');
    const blocker = (b >= 0 ? args[b + 1] : 'none') as Blocker;
    if (!['none', 'captcha', 'login-price', 'no-structured-data'].includes(blocker)) throw new Error(`unknown blocker "${blocker}"`);
    const server = storeServer(blocker, (l) => console.log(l));
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    console.log(`Mug Shop on http://127.0.0.1:${port} (blocker: ${blocker}). Sandbox payments only.`);
    await new Promise(() => {});
  },
});
