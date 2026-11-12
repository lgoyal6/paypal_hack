// AI.draftEvidence: turn a dispute and the shop's order record into a response
// PayPal's Disputes API accepts (notes + PDF documents).
import * as z from 'zod/v4';
import type { EvidencePacket } from '../contract.ts';
import { structured } from './llm.ts';
import { textPdf } from './pdf.ts';

/** PayPal evidence types by dispute reason. */
export const EVIDENCE_TYPE: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'PROOF_OF_FULFILLMENT',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'OTHER',
  UNAUTHORISED: 'PROOF_OF_AUTHORIZATION',
  CREDIT_NOT_PROCESSED: 'PROOF_OF_REFUND',
  DUPLICATE_TRANSACTION: 'PROOF_OF_RECEIPT_COPY',
  INCORRECT_AMOUNT: 'PROOF_OF_RECEIPT_COPY',
  CANCELED_RECURRING_BILLING: 'CANCELLATION_DETAILS',
};

const DraftSchema = z.object({
  notes: z.string().describe('the seller response PayPal shows the reviewer, under 2000 characters'),
  timeline: z.array(z.string()).describe('dated facts from the order record, oldest first, one line each'),
  weak: z.boolean().describe('true if the order record does not support the seller'),
});

const SYSTEM = `You draft a seller's response to a PayPal dispute. Use ONLY facts in the order record and dispute; never invent tracking numbers, dates or messages.
Write notes a PayPal reviewer can verify in under a minute: what was bought, when it was paid, how and when it was delivered (carrier, tracking), and any customer contact. Address the dispute reason directly. Plain sentences, no legal language, under 2000 characters.
If the record does not support the seller (no proof of delivery for a not-received claim, for example), set weak=true and say what is missing in the notes instead of arguing.`;

export async function draftEvidence(dispute: Record<string, unknown>, order: Record<string, unknown>): Promise<EvidencePacket> {
  const reason = String(dispute.reason ?? 'OTHER');
  const evidenceType = EVIDENCE_TYPE[reason] ?? 'OTHER';
  const draft = await structured(
    DraftSchema,
    SYSTEM,
    `<dispute>${JSON.stringify(dispute)}</dispute>\n<order>${JSON.stringify(order)}</order>\nEvidence type PayPal expects: ${evidenceType}`,
    'high',
  );
  const id = String(dispute.dispute_id ?? 'dispute');
  const pdf = textPdf(`Seller evidence for ${id} (${evidenceType})`, [...draft.timeline, '', ...wrap(draft.notes, 90)]);
  return {
    // ponytail: contract has no evidenceType field yet; carried in the notes header until CONTRACT changes
    notes: `[${evidenceType}]${draft.weak ? ' [WEAK: review before submitting]' : ''} ${draft.notes}`.slice(0, 2000),
    documents: [{ name: `${id}-evidence.pdf`, contentType: 'application/pdf', base64: pdf.toString('base64') }],
  };
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      if ((line + ' ' + w).trim().length > width) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
    }
    out.push(line);
  }
  return out;
}
