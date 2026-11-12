import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toScenario, validate, yamlScenarios } from '../src/scenarios/yaml.js';

const ok = { steps: [{ pay: { amount: '49.99' } }, { refund: { amount: '10.00' } }, { chargeback: {} }, { resolve: 'buyer' as const }] };

test('valid scenario becomes a Scenario with expects and timeout', () => {
  const s = toScenario('angry', { ...ok, expect: { events: ['PAYMENT.CAPTURE.REFUNDED'], handler: '2xx', within: '5m' } });
  assert.deepEqual(s.expects, ['PAYMENT.CAPTURE.REFUNDED']);
  assert.equal(s.timeoutMs, 300_000);
});

test('rejects bad input before any money moves', () => {
  const bad: [unknown, RegExp][] = [
    [{ steps: [] }, /non-empty steps/],
    [{ steps: [{ refund: {} }] }, /needs an earlier pay/],
    [{ steps: [{ pay: {} }, { resolve: 'buyer' }] }, /needs an earlier chargeback/],
    [{ steps: [{ pay: { amount: 12 } }] }, /OK/],
    [{ steps: [{ pay: { amount: '12.345' } }] }, /decimal string/],
    [{ steps: [{ pay: {}, refund: {} }] }, /exactly one action/],
    [{ steps: [{ teleport: {} }] }, /unknown action "teleport"/],
    [{ steps: [{ pay: {} }], expect: { within: 'soon' } }, /120s or 5m/],
    [{ steps: [{ pay: {} }], expect: { handler: '4xx' } }, /only supports 2xx/],
  ];
  for (const [spec, re] of bad) {
    if (re.source === 'OK') { validate('x', spec as never); continue; } // numeric 12 is a valid amount ("12")
    assert.throws(() => validate('x', spec as never), re);
  }
});

test('paydrill.yml is read from the working directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paydrill-'));
  fs.writeFileSync(path.join(dir, 'paydrill.yml'), 'forwardTo: http://localhost:3000/hook\nscenarios:\n  two-refunds:\n    steps:\n      - pay: { amount: "30.00" }\n      - refund: { amount: "5.00" }\n      - refund: { amount: "5.00" }\n');
  const s = yamlScenarios(dir);
  assert.deepEqual(Object.keys(s), ['two-refunds']);
});
