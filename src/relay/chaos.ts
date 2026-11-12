// Redeliver real events the way production PayPal can: twice, out of order, forged, and unknown.
// Pass/fail here is decided only by the app's HTTP answers (CONTRACT.md rule 3).
import { forward } from './relay.js';
import type { CheckResult, DrillEvent, PayPalEvent } from '../contract.js';

const ok = (s: number) => s >= 200 && s < 300;

/** Tampered copy of a real event: new id, amount set to 9999.00, meant to be sent without PayPal signature headers. */
export function forgeEvent(e: PayPalEvent): PayPalEvent {
  const forged: PayPalEvent = structuredClone(e);
  forged.id = `WH-FORGED-${Date.now()}`;
  // Payments carry amount, disputes carry dispute_amount (see fixtures/README.md).
  const res = forged.resource as { amount?: { value?: string }; dispute_amount?: { value?: string } };
  if (res.amount) res.amount.value = '9999.00';
  if (res.dispute_amount) res.dispute_amount.value = '9999.00';
  return forged;
}

export async function runChaos(forwardTo: string, real: DrillEvent[], slowMs = 3_000): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  for (const d of real) {
    const r = await forward(forwardTo, d.event, d.headers, 'chaos-duplicate', d.signature);
    checks.push({
      check: 'duplicate', eventType: d.event.event_type, pass: ok(r.status), response: r,
      note: 'Status only. A handler that answers 200 but acts twice still passes here; the AI review checks for dedupe on event.id.',
    });
  }

  for (const d of [...real].reverse()) {
    const r = await forward(forwardTo, d.event, d.headers, 'chaos-reorder', d.signature);
    checks.push({ check: 'out-of-order', eventType: d.event.event_type, pass: ok(r.status), response: r });
  }

  const money = real.find((d) => {
    const r = d.event.resource as { amount?: unknown; dispute_amount?: unknown };
    return r.amount || r.dispute_amount;
  }) ?? real[0];
  if (money) {
    const forged = forgeEvent(money.event);
    // No paypal-* signature headers: a handler that verifies signatures must reject this.
    const r = await forward(forwardTo, forged, {}, 'chaos-forged', 'unsigned');
    checks.push({
      check: 'forged-unsigned', eventType: forged.event_type, pass: !ok(r.status), response: r,
      note: 'Tampered amount, no PayPal signature. 2xx means the app accepted a forged payment.',
    });
  }

  const unknown: PayPalEvent = {
    id: `WH-UNKNOWN-${Date.now()}`, event_type: 'PAYDRILL.UNKNOWN.EVENT',
    create_time: new Date().toISOString(), resource: {},
  };
  const r = await forward(forwardTo, unknown, {}, 'chaos-unknown', 'unsigned');
  checks.push({
    check: 'unknown-type', eventType: unknown.event_type, pass: ok(r.status), response: r,
    note: 'Non-2xx makes PayPal retry an event the app will never handle.',
  });

  for (const c of [...checks]) {
    if (c.response.ms > slowMs) {
      checks.push({ check: 'slow-response', eventType: c.eventType, pass: false, response: c.response, note: `over ${slowMs}ms; PayPal may time out and retry` });
    }
  }
  return checks;
}
