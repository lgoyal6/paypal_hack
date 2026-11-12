# paydrill build plan

The Stripe CLI for PayPal, and the only tool that proves your webhook handler survives real PayPal behavior instead of just linting it.

Built for the PayPal AI Hackathon. Must use PayPal (sandbox) and AI.

## Why this exists

- Stripe has a CLI that forwards real events to localhost (`stripe listen`), fakes any event in one command (`stripe trigger`), replays events, and runs fixtures. PayPal has no CLI.
- PayPal's webhook simulator only posts mock events that "do not correspond to any real event or transaction" and cannot be resent ([PayPal docs](https://developer.paypal.com/api/rest/webhooks/simulator)). It only posts to a public HTTPS URL, so developers need their own tunnel.
- PayPal sandbox webhook delivery is known to delay and drop events ([Hookdeck guide](https://hookdeck.com/webhooks/platforms/guide-to-paypal-webhooks-features-and-best-practices)).
- Developers call payments the worst part of building an app ([r/SaaS](https://www.reddit.com/r/SaaS/comments/168regx/are_payments_the_most_difficult_part_of/), [r/webdev](https://www.reddit.com/r/webdev/comments/168s49h/trying_to_add_payments_to_my_project_is_the_worst/)).

## Research that shapes the plan

1. **PayPal already ships an AI doctor.** Its official AI-Toolkit plugin (Claude Code, Cursor, Codex) has `/paypal:doctor` to scan a codebase for integration issues, plus `/paypal:sandbox` and `/paypal:test-accounts` ([paypal/AI-Toolkit](https://github.com/paypal/AI-Toolkit)). An AI that reads code is not our edge. Our edge is **proof**: real sandbox events hitting your app and showing what breaks. We extend PayPal's ecosystem, not compete with it.
2. **PayPal's MCP server has no testing tools.** Its 43 tools cover orders, refunds, invoices, listing and accepting disputes, and reporting ([PayPal agent tools](https://developer.paypal.com/ai-tools/agent-tools)). Nothing forwards webhooks, creates chargebacks, or drills a handler.
3. **Hookdeck sets the UI bar.** Its CLI defaults to a full-screen terminal UI with event history, keyboard navigation, replay, filters, and `compact` / `quiet` modes for CI ([hookdeck-cli](https://github.com/hookdeck/hookdeck-cli)).
4. **Stripe fixtures** chain API calls from a JSON file ([Stripe docs](https://docs.stripe.com/cli/fixtures)), and users have asked for customizable triggers ([stripe-cli#295](https://github.com/stripe/stripe-cli/issues/295)). Our custom scenarios add assertions on top.

## Product surface

### Easiest possible start

| Step | What happens |
|---|---|
| `npx paydrill` | No install. Bare `paydrill` opens an interactive menu: Listen, Trigger, Drill, Setup. |
| `paydrill init` | Opens the PayPal dashboard, you paste sandbox keys, it verifies them live, stores them in the OS keychain (fallback: config file readable only by you), detects your framework (Express, Next.js, Fastify, FastAPI, Django, Flask) and webhook route, writes `paydrill.yml`. |
| Zero-flag defaults | `paydrill listen` uses the detected route. `paydrill drill` drills the current repo. |

### Commands

| Command | Matches Stripe | Beyond Stripe |
|---|---|---|
| `listen` | `stripe listen` | Signature verified on the way in, backfills events PayPal never delivered, multi-app routing by event type, filters |
| `trigger <scenario>` | `stripe trigger` | Disputes, chargebacks and adjudication |
| `events list / resend / inspect` | `stripe events` | Diff two events |
| `replay <id> [--to url]` | partial | Replay saved events offline |
| `record` / `fixtures` | `stripe fixtures` | Record a real sandbox session into a fixture that replays in CI |
| `drill` | none | Real events, then chaos redelivery (duplicate, out of order, forged unsigned, unknown type), then an AI verdict tied to code lines |
| `fix` | none | AI writes a patch per failure, reruns the drill, shows red to green |
| `ask "<plain English>"` | none | "Refund my last payment and open a dispute on the one before" maps to real sandbox calls, confirmed before running |
| `doctor` | none | Static review that complements `/paypal:doctor` with file and line evidence from the drill |

### Custom commands

Scenarios as code in `paydrill.yml`, with assertions (Stripe fixtures have none):

```yaml
scenarios:
  angry-customer:
    steps:
      - pay: { amount: 49.99 }
      - refund: { partial: 10.00 }
      - chargeback: { reason: not_as_described }
      - adjudicate: buyer
    expect:
      events: [PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED, CUSTOMER.DISPUTE.CREATED, CUSTOMER.DISPUTE.RESOLVED]
      handler: 2xx
      within: 120s
```

Then `paydrill trigger angry-customer`.

- **Plugins:** a JS file in `.paydrill/commands/` becomes a subcommand with a PayPal client and the relay injected.
- **AI-generated scenarios:** `paydrill new "subscription that fails payment twice"` writes the YAML.

### UI

- **Terminal UI with [Ink](https://github.com/vadimdemedes/ink)** (React for CLIs). Live event list on the left, detail pane on the right (payload, headers, signature status, your app's response). Keys: `r` replay, `d` duplicate, `f` forge, `e` AI explain. Drill view with a progress bar per scenario and checks turning green or red live.
- **clack** prompts for the `init` wizard and menus.
- **Local web inspector:** `paydrill listen --ui` opens a localhost page with an event timeline, payloads and one-click replay.
- **Output modes:** `interactive` (default in a TTY), `compact`, `json` (for CI and agents), `quiet`.

### Connectivity

| Connection | Why |
|---|---|
| MCP server (`paydrill mcp`) | Claude Code, Cursor or Codex can trigger events, run drills and read results. Sits next to PayPal's MCP: theirs moves money, ours tests your code. |
| Claude Code / Codex plugin | `/paydrill:drill`, `/paydrill:fix`, packaged like PayPal's AI-Toolkit |
| GitHub Action | Drill on every PR, pass/fail table posted as a PR comment |
| Multi-app routing | Repeatable `--forward-to` with routing, e.g. disputes to `/webhooks/disputes`, payments to `/webhooks/payments` |
| Tunnel options | cloudflared by default, ngrok or your own URL if you have one |
| PayPal AI-Toolkit | If installed, `doctor` reuses its best-practices skill |

## Beyond Stripe: six features Stripe does not have

What Stripe already has (Sessions 2026): an MCP server, account-wide sandboxes, Workbench monitoring of API traffic and integration health, a hosted read-only Stripe Database, and CLI plugins ([Stripe](https://stripe.com/blog/everything-we-announced-at-sessions-2026)). None of the six below appeared in what we checked. Treat "Stripe does not have it" as "not found in their announcements and docs", not as proven.

### 1. `paydrill migrate`: leave Stripe in one command

Point it at an app built on Stripe. It rewrites the payment code for PayPal, then proves the new code behaves the same. Full design in [paydrill migrate: design](#paydrill-migrate-design) below.

### 2. Payment coverage

Like code coverage, but for payment events.

```
paydrill coverage
  handled    6 / 23 event types your account can emit
  missing    PAYMENT.CAPTURE.REVERSED, CUSTOMER.DISPUTE.RESOLVED, PAYMENT.CAPTURE.DENIED, ...
  exercised  4 / 6 handled types were hit by a real drill event
```

- **How:** static detection of which event types the handler switches on (AST first, AI only for unusual dispatch patterns), crossed with the event types the drill actually delivered and the handler answered with 2xx.
- **Output:** terminal table, `coverage.json`, a README badge, and a PR comment from the GitHub Action.
- **Done when:** the demo shop reports its real number, and the number goes up after `paydrill fix`.

### 3. `paydrill types`: real payloads, real types, drift alerts

- Records real sandbox events and generates TypeScript types plus zod validators from their actual shapes.
- Stores a snapshot per event type. On later runs, diffs new events against the snapshot and warns on drift: a field renamed, removed or changed type.
- This is the exact bug in the demo shop: disputes carry `dispute_amount`, not `amount`.
- **Done when:** `paydrill types` writes `paypal-events.ts` from recorded events, and a doctored snapshot triggers a visible drift warning.

### 4. Dispute timeline rehearsal

Runs a full dispute lifecycle and checks the app reacts at every stage:
1. Dispute opened.
2. Dispute escalated.
3. Evidence due.
4. Evidence submitted.
5. Dispute resolved.

```
paydrill rehearse dispute --evidence ai
```

- **How:**
  - Real sandbox disputes via process-chargeback.
  - Escalation timing from the sandbox amount rule: $5 to $5.99 escalates on day 5, $9 to $9.99 on day 9, $11 and up on day 11.
  - `require-evidence` to request evidence.
  - `adjudicate` to decide the outcome.
- **AI step:** drafts the evidence response from the order data (shipping, receipts, messages) and submits it through the Disputes API.
- **Pass/fail:** at each stage the handler must answer 2xx. The report shows a timeline with the app's response at every step.
- **Stripe gap:** Stripe's test clocks only fast-forward subscriptions, not disputes.
- **Done when:** one dispute goes from opened to resolved in the sandbox, with the evidence submitted by the AI visible in the report.

### 5. Agent-readiness test

An AI shopper tries to buy from your local store and reports where AI agents get stuck.

- **How:**
  - A Playwright-driven agent gets a goal, for example "buy the cheapest blue mug under $20".
  - It reports blockers: CAPTCHAs, prices only visible after login, missing structured product data, checkout steps that need a human.
  - It completes the purchase with PayPal in sandbox.
- **Output:** an agent-readiness score and a list of blockers, each with a fix.
- **Why:** PayPal is pushing agentic commerce ("agent ready"). This tells a merchant whether agents can actually buy from them. It aims the project at the Agentic Commerce prize too.
- **Done when:** the agent buys from the demo store in sandbox, and fails visibly on a version with a planted blocker.

### 6. Self-healing PRs

- When the drill fails in CI, the GitHub Action runs `paydrill fix` on a new branch and opens a PR.
- The PR body contains the failing drill (red) and the rerun (green) as proof.
- It never pushes to the main branch and never merges; a human reviews.
- **Done when:** a failing PR on the demo repo produces a fix PR whose own CI run is green.

## paydrill migrate: design

The goal is a migration that is provably correct for what it claims, and loudly honest about everything else.

### Supported scope (v1)

| Stripe | PayPal | Status |
|---|---|---|
| PaymentIntents / Checkout Session, one-time payment | Orders v2 create + capture | Supported |
| Stripe.js Elements / Payment Element (card form) | PayPal JS SDK Buttons + Card Fields | Supported |
| Refunds (full and partial) | `POST /v2/payments/captures/{id}/refund` | Supported |
| `stripe.webhooks.constructEvent` | `POST /v1/notifications/verify-webhook-signature` | Supported |
| `payment_intent.succeeded`, `checkout.session.completed` | `PAYMENT.CAPTURE.COMPLETED` | Supported |
| `charge.refunded` | `PAYMENT.CAPTURE.REFUNDED` | Supported |
| `charge.dispute.created` / `charge.dispute.closed` | `CUSTOMER.DISPUTE.CREATED` or `UPDATED` / `CUSTOMER.DISPUTE.RESOLVED` | Supported. Parity for dispute closed is verified on a real resolved sandbox dispute from the dispute pool (see below), never on a simulated event. |
| `Idempotency-Key` header | `PayPal-Request-Id` header | Supported |
| Amounts in integer minor units (`1200`) | Decimal strings (`"12.00"`), zero-decimal currencies like JPY handled | Supported, deterministic conversion with tests |
| `metadata` | `custom_id` / `invoice_id` (127 characters max) | Partial: flag anything that does not fit |
| Customers + saved cards | Vault (payment method tokens) | Partial: flagged for human review |
| Subscriptions, Prices, Products | Catalog Products + Billing Plans + Subscriptions | Partial: no proration, metered billing or coupon parity, so flagged |
| Connect, Issuing, Terminal, Treasury, Radar rules, Stripe Tax, Billing portal | none | Not supported: refused with the reason |

### How it stays sound

1. **Inventory first, deterministically.** Parse the code with an AST (ts-morph / Babel) and list every Stripe SDK call, webhook event type, and Stripe.js usage, with file and line. No AI in this step, so nothing is missed or invented.
2. **Classify every item** against the table: supported, partial, or not supported. Print the inventory before touching any code.
3. **Deterministic codemods for supported items.** Mechanical rewrites (amount conversion, headers, event-type mapping, signature verification) are codemods, not model output.
4. **AI only for glue.** The model writes the code a codemod cannot (restructuring a checkout flow, wiring the PayPal JS SDK). It is constrained to the mapping table, and every AI edit must type-check (`tsc`) and pass the parity drill or it is rolled back.
5. **Parity drill proves behavior.**
   - For every Stripe flow in the inventory, run the original app in Stripe test mode (Stripe CLI `trigger`).
   - Run the migrated app against real PayPal sandbox events (paydrill `trigger`).
   - Spy on the app's own business functions (for example `fulfillOrder`, `markRefunded`), and require the same calls with the same arguments in both runs, with amounts normalized.
   - Same business effect for the same scenario means parity. HTTP 200 alone does not count.
6. **Dispute parity on real resolutions only.** A real `CUSTOMER.DISPUTE.RESOLVED` takes 30+ minutes in sandbox, so the parity run uses `paydrill disputes prepare` started ahead of time. The parity harness seeds the migrated app's order store with the pooled dispute's capture id (`disputed_transactions[0].seller_transaction_id`), adjudicates it, and requires the same business call (for example `markDisputeLost(orderId, amount)`) as the Stripe run with `charge.dispute.closed`. A PayPal-simulated event never counts toward parity: an item whose only evidence is simulated stays "Migrated, unverified".
7. **Never in place.** Work happens on a new git branch. The output is a diff plus `MIGRATION_REPORT.md`. Nothing is committed to the user's main branch.
8. **Honest exit code.** Non-zero unless every item is Verified. `--allow-partial` downgrades this to a warning, still listing every gap.

### The migration report

Every inventory item lands in exactly one bucket:

| Bucket | Meaning |
|---|---|
| Verified | Migrated, and the parity drill proved the same business effect |
| Migrated, unverified | Code rewritten, but no parity scenario could exercise it |
| Needs human | Partial mapping; the report says exactly what differs and what to decide |
| Not migrated | Unsupported or failed; the Stripe code is left untouched and the reason is stated |

The CLI prints the four counts in color at the end. A run is never summarized as "migrated" unless every item is Verified.

### Demo target

A small open-source Stripe sample app (a candidate is `stripe-samples/accept-a-payment`; confirm its license before using it), migrated live, with the parity drill showing the same fulfillment calls on Stripe and on PayPal.

### Fallback

If full migration is not reliable by the P1 checkpoint, ship `paydrill migrate --plan`. It runs the inventory and classification, prints the diff it would apply, and produces the report with every item marked "Migrated, unverified" or worse, and says so.

### Rules for the AI agent building `migrate`

Any agent (Claude, Codex, or a teammate's tool) working on this command must follow these:

1. Never report `migrate` as working without pasting the parity drill output from a real run: Stripe test mode on one side, PayPal sandbox on the other.
2. If any mapping fails, say so at the top of the status update, in plain words: what failed, the error, and which report bucket it landed in. Do not bury it under what worked.
3. Never mock the PayPal side, never fake a parity result, never weaken an assertion to make a run pass, and never silently drop a Stripe feature from the inventory.
4. If something only works in a narrower case than claimed (for example, one-time payments only), state the narrower claim in the README and in the CLI output.
5. If blocked (missing keys, a sandbox endpoint failing, a license question), stop and ask instead of working around it.
6. Keep the "Known gaps" section of the README current with every failure found.

## Pressure test

| Test | Result |
|---|---|
| Remove PayPal | Breaks. Every trigger is real sandbox money movement. |
| Closest neighbors | `/paypal:doctor` (static only), Hookdeck CLI (forwarding only, no PayPal triggers), Stripe CLI (wrong platform). Gap: real-event drills, chaos, fix-then-prove. |
| Failure on screen | Forged payment accepted, dispute crash, unknown event 500. |
| Crowding | Few teams will build dev tools; most will build shopping agents. |
| Truth source | Real PayPal sandbox events with real signatures. AI explains; pass/fail comes from HTTP results and assertions, never from the model. |
| Biggest risk | Scope. See build order. |
| Second risk | Buyerless card capture in sandbox is unverified. |

## Build order

**P0, hard boundary (must all work):**
1. Sandbox keys work; card capture with no buyer.
2. Chargeback creates a dispute.
3. Real events reach localhost through the tunnel.
4. One drill end to end on the demo shop.

**P1, what wins:**
- Ink terminal UI.
- `init` wizard and zero-flag defaults.
- `paydrill.yml` scenarios with assertions.
- `fix` with the red to green rerun.
- Payment coverage and `paydrill types` (cheap, visual).
- Dispute timeline rehearsal.
- `paydrill migrate`: inventory, codemods and parity drill on the demo target. Checkpoint: if not reliable, ship `migrate --plan`.
- MCP server.

**P2, connectivity polish:**
- GitHub Action with PR comment and coverage badge.
- Self-healing PRs.
- Web inspector.
- `ask`.
- `record` / `replay`.
- Claude Code plugin.

**P3, only if solid:**
- Agent-readiness test (move up if we target the Agentic Commerce prize).
- Multi-app routing.
- Alternative tunnels.
- Subscriptions in `migrate`.

**Not now:**
- Live mode.
- Time travel for subscriptions (PayPal has no equivalent of Stripe's test clocks).
- A hosted relay server.
- Slack or Discord notifications. Developers are in the terminal, and the GitHub Action already reports in the PR.

## Demo script (under 3 minutes)

| Time | Beat |
|---|---|
| 0:00 | Problem: PayPal has no CLI, its simulator sends fake events, developers ship broken webhooks. |
| 0:20 | `npx paydrill init`: wizard detects the Express app. |
| 0:40 | `paydrill trigger dispute`: a real chargeback event lands in the terminal UI. |
| 1:10 | `paydrill drill`: red. Forged payment accepted, dispute crash, unknown event 500. Claude names the lines. |
| 1:40 | `paydrill fix`: patch applied, rerun goes green, coverage climbs. |
| 2:00 | `paydrill migrate` on a Stripe sample app: inventory, diff, parity drill shows the same fulfillment calls on Stripe and PayPal, report with honest buckets. |
| 2:35 | The GitHub Action posts coverage and a self-healing PR. |
| 2:50 | Close: Stripe's CLI helps you build on Stripe. paydrill helps you build on PayPal, and leave Stripe in one command. |

## Checkpoints and kill conditions

- **Card capture fails without a buyer:** triggers become "approve once in the browser, automate the rest".
- **Chargeback endpoint fails:** drop dispute scenarios, fall back to refunds plus simulator dispute events, labeled as simulated.
- **Ink UI not solid by the P1 checkpoint:** ship compact mode plus the web inspector.
- **MCP flaky:** the GitHub Action carries the connectivity story.
- **`migrate` parity not proven on the demo target:** ship `migrate --plan`, and say in the video and README that full migration is unverified.
- **Dispute rehearsal stalls at a stage (no `adjudicate` link offered):** show the timeline up to that stage and label the rest as not reachable in sandbox.
- **Agent shopper cannot complete a sandbox PayPal checkout:** keep the readiness report (blockers found) and drop the purchase step.

## Open questions

1. Position as a companion to PayPal's AI-Toolkit, or standalone? (Companion is the stronger pitch to PayPal judges.)
2. Stay on Node for Ink, or move to Go with Bubble Tea?
3. Which UI leads the video: terminal UI, web inspector, or both?
4. Team split: not decided yet.
