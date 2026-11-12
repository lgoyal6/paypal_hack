// AI.ask: plain English -> a list of real PayPalClient calls. The plan is shown
// and confirmed before anything runs; steps can use earlier results ("$0.captureId").
import * as z from 'zod/v4';
import type { PayPalClient } from '../contract.ts';
import { structured } from './llm.ts';

export const ACTIONS = ['cardPayment', 'refund', 'chargeback', 'getDispute', 'requireEvidence', 'adjudicate', 'listEvents', 'resendEvent'] as const;
type Action = (typeof ACTIONS)[number];

const PlanSchema = z.object({
  steps: z.array(z.object({
    action: z.enum(ACTIONS),
    args: z.record(z.string(), z.unknown()).describe('named arguments, see the action list'),
  })),
  summary: z.string().describe('one sentence saying what will happen, including amounts'),
});

const SYSTEM = `You turn a developer's request into calls against a PayPal SANDBOX test client. Available actions and their named args:
- cardPayment { amount: {currency_code, value}, description? } -> { orderId, captureId, merchantId, amount }
- refund { captureId, amount?: {currency_code, value} } -> { refundId, status }  (omit amount for a full refund)
- chargeback { payment } -> { disputeId }  (payment is a cardPayment result)
- getDispute { disputeId }
- requireEvidence { disputeId }
- adjudicate { disputeId, outcome: "BUYER_FAVOR" | "SELLER_FAVOR" }
- listEvents { since: ISO time }
- resendEvent { eventId }
To use an earlier step's result, write a string "$<step index>" or "$<step index>.<field>", e.g. "$0.captureId" or "$0" for the whole result.
Money values are decimal strings ("12.00"). If the request mentions existing payments, they are listed in <recent_payments>; use their fields directly. If something is ambiguous or impossible, return no steps and explain in the summary.`;

export async function ask(text: string): Promise<{ steps: { action: string; args: Record<string, unknown> }[]; summary: string }> {
  return structured(PlanSchema, SYSTEM, text, 'medium');
}

/** Replace "$N" / "$N.field" strings with earlier results. */
export function resolve(v: unknown, results: unknown[]): unknown {
  if (typeof v === 'string') {
    const m = /^\$(\d+)(?:\.([\w.]+))?$/.exec(v);
    if (!m) return v;
    const i = Number(m[1]);
    if (i >= results.length) throw new Error(`Step refers to ${v} before step ${i} ran`);
    return m[2] ? m[2].split('.').reduce((o: any, k) => o?.[k], results[i]) : results[i];
  }
  if (Array.isArray(v)) return v.map((x) => resolve(x, results));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, results)]));
  return v;
}

const CALL: Record<Action, (c: PayPalClient, a: any) => Promise<unknown>> = {
  cardPayment: (c, a) => c.cardPayment(a.amount, a.description),
  refund: (c, a) => c.refund(a.captureId, a.amount),
  chargeback: (c, a) => c.chargeback(a.payment, a.reasonCode),
  getDispute: (c, a) => c.getDispute(a.disputeId),
  requireEvidence: (c, a) => c.requireEvidence(a.disputeId),
  adjudicate: (c, a) => c.adjudicate(a.disputeId, a.outcome),
  listEvents: (c, a) => c.listEvents(a.since),
  resendEvent: (c, a) => c.resendEvent(a.eventId),
};

/** Run a plan after `confirm` says yes. Stops at the first error (PayPalError is rethrown, not swallowed). */
export async function runPlan(
  plan: { steps: { action: string; args: Record<string, unknown> }[]; summary: string },
  client: PayPalClient,
  confirm: (summary: string, steps: string[]) => Promise<boolean>,
): Promise<unknown[] | null> {
  const lines = plan.steps.map((s, i) => `${i}. ${s.action} ${JSON.stringify(s.args)}`);
  if (!plan.steps.length || !(await confirm(plan.summary, lines))) return null;
  const results: unknown[] = [];
  for (const s of plan.steps) {
    if (!(ACTIONS as readonly string[]).includes(s.action)) throw new Error(`Unknown action ${s.action}`);
    results.push(await CALL[s.action as Action](client, resolve(s.args, results)));
  }
  return results;
}
