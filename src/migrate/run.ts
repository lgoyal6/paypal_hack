// paydrill migrate: inventory -> codemods -> AI glue (each checked, rolled back
// on failure) -> report. Never in place: real runs land on a new branch in a
// separate worktree; --plan writes nothing.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CodeFile, MigrateItem, MigrateReportEntry, ParityResult } from '../contract.ts';
import { readCodeFiles } from '../ai/llm.ts';
import { applyEdits, unifiedDiff } from '../ai/fix.ts';
import { inventory } from './inventory.ts';
import { codemods } from './codemods.ts';
import { glueEdits } from './glue.ts';
import { bucket, exitCode, reportMarkdown, type Outcome } from './report.ts';

export interface MigrateOptions { plan?: boolean; parity?: ParityResult[]; allowPartial?: boolean; log?: (s: string) => void }

const lineOf = (i: MigrateItem) => Number(i.where.split(':').at(-1));
const fileOf = (i: MigrateItem) => i.where.slice(0, i.where.lastIndexOf(':'));

/** Group items into units of work: a Stripe call with its amount/metadata/idempotency items; all Stripe.js usage in a file. */
export function workUnits(items: MigrateItem[]): { primary: MigrateItem; members: MigrateItem[] }[] {
  const units: { primary: MigrateItem; members: MigrateItem[] }[] = [];
  const calls = items.filter((i) => i.kind === 'sdk-call' && i.stripe.startsWith('stripe.') && i.status === 'supported');
  for (const c of calls) units.push({ primary: c, members: [c] });
  for (const i of items.filter((x) => x.kind === 'amount' || x.kind === 'header' || x.stripe.startsWith('metadata'))) {
    const owner = calls.filter((c) => fileOf(c) === fileOf(i) && lineOf(c) <= lineOf(i) && (i.kind === 'header' || i.stripe.includes(`(${c.stripe})`)))
      .sort((a, b) => lineOf(b) - lineOf(a))[0];
    units.find((u) => u.primary === owner)?.members.push(i);
  }
  const js = items.filter((i) => i.kind === 'stripe-js');
  for (const f of new Set(js.map(fileOf))) {
    const members = js.filter((i) => fileOf(i) === f);
    units.push({ primary: members[0], members });
  }
  return units;
}

/** Syntax/type check a set of files inside a throwaway copy of the project. Returns an error message or null. */
export function check(projectDir: string, files: CodeFile[]): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'paydrill-check-'));
  try {
    cpSync(projectDir, dir, { recursive: true, filter: (s) => !s.includes('node_modules') && !s.includes('/.git') });
    if (existsSync(join(projectDir, 'node_modules'))) symlinkSync(join(projectDir, 'node_modules'), join(dir, 'node_modules'));
    for (const f of files) { mkdirSync(dirname(join(dir, f.path)), { recursive: true }); writeFileSync(join(dir, f.path), f.text); }
    if (existsSync(join(dir, 'tsconfig.json'))) execFileSync('npx', ['--no-install', 'tsc', '--noEmit', '-p', dir], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    else for (const f of files.filter((x) => /\.m?js$/.test(x.path))) execFileSync(process.execPath, ['--check', join(dir, f.path)], { stdio: 'pipe' });
    return null;
  } catch (e: any) {
    return String(e.stdout || e.stderr || e.message).trim().split('\n').slice(0, 6).join('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function migrate(projectDir: string, opts: MigrateOptions = {}) {
  const log = opts.log ?? ((s: string) => console.error(s));
  const original = readCodeFiles(projectDir);
  const items = inventory(original);
  if (!items.length) throw new Error('No Stripe usage found. Point paydrill at the folder with your Stripe code.');
  log(`inventory: ${items.length} Stripe usages (${items.filter((i) => i.status === 'supported').length} supported)`);

  const outcomes = new Map<string, Outcome>();
  const cm = codemods(original, items);
  let files = cm.files;
  for (const id of cm.done) outcomes.set(id, { state: 'migrated' });

  const units = workUnits(items);
  // The webhook handler body (field reads) is glue too: attach it to the constructEvent unit.
  for (const u of units) {
    const ids = u.members.map((m) => m.id);
    const label = `${u.primary.stripe} (${u.members.length} item${u.members.length > 1 ? 's' : ''})`;
    if (opts.plan && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      ids.forEach((id) => outcomes.set(id, { state: 'skipped' }));
      continue;
    }
    log(`glue: ${label}`);
    try {
      const target = u.primary.stripe.startsWith('stripe.webhooks.constructEvent')
        ? { ...u.primary, stripe: `${u.primary.stripe} (already rewritten to paypal.webhooks.verify; now move the handler body's event field reads to PayPal)` }
        : { ...u.primary, stripe: u.members.map((m) => `${m.stripe} @ ${m.where}`).join('; ') };
      const edits = await glueEdits(target, files);
      const next = applyEdits(files, edits.edits);
      const err = check(projectDir, next.filter((f, i) => f.text !== files[i]?.text || !original.some((o) => o.path === f.path)));
      if (err) throw new Error(`check failed after AI edit:\n${err}`);
      files = next;
      ids.forEach((id) => outcomes.set(id, { state: 'migrated' }));
    } catch (e: any) {
      log(`  rolled back: ${e.message.split('\n')[0]}`);
      ids.forEach((id) => outcomes.set(id, { state: 'failed', error: e.message }));
    }
  }

  // Drop the Stripe server client only when no server Stripe calls remain.
  files = files.map((f) => {
    if (inventory([f]).some((i) => i.kind === 'sdk-call' && i.stripe.startsWith('stripe.'))) return f;
    return { ...f, text: f.text.replace(/^import Stripe from ['"]stripe['"];?\n/m, '').replace(/^const \w+ = new Stripe\([^)]*\);?\n/m, '') };
  });

  const parity = new Map(opts.parity?.map((p) => [p.itemId, p]) ?? []);
  const entries: MigrateReportEntry[] = items.map((i) => bucket(i, outcomes.get(i.id) ?? { state: 'skipped' }, parity.get(i.id)));
  const changed = files.filter((f) => original.find((o) => o.path === f.path)?.text !== f.text);
  const diff = unifiedDiff(original.filter((o) => changed.some((c) => c.path === o.path)), changed);

  let branch: string | undefined;
  if (!opts.plan) {
    branch = `paydrill/migrate-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
    const report = reportMarkdown(entries, { branch, plan: false });
    writeOnBranch(projectDir, branch, [...changed, { path: 'MIGRATION_REPORT.md', text: report }]);
  }
  return { items, entries, diff, branch, report: reportMarkdown(entries, { branch, plan: !!opts.plan }), exitCode: exitCode(entries, opts.allowPartial) };
}

function writeOnBranch(projectDir: string, branch: string, files: CodeFile[]) {
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  const top = git(projectDir, 'rev-parse', '--show-toplevel');
  const prefix = git(projectDir, 'rev-parse', '--show-prefix');
  const wt = mkdtempSync(join(tmpdir(), 'paydrill-migrate-'));
  git(top, 'worktree', 'add', '-q', '-b', branch, wt, 'HEAD');
  for (const f of files) { const p = join(wt, prefix, f.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.text); }
  git(wt, 'add', '-A');
  git(wt, '-c', 'user.name=paydrill', '-c', 'user.email=paydrill@users.noreply.github.com', 'commit', '-q', '-m', 'Migrate Stripe to PayPal (paydrill migrate)\n\nSee MIGRATION_REPORT.md for what is verified and what is not.');
  git(top, 'worktree', 'remove', '--force', wt);
}
