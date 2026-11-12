# Demo script (under 3 minutes)

Record only real runs: real sandbox events, real Claude output. Say on screen that the demo shop's bugs were planted.

| Time | Beat | On screen |
|---|---|---|
| 0:00 | PayPal has no CLI; its simulator sends fake events; webhook bugs ship. | PayPal simulator page, then the demo shop's handler |
| 0:20 | Setup in one command. | `npx paydrill init` detects the Express app |
| 0:40 | A real chargeback arrives in the terminal. | `paydrill trigger dispute` |
| 1:10 | The drill goes red: forged payment accepted, dispute crash, unknown event 500, double shipping. Claude names the lines. | `paydrill drill`, then `doctor` showing PROVEN risks |
| 1:40 | The fix lands on a branch and the rerun goes green; coverage climbs. | `paydrill fix`, then `coverage` before and after |
| 2:00 | Leave Stripe: inventory, diff, parity on Stripe and PayPal, honest buckets. | `paydrill migrate` on examples/stripe-shop, MIGRATION_REPORT.md |
| 2:35 | CI posts coverage and opens a self-healing PR. | The PR body's before/after table |
| 2:50 | Close. | "Stripe's CLI helps you build on Stripe. paydrill helps you build on PayPal, and leave Stripe in one command." |

## Before recording

- [ ] Both kill checks passed in the sandbox (card capture with no buyer, chargeback opens a dispute).
- [ ] Every AI command has been run once with a real API key (see Known gaps in the README).
- [ ] `examples/demo-shop` reset: `git checkout examples/demo-shop` so the planted bugs are back.
- [ ] No keys visible in the terminal or `.env` on screen.

## Title cards with OpenMotion

The video's opening and closing cards can be made in [OpenMotion](https://openmotion.design/how-to-use) (it drives Claude Code). Its guide asks for story, timing, look and finish in one prompt:

> Create a 2-scene, 16:9 title sequence for a developer tool called paydrill, 8 seconds total. Scene 1 (4s): on a white background with a faint violet glow at the top, a black terminal card slides up and types `paydrill drill`; five check rows appear and turn red one by one. Scene 2 (4s): the rows flip to green in a quick cascade, the card shrinks to the left, and the line "Stripe's CLI helps you build on Stripe. paydrill helps you build on PayPal." types in beside it in heavy, tightly tracked black type. Violet accent #6848e8, system sans-serif, calm ease-out motion. End on the paydrill wordmark.

Export as video for the demo, or as HTML for the README.
