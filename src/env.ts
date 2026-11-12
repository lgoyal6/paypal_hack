import fs from 'node:fs';
import path from 'node:path';

/** Load .env from the current directory if present. Real environment variables win. */
export function loadEnv(cwd = process.cwd()): void {
  const file = path.join(cwd, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
}

export function requireEnv(...keys: string[]): Record<string, string> {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')}. Put them in .env or export them. See .env.example for the expected variables.`);
  }
  return Object.fromEntries(keys.map((k) => [k, process.env[k] as string]));
}
