# Event fixtures

One `PayPalEvent` per file, named by event type. Files marked `"_source": "docs"` follow the payload shapes in PayPal's webhook and API reference docs, with made-up IDs. They are for development only. Laksh's real sandbox recordings replace them and carry `"_source": "sandbox"`. Code must not depend on `_source`.

Note the dispute shape: the amount is `resource.dispute_amount`, not `resource.amount`. The demo shop's planted bug relies on that.
