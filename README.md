# paydrill

The Stripe CLI for PayPal. paydrill sends real PayPal sandbox events to the app on your machine, replays them the way PayPal really behaves (duplicates, out of order, forged, unknown types), and shows exactly what breaks. Claude then explains each failure down to the line, writes the fix on a new branch, and proves it by running the drill again.

It also does what Stripe's CLI does not: it measures payment coverage, generates types from real events, rehearses a full dispute with AI-written evidence, tests whether AI shopping agents can buy from your store, and migrates a Stripe app to PayPal with an honest report of what was verified.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). 

## Why

- PayPal has no CLI. Its webhook simulator sends mock events that match no real transaction and cannot be resent.
- Sandbox webhook delivery is known to be delayed or dropped.
- Webhook bugs (no signature check, double fulfilment, crashes on disputes) only show up when real money moves.

## How the AI is used

| Feature | What Claude does | What Claude does not do |
|---|---|---|
| `drill` verdict | Explains each failed check with the file and line responsible | Decide pass or fail. That comes from HTTP results only. |
| `fix` | Proposes exact find-and-replace edits; paydrill builds the diff and applies it on a new branch | Touch your working tree or merge anything |
| `doctor` | Reviews the handler for risks; risks a drill proved are marked PROVEN | |
| dispute rehearsal | Drafts the seller's evidence (notes plus a PDF timeline) from order facts only | Invent tracking numbers or dates |
| `migrate` | Writes the glue a codemod cannot (reshaping Stripe calls into PayPal ones) | Mechanical rewrites, which are deterministic codemods. Every AI edit is syntax- or type-checked and rolled back if it fails. |
| `ask` | Turns "refund my last payment and open a dispute" into real sandbox calls | Run them before you confirm |
| agent-readiness | Drives a real browser as a shopping agent and reports where it gets stuck | Set the score. Deterministic page checks do. |

Every Claude call uses `claude-opus-5-5` (override with `PAYDRILL_MODEL`) with structured outputs validated by zod, streaming, and server-side refusal fallback.

## Quick start

Requires Node.js 22.6+ and Git. The PayPal commands need sandbox credentials from the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/). The AI commands can use a signed-in Claude Code install or an Anthropic API key.

```bash
npm install
cp .env.example .env   # PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY
npm run build
npm test
```

List the built-in scenarios with `node bin/paydrill.js scenarios`. For a live payment demo, set the two PayPal sandbox variables in `.env`, install `cloudflared` or configure your own HTTPS tunnel, and open three terminals in the repo:

```bash
# Terminal 1: start the intentionally buggy demo shop
cd examples/demo-shop
npm ci
npm start
```

```bash
# Terminal 2: start the relay and open the printed inspector URL
node bin/paydrill.js listen --forward-to http://127.0.0.1:4242/webhooks/paypal --ui
```

```bash
# Terminal 3: create a real sandbox capture
node bin/paydrill.js trigger payment
```

The inspector shows the event source, signature status, and handler response. For a credential-free walkthrough, see [the interactive browser demo instructions](site/README.md).

Then `node bin/paydrill.js` lists every command. The demo flow, against the demo shop running on port 4242:

```bash
node bin/paydrill.js drill --forward-to http://localhost:4242/webhooks/paypal --scenarios payment,refund --project examples/demo-shop --out result.json
```

```bash
node bin/paydrill.js fix --drill result.json examples/demo-shop
```

```bash
node bin/paydrill.js coverage examples/demo-shop --drill result.json
```

```bash
node bin/paydrill.js migrate examples/stripe-shop --plan
```

```bash
node bin/paydrill.js ready http://localhost:4242/
```

## Demo apps

- [examples/demo-shop](examples/demo-shop/server.js): a small PayPal store with **four bugs planted on purpose** in its webhook handler, so the drill has something real to find. No signature check, disputes read the wrong field, unknown events return 500, and redelivered events ship twice. `SHOP_BLOCKERS=captcha,login-price,no-structured-data` adds agent blockers for the readiness test.
- [examples/stripe-shop](examples/stripe-shop/server.js): a small Stripe store, written for this repo, used as the `migrate` target. It includes Stripe Tax on purpose, which PayPal cannot replace, so the report shows an honest "not migrated" item.

Both shops record their business effects (`fulfillOrder`, `markRefunded`, `flagDispute`) at `GET /_effects`, so drills and migration parity compare what the shop did, not just the HTTP status.

## Layout

| Path | What |
|---|---|
| `src/contract.ts` | Shared types between the PayPal lane and the AI lane |
| `src/ai/` | review, verdict, fix, doctor, evidence, ask, self-healing PRs, agent-readiness |
| `src/coverage/` | Payment coverage (AST first, AI only for unusual dispatch), JSON and badge |
| `src/types-gen/` | Types and zod validators from recorded events, snapshot drift |
| `src/migrate/` | Inventory, mapping table, codemods, AI glue, report |
| `plugin/` | Claude Code plugin: `/paydrill:drill`, `fix`, `coverage`, `migrate` |
| `fixtures/events/` | One event per type, docs-shaped until real recordings replace them |

Install the Claude Code plugin from this repo with `/plugin marketplace add lgoyal6/paypal_hack`, then `/plugin install paydrill@paydrill`.

## Known gaps

Failures and limits first.

- **Not yet run end to end on the sandbox from this lane.** The deterministic parts have tests (43), and these ran for real on a Claude plan without an API key: `explain` and `fix` on the demo shop, `new`, the shopping agent (`ready`), and `explain` over MCP. Commands that move sandbox money (`drill --ui`, `fix --start`, `heal`, `parity`, `events`, `webhook create`) need PayPal sandbox keys, and `parity` also a Stripe test key; they were not run here.
- **`parity` verifies the webhook path only.** It drives real Stripe and PayPal webhooks into both apps and compares business calls. Stripe SDK calls made from the app's own endpoints (checkout, refunds) are not exercised and stay "migrated, unverified". The PayPal dispute scenario only promises `CUSTOMER.DISPUTE.UPDATED`, so dispute parity can show DIFFERENT when `CREATED` does not arrive.
- **Signature verification needs one shared webhook.** Set `PAYPAL_WEBHOOK_ID` (from `paydrill webhook create`) for both paydrill and your app. Without it, paydrill uses a temporary webhook your app cannot verify against, and warns. Backfilled events carry no signature, so a verifying app rejects them.
- **Four fixtures are still docs-shaped.** Five event types are real sandbox recordings (`"_source": "sandbox"`); `PAYMENT.CAPTURE.DENIED`, `PENDING`, `REVERSED` and `CHECKOUT.ORDER.APPROVED` follow PayPal's documented shapes with made-up IDs.
- **Contract gaps.** `EvidencePacket` has no evidence type field, so the type is carried in the notes header. `DrillEvent` has no raw body.
- **`migrate` covers JS and TS one-time payments, refunds, webhooks and idempotency.** Saved customers, metadata and subscriptions are flagged for a human. Connect, Issuing, Terminal, Treasury, Radar and Stripe Tax are refused with the reason.
- **The agent-readiness run stops at PayPal approval.** Buyer approval happens in PayPal's own window, so the agent reports `paypal-approval` rather than completing the purchase.
- **`heal` in CI needs an Anthropic API key.** Claude Code (the no-key path) is not logged in on CI runners.

## License

[MIT](LICENSE)
