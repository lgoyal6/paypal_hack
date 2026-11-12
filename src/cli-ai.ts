// Runner for the AI-lane commands until Laksh's `bin/paydrill` wires them in.
//   node --experimental-strip-types src/cli-ai.ts <command> [args]
import { readFileSync, writeFileSync } from 'node:fs';
import { readCodeFiles } from './ai/llm.ts';
import { doctor } from './ai/doctor.ts';
import { coverage, formatCoverage, handledEvents, writeCoverage } from './coverage/index.ts';
import { run as types } from './types-gen/index.ts';
import { formatInventory, inventory } from './migrate/inventory.ts';
import { migrate } from './migrate/run.ts';
import { formatCounts } from './migrate/report.ts';
import { formatReadiness, readiness } from './ai/shopper.ts';
import type { DrillResult, ParityResult } from './contract.ts';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(`--${name}`);
const dir = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? '.';
const json = <T>(p?: string): T | null => (p ? JSON.parse(readFileSync(p, 'utf8')) : null);

const USAGE = `usage: cli-ai <command> [dir] [options]
  doctor   [dir] [--verdict verdict.json]           static review, risks proven by a drill marked
  coverage [dir] [--drill drill.json] [--write]      handled vs exercised PayPal event types
  types    <eventsDir> [--out dir]                   TS types + zod validators + drift alerts
  inventory [dir]                                    Stripe usage, classified (no AI)
  migrate  [dir] [--plan] [--parity parity.json] [--allow-partial]
  ready    <storeUrl> [--goal "..."]                 agent-readiness test`;

switch (cmd) {
  case 'doctor': {
    const r = await doctor(readCodeFiles(dir), json(flag('verdict')));
    console.log(r.text);
    break;
  }
  case 'coverage': {
    const { map, via } = await handledEvents(readCodeFiles(dir));
    const c = coverage(map, json<DrillResult>(flag('drill')));
    console.log(formatCoverage(c) + (via === 'ai' ? '\n(handled types found by AI: no event type literals in the code)' : ''));
    if (has('write')) writeCoverage(c);
    break;
  }
  case 'types': {
    const r = types(dir, flag('out') ?? '.');
    console.log(`wrote paypal-events.ts and paypal-events.zod.ts for ${r.types} event types`);
    for (const d of r.drifts) console.log(`DRIFT ${d.eventType} ${d.change}: ${d.detail}`);
    if (r.drifts.length) process.exitCode = 1;
    break;
  }
  case 'inventory':
    console.log(formatInventory(inventory(readCodeFiles(dir))));
    break;
  case 'migrate': {
    const r = await migrate(dir, { plan: has('plan'), allowPartial: has('allow-partial'), parity: json<ParityResult[]>(flag('parity')) ?? undefined });
    if (has('plan')) { console.log(r.diff); writeFileSync('MIGRATION_REPORT.md', r.report); } else console.log(`branch: ${r.branch}`);
    console.log(formatCounts(r.entries));
    process.exitCode = r.exitCode;
    break;
  }
  case 'ready': {
    console.log(formatReadiness(await readiness(dir, flag('goal') ?? 'Buy the cheapest blue mug under $20')));
    break;
  }
  default:
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
}
