import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEdits, unifiedDiff } from './fix.ts';
import { applyOnBranch, removeWorktree } from './branch.ts';

const files = [{ path: 'src/hook.js', text: "const amt = r.amount.value;\nres.sendStatus(200);\n" }];

test('applyEdits rejects missing or ambiguous finds', () => {
  assert.throws(() => applyEdits(files, [{ path: 'src/hook.js', find: 'nope', replace: '' }]), /missing/);
  assert.throws(() => applyEdits([{ path: 'a', text: 'x x' }], [{ path: 'a', find: 'x', replace: 'y' }]), /not unique/);
});

test('diff applies on a new branch in a worktree, leaving the working tree alone', () => {
  const repo = mkdtempSync(join(tmpdir(), 'paydrill-repo-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  mkdirSync(join(repo, 'app/src'), { recursive: true });
  writeFileSync(join(repo, 'app/src/hook.js'), files[0].text);
  g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');

  const after = applyEdits(files, [{ path: 'src/hook.js', find: 'r.amount.value', replace: 'r.dispute_amount.value' }]);
  const diff = unifiedDiff(files, after);
  assert.match(diff, /^--- a\/src\/hook\.js$/m);
  const out = applyOnBranch(join(repo, 'app'), { diff, fixes: ['x'] }, 'paydrill/fix-test', 'Fix dispute amount');
  assert.match(readFileSync(join(out.worktree, 'src/hook.js'), 'utf8'), /dispute_amount/);
  assert.match(readFileSync(join(repo, 'app/src/hook.js'), 'utf8'), /r\.amount\.value/); // untouched
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  removeWorktree(repo, out.root);
});
