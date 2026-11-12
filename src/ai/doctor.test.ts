import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossCheck } from './doctor.ts';

test('risks proven by a drill failure at the same spot sort first', () => {
  const rev = {
    handledEvents: [], missingEvents: [], scenarios: [] as any,
    risks: [
      { severity: 'high' as const, title: 'No signature check', where: 'server.js:126', why: '', fix: '' },
      { severity: 'medium' as const, title: 'Dispute amount', where: 'server.js:145', why: '', fix: '' },
    ],
  };
  const v = { verdict: 'fix-first' as const, summary: '', findings: [{ check: 'real-event:CUSTOMER.DISPUTE.CREATED', result: 'fail' as const, evidence: '500', where: 'server.js:144' }] };
  const items = crossCheck(rev, v);
  assert.equal(items[0].title, 'Dispute amount');
  assert.equal(items[0].proven, 'real-event:CUSTOMER.DISPUTE.CREATED');
  assert.equal(items[1].proven, null);
});
