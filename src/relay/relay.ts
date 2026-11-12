// Receives real PayPal sandbox webhooks through a tunnel and forwards them to the developer's app.
// Beyond a plain forwarder: verifies each signature with PayPal, and backfills events PayPal
// recorded but never delivered (sandbox delivery is known to drop and delay events).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { paypal, call } from '../paypal/client.js';
import { openTunnel, settle } from './tunnel.js';
import { target } from './routes.js';
import type { DrillEvent, EventSource, HandlerResponse, PayPalEvent, SignatureStatus } from '../contract.js';

// Webhooks this machine's paydrill processes registered, with the owning pid, so a crashed run's webhook
// can be cleaned up without touching webhooks that belong to runs still alive.
const LEDGER = path.join(os.homedir(), '.paydrill', 'webhooks.json');
type Ledger = Record<string, { pid: number; startedAt: string }>;
const readLedger = (): Ledger => { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {}; } };
const writeLedger = (l: Ledger) => { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2)); };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function trackWebhook(id: string) { const l = readLedger(); l[id] = { pid: process.pid, startedAt: new Date().toISOString() }; writeLedger(l); }
function untrackWebhook(id: string) { const l = readLedger(); delete l[id]; writeLedger(l); }
async function pruneDeadWebhooks() {
  const l = readLedger();
  for (const [id, owner] of Object.entries(l)) {
    if (alive(owner.pid)) continue;
    await paypal.deleteWebhook(id).catch(() => {});
    delete l[id];
  }
  writeLedger(l);
}

const PASS_HEADERS = [
  'paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id',
  'paypal-transmission-sig', 'paypal-transmission-time', 'correlation-id',
];

export async function forward(
  forwardTo: string,
  event: PayPalEvent,
  headers: Record<string, string>,
  source: EventSource,
  signature: SignatureStatus,
): Promise<HandlerResponse> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'paydrill-source': source,
    'paydrill-signature': signature,
  };
  for (const k of PASS_HEADERS) if (headers[k]) h[k] = headers[k];
  const t0 = Date.now();
  try {
    const res = await fetch(target(event.event_type, forwardTo), { method: 'POST', headers: h, body: JSON.stringify(event) });
    return { status: res.status, ms: Date.now() - t0, body: (await res.text()).slice(0, 300) };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return { status: 0, ms: Date.now() - t0, body: `connection failed: ${err.cause?.code ?? err.message}` };
  }
}

export interface Relay {
  bus: EventEmitter; // emits 'delivery' with a DrillEvent
  /** Ask PayPal's simulator for an event; its delivery is labeled paypal-simulated. */
  simulate(eventType: string): Promise<string>;
  seen: Map<string, DrillEvent>;
  webhookId: string;
  url: string;
  forwardTo: string;
  close(): Promise<void>;
}

export async function startRelay(opts: {
  forwardTo: string;
  port?: number;
  backfill?: boolean;
  backfillAfterMs?: number;
  /** Your own public HTTPS URL that already forwards to `port` (ngrok, a reverse proxy, a VPS). Skips cloudflared. */
  publicUrl?: string;
}): Promise<Relay> {
  const { forwardTo, port = 0, backfill = true, backfillAfterMs = 20_000 } = opts; // 0 = any free port, so runs never collide
  const bus = new EventEmitter();
  const seen = new Map<string, DrillEvent>();
  const simulatedIds = new Set<string>();
  const startedAt = new Date(Date.now() - 5_000).toISOString();
  let webhookId = '';

  const deliver = async (event: PayPalEvent, headers: Record<string, string>, source: EventSource, signature: SignatureStatus) => {
    const response = await forward(forwardTo, event, headers, source, signature);
    const d: DrillEvent = { event, headers, source, signature, response, receivedAt: new Date().toISOString() };
    if (!seen.has(event.id)) seen.set(event.id, d);
    bus.emit('delivery', d);
    return d;
  };

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(200); res.end('paydrill relay'); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let event: PayPalEvent;
      try { event = JSON.parse(raw); } catch { res.writeHead(400); res.end(); return; }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
      const signature = webhookId ? await paypal.verifySignature(headers, webhookId, event) : 'error';
      const prior = seen.get(event.id);
      if (prior?.source === 'backfill') {
        // Already handed to the app by backfill. Forwarding again would invent a duplicate PayPal never sent twice.
        bus.emit('warn', `PayPal delivered ${event.event_type} ${event.id} live after backfill had already forwarded it; not forwarded again`);
        res.writeHead(200); res.end();
        return;
      }
      const source: EventSource = simulatedIds.has(event.id) ? 'paypal-simulated' : prior ? 'live-retry' : 'live';
      const d = await deliver(event, headers, source, signature);
      // Pass the app's answer back so PayPal's own retry behaviour stays realistic.
      res.writeHead(d.response.status >= 200 && d.response.status < 300 ? 200 : 500);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const boundPort = (server.address() as { port: number }).port;

  const publicUrl = opts.publicUrl ?? process.env.PAYDRILL_PUBLIC_URL;
  if (publicUrl && !/^https:\/\//.test(publicUrl)) throw new Error('PayPal only delivers webhooks to https URLs; --public-url must start with https://');
  if (publicUrl && !port) throw new Error('--public-url needs a fixed --port that your URL forwards to');
  const tunnel = publicUrl ? { url: publicUrl, close() {} } : await openTunnel(boundPort);
  try {
    if (!publicUrl) await settle();
    // Only remove webhooks whose paydrill process is gone. Deleting every tunnel webhook killed
    // concurrent runs (a rehearsal lost its webhook when a record session started).
    await pruneDeadWebhooks();
    const existing: { id: string }[] = (await call('GET', '/v1/notifications/webhooks')).webhooks ?? [];
    if (existing.length >= 10) {
      throw new Error('This sandbox app already has 10 webhooks (PayPal\'s cap). Delete unused ones in the developer dashboard.');
    }
    webhookId = (await paypal.createWebhook(tunnel.url)).webhookId;
    trackWebhook(webhookId);
  } catch (e) {
    tunnel.close();
    server.close();
    throw e;
  }

  let poller: NodeJS.Timeout | null = null;
  if (backfill) {
    poller = setInterval(async () => {
      try {
        for (const ev of await paypal.listEvents(startedAt)) {
          if (seen.has(ev.id)) continue;
          if (Date.now() - Date.parse(ev.create_time) < backfillAfterMs) continue; // give live delivery a chance
          await deliver(ev, {}, 'backfill', 'unsigned');
        }
      } catch (e) {
        bus.emit('warn', `backfill poll failed: ${(e as Error).message}`);
      }
    }, 10_000);
  }

  return {
    bus, seen, webhookId, url: tunnel.url, forwardTo,
    async simulate(eventType) {
      const { eventId } = await paypal.simulateEvent(webhookId, eventType);
      simulatedIds.add(eventId);
      const early = seen.get(eventId); // delivery can beat the API response
      if (early) early.source = 'paypal-simulated';
      return eventId;
    },
    async close() {
      if (poller) clearInterval(poller);
      await paypal.deleteWebhook(webhookId).catch(() => {});
      untrackWebhook(webhookId);
      tunnel.close();
      server.close();
    },
  };
}

export function formatDelivery(d: DrillEvent): string {
  const t = d.receivedAt.slice(11, 19);
  const ok = d.response.status >= 200 && d.response.status < 300;
  const id = (d.event.resource?.id ?? d.event.resource?.dispute_id ?? '') as string;
  return `${t}  ${ok ? 'ok ' : 'ERR'} ${String(d.response.status).padEnd(3)} ${String(d.response.ms).padStart(5)}ms  ` +
    `${d.source.padEnd(10)} sig:${d.signature.padEnd(8)} ${d.event.event_type} ${id}`;
}
