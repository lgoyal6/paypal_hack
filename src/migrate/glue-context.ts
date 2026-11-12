export { EVENT_MAP } from './mapping.ts';

export const HELPER_API = `  paypal.orders.create({ amount, customId, invoiceId, requestId }) -> PayPal order (id, status, links)
  paypal.orders.capture(orderId, requestId) -> capture result; capture id at purchase_units[0].payments.captures[0].id
  paypal.orders.get(orderId)
  paypal.refunds.create({ captureId, amount, requestId }) -> refund (id, status); omit amount for a full refund
  paypal.webhooks.verify(headers, rawBody) -> verified event (throws if the signature is invalid)
  toPayPalAmount(minorUnits, currency) -> { currency_code, value }
  requestId is PayPal's idempotency key (Stripe idempotencyKey goes there).`;
