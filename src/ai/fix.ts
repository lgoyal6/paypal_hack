// AI.fix: Claude proposes exact find/replace edits; we build the unified diff
// ourselves so the patch always applies to the files it was made from.
import * as z from 'zod/v4';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CodeFile, Patch, Verdict } from '../contract.ts';
import { renderFiles, structured } from './llm.ts';

export const EditsSchema = z.object({
  edits: z.array(z.object({
    path: z.string(),
    find: z.string().describe('exact text copied from the file WITHOUT line-number prefixes, unique in that file'),
    replace: z.string(),
  })),
  fixes: z.array(z.string()).describe('the finding check keys these edits address'),
});
export type Edits = z.infer<typeof EditsSchema>;

const SYSTEM = `You fix PayPal webhook handlers so they pass a drill. Make the smallest edits that fix each failed finding:
- verify the webhook signature with PayPal's POST /v1/notifications/verify-webhook-signature using the PAYPAL_WEBHOOK_ID env var, and reject (400) when it fails;
- make handling idempotent on event.id;
- read the right fields for each event's resource (disputes: resource.dispute_amount);
- answer 2xx to event types the app does not handle.
Each edit's "find" must be copied exactly from the file (no line-number prefixes) and occur once. Do not touch unrelated code. Do not add dependencies.`;

/** Apply edits to file texts. Throws if a "find" is missing or ambiguous. */
export function applyEdits(files: CodeFile[], edits: Edits['edits']): CodeFile[] {
  const out = new Map(files.map((f) => [f.path, f.text]));
  for (const e of edits) {
    const text = out.get(e.path);
    if (text == null) throw new Error(`Edit targets unknown file ${e.path}`);
    const at = text.indexOf(e.find);
    if (at < 0 || text.indexOf(e.find, at + 1) >= 0) throw new Error(`Edit "find" in ${e.path} is ${at < 0 ? 'missing' : 'not unique'}`);
    out.set(e.path, text.slice(0, at) + e.replace + text.slice(at + e.find.length));
  }
  return [...out].map(([path, text]) => ({ path, text }));
}

/** Unified diff (git format, a/ b/ prefixes) between two versions of the same files. */
export function unifiedDiff(before: CodeFile[], after: CodeFile[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'paydrill-diff-'));
  try {
    const write = (root: string, files: CodeFile[]) => files.forEach((f) => {
      const p = join(dir, root, f.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.text);
    });
    write('a', before); write('b', after);
    try {
      execFileSync('git', ['diff', '--no-index', '--no-color', 'a', 'b'], { cwd: dir, encoding: 'utf8' });
      return ''; // exit 0 = no differences
    } catch (e: any) {
      if (e.status !== 1) throw e;
      return (e.stdout as string).replaceAll(' a/a/', ' a/').replaceAll(' b/b/', ' b/').replaceAll('--- a/a/', '--- a/').replaceAll('+++ b/b/', '+++ b/');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function fix(v: Verdict, files: CodeFile[]): Promise<Patch> {
  const failing = v.findings.filter((f) => f.result === 'fail');
  if (!failing.length) return { diff: '', fixes: [] };
  const out = await structured(EditsSchema, SYSTEM, `<failed_findings>${JSON.stringify(failing)}</failed_findings>\n\n${renderFiles(files)}`, 'xhigh');
  const touched = files.filter((f) => out.edits.some((e) => e.path === f.path));
  return { diff: unifiedDiff(touched, applyEdits(touched, out.edits)), fixes: out.fixes };
}
