---
description: Show which PayPal event types this project handles and which a real drill exercised
allowed-tools: Bash(npx -y github:lgoyal6/paypal_hack coverage:*)
---
Run `npx -y github:lgoyal6/paypal_hack coverage . --drill paydrill-result.json` (leave out `--drill` if there is no result file yet) and show its table. List the missing event types that matter most for a store (refunds, reversals, denials, disputes) and offer to add handlers for them. Types marked "simulated by PayPal" were exercised only with PayPal's mock payloads; say so.
