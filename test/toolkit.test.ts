import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findToolkitSkill } from '../src/ai/toolkit.ts';

test('finds an installed PayPal skill and ignores other plugins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
  fs.mkdirSync(path.join(root, 'cache/other/skills/x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cache/other/skills/x/SKILL.md'), 'unrelated');
  assert.equal(findToolkitSkill([root]), null);
  fs.mkdirSync(path.join(root, 'cache/paypal/skills/paypal-best-practices'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cache/paypal/skills/paypal-best-practices/SKILL.md'), '# PayPal best practices\nAlways verify webhook signatures.');
  const s = findToolkitSkill([root])!;
  assert.match(s.path, /paypal-best-practices/);
  assert.match(s.text, /verify webhook signatures/);
});
