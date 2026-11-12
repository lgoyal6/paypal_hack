// Payment coverage: which PayPal event types the handler handles, and which of
// those a real drill actually exercised with a 2xx answer.
import ts from 'typescript';
import * as z from 'zod/v4';
import { writeFileSync } from 'node:fs';
import type { CodeFile, DrillResult } from '../contract.ts';
import { renderFiles, structured } from '../ai/llm.ts';

/** Event types a typical PayPal merchant account can emit (payments, orders, disputes, subscriptions). */
export const KNOWN_EVENT_TYPES = [
  'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED',
  'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
  'PAYMENT.AUTHORIZATION.CREATED', 'PAYMENT.AUTHORIZATION.VOIDED',
  'CHECKOUT.ORDER.APPROVED', 'CHECKOUT.ORDER.COMPLETED', 'CHECKOUT.ORDER.SAVED', 'CHECKOUT.ORDER.VOIDED',
  'CHECKOUT.PAYMENT-APPROVAL.REVERSED',
  'CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED', 'RISK.DISPUTE.CREATED',
  'BILLING.SUBSCRIPTION.CREATED', 'BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'PAYMENT.SALE.COMPLETED',
];
const EVENT = /^[A-Z]+(\.[A-Z_-]+){2,3}$/;

/** Event type string literals in the code (AST for JS/TS, regex for Python). */
export function staticHandled(files: CodeFile[]): Map<string, string> {
  const found = new Map<string, string>(); // type -> "file:line"
  for (const f of files) {
    if (f.path.endsWith('.py')) {
      f.text.split('\n').forEach((l, i) => {
        for (const m of l.matchAll(/["']([A-Z]+(?:\.[A-Z_-]+){2,3})["']/g)) if (!found.has(m[1])) found.set(m[1], `${f.path}:${i + 1}`);
      });
      continue;
    }
    const src = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && EVENT.test(n.text) && !found.has(n.text)) {
        found.set(n.text, `${f.path}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return found;
}

const AiHandled = z.object({ handled: z.array(z.object({ type: z.string(), where: z.string() })) });

/** Static first; ask Claude only when no literals were found (unusual dispatch, e.g. a handler map built from strings). */
export async function handledEvents(files: CodeFile[], useAi = true): Promise<{ map: Map<string, string>; via: 'ast' | 'ai' }> {
  const map = staticHandled(files);
  if (map.size || !useAi) return { map, via: 'ast' };
  const out = await structured(AiHandled, 'List the PayPal webhook event types this code dispatches on, each with "file:line". Only types the code actually handles.', renderFiles(files), 'medium');
  return { map: new Map(out.handled.map((h) => [h.type, h.where])), via: 'ai' };
}

export interface Coverage {
  handled: string[]; missing: string[]; exercised: string[]; notExercised: string[];
  where: Record<string, string>; total: number; percent: number;
  /** Exercised only by PayPal's webhook simulator (real delivery, mock payload). Always shown, per CONTRACT rule 6. */
  simulatedOnly: string[];
}

export function coverage(handled: Map<string, string>, drill: DrillResult | null, universe = KNOWN_EVENT_TYPES): Coverage {
  const h = [...handled.keys()].filter((t) => universe.includes(t)).sort();
  const answered = (sources: string[]) => new Set(drill?.deliveries
    .filter((d) => sources.includes(d.source) && d.response.status >= 200 && d.response.status < 300)
    .map((d) => d.event.event_type) ?? []);
  const real = answered(['live', 'backfill']);
  const ok = answered(['live', 'backfill', 'paypal-simulated']);
  const exercised = h.filter((t) => ok.has(t));
  return {
    simulatedOnly: exercised.filter((t) => !real.has(t)),
    handled: h, missing: universe.filter((t) => !handled.has(t)), exercised, notExercised: h.filter((t) => !ok.has(t)),
    where: Object.fromEntries([...handled].filter(([t]) => h.includes(t))), total: universe.length,
    percent: Math.round((exercised.length / universe.length) * 100),
  };
}

export function formatCoverage(c: Coverage): string {
  const more = (xs: string[]) => xs.slice(0, 4).join(', ') + (xs.length > 4 ? `, ... (${xs.length - 4} more)` : '');
  return [
    `handled    ${c.handled.length} / ${c.total} event types your account can emit`,
    `missing    ${more(c.missing) || 'none'}`,
    `exercised  ${c.exercised.length} / ${c.handled.length} handled types were hit by a drill event and answered 2xx`,
    ...(c.simulatedOnly.length ? [`           simulated by PayPal (mock payload): ${c.simulatedOnly.join(', ')}`] : []),
  ].join('\n');
}

/** shields.io-style flat badge, no network. */
export function badgeSvg(c: Coverage): string {
  const color = c.percent >= 80 ? '#2e7d32' : c.percent >= 40 ? '#b26a00' : '#c62828';
  const label = 'payment coverage', value = `${c.exercised.length}/${c.total}`;
  const lw = label.length * 6.5 + 10, vw = value.length * 7 + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${label}: ${value}">
<rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="14">${value}</text></g></svg>\n`;
}

export function writeCoverage(c: Coverage, dir = '.') {
  writeFileSync(`${dir}/coverage.json`, JSON.stringify(c, null, 2) + '\n');
  writeFileSync(`${dir}/payment-coverage.svg`, badgeSvg(c));
}
