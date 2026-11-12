# Fixtures

Real PayPal sandbox webhook events, recorded by `paydrill listen` on 2026-11-12. One `PayPalEvent` per file, unmodified except:
- `_source: "sandbox"` added at the top level (see CONTRACT.md#fixtures)
- the sandbox merchant email replaced with `sb-merchant@business.example.com`

| File | Produced by |
|---|---|
| `PAYMENT.CAPTURE.COMPLETED.json` | `paydrill trigger refund` (the capture) |
| `PAYMENT.CAPTURE.REFUNDED.json` | `paydrill trigger refund` |
| `CUSTOMER.DISPUTE.RESOLVED.json` | **Simulated by PayPal**, not a real resolution: PayPal's webhook simulator (`POST /v1/notifications/simulate-event`), delivered through the real webhook path with a verified signature. `_source` is `paypal-simulator`. It refers to PayPal's mock dispute `PP-000-042-663-135` (outcome `CANCELED_BY_BUYER`), not one of ours. |
| `CUSTOMER.DISPUTE.UPDATED.json` | `paydrill trigger dispute`, about 4 minutes after the chargeback (status `WAITING_FOR_SELLER_RESPONSE`) |

Observed and worth knowing:
- Chargebacks produced `CUSTOMER.DISPUTE.UPDATED`, never `CUSTOMER.DISPUTE.CREATED`.
- `PAYMENT.CAPTURE.REFUNDED` arrived before its `PAYMENT.CAPTURE.COMPLETED`.
- Disputes carry `dispute_id` and `dispute_amount`, not `id` and `amount`.
- No real sandbox dispute resolved within the time we waited, so the only `CUSTOMER.DISPUTE.RESOLVED` is PayPal's simulated one.
- PayPal simulator events arrive signed, and the signature verifies against the webhook (verified 2026-11-12). Some third-party guides say otherwise.
