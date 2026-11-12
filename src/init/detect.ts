// Find the developer's framework, port and PayPal webhook route without asking.
import fs from 'node:fs';
import path from 'node:path';

export interface Detection {
  framework: string | null;
  port: number;
  route: string | null;
  routeWhere: string | null; // "file:line"
  forwardTo: string | null;
}

const SKIP = /node_modules|\.git|dist|build|\.next|venv|\.venv|__pycache__/;
const DEFAULT_PORT: Record<string, number> = {
  next: 3000, express: 3000, fastify: 3000, hono: 3000, koa: 3000, fastapi: 8000, django: 8000, flask: 5000,
};

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function detectFramework(dir: string): string | null {
  const pkg = readJson(path.join(dir, 'package.json'));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  for (const f of ['next', 'express', 'fastify', 'hono', 'koa']) if (deps?.[f]) return f;
  const py = ['requirements.txt', 'pyproject.toml']
    .map((f) => path.join(dir, f)).filter(fs.existsSync).map((f) => fs.readFileSync(f, 'utf8').toLowerCase()).join('\n');
  for (const f of ['fastapi', 'django', 'flask']) if (py.includes(f)) return f;
  return null;
}

function* files(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) yield* files(p);
    else if (/\.(js|mjs|cjs|ts|tsx|py)$/.test(e.name)) yield p;
  }
}

// Route registrations that look like a PayPal webhook: app.post('/webhooks/paypal'), @app.post("/paypal/webhook"), path('paypal/webhook/', ...)
const ROUTE = /(?:\.(?:post|all|route)\s*\(\s*|@\w+\.(?:post|route)\(\s*|path\(\s*)(['"`])([^'"`]*(?:paypal|webhook)[^'"`]*)\1/i;
const LISTEN = /(?:\.listen\(\s*|PORT\s*(?:\|\||\?\?|=)\s*|port\s*=\s*|--port[ =])(\d{4,5})/;

export function detect(dir = process.cwd()): Detection {
  const framework = detectFramework(dir);
  let route: string | null = null;
  let routeWhere: string | null = null;
  let port: number | null = null;
  let best = -1;
  for (const f of files(dir)) {
    const rel = path.relative(dir, f);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    // Next.js app router: app/api/.../route.ts with a POST export is the route itself.
    const next = rel.match(/^(?:src\/)?app\/(.*)\/route\.(?:ts|js)$/);
    if (next && /export\s+(?:async\s+)?function\s+POST/.test(lines.join('\n')) && /paypal|webhook/i.test(rel)) {
      const score = (/paypal/i.test(rel) ? 2 : 0) + (/webhook/i.test(rel) ? 1 : 0);
      if (score > best) { best = score; route = '/' + next[1].replace(/\([^)]*\)\//g, ''); routeWhere = `${rel}:1`; }
    }
    lines.forEach((line, i) => {
      const m = line.match(ROUTE);
      if (m) {
        const r = m[2].startsWith('/') ? m[2] : `/${m[2]}`;
        const score = (/paypal/i.test(r) ? 2 : 0) + (/webhook/i.test(r) ? 1 : 0);
        if (score > best) { best = score; route = r; routeWhere = `${rel}:${i + 1}`; }
      }
      const p = line.match(LISTEN);
      if (p && port === null) port = Number(p[1]);
    });
  }
  const finalPort = port ?? (framework ? DEFAULT_PORT[framework] : 3000);
  return {
    framework, port: finalPort, route, routeWhere,
    forwardTo: route ? `http://localhost:${finalPort}${route}` : null,
  };
}
