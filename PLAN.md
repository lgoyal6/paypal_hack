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
- MCP server.

**P2, connectivity polish:**
- GitHub Action with PR comment.
- Web inspector.
- `ask`.
- `record` / `replay`.
- Claude Code plugin.

**P3, only if solid:**
- Multi-app routing.
- Alternative tunnels.
- Subscriptions.

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
| 1:50 | `paydrill fix`: patch applied, rerun goes green. |
| 2:20 | Claude Code drives paydrill over MCP; the GitHub Action posts a PR comment. |
| 2:45 | Close: PayPal's sandbox, finally better than Stripe's. |

## Checkpoints and kill conditions

- **Card capture fails without a buyer:** triggers become "approve once in the browser, automate the rest".
- **Chargeback endpoint fails:** drop dispute scenarios, fall back to refunds plus simulator dispute events, labeled as simulated.
- **Ink UI not solid by the P1 checkpoint:** ship compact mode plus the web inspector.
- **MCP flaky:** the GitHub Action carries the connectivity story.

## Open questions

1. Position as a companion to PayPal's AI-Toolkit, or standalone? (Companion is the stronger pitch to PayPal judges.)
2. Stay on Node for Ink, or move to Go with Bubble Tea?
3. Which UI leads the video: terminal UI, web inspector, or both?
4. Team split: not decided yet.
