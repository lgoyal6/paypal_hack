// Real sandbox money movement that makes PayPal emit real webhook events.
import { paypal, call } from '../paypal/client.js';
import { register } from '../registry.js';
import type { Money, Payment } from '../contract.js';
import { readyToAdjudicate, advance } from './disputes.js';

export interface Scenario {
  describe: string;
  expects: string[];
  run(log: (line: string) => void, opts?: { waitMs?: number; simulate?: (eventType: string) => Promise<string> }): Promise<Record<string, unknown>>;
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
    // Observed in sandbox (2026-11-12): CUSTOMER.DISPUTE.UPDATED arrived 3.5 to 4 minutes after the chargeback
    // in every run; CUSTOMER.DISPUTE.CREATED arrived in one run and not another, so only UPDATED is expected.
    // The capture's own PAYMENT.CAPTURE.COMPLETED was missing from PayPal's records in one run.
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
    // Real path: adjudicate a pooled dispute PayPal already offers adjudicate on (see disputes.ts), which yields a
    // real CUSTOMER.DISPUTE.RESOLVED for that same dispute about 6.5 minutes later. With no ready dispute it walks
    // the full real path on a new chargeback (30+ minutes). Only if that runs out of time, and the caller allows it,
    // does it fall back to PayPal's webhook simulator, labeled as simulated.
    describe: 'PayPal resolves a real dispute for the buyer (fast with "paydrill disputes prepare" run 30 min ahead)',
    expects: ['CUSTOMER.DISPUTE.RESOLVED'],
    async run(log, opts) {
      const deadline = Date.now() + (opts?.waitMs ?? 45 * 60_000);
      let target = await readyToAdjudicate();
      let out: Record<string, unknown>;
      if (target) {
        log(`using pooled dispute ${target.disputeId} (capture ${target.captureId}), already adjudicable`);
        out = { disputeId: target.disputeId, captureId: target.captureId, pooled: true };
      } else {
        log('no adjudicable dispute in the pool; walking the full real path (tip: paydrill disputes prepare)');
        out = await SCENARIOS.dispute.run(log);
      }
      const id = out.disputeId as string;
      while (Date.now() < deadline) {
        const s = await advance(id);
        if (s === 'accepted') log(`seller accepted the claim on ${id}; waiting for PayPal to offer adjudicate`);
        if (s === 'ready') {
          await paypal.adjudicate(id, 'BUYER_FAVOR');
          log(`adjudicated ${id}: BUYER_FAVOR. Real CUSTOMER.DISPUTE.RESOLVED usually follows in about 6.5 minutes.`);
          return { ...out, adjudicated: true };
        }
        await sleep(20_000);
      }
      const d = await paypal.getDispute(id);
      if (opts?.simulate) {
        const eventId = await opts.simulate('CUSTOMER.DISPUTE.RESOLVED');
        log(`SIMULATED: dispute ${id} did not become adjudicable in time (${d.status}); asked PayPal's webhook simulator for CUSTOMER.DISPUTE.RESOLVED (${eventId}).`);
        log('SIMULATED: real delivery and signature, mock payload that is not this dispute. Run "paydrill disputes prepare" ahead of time for a real one.');
        return { ...out, simulated: ['CUSTOMER.DISPUTE.RESOLVED'] };
      }
      throw new Error(`NOT REACHABLE in time: dispute ${id} is ${d.status}. Run "paydrill disputes prepare" about 30 minutes ahead.`);
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
