// paydrill as an MCP server, so Claude Code, Cursor or Codex can trigger real sandbox events and run drills.
// Sits next to PayPal's own MCP: theirs moves money, this one tests your code.
// stdout belongs to the MCP protocol; every human log goes to stderr.
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { register } from '../registry.js';
import { allScenarios } from '../scenarios/triggers.js';
import { listPool } from '../scenarios/disputes.js';
import { paypal } from '../paypal/client.js';
import { drill } from '../drill.js';
import { loadConfig } from '../scenarios/yaml.js';

const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] });

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'paydrill', version: '0.0.1' });

  server.registerTool('list_scenarios', {
    title: 'List paydrill scenarios',
    description: 'Built-in and paydrill.yml scenarios, with the PayPal webhook events each one produces.',
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const all = await allScenarios();
      return json(Object.fromEntries(Object.entries(all).map(([k, s]) => [k, { describe: s.describe, expects: s.expects }])));
    } catch (e) { return fail(e); }
  });

  server.registerTool('trigger', {
    title: 'Trigger a real sandbox scenario',
    description: 'Creates real PayPal sandbox money movement (payments, refunds, chargebacks). Sandbox only. Events go to whatever webhook is registered, e.g. a running "paydrill listen".',
    inputSchema: { scenario: z.string().describe('Scenario name from list_scenarios') },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async ({ scenario }) => {
    try {
      const all = await allScenarios();
      const s = all[scenario];
      if (!s) throw new Error(`Unknown scenario "${scenario}". Known: ${Object.keys(all).join(', ')}`);
      const log: string[] = [];
      const result = await s.run((l) => { log.push(l); console.error(l); });
      return json({ scenario, expects: s.expects, log, result });
    } catch (e) { return fail(e); }
  });

  server.registerTool('drill', {
    title: 'Drill a webhook handler',
    description: 'Opens a tunnel, registers a temporary sandbox webhook, runs real scenarios against the handler, then duplicate, out-of-order, forged and unknown-type redeliveries. Pass/fail comes from HTTP results only. Takes minutes.',
    inputSchema: {
      forwardTo: z.string().url().optional().describe('Handler URL; defaults to forwardTo in paydrill.yml'),
      scenarios: z.array(z.string()).default(['payment', 'refund']),
      timeoutSeconds: z.number().int().positive().default(120),
    },
    annotations: { openWorldHint: true },
  }, async ({ forwardTo, scenarios, timeoutSeconds }) => {
    try {
      const target = forwardTo ?? loadConfig()?.forwardTo;
      if (!target) throw new Error('forwardTo is required (or set it in paydrill.yml)');
      const result = await drill({ forwardTo: target, scenarios, timeoutMs: timeoutSeconds * 1000, log: (l) => console.error(l) });
      const failed = result.checks.filter((c) => !c.pass);
      return json({
        verdict: failed.length || result.delivery.missing || result.scenarios.some((s) => s.error) ? 'fix-first' : 'ship',
        failed, delivery: result.delivery, scenarios: result.scenarios,
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool('list_events', {
    title: 'Recent sandbox webhook events',
    description: 'Events PayPal recorded for this sandbox app (only while a webhook was registered).',
    inputSchema: { sinceMinutes: z.number().int().positive().default(60) },
    annotations: { readOnlyHint: true },
  }, async ({ sinceMinutes }) => {
    try {
      const ev = await paypal.listEvents(new Date(Date.now() - sinceMinutes * 60_000).toISOString());
      return json(ev.map((e) => ({ id: e.id, type: e.event_type, time: e.create_time, resource: e.resource?.id ?? e.resource?.dispute_id })));
    } catch (e) { return fail(e); }
  });

  server.registerTool('dispute_pool', {
    title: 'Dispute pool status',
    description: 'Open sandbox disputes and whether each can be adjudicated now (ready for a real CUSTOMER.DISPUTE.RESOLVED).',
    annotations: { readOnlyHint: true },
  }, async () => {
    try { return json(await listPool()); } catch (e) { return fail(e); }
  });

  // ---------- AI lane: explain and fix a drill (Claude via API key, or the user's Claude Code) ----------
  const drillResult = z.string().describe('Path to a drill result JSON (paydrill drill --out result.json)');
  const project = z.string().default('.').describe('Project directory with the webhook handler');

  server.registerTool('explain', {
    title: 'Explain a drill',
    description: 'Claude explains each failed check with the file and line responsible and a one-line fix. Pass/fail is not changed; it comes from the drill.',
    inputSchema: { drillResult, project },
    annotations: { readOnlyHint: true },
  }, async ({ drillResult: file, project: dir }) => {
    try {
      const { verdict } = await import('../ai/verdict.js');
      const { readCodeFiles } = await import('../ai/llm.js');
      return json(await verdict(JSON.parse(fs.readFileSync(file, 'utf8')), null, readCodeFiles(dir)));
    } catch (e) { return fail(e); }
  });

  server.registerTool('fix', {
    title: 'Fix a failed drill on a new branch',
    description: 'Claude writes a patch for the failed checks and commits it on a new branch in a separate git worktree. The working tree is not touched and nothing is merged.',
    inputSchema: { drillResult, project },
    annotations: { destructiveHint: false },
  }, async ({ drillResult: file, project: dir }) => {
    try {
      const { verdict } = await import('../ai/verdict.js');
      const { fix } = await import('../ai/fix.js');
      const { applyOnBranch } = await import('../ai/branch.js');
      const { readCodeFiles } = await import('../ai/llm.js');
      const files = readCodeFiles(dir);
      const v = await verdict(JSON.parse(fs.readFileSync(file, 'utf8')), null, files);
      if (v.verdict === 'ship') return json({ verdict: v, patch: null, note: 'Nothing to fix.' });
      const patch = await fix(v, files);
      if (!patch.diff) return json({ verdict: v, patch: null, note: 'Claude proposed no change.' });
      const out = applyOnBranch(dir, patch, `paydrill/fix-${Date.now().toString(36)}`, `Fix webhook handler (paydrill)\n\n${v.summary}`);
      return json({ verdict: v, diff: patch.diff, branch: out.branch, worktree: out.worktree });
    } catch (e) { return fail(e); }
  });

  return server;
}

register('mcp', {
  describe: 'Run paydrill as an MCP server over stdio (for Claude Code, Cursor, Codex)',
  async run() {
    await buildServer().connect(new StdioServerTransport());
    console.error('paydrill MCP server ready on stdio');
    await new Promise(() => {});
  },
});
