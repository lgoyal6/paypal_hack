# Contract

How Laksh's code and Tijil's code talk to each other. Agreed before either lane codes, so both can build in parallel and merging is plugging in, not rewriting.

The source of truth is [`src/contract.ts`](src/contract.ts). This file explains it.

## Who produces what

```
Laksh (PayPal key)                         Tijil (Anthropic key)
------------------                         ---------------------
PayPalClient  ─── real sandbox calls
relay/listen  ─── DrillEvent[]
drill         ─── DrillResult ───────────▶ AI.verdict()  ──▶ Verdict
                                           AI.review()   ──▶ Review ──▶ drill picks scenarios
                                           AI.fix()      ──▶ Patch ───▶ drill reruns (red to green)
rehearse      ─── dispute data ──────────▶ AI.draftEvidence() ──▶ EvidencePacket ──▶ PayPalClient.submitEvidence()
migrate parity ── ParityResult ◀────────── migrate inventory / MigrateItem[] (Tijil)
```

## Rules

1. **Money is a decimal string** (`"12.00"`), never a float and never cents. Stripe's integer minor units are converted only inside `migrate`.
2. **PayPal events are never reshaped.** `PayPalEvent` is exactly what PayPal sent. Anything paydrill adds goes in `DrillEvent`, around the event.
3. **Pass or fail is never decided by the AI.** `CheckResult.pass` comes from HTTP results and assertions. The AI explains and suggests fixes only.
4. **Errors are thrown, not swallowed.** PayPal failures throw `PayPalError` with the HTTP status and PayPal's `debug_id`.
5. **Patches are unified diffs applied on a branch,** never written straight into the user's working tree.
6. **Simulated is always labeled.** When the sandbox cannot produce an event for real (today: `CUSTOMER.DISPUTE.RESOLVED`), paydrill may ask PayPal's own webhook simulator for it. Those deliveries carry source `paypal-simulated`, the scenario lists them in `simulated`, and every report, UI and the video say "simulated by PayPal" next to them. The simulated payload is PayPal's mock, not tied to the scenario's real dispute.
7. **No other mocks in the demo or in claims.** Fixtures are for development only. See the `migrate` agent rules in [PLAN.md](PLAN.md#rules-for-the-ai-agent-building-paydrill-migrate).

## Fixtures

- `fixtures/events/<EVENT_TYPE>.json`: one `PayPalEvent` per file.
- Until Laksh records real sandbox events, these are PayPal's documented example payloads, with `"_source": "docs"` added at the top level.
- Real recordings replace them with `"_source": "sandbox"`. Events from PayPal's webhook simulator use `"_source": "paypal-simulator"`. Tijil's code must not depend on `_source`.

## Environment

| Variable | Owner | Used by |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Laksh | `PayPalClient` |
| `ANTHROPIC_API_KEY` | Tijil | `AI` |
| `PAYDRILL_MODEL` (optional) | Tijil | `AI`, defaults to a current Claude model |

Keys live in `.env`, which is gitignored. Never commit them, never paste them in issues, PRs or chat.

## Changing the contract

Open a PR that touches only `src/contract.ts` and this file. Both of you approve it before merging. Say in the PR which side has to change.
