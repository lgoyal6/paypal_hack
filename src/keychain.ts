// Sandbox keys in the OS keychain: macOS `security`, Linux `secret-tool` (libsecret).
// Callers fall back to a .env file readable only by the user when neither is available.
import { execFileSync } from 'node:child_process';

const SERVICE = 'paydrill';
const run = (cmd: string, args: string[], input?: string) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], input }).trim();

function tool(): 'security' | 'secret-tool' | null {
  for (const t of process.platform === 'darwin' ? ['security'] : process.platform === 'linux' ? ['secret-tool'] : []) {
    try { execFileSync('which', [t], { stdio: 'ignore' }); return t as 'security' | 'secret-tool'; } catch { /* not installed */ }
  }
  return null;
}

export const keychainAvailable = () => tool() !== null && process.env.PAYDRILL_NO_KEYCHAIN !== '1';

export function keychainSet(key: string, value: string): void {
  const t = tool();
  if (t === 'security') run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', key, '-w', value]);
  else if (t === 'secret-tool') run('secret-tool', ['store', '--label', `paydrill ${key}`, 'service', SERVICE, 'key', key], value);
  else throw new Error('No OS keychain available');
}

export function keychainGet(key: string): string | undefined {
  try {
    const t = tool();
    if (t === 'security') return run('security', ['find-generic-password', '-s', SERVICE, '-a', key, '-w']) || undefined;
    if (t === 'secret-tool') return run('secret-tool', ['lookup', 'service', SERVICE, 'key', key]) || undefined;
  } catch { /* not stored */ }
  return undefined;
}

/** Fill missing env vars from the keychain. Environment and .env still win. */
export function loadFromKeychain(keys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'ANTHROPIC_API_KEY']): void {
  if (process.env.PAYDRILL_NO_KEYCHAIN === '1') return;
  for (const k of keys) if (!process.env[k]) { const v = keychainGet(k); if (v) process.env[k] = v; }
}
