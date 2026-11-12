// Plugins: each .js/.mjs file in ./.paydrill/commands/ becomes `paydrill <filename>`.
// A plugin exports `describe` (string) and `run(args, ctx)`; ctx gives it the PayPal client and the relay.
//
//   // .paydrill/commands/refund-latest.mjs
//   export const describe = 'Refund the most recent sandbox capture';
//   export async function run(args, { paypal }) { ... }
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { commands, register } from './registry.js';
import { paypal } from './paypal/client.js';
import { startRelay, forward } from './relay/relay.js';

export const pluginContext = { paypal, startRelay, forward };

export async function loadPlugins(dir = path.join(process.cwd(), '.paydrill', 'commands')): Promise<string[]> {
  if (!fs.existsSync(dir)) return [];
  const loaded: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => /\.m?js$/.test(f)).sort()) {
    const name = file.replace(/\.m?js$/, '');
    if (commands[name]) throw new Error(`Plugin ${file} would replace the built-in "paydrill ${name}"; rename it`);
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    if (typeof mod.run !== 'function') throw new Error(`Plugin ${file} must export run(args, ctx)`);
    register(name, { describe: `${mod.describe ?? 'plugin'} (plugin)`, run: (args) => mod.run(args, pluginContext) });
    loaded.push(name);
  }
  return loaded;
}
