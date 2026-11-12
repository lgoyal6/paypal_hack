// A pool of real sandbox disputes aged ahead of time, so a real CUSTOMER.DISPUTE.RESOLVED takes minutes, not half an hour.
//
// Observed real path (2026-11-12): chargeback -> WAITING_FOR_SELLER_RESPONSE (~4 min, accept_claim offered)
// -> accept_claim -> UNDER_REVIEW -> adjudicate offered (3 to ~20 min later) -> adjudicate
// -> RESOLVED (~6.5 min later, real CUSTOMER.DISPUTE.RESOLVED webhook for the same dispute).
// The pool lives in PayPal itself (dispute status and links), so there is no local state to lose.
import { paypal, call } from '../paypal/client.js';
import { register } from '../registry.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rels = (d: Record<string, unknown>) => ((d.links as { rel: string }[]) ?? []).map((l) => l.rel);

export interface PoolDispute { disputeId: string; status: string; actions: string[]; captureId?: string }

export async function listPool(): Promise<PoolDispute[]> {
  const l = await call('GET', '/v1/customer/disputes?page_size=50');
  const out: PoolDispute[] = [];
  for (const i of l.items ?? []) {
    if (i.status === 'RESOLVED') continue;
    const d = await paypal.getDispute(i.dispute_id);
    const tx = (d.disputed_transactions as { seller_transaction_id?: string }[] | undefined)?.[0];
    out.push({ disputeId: i.dispute_id, status: String(d.status), actions: rels(d), captureId: tx?.seller_transaction_id });
  }
  return out;
}

/** A pooled dispute PayPal will let us adjudicate right now, if any. */
export async function readyToAdjudicate(): Promise<PoolDispute | null> {
  return (await listPool()).find((p) => p.status === 'UNDER_REVIEW' && p.actions.includes('adjudicate')) ?? null;
}

/** Move one dispute as far as it can go right now: accept the claim if offered. */
export async function advance(id: string): Promise<'accepted' | 'ready' | 'waiting'> {
  const d = await paypal.getDispute(id);
  const a = rels(d);
  if (d.status === 'UNDER_REVIEW' && a.includes('adjudicate')) return 'ready';
  if (a.includes('accept_claim')) {
    await call('POST', `/v1/customer/disputes/${id}/accept-claim`, { note: 'paydrill: seller accepts the claim' });
    return 'accepted';
  }
  return 'waiting';
}

register('disputes', {
  describe: 'Real dispute pool: paydrill disputes prepare [n] | list',
  async run(args) {
    if (args[0] === 'prepare') {
      const n = Number(args[1] ?? 2);
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = await paypal.cardPayment({ currency_code: 'USD', value: '12.00' });
        const { disputeId } = await paypal.chargeback(p);
        if (!disputeId) throw new Error(`chargeback for ${p.captureId} produced no dispute`);
        ids.push(disputeId);
        console.log(`opened ${disputeId} (capture ${p.captureId})`);
      }
      // Also advance disputes opened earlier that are still waiting for the seller.
      for (const p of await listPool()) if (p.actions.includes('accept_claim')) ids.push(p.disputeId);
      console.log('Accepting claims as PayPal offers them (usually about 4 minutes)...');
      const pending = new Set(ids);
      const deadline = Date.now() + 15 * 60_000;
      while (pending.size && Date.now() < deadline) {
        for (const id of [...pending]) {
          const s = await advance(id);
          if (s !== 'waiting') { console.log(`${id}: ${s}`); pending.delete(id); }
        }
        if (pending.size) await sleep(20_000);
      }
      for (const id of pending) console.log(`${id}: still waiting for accept_claim; "paydrill disputes prepare 0" retries it`);
      console.log('Accepted disputes become adjudicable 3 to ~20 minutes later. "paydrill disputes list" shows which are ready.');
      return;
    }
    if (args[0] === undefined || args[0] === 'list') {
      for (const p of await listPool()) {
        const ready = p.status === 'UNDER_REVIEW' && p.actions.includes('adjudicate');
        console.log(`${p.disputeId}  ${p.status.padEnd(28)} ${ready ? 'READY ' : '      '} [${p.actions.join(', ')}]`);
      }
      return;
    }
    throw new Error('usage: paydrill disputes prepare [n] | list');
  },
});
