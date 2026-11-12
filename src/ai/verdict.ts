// AI.verdict: explain a drill's results. Pass/fail is NOT the model's call:
// the verdict and each finding's result are derived from CheckResult.pass.
import * as z from 'zod/v4';
import type { CheckResult, CodeFile, DrillResult, Finding, Review, Verdict } from '../contract.ts';
import { renderFiles, structured } from './llm.ts';

const ExplainSchema = z.object({
  summary: z.string().describe('two sentences max, failures first'),
  findings: z.array(z.object({
    check: z.string().describe('the check key exactly as given, e.g. "forged-unsigned:PAYMENT.CAPTURE.COMPLETED"'),
    evidence: z.string().describe('what the drill observed, quoting status codes or response bodies'),
    where: z.string().optional().describe('"file:line" of the code responsible'),
    fix: z.string().optional(),
  })),
});

const SYSTEM = `You explain the results of a PayPal webhook drill. Each check was already judged pass or fail by HTTP results; never contradict that.
For every FAILED check, write one finding: the evidence from the drill, the exact "file:line" responsible (from the numbered source), and a one-line fix.
For passed checks, add a finding only if something looks fragile. Keep the summary to two sentences, failures first.`;

export const checkKey = (c: CheckResult) => `${c.check}:${c.eventType}`;

/** The verdict is a rule, not an opinion: any failed check or missing event means fix-first. */
export function decide(results: DrillResult): Verdict['verdict'] {
  return results.checks.every((c) => c.pass) && results.delivery.missing === 0 ? 'ship' : 'fix-first';
}

export async function verdict(results: DrillResult, rev: Review | null, files: CodeFile[]): Promise<Verdict> {
  const byKey = new Map(results.checks.map((c) => [checkKey(c), c]));
  const input = [
    `<checks>\n${results.checks.map((c) => `${checkKey(c)} ${c.pass ? 'PASS' : 'FAIL'} status=${c.response.status} ${c.response.ms}ms body=${JSON.stringify(c.response.body)}${c.note ? ` note=${c.note}` : ''}`).join('\n')}\n</checks>`,
    `<delivery>${JSON.stringify(results.delivery)}</delivery>`,
    rev ? `<static_review>${JSON.stringify(rev.risks)}</static_review>` : '',
    renderFiles(files),
  ].join('\n\n');
  const out = await structured(ExplainSchema, SYSTEM, input, 'high');

  const findings: Finding[] = out.findings.map((f) => {
    const c = byKey.get(f.check);
    return { ...f, result: c ? (c.pass ? 'pass' : 'fail') : 'warn' };
  });
  // Every failed check gets a finding even if the model skipped it.
  for (const c of results.checks) {
    if (!c.pass && !findings.some((f) => f.check === checkKey(c))) {
      findings.push({ check: checkKey(c), result: 'fail', evidence: `status ${c.response.status}: ${c.response.body}` });
    }
  }
  return { verdict: decide(results), summary: out.summary, findings };
}
