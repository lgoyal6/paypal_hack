// paydrill rehearse dispute: walk ONE real sandbox dispute through every stage and check the app answers at each.
// Stages: opened -> evidence due -> evidence submitted -> under review -> resolved.
// Real timings observed in sandbox: ~4 min to evidence due, ~17-21 min to adjudicable, 1-6.5 min to resolved.
import { register } from '../registry.js';
import { paypal } from '../paypal/client.js';
import { startRelay, formatDelivery } from '../relay/relay.js';
import { loadConfig } from './yaml.js';
import type { AI, DrillEvent, EvidencePacket } from '../contract.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rels = (d: Record<string, unknown>) => ((d.links as { rel: string }[]) ?? []).map((l) => l.rel);

interface Stage { name: string; startedAt: number; endedAt?: number; status?: string; deliveries: DrillEvent[]; note?: string; ok?: boolean }

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Tijil's AI lane exports `ai: AI` from src/ai/index. Absent or keyless means no AI drafting. */
async function loadAI(): Promise<AI | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const spec = '../ai/index.js';
  try { return ((await import(spec)) as { ai?: AI }).ai ?? null; } catch { return null; }
}

function defaultEvidence(dispute: Record<string, unknown>, order: Record<string, unknown>): EvidencePacket {
  return {
    notes: `Order ${String(order.id)} was captured and fulfilled as described. Dispute ${String(dispute.dispute_id)}: ` +
      'the item matched the listing; tracking and receipt attached in production. (paydrill default evidence, no AI)',
    documents: [],
  };
}

async function until(id: string, test: (d: Record<string, unknown>) => boolean, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const d = await paypal.getDispute(id);
    if (test(d)) return d;
    if (Date.now() > deadline) throw Object.assign(new Error(`timed out at status ${d.status} [${rels(d).join(', ')}]`), { dispute: d });
    await sleep(20_000);
  }
}

register('rehearse', {
  describe: 'Walk one real dispute through every stage: paydrill rehearse dispute [--outcome seller|buyer]',
  async run(args) {
    if (args[0] !== 'dispute') throw new Error('usage: paydrill rehearse dispute [--forward-to url] [--outcome seller|buyer]');
    const forwardTo = flag(args, 'forward-to') ?? loadConfig()?.forwardTo;
    if (!forwardTo) throw new Error('--forward-to is required (or set forwardTo in paydrill.yml)');
    const outcome = flag(args, 'outcome') === 'buyer' ? 'BUYER_FAVOR' : 'SELLER_FAVOR';
    const ai = await loadAI();
    console.log(`Rehearsing a real dispute against ${forwardTo}. This takes 30+ minutes; the sandbox sets the pace.`);
    console.log(ai ? 'Evidence: drafted by Claude (AI lane).' : 'Evidence: paydrill default notes (AI lane not available).');

    const relay = await startRelay({ forwardTo });
    const stages: Stage[] = [];
    let cur: Stage | null = null;
    const begin = (name: string) => {
      if (cur) cur.endedAt = Date.now();
      cur = { name, startedAt: Date.now(), deliveries: [] };
      stages.push(cur);
      console.log(`\n▶ ${name}`);
    };
    // PayPal sends every event of the app to every webhook, so other runs' events arrive too.
    // Keep only events that mention this rehearsal's order, capture or dispute.
    const ids = new Set<string>();
    const ours = (d: DrillEvent) => { const s = JSON.stringify(d.event.resource); return [...ids].some((id) => s.includes(id)); };
    relay.bus.on('delivery', (d: DrillEvent) => {
      cur?.deliveries.push(d);
      if (!ids.size || ours(d)) console.log(`    ${formatDelivery(d)}`);
    });
    relay.bus.on('warn', (w: string) => console.log(`    warn: ${w}`));

    let failed: string | null = null;
    try {
      begin('opened');
      const payment = await paypal.cardPayment({ currency_code: 'USD', value: '24.00' }, 'paydrill rehearsal order');
      ids.add(payment.orderId).add(payment.captureId);
      const { disputeId } = await paypal.chargeback(payment);
      if (!disputeId) throw new Error('chargeback produced no dispute');
      ids.add(disputeId);
      console.log(`    chargeback on ${payment.captureId} -> dispute ${disputeId}`);

      begin('evidence due');
      let d = await until(disputeId, (x) => rels(x).includes('provide_evidence'), 15 * 60_000);
      cur!.status = String(d.status);
      console.log(`    status ${d.status}, seller response due ${String(d.seller_response_due_date ?? 'n/a')}`);

      begin('evidence submitted');
      const order = { id: payment.orderId, capture: payment.captureId, amount: payment.amount };
      const evidence = ai ? await ai.draftEvidence(d, order) : defaultEvidence(d, order);
      await paypal.submitEvidence(disputeId, evidence);
      d = await paypal.getDispute(disputeId);
      cur!.status = String(d.status);
      console.log(`    evidence submitted (${evidence.notes.length} chars, ${evidence.documents.length} documents); status ${d.status}`);

      begin('under review');
      d = await until(disputeId, (x) => x.status === 'UNDER_REVIEW' && rels(x).includes('adjudicate'), 40 * 60_000);
      cur!.status = String(d.status);
      console.log(`    adjudicable; ruling ${outcome}`);
      await paypal.adjudicate(disputeId, outcome);

      begin('resolved');
      d = await until(disputeId, (x) => x.status === 'RESOLVED', 15 * 60_000);
      cur!.status = String(d.status);
      const out = d.dispute_outcome as { outcome_code?: string } | undefined;
      console.log(`    resolved: ${out?.outcome_code ?? 'unknown outcome'}`);
      await sleep(60_000); // let the RESOLVED webhook arrive
    } catch (e) {
      failed = (e as Error).message;
      console.log(`    STOPPED: ${failed}`);
    } finally {
      if (cur) (cur as Stage).endedAt = Date.now();
      await relay.close();
    }

    console.log('\nTimeline');
    let bad = Boolean(failed);
    for (const s of stages) {
      s.deliveries = s.deliveries.filter(ours);
      const mins = (((s.endedAt ?? Date.now()) - s.startedAt) / 60_000).toFixed(1);
      const answers = s.deliveries.map((x) => `${x.event.event_type.replace('CUSTOMER.DISPUTE.', '')}:${x.response.status}`);
      const appFailed = s.deliveries.some((x) => x.response.status < 200 || x.response.status >= 300);
      if (appFailed) bad = true;
      const mark = appFailed ? 'FAIL' : s.deliveries.length ? 'ok  ' : '--  ';
      console.log(`  ${mark} ${s.name.padEnd(19)} ${mins.padStart(5)} min  ${s.status ?? ''}  ${answers.join(' ') || 'no webhook in this stage'}`);
    }
    if (failed) console.log(`  Stopped early: ${failed}`);
    console.log(bad ? '\nVerdict: FIX FIRST' : '\nVerdict: your handler answered 2xx at every stage');
    if (bad) process.exitCode = 1;
  },
});
