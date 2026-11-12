import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readCodeFiles } from '../ai/llm.ts';
import { inventory } from './inventory.ts';
import { codemods } from './codemods.ts';
import { check, migrate, workUnits } from './run.ts';
import { bucket, exitCode } from './report.ts';

const dir = fileURLToPath(new URL('../../examples/stripe-shop', import.meta.url));
const files = readCodeFiles(dir);
const items = inventory(files);

test('codemods rewrite event types and signature verification, and still parse', () => {
  const { files: out, done } = codemods(files, items);
  const server = out.find((f) => f.path === 'server.js')!.text;
  assert.match(server, /case 'PAYMENT\.CAPTURE\.COMPLETED':/);
  assert.match(server, /case 'CUSTOMER\.DISPUTE\.CREATED':/);
  assert.doesNotMatch(server, /constructEvent/);
  assert.match(server, /async \(req, res\) => \{\n  let event;\n  try \{\n    event = await paypal\.webhooks\.verify\(req\.headers, req\.body\)/);
  assert.match(server, /^import \{ paypal, toPayPalAmount \} from '\.\/paypal\.js';$/m);
  assert.ok(out.some((f) => f.path === 'paypal.js'));
  assert.equal(done.size, 4); // three event literals + constructEvent
  assert.equal(check(dir, out), null);
});

test('work units attach amount, metadata and idempotency to their call', () => {
  const units = workUnits(items).map((u) => [u.primary.stripe, u.members.length]);
  assert.deepEqual(units, [
    ['stripe.paymentIntents.create', 4], ['stripe.refunds.create', 2], ['stripe.webhooks.constructEvent', 1], ['loadStripe', 4],
  ]);
});

test('buckets: unsupported never migrates, parity decides verified', () => {
  const sup = items.find((i) => i.stripe === 'stripe.refunds.create')!;
  const tax = items.find((i) => i.status === 'unsupported')!;
  assert.equal(bucket(tax, { state: 'migrated' }).bucket, 'not-migrated');
  assert.equal(bucket(sup, { state: 'migrated' }).bucket, 'migrated-unverified');
  const p = { itemId: sup.id, scenario: 'refund', stripeCalls: [{ fn: 'markRefunded', args: ['o', '10.00'] }], paypalCalls: [{ fn: 'markRefunded', args: ['o', '10.00'] }], same: true };
  const v = bucket(sup, { state: 'migrated' }, p);
  assert.equal(v.bucket, 'verified');
  assert.equal(bucket(sup, { state: 'migrated' }, { ...p, same: false }).bucket, 'needs-human');
  assert.equal(exitCode([v]), 0);
  assert.equal(exitCode([v, bucket(tax, { state: 'skipped' })]), 1);
  assert.equal(exitCode([bucket(tax, { state: 'skipped' })], true), 0);
});

test('plan mode without credentials writes nothing and is honest', async () => {
  const saved = [process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_AUTH_TOKEN];
  delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const r = await migrate(dir, { plan: true, log: () => {} });
    assert.equal(r.branch, undefined);
    assert.equal(r.exitCode, 1);
    assert.match(r.report, /\*\*Not fully migrated\.\*\*/);
    assert.match(r.diff, /PAYMENT\.CAPTURE\.COMPLETED/);
    assert.ok(!r.entries.some((e) => e.bucket === 'verified'));
  } finally {
    if (saved[0]) process.env.ANTHROPIC_API_KEY = saved[0];
    if (saved[1]) process.env.ANTHROPIC_AUTH_TOKEN = saved[1];
  }
});
