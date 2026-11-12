// Added by `paydrill migrate`. The PayPal calls the migrated code uses.
// Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_API (default sandbox).
const API = process.env.PAYPAL_API ?? 'https://api-m.sandbox.paypal.com';

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'HUF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'TWD', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** Stripe-style integer minor units (1200, "usd") -> PayPal money ({ currency_code: "USD", value: "12.00" }). */
export function toPayPalAmount(minor, currency) {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error(`amount must be a non-negative integer, got ${minor}`);
  const c = currency.toUpperCase();
  const d = ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
  const s = String(minor).padStart(d + 1, '0');
  return { currency_code: c, value: d ? `${s.slice(0, -d)}.${s.slice(-d)}` : s };
}

let cached = { token: '', expires: 0 };
async function token() {
  if (Date.now() < cached.expires) return cached.token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${API}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}` }, body: new URLSearchParams({ grant_type: 'client_credentials' }) });
  const data = await res.json();
  if (!res.ok) throw new PayPalError(res.status, data);
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

export class PayPalError extends Error {
  constructor(status, data) { super(`PayPal ${status}: ${data?.message ?? data?.error_description ?? 'request failed'} (debug_id ${data?.debug_id ?? 'none'})`); this.status = status; this.data = data; }
}

async function call(method, path, body, requestId) {
  const headers = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  if (requestId) headers['PayPal-Request-Id'] = requestId; // PayPal's idempotency key
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = res.status === 204 ? {} : await res.json();
  if (!res.ok) throw new PayPalError(res.status, data);
  return data;
}

export const paypal = {
  orders: {
    /** amount: PayPal money object. customId: up to 127 chars (Stripe metadata goes here). */
    create: ({ amount, customId, invoiceId, requestId }) =>
      call('POST', '/v2/checkout/orders', { intent: 'CAPTURE', purchase_units: [{ amount, custom_id: customId, invoice_id: invoiceId }] }, requestId),
    capture: (orderId, requestId) => call('POST', `/v2/checkout/orders/${orderId}/capture`, undefined, requestId),
    get: (orderId) => call('GET', `/v2/checkout/orders/${orderId}`),
  },
  refunds: {
    /** Omit amount for a full refund. */
    create: ({ captureId, amount, requestId }) => call('POST', `/v2/payments/captures/${captureId}/refund`, amount ? { amount } : {}, requestId),
  },
  webhooks: {
    /** Verify with PayPal and return the event; throws if the signature is not valid. */
    async verify(headers, rawBody) {
      const h = (k) => headers[k] ?? headers[k.toLowerCase()];
      const event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));
      const out = await call('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
        webhook_id: process.env.PAYPAL_WEBHOOK_ID, webhook_event: event,
      });
      if (out.verification_status !== 'SUCCESS') throw new Error('PayPal webhook signature verification failed');
      return event;
    },
  },
};
