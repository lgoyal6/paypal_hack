// Deterministic rewrites. Mechanical changes never go through the model.
//   - webhook event type strings: Stripe -> PayPal
//   - stripe.webhooks.constructEvent(...) -> await paypal.webhooks.verify(req.headers, <body>)
//     (and the enclosing function becomes async)
//   - add the PayPal helper import and the helper file
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, posix, relative } from 'node:path';
import type { CodeFile, MigrateItem } from '../contract.ts';

// Resolves to src/migrate/template from both src/ (tests) and dist/ (built CLI); tsc does not copy .js assets.
export const HELPER = readFileSync(new URL('../../src/migrate/template/paypal.js', import.meta.url), 'utf8');

interface Splice { start: number; end: number; text: string }

function splice(text: string, edits: Splice[]): string {
  // Apply from the end so earlier offsets stay valid; skip exact duplicates.
  const seen = new Set<string>();
  return edits.sort((a, b) => b.start - a.start).reduce((t, e) => {
    const k = `${e.start}:${e.end}:${e.text}`;
    if (seen.has(k)) return t;
    seen.add(k);
    return t.slice(0, e.start) + e.text + t.slice(e.end);
  }, text);
}

export interface CodemodResult { files: CodeFile[]; done: Set<string> } // ids of items fully migrated by codemods

export function codemods(files: CodeFile[], items: MigrateItem[], helperPath = 'paypal.js'): CodemodResult {
  const done = new Set<string>();
  const out = files.map((f) => {
    const mine = items.filter((i) => i.where.startsWith(f.path + ':'));
    if (!mine.length) return f;
    const src = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true);
    const lineOf = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const edits: Splice[] = [];
    let needsImport = false;

    const visit = (n: ts.Node) => {
      // Event type literals.
      if (ts.isStringLiteral(n)) {
        const item = mine.find((i) => i.kind === 'webhook-event' && i.stripe === n.text && i.paypal && i.where === `${f.path}:${lineOf(n)}`);
        if (item) {
          const q = n.getText(src)[0];
          edits.push({ start: n.getStart(), end: n.getEnd(), text: `${q}${item.paypal}${q}` });
          if (item.status === 'supported') done.add(item.id);
        }
      }
      // constructEvent -> paypal.webhooks.verify
      if (ts.isCallExpression(n) && /\.webhooks\.constructEvent(Async)?$/.test(n.expression.getText(src))) {
        const item = mine.find((i) => i.stripe.startsWith('stripe.webhooks.constructEvent') && i.where === `${f.path}:${lineOf(n)}`);
        const body = n.arguments[0];
        if (item && body) {
          const awaited = ts.isAwaitExpression(n.parent);
          edits.push({ start: n.getStart(), end: n.getEnd(), text: `${awaited ? '' : 'await '}paypal.webhooks.verify(req.headers, ${body.getText(src)})` });
          const fn = enclosingFunction(n);
          if (fn && !(ts.getCombinedModifierFlags(fn) & ts.ModifierFlags.Async)) edits.push({ start: fn.getStart(src), end: fn.getStart(src), text: 'async ' });
          needsImport = true;
          done.add(item.id);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(src);

    // Any glue target in this file will also need the helper.
    if (mine.some((i) => i.kind === 'sdk-call' && i.status === 'supported')) needsImport = true;
    let text = splice(f.text, edits);
    if (needsImport && !/from ['"]\.\/?[^'"]*paypal(\.js)?['"]/.test(text)) {
      let rel = posix.normalize(relative(dirname(f.path), helperPath).split('\\').join('/'));
      if (!rel.startsWith('.')) rel = './' + rel;
      text = addImport(text, `import { paypal, toPayPalAmount } from '${rel}';`);
    }
    return { path: f.path, text };
  });
  if (out.some((f, i) => f.text !== files[i].text) && !out.some((f) => f.path === helperPath)) out.push({ path: helperPath, text: HELPER });
  return { files: out, done };
}

function enclosingFunction(n: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) return p;
  }
}

/** Insert after the last top-level import, or at the top. */
function addImport(text: string, line: string): string {
  const src = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true);
  const last = src.statements.filter(ts.isImportDeclaration).at(-1);
  return last ? text.slice(0, last.getEnd()) + '\n' + line + text.slice(last.getEnd()) : line + '\n' + text;
}
