import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readCodeFiles } from '../ai/llm.ts';
import { inventory } from './inventory.ts';
import { exercisedItems, sameEffects, PARITY_SCENARIOS } from './parity.ts';
import { bucket } from './report.ts';

test('sameEffects: same calls and amounts in any order; ids and wording ignored; counts matter', () => {
  const stripe = [{ fn: 'fulfillOrder', args: ['order_1', '15.00'] }, { fn: 'markRefunded', args: ['order_1', '15.00'] }];
  const paypal = [{ fn: 'markRefunded', args: [null, '15.00'] }, { fn: 'fulfillOrder', args: ['ORDER-9X', '15.00'] }];
  assert.ok(sameEffects(stripe, paypal));
  assert.ok(sameEffects([{ fn: 'flagDispute', args: ['a', '12.00', 'fraudulent'] }], [{ fn: 'flagDispute', args: ['b', '12.00', 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED'] }]));
  assert.ok(!sameEffects(stripe, [paypal[1]]), 'a missing refund is a difference');
  assert.ok(!sameEffects([stripe[0]], [{ fn: 'fulfillOrder', args: ['x', '1500'] }]), 'amount in wrong units is a difference');
  assert.ok(!sameEffects([stripe[0]], [stripe[0], stripe[0]]), 'shipping twice is a difference');
});

test('parity marks the webhook-path items it exercised, and parity results drive Verified', () => {
  const items = inventory(readCodeFiles(fileURLToPath(new URL('../../examples/stripe-shop', import.meta.url))));
  const ex = exercisedItems(items, PARITY_SCENARIOS.refund.stripeEvents).map((i) => i.stripe).sort();
  assert.deepEqual(ex, ['charge.refunded', 'payment_intent.succeeded', 'stripe.webhooks.constructEvent']);
  const refunded = items.find((i) => i.stripe === 'charge.refunded')!;
  const p = { itemId: refunded.id, scenario: 'refund', stripeCalls: [], paypalCalls: [], same: true };
  assert.equal(bucket(refunded, { state: 'migrated' }, p).bucket, 'verified');
});
