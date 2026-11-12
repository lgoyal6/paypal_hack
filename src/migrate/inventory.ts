// Step 1 of migrate: list every Stripe usage with file and line. AST only, no AI,
// so nothing is missed or invented.
import ts from 'typescript';
import type { CodeFile, MigrateItem } from '../contract.ts';
import { AMOUNT, IDEMPOTENCY, mapEvent, mapSdk, mapStripeJs, type Mapping } from './mapping.ts';

const STRIPE_EVENT = /^[a-z_]+(\.[a-z_]+)+$/;
const AMOUNT_CALLS = /^(paymentIntents\.create|refunds\.create|checkout\.sessions\.create)$/;

export function inventory(files: CodeFile[]): MigrateItem[] {
  const items: MigrateItem[] = [];
  for (const f of files) {
    if (!/\.(m?[jt]sx?)$/.test(f.path)) continue;
    const src = ts.createSourceFile(f.path, f.text, ts.ScriptTarget.Latest, true, f.path.endsWith('x') ? ts.ScriptKind.TSX : undefined);
    const at = (n: ts.Node) => `${f.path}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const add = (kind: MigrateItem['kind'], stripe: string, n: ts.Node, m: Mapping) =>
      items.push({ id: `${kind}:${stripe}:${at(n)}`, kind, stripe, where: at(n), status: m.status, paypal: m.paypal, reason: m.reason });

    // Which identifiers hold a server Stripe client, a Stripe.js client, or a Stripe.js Elements group.
    const server = new Set<string>(), browser = new Set<string>(), elements = new Set<string>();
    const bind = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        let init: ts.Expression = n.initializer;
        if (ts.isAwaitExpression(init)) init = init.expression;
        const text = init.getText(src);
        if (/^new\s+Stripe\s*\(|^Stripe\s*\(|^require\(['"]stripe['"]\)\s*\(/.test(text)) server.add(n.name.text);
        else if (/^loadStripe\s*\(/.test(text)) browser.add(n.name.text);
        else if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === 'elements'
          && ts.isIdentifier(init.expression.expression) && browser.has(init.expression.expression.text)) elements.add(n.name.text);
      }
      ts.forEachChild(n, bind);
    };
    bind(src);

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const chain = calleeChain(n.expression);
        if (chain) {
          const [root, ...rest] = chain, path = rest.join('.');
          if (server.has(root) && rest.length) {
            add('sdk-call', `stripe.${path}`, n, mapSdk(path));
            const opts = n.arguments.find((a, i) => i > 0 && ts.isObjectLiteralExpression(a)) as ts.ObjectLiteralExpression | undefined;
            const idem = opts && prop(opts, 'idempotencyKey');
            if (idem) add('header', 'idempotencyKey', idem, IDEMPOTENCY);
            const body = n.arguments[0];
            if (body && ts.isObjectLiteralExpression(body)) {
              const amount = prop(body, 'amount');
              if (amount && AMOUNT_CALLS.test(path)) add('amount', `amount (stripe.${path})`, amount, AMOUNT);
              const md = prop(body, 'metadata');
              if (md) add('sdk-call', `metadata (stripe.${path})`, md, mapSdk('metadata'));
            }
          } else if (root === 'loadStripe' && !rest.length) add('stripe-js', 'loadStripe', n, mapStripeJs('loadStripe'));
          else if (browser.has(root) && rest.length === 1) add('stripe-js', `stripe.${rest[0]}`, n, mapStripeJs(rest[0]));
          else if (elements.has(root) && rest[0] === 'create') add('stripe-js', 'elements.create', n, mapStripeJs('elements.create'));
        }
      }
      // Webhook event types: string literals in `case` clauses or compared with something ending in `.type`.
      if (ts.isStringLiteral(n) && STRIPE_EVENT.test(n.text)) {
        const p = n.parent;
        const isCase = ts.isCaseClause(p) && p.expression === n;
        const isCompare = ts.isBinaryExpression(p) && /^={2,3}$|^!={1,2}$/.test(p.operatorToken.getText(src))
          && /\.type$/.test((p.left === n ? p.right : p.left).getText(src));
        if (isCase || isCompare) add('webhook-event', n.text, n, mapEvent(n.text));
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return items;
}

/** stripe.paymentIntents.create -> ["stripe", "paymentIntents", "create"]; null for anything fancier. */
function calleeChain(e: ts.Expression): string[] | null {
  if (ts.isIdentifier(e)) return [e.text];
  if (ts.isPropertyAccessExpression(e)) {
    const left = calleeChain(e.expression);
    return left && [...left, e.name.text];
  }
  return null;
}

function prop(o: ts.ObjectLiteralExpression, name: string): ts.Node | undefined {
  return o.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === name);
}

export function formatInventory(items: MigrateItem[]): string {
  const icon = { supported: 'OK     ', partial: 'PARTIAL', unsupported: 'NO     ' };
  return items.map((i) => `${icon[i.status]} ${i.stripe.padEnd(42)} ${i.where.padEnd(22)} ${i.paypal ?? i.reason ?? ''}`).join('\n');
}
