# Team split

Split by key: whoever holds a key owns everything that calls it. Key-free work is split to balance the load.

| | Key | Owns |
|---|---|---|
| **Laksh** | PayPal sandbox | Every PayPal call: client, triggers, relay, rehearsal sandbox side, `migrate` parity runs, plus UI, MCP and the GitHub Action |
| **Tijil** | Anthropic | Every Claude call: review, verdict, fix, doctor, evidence drafting, `migrate` glue, `ask`, plus coverage, types, `migrate` inventory and the demo shop |

Interfaces between the two lanes: [CONTRACT.md](CONTRACT.md). Full plan: [PLAN.md](PLAN.md).

## Branches

Every branch starts with the owner's name and the phase:

```
<owner>-phase<N>-<feature>
```

Examples:
- `laksh-phase0-paypal-client`
- `laksh-phase0-relay`
- `tijil-phase0-ai-verdict`
- `tijil-phase1-migrate-inventory`
- `tijil-phase2-self-healing-pr`

Rules:
- One branch and one PR per feature. Never push to `main` directly.
- Merge with **rebase**, never squash: `gh pr merge --rebase`. Keep commits small and meaningful, since they all land on `main`.
- Pull `main` often so `src/contract.ts` never drifts.
- A branch named for one owner is only pushed to by that owner. To help, open a PR against it instead.
- Never commit `.env`.

## Folders

| Laksh | Tijil |
|---|---|
| `src/paypal/` | `src/ai/` |
| `src/relay/` | `src/coverage/` |
| `src/scenarios/` | `src/types-gen/` |
| `src/ui/` | `src/migrate/` |
| `src/mcp/` | `examples/` |
| `action/` | `fixtures/` (docs samples until Laksh's recordings land) |
| `bin/` and project scaffold | |

`src/contract.ts` is shared and changes only by a PR both of you approve.

## Phase 0: hard boundary

| # | Task | Owner | Branch |
|---|---|---|---|
| 1 | Scaffold: TypeScript, build, CLI entry, `.env` loading | Laksh | `laksh-phase0-scaffold` |
| 2 | PayPal client implementing `PayPalClient` | Laksh | `laksh-phase0-paypal-client` |
| 3 | Triggers: payment, refund, dispute, dispute-lost | Laksh | `laksh-phase0-triggers` |
| 4 | Tunnel, relay, `listen`, backfill, signature check | Laksh | `laksh-phase0-relay` |
| 5 | Record real events into `fixtures/events/` | Laksh | `laksh-phase0-fixtures` |
| 6 | Chaos replay: duplicate, out of order, forged, unknown type | Laksh | `laksh-phase0-chaos` |
| 7 | `AI.review` and `AI.verdict` against fixtures | Tijil | `tijil-phase0-ai-verdict` |
| 8 | Demo shop with four planted bugs | Tijil | `tijil-phase0-demo-shop` |
| 9 | Docs-sample fixtures for every event type we use | Tijil | `tijil-phase0-fixtures-docs` |
| merge | One `drill` end to end on the demo shop: real events and a real AI verdict | Both | `laksh-phase0-drill` |

**Kill checks, Laksh, first thing:** buyerless card capture, and chargeback opening a dispute. Post pass or fail for each in the group chat and in the PR.

## Phase 1: what wins

| Task | Owner |
|---|---|
| Ink terminal UI (listen and drill views) | Laksh |
| `init` wizard, framework and route detection | Laksh |
| `paydrill.yml` scenario engine with assertions | Laksh |
| Dispute rehearsal: sandbox side | Laksh |
| `migrate` parity runs (Stripe test mode vs PayPal sandbox) | Laksh |
| MCP server | Laksh |
| Dispute rehearsal: AI evidence drafting | Tijil |
| `fix`: patch generation (Laksh's drill does the rerun) | Tijil |
| `doctor` | Tijil |
| Payment coverage | Tijil |
| `paydrill types` (types, validators, drift alerts) | Tijil |
| `migrate`: inventory, classification, codemods, report, AI glue | Tijil |

## Phase 2: connectivity

| Task | Owner |
|---|---|
| GitHub Action with PR comment and coverage badge | Laksh |
| Web inspector | Laksh |
| `record` / `replay` | Laksh |
| Self-healing PRs | Tijil |
| `ask` | Tijil |
| Claude Code plugin | Tijil |

## Phase 3: stretch

| Task | Owner |
|---|---|
| Agent-readiness test: shopper agent | Tijil |
| Agent-readiness test: sandbox checkout side | Laksh |
| Multi-app routing, alternative tunnels | Laksh |
| Subscriptions in `migrate` | Both |

## Ship

| Task | Owner |
|---|---|
| Record the demo video (needs real sandbox runs) | Laksh |
| Demo script, README, Devpost, Known gaps | Tijil |
| Final pass on the video | Both |

## Sync points

You only need each other at three moments:
1. **Laksh pushes real recorded events.** Tijil swaps docs samples for real payloads and reruns his tests.
2. **First end-to-end `drill`.** Needs Laksh's PayPal half and Tijil's AI half merged.
3. **`migrate` parity.** Tijil's inventory and patches meet Laksh's sandbox runs.

Once Tijil has his own sandbox app, he can run full drills himself and sync point 2 stops blocking.

## Status updates

Post in the group chat when a branch merges or a kill check resolves. Failures go first, in plain words: what failed, the error, what is blocked by it.
