# paydrill GitHub Action

Runs `paydrill drill` against your app in CI with real PayPal sandbox events and posts (or updates) one PR comment with the result. Fails the job when the verdict is fix first.

```yaml
name: paydrill
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  drill:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && (npm start &) && npx wait-on http://localhost:3000/health
      - uses: lgoyal6/paypal_hack/action@main
        with:
          forward-to: http://localhost:3000/webhooks/paypal
          scenarios: payment,refund
          paypal-client-id: ${{ secrets.PAYPAL_CLIENT_ID }}
          paypal-client-secret: ${{ secrets.PAYPAL_CLIENT_SECRET }}
```

Needs sandbox keys as repository secrets. Pull requests from forks do not get secrets, so the drill only runs on branches in the same repository.
