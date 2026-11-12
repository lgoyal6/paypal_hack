import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readCodeFiles } from '../ai/llm.ts';
import { inventory } from './inventory.ts';

const files = readCodeFiles(fileURLToPath(new URL('../../examples/stripe-shop', import.meta.url)));

test('inventory of the Stripe sample shop', () => {
  const items = inventory(files);
  const got = items.map((i) => `${i.status} ${i.stripe}`).sort();
  assert.deepEqual(got, [
    'partial metadata (stripe.paymentIntents.create)',
    'partial stripe.customers.create',
    'supported amount (stripe.paymentIntents.create)',
    'supported amount (stripe.refunds.create)',
    'supported charge.dispute.created',
    'supported charge.refunded',
    'supported idempotencyKey',
    'supported loadStripe',
    'supported payment_intent.succeeded',
    'supported stripe.confirmPayment',
    'supported stripe.elements',
    'supported stripe.paymentIntents.create',
    'supported stripe.refunds.create',
    'supported stripe.webhooks.constructEvent',
    'supported elements.create',
    'unsupported stripe.tax.calculations.create',
  ].sort());
  assert.ok(items.every((i) => /^(server\.js|public\/checkout\.js):\d+$/.test(i.where)));
  assert.ok(items.filter((i) => i.status !== 'supported').every((i) => i.reason));
});
