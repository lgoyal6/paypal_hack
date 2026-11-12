const entries = [
  { time: '11:57:17', event: 'PAYMENT.CAPTURE.COMPLETED', status: 200, source: 'Live', signature: 'Verified', latency: '24 ms', note: 'A real $12.00 PayPal sandbox capture reached the demo shop. The shop logged fulfillment with a missing order ID.' },
  { time: '11:57:52', event: 'CUSTOMER.DISPUTE.UPDATED', status: 500, source: 'Live', signature: 'Verified', latency: '7 ms', note: 'The original demo shop returned HTTP 500 for this signed dispute update.' },
  { time: '11:58:10', event: 'CUSTOMER.DISPUTE.UPDATED', status: 500, source: 'Live retry', signature: '—', latency: '—', note: 'A retry recorded by the inspector after the handler returned a server error.' },
  { time: '11:58:23', event: 'PAYMENT.CAPTURE.COMPLETED', status: 200, source: 'Live retry', signature: '—', latency: '—', note: 'A subsequent delivery recorded by the inspector.' },
];
const featureGroups = [
  ['Set up in minutes', 'Check sandbox credentials, detect the framework and webhook route, and write paydrill.yml. Store credentials in the OS keychain where available.', 'init · webhook create / list · killcheck'],
  ['Watch webhooks arrive', 'Forward sandbox webhooks through a tunnel. Inspect signatures, see retries and backfill separately, filter deliveries, and route event types to different local apps.', 'listen · browser inspector · Ink terminal view · bring your own HTTPS tunnel'],
  ['Trigger and inspect events', 'Generate sandbox payments, full or partial refunds, and dispute scenarios. List, inspect, compare, and request redelivery from one CLI.', 'scenarios · trigger · events list / inspect / diff / resend'],
  ['Record and replay', 'Capture a sandbox session for repeatable debugging, then replay saved deliveries or fixtures against a development handler.', 'record · replay'],
  ['Turn scenarios into code', 'Describe a scenario in plain English. Claude drafts validated YAML with sandbox steps, event expectations, response requirements, and time limits.', 'new · paydrill.yml'],
  ['Measure handler behavior', 'Run scenarios against your handler, check responses and missing deliveries, and save a report. The terminal UI shows progress as results arrive.', 'drill --ui · --output compact / json / quiet · --out · --markdown'],
  ['Go from failure to source line', 'Claude explains failed checks and proposes a diff. Doctor combines static review and observed findings, with PayPal AI Toolkit guidance when available.', 'explain · doctor · fix · optional rerun in a separate worktree'],
  ['Rehearse disputes', 'Prepare sandbox disputes, follow a case through the stages, and draft evidence notes and a PDF timeline from known order facts.', 'disputes · rehearse · evidence'],
  ['Track payment coverage', 'Compare handler coverage with exercised events, keep simulated deliveries labeled, and export coverage JSON and an SVG badge.', 'coverage --drill · --write'],
  ['Generate types from payloads', 'Infer TypeScript types and Zod validators from event samples and compare snapshots for payload drift.', 'types'],
  ['Bring it to CI and your editor', 'Post drill results and coverage to a PR, optionally propose a repair PR after verification, or call the CLI tools from an MCP client. Claude Code commands and local command plugins extend the workflow.', 'GitHub Action · heal · MCP · Claude Code plugin · .paydrill/commands'],
  ['Ask in plain English', 'Turn a request into a previewable sandbox plan. Review the proposed calls and confirm before execution.', 'ask'],
  ['Move a Stripe integration', 'Inventory Stripe calls and events, plan deterministic codemods and AI-assisted edits, and report what still needs a human. Compare webhook-path business effects when both test environments are configured.', 'inventory · migrate --plan · parity'],
  ['Test agent readiness', 'A browser agent follows a shopping goal and reports checkout friction. A clean demo reached PayPal approval with a $14 mug. The blocked store exposed hidden prices and a human verification challenge.', 'store · ready'],
];
const id = (name) => document.getElementById(name);
const make = (tag, value) => { const el = document.createElement(tag); el.textContent = value; return el; };
for (const [title, description, commands] of featureGroups) {
  const item = document.createElement('article');
  item.className = 'feature';
  item.append(make('h3', title), make('p', description), make('code', commands));
  id('feature-list').append(item);
}
function showEntry(row) {
  const dl = document.createElement('dl');
  for (const [key, val] of Object.entries({ Status: row.status, Signature: row.signature, Source: row.source, Latency: row.latency })) {
    dl.append(make('dt', key), make('dd', val));
  }
  const detail = id('detail');
  detail.replaceChildren(make('h3', row.event), dl, make('p', row.note));
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    detail.animate([{ opacity: 0.55, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 230 });
  }
  for (const button of document.querySelectorAll('[data-example]')) {
    button.setAttribute('aria-pressed', String(entries[Number(button.dataset.example)] === row));
  }
}
showEntry(entries[0]);
const gridOptions = {
  theme: window.agGrid?.themeQuartz.withParams({ accentColor: '#141414', backgroundColor: '#fff', borderRadius: 8, fontSize: 12 }),
  columnDefs: [
    { field: 'time', headerName: 'Time', width: 100 },
    { field: 'event', headerName: 'Event', flex: 1, minWidth: 185 },
    { field: 'status', headerName: 'HTTP', width: 85 },
    { field: 'source', width: 110 },
  ],
  defaultColDef: { sortable: true, resizable: true },
  rowData: entries,
  onRowClicked: ({ data }) => showEntry(data),
  onCellKeyDown: ({ event, data }) => {
    if (event?.key === 'Enter' && data) showEntry(data);
  },
};
const api = window.agGrid?.createGrid(id('event-grid'), gridOptions);
const filter = id('event-filter');
for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', () => {
    filter.value = '';
    filter.dispatchEvent(new Event('input'));
    showEntry(entries[Number(button.dataset.example)]);
  });
}
function showFallback() {
  const q = filter.value.toLowerCase();
  const rows = entries.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(q)));
  id('event-grid').className = 'fallback';
  id('event-grid').replaceChildren(...rows.map(row => {
    const button = make('button', row.status + ' · ' + row.event);
    button.type = 'button';
    button.onclick = () => showEntry(row);
    return button;
  }));
}
if (!api) showFallback();
filter.addEventListener('input', () => api ? api.setGridOption('quickFilterText', filter.value) : showFallback());
for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => {
    for (const tab of document.querySelectorAll('[data-tab]')) {
      const selected = tab === button;
      tab.setAttribute('aria-pressed', String(selected));
      id(tab.dataset.tab).hidden = !selected;
    }
  });
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const command = 'paydrill trigger payment';
const lines = ['→ PAYMENT.CAPTURE.COMPLETED', '  source: live sandbox', '  signature: verified', '  handler: HTTP 200 in 24 ms'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let currentRun = 0;
async function playTerminal() {
  const run = ++currentRun;
  id('typed').textContent = '';
  id('terminal-output').replaceChildren();
  id('caret').hidden = false;
  for (const char of command) {
    if (run !== currentRun) return;
    id('typed').textContent += char;
    if (!reducedMotion.matches) await delay(60_000 / (95 * 5));
  }
  if (run !== currentRun) return;
  id('caret').hidden = true;
  for (const line of lines) {
    if (!reducedMotion.matches) await delay(190);
    if (run !== currentRun) return;
    id('terminal-output').append(make('div', line));
  }
}
id('type-replay').onclick = playTerminal;
playTerminal();
id('copy').onclick = async () => {
  const command = 'npx -y github:lgoyal6/paypal_hack scenarios';
  try {
    await navigator.clipboard.writeText(command);
    id('copy').textContent = 'Copied';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(id('copy').previousElementSibling);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    id('copy').textContent = 'Selected';
  }
};
