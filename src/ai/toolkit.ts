// If PayPal's official AI-Toolkit plugin is installed (Claude Code, Cursor or Codex), find its
// best-practices skill so `doctor` can review against PayPal's own guidance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOTS = ['.claude/plugins', '.cursor/plugins', '.codex/plugins', '.codex'].map((r) => path.join(os.homedir(), r));

function* walk(dir: string, depth: number): Generator<string> {
  if (depth < 0 || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') yield* walk(p, depth - 1);
    else if (e.isFile() && e.name === 'SKILL.md') yield p;
  }
}

/** The PayPal skill text (capped), with where it came from; null when the toolkit is not installed. */
export function findToolkitSkill(roots = ROOTS, maxChars = 40_000): { path: string; text: string } | null {
  for (const root of roots) {
    for (const file of walk(root, 8)) {
      if (!/paypal/i.test(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (/paypal/i.test(text)) return { path: file, text: text.slice(0, maxChars) };
    }
  }
  return null;
}
