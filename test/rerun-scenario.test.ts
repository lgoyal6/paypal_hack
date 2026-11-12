import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startApp } from '../src/ai/rerun.ts';
import { saveScenario } from '../src/ai/scenario.ts';
import { validate } from '../src/scenarios/yaml.ts';

test('startApp refuses when something already answers, then starts and stops the app', async () => {
  const busy = http.createServer((_q, s) => s.end('old app'));
  await new Promise<void>((r) => busy.listen(0, '127.0.0.1', r));
  const port = (busy.address() as { port: number }).port;
  await assert.rejects(startApp(os.tmpdir(), 'true', `http://127.0.0.1:${port}/hook`), /already answering/);
  busy.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paydrill-app-'));
  fs.writeFileSync(path.join(dir, 'app.mjs'), `import http from 'node:http'; http.createServer((_q, s) => s.end('new')).listen(${port}, '127.0.0.1');`);
  const stop = await startApp(dir, `${process.execPath} app.mjs`, `http://127.0.0.1:${port}/hook`);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'new');
  stop();
  await new Promise((r) => setTimeout(r, 300));
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));
});

test('saveScenario adds to paydrill.yml and keeps existing comments and scenarios', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paydrill-yml-'));
  fs.writeFileSync(path.join(dir, 'paydrill.yml'), '# my config\nforwardTo: http://localhost:4242/webhooks/paypal\nscenarios:\n  mine:\n    steps:\n      - pay: { amount: "1.00" }\n');
  const s = { name: 'refund-half', describe: 'Pay, then refund half', steps: [{ pay: { amount: '20.00' } }, { refund: { amount: '10.00' } }],
    expect: { events: ['PAYMENT.CAPTURE.REFUNDED'], handler: '2xx' as const, within: '120s' } };
  validate(s.name, s as never);
  const text = fs.readFileSync(saveScenario(s, dir), 'utf8');
  assert.match(text, /^# my config/);
  assert.match(text, /mine:/);
  assert.match(text, /refund-half:\n\s+describe: Pay, then refund half/);
});
