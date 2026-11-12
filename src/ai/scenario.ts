// paydrill new "<plain English>": Claude writes a paydrill.yml scenario; Laksh's validator checks it
// before anything is saved, so a bad step never reaches the sandbox.
import fs from 'node:fs';
import path from 'node:path';
import * as z from 'zod/v4';
import { Document, parseDocument } from 'yaml';
import { structured } from './llm.ts';
import { validate } from '../scenarios/yaml.ts';

const Money = z.string().regex(/^\d+(\.\d{1,2})?$/);
const ScenarioSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe('kebab-case scenario name'),
  describe: z.string(),
  steps: z.array(z.union([
    z.object({ pay: z.object({ amount: Money.optional(), currency: z.string().optional(), description: z.string().optional() }) }),
    z.object({ refund: z.object({ amount: Money.optional() }) }),
    z.object({ chargeback: z.object({ reason_code: z.string().optional() }) }),
    z.object({ resolve: z.enum(['buyer', 'seller']) }),
    z.object({ wait: z.number().min(0) }),
  ])).min(1),
  expect: z.object({
    events: z.array(z.string()),
    handler: z.literal('2xx'),
    within: z.string().describe('like 120s or 5m'),
  }),
});
export type GeneratedScenario = z.infer<typeof ScenarioSchema>;

const SYSTEM = `You write test scenarios for paydrill, which moves real money in the PayPal SANDBOX.
Steps run in order; each step has exactly one action:
- pay { amount?: "12.00", currency?, description? } — a card payment, captured. Required before refund or chargeback.
- refund { amount?: "5.00" } — omit amount for a full refund.
- chargeback {} — the buyer's bank disputes the payment.
- resolve: buyer | seller — PayPal rules on the dispute (needs a chargeback first; takes many minutes in the sandbox).
- wait: seconds.
expect.events lists the PayPal webhook events the scenario must produce, e.g. PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED, CUSTOMER.DISPUTE.CREATED, CUSTOMER.DISPUTE.UPDATED, CUSTOMER.DISPUTE.RESOLVED. Chargebacks always send CUSTOMER.DISPUTE.UPDATED; CREATED only sometimes, so expect UPDATED.
Set expect.within generously: 120s for payments and refunds, 5m with a chargeback, 30m with resolve.
If the request cannot be expressed with these actions, write the closest scenario and say what is missing in describe.`;

export async function newScenario(request: string): Promise<GeneratedScenario> {
  const s = await structured(ScenarioSchema, SYSTEM, request, 'medium');
  validate(s.name, s as never); // same checks as hand-written YAML
  return s;
}

/** Add (or replace) the scenario in paydrill.yml, keeping the file's comments and other scenarios. */
export function saveScenario(s: GeneratedScenario, cwd = process.cwd()): string {
  const file = path.join(cwd, 'paydrill.yml');
  // A fresh Document, not parsed `{}`, so a new file is written in block style.
  const doc = fs.existsSync(file) ? parseDocument(fs.readFileSync(file, 'utf8')) : new Document({ scenarios: {} });
  const { name, ...spec } = s;
  doc.setIn(['scenarios', name], doc.createNode(spec));
  fs.writeFileSync(file, doc.toString());
  return file;
}
