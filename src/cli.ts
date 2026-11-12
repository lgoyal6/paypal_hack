import { loadEnv } from './env.js';
import { loadFromKeychain } from './keychain.js';
import { commands } from './registry.js';

function help(): void {
  console.log('paydrill: real PayPal sandbox events on localhost, plus an AI drill of your webhook handler\n');
  const names = Object.keys(commands);
  if (!names.length) console.log('  (no commands yet)');
  for (const n of names) console.log(`  paydrill ${n.padEnd(12)} ${commands[n].describe}`);
}

async function main(): Promise<void> {
  loadEnv();
  loadFromKeychain(); // keys init saved to the OS keychain
  await import('./commands.js');
  const [name, ...args] = process.argv.slice(2);
  if (!name && process.stdout.isTTY) {
    // Bare "paydrill": a menu instead of a wall of help.
    const p = await import('@clack/prompts');
    const pick = await p.select({
      message: 'paydrill',
      options: [
        { value: 'init', label: 'Setup', hint: 'keys, route, paydrill.yml' },
        { value: 'drill', label: 'Drill my handler' },
        { value: 'listen', label: 'Listen for events' },
        { value: 'scenarios', label: 'List trigger scenarios' },
        { value: 'help', label: 'All commands' },
      ],
    });
    if (p.isCancel(pick) || pick === 'help') return help();
    return commands[String(pick)].run([]);
  }
  const cmd = name ? commands[name] : undefined;
  if (!cmd) return help();
  await cmd.run(args);
}

main().catch((e: unknown) => {
  const err = e as Error & { status?: number; debugId?: string };
  console.error(`error: ${err.message}${err.debugId ? ` (PayPal debug_id ${err.debugId})` : ''}`);
  process.exit(1);
});
