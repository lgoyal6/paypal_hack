// Agent-readiness test: can an AI shopper buy from this store?
// Two parts: deterministic checks on the pages (these set the score), and a
// Claude-driven browser run that tries the goal and reports where it got stuck.
import Anthropic from '@anthropic-ai/sdk';
import { chromium, type Page } from 'playwright-core';
import { MODEL, useApi } from './llm.ts';

export interface Blocker { id: string; severity: 'high' | 'medium'; title: string; detail: string; fix: string; source: 'check' | 'agent' }

// ---------- deterministic checks ----------
const CAPTCHA = /captcha|recaptcha|hcaptcha|cf-turnstile|prove you are human/i;

export function checkPages(store: string, checkout: string): Blocker[] {
  // Stylesheets can name a CAPTCHA without showing one; only markup and scripts count.
  const noCss = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, '');
  store = noCss(store);
  checkout = noCss(checkout);
  const out: Blocker[] = [];
  const ld = [...store.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
  const products = ld.flatMap((d) => (d?.['@graph'] ?? [d])).filter((x) => x && /Product/.test(String(x['@type'])));
  if (!products.length) {
    out.push({ id: 'no-structured-data', severity: 'medium', source: 'check', title: 'No structured product data',
      detail: 'No schema.org Product JSON-LD on the store page, so agents must scrape prices from HTML.',
      fix: 'Add <script type="application/ld+json"> with Product and Offer (price, priceCurrency, availability) for each item.' });
  } else if (!products.every((p) => p.offers?.price)) {
    out.push({ id: 'no-structured-price', severity: 'medium', source: 'check', title: 'Structured data without prices',
      detail: 'Product JSON-LD is present but some products have no offers.price.', fix: 'Include offers.price and offers.priceCurrency for every product.' });
  }
  if (/log ?in to see price|sign in to see price/i.test(store)) {
    out.push({ id: 'login-price', severity: 'high', source: 'check', title: 'Prices hidden behind login',
      detail: 'The store page asks the visitor to log in before showing prices.', fix: 'Show prices to logged-out visitors, or expose them in structured data.' });
  }
  if (CAPTCHA.test(checkout) || CAPTCHA.test(store)) {
    out.push({ id: 'captcha', severity: 'high', source: 'check', title: 'CAPTCHA in the purchase path',
      detail: 'A CAPTCHA appears before payment. Agents cannot and should not solve these.',
      fix: 'Rely on PayPal risk checks at payment instead, or allow verified agent traffic (for example PayPal agent-ready checkout) to skip it.' });
  }
  if (!/paypal\.com\/sdk\/js/.test(checkout)) {
    out.push({ id: 'no-paypal-checkout', severity: 'medium', source: 'check', title: 'No PayPal checkout on the checkout page',
      detail: 'The PayPal JS SDK is not loaded on the checkout page.', fix: 'Render PayPal Buttons on checkout so agents can pay with a PayPal wallet.' });
  }
  return out;
}

export function score(blockers: Blocker[], purchased: boolean): number {
  const lost = blockers.reduce((s, b) => s + (b.severity === 'high' ? 30 : 10), 0);
  return Math.max(0, Math.min(100, (purchased ? 100 : 80) - lost));
}

// ---------- browser agent ----------
export async function snapshot(page: Page): Promise<string> {
  const els = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('a, button, input, select, textarea, [role=button]').forEach((el, i) => {
      const h = el as HTMLElement;
      if (!h.offsetParent && h.tagName !== 'BODY') return;
      h.setAttribute('data-pd', String(i));
      const ctx = (h.closest('li, article, .product, [itemtype]') ?? h.closest('form'))?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) ?? '';
      const label = (h.innerText || (h as HTMLInputElement).value || h.getAttribute('aria-label') || h.getAttribute('name') || '').trim().slice(0, 40);
      out.push(`[${i}] ${h.tagName.toLowerCase()} "${label}"${ctx ? `  (in: ${ctx})` : ''}`);
    });
    return { text: document.body.innerText.slice(0, 3000), els: out };
  });
  return `URL: ${page.url()}\n--- text ---\n${els.text}\n--- interactive ---\n${els.els.join('\n')}`;
}

const TOOLS: Anthropic.Tool[] = [
  { name: 'read_page', description: 'Visible text and interactive elements, each with a [number].', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'click', description: 'Click element [id] from read_page.', input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'], additionalProperties: false } },
  { name: 'fill', description: 'Type into input [id].', input_schema: { type: 'object', properties: { id: { type: 'integer' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false } },
  { name: 'goto', description: 'Open a path on the store, e.g. "/".', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'report_blocker', description: 'Record something that stops or slows an AI agent from buying.', input_schema: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, fix: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium'] } }, required: ['title', 'detail', 'fix', 'severity'], additionalProperties: false } },
  { name: 'finish', description: 'End the run.', input_schema: { type: 'object', properties: { reached: { type: 'string', enum: ['purchased', 'paypal-approval', 'stuck'] }, summary: { type: 'string' } }, required: ['reached', 'summary'], additionalProperties: false } },
];

const SYSTEM = `You are an AI shopping agent testing whether a store is ready for agents. Work only on the store you are given.
Pursue the goal using the tools. Prefer structured data and visible prices; do not guess prices.
When you reach the PayPal button, stop there and finish with reached="paypal-approval" (buyer approval happens in PayPal's own window). If an order confirmation appears, finish with "purchased".
Never try to solve a CAPTCHA or log in. Report each obstacle with report_blocker, then finish.`;

export interface ReadinessReport { store: string; goal: string; score: number; reached: string; summary: string; blockers: Blocker[]; steps: string[] }

export async function readiness(storeUrl: string, goal: string, maxSteps = 25): Promise<ReadinessReport> {
  const origin = new URL(storeUrl).origin;
  const [store, checkout] = await Promise.all([fetch(storeUrl).then((r) => r.text()), fetch(`${origin}/checkout`).then((r) => r.text()).catch(() => '')]);
  const blockers = checkPages(store, checkout);
  const steps: string[] = [];
  let reached = 'stuck', summary = 'Agent did not finish.';
  // The browser agent needs the API's tool loop; without a key, report the page checks alone and say so.
  if (!useApi()) {
    return { store: storeUrl, goal, score: score(blockers, false), reached: 'not-run', blockers, steps,
      summary: 'Page checks only: the shopping-agent run needs ANTHROPIC_API_KEY.' };
  }

  const browser = await chromium.launch({ channel: process.env.PAYDRILL_CHROME_CHANNEL ?? 'chrome', headless: !process.env.PAYDRILL_HEADED });
  try {
    const page = await browser.newPage();
    await page.goto(storeUrl);
    const client = new Anthropic();
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `Store: ${origin}\nGoal: ${goal}\n\n${await snapshot(page)}` }];
    for (let i = 0; i < maxSteps; i++) {
      const res = await client.messages.create({ model: MODEL, max_tokens: 8000, system: SYSTEM, tools: TOOLS, messages, output_config: { effort: 'low' } });
      if (res.stop_reason === 'refusal') { summary = 'Model declined the task.'; break; }
      messages.push({ role: 'assistant', content: res.content }); // full content, thinking blocks included
      const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!calls.length) break;
      const results: Anthropic.ToolResultBlockParam[] = [];
      let done = false;
      for (const c of calls) {
        const a = c.input as any;
        steps.push(`${c.name} ${JSON.stringify(a)}`);
        let out = 'ok';
        try {
          if (c.name === 'read_page') out = await snapshot(page);
          else if (c.name === 'click') { await page.click(`[data-pd="${Number(a.id)}"]`, { timeout: 5000 }); await page.waitForLoadState(); out = await snapshot(page); }
          else if (c.name === 'fill') { await page.fill(`[data-pd="${Number(a.id)}"]`, String(a.text), { timeout: 5000 }); }
          else if (c.name === 'goto') {
            const url = new URL(String(a.path), origin);
            if (url.origin !== origin) throw new Error('Only this store may be visited');
            await page.goto(url.href); out = await snapshot(page);
          } else if (c.name === 'report_blocker') {
            blockers.push({ id: `agent-${blockers.length}`, source: 'agent', severity: a.severity, title: a.title, detail: a.detail, fix: a.fix });
          } else if (c.name === 'finish') { reached = a.reached; summary = a.summary; done = true; }
          results.push({ type: 'tool_result', tool_use_id: c.id, content: out });
        } catch (e: any) {
          results.push({ type: 'tool_result', tool_use_id: c.id, content: `error: ${e.message.split('\n')[0]}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
      if (done) break;
    }
  } finally {
    await browser.close();
  }
  // The agent may restate a check's blocker; keep the deterministic one.
  const dedup = blockers.filter((b, i) => b.source === 'check' || !blockers.slice(0, i).some((x) => x.source === 'check' && similar(x.title, b.title)));
  return { store: storeUrl, goal, score: score(dedup, reached === 'purchased'), reached, summary, blockers: dedup, steps };
}

const similar = (a: string, b: string) => {
  const w = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g));
  const x = w(a), y = w(b);
  return [...x].some((t) => y.has(t));
};

export function formatReadiness(r: ReadinessReport): string {
  return [
    `agent readiness  ${r.score}/100   reached: ${r.reached}`,
    `goal: ${r.goal}`,
    r.summary,
    '',
    ...r.blockers.map((b) => `${b.severity.toUpperCase().padEnd(6)} ${b.title}${b.source === 'agent' ? ' (found by agent)' : ''}\n       ${b.detail}\n       fix: ${b.fix}`),
  ].join('\n');
}
