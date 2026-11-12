// Stripe integer minor units <-> PayPal decimal strings. Deterministic, no AI.
// Decimal places per ISO 4217; PayPal sends JPY, HUF and TWD with 0 decimals.
const ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'HUF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'TWD', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export const decimals = (currency: string) => {
  const c = currency.toUpperCase();
  return ZERO.has(c) ? 0 : THREE.has(c) ? 3 : 2;
};

/** 1200, "usd" -> { currency_code: "USD", value: "12.00" }. Integers only, like Stripe. */
export function toPayPalAmount(minor: number, currency: string) {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error(`Stripe amount must be a non-negative integer, got ${minor}`);
  const d = decimals(currency);
  const s = String(minor).padStart(d + 1, '0');
  return { currency_code: currency.toUpperCase(), value: d ? `${s.slice(0, -d)}.${s.slice(-d)}` : s };
}

/** "12.00", "USD" -> 1200. Rejects more decimals than the currency allows. */
export function toStripeAmount(value: string, currency: string): number {
  const d = decimals(currency);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m || (m[2]?.length ?? 0) > d) throw new Error(`Bad ${currency} amount "${value}"`);
  return Number(m[1] + (m[2] ?? '').padEnd(d, '0'));
}
