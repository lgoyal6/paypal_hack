import React from 'react';
import { render } from 'ink';
import { register } from '../registry.js';
import { startRelay, formatDelivery, forward } from './relay.js';
import { forgeEvent } from './chaos.js';
import { ListenView } from '../ui/ListenView.js';
import { loadConfig } from '../scenarios/yaml.js';
import { startInspector } from '../ui/inspector.js';
import type { DrillEvent } from '../contract.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

register('listen', {
  describe: 'Forward real sandbox events to your app: paydrill listen --forward-to <url> [--ui] [--output compact]',
  async run(args) {
    const forwardTo = flag(args, 'forward-to') ?? loadConfig()?.forwardTo;
    if (!forwardTo) throw new Error('--forward-to is required (or run "paydrill init" to save it in paydrill.yml)');
    const relay = await startRelay({
      forwardTo,
      port: Number(flag(args, 'port') ?? 0),
      backfill: !args.includes('--no-backfill'),
    });
    const stop = async () => { await relay.close(); };
    const withUi = args.includes('--ui');
    const interactive = !withUi && process.stdout.isTTY && (flag(args, 'output') ?? 'interactive') === 'interactive';
    const resend = async (d: DrillEvent, source: DrillEvent['source'], event = d.event, headers = d.headers, signature = d.signature): Promise<DrillEvent> => {
      const response = await forward(forwardTo, event, headers, source, signature);
      return { event, headers, source, signature, response, receivedAt: new Date().toISOString() };
    };

    if (!interactive) {
      console.log(`Ready. Forwarding sandbox events to ${forwardTo}`);
      console.log(`Webhook id (verify signatures in your app with this): ${relay.webhookId}`);
      console.log('Ctrl-C stops and removes the webhook.\n');
      relay.bus.on('delivery', (d: DrillEvent) => console.log(formatDelivery(d)));
      relay.bus.on('warn', (w: string) => console.log(`  warn: ${w}`));
      let closeUi = () => {};
      if (withUi) {
        const events: DrillEvent[] = [];
        const add = (d: DrillEvent) => { events.push(d); ui.push(d); return d; };
        const at = (i: number) => { const d = events[i]; if (!d) throw new Error(`no event ${i}`); return d; };
        const ui = await startInspector({
          forwardTo, webhookId: relay.webhookId, events, port: flag(args, 'ui-port') ? Number(flag(args, 'ui-port')) : undefined,
          actions: {
            replay: async (i) => add(await resend(at(i), 'live-retry')),
            duplicate: async (i) => add(await resend(at(i), 'chaos-duplicate')),
            forge: async (i) => add(await resend(at(i), 'chaos-forged', forgeEvent(at(i).event), {}, 'unsigned')),
          },
        });
        relay.bus.on('delivery', (d: DrillEvent) => add(d));
        closeUi = () => ui.close();
        console.log(`Inspector: ${ui.url}`);
      }
      const onSignal = async () => { closeUi(); await stop(); process.exit(0); };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
      await new Promise(() => {});
      return;
    }

    const app = render(React.createElement(ListenView, {
      forwardTo,
      webhookId: relay.webhookId,
      subscribe: (onEvent, onWarn) => {
        relay.bus.on('delivery', onEvent);
        relay.bus.on('warn', onWarn);
        return () => { relay.bus.off('delivery', onEvent); relay.bus.off('warn', onWarn); };
      },
      actions: {
        replay: (d) => resend(d, 'live-retry'),
        duplicate: (d) => resend(d, 'chaos-duplicate'),
        forge: (d) => resend(d, 'chaos-forged', forgeEvent(d.event), {}, 'unsigned'),
        quit: stop,
      },
    }), { exitOnCtrlC: false });
    await app.waitUntilExit();
  },
});
