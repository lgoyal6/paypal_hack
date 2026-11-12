import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runChaos } from '../src/relay/chaos.ts';

async function serve(status: number) {
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(status); res.end(); }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`, close: () => server.close() };
}

test('unknown-type: a secure 4xx for the unsigned event passes, a 5xx fails', async () => {
  for (const [status, pass] of [[200, true], [400, true], [500, false]] as const) {
    const s = await serve(status);
    try {
      const c = (await runChaos(s.url, [])).find((x) => x.check === 'unknown-type')!;
      assert.equal(c.pass, pass, `status ${status}`);
    } finally { s.close(); }
  }
});
