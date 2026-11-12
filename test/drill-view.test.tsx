import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import React from 'react';
import { render } from 'ink-testing-library';
import { DrillView, bar } from '../src/ui/DrillView.js';
import type { CheckResult, DrillEvent } from '../src/contract.js';

const tick = () => new Promise((r) => setTimeout(r, 30));
const delivery = (event_type: string): DrillEvent => ({
  event: { id: event_type, event_type, create_time: '', resource: {} }, headers: {}, source: 'live', signature: 'verified',
  response: { status: 200, ms: 5, body: '' }, receivedAt: '',
});

test('progress per scenario, then chaos checks turn green or red', async () => {
  const bus = new EventEmitter();
  const ui = render(<DrillView bus={bus} forwardTo="http://localhost:4242/hook" />);
  bus.emit('scenario', 'refund', ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED']);
  await tick();
  assert.match(ui.lastFrame()!, /refund\s+0\/2 events/);
  bus.emit('delivery', delivery('PAYMENT.CAPTURE.COMPLETED'));
  await tick();
  assert.match(ui.lastFrame()!, /refund\s+1\/2 events/);
  bus.emit('chaos');
  const fail: CheckResult = { check: 'forged-unsigned', eventType: 'PAYMENT.CAPTURE.COMPLETED', pass: false, response: { status: 200, ms: 3, body: '' } };
  bus.emit('check', fail);
  await tick();
  assert.match(ui.lastFrame()!, /✗ forged-unsigned/);
  ui.unmount();
});

test('bar fills in proportion', () => {
  assert.equal(bar(1, 2, 4), '██░░');
  assert.equal(bar(0, 0, 3), '░░░');
});
