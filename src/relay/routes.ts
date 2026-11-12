// Multi-app routing: send each event type to the right endpoint, e.g. disputes to /webhooks/disputes.
// Sources, later wins: paydrill.yml `routes:` then `--route PATTERN=URL` flags (repeatable). First matching pattern wins.
import { loadConfig } from '../scenarios/yaml.js';

export interface Route { pattern: string; to: string; re: RegExp }

const toRe = (p: string) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

export function parseRoutes(yamlRoutes: Record<string, string> | undefined, argv: string[]): Route[] {
  const out: Route[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--route') continue;
    const spec = argv[i + 1] ?? '';
    const eq = spec.indexOf('=');
    if (eq < 1 || !/^https?:\/\//.test(spec.slice(eq + 1))) throw new Error(`--route "${spec}" must look like CUSTOMER.DISPUTE.*=http://localhost:3000/webhooks/disputes`);
    out.push({ pattern: spec.slice(0, eq), to: spec.slice(eq + 1), re: toRe(spec.slice(0, eq)) });
  }
  for (const [pattern, to] of Object.entries(yamlRoutes ?? {})) {
    if (!/^https?:\/\//.test(String(to))) throw new Error(`paydrill.yml routes: "${pattern}" must map to a URL`);
    out.push({ pattern, to: String(to), re: toRe(pattern) });
  }
  return out;
}

let cached: Route[] | null = null;
export function routes(): Route[] {
  if (!cached) cached = parseRoutes((loadConfig() as { routes?: Record<string, string> } | null)?.routes, process.argv);
  return cached;
}
export function setRoutes(r: Route[]): void { cached = r; }

/** Where this event goes: the first matching route, else the default forward URL. */
export function target(eventType: string, fallback: string): string {
  return routes().find((r) => r.re.test(eventType))?.to ?? fallback;
}
