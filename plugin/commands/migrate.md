---
description: Plan or run a Stripe to PayPal migration of this project, with an honest report
argument-hint: "[--plan]"
allowed-tools: Bash(npx paydrill migrate:*), Read
---
Run `npx paydrill migrate $ARGUMENTS`. It never edits the working tree: a real run writes to a new branch with MIGRATION_REPORT.md; `--plan` writes nothing.

Report the four counts (not migrated, needs human, migrated but unverified, verified), failures first. Never describe the migration as complete unless every item is Verified. Open MIGRATION_REPORT.md and walk the user through the "Needs human" items.
