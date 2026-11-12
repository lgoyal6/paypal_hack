---
description: Fix the failures from the last paydrill drill on a new branch and prove it by rerunning the drill
argument-hint: "--start \"<command that starts the app>\""
allowed-tools: Bash(npx -y github:lgoyal6/paypal_hack fix:*), Bash(git diff:*), Read
---
Needs `paydrill-result.json` from `/paydrill:drill`. If it is missing, run that first.

Run `npx -y github:lgoyal6/paypal_hack fix --drill paydrill-result.json . $ARGUMENTS`. It writes a patch on a new branch in a separate git worktree (the working tree is not touched). With `--start "<command that starts the app>"` it starts the patched app, reruns the drill, and prints before -> after per check. The user's running app must be stopped first so the rerun hits the patched code; if paydrill says something is already answering on the port, ask them to stop it.

Show the user every check before and after, the diff, and any check still failing, stated first and plainly. Do not merge or switch branches. Ask before applying the branch to their working tree.
