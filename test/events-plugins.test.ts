import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffJson } from '../src/relay/events.ts';
import { loadPlugins } from '../src/plugins.ts';
import { commands } from '../src/registry.ts';

test('diffJson reports changed, added and removed leaves', () => {
  const a = { resource: { amount: { value: '49.99' }, reason: 'X' } };
  const b = { resource: { dispute_amount: { value: '49.99' }, reason: 'Y' } };
  assert.deepEqual(diffJson(a, b), [
    '- .resource.amount: {"value":"49.99"}',
    '+ .resource.dispute_amount: {"value":"49.99"}',
    '~ .resource.reason: "X" -> "Y"',
  ]);
  assert.deepEqual(diffJson(a, structuredClone(a)), []);
});

test('plugins become commands with the PayPal client injected, and cannot shadow built-ins', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paydrill-plugins-'));
  fs.writeFileSync(path.join(dir, 'hello.mjs'), "export const describe = 'say hi'; export async function run(args, ctx) { globalThis.__hello = [args, typeof ctx.paypal.refund]; }");
  assert.deepEqual(await loadPlugins(dir), ['hello']);
  assert.match(commands.hello.describe, /say hi \(plugin\)/);
  await commands.hello.run(['x']);
  assert.deepEqual((globalThis as any).__hello, [['x'], 'function']);
  fs.writeFileSync(path.join(dir, 'hello.mjs'), 'export async function run() {}');
  await assert.rejects(loadPlugins(dir), /would replace the built-in/);
});
