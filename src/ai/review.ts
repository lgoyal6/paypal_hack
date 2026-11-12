// AI.review: read the webhook code, say what it handles and which drills matter most.
import * as z from 'zod/v4';
import type { CodeFile, Review } from '../contract.ts';
import { renderFiles, structured } from './llm.ts';

/** Scenario names Laksh's triggers implement. Review may only pick from these. */
export const SCENARIOS = ['payment', 'refund', 'dispute', 'dispute-lost'] as const;

const RiskSchema = z.object({
  severity: z.enum(['high', 'medium', 'low']),
  title: z.string(),
  where: z.string().describe('"file:line" from the numbered listing'),
  why: z.string(),
  fix: z.string(),
});
export const ReviewSchema = z.object({
  handledEvents: z.array(z.string()),
  missingEvents: z.array(z.string()),
  risks: z.array(RiskSchema),
  scenarios: z.array(z.enum(SCENARIOS)).describe('most important first'),
});

const SYSTEM = `You review PayPal webhook handlers. You are given a project's source with line numbers.
Report:
- handledEvents: PayPal event types the code explicitly handles (exact strings like PAYMENT.CAPTURE.COMPLETED).
- missingEvents: event types a store taking PayPal payments should handle but this code does not (refunds, reversals, denials, disputes).
- risks: concrete defects only, each with "file:line" taken from the listing. Check for: missing webhook signature verification, no idempotency on event.id, wrong field names for the event's resource (disputes use dispute_amount, not amount), throwing or non-2xx on unknown event types, slow work done before responding.
- scenarios: which drill scenarios to run, most important first.
Do not invent files or lines. If unsure about a risk, leave it out.`;

/** `guidance`: extra rules to review against, e.g. PayPal's AI-Toolkit best-practices skill. */
export function review(files: CodeFile[], guidance?: string): Promise<Review> {
  const system = guidance ? `${SYSTEM}\n\nAlso check the code against PayPal's own best practices below; cite the rule in "why".\n<paypal_best_practices>\n${guidance}\n</paypal_best_practices>` : SYSTEM;
  return structured(ReviewSchema, system, renderFiles(files), 'high');
}
