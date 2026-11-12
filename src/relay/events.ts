// paydrill events list | inspect | resend | diff, and paydrill webhook create | list.
import fs from 'node:fs';
import { register } from '../registry.js';
import { call, paypal } from '../paypal/client.js';
import type { PayPalEvent } from '../contract.js';

const flag = (args: string[], name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

/** An event by id from PayPal, or from a local JSON file (fixtures, recordings). */
async function load(ref: string): Promise<PayPalEvent> {
  if (fs.existsSync(ref)) { const { _source, ...e } = JSON.parse(fs.readFileSync(ref, 'utf8')); return e; }
  return call('GET', `/v1/notifications/webhooks-events/${ref}`);
}

/** Leaf paths that differ between two JSON values: changed, only in a, only in b. */
export function diffJson(a: unknown, b: unknown, path = ''): string[] {
  const isObj = (x: unknown) => x !== null && typeof x === 'object';
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])].sort();
    return keys.flatMap((k) => {
      const p = Array.isArray(a) ? `${path}[${k}]` : `${path}.${k}`;
      const [x, y] = [(a as any)[k], (b as any)[k]];
      if (x === undefined) return [`+ ${p}: ${JSON.stringify(y)}`];
      if (y === undefined) return [`- ${p}: ${JSON.stringify(x)}`];
      return diffJson(x, y, p);
    });
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`~ ${path || '.'}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`];
}

register('events', {
  describe: 'Sandbox webhook events: paydrill events list [--since 1h] | inspect <id> | resend <id> | diff <idA|file> <idB|file>',
  async run(args) {
    const [sub, a, b] = args.filter((x, i) => !x.startsWith('--') && !args[i - 1]?.startsWith('--'));
    if (sub === 'list') {
      const since = flag(args, 'since') ?? '1h';
      const m = since.match(/^(\d+)(m|h|d)$/);
      const from = m ? new Date(Date.now() - Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2] as 'm' | 'h' | 'd']) : new Date(since);
      const events = await paypal.listEvents(from.toISOString());
      for (const e of events) console.log(`${e.create_time}  ${e.id}  ${e.event_type.padEnd(28)} ${e.summary ?? ''}`);
      if (!events.length) console.log(`no events since ${from.toISOString()}`);
    } else if (sub === 'inspect' && a) {
      console.log(JSON.stringify(await load(a), null, 2));
    } else if (sub === 'resend' && a) {
      await paypal.resendEvent(a);
      console.log(`asked PayPal to resend ${a} to your webhooks`);
    } else if (sub === 'diff' && a && b) {
      const lines = diffJson(await load(a), await load(b));
      console.log(lines.length ? lines.join('\n') : 'identical');
    } else {
      throw new Error('usage: paydrill events list [--since 1h] | inspect <id> | resend <id> | diff <idA|file> <idB|file>');
    }
  },
});

register('webhook', {
  describe: 'Your app\'s own sandbox webhook (set PAYPAL_WEBHOOK_ID to it): paydrill webhook create | list',
  async run(args) {
    if (args[0] === 'create') {
      // A placeholder URL; the relay points it at its tunnel on every run.
      const { webhookId } = await paypal.createWebhook('https://example.com/paydrill-placeholder');
      console.log(`created ${webhookId}\nPut PAYPAL_WEBHOOK_ID=${webhookId} in .env for paydrill and for your app, so both verify against the same webhook.`);
    } else if (args[0] === 'list') {
      const hooks: { id: string; url: string }[] = (await call('GET', '/v1/notifications/webhooks')).webhooks ?? [];
      for (const h of hooks) console.log(`${h.id}  ${h.url}${h.id === process.env.PAYPAL_WEBHOOK_ID ? '  (PAYPAL_WEBHOOK_ID)' : ''}`);
    } else {
      throw new Error('usage: paydrill webhook create | list');
    }
  },
});
