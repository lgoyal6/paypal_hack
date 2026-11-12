// Full-screen listen view: event list on the left, detail on the right, keys to replay, duplicate, forge.
import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { DrillEvent } from '../contract.js';

export interface ListenActions {
  replay(d: DrillEvent): Promise<DrillEvent>;
  duplicate(d: DrillEvent): Promise<DrillEvent>;
  forge(d: DrillEvent): Promise<DrillEvent>;
  explain?(d: DrillEvent): Promise<string>;
  quit(): Promise<void>;
}

export interface ListenViewProps {
  forwardTo: string;
  webhookId: string;
  subscribe(onEvent: (d: DrillEvent) => void, onWarn: (w: string) => void): () => void;
  actions: ListenActions;
  height?: number;
}

const ok = (s: number) => s >= 200 && s < 300;
const resId = (d: DrillEvent) => String(d.event.resource?.id ?? d.event.resource?.dispute_id ?? '');

function sourceColor(s: DrillEvent['source']): string {
  if (s === 'backfill') return 'yellow';
  if (s === 'paypal-simulated') return 'magenta';
  if (s.startsWith('chaos')) return 'cyan';
  return 'gray';
}

export function ListenView({ forwardTo, webhookId, subscribe, actions, height = 14 }: ListenViewProps) {
  const { exit } = useApp();
  const [events, setEvents] = useState<DrillEvent[]>([]);
  const [sel, setSel] = useState(0);
  const [status, setStatus] = useState('Waiting for sandbox events. Try "paydrill trigger payment" in another terminal.');

  useEffect(() => subscribe(
    (d) => setEvents((prev) => [...prev, d]),
    (w) => setStatus(`warn: ${w}`),
  ), [subscribe]);

  useEffect(() => { if (events.length) setSel(events.length - 1); }, [events.length]);

  const current = events[sel];
  const run = async (label: string, fn?: (d: DrillEvent) => Promise<DrillEvent>) => {
    if (!current || !fn) return;
    setStatus(`${label}...`);
    try {
      const d = await fn(current);
      setEvents((prev) => [...prev, d]);
      setStatus(`${label}: your app answered ${d.response.status} in ${d.response.ms}ms`);
    } catch (e) {
      setStatus(`${label} failed: ${(e as Error).message}`);
    }
  };

  useInput((input, key) => {
    if (key.upArrow) setSel((s) => Math.max(0, s - 1));
    if (key.downArrow) setSel((s) => Math.min(events.length - 1, s + 1));
    if (input === 'r') void run('replay', actions.replay);
    if (input === 'd') void run('duplicate', actions.duplicate);
    if (input === 'f') void run('forge (unsigned, tampered amount)', actions.forge);
    if (input === 'e') {
      if (!current) return;
      if (!actions.explain) { setStatus('AI explain needs ANTHROPIC_API_KEY and the AI lane (src/ai).'); return; }
      setStatus('asking Claude...');
      actions.explain(current).then(setStatus, (e: Error) => setStatus(`explain failed: ${e.message}`));
    }
    if (input === 'q' || (key.ctrl && input === 'c')) {
      setStatus('removing webhook and closing tunnel...');
      actions.quit().finally(() => exit());
    }
  });

  const start = Math.max(0, Math.min(sel - Math.floor(height / 2), events.length - height));
  const visible = events.slice(start, start + height);

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">paydrill listen <Text color="gray">-&gt; {forwardTo}</Text></Text>
      <Text color="gray" wrap="truncate">webhook {webhookId} · {events.length} events</Text>
      <Box borderStyle="single" borderColor="gray">
        <Box flexDirection="column" width="55%" paddingRight={1}>
          {visible.length === 0 && <Text color="gray">no events yet</Text>}
          {visible.map((d, i) => {
            const idx = start + i;
            return (
              <Text key={`${d.event.id}-${idx}`} inverse={idx === sel} wrap="truncate">
                {d.receivedAt.slice(11, 19)}{' '}
                <Text color={ok(d.response.status) ? 'green' : 'red'}>{String(d.response.status).padEnd(3)}</Text>{' '}
                {d.event.event_type}{' '}
                <Text color={sourceColor(d.source)}>{d.source === 'live' ? '' : d.source}</Text>
              </Text>
            );
          })}
        </Box>
        <Box flexDirection="column" width="45%" borderStyle="single" borderTop={false} borderBottom={false} borderRight={false} paddingLeft={1}>
          {current ? (
            <>
              <Text bold wrap="truncate">{current.event.event_type}</Text>
              <Text wrap="truncate">resource  {resId(current)}</Text>
              <Text>source    <Text color={sourceColor(current.source)}>{current.source}</Text></Text>
              <Text>signature <Text color={current.signature === 'verified' ? 'green' : 'yellow'}>{current.signature}</Text></Text>
              <Text>your app  <Text color={ok(current.response.status) ? 'green' : 'red'}>{current.response.status} in {current.response.ms}ms</Text></Text>
              {current.response.body ? <Text color="gray" wrap="truncate">{current.response.body}</Text> : null}
              {current.source === 'paypal-simulated' && <Text color="magenta">simulated by PayPal: mock payload</Text>}
            </>
          ) : <Text color="gray">select an event</Text>}
        </Box>
      </Box>
      <Text color="gray" wrap="truncate">{status}</Text>
      <Text color="gray">↑↓ move   r replay   d duplicate   f forge   e explain with AI   q quit</Text>
    </Box>
  );
}
