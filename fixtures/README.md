# Fixtures

Real PayPal sandbox webhook events, recorded by `paydrill listen` on 2026-11-12. One `PayPalEvent` per file, unmodified except:
- `_source: "sandbox"` added at the top level (see CONTRACT.md#fixtures)
- the sandbox merchant email replaced with `sb-merchant@business.example.com`

| File | Produced by |
|---|---|
| `PAYMENT.CAPTURE.COMPLETED.json` | `paydrill trigger refund` (the capture) |
| `PAYMENT.CAPTURE.REFUNDED.json` | `paydrill trigger refund` |
| `CUSTOMER.DISPUTE.RESOLVED.json` | Real resolution of our own dispute `PP-R-LSP-10200167`: chargeback, seller accepted the claim, `adjudicate` (BUYER_FAVOR), then PayPal sent this about 6.5 minutes later. Outcome `RESOLVED_BUYER_FAVOUR`, $12.00 refunded. |
| `CUSTOMER.DISPUTE.CREATED.json` | `paydrill drill --scenarios dispute-lost`, about 2.5 minutes after the chargeback |
| `CUSTOMER.DISPUTE.UPDATED.json` | `paydrill trigger dispute`, about 4 minutes after the chargeback (status `WAITING_FOR_SELLER_RESPONSE`) |

Observed and worth knowing:
- Chargebacks are inconsistent about `CUSTOMER.DISPUTE.CREATED`: one run sent only `UPDATED` (about 4 minutes in), another sent `CREATED` at about 2.5 minutes and `UPDATED` at about 3.7 minutes. `UPDATED` arrived in both, so scenarios expect `UPDATED`.
- `PAYMENT.CAPTURE.REFUNDED` arrived before its `PAYMENT.CAPTURE.COMPLETED`.
- Disputes carry `dispute_id` and `dispute_amount`, not `id` and `amount`.
- A real resolution takes 30+ minutes end to end: about 4 minutes until `accept_claim` is offered, 3 to ~20 minutes after accepting until `adjudicate` is offered, then about 6.5 minutes until `RESOLVED`. `paydrill disputes prepare` ages disputes ahead of time so a drill only waits for the last step.
- PayPal simulator events arrive signed, and the signature verifies against the webhook (verified 2026-11-12). Some third-party guides say otherwise.
