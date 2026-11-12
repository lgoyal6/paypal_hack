import { loadEnv } from './env.js';
import { commands } from './registry.js';

function help(): void {
  console.log('paydrill: real PayPal sandbox events on localhost, plus an AI drill of your webhook handler\n');
  const names = Object.keys(commands);
  if (!names.length) console.log('  (no commands yet)');
  for (const n of names) console.log(`  paydrill ${n.padEnd(12)} ${commands[n].describe}`);
}

async function main(): Promise<void> {
  loadEnv();
  await import('./commands.js');
  const [name, ...args] = process.argv.slice(2);
  const cmd = name ? commands[name] : undefined;
  if (!cmd) return help();
  await cmd.run(args);
}

main().catch((e: unknown) => {
  const err = e as Error & { status?: number; debugId?: string };
  console.error(`error: ${err.message}${err.debugId ? ` (PayPal debug_id ${err.debugId})` : ''}`);
  process.exit(1);
});
