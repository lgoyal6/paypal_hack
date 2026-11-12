// migrate parity: run the same scenario through the original Stripe app (Stripe test mode) and the
// migrated PayPal app (PayPal sandbox), read each app's business effects (GET /_effects), and require
// the same calls. Feeds `paydrill migrate --parity parity.json`, which marks matching items Verified.
//
// Scope, stated plainly: parity drives each platform's real webhooks into the app, so it verifies the
// webhook path (event types, signature verification, field reads, amounts). Stripe SDK calls made from
// the app's own endpoints (checkout, refunds) are not exercised and stay "migrated, unverified".
import fs from 'node:fs';
import path from 'node:path';
import { register } from '../registry.js';
import { readCodeFiles } from '../ai/llm.js';
import { startApp } from '../ai/rerun.js';
import { startRelay } from '../relay/relay.js';
import { openTunnel, settle } from '../relay/tunnel.js';
import { SCENARIOS } from '../scenarios/triggers.js';
import { inventory } from './inventory.js';
import type { MigrateItem, ParityResult } from '../contract.js';

export type Effect = { fn: string; args: unknown[] };

/** Per scenario: the Stripe actions that produce the same business event, and the Stripe event types they emit. */
export const PARITY_SCENARIOS: Record<string, { stripeEvents: string[]; cents: number }> = {
  payment: { stripeEvents: ['payment_intent.succeeded'], cents: 1200 },
  refund: { stripeEvents: ['payment_intent.succeeded', 'charge.refunded'], cents: 1500 },
  dispute: { stripeEvents: ['payment_intent.succeeded', 'charge.dispute.created'], cents: 1200 },
};

const MONEY = /^-?\d+\.\d{2}$/;

/** Same business calls: the same functions with the same amounts, each the same number of times. Order is
 *  not compared (webhooks arrive in any order), nor are order ids and platform wording (dispute reasons). */
export function sameEffects(a: Effect[], b: Effect[]): boolean {
  const norm = (es: Effect[]) => es.map((e) => `${e.fn}(${e.args.filter((x) => typeof x === 'string' && MONEY.test(x)).join(',')})`).sort();
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Inventory items a scenario exercises on the webhook path. */
export function exercisedItems(items: MigrateItem[], stripeEvents: string[]): MigrateItem[] {
  return items.filter((i) =>
    (i.kind === 'webhook-event' && stripeEvents.includes(i.stripe)) ||
    i.stripe.startsWith('stripe.webhooks.constructEvent'));
}

async function stripe(method: string, p: string, body?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${p}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${p}: ${res.status} ${data.error?.message ?? ''}`);
  return data;
}

/** Real Stripe test-mode money movement, using Stripe's documented test payment methods. */
async function stripeScenario(name: string, cents: number) {
  const pm = name === 'dispute' ? 'pm_card_createDispute' : 'pm_card_visa';
  const pi = await stripe('POST', '/payment_intents', {
    amount: String(cents), currency: 'usd', payment_method: pm, confirm: 'true',
    'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never',
  });
  if (name === 'refund') await stripe('POST', '/refunds', { payment_intent: pi.id });
}

async function effects(url: string): Promise<Effect[]> {
  return (await fetch(`${new URL(url).origin}/_effects`)).json();
}
const clearEffects = (url: string) => fetch(`${new URL(url).origin}/_effects`, { method: 'DELETE' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ParityOptions {
  stripeApp: string; stripeStart: string; stripeUrl: string;
  paypalApp: string; paypalStart: string; paypalUrl: string;
  scenarios: string[]; waitMs?: number; log?: (l: string) => void;
}

export async function runParity(o: ParityOptions): Promise<ParityResult[]> {
  const log = o.log ?? console.log;
  for (const k of ['STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']) if (!process.env[k]) throw new Error(`${k} is required for parity runs`);
  if (!process.env.STRIPE_SECRET_KEY!.startsWith('sk_test_')) throw new Error('STRIPE_SECRET_KEY must be a test-mode key (sk_test_...)');
  const items = inventory(readCodeFiles(o.stripeApp));
  const results: ParityResult[] = [];

  // Stripe side: tunnel to the original app, a temporary Stripe webhook endpoint, the app started with its secret.
  const stripePort = Number(new URL(o.stripeUrl).port || 80);
  const tunnel = await openTunnel(stripePort);
  await settle();
  const endpoint = await stripe('POST', '/webhook_endpoints', {
    url: tunnel.url + new URL(o.stripeUrl).pathname,
    ...Object.fromEntries([...new Set(Object.values(PARITY_SCENARIOS).flatMap((s) => s.stripeEvents))].map((e, i) => [`enabled_events[${i}]`, e])),
  });
  process.env.STRIPE_WEBHOOK_SECRET = endpoint.secret;
  const stopStripe = await startApp(o.stripeApp, o.stripeStart, o.stripeUrl).catch(async (e) => { await stripe('DELETE', `/webhook_endpoints/${endpoint.id}`); tunnel.close(); throw e; });
  const stopPaypal = await startApp(o.paypalApp, o.paypalStart, o.paypalUrl).catch((e) => { stopStripe(); throw e; });
  const relay = await startRelay({ forwardTo: o.paypalUrl }).catch((e) => { stopStripe(); stopPaypal(); throw e; });
  try {
    for (const name of o.scenarios) {
      const spec = PARITY_SCENARIOS[name];
      if (!spec) throw new Error(`No parity mapping for scenario "${name}". Try: ${Object.keys(PARITY_SCENARIOS).join(', ')}`);
      log(`\n${name}`);
      await Promise.all([clearEffects(o.stripeUrl), clearEffects(o.paypalUrl)]);
      await stripeScenario(name, spec.cents);
      log('  Stripe test mode: done');
      await SCENARIOS[name].run((l) => log(`  PayPal sandbox: ${l}`));
      await sleep(o.waitMs ?? (name === 'dispute' ? 5 * 60_000 : 90_000)); // PayPal dispute webhooks take minutes
      const [s, p] = await Promise.all([effects(o.stripeUrl), effects(o.paypalUrl)]);
      const same = sameEffects(s, p);
      log(`  Stripe: ${JSON.stringify(s.map((e) => [e.fn, ...e.args]))}`);
      log(`  PayPal: ${JSON.stringify(p.map((e) => [e.fn, ...e.args]))}`);
      log(`  ${same && s.length ? 'SAME business calls' : 'DIFFERENT'}`);
      for (const item of exercisedItems(items, spec.stripeEvents)) {
        // constructEvent is exercised by every scenario; keep its worst result.
        const prior = results.find((r) => r.itemId === item.id);
        if (prior && !prior.same) continue;
        const r = { itemId: item.id, scenario: name, stripeCalls: s, paypalCalls: p, same: same && s.length > 0 };
        if (prior) Object.assign(prior, r); else results.push(r);
      }
    }
  } finally {
    await relay.close();
    stopStripe(); stopPaypal(); tunnel.close();
    await stripe('DELETE', `/webhook_endpoints/${endpoint.id}`).catch(() => {});
  }
  return results;
}

const flag = (args: string[], name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

register('parity', {
  describe: 'Prove a migration: same scenario on Stripe test mode and PayPal sandbox, same business calls. paydrill parity --stripe-app dir --paypal-app dir ... --out parity.json',
  async run(args) {
    const need = (k: string) => { const v = flag(args, k); if (!v) throw new Error(`--${k} is required`); return v; };
    const out = flag(args, 'out') ?? 'parity.json';
    const results = await runParity({
      stripeApp: need('stripe-app'), stripeStart: need('stripe-start'), stripeUrl: need('stripe-url'),
      paypalApp: need('paypal-app'), paypalStart: need('paypal-start'), paypalUrl: need('paypal-url'),
      scenarios: (flag(args, 'scenarios') ?? 'payment,refund').split(','),
    });
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    console.log(`\n${results.filter((r) => r.same).length}/${results.length} exercised items match. Wrote ${path.resolve(out)}; pass it to paydrill migrate --parity ${out}`);
    if (results.some((r) => !r.same)) process.exitCode = 1;
  },
});
