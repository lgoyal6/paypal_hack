# paydrill video: OpenMotion brief

OpenMotion makes the motion pieces. Real screen recordings (actual sandbox runs, actual Claude output) get cut in between them. Judges need to see the product working, so the motion frames the proof and never replaces it.

Total runtime: 2:50. Motion pieces: about 45 seconds. Screen recordings: about 2:05.

## Look: "feels like PayPal" without using their logo

The hackathon rules forbid third-party trademarks without permission, so use PayPal's *feel*, not its marks. No PayPal logo, no double-P monogram, no yellow PayPal button artwork.

| Token | Value | Use |
|---|---|---|
| Deep navy | `#001C64` | Backgrounds of dark scenes, headline type on light scenes |
| PayPal blue | `#0070E0` | Accent, progress, links, the "money moving" line |
| Bright blue | `#60CDFF` | Highlights, glows, particles |
| White | `#FFFFFF` | Light scene backgrounds, type on navy |
| Fail red | `#E5484D` | Failed checks only |
| Pass green | `#2DBE6C` | Passing checks only |

- **Type:** a clean geometric sans, heavy weight for headlines with tight tracking, regular weight for body text. Monospace for anything terminal.
- **Motion character:** confident and calm, the way a payment *should* feel. Fast ease-out entrances, nothing bouncy. One signature move: a thin blue line that travels across the frame like money moving between two points. Use it as the transition in every piece.
- **Sound:** a low, clean pulse under the cold open. A soft click on each check turning green. No stock music with lyrics; it must be music we have the rights to.

## Piece 1: Cold open (0:00 to 0:18)

Paste into OpenMotion:

> Create a 4-scene, 16:9, 18-second cold open for a developer tool called paydrill. Deep navy background (#001C64), white headline type in a heavy geometric sans with tight tracking, PayPal blue (#0070E0) accent, bright blue (#60CDFF) glows. Calm, confident ease-out motion. Signature move: a thin blue line that travels across the frame like a payment moving.
> Scene 1 (4s): a blue line draws left to right across the dark frame; a dollar amount "$49.99" rides along it and lands on a small white card that reads "Payment completed".
> Scene 2 (5s): the card flips. Behind it, three red warnings stack up fast: "Forged payment accepted", "Dispute crashed: 500", "Order shipped twice". The background dims slightly.
> Scene 3 (5s): the warnings shatter into small blue particles. Headline types in: "Your webhook handler has never met a real PayPal event."
> Scene 4 (4s): the particles pull together into the wordmark "paydrill" in white, with a blue line underlining it. Subline fades in: "Real sandbox events. Real failures. Fixed and proven."

## Piece 2: Chapter cards (four cards, 3 seconds each)

Paste into OpenMotion:

> Create four 3-second, 16:9 chapter cards in one consistent style. White background, deep navy (#001C64) headline in a heavy geometric sans, PayPal blue (#0070E0) step number. Each card: the blue travelling line enters from the left, the step number and headline slide up with it, then the line exits right to lead into the next shot. Ease-out, no bounce.
> Card 1: "01  Drill" with small text "real sandbox events, then chaos".
> Card 2: "02  Fix" with small text "on a new branch, proven by a rerun".
> Card 3: "03  Leave Stripe" with small text "one command, honest report".
> Card 4: "04  Ship" with small text "coverage and a self-healing PR".

## Piece 3: Proof callouts (overlays, transparent WebM)

Export these as transparent WebM and lay them over the screen recordings.

> Create three transparent-background overlays, 16:9, each 4 seconds. Clean geometric sans, white text on a deep navy (#001C64) rounded panel with a thin PayPal blue (#0070E0) border. Panels slide in from the right edge and out the same way.
> Overlay A: a 5-row checklist where every row starts red (#E5484D) with an X, then each flips to a green (#2DBE6C) check with a soft click, top to bottom, 0.4s apart. Rows: "Signature verified", "Duplicate ignored", "Out of order handled", "Unknown event acknowledged", "Dispute amount read".
> Overlay B: a counter that climbs from "3 / 23" to "9 / 23" under the label "Payment coverage", with a thin blue progress bar filling alongside it.
> Overlay C: four labelled numbers appear one at a time, each counting up from 0: "Verified", "Migrated, unverified", "Needs human", "Not migrated". Leave the numbers as placeholders we fill from the real run.

Only put numbers in overlays B and C that match what the real run on screen shows. Change the prompt values to match after recording.

## Piece 4: Outro (2:38 to 2:50)

> Create a 3-scene, 16:9, 12-second outro. Deep navy background (#001C64), heavy white geometric sans, PayPal blue (#0070E0) accent, the thin travelling blue line as the transition.
> Scene 1 (4s): two lines of text, one after the other: "Stripe's CLI helps you build on Stripe." then, in blue, "paydrill helps you build on PayPal."
> Scene 2 (4s): the blue line sweeps across and the text resolves into one command in monospace: "npx paydrill".
> Scene 3 (4s): the "paydrill" wordmark centred, small text below: "Built for the PayPal AI Hackathon". Hold, then fade to navy.

## Edit order

| Time | Piece | Source |
|---|---|---|
| 0:00 | Cold open | OpenMotion piece 1 |
| 0:18 | `npx paydrill init` detects the shop | Screen recording |
| 0:30 | Chapter card 01 | OpenMotion piece 2 |
| 0:33 | `trigger dispute`, then `drill` goes red, `doctor` names the lines | Screen recording |
| 1:15 | Chapter card 02 | OpenMotion piece 2 |
| 1:18 | `fix`: branch, rerun goes green, with overlays A and B on top | Recording plus piece 3 |
| 1:50 | Chapter card 03 | OpenMotion piece 2 |
| 1:53 | `migrate` on the Stripe shop, report, with overlay C on top | Recording plus piece 3 |
| 2:25 | Chapter card 04 | OpenMotion piece 2 |
| 2:28 | The self-healing PR on GitHub | Screen recording |
| 2:38 | Outro | OpenMotion piece 4 |

## Rules from the hackathon

- Under 3 minutes. Judges don't have to watch past that.
- Show the project actually working. Motion pieces frame the recordings; they never stand in for them.
- No third-party trademarks or copyrighted music without permission. That means no PayPal logo or button artwork, and only music we have rights to.
- Upload to YouTube as public.
