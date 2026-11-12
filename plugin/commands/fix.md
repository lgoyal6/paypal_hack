---
description: Fix the failures from the last paydrill drill on a new branch and prove it by rerunning the drill
allowed-tools: Bash(npx paydrill fix:*), Bash(npx paydrill drill:*), Bash(git diff:*), Read
---
Run `npx paydrill fix --output json`. It writes a patch on a new branch in a separate git worktree (your working tree is not touched), reruns the drill on that branch, and reports red to green per check.

Show the user:
- each check before and after,
- the diff (`git diff <base>...<branch>`),
- any check still failing, stated first and plainly.

Do not merge or switch branches. Ask the user before applying the branch to their working tree.
