// paydrill init: verify sandbox keys, detect the webhook route, write paydrill.yml. Bare "paydrill" opens a menu.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as p from '@clack/prompts';
import { stringify } from 'yaml';
import { register } from '../registry.js';
import { detect } from './detect.js';
import { loadConfig } from '../scenarios/yaml.js';

async function checkKeys(id: string, secret: string): Promise<string | null> {
  const base = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error_description?: string };
  return body.error_description ?? `HTTP ${res.status}`;
}

function gitIgnores(file: string): boolean {
  try { execFileSync('git', ['check-ignore', '-q', file], { stdio: 'ignore' }); return true; } catch { return false; }
}

function writeEnv(id: string, secret: string): void {
  const file = path.join(process.cwd(), '.env');
  const keep = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !/^PAYPAL_CLIENT_(ID|SECRET)=/.test(l))
    : [];
  fs.writeFileSync(file, [...keep, `PAYPAL_CLIENT_ID=${id}`, `PAYPAL_CLIENT_SECRET=${secret}`, ''].join('\n'), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

const bail = (v: unknown) => { if (p.isCancel(v)) { p.cancel('Cancelled. Nothing was written.'); process.exit(0); } return v; };

export async function init(): Promise<void> {
  p.intro('paydrill init');

  // 1. Keys
  let id = process.env.PAYPAL_CLIENT_ID;
  let secret = process.env.PAYPAL_CLIENT_SECRET;
  if (id && secret) {
    const s = p.spinner(); s.start('Checking your sandbox keys with PayPal');
    const err = await checkKeys(id, secret);
    s.stop(err ? `Saved keys rejected: ${err}` : 'Sandbox keys work');
    if (err) { id = undefined; secret = undefined; }
  }
  if (!id || !secret) {
    p.note('developer.paypal.com > Apps & Credentials > Sandbox > your app.\nAlso tick Customer disputes under Features and click Save Changes.', 'Sandbox keys');
    for (;;) {
      id = String(bail(await p.text({ message: 'Client ID', validate: (v) => (v && v.trim().length >= 40 ? undefined : 'That looks too short for a client ID') }))).trim();
      secret = String(bail(await p.password({ message: 'Secret', validate: (v) => (v && v.trim().length >= 40 ? undefined : 'That looks too short for a secret') }))).trim();
      const s = p.spinner(); s.start('Checking with PayPal');
      const err = await checkKeys(id, secret);
      s.stop(err ? `PayPal rejected them: ${err}` : 'Sandbox keys work');
      if (!err) break;
    }
    writeEnv(id, secret);
    p.log.success('Saved to .env (readable only by you)');
  }
  if (fs.existsSync('.git') && !gitIgnores('.env')) {
    p.log.warn('.env is NOT gitignored here. Add ".env" to .gitignore before committing.');
  }

  // 2. Route
  const d = detect();
  let forwardTo = d.forwardTo;
  if (d.route) {
    p.log.success(`Detected ${d.framework ?? 'your app'} · route POST ${d.route}  (${d.routeWhere})`);
  } else {
    p.log.warn(`No PayPal webhook route found${d.framework ? ` in this ${d.framework} app` : ''}.`);
  }
  forwardTo = String(bail(await p.text({
    message: 'Forward events to',
    initialValue: forwardTo ?? `http://localhost:${d.port}/webhooks/paypal`,
    validate: (v) => (v && /^https?:\/\/.+/.test(v) ? undefined : 'Enter a full URL like http://localhost:3000/webhooks/paypal'),
  })));

  // 3. paydrill.yml
  const existing = loadConfig() ?? {};
  const cfg = {
    ...existing,
    forwardTo,
    scenarios: existing.scenarios ?? {
      'angry-customer': {
        describe: 'Partial refund, then a chargeback',
        steps: [{ pay: { amount: '49.99' } }, { refund: { amount: '10.00' } }, { chargeback: {} }],
        expect: { events: ['PAYMENT.CAPTURE.REFUNDED', 'CUSTOMER.DISPUTE.UPDATED'], handler: '2xx', within: '6m' },
      },
    },
  };
  fs.writeFileSync('paydrill.yml', stringify(cfg));
  p.log.success(`Wrote paydrill.yml (forwardTo ${forwardTo})`);

  // 4. Next
  const next = bail(await p.select({
    message: 'What next?',
    options: [
      { value: 'drill', label: 'Drill my handler', hint: 'recommended' },
      { value: 'listen', label: 'Listen for events' },
      { value: 'done', label: 'Nothing for now' },
    ],
  }));
  p.outro(next === 'done' ? 'Run "paydrill drill" whenever you are ready.' : `Starting paydrill ${String(next)}...`);
  if (next !== 'done') {
    const { commands } = await import('../registry.js');
    await commands[String(next)].run(['--forward-to', forwardTo]);
  }
}

register('init', { describe: 'Set up keys, detect your webhook route, write paydrill.yml', run: init });
