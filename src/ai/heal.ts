// Self-healing PRs: when a drill fails in CI, write a fix on a new branch,
// rerun the drill there, and open a PR only if the rerun is green. Never
// pushes to the base branch and never merges; a human reviews.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult, CodeFile, DrillResult, Patch, Verdict } from '../contract.ts';
import { checkKey, decide, verdict } from './verdict.ts';
import { fix } from './fix.ts';
import { applyOnBranch, removeWorktree } from './branch.ts';

export interface HealOptions {
  projectDir: string;
  files: CodeFile[];
  before: DrillResult;
  /** Laksh's drill, run against the patched code in `worktreeDir`. */
  rerun: (worktreeDir: string) => Promise<DrillResult>;
  push?: boolean; // false = local branch only (default true in CI)
}

const mark = (c?: CheckResult) => (!c ? 'not run' : c.pass ? 'pass' : `**fail** (${c.response.status})`);

export function prBody(before: DrillResult, after: DrillResult, v: Verdict, patch: Patch): string {
  const keys = [...new Set([...before.checks, ...after.checks].map(checkKey))];
  const find = (r: DrillResult, k: string) => r.checks.find((c) => checkKey(c) === k);
  const rows = keys.map((k) => `| \`${k}\` | ${mark(find(before, k))} | ${mark(find(after, k))} |`);
  const fixed = keys.filter((k) => !find(before, k)?.pass && find(after, k)?.pass).length;
  return [
    `paydrill found ${before.checks.filter((c) => !c.pass).length} failing webhook checks against real PayPal sandbox events and wrote this fix. The drill was rerun on this branch: ${fixed} fixed, ${after.checks.filter((c) => !c.pass).length} still failing.`,
    '',
    '| Check | Before | After |', '|---|---|---|', ...rows,
    '',
    '### What changed and why',
    ...v.findings.filter((f) => f.result === 'fail').map((f) => `- \`${f.check}\`${f.where ? ` at ${f.where}` : ''}: ${f.evidence}${f.fix ? ` Fix: ${f.fix}` : ''}`),
    '',
    `Addresses: ${patch.fixes.map((x) => `\`${x}\``).join(', ') || 'see diff'}`,
    '',
    'Pass/fail comes from HTTP results of real sandbox deliveries, not from the AI. Review before merging; paydrill never merges.',
  ].join('\n');
}

export async function heal(o: HealOptions) {
  if (decide(o.before) === 'ship') return { status: 'nothing-to-fix' as const };
  const v = await verdict(o.before, null, o.files);
  const patch = await fix(v, o.files);
  if (!patch.diff) return { status: 'no-patch' as const, verdict: v };

  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  const base = git(o.projectDir, 'rev-parse', '--abbrev-ref', 'HEAD');
  const branch = `paydrill/fix-${git(o.projectDir, 'rev-parse', '--short', 'HEAD')}-${Date.now().toString(36)}`;
  const out = applyOnBranch(o.projectDir, patch, branch, `Fix webhook handler (paydrill)\n\n${v.summary}`);
  try {
    const after = await o.rerun(out.worktree);
    const body = prBody(o.before, after, v, patch);
    if (decide(after) !== 'ship') return { status: 'still-failing' as const, branch, body, after };
    if (o.push === false) return { status: 'branch-ready' as const, branch, body, after };
    git(out.worktree, 'push', '-u', 'origin', branch);
    const bodyFile = join(out.root, '..', `${branch.replaceAll('/', '-')}.md`);
    writeFileSync(bodyFile, body);
    const url = execFileSync('gh', ['pr', 'create', '--base', base, '--head', branch, '--title', `paydrill: fix ${patch.fixes.length} failing webhook checks`, '--body-file', bodyFile], { cwd: out.worktree, encoding: 'utf8' }).trim();
    return { status: 'pr-opened' as const, branch, url, body, after };
  } finally {
    removeWorktree(o.projectDir, out.root);
  }
}
