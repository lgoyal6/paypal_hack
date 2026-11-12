---
description: Drill this project's PayPal webhook handler with real sandbox events and report what breaks
argument-hint: "[scenario] (default: all)"
allowed-tools: Bash(npx paydrill drill:*), Read
---
Run a paydrill drill against this project and explain the result.

1. Run `npx paydrill drill $ARGUMENTS --output json` and wait for it to finish. It sends real PayPal sandbox events to the local app, then replays them as duplicates, out of order, forged and with unknown types.
2. Read the JSON. Pass or fail for each check comes from HTTP results. Never call a failed check passed.
3. Report failures first: the check, the event type, what the app answered, and the file and line responsible (open the file to confirm the line).
4. End with one line: ship, or fix first. If there are failures, suggest `/paydrill:fix`.

If the command fails because sandbox keys are missing, tell the user to run `npx paydrill init` and stop.
