---
description: Drill this project's PayPal webhook handler with real sandbox events and report what breaks
argument-hint: "--forward-to <handler url> [--scenarios payment,refund]"
allowed-tools: Bash(npx -y github:lgoyal6/paypal_hack drill:*), Bash(npx -y github:lgoyal6/paypal_hack explain:*), Read
---
Run a paydrill drill against this project and explain the result.

1. Run `npx -y github:lgoyal6/paypal_hack drill $ARGUMENTS --output json --out paydrill-result.json`. It sends real PayPal sandbox events to the local app, then replays them duplicated, out of order, forged and with an unknown type. It takes a few minutes. If `--forward-to` is missing and there is no paydrill.yml, ask the user for their webhook handler URL first.
2. Pass or fail for each check comes from HTTP results. Never call a failed check passed.
3. If anything failed, run `npx -y github:lgoyal6/paypal_hack explain --drill paydrill-result.json .` and report its findings: check, event type, what the app answered, and the file and line (open the file to confirm the line).
4. End with one line: ship, or fix first. If fix first, suggest `/paydrill:fix`.

If sandbox keys are missing, tell the user to run `npx -y github:lgoyal6/paypal_hack init` and stop.
