// paydrill doctor: static review, with each risk marked "proven" when a drill
// failure points at the same file and line. Complements /paypal:doctor, which
// reads code only.
import type { CodeFile, Review, Risk, Verdict } from '../contract.ts';
import { review } from './review.ts';
import { findToolkitSkill } from './toolkit.ts';

export interface DoctorItem extends Risk { proven: string | null } // the failing check that proves it

const sameSpot = (a?: string, b?: string) => {
  if (!a || !b) return false;
  const [fa, la] = a.split(':'), [fb, lb] = b.split(':');
  return fa === fb && Math.abs(Number(la) - Number(lb)) <= 3; // within a few lines
};

export function crossCheck(rev: Review, v: Verdict | null): DoctorItem[] {
  const fails = v?.findings.filter((f) => f.result === 'fail') ?? [];
  const order = { high: 0, medium: 1, low: 2 };
  return rev.risks
    .map((r) => ({ ...r, proven: fails.find((f) => sameSpot(f.where, r.where))?.check ?? null }))
    .sort((a, b) => Number(!!b.proven) - Number(!!a.proven) || order[a.severity] - order[b.severity]);
}

export function formatDoctor(items: DoctorItem[], rev: Review): string {
  const lines = [`handled: ${rev.handledEvents.join(', ') || 'none'}`, `missing: ${rev.missingEvents.join(', ') || 'none'}`, ''];
  for (const i of items) {
    lines.push(`${i.severity.toUpperCase().padEnd(6)} ${i.title}  (${i.where})${i.proven ? `  PROVEN by ${i.proven}` : '  static only'}`);
    lines.push(`       why: ${i.why}`, `       fix: ${i.fix}`);
  }
  return lines.join('\n');
}

export async function doctor(files: CodeFile[], v: Verdict | null = null) {
  const skill = findToolkitSkill();
  const rev = await review(files, skill?.text);
  const items = crossCheck(rev, v);
  const source = skill ? `reviewed with PayPal AI-Toolkit guidance (${skill.path})` : 'PayPal AI-Toolkit not installed; reviewed with paydrill rules only';
  return { review: rev, items, text: `${source}\n${formatDoctor(items, rev)}` };
}
