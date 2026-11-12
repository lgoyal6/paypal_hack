// The migration report: every inventory item lands in exactly one bucket.
// Failures first, in plain words.
import type { MigrateBucket, MigrateItem, MigrateReportEntry, ParityResult } from '../contract.ts';

export type Outcome = { state: 'migrated' } | { state: 'failed'; error: string } | { state: 'skipped' };

export function bucket(item: MigrateItem, outcome: Outcome, parity?: ParityResult): MigrateReportEntry {
  if (item.status === 'unsupported') return { item, bucket: 'not-migrated', detail: `Left as Stripe code. ${item.reason}` };
  if (outcome.state === 'failed') return { item, bucket: 'not-migrated', detail: `Migration failed and was rolled back: ${outcome.error}` };
  if (item.status === 'partial') return { item, bucket: 'needs-human', parity, detail: `${item.reason} Mapped toward: ${item.paypal ?? 'nothing'}.` };
  if (outcome.state === 'skipped') return { item, bucket: 'not-migrated', detail: 'Not attempted (plan mode or an earlier failure in the same file).' };
  if (!parity) return { item, bucket: 'migrated-unverified', detail: `Rewritten to ${item.paypal}; no parity scenario exercised it.` };
  if (!parity.same) {
    return { item, bucket: 'needs-human', parity, detail: `Rewritten, but the parity drill "${parity.scenario}" saw different business calls. Stripe: ${JSON.stringify(parity.stripeCalls)}. PayPal: ${JSON.stringify(parity.paypalCalls)}.` };
  }
  return { item, bucket: 'verified', parity, detail: `Same business calls on Stripe and PayPal in "${parity.scenario}".` };
}

const ORDER: MigrateBucket[] = ['not-migrated', 'needs-human', 'migrated-unverified', 'verified'];
const TITLE: Record<MigrateBucket, string> = {
  'not-migrated': 'Not migrated', 'needs-human': 'Needs human', 'migrated-unverified': 'Migrated, unverified', verified: 'Verified',
};

export const counts = (entries: MigrateReportEntry[]) =>
  Object.fromEntries(ORDER.map((b) => [b, entries.filter((e) => e.bucket === b).length])) as Record<MigrateBucket, number>;

export function reportMarkdown(entries: MigrateReportEntry[], meta: { branch?: string; plan: boolean }): string {
  const c = counts(entries);
  const allVerified = entries.length > 0 && c.verified === entries.length;
  const lines = [
    '# Migration report',
    '',
    allVerified ? 'Every Stripe usage was migrated and verified by a parity drill.'
      : `**Not fully migrated.** ${c['not-migrated']} not migrated, ${c['needs-human']} need a human, ${c['migrated-unverified']} migrated but unverified, ${c.verified} verified.`,
    meta.plan ? '\nPlan mode: nothing was written. The diff shows what would change.' : meta.branch ? `\nChanges are on branch \`${meta.branch}\`. Nothing was committed to your current branch.` : '',
    '',
  ];
  for (const b of ORDER) {
    const es = entries.filter((e) => e.bucket === b);
    if (!es.length) continue;
    lines.push(`## ${TITLE[b]} (${es.length})`, '', '| Stripe | Where | PayPal | Detail |', '|---|---|---|---|');
    for (const e of es) lines.push(`| \`${e.item.stripe}\` | ${e.item.where} | ${e.item.paypal ?? 'none'} | ${e.detail.replaceAll('|', '\\|')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function formatCounts(entries: MigrateReportEntry[], color = process.stdout.isTTY): string {
  const c = counts(entries);
  const paint = (code: number, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  return [paint(31, `not migrated ${c['not-migrated']}`), paint(33, `needs human ${c['needs-human']}`), paint(36, `migrated, unverified ${c['migrated-unverified']}`), paint(32, `verified ${c.verified}`)].join('   ');
}

/** Non-zero unless everything is verified; --allow-partial turns that into a warning. */
export const exitCode = (entries: MigrateReportEntry[], allowPartial = false) =>
  allowPartial || (entries.length > 0 && entries.every((e) => e.bucket === 'verified')) ? 0 : 1;
