// Agent-readiness test: can an AI shopper buy from this store?
// Two parts: deterministic checks on the pages (these set the score), and a
// Claude-driven browser run that tries the goal and reports where it got stuck.
import * as z from 'zod/v4';
import { chromium, type Page } from 'playwright-core';
import { structured } from './llm.ts';

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
  // Payment buttons (PayPal's included) render inside iframes that load late; let the page settle first.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  const els = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('a, button, input, select, textarea, [role=button], iframe').forEach((el, i) => {
      const h = el as HTMLElement;
      if (!h.offsetParent && h.tagName !== 'BODY') return;
      h.setAttribute('data-pd', String(i));
      const ctx = (h.closest('li, article, .product, [itemtype]') ?? h.closest('form'))?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80) ?? '';
      const label = (h.innerText || (h as HTMLInputElement).value || h.getAttribute('aria-label') || h.getAttribute('title') || h.getAttribute('name') || '').trim().slice(0, 40);
      out.push(`[${i}] ${h.tagName.toLowerCase()} "${label}"${ctx ? `  (in: ${ctx})` : ''}`);
    });
    return { text: document.body.innerText.slice(0, 3000), els: out };
  });
  return `URL: ${page.url()}\n--- text ---\n${els.text}\n--- interactive ---\n${els.els.join('\n')}`;
}

// One decision per step, as structured output: works with an API key or on the user's Claude plan.
const StepSchema = z.object({
  thought: z.string().describe('one short sentence: what you see and why this action'),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('click'), id: z.number().int() }),
    z.object({ type: z.literal('fill'), id: z.number().int(), text: z.string() }),
    z.object({ type: z.literal('goto'), path: z.string().describe('a path on this store, e.g. "/"') }),
    z.object({ type: z.literal('report_blocker'), title: z.string(), detail: z.string(), fix: z.string(), severity: z.enum(['high', 'medium']) }),
    z.object({ type: z.literal('finish'), reached: z.enum(['purchased', 'paypal-approval', 'stuck']), summary: z.string() }),
  ]),
});

const SYSTEM = `You are an AI shopping agent testing whether a store is ready for agents. Work only on the store you are given.
Each turn you get the goal, your previous actions with their results, and the current page (its text and interactive elements, each with a [number]). Choose ONE next action:
- click {id} or fill {id, text} on an element from the current page; goto {path} on this store;
- report_blocker for anything that stops or slows an AI agent from buying (then usually finish);
- finish when done: reached="purchased" if an order confirmation appears, "paypal-approval" when you reach a PayPal button (buyer approval happens in PayPal's own window), "stuck" otherwise.
Prefer structured data and visible prices; do not guess prices. Never try to solve a CAPTCHA or log in. Do not repeat an action that already failed.`;

export interface ReadinessReport { store: string; goal: string; score: number; reached: string; summary: string; blockers: Blocker[]; steps: string[] }

export async function readiness(storeUrl: string, goal: string, maxSteps = 25): Promise<ReadinessReport> {
  const origin = new URL(storeUrl).origin;
  const [store, checkout] = await Promise.all([fetch(storeUrl).then((r) => r.text()), fetch(`${origin}/checkout`).then((r) => r.text()).catch(() => '')]);
  const blockers = checkPages(store, checkout);
  const steps: string[] = [];
  let reached = 'stuck', summary = 'Agent did not finish.';

  const browser = await chromium.launch({ channel: process.env.PAYDRILL_CHROME_CHANNEL ?? 'chrome', headless: !process.env.PAYDRILL_HEADED });
  try {
    const page = await browser.newPage();
    await page.goto(storeUrl);
    for (let i = 0; i < maxSteps; i++) {
      const history = steps.length ? steps.map((s, n) => `${n + 1}. ${s}`).join('\n') : '(none yet)';
      const { action: a } = await structured(StepSchema, SYSTEM,
        `Store: ${origin}\nGoal: ${goal}\n\nPrevious actions:\n${history}\n\nCurrent page:\n${await snapshot(page)}`, 'low');
      let result = 'ok';
      try {
        if (a.type === 'click') { await page.click(`[data-pd="${a.id}"]`, { timeout: 5000 }); await page.waitForLoadState(); }
        else if (a.type === 'fill') await page.fill(`[data-pd="${a.id}"]`, a.text, { timeout: 5000 });
        else if (a.type === 'goto') {
          const url = new URL(a.path, origin);
          if (url.origin !== origin) throw new Error('only this store may be visited');
          await page.goto(url.href);
        } else if (a.type === 'report_blocker') {
          blockers.push({ id: `agent-${blockers.length}`, source: 'agent', severity: a.severity, title: a.title, detail: a.detail, fix: a.fix });
        } else { reached = a.reached; summary = a.summary; }
      } catch (e) {
        result = `error: ${(e as Error).message.split('\n')[0]}`;
      }
      const { type, ...args } = a;
      steps.push(`${type} ${JSON.stringify(args)} -> ${result}`);
      if (a.type === 'finish') break;
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
