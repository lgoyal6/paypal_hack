// Scenarios as code: paydrill.yml. Steps chain real sandbox calls; expect blocks are checked by the drill.
//
// scenarios:
//   angry-customer:
//     describe: Partial refund, then a chargeback the buyer wins
//     steps:
//       - pay: { amount: "49.99" }
//       - refund: { amount: "10.00" }      # omit amount for a full refund
//       - chargeback: {}
//       - resolve: buyer                    # real resolution; uses the dispute pool when one is ready
//       - wait: 5                           # seconds
//     expect:
//       events: [PAYMENT.CAPTURE.REFUNDED, CUSTOMER.DISPUTE.UPDATED]
//       handler: 2xx
//       within: 300s
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { paypal } from '../paypal/client.js';
import { advance, readyToAdjudicate } from './disputes.js';
import type { Scenario } from './triggers.js';
import type { Payment } from '../contract.js';

export interface PaydrillConfig {
  forwardTo?: string;
  scenarios?: Record<string, ScenarioSpec>;
}

interface ScenarioSpec {
  describe?: string;
  steps: Step[];
  expect?: { events?: string[]; handler?: '2xx'; within?: string | number };
}

type Step =
  | { pay: { amount?: string; currency?: string; description?: string } }
  | { refund: { amount?: string } | null }
  | { chargeback: { reason_code?: string } | null }
  | { resolve: 'buyer' | 'seller' }
  | { wait: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MONEY = /^\d+(\.\d{1,2})?$/;

export function loadConfig(cwd = process.cwd()): PaydrillConfig | null {
  const file = path.join(cwd, 'paydrill.yml');
  if (!fs.existsSync(file)) return null;
  return parse(fs.readFileSync(file, 'utf8')) ?? {};
}

function seconds(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = String(v).match(/^(\d+)\s*(s|m)?$/);
  if (!m) throw new Error(`paydrill.yml: "within: ${v}" must look like 120s or 5m`);
  return Number(m[1]) * (m[2] === 'm' ? 60 : 1);
}

/** Validate up front so a typo fails before any sandbox money moves. */
export function validate(name: string, spec: ScenarioSpec): void {
  const where = `paydrill.yml scenario "${name}"`;
  if (!Array.isArray(spec?.steps) || spec.steps.length === 0) throw new Error(`${where}: needs a non-empty steps list`);
  let paid = false;
  let disputed = false;
  spec.steps.forEach((step, i) => {
    const keys = Object.keys(step ?? {});
    if (keys.length !== 1) throw new Error(`${where}, step ${i + 1}: each step has exactly one action`);
    const [k] = keys;
    const v = (step as Record<string, any>)[k];
    switch (k) {
      case 'pay':
        if (v?.amount !== undefined && !MONEY.test(String(v.amount))) throw new Error(`${where}, step ${i + 1}: amount "${v.amount}" must be a decimal string like "12.00"`);
        paid = true; break;
      case 'refund':
        if (!paid) throw new Error(`${where}, step ${i + 1}: refund needs an earlier pay step`);
        if (v?.amount !== undefined && !MONEY.test(String(v.amount))) throw new Error(`${where}, step ${i + 1}: amount "${v.amount}" must be a decimal string`);
        break;
      case 'chargeback':
        if (!paid) throw new Error(`${where}, step ${i + 1}: chargeback needs an earlier pay step`);
        disputed = true; break;
      case 'resolve':
        if (!disputed) throw new Error(`${where}, step ${i + 1}: resolve needs an earlier chargeback step`);
        if (v !== 'buyer' && v !== 'seller') throw new Error(`${where}, step ${i + 1}: resolve is buyer or seller`);
        break;
      case 'wait':
        if (typeof v !== 'number' || v < 0) throw new Error(`${where}, step ${i + 1}: wait takes a number of seconds`);
        break;
      default:
        throw new Error(`${where}, step ${i + 1}: unknown action "${k}" (pay, refund, chargeback, resolve, wait)`);
    }
  });
  if (spec.expect?.handler !== undefined && spec.expect.handler !== '2xx') throw new Error(`${where}: expect.handler only supports 2xx`);
  seconds(spec.expect?.within);
}

export function toScenario(name: string, spec: ScenarioSpec): Scenario {
  validate(name, spec);
  const within = seconds(spec.expect?.within);
  return {
    describe: spec.describe ?? `paydrill.yml: ${name}`,
    expects: spec.expect?.events ?? [],
    timeoutMs: within ? within * 1000 : undefined,
    async run(log) {
      let payment: Payment | null = null;
      let disputeId: string | null = null;
      for (const step of spec.steps) {
        const [k, v] = Object.entries(step)[0] as [string, any];
        if (k === 'pay') {
          payment = await paypal.cardPayment({ currency_code: v?.currency ?? 'USD', value: String(v?.amount ?? '12.00') }, v?.description);
          log(`pay: captured ${payment.captureId} (${payment.amount.value} ${payment.amount.currency_code})`);
        } else if (k === 'refund') {
          const amount = v?.amount ? { currency_code: payment!.amount.currency_code, value: String(v.amount) } : undefined;
          const r = await paypal.refund(payment!.captureId, amount);
          log(`refund: ${r.refundId} ${amount ? amount.value : 'full'} (${r.status})`);
        } else if (k === 'chargeback') {
          const r = await paypal.chargeback(payment!, v?.reason_code);
          if (!r.disputeId) throw new Error('chargeback accepted but no dispute listed within 60s');
          disputeId = r.disputeId;
          log(`chargeback: dispute ${disputeId}`);
        } else if (k === 'resolve') {
          // Prefer a pooled dispute that is already adjudicable; otherwise walk this dispute's real path.
          const ready = await readyToAdjudicate();
          const id = ready?.disputeId ?? disputeId!;
          if (ready) log(`resolve: using ready pooled dispute ${id}`);
          const deadline = Date.now() + 45 * 60_000;
          for (;;) {
            const s = await advance(id);
            if (s === 'ready') break;
            if (Date.now() > deadline) throw new Error(`resolve: dispute ${id} never became adjudicable; run "paydrill disputes prepare" 30 minutes ahead`);
            await sleep(20_000);
          }
          await paypal.adjudicate(id, v === 'buyer' ? 'BUYER_FAVOR' : 'SELLER_FAVOR');
          log(`resolve: adjudicated ${id} for the ${v}`);
        } else if (k === 'wait') {
          await sleep(v * 1000);
        }
      }
      return { payment, disputeId };
    },
  };
}

/** All scenarios from paydrill.yml, validated. Throws on the first invalid one. */
export function yamlScenarios(cwd = process.cwd()): Record<string, Scenario> {
  const cfg = loadConfig(cwd);
  const out: Record<string, Scenario> = {};
  for (const [name, spec] of Object.entries(cfg?.scenarios ?? {})) out[name] = toScenario(name, spec);
  return out;
}
