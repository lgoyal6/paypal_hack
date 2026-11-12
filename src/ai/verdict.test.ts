import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckResult, DrillResult } from '../contract.ts';
import { decide } from './verdict.ts';

const check = (pass: boolean): CheckResult => ({ check: 'real-event', eventType: 'PAYMENT.CAPTURE.COMPLETED', pass, response: { status: pass ? 200 : 500, ms: 5, body: '' } });
const drill = (checks: CheckResult[], missing = 0): DrillResult => ({
  forwardTo: 'http://localhost:4242/webhooks/paypal', startedAt: '', finishedAt: '', scenarios: [], deliveries: [], checks,
  delivery: { expected: 1, live: 1, backfilled: 0, simulated: 0, missing },
});

test('verdict is decided by checks, not the model', () => {
  assert.equal(decide(drill([check(true), check(true)])), 'ship');
  assert.equal(decide(drill([check(true), check(false)])), 'fix-first');
  assert.equal(decide(drill([check(true)], 1)), 'fix-first');
});
