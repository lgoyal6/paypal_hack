// Browser checkout with Stripe.js and the Payment Element.
import { loadStripe } from '@stripe/stripe-js';

const stripe = await loadStripe(window.STRIPE_PUBLISHABLE_KEY);

export async function mountCheckout(sku, email) {
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku, email }),
  });
  const { clientSecret } = await res.json();
  const elements = stripe.elements({ clientSecret });
  elements.create('payment').mount('#payment-element');
  document.querySelector('#pay').addEventListener('click', async () => {
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: location.origin + '/thanks' } });
    if (error) document.querySelector('#error').textContent = error.message;
  });
}
