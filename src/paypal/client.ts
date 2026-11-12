import { randomUUID } from 'node:crypto';
import type {
  EvidencePacket, Money, Payment, PayPalClient, PayPalEvent, SignatureStatus,
} from '../contract.js';
import { requireEnv } from '../env.js';

const API = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

export class PayPalError extends Error {
  constructor(message: string, public status: number, public data: unknown, public debugId?: string) {
    super(message);
    this.name = 'PayPalError';
  }
}

let cached: { token: string; exp: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = requireEnv('PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET');
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !body.access_token) throw new PayPalError(`PayPal login failed (${res.status})`, res.status, body);
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 0) * 1000 };
  return cached.token;
}

export async function call<T = any>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      Prefer: 'return=representation',
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  };
  if (body !== undefined) init.body = body instanceof FormData ? body : JSON.stringify(body);
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = data?.details?.[0]?.issue || data?.name || data?.message || text.slice(0, 200);
    throw new PayPalError(`${method} ${path} failed (${res.status}): ${detail}`, res.status, data, data?.debug_id);
  }
  return data as T;
}

const TEST_CARD = {
  number: '4012000033330026',
  expiry: '2030-12',
  security_code: '123',
  name: 'Drill Tester',
  billing_address: {
    address_line_1: '1 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA',
    postal_code: '95131', country_code: 'US',
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const paypal: PayPalClient = {
  async cardPayment(amount: Money, description = 'paydrill test order'): Promise<Payment> {
    let order = await call('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ amount, description }],
      payment_source: { card: TEST_CARD },
    }, { 'PayPal-Request-Id': randomUUID() });
    if (order.status !== 'COMPLETED') {
      order = await call('POST', `/v2/checkout/orders/${order.id}/capture`, {}, { 'PayPal-Request-Id': randomUUID() });
    }
    const unit = order.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    if (!capture) throw new PayPalError(`Order ${order.id} has no capture (status ${order.status})`, 0, order);
    if (capture.status !== 'COMPLETED') {
      throw new PayPalError(`Capture ${capture.id} is ${capture.status}, not COMPLETED`, 0, order);
    }
    return { orderId: order.id, captureId: capture.id, merchantId: unit.payee?.merchant_id, amount };
  },

  async refund(captureId, amount) {
    const r = await call('POST', `/v2/payments/captures/${captureId}/refund`, amount ? { amount } : {}, {
      'PayPal-Request-Id': randomUUID(),
    });
    return { refundId: r.id, status: r.status };
  },

  async chargeback(payment, reasonCode = '1330') {
    const now = new Date();
    const due = new Date(now.getTime() + 10 * 864e5);
    // Body shape from developer.paypal.com/disputes/test-go-live (sandbox-only endpoint).
    const r = await call('POST', '/v2/customer-support/process-chargeback', {
      adjacency: 'PAYPAL',
      file_layout: 'ATCK_CB',
      merchant_id: payment.merchantId,
      financial_institution: { processor: 'FDMS' },
      transaction: { id_enc: payment.captureId, amount: payment.amount },
      instrument: {
        instrument_type: 'CARD',
        card_brand: 'VISA',
        credit_card_transaction_id: String(Date.now()),
        external: false,
      },
      dispute: {
        id: null,
        stage: 'CHARGEBACK',
        response_date: due.toISOString(),
        status: '2',
        amount: payment.amount,
        receive_date: now.toISOString(),
        event_code: 'CHARGEBACK_INITIATED',
        money_movement_date: now.toISOString(),
        event_type: 'DEBIT',
        chargeback_type: 'REPORTED_TO_PROCESSOR',
        processor_info: { reference_number: String(Date.now()), reason_code: reasonCode, notes: 'paydrill' },
      },
    });
    const direct = r?.dispute_id ?? r?.id ?? r?.dispute?.id;
    if (typeof direct === 'string' && direct) return { disputeId: direct };
    for (let i = 0; i < 12; i++) {
      const d = await call('GET', `/v1/customer/disputes?disputed_transaction_id=${payment.captureId}`);
      if (d.items?.length) return { disputeId: d.items[0].dispute_id as string };
      await sleep(5_000);
    }
    return { disputeId: null };
  },

  getDispute: (id) => call('GET', `/v1/customer/disputes/${id}`),

  async requireEvidence(id) {
    await call('POST', `/v1/customer/disputes/${id}/require-evidence`, { action: 'SELLER_EVIDENCE' });
  },

  async submitEvidence(id, evidence: EvidencePacket) {
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify({
      evidences: [{ evidence_type: 'OTHER', notes: evidence.notes }],
    })], { type: 'application/json' }));
    for (const doc of evidence.documents) {
      form.append('file1', new Blob([Buffer.from(doc.base64, 'base64')], { type: doc.contentType }), doc.name);
    }
    await call('POST', `/v1/customer/disputes/${id}/provide-evidence`, form);
  },

  async adjudicate(id, outcome) {
    await call('POST', `/v1/customer/disputes/${id}/adjudicate`, { adjudication_outcome: outcome });
  },

  async listEvents(since): Promise<PayPalEvent[]> {
    const q = new URLSearchParams({ page_size: '50', start_time: since });
    const d = await call('GET', `/v1/notifications/webhooks-events?${q}`);
    return d.events ?? [];
  },

  async resendEvent(eventId, webhookIds) {
    await call('POST', `/v1/notifications/webhooks-events/${eventId}/resend`, webhookIds ? { webhook_ids: webhookIds } : {});
  },

  async createWebhook(url) {
    const w = await call('POST', '/v1/notifications/webhooks', { url, event_types: [{ name: '*' }] });
    return { webhookId: w.id };
  },

  async deleteWebhook(webhookId) {
    await call('DELETE', `/v1/notifications/webhooks/${webhookId}`);
  },

  async verifySignature(headers, webhookId, event): Promise<SignatureStatus> {
    const h = (k: string) => headers[k] ?? headers[k.toLowerCase()];
    if (!h('paypal-transmission-sig')) return 'unsigned';
    try {
      const d = await call('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: webhookId,
        webhook_event: event,
      });
      return d.verification_status === 'SUCCESS' ? 'verified' : 'invalid';
    } catch {
      return 'error';
    }
  },
};
