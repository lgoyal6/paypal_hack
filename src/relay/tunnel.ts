// Public HTTPS URL for a local port via a Cloudflare quick tunnel (open source cloudflared, no account).
import { spawn } from 'node:child_process';

export interface Tunnel { url: string; close(): void }

export function openTunnel(port: number, timeoutMs = 30_000): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('cloudflared did not report a tunnel URL within 30s'));
    }, timeoutMs);
    const onData = (buf: Buffer) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0], close: () => proc.kill() });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new Error('cloudflared not found. Install it: brew install cloudflared') : e);
    });
  });
}

/**
 * Give a fresh quick tunnel time to route before PayPal starts sending to it.
 * We deliberately do not resolve the hostname ourselves first: an early lookup gets a
 * negative DNS answer that the local resolver caches, which made a working tunnel look dead.
 */
export function settle(ms = 8_000): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
