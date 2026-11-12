// Run the drill against a patched copy of the app: start it from the fix worktree, wait until it
// answers, drill it, stop it. Used by `fix --rerun` and `heal` for the red-to-green proof.
import { spawn } from 'node:child_process';
import type { DrillResult } from '../contract.ts';

export async function startApp(cwd: string, command: string, url: string, timeoutMs = 60_000): Promise<() => void> {
  const origin = new URL(url).origin;
  // If the old app still answers here, the rerun would drill the unfixed code and report a false result.
  if (await fetch(origin).then(() => true, () => false)) {
    throw new Error(`Something is already answering on ${origin}. Stop your running app first, or pass --rerun-url with another port.`);
  }
  const proc = spawn(command, { cwd, shell: true, stdio: 'ignore', detached: true });
  const stop = () => { try { process.kill(-proc.pid!, 'SIGTERM'); } catch { /* already gone */ } };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`"${command}" exited with code ${proc.exitCode} before answering on ${origin}`);
    try { await fetch(origin); return stop; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  stop();
  throw new Error(`"${command}" did not answer on ${origin} within ${timeoutMs / 1000}s`);
}

export async function rerunDrill(o: { cwd: string; start: string; forwardTo: string; scenarios: string[]; log?: (l: string) => void }): Promise<DrillResult> {
  const { drill } = await import('../drill.js');
  const stop = await startApp(o.cwd, o.start, o.forwardTo);
  try {
    return await drill({ forwardTo: o.forwardTo, scenarios: o.scenarios, timeoutMs: 120_000, log: o.log ?? (() => {}) });
  } finally {
    stop();
  }
}
