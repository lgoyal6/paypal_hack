import { register } from '../registry.js';
import { startRelay, formatDelivery } from './relay.js';
import type { DrillEvent } from '../contract.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

register('listen', {
  describe: 'Forward real sandbox events to your app: paydrill listen --forward-to <url>',
  async run(args) {
    const forwardTo = flag(args, 'forward-to');
    if (!forwardTo) throw new Error('--forward-to is required, e.g. --forward-to http://localhost:3000/webhooks/paypal');
    const relay = await startRelay({
      forwardTo,
      port: Number(flag(args, 'port') ?? 4807),
      backfill: !args.includes('--no-backfill'),
    });
    console.log(`Ready. Forwarding sandbox events to ${forwardTo}`);
    console.log(`Webhook id (verify signatures in your app with this): ${relay.webhookId}`);
    console.log('Ctrl-C stops and removes the webhook.\n');
    relay.bus.on('delivery', (d: DrillEvent) => console.log(formatDelivery(d)));
    relay.bus.on('warn', (w: string) => console.log(`  warn: ${w}`));
    const stop = async () => { await relay.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    await new Promise(() => {});
  },
});
