import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutes, setRoutes, target } from '../src/relay/routes.js';

test('flags then yaml, first match wins, default otherwise', () => {
  setRoutes(parseRoutes(
    { 'CUSTOMER.DISPUTE.*': 'http://localhost:3000/yaml-disputes', 'PAYMENT.CAPTURE.REFUNDED': 'http://localhost:3000/refunds' },
    ['drill', '--route', 'CUSTOMER.DISPUTE.RESOLVED=http://localhost:4000/closed'],
  ));
  assert.equal(target('CUSTOMER.DISPUTE.RESOLVED', 'http://d'), 'http://localhost:4000/closed');
  assert.equal(target('CUSTOMER.DISPUTE.CREATED', 'http://d'), 'http://localhost:3000/yaml-disputes');
  assert.equal(target('PAYMENT.CAPTURE.REFUNDED', 'http://d'), 'http://localhost:3000/refunds');
  assert.equal(target('PAYMENT.CAPTURE.COMPLETED', 'http://d'), 'http://d');
  assert.equal(target('CUSTOMER_DISPUTE_X', 'http://d'), 'http://d', 'dots are literal, not regex wildcards');
});

test('bad routes fail loudly', () => {
  assert.throws(() => parseRoutes(undefined, ['--route', 'CUSTOMER.*']), /must look like/);
  assert.throws(() => parseRoutes({ 'X.*': 'not-a-url' }, []), /must map to a URL/);
});
