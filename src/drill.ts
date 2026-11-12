// The drill: real sandbox scenarios, then chaos redelivery, then a verdict.
// The AI verdict is Tijil's lane (src/ai). Until it lands, the verdict is the deterministic pass/fail.
import fs from 'node:fs';
import { register } from './registry.js';
import { startRelay, formatDelivery } from './relay/relay.js';
import { runChaos } from './relay/chaos.js';
import { allScenarios, type Scenario } from './scenarios/triggers.js';
import { loadConfig } from './scenarios/yaml.js';
import type { CheckResult, DrillEvent, DrillResult, ScenarioResult } from './contract.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function waitFor(seen: Map<string, DrillEvent>, before: Set<string>, types: string[], timeoutMs: number) {
  return new Promise<Map<string, DrillEvent>>((resolve) => {
    const got = new Map<string, DrillEvent>();
    const check = () => {
      for (const [id, d] of seen) {
        if (!before.has(id) && types.includes(d.event.event_type) && !got.has(d.event.event_type)) got.set(d.event.event_type, d);
      }
      if (types.every((t) => got.has(t))) finish();
    };
    const finish = () => { clearInterval(iv); clearTimeout(to); resolve(got); };
    const iv = setInterval(check, 1_000);
    const to = setTimeout(finish, timeoutMs);
    check();
  });
}

export async function drill(opts: {
  forwardTo: string; scenarios: string[]; timeoutMs: number; simulateAfterMs?: number; log: (l: string) => void;
  registry?: Record<string, Scenario>;
}): Promise<DrillResult> {
  const SCENARIOS = opts.registry ?? await allScenarios();
  const { forwardTo, scenarios, timeoutMs, simulateAfterMs = 45 * 60_000, log } = opts;
  const startedAt = new Date().toISOString();
  log(`Opening a tunnel and registering a sandbox webhook -> ${forwardTo}`);
  const relay = await startRelay({ forwardTo });
  const deliveries: DrillEvent[] = [];
  relay.bus.on('delivery', (d: DrillEvent) => { deliveries.push(d); log(`  ${formatDelivery(d)}`); });
  relay.bus.on('warn', (w: string) => log(`  warn: ${w}`));

  const results: ScenarioResult[] = [];
  let checks: CheckResult[] = [];
  try {
    for (const name of scenarios) {
      const s = SCENARIOS[name];
      log(`\n${name}: ${s.describe}`);
      const before = new Set(relay.seen.keys());
      const entry: ScenarioResult = { scenario: name, expects: s.expects, delivered: {}, error: null, simulated: [] };
      try {
        const out = await s.run((l) => log(`  ${l}`), { waitMs: simulateAfterMs, simulate: (t) => relay.simulate(t) });
        entry.simulated = (out.simulated as string[] | undefined) ?? [];
        const wait = s.timeoutMs ?? timeoutMs;
        const got = await waitFor(relay.seen, before, s.expects, wait);
        for (const t of s.expects) {
          const d = got.get(t);
          entry.delivered[t] = d ? { source: d.source, eventId: d.event.id } : null;
          if (!d) log(`  MISSING ${t}: not delivered within ${wait / 1000}s`);
        }
      } catch (e) {
        entry.error = (e as Error).message;
        log(`  FAILED: ${entry.error}`);
      }
      results.push(entry);
    }
    relay.bus.removeAllListeners('delivery');
    const real = [...relay.seen.values()];
    log('\nChaos: redelivering real events the way production PayPal can');
    checks = await runChaos(forwardTo, real);
    for (const c of checks) {
      log(`  ${c.pass ? 'pass' : 'FAIL'}  ${c.check.padEnd(16)} ${c.eventType} -> ${c.response.status} in ${c.response.ms}ms`);
    }
  } finally {
    await relay.close();
    log('\nWebhook removed, tunnel closed.');
  }

  for (const d of deliveries) {
    checks.unshift({ check: 'real-event', eventType: d.event.event_type, pass: d.response.status >= 200 && d.response.status < 300, response: d.response });
  }
  const delivered = results.flatMap((r) => Object.values(r.delivered));
  return {
    forwardTo, startedAt, finishedAt: new Date().toISOString(), scenarios: results, deliveries, checks,
    delivery: {
      expected: delivered.length,
      live: delivered.filter((d) => d?.source === 'live').length,
      backfilled: delivered.filter((d) => d?.source === 'backfill').length,
      simulated: delivered.filter((d) => d?.source === 'paypal-simulated').length,
      missing: delivered.filter((d) => !d).length,
    },
  };
}

register('drill', {
  describe: 'Real sandbox events plus chaos against your handler: paydrill drill --forward-to <url>',
  async run(args) {
    const cfg = loadConfig();
    const forwardTo = flag(args, 'forward-to') ?? cfg?.forwardTo;
    if (!forwardTo) throw new Error('--forward-to is required (or set forwardTo in paydrill.yml; paydrill init writes it)');
    const registry = await allScenarios();
    const names = (flag(args, 'scenarios') ?? 'payment,refund').split(',');
    for (const n of names) if (!registry[n]) throw new Error(`Unknown scenario "${n}". Try: ${Object.keys(registry).join(', ')}`);
    const result = await drill({
      forwardTo, scenarios: names, log: console.log, registry,
      timeoutMs: Number(flag(args, 'timeout') ?? 120) * 1000,
      simulateAfterMs: Number(flag(args, 'simulate-after') ?? 2700) * 1000,
    });

    const failed = result.checks.filter((c) => !c.pass);
    const failedScenarios = result.scenarios.filter((s) => s.error);
    console.log('\nReport');
    for (const s of failedScenarios) console.log(`  FAIL  scenario ${s.scenario}: ${s.error}`);
    for (const s of result.scenarios) {
      for (const t of s.simulated) console.log(`  SIMULATED  ${t} in ${s.scenario}: sent by PayPal's webhook simulator, not produced by real sandbox money movement`);
    }
    for (const c of failed) console.log(`  FAIL  ${c.check} ${c.eventType}: ${c.response.status}${c.note ? `  (${c.note})` : ''}`);
    const d = result.delivery;
    console.log(`  PayPal delivery: ${d.live} live, ${d.backfilled} rescued by backfill, ${d.simulated} simulated by PayPal, ${d.missing} missing of ${d.expected}`);
    console.log(`  checks: ${result.checks.length - failed.length}/${result.checks.length} passed`);
    const bad = failed.length || failedScenarios.length || d.missing;
    console.log(`  Verdict: ${bad ? 'FIX FIRST' : 'SHIP'} (AI explanations land with Tijil's src/ai)`);
    const out = flag(args, 'out');
    if (out) { fs.writeFileSync(out, JSON.stringify(result, null, 2)); console.log(`  full result: ${out}`); }
    if (bad) process.exitCode = 1;
  },
});
