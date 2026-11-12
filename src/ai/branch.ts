// Patches land on a new branch in a separate git worktree, never in the
// user's working tree and never on main.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Patch } from '../contract.ts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export interface PatchedBranch { branch: string; worktree: string; commit: string }

/** Create `branch` from HEAD in a new worktree, apply and commit the patch there. */
export function applyOnBranch(repo: string, patch: Patch, branch: string, message: string): PatchedBranch {
  if (!patch.diff) throw new Error('Empty patch: nothing to apply');
  const top = git(repo, 'rev-parse', '--show-toplevel');
  // Patch paths are relative to the project dir the files were read from.
  const prefix = git(repo, 'rev-parse', '--show-prefix');
  const worktree = mkdtempSync(join(tmpdir(), 'paydrill-fix-'));
  git(top, 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD');
  const file = join(worktree, '.paydrill.patch');
  writeFileSync(file, patch.diff);
  const dirArgs = prefix ? ['--directory', prefix.replace(/\/$/, '')] : [];
  git(worktree, 'apply', '--whitespace=nowarn', ...dirArgs, file);
  execFileSync('rm', [file]);
  git(worktree, 'add', '-A');
  git(worktree, '-c', 'user.name=paydrill', '-c', 'user.email=paydrill@users.noreply.github.com', 'commit', '-q', '-m', message);
  return { branch, worktree: join(worktree, prefix), commit: git(worktree, 'rev-parse', 'HEAD') };
}

/** Remove the worktree (the branch and its commit stay). */
export function removeWorktree(repo: string, worktree: string) {
  git(repo, 'worktree', 'remove', '--force', worktree);
}
