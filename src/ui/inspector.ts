// Local web inspector for `paydrill listen --ui`: live timeline over SSE, full payloads, one-click replay/duplicate/forge.
// Binds to 127.0.0.1 only; it can re-send events to your app, so it is never exposed through the tunnel.
import http from 'node:http';
import type { DrillEvent } from '../contract.js';

export interface InspectorActions {
  replay(i: number): Promise<DrillEvent>;
  duplicate(i: number): Promise<DrillEvent>;
  forge(i: number): Promise<DrillEvent>;
}

export async function startInspector(opts: {
  forwardTo: string; webhookId: string; events: DrillEvent[]; actions: InspectorActions; port?: number;
}): Promise<{ url: string; push(d: DrillEvent): void; close(): void }> {
  const clients = new Set<http.ServerResponse>();
  const send = (res: http.ServerResponse, d: DrillEvent, i: number) => res.write(`data: ${JSON.stringify({ i, d })}\n\n`);

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(opts.forwardTo, opts.webhookId));
      return;
    }
    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      opts.events.forEach((d, i) => send(res, d, i));
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const m = req.method === 'POST' && req.url?.match(/^\/(replay|duplicate|forge)\/(\d+)$/);
    if (m) {
      // Same-origin only: a page on another site must not be able to make this inspector re-send events.
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) { res.writeHead(403); res.end(); return; }
      try {
        const d = await opts.actions[m[1] as keyof InspectorActions](Number(m[2]));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: d.response.status, ms: d.response.ms }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url,
    push(d) { const i = opts.events.length - 1; for (const c of clients) send(c, d, i); },
    close() { for (const c of clients) c.end(); server.close(); },
  };
}

function page(forwardTo: string, webhookId: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>paydrill inspector</title>
<style>
:root{--bg:#fafaf8;--fg:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--ok:#1f7a4d;--bad:#b42318;--sim:#7a3fb4;--chaos:#0f6f86;--back:#9a6a00;--sel:#eef3fb}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#9c9b95;--line:#2c2c2a;--ok:#5cc792;--bad:#f47c70;--sim:#c39af0;--chaos:#5fc6dc;--back:#e2b54a;--sel:#1f2a3a}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:14px 20px;border-bottom:1px solid var(--line)}h1{font-size:16px;font-weight:600;margin:0}header p{margin:2px 0 0;color:var(--muted);font-size:13px}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);height:calc(100vh - 62px)}
#list{overflow:auto;border-right:1px solid var(--line)}#detail{overflow:auto;padding:16px 20px}
.row{display:grid;grid-template-columns:70px 44px minmax(0,1fr) auto;gap:8px;padding:8px 20px;border-bottom:1px solid var(--line);cursor:pointer;font-variant-numeric:tabular-nums}
.row:hover,.row.sel{background:var(--sel)}.t{color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}.type{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-size:12px}.backfill{color:var(--back)}.paypal-simulated{color:var(--sim)}[class*=chaos]{color:var(--chaos)}
dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;margin:0 0 14px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
button{font:inherit;padding:6px 12px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--fg);cursor:pointer;margin-right:6px}button:hover{border-color:var(--muted)}
pre{background:var(--sel);padding:12px;border-radius:8px;overflow:auto;font-size:12px}#msg{color:var(--muted);margin:10px 0}.empty{padding:20px;color:var(--muted)}
.note{color:var(--sim);margin-bottom:10px}
@media (max-width:760px){main{grid-template-columns:1fr;height:auto}#list{border-right:0;max-height:45vh}}
</style></head><body>
<header><h1>paydrill inspector</h1><p>Forwarding real sandbox events to ${esc(forwardTo)} · webhook ${esc(webhookId)}</p></header>
<main><div id="list"><div class="empty">Waiting for sandbox events. Try "paydrill trigger payment".</div></div><div id="detail"><p class="empty">Select an event</p></div></main>
<script>
const items=[];let sel=-1;const list=document.getElementById('list'),detail=document.getElementById('detail');
const ok=s=>s>=200&&s<300;const rid=d=>d.event.resource?.id||d.event.resource?.dispute_id||'';
function txt(tag,cls,t){const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=t;return e}
function renderList(){list.replaceChildren();if(!items.length){list.append(txt('div','empty','Waiting for sandbox events.'));return}
items.forEach((d,i)=>{const r=document.createElement('div');r.className='row'+(i===sel?' sel':'');r.onclick=()=>{sel=i;renderList();renderDetail()};
r.append(txt('span','t',d.receivedAt.slice(11,19)),txt('span',ok(d.response.status)?'ok':'bad',String(d.response.status)),txt('span','type',d.event.event_type),txt('span','tag '+d.source,d.source==='live'?'':d.source));list.append(r)})}
function renderDetail(){const d=items[sel];if(!d)return;detail.replaceChildren();detail.append(txt('h2','',d.event.event_type));
if(d.source==='paypal-simulated')detail.append(txt('div','note','Simulated by PayPal: real delivery and signature, mock payload'));
const dl=document.createElement('dl');for(const[k,v,c]of[['resource',rid(d)],['source',d.source,d.source],['signature',d.signature,d.signature==='verified'?'ok':'bad'],['your app',d.response.status+' in '+d.response.ms+'ms',ok(d.response.status)?'ok':'bad'],['event id',d.event.id]]){dl.append(txt('dt','',k),txt('dd',c||'',v))}detail.append(dl);
for(const a of['replay','duplicate','forge']){const b=txt('button','',a==='forge'?'forge (unsigned)':a);b.onclick=()=>act(a,sel);detail.append(b)}
detail.append(txt('div','',''));const m=txt('div','','');m.id='msg';detail.append(m);detail.append(txt('pre','',JSON.stringify(d.event,null,2)))}
async function act(a,i){const m=document.getElementById('msg');m.textContent=a+'...';const r=await fetch('/'+a+'/'+i,{method:'POST'});const j=await r.json();m.textContent=j.error?a+' failed: '+j.error:a+': your app answered '+j.status+' in '+j.ms+'ms'}
new EventSource('/events').onmessage=e=>{const {i,d}=JSON.parse(e.data);items[i]=d;const first=sel===-1;if(first)sel=i;renderList();if(first)renderDetail()};
</script></body></html>`;
}
