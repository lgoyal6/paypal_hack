# Fixtures

Real PayPal sandbox webhook events, recorded by `paydrill listen` on 2026-11-12. One `PayPalEvent` per file, unmodified except:
- `_source: "sandbox"` added at the top level (see CONTRACT.md#fixtures)
- the sandbox merchant email replaced with `sb-merchant@business.example.com`

| File | Produced by |
|---|---|
| `PAYMENT.CAPTURE.COMPLETED.json` | `paydrill trigger refund` (the capture) |
| `PAYMENT.CAPTURE.REFUNDED.json` | `paydrill trigger refund` |
| `CUSTOMER.DISPUTE.UPDATED.json` | `paydrill trigger dispute`, about 4 minutes after the chargeback (status `WAITING_FOR_SELLER_RESPONSE`) |

Observed and worth knowing:
- Chargebacks produced `CUSTOMER.DISPUTE.UPDATED`, never `CUSTOMER.DISPUTE.CREATED`.
- `PAYMENT.CAPTURE.REFUNDED` arrived before its `PAYMENT.CAPTURE.COMPLETED`.
- Disputes carry `dispute_id` and `dispute_amount`, not `id` and `amount`.
- `CUSTOMER.DISPUTE.RESOLVED` is not recorded yet: no sandbox dispute resolved within the time we waited.
