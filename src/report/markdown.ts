// Drill result as a PR comment. Failures first, then what passed; simulated deliveries always called out.
import type { DrillResult } from '../contract.js';

export const COMMENT_MARKER = '<!-- paydrill-drill -->';

export function verdictOf(r: DrillResult): 'ship' | 'fix-first' {
  const bad = r.checks.some((c) => !c.pass) || r.scenarios.some((s) => s.error) || r.delivery.missing > 0;
  return bad ? 'fix-first' : 'ship';
}

export function renderComment(r: DrillResult, opts: { coverage?: { handled: number; total: number } } = {}): string {
  const failed = r.checks.filter((c) => !c.pass);
  const scenarioErrors = r.scenarios.filter((s) => s.error);
  const simulated = r.scenarios.flatMap((s) => (s.simulated ?? []).map((t) => `${t} (${s.scenario})`));
  const d = r.delivery;
  const verdict = verdictOf(r);
  const lines: string[] = [COMMENT_MARKER];
  lines.push(`### paydrill: ${verdict === 'ship' ? 'ship it' : 'fix first'}`);
  lines.push('');
  lines.push(`Real PayPal sandbox events against \`${r.forwardTo}\`. ${r.checks.length - failed.length}/${r.checks.length} checks passed.`);
  if (opts.coverage) lines.push(`Payment coverage: ${opts.coverage.handled}/${opts.coverage.total} event types handled.`);
  lines.push('');
  if (failed.length || scenarioErrors.length) {
    lines.push('| | Check | Event | App answered | Why it matters |', '|---|---|---|---|---|');
    for (const s of scenarioErrors) lines.push(`| ❌ | scenario \`${s.scenario}\` | | | ${esc(s.error ?? '')} |`);
    for (const c of failed) lines.push(`| ❌ | ${c.check} | \`${c.eventType}\` | ${c.response.status} in ${c.response.ms}ms | ${esc(c.note ?? '')} |`);
    lines.push('');
  }
  lines.push(`PayPal delivery: ${d.live} live, ${d.backfilled} rescued by backfill, ${d.simulated ?? 0} simulated by PayPal, ${d.missing} missing of ${d.expected}.`);
  if (simulated.length) {
    lines.push('', `> Simulated by PayPal's webhook simulator, not real sandbox money movement: ${simulated.join(', ')}.`);
  }
  const passed = r.checks.filter((c) => c.pass);
  if (passed.length) {
    lines.push('', '<details><summary>Passed checks</summary>', '');
    for (const c of passed) lines.push(`- ${c.check} \`${c.eventType}\`: ${c.response.status} in ${c.response.ms}ms`);
    lines.push('', '</details>');
  }
  return lines.join('\n') + '\n';
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
