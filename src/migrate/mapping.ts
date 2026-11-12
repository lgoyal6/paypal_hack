// The only Stripe -> PayPal mappings migrate is allowed to use. Anything not
// here is "unsupported" and left untouched.
import type { MigrateStatus } from '../contract.ts';

export interface Mapping { status: MigrateStatus; paypal?: string; reason?: string }

const SDK: [RegExp, Mapping][] = [
  [/^(paymentIntents\.create|checkout\.sessions\.create)$/, { status: 'supported', paypal: 'POST /v2/checkout/orders (intent CAPTURE)' }],
  [/^paymentIntents\.(confirm|capture)$/, { status: 'supported', paypal: 'POST /v2/checkout/orders/{id}/capture' }],
  [/^paymentIntents\.(retrieve|cancel)$/, { status: 'supported', paypal: 'GET /v2/checkout/orders/{id} (cancel: let the order expire)' }],
  [/^refunds\.create$/, { status: 'supported', paypal: 'POST /v2/payments/captures/{id}/refund' }],
  [/^webhooks\.constructEvent(Async)?$/, { status: 'supported', paypal: 'POST /v1/notifications/verify-webhook-signature' }],
  [/^metadata$/, { status: 'partial', paypal: 'purchase_units[].custom_id / invoice_id', reason: 'PayPal keeps one 127-character custom_id and one invoice_id, not a key-value map. Values that do not fit are flagged.' }],
  [/^(customers|paymentMethods|setupIntents)\./, { status: 'partial', paypal: 'Vault (payment method tokens)', reason: 'Saved customers map to vaulted payment tokens; buyer consent and token flow differ, so a human must review.' }],
  [/^(subscriptions|prices|products|invoices|coupons)\./, { status: 'partial', paypal: 'Catalog Products + Billing Plans + Subscriptions', reason: 'No proration, metered billing or coupon parity in PayPal Subscriptions.' }],
  [/^(accounts|transfers|payouts|applicationFees)\./, { status: 'unsupported', reason: 'Stripe Connect has no direct equivalent; PayPal multiparty needs partner onboarding.' }],
  [/^issuing\./, { status: 'unsupported', reason: 'PayPal has no card issuing API for developers.' }],
  [/^terminal\./, { status: 'unsupported', reason: 'Stripe Terminal (in-person readers) has no PayPal equivalent here.' }],
  [/^treasury\./, { status: 'unsupported', reason: 'Stripe Treasury has no PayPal equivalent.' }],
  [/^radar\./, { status: 'unsupported', reason: 'Radar rules have no PayPal API equivalent; PayPal fraud tools are configured separately.' }],
  [/^tax\./, { status: 'unsupported', reason: 'Stripe Tax has no PayPal equivalent; tax must come from another provider.' }],
  [/^billingPortal\./, { status: 'unsupported', reason: 'No hosted billing portal in PayPal.' }],
];

const EVENTS: Record<string, Mapping> = {
  'payment_intent.succeeded': { status: 'supported', paypal: 'PAYMENT.CAPTURE.COMPLETED' },
  'checkout.session.completed': { status: 'supported', paypal: 'PAYMENT.CAPTURE.COMPLETED' },
  'charge.refunded': { status: 'supported', paypal: 'PAYMENT.CAPTURE.REFUNDED' },
  'charge.dispute.created': { status: 'supported', paypal: 'CUSTOMER.DISPUTE.CREATED' },
  'charge.dispute.closed': { status: 'supported', paypal: 'CUSTOMER.DISPUTE.RESOLVED' },
  'payment_intent.payment_failed': { status: 'partial', paypal: 'PAYMENT.CAPTURE.DENIED', reason: 'PayPal declines most failures at approval, before any webhook; only denied captures emit this.' },
};

const STRIPE_JS: Record<string, Mapping> = {
  loadStripe: { status: 'supported', paypal: 'PayPal JS SDK <script src="https://www.paypal.com/sdk/js?...">' },
  elements: { status: 'supported', paypal: 'paypal.Buttons() + paypal.CardFields()' },
  'elements.create': { status: 'supported', paypal: 'paypal.Buttons().render() / paypal.CardFields().render()' },
  confirmPayment: { status: 'supported', paypal: 'Buttons onApprove -> POST capture on your server' },
};

export function mapSdk(path: string): Mapping {
  return SDK.find(([re]) => re.test(path))?.[1] ?? { status: 'unsupported', reason: `No known PayPal mapping for stripe.${path}.` };
}
export const mapEvent = (t: string): Mapping => EVENTS[t] ?? { status: 'unsupported', reason: `No PayPal webhook equivalent for ${t}.` };
export const mapStripeJs = (m: string): Mapping => STRIPE_JS[m] ?? { status: 'unsupported', reason: `No PayPal JS SDK equivalent for Stripe.js ${m}.` };
export const EVENT_MAP = Object.fromEntries(Object.entries(EVENTS).filter(([, m]) => m.paypal).map(([k, m]) => [k, m.paypal!]));
export const IDEMPOTENCY: Mapping = { status: 'supported', paypal: 'PayPal-Request-Id header' };
export const AMOUNT: Mapping = { status: 'supported', paypal: 'decimal string via toPayPalAmount()' };
