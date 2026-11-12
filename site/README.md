# Paydrill interactive demo

[Open the deployed demo](https://paydrill-demo.onrender.com/).

This browser demo uses scrubbed records from the sandbox run. The event grid is AG Grid Community. Visitors can sort and filter events, select a row to see the response and signature, and browse diagnosis, coverage, and migration examples. The terminal animation runs at approximately 95 WPM.

## Run locally

```sh
cd site
npm ci
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:4173.

## Deploy on Render

Use the repository's `render.yaml` with a Render Blueprint, or create a **Static Site** connected to the GitHub branch containing these files. From the repository root:

- Build command: `cd site && npm ci && npm run build`
- Publish directory: `site/dist`

The demo needs no secrets or paid instance. To run the real integration, see the root README.
