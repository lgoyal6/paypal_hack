import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPayPalAmount, toStripeAmount } from './amounts.ts';

test('minor units to PayPal decimal strings', () => {
  assert.deepEqual(toPayPalAmount(1200, 'usd'), { currency_code: 'USD', value: '12.00' });
  assert.equal(toPayPalAmount(5, 'usd').value, '0.05');
  assert.equal(toPayPalAmount(0, 'eur').value, '0.00');
  assert.equal(toPayPalAmount(1500, 'jpy').value, '1500');
  assert.equal(toPayPalAmount(1234, 'kwd').value, '1.234');
  assert.throws(() => toPayPalAmount(12.5, 'usd'));
});

test('round trip and strictness', () => {
  for (const [n, c] of [[1, 'usd'], [99999, 'gbp'], [700, 'jpy'], [1001, 'bhd']] as const) assert.equal(toStripeAmount(toPayPalAmount(n, c).value, c), n);
  assert.throws(() => toStripeAmount('12.345', 'USD'));
  assert.throws(() => toStripeAmount('12.5', 'JPY'));
  assert.equal(toStripeAmount('12.5', 'USD'), 1250);
});
