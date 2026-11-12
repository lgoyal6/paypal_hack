// record: save a real sandbox session to a file. replay: re-send recorded or fixture events to any URL, no PayPal needed.
import fs from 'node:fs';
import path from 'node:path';
import { register } from '../registry.js';
import { startRelay, formatDelivery, forward } from './relay.js';
import { loadConfig } from '../scenarios/yaml.js';
import type { DrillEvent, PayPalEvent } from '../contract.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export interface Recording { recordedAt: string; forwardTo: string; deliveries: DrillEvent[] }

register('record', {
  describe: 'Record real sandbox events to a file: paydrill record --out session.json [--forward-to url]',
  async run(args) {
    const out = flag(args, 'out') ?? `paydrill-session-${Date.now()}.json`;
    const forwardTo = flag(args, 'forward-to') ?? loadConfig()?.forwardTo ?? 'http://127.0.0.1:9/discard';
    const relay = await startRelay({ forwardTo, port: Number(flag(args, 'port') ?? 0) });
    const rec: Recording = { recordedAt: new Date().toISOString(), forwardTo, deliveries: [] };
    const save = () => fs.writeFileSync(out, JSON.stringify(rec, null, 2));
    relay.bus.on('delivery', (d: DrillEvent) => { rec.deliveries.push(d); save(); console.log(formatDelivery(d)); });
    console.log(`Recording to ${out}. Trigger scenarios in another terminal; Ctrl-C to stop.`);
    save();
    const stop = async () => { await relay.close(); save(); console.log(`\nSaved ${rec.deliveries.length} events to ${out}`); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    const seconds = flag(args, 'seconds');
    if (seconds) { setTimeout(stop, Number(seconds) * 1000); }
    await new Promise(() => {});
  },
});

/** Accepts a recording file, a single event file, or a directory of event files (like fixtures/events). */
export function loadEvents(src: string): { event: PayPalEvent; headers: Record<string, string> }[] {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    return fs.readdirSync(src).filter((f) => f.endsWith('.json')).sort()
      .map((f) => ({ event: JSON.parse(fs.readFileSync(path.join(src, f), 'utf8')), headers: {} }));
  }
  const data = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (Array.isArray(data?.deliveries)) return (data as Recording).deliveries.map((d) => ({ event: d.event, headers: d.headers }));
  return [{ event: data, headers: {} }];
}

register('replay', {
  describe: 'Re-send recorded or fixture events: paydrill replay <file|dir> [--to url] [--only TYPE]',
  async run(args) {
    const src = args[0];
    if (!src) throw new Error('usage: paydrill replay <recording.json | event.json | fixtures/events> [--to url] [--only EVENT.TYPE]');
    const to = flag(args, 'to') ?? loadConfig()?.forwardTo;
    if (!to) throw new Error('--to is required (or set forwardTo in paydrill.yml)');
    const only = flag(args, 'only');
    let events = loadEvents(src);
    if (only) events = events.filter((e) => e.event.event_type === only);
    if (!events.length) throw new Error('nothing to replay');
    let failed = 0;
    for (const { event, headers } of events) {
      // Original PayPal signature headers are replayed as-is; they verify only if the app checks against the original webhook.
      const r = await forward(to, event, headers, 'live-retry', headers['paypal-transmission-sig'] ? 'verified' : 'unsigned');
      const ok = r.status >= 200 && r.status < 300;
      if (!ok) failed++;
      console.log(`${ok ? 'ok ' : 'ERR'} ${String(r.status).padEnd(3)} ${String(r.ms).padStart(5)}ms  ${event.event_type} ${String(event.resource?.id ?? event.resource?.dispute_id ?? '')}`);
    }
    console.log(`\nReplayed ${events.length} event(s) to ${to}; ${failed} non-2xx`);
    if (failed) process.exitCode = 1;
  },
});
