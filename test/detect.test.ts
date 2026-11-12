import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detect } from '../src/init/detect.js';

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-detect-'));
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  return dir;
}

test('express: route, line and port from listen()', () => {
  const d = detect(project({
    'package.json': '{"dependencies":{"express":"^4"}}',
    'src/server.js': "const app = require('express')();\napp.post('/health', h);\napp.post('/webhooks/paypal', handler);\napp.listen(4100);\n",
  }));
  assert.equal(d.framework, 'express');
  assert.equal(d.forwardTo, 'http://localhost:4100/webhooks/paypal');
  assert.equal(d.routeWhere, 'src/server.js:3');
});

test('next app router: route.ts with POST export', () => {
  const d = detect(project({
    'package.json': '{"dependencies":{"next":"15"}}',
    'app/api/paypal/webhook/route.ts': 'export async function POST(req: Request) { return new Response(null); }\n',
  }));
  assert.equal(d.framework, 'next');
  assert.equal(d.forwardTo, 'http://localhost:3000/api/paypal/webhook');
});

test('fastapi: decorator route and default port 8000', () => {
  const d = detect(project({
    'requirements.txt': 'fastapi\nuvicorn\n',
    'main.py': '@app.post("/paypal/webhook")\nasync def hook(): ...\n',
  }));
  assert.equal(d.framework, 'fastapi');
  assert.equal(d.forwardTo, 'http://localhost:8000/paypal/webhook');
});

test('prefers a paypal route over a generic webhook route', () => {
  const d = detect(project({
    'package.json': '{"dependencies":{"express":"^4"}}',
    'a.js': "app.post('/webhooks/github', h)\n",
    'b.js': "app.post('/webhooks/paypal', h)\n",
  }));
  assert.equal(d.route, '/webhooks/paypal');
});

test('no route found: null, framework default port kept', () => {
  const d = detect(project({ 'package.json': '{"dependencies":{"fastify":"4"}}', 'index.js': 'fastify.get("/", h)\n' }));
  assert.equal(d.route, null);
  assert.equal(d.port, 3000);
});
