import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CheckResult, DrillResult } from '../contract.ts';
import { prBody } from './heal.ts';

const c = (check: CheckResult['check'], pass: boolean): CheckResult => ({ check, eventType: 'PAYMENT.CAPTURE.COMPLETED', pass, response: { status: pass ? 200 : 500, ms: 3, body: '' } });
const d = (checks: CheckResult[]): DrillResult => ({ forwardTo: '', startedAt: '', finishedAt: '', scenarios: [], deliveries: [], checks, delivery: { expected: 0, live: 0, backfilled: 0, simulated: 0, missing: 0 } });

test('PR body shows red to green per check', () => {
  const body = prBody(d([c('forged-unsigned', false), c('real-event', true)]), d([c('forged-unsigned', true), c('real-event', true)]),
    { verdict: 'fix-first', summary: '', findings: [{ check: 'forged-unsigned:PAYMENT.CAPTURE.COMPLETED', result: 'fail', evidence: 'forged event got 200', where: 'server.js:126' }] },
    { diff: 'x', fixes: ['forged-unsigned:PAYMENT.CAPTURE.COMPLETED'] });
  assert.match(body, /1 fixed, 0 still failing/);
  assert.match(body, /\| `forged-unsigned:PAYMENT\.CAPTURE\.COMPLETED` \| \*\*fail\*\* \(500\) \| pass \|/);
  assert.match(body, /never merges/);
});
