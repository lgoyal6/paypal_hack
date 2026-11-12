import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { checkPages, score } from './shopper.ts';

const shopDir = fileURLToPath(new URL('../../examples/demo-shop', import.meta.url));

async function pages(port: number, blockers: string) {
  const p = spawn(process.execPath, ['server.js'], { cwd: shopDir, env: { ...process.env, PORT: String(port), SHOP_BLOCKERS: blockers }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await sleep(100); } }
    return [await (await fetch(`http://localhost:${port}/`)).text(), await (await fetch(`http://localhost:${port}/checkout`)).text()] as const;
  } finally { p.kill(); }
}

test('clean demo shop has no blockers; planted ones are all found', { skip: !(await import('node:fs')).existsSync(`${shopDir}/node_modules`) && 'run npm install in examples/demo-shop' }, async () => {
  const [store, checkout] = await pages(4391, '');
  assert.deepEqual(checkPages(store, checkout), []);
  const [s2, c2] = await pages(4392, 'captcha,login-price,no-structured-data');
  assert.deepEqual(checkPages(s2, c2).map((b) => b.id).sort(), ['captcha', 'login-price', 'no-structured-data']);
  assert.equal(score(checkPages(s2, c2), false), 10);
  assert.equal(score([], true), 100);
});
