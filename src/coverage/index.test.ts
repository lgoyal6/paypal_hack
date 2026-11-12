import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coverage, staticHandled } from './index.ts';

const shop = { path: 'server.js', text: readFileSync(new URL('../../examples/demo-shop/server.js', import.meta.url), 'utf8') };

test('finds the demo shop handled types with their lines', () => {
  const h = staticHandled([shop]);
  assert.deepEqual([...h.keys()].sort(), ['CUSTOMER.DISPUTE.CREATED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED']);
  assert.match(h.get('PAYMENT.CAPTURE.COMPLETED')!, /^server\.js:\d+$/);
});

test('exercised counts real and PayPal-simulated 2xx deliveries, never chaos; simulated ones are labeled', () => {
  const h = staticHandled([shop]);
  const d = (t: string, status: number, source: any = 'live') => ({ event: { id: t, event_type: t, create_time: '', resource: {} }, headers: {}, source, signature: 'verified' as const, response: { status, ms: 1, body: '' }, receivedAt: '' });
  const drillOf = (deliveries: ReturnType<typeof d>[]) => ({ forwardTo: '', startedAt: '', finishedAt: '', scenarios: [], checks: [], delivery: { expected: 0, live: 0, backfilled: 0, simulated: 0, missing: 0 }, deliveries });
  const c = coverage(h, drillOf([d('PAYMENT.CAPTURE.COMPLETED', 200), d('CUSTOMER.DISPUTE.CREATED', 500), d('PAYMENT.CAPTURE.REFUNDED', 200, 'chaos-forged')]));
  assert.deepEqual(c.exercised, ['PAYMENT.CAPTURE.COMPLETED']);
  assert.deepEqual(c.simulatedOnly, []);
  const sim = coverage(h, drillOf([d('PAYMENT.CAPTURE.REFUNDED', 200, 'paypal-simulated')]));
  assert.deepEqual(sim.exercised, ['PAYMENT.CAPTURE.REFUNDED']);
  assert.deepEqual(sim.simulatedOnly, ['PAYMENT.CAPTURE.REFUNDED']);
  assert.equal(c.handled.length, 3);
  assert.ok(c.missing.includes('PAYMENT.CAPTURE.REVERSED'));
});
