// Live drill view: a progress bar per scenario as its expected events arrive, then chaos checks turning green or red.
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { EventEmitter } from 'node:events';
import type { CheckResult, DrillEvent, ScenarioResult } from '../contract.js';

interface Row { name: string; expects: string[]; got: Set<string>; done?: ScenarioResult }

export function bar(done: number, total: number, width = 20): string {
  const n = total ? Math.round((done / total) * width) : 0;
  return '█'.repeat(n) + '░'.repeat(width - n);
}

export function DrillView({ bus, forwardTo }: { bus: EventEmitter; forwardTo: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [phase, setPhase] = useState<'scenarios' | 'chaos'>('scenarios');

  useEffect(() => {
    const onScenario = (name: string, expects: string[]) => setRows((r) => [...r, { name, expects, got: new Set() }]);
    const onDelivery = (d: DrillEvent) => setRows((r) => r.map((row, i) =>
      i === r.length - 1 && row.expects.includes(d.event.event_type) ? { ...row, got: new Set([...row.got, d.event.event_type]) } : row));
    const onDone = (s: ScenarioResult) => setRows((r) => r.map((row) => (row.name === s.scenario ? { ...row, done: s } : row)));
    const onChaos = () => setPhase('chaos');
    const onCheck = (c: CheckResult) => setChecks((cs) => [...cs, c]);
    bus.on('scenario', onScenario).on('delivery', onDelivery).on('scenario-done', onDone).on('chaos', onChaos).on('check', onCheck);
    return () => { bus.off('scenario', onScenario).off('delivery', onDelivery).off('scenario-done', onDone).off('chaos', onChaos).off('check', onCheck); };
  }, [bus]);

  return (
    <Box flexDirection="column">
      <Text bold>paydrill drill <Text color="gray">→ {forwardTo}</Text></Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map((r) => {
          const failed = r.done && (r.done.error || Object.values(r.done.delivered).some((x) => !x));
          const color = !r.done ? 'blue' : failed ? 'red' : 'green';
          return (
            <Box key={r.name} flexDirection="column">
              <Text>
                <Text color={color}>{bar(r.got.size, r.expects.length)}</Text> {r.name.padEnd(16)} {r.got.size}/{r.expects.length} events
                {r.done?.error ? <Text color="red">  {r.done.error}</Text> : null}
              </Text>
              {r.done?.simulated.length ? <Text color="magenta">    simulated by PayPal: {r.done.simulated.join(', ')}</Text> : null}
            </Box>
          );
        })}
      </Box>
      {phase === 'chaos' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Chaos</Text>
          {checks.map((c, i) => (
            <Text key={i} color={c.pass ? 'green' : 'red'}>
              {c.pass ? '✓' : '✗'} {c.check.padEnd(16)} {c.eventType} → {c.response.status || 'no answer'} ({c.response.ms}ms)
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
