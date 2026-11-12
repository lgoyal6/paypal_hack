import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderComment, verdictOf, COMMENT_MARKER } from '../src/report/markdown.js';
import type { DrillResult } from '../src/contract.js';

// A real drill result from the sandbox (payment + refund against an accept-everything receiver).
const real: DrillResult = JSON.parse(fs.readFileSync('test/data/drill-result.json', 'utf8'));

test('real result: forged payment is the headline failure', () => {
  const md = renderComment(real);
  assert.equal(verdictOf(real), 'fix-first');
  assert.ok(md.startsWith(COMMENT_MARKER), 'marker lets the action update its own comment');
  assert.match(md, /### paydrill: fix first/);
  assert.match(md, /\| ❌ \| forged-unsigned \| `PAYMENT\.CAPTURE\.COMPLETED` \| 200 in \d+ms \|/);
  assert.match(md, /10\/11 checks passed/);
  assert.match(md, /<summary>Passed checks<\/summary>/);
  assert.match(md, /0 simulated by PayPal/, 'older results without a simulated count read as 0');
});

test('simulated deliveries are always called out', () => {
  const r: DrillResult = structuredClone(real);
  r.checks = r.checks.filter((c) => c.pass);
  r.scenarios = [{ scenario: 'dispute-lost', expects: ['CUSTOMER.DISPUTE.RESOLVED'], delivered: {}, error: null, simulated: ['CUSTOMER.DISPUTE.RESOLVED'] }];
  r.delivery = { expected: 1, live: 0, backfilled: 0, simulated: 1, missing: 0 };
  const md = renderComment(r, { coverage: { handled: 6, total: 23 } });
  assert.match(md, /ship it/);
  assert.match(md, /Simulated by PayPal's webhook simulator, not real sandbox money movement: CUSTOMER\.DISPUTE\.RESOLVED \(dispute-lost\)/);
  assert.match(md, /Payment coverage: 6\/23/);
});

test('pipes in error text cannot break the table', () => {
  const r: DrillResult = structuredClone(real);
  r.scenarios = [{ scenario: 'x', expects: [], delivered: {}, error: 'a | b\nc', simulated: [] }];
  assert.match(renderComment(r), /a \\\| b c/);
});
