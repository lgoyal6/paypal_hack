// Real sandbox money movement that makes PayPal emit real webhook events.
import { paypal, call } from '../paypal/client.js';
import { register } from '../registry.js';
import type { Money, Payment } from '../contract.js';

export interface Scenario {
  describe: string;
  expects: string[];
  run(log: (line: string) => void, opts?: { waitMs?: number }): Promise<Record<string, unknown>>;
}

const usd = (value: string): Money => ({ currency_code: 'USD', value });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pay(log: (l: string) => void, value: string): Promise<Payment> {
  const p = await paypal.cardPayment(usd(value));
  log(`captured ${p.captureId} ($${value}, order ${p.orderId})`);
  return p;
}

export const SCENARIOS: Record<string, Scenario> = {
  payment: {
    describe: 'Card payment captured',
    expects: ['PAYMENT.CAPTURE.COMPLETED'],
    async run(log) {
      return { ...(await pay(log, '12.00')) };
    },
  },

  refund: {
    describe: 'Payment captured, then fully refunded',
    expects: ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED'],
    async run(log) {
      const p = await pay(log, '15.00');
      const r = await paypal.refund(p.captureId);
      log(`refunded ${r.refundId} (${r.status})`);
      return { ...p, refundId: r.refundId };
    },
  },

  'partial-refund': {
    describe: 'Payment captured, then partially refunded',
    expects: ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED'],
    async run(log) {
      const p = await pay(log, '20.00');
      const r = await paypal.refund(p.captureId, usd('5.00'));
      log(`refunded $5.00 of $20.00: ${r.refundId} (${r.status})`);
      return { ...p, refundId: r.refundId };
    },
  },

  dispute: {
    // Observed in sandbox (2026-11-12): a chargeback emits CUSTOMER.DISPUTE.UPDATED about 4 minutes later
    // (status WAITING_FOR_SELLER_RESPONSE), not CUSTOMER.DISPUTE.CREATED. The capture's own
    // PAYMENT.CAPTURE.COMPLETED was not recorded by PayPal in that run, so it is not expected here.
    describe: "Payment captured, then the buyer's bank files a chargeback",
    expects: ['CUSTOMER.DISPUTE.UPDATED'],
    async run(log) {
      const p = await pay(log, '12.00');
      const { disputeId } = await paypal.chargeback(p);
      if (!disputeId) throw new Error('chargeback accepted, but PayPal listed no dispute within 60s');
      log(`dispute ${disputeId} opened`);
      return { ...p, disputeId };
    },
  },

  'dispute-lost': {
    // Seller accepts the claim (buyer wins). Observed in sandbox: accept-claim moves a chargeback to
    // UNDER_REVIEW, and CUSTOMER.DISPUTE.RESOLVED did not arrive within 3 minutes. adjudicate is used
    // if PayPal offers it. If neither resolves the dispute in time, this fails loudly instead of pretending.
    describe: 'Chargeback opened, seller accepts the claim, PayPal resolves for the buyer',
    expects: ['CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED'],
    async run(log, opts) {
      const out = await SCENARIOS.dispute.run(log);
      const id = out.disputeId as string;
      const deadline = Date.now() + (opts?.waitMs ?? 600_000);
      let accepted = false;
      let d: Record<string, unknown> = {};
      while (Date.now() < deadline) {
        d = await paypal.getDispute(id);
        const rels = ((d.links as { rel: string }[]) ?? []).map((l) => l.rel);
        if (d.status === 'RESOLVED') { log(`dispute ${id} resolved`); return { ...out, resolved: true }; }
        if (rels.includes('adjudicate')) {
          await paypal.adjudicate(id, 'BUYER_FAVOR');
          log(`adjudicated ${id}: BUYER_FAVOR`);
        } else if (!accepted && rels.includes('accept_claim')) {
          await call('POST', `/v1/customer/disputes/${id}/accept-claim`, { note: 'paydrill: seller accepts the claim' });
          accepted = true;
          log(`seller accepted the claim on ${id}`);
        }
        await sleep(15_000);
      }
      const rels = ((d.links as { rel: string }[]) ?? []).map((l) => l.rel).join(', ');
      throw new Error(
        `NOT REACHABLE: dispute ${id} is still ${d.status}, actions [${rels}]. ` +
        'PayPal did not resolve it in time, so CUSTOMER.DISPUTE.RESOLVED was not produced.',
      );
    },
  },
};

register('scenarios', {
  describe: 'List trigger scenarios and the events they produce',
  async run() {
    for (const [name, s] of Object.entries(SCENARIOS)) {
      console.log(`${name.padEnd(15)} ${s.describe}\n${' '.repeat(16)}-> ${s.expects.join(', ')}`);
    }
  },
});

register('trigger', {
  describe: 'Create real sandbox money movement: paydrill trigger <scenario>',
  async run(args) {
    const name = args[0];
    const s = name ? SCENARIOS[name] : undefined;
    if (!s) throw new Error(`Unknown scenario "${name ?? ''}". Try: ${Object.keys(SCENARIOS).join(', ')}`);
    console.log(`${name}: ${s.describe}`);
    await s.run((l) => console.log(`  ${l}`));
    console.log(`expect: ${s.expects.join(', ')}`);
  },
});
