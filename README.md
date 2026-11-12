# paydrill

The Stripe CLI for PayPal. paydrill sends real PayPal sandbox events to the app on your machine, replays them the way PayPal really behaves (duplicates, out of order, forged, unknown types), and shows exactly what breaks. Claude then explains each failure down to the line, writes the fix on a new branch, and proves it by running the drill again.

It also does what Stripe's CLI does not: it measures payment coverage, generates types from real events, rehearses a full dispute with AI-written evidence, tests whether AI shopping agents can buy from your store, and migrates a Stripe app to PayPal with an honest report of what was verified.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Plan: [PLAN.md](PLAN.md). Team split: [TEAM.md](TEAM.md). Lane interfaces: [CONTRACT.md](CONTRACT.md).

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

Requires Node 22.6+ and git. The AI features need an Anthropic API key; the PayPal features need sandbox keys from the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).

```bash
npm install
cp .env.example .env   # PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, ANTHROPIC_API_KEY
npm run build
npm test
```

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

Failures and limits first. This section is kept current with every failure found.

- **The AI features have not been run against the live Claude API yet.** No API key was available while building the AI lane. Requests reach the API (a fake key returns 401), and every deterministic part is tested, but no real verdict, fix, evidence draft, migration glue or shopper run has been produced. Run them with a key before recording the demo.
- **The AI commands have not been run end to end with a live drill.** The PayPal lane and the AI lane are both on main and wired into one CLI, but `drill --project`, `explain` and `fix` have not yet run together against the sandbox with a real Claude key. Migrate parity runs (Stripe test mode against PayPal sandbox) are not built yet.
- **Four fixtures are still docs-shaped.** Five event types are real sandbox recordings (`"_source": "sandbox"`); `PAYMENT.CAPTURE.DENIED`, `PENDING`, `REVERSED` and `CHECKOUT.ORDER.APPROVED` still follow PayPal's documented shapes with made-up IDs.
- **Contract gaps to fix after merging.** `EvidencePacket` has no evidence type field, so the type is carried in the notes header. `DrillEvent` has no raw body, which forged-event replay needs. The developer's app verifies signatures against its own webhook ID, which must match the one paydrill creates. The verdict is computed from checks inside the current contract, not by the model.
- **`migrate` covers JS and TS one-time payments, refunds, webhooks and idempotency.** Saved customers, metadata and subscriptions are flagged for a human. Connect, Issuing, Terminal, Treasury, Radar and Stripe Tax are refused with the reason. A migration is only called Verified when a parity drill shows the same business calls on Stripe and PayPal; without parity runs every item is "migrated, unverified" or worse.
- **The agent-readiness run stops at PayPal approval.** Buyer approval happens in PayPal's own window, so the shopper reports `paypal-approval` rather than completing the purchase.
- **The migrated `paypal.js` helper is syntax-checked, not yet run against the sandbox.**

## License

[MIT](LICENSE)
