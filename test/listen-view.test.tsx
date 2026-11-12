import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { render } from 'ink-testing-library';
import { ListenView } from '../src/ui/ListenView.js';
import type { DrillEvent, PayPalEvent } from '../src/contract.js';

const fixture = (t: string): PayPalEvent => JSON.parse(fs.readFileSync(`fixtures/events/${t}.json`, 'utf8'));
const delivery = (event: PayPalEvent, status = 200, source: DrillEvent['source'] = 'live'): DrillEvent => ({
  event, headers: {}, source, signature: 'verified', response: { status, ms: 7, body: '' }, receivedAt: '2026-11-12T09:30:00.000Z',
});
const tick = () => new Promise((r) => setTimeout(r, 100)); // 30ms flaked under parallel test load

test('shows real events, detail pane, and acts on keys', async () => {
  let push: (d: DrillEvent) => void = () => {};
  const calls: string[] = [];
  const actions = {
    replay: async (d: DrillEvent) => { calls.push('replay'); return delivery(d.event, 200, 'live-retry'); },
    duplicate: async (d: DrillEvent) => { calls.push('duplicate'); return delivery(d.event, 200, 'chaos-duplicate'); },
    forge: async (d: DrillEvent) => { calls.push('forge'); return delivery(d.event, 200, 'chaos-forged'); },
    quit: async () => { calls.push('quit'); },
  };
  const ui = render(<ListenView forwardTo="http://localhost:3000/hook" webhookId="WH123"
    subscribe={(on) => { push = on; return () => {}; }} actions={actions} />);

  assert.match(ui.lastFrame()!, /no events yet/);
  push(delivery(fixture('PAYMENT.CAPTURE.COMPLETED')));
  push(delivery(fixture('CUSTOMER.DISPUTE.UPDATED'), 500));
  await tick();
  let frame = ui.lastFrame()!;
  assert.match(frame, /PAYMENT\.CAPTURE\.COMPLETED/);
  assert.match(frame, /CUSTOMER\.DISPUTE\.UPDATED/);
  assert.match(frame, /500 in 7ms/, 'detail pane shows the selected (latest) event and the app answer');
  assert.match(frame, /PP-R-/, 'dispute resource id comes from dispute_id');

  ui.stdin.write('f');
  await tick();
  frame = ui.lastFrame()!;
  assert.deepEqual(calls, ['forge']);
  assert.match(frame, /chaos-forged/);
  assert.match(frame, /forge \(unsigned, tampered amount\): your app answered 200/);

  ui.stdin.write('e');
  await tick();
  assert.match(ui.lastFrame()!, /needs ANTHROPIC_API_KEY/, 'explain is honest when the AI lane is absent');

  ui.stdin.write('q');
  await tick();
  assert.deepEqual(calls, ['forge', 'quit']);
  ui.unmount();
});
