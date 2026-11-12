import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drift, generate, infer, loadEvents, shapesByType } from './index.ts';

const events = loadEvents(fileURLToPath(new URL('../../fixtures/events', import.meta.url)));

test('generated types compile and discriminate on event_type', () => {
  const { types, zod } = generate(shapesByType(events));
  const dir = mkdtempSync(join(tmpdir(), 'paydrill-types-'));
  writeFileSync(join(dir, 'paypal-events.ts'), types);
  writeFileSync(join(dir, 'paypal-events.zod.ts'), zod);
  execFileSync('ln', ['-s', join(process.cwd(), 'node_modules'), join(dir, 'node_modules')]);
  writeFileSync(join(dir, 'use.ts'), `import type { PayPalWebhookEvent } from './paypal-events.js';
export function amount(e: PayPalWebhookEvent): string {
  if (e.event_type === 'CUSTOMER.DISPUTE.CREATED') return e.resource.dispute_amount.value;
  if (e.event_type === 'PAYMENT.CAPTURE.COMPLETED') return e.resource.amount.value;
  return '';
}
// @ts-expect-error disputes have no resource.amount
export const bad = (e: Extract<PayPalWebhookEvent, { event_type: 'CUSTOMER.DISPUTE.CREATED' }>) => e.resource.amount;
`);
  execFileSync(join(process.cwd(), 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', 'use.ts', 'paypal-events.zod.ts'], { cwd: dir });
});

test('drift: a renamed field is reported as a possible rename, a type change as type-changed', () => {
  const dispute = events.find((e) => e.event_type === 'CUSTOMER.DISPUTE.CREATED')!;
  const snap = infer(dispute);
  const { dispute_amount, ...rest } = dispute.resource as any;
  const renamed = infer({ ...dispute, resource: { ...rest, amount: dispute_amount } });
  const d = drift('CUSTOMER.DISPUTE.CREATED', snap, renamed);
  assert.deepEqual(d.map((x) => [x.change, x.path]), [['possible-rename', '.resource.dispute_amount']]);
  const retyped = infer({ ...dispute, resource: { ...dispute.resource, reason: 12 } });
  assert.equal(drift('x', snap, retyped)[0].change, 'type-changed');
  assert.deepEqual(drift('x', snap, infer(dispute)), []);
});
