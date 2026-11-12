# Devpost submission draft

## Inspiration
Stripe developers get a CLI that forwards real events, fakes any event in one command and replays them. PayPal developers get a simulator that sends mock events matching no real transaction. So PayPal webhook handlers ship with the bugs that cost merchants money: no signature check, double fulfilment, crashes on disputes.

## What it does
paydrill sends real PayPal sandbox events to your local app, then replays them the way PayPal really behaves: duplicated, out of order, forged and with unknown types. Every check passes or fails on the HTTP result. Claude explains each failure down to the file and line, writes the fix on a new branch and proves it by rerunning the drill.

Beyond Stripe's CLI: payment coverage, types and drift alerts from real events, a full dispute rehearsal with AI-drafted evidence, an agent-readiness test for agentic commerce, self-healing PRs, and `paydrill migrate`, which moves a Stripe app to PayPal and reports honestly what was verified.

## How we built it
TypeScript on Node. PayPal Orders v2, Payments v2, Disputes v1 (including the sandbox chargeback, require-evidence and adjudicate endpoints) and Webhooks v1. Claude (`claude-opus-5-5`) through the Anthropic SDK with zod-validated structured outputs. The TypeScript compiler API for coverage and the migration inventory. Playwright with Chrome for the shopping agent.

## Tools and how we used them
- **Claude (Anthropic API):** review, verdict explanations, fixes, dispute evidence, migration glue, plain-English sandbox commands, and the shopping agent. Pass/fail and readiness scores never come from the model.
- **PayPal sandbox:** every event in a drill is a real sandbox event with a real signature.

## Challenges
<!-- fill in after the build -->

## What's next
<!-- fill in after the build -->
