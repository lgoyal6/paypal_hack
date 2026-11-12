import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PayPalClient } from '../contract.ts';
import { runPlan } from './ask.ts';

test('runPlan chains results and only runs after confirmation', async () => {
  const calls: string[] = [];
  const client = {
    cardPayment: async (amount: any) => { calls.push(`pay ${amount.value}`); return { orderId: 'O1', captureId: 'C1', merchantId: 'M', amount }; },
    refund: async (captureId: string) => { calls.push(`refund ${captureId}`); return { refundId: 'R1', status: 'COMPLETED' }; },
    chargeback: async (p: any) => { calls.push(`chargeback ${p.captureId}`); return { disputeId: 'D1' }; },
  } as unknown as PayPalClient;
  const plan = { summary: 'pay, refund, dispute', steps: [
    { action: 'cardPayment', args: { amount: { currency_code: 'USD', value: '20.00' } } },
    { action: 'refund', args: { captureId: '$0.captureId' } },
    { action: 'chargeback', args: { payment: '$0' } },
  ] };
  assert.equal(await runPlan(plan, client, async () => false), null);
  assert.deepEqual(calls, []);
  const out = await runPlan(plan, client, async () => true);
  assert.deepEqual(calls, ['pay 20.00', 'refund C1', 'chargeback C1']);
  assert.equal((out![2] as any).disputeId, 'D1');
});
