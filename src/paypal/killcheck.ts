// Phase 0 kill checks: can the sandbox do the two things the whole plan depends on?
import { paypal } from './client.js';
import { register } from '../registry.js';

register('killcheck', {
  describe: 'Run the Phase 0 kill checks against the PayPal sandbox',
  async run() {
    const results: { check: string; pass: boolean; detail: string }[] = [];

    console.log('1. Card payment with no buyer approval');
    let payment;
    try {
      payment = await paypal.cardPayment({ currency_code: 'USD', value: '12.00' });
      results.push({ check: 'buyerless card capture', pass: true, detail: `capture ${payment.captureId}, merchant ${payment.merchantId}` });
    } catch (e) {
      results.push({ check: 'buyerless card capture', pass: false, detail: (e as Error).message });
    }

    console.log('2. Chargeback opens a dispute');
    if (payment) {
      try {
        const { disputeId } = await paypal.chargeback(payment);
        if (disputeId) {
          const d = await paypal.getDispute(disputeId);
          const links = ((d.links as { rel: string }[]) ?? []).map((l) => l.rel).join(', ');
          results.push({ check: 'chargeback opens dispute', pass: true, detail: `dispute ${disputeId}, status ${d.status}, actions: ${links}` });
        } else {
          results.push({ check: 'chargeback opens dispute', pass: false, detail: 'chargeback accepted but no dispute listed after 60s' });
        }
      } catch (e) {
        results.push({ check: 'chargeback opens dispute', pass: false, detail: (e as Error).message });
      }
    } else {
      results.push({ check: 'chargeback opens dispute', pass: false, detail: 'skipped: no payment to dispute' });
    }

    console.log('');
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.check}: ${r.detail}`);
    if (results.some((r) => !r.pass)) process.exitCode = 1;
  },
});
