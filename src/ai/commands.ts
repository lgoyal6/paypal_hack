// The AI-lane commands, registered into Laksh's CLI (src/registry.ts).
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { register } from '../registry.ts';
import { paypal } from '../paypal/client.ts';
import type { CheckResult, DrillResult, ParityResult } from '../contract.ts';
import { stringify } from 'yaml';
import { readCodeFiles } from './llm.ts';
import { decide, verdict } from './verdict.ts';
import { heal } from './heal.ts';
import { rerunDrill } from './rerun.ts';
import { newScenario, saveScenario } from './scenario.ts';
import { fix } from './fix.ts';
import { applyOnBranch } from './branch.ts';
import { doctor } from './doctor.ts';
import { draftEvidence } from './evidence.ts';
import { ask, runPlan } from './ask.ts';
import { formatReadiness, readiness } from './shopper.ts';
import { coverage, formatCoverage, handledEvents, writeCoverage } from '../coverage/index.ts';
import { run as types } from '../types-gen/index.ts';
import { formatInventory, inventory } from '../migrate/inventory.ts';
import { migrate } from '../migrate/run.ts';
import { formatCounts } from '../migrate/report.ts';

const flag = (args: string[], name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (args: string[], name: string) => args.includes(`--${name}`);
/** First argument that is neither a --flag nor a flag's value. */
const positional = (args: string[]) => args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const json = <T>(p?: string): T | null => (p ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim()); } finally { rl.close(); }
}

/** Claude's explanation of a drill, printed under the deterministic verdict. Used by `drill --project` and `explain`. */
export async function explain(result: DrillResult, projectDir: string) {
  const v = await verdict(result, null, readCodeFiles(projectDir));
  console.log(`\nClaude: ${v.summary}`);
  for (const f of v.findings.filter((x) => x.result !== 'pass')) {
    console.log(`  ${f.result.toUpperCase().padEnd(4)}  ${f.check}${f.where ? `  (${f.where})` : ''}\n        ${f.evidence}${f.fix ? `\n        fix: ${f.fix}` : ''}`);
  }
  return v;
}

register('explain', {
  describe: 'Claude explains a saved drill down to file and line: paydrill explain --drill result.json [dir]',
  async run(args) {
    const r = json<DrillResult>(flag(args, 'drill'));
    if (!r) throw new Error('--drill <result.json> is required (from paydrill drill --out)');
    await explain(r, positional(args) ?? '.');
  },
});

/** Rerun options shared by fix --rerun and heal: how to start the patched app, and where it listens. */
function rerunOptions(args: string[], r: DrillResult) {
  const start = flag(args, 'start');
  if (!start) return null;
  const forwardTo = flag(args, 'rerun-url') ?? r.forwardTo;
  const scenarios = r.scenarios.map((s) => s.scenario);
  return (cwd: string) => rerunDrill({ cwd, start, forwardTo, scenarios: scenarios.length ? scenarios : ['payment', 'refund'], log: console.log });
}

function printRedGreen(before: DrillResult, after: DrillResult) {
  const key = (c: CheckResult) => `${c.check}:${c.eventType}`;
  console.log('\nBefore -> after');
  for (const k of [...new Set([...before.checks, ...after.checks].map(key))]) {
    const b = before.checks.find((c) => key(c) === k), a = after.checks.find((c) => key(c) === k);
    const show = (c?: CheckResult) => (!c ? 'not run' : c.pass ? 'pass' : `FAIL ${c.response.status}`);
    console.log(`  ${k.padEnd(48)} ${show(b).padEnd(9)} -> ${show(a)}`);
  }
}

register('fix', {
  describe: 'Fix a failed drill on a new branch, optionally prove it: paydrill fix --drill result.json [dir] [--start "npm start"] [--rerun-url url]',
  async run(args) {
    const r = json<DrillResult>(flag(args, 'drill'));
    if (!r) throw new Error('--drill <result.json> is required (from paydrill drill --out)');
    const dir = positional(args) ?? '.';
    const files = readCodeFiles(dir);
    const v = await explain(r, dir);
    if (v.verdict === 'ship') return console.log('\nNothing to fix.');
    const patch = await fix(v, files);
    if (!patch.diff) return console.log('\nClaude proposed no change.');
    const out = applyOnBranch(dir, patch, `paydrill/fix-${Date.now().toString(36)}`, `Fix webhook handler (paydrill)\n\n${v.summary}`);
    console.log(`\n${patch.diff}\nFix committed on branch ${out.branch} (your working tree is untouched).`);
    const rerun = rerunOptions(args, r);
    if (!rerun) return console.log(`Prove it: add --start "<command that starts your app>" to rerun the drill on the fix, or start it from ${out.worktree} and run paydrill drill again.`);
    console.log(`\nRerunning the drill against the fix (${out.worktree})...`);
    const after = await rerun(out.worktree);
    printRedGreen(r, after);
    const green = decide(after) === 'ship';
    console.log(green ? '\nGreen: the fix passes every check.' : '\nStill failing: see the checks above.');
    if (!green) process.exitCode = 1;
  },
});

register('heal', {
  describe: 'Self-healing PR: fix on a branch, rerun the drill there, open a PR only if green: paydrill heal --drill result.json --start "npm start" [dir] [--no-push]',
  async run(args) {
    const r = json<DrillResult>(flag(args, 'drill'));
    if (!r) throw new Error('--drill <result.json> is required (from paydrill drill --out)');
    const rerun = rerunOptions(args, r);
    if (!rerun) throw new Error('--start "<command that starts your app>" is required: heal must rerun the drill before opening a PR');
    const dir = positional(args) ?? '.';
    const out = await heal({ projectDir: dir, files: readCodeFiles(dir), before: r, rerun, push: !has(args, 'no-push') });
    if ('after' in out && out.after) printRedGreen(r, out.after);
    const msg: Record<string, string> = {
      'nothing-to-fix': 'The drill already passes; nothing to heal.',
      'no-patch': 'Claude proposed no change.',
      'still-failing': `The fix on ${'branch' in out ? out.branch : ''} still fails the drill, so no PR was opened.`,
      'branch-ready': `Green. Fix is on branch ${'branch' in out ? out.branch : ''} (not pushed: --no-push).`,
      'pr-opened': `Green. Opened ${'url' in out ? out.url : ''}. paydrill never merges; review it.`,
    };
    console.log(`\n${msg[out.status]}`);
    if (out.status === 'still-failing') process.exitCode = 1;
  },
});

register('new', {
  describe: 'Claude writes a paydrill.yml scenario from plain English: paydrill new "subscription that fails payment twice"',
  async run(args) {
    const text = args.filter((a) => !a.startsWith('--')).join(' ');
    if (!text) throw new Error('usage: paydrill new "<what the scenario should do>"');
    const s = await newScenario(text);
    console.log(stringify({ scenarios: { [s.name]: (({ name, ...rest }) => rest)(s) } }));
    if (has(args, 'yes') || (await confirm(`Add "${s.name}" to paydrill.yml?`))) console.log(`saved to ${saveScenario(s)}; run it with paydrill trigger ${s.name}`);
  },
});

register('doctor', {
  describe: 'Static review; risks a drill proved are marked PROVEN: paydrill doctor [dir] [--drill result.json]',
  async run(args) {
    const dir = positional(args) ?? '.';
    const r = json<DrillResult>(flag(args, 'drill'));
    const files = readCodeFiles(dir);
    console.log((await doctor(files, r ? await verdict(r, null, files) : null)).text);
  },
});

register('coverage', {
  describe: 'Which PayPal event types you handle and a drill exercised: paydrill coverage [dir] [--drill result.json] [--write]',
  async run(args) {
    const { map, via } = await handledEvents(readCodeFiles(positional(args) ?? '.'));
    const c = coverage(map, json<DrillResult>(flag(args, 'drill')));
    console.log(formatCoverage(c) + (via === 'ai' ? '\n(handled types found by Claude: no event type strings in the code)' : ''));
    if (has(args, 'write')) { writeCoverage(c); console.log('wrote coverage.json and payment-coverage.svg'); }
  },
});

register('types', {
  describe: 'TS types + zod validators from recorded events, with drift alerts: paydrill types <eventsDir> [--out dir]',
  async run(args) {
    const r = types(positional(args) ?? 'fixtures/events', flag(args, 'out') ?? '.');
    console.log(`wrote paypal-events.ts and paypal-events.zod.ts for ${r.types} event types`);
    for (const d of r.drifts) console.log(`DRIFT ${d.eventType} ${d.change}: ${d.detail}`);
    if (r.drifts.length) process.exitCode = 1;
  },
});

register('inventory', {
  describe: 'List every Stripe usage with file and line, classified (no AI): paydrill inventory [dir]',
  async run(args) { console.log(formatInventory(inventory(readCodeFiles(positional(args) ?? '.')))); },
});

register('migrate', {
  describe: 'Move a Stripe app to PayPal on a new branch, with an honest report: paydrill migrate [dir] [--plan]',
  async run(args) {
    const r = await migrate(positional(args) ?? '.', {
      plan: has(args, 'plan'), allowPartial: has(args, 'allow-partial'),
      parity: json<ParityResult[]>(flag(args, 'parity')) ?? undefined,
    });
    if (has(args, 'plan')) { console.log(r.diff); fs.writeFileSync('MIGRATION_REPORT.md', r.report); console.log('wrote MIGRATION_REPORT.md'); }
    else console.log(`changes and MIGRATION_REPORT.md are on branch ${r.branch}`);
    console.log(formatCounts(r.entries));
    process.exitCode = r.exitCode;
  },
});

register('evidence', {
  describe: 'Claude drafts dispute evidence from your order record: paydrill evidence <disputeId> --order order.json [--submit]',
  async run(args) {
    const id = positional(args);
    const order = json<Record<string, unknown>>(flag(args, 'order'));
    if (!id || !order) throw new Error('usage: paydrill evidence <disputeId> --order order.json [--submit]');
    const packet = await draftEvidence(await paypal.getDispute(id), order);
    console.log(packet.notes);
    for (const d of packet.documents) { fs.writeFileSync(d.name, Buffer.from(d.base64, 'base64')); console.log(`wrote ${d.name}`); }
    if (has(args, 'submit') && (await confirm(`Submit this evidence to sandbox dispute ${id}?`))) {
      await paypal.submitEvidence(id, packet);
      console.log('Evidence submitted.');
    }
  },
});

register('ask', {
  describe: 'Plain English to real sandbox calls, confirmed first: paydrill ask "pay $20 then refund it"',
  async run(args) {
    const text = args.filter((a) => !a.startsWith('--')).join(' ');
    if (!text) throw new Error('usage: paydrill ask "<what to do in the sandbox>"');
    const plan = await ask(text);
    const out = await runPlan(plan, paypal, async (summary, steps) => {
      console.log(`${summary}\n${steps.map((s) => `  ${s}`).join('\n')}`);
      return confirm('Run these against the PayPal sandbox?');
    });
    console.log(out ? JSON.stringify(out, null, 2) : plan.steps.length ? 'Cancelled.' : plan.summary);
  },
});

register('ready', {
  describe: 'Can an AI shopping agent buy from your store? paydrill ready <storeUrl> [--goal "..."]',
  async run(args) {
    const url = positional(args);
    if (!url) throw new Error('usage: paydrill ready <storeUrl> [--goal "..."]');
    console.log(formatReadiness(await readiness(url, flag(args, 'goal') ?? 'Buy the cheapest blue mug under $20')));
  },
});
