# paydrill

**Bring real PayPal webhooks to localhost. Find the line that broke. Review the fix.**

Built by Tijil Chhabra and Laksh Goyal for the PayPal AI Hackathon.

## Inspiration

Stripe CLI made listening to and triggering webhooks a normal part of local development. We wanted a comparable workflow for PayPal, then asked what a developer needs after the first failure. A 500 tells you something went wrong. It takes a long time to figure out which payload field, missing branch, or delivery assumption caused it.

Paydrill closes that loop. It brings PayPal sandbox events to a running local app, records what actually happened, and gives Claude the evidence it needs to explain the failure and propose a reviewable code change.

## What it does

| Workflow | What you can do |
| --- | --- |
| **Set up** | Validate sandbox credentials, discover a framework and webhook route, write `paydrill.yml`, and store keys in the OS keychain when available. Check the sandbox connection and manage webhook registrations. |
| **Listen** | Open a tunnel or use your own HTTPS URL. Forward events to localhost, verify signatures at the relay, distinguish backfill from live traffic, and route event types across multiple apps. Inspect events in the Ink terminal UI or browser inspector. |
| **Trigger and inspect** | Run payments, full and partial refunds, and dispute scenarios. List, inspect, diff, and request redelivery of events. Record a session and replay recorded events or labeled fixtures. |
| **Make tests repeatable** | Run drills with expected event types, timing constraints, and handler-response checks. Follow live progress, export JSON or Markdown, and use compact or quiet output in CI. Draft a validated YAML scenario from plain English. |
| **Diagnose and fix** | Explain a failed check down to a file and line. Run static review with optional PayPal AI Toolkit guidance. Generate a diff in a separate worktree, review it, and optionally rerun the drill against the patched app. |
| **Rehearse disputes** | Prepare test cases, follow a sandbox dispute through its stages, and draft seller notes and a PDF timeline from order facts. |
| **Measure coverage** | See which event types the handler recognizes and which a saved drill exercised. Distinguish simulated deliveries, export JSON, and generate a badge. |
| **Generate types** | Create TypeScript types and Zod validators from event samples. Compare snapshots for payload drift. |
| **Work from your editor or CI** | Use the MCP server and Claude Code plugin. Get a drill and coverage report on a GitHub PR. An optional healing workflow proposes a repair PR after a passing rerun. Add local command plugins. |
| **Ask** | Translate natural language into a previewable sandbox plan and confirm the calls before execution. |
| **Move from Stripe** | Inventory the integration by file and line, preview codemods and AI-assisted changes, and put changes on a separate branch. The report distinguishes unsupported, manual, rewritten, and verified items. The parity runner compares webhook-path business effects across test environments. |
| **Test agent readiness** | Run a browser agent against a storefront. See if it finds the right product, reads the price, and reaches PayPal approval. Diagnose friction such as hidden prices, missing structured data, and human verification challenges. |

## What we verified

- **Live PayPal proof.** A $12 sandbox payment produced a live `PAYMENT.CAPTURE.COMPLETED` delivery. The relay verified the signature and the demo shop returned HTTP 200 in 24 ms. The shop logged a fulfillment call. The order ID was absent, so this verifies delivery and the handler response.
- **Sandbox disputes.** A test card capture and chargeback opened a sandbox dispute. A signed dispute update reached the original demo shop and returned HTTP 500.
- **Failure to proposed patch.** In a separate recorded-dispute replay, Claude found that the demo handler reads `resource.amount` where the payload provides `resource.dispute_amount`. Paydrill generated a patch on a separate branch. A fresh signed dispute rerun against the patched app is pending.
- **Agent readiness.** The clean shop scored 80/100 and reached PayPal approval with a $14 blue mug. The blocked version scored 20/100. Buyer approval is the stopping point.
- **Build verification.** The CLI builds, type-checks, and passed 43 tests in the last verified run. We exercised the Claude Code fallback, including MCP explanation and scenario generation, without a separate Anthropic API key.

The project supports live, backfilled, simulated, and replayed events. Reports label their origin. Stripe-to-PayPal parity and the credentials-enabled GitHub Action run remain unverified.

## How we built it

Node.js and TypeScript power the CLI. PayPal Orders, Payments, Disputes and Webhooks APIs handle sandbox payments, refunds, test disputes, registration and signature verification. Cloudflare Tunnel or a user-supplied HTTPS URL routes events to localhost. Ink drives the terminal UI. Playwright drives the readiness browser.

Claude uses structured outputs validated with Zod for scenario generation, failure explanations, proposed edits, evidence, migration glue and shopping decisions. The Claude Code path can use an existing signed-in plan for local runs. Drill assertions come from observed behavior. A proposed patch lives on its own branch, and the migration report reserves “verified” for an exercised parity result.

**AG Grid Community** powers the website’s recorded event explorer. Judges can search, sort and select deliveries to inspect signature and handler results. The site replays a scrubbed record in the browser. The CLI quick start provides the runnable PayPal integration.

**Render** hosts the interactive demo as a public static site built directly from the GitHub repository. Judges can open it without signing in or setting up credentials. The repository also includes a Render Blueprint.

## Challenges

Sandbox delivery can arrive late, and a retry can be mistaken for a new event. We preserve delivery source and use explicit event expectations. Disputes introduce an additional problem: opening, evidence, and adjudication may advance on different sandbox schedules. Paydrill can prepare a pool of test cases and filters the rehearsal timeline to the relevant case.

Migration requires more than renaming SDK calls. We distinguish missing product equivalents, unsupported flows, and behavior that still needs verification. The sample Stripe integration deliberately includes Stripe Tax to make that boundary visible.

## What's next

Verify the entire repair flow on a fresh signed dispute. Run the migration parity comparison with both test providers configured, then expand its coverage from webhook effects to checkout and refund endpoints. Run the credentials-enabled GitHub Action against the demo shop and capture its PR output.

## Try it

- **Source and setup:** https://github.com/lgoyal6/paypal_hack
- **Interactive site:** https://paydrill-demo.onrender.com/
- **Demo video:** upload the final 2:36 cut as a public YouTube video and paste its URL into Devpost.

```sh
npx -y github:lgoyal6/paypal_hack scenarios
```
