import { describe, expect, it } from 'vitest';
import {
  type Automation,
  automationHosts,
  automationInputSchema,
  commands,
  describeSchedule,
  describeStep,
  MAX_FAILURES,
  needsAttention,
  withRun,
} from '../src/index.ts';

const input = {
  name: ' Morning check-in ',
  url: 'https://example.com/app',
  schedule: { every: 'day', at: '09:00' },
  steps: [{ do: 'click', target: { role: 'button', name: 'Check in' } }],
};

const automation: Automation = {
  ...automationInputSchema.parse(input),
  id: 'a1',
  status: 'on',
  createdAt: 0,
  runs: 0,
  failures: 0,
  history: [],
};

describe('automation input', () => {
  it('accepts a daily and an interval automation', () => {
    expect(automationInputSchema.parse(input).name).toBe('Morning check-in');
    const interval = { ...input, schedule: { every: 'interval', seconds: 3 } };
    expect(commands['automation.create'].params.safeParse(interval).success).toBe(true);
  });

  it('refuses what it could not run', () => {
    const bad = [
      { ...input, schedule: { every: 'day', at: '9:00' } },
      { ...input, schedule: { every: 'day', at: '24:00' } },
      { ...input, schedule: { every: 'day', at: '09:00', days: ['monday'] } },
      { ...input, schedule: { every: 'interval', seconds: 0.5 } },
      { ...input, url: 'javascript:alert(1)' },
      { ...input, steps: [] },
      { ...input, steps: [{ do: 'open', url: 'file:///etc/passwd' }] },
      { ...input, steps: [{ do: 'click', target: { name: '' } }] },
      { ...input, steps: [{ do: 'run', script: 'x' }] },
    ];
    for (const candidate of bad) {
      expect(automationInputSchema.safeParse(candidate).success).toBe(false);
    }
  });
});

describe('descriptions', () => {
  it('puts a step in plain words', () => {
    const steps = automationInputSchema.parse({
      ...input,
      steps: [
        { do: 'open', url: 'https://example.com/login' },
        { do: 'type', target: { role: 'textbox', name: 'Search' }, text: 'cats', submit: true },
        { do: 'click', target: { name: 'Results' } },
        { do: 'press', key: 'Escape' },
        { do: 'wait', text: 'Done' },
        { do: 'wait', seconds: 2 },
      ],
    }).steps;
    expect(steps.map(describeStep)).toEqual([
      'Open https://example.com/login',
      'Type "cats" into textbox "Search" and press Enter',
      'Click element "Results"',
      'Press Escape',
      'Wait for "Done"',
      'Wait 2 s',
    ]);
  });

  it('puts a schedule in plain words', () => {
    expect(describeSchedule({ every: 'interval', seconds: 3 })).toBe('Every 3 s');
    expect(describeSchedule({ every: 'interval', seconds: 90 })).toBe('Every 90 s');
    expect(describeSchedule({ every: 'interval', seconds: 300 })).toBe('Every 5 min');
    expect(describeSchedule({ every: 'interval', seconds: 7200 })).toBe('Every 2 h');
    expect(describeSchedule({ every: 'day', at: '09:00' })).toBe('Every day at 09:00');
    expect(describeSchedule({ every: 'day', at: '09:00', days: ['mon', 'fri'] })).toBe(
      'Every mon, fri at 09:00',
    );
  });

  it('lists each site an automation touches once', () => {
    expect(
      automationHosts({
        url: 'https://example.com/a',
        steps: [
          { do: 'open', url: 'https://example.com/b' },
          { do: 'open', url: 'https://other.example/' },
          { do: 'press', key: 'Enter' },
        ],
      }),
    ).toEqual(['example.com', 'other.example']);
  });
});

describe('withRun', () => {
  it('counts runs and folds repeats into one line', () => {
    let current = withRun(automation, { ok: true, at: 1 });
    current = withRun(current, { ok: true, at: 2 }, 4);
    expect(current).toMatchObject({ runs: 5, failures: 0 });
    expect(current.history).toEqual([{ at: 2, ok: true, note: undefined, times: 5 }]);

    current = withRun(current, { ok: false, note: 'No button "Check in"', at: 3 });
    expect(current.history).toHaveLength(2);
    expect(current).toMatchObject({ failures: 1, status: 'on' });
  });

  it('pauses after repeated failures, and a success clears the count', () => {
    let current = automation;
    for (let i = 1; i < MAX_FAILURES; i++) current = withRun(current, { ok: false, at: i });
    expect(withRun(current, { ok: true, at: 9 })).toMatchObject({ failures: 0, status: 'on' });

    current = withRun(current, { ok: false, at: 9 });
    expect(current).toMatchObject({ status: 'paused', pausedBecause: 'Failed 3 times in a row' });
    expect(needsAttention(current)).toBe(true);
  });

  it('keeps only the latest lines of history', () => {
    let current = automation;
    for (let i = 0; i < 30; i++) current = withRun(current, { ok: i % 2 === 0, at: i });
    expect(current.history).toHaveLength(10);
    expect(current.history.at(-1)?.at).toBe(29);
  });
});

describe('needsAttention', () => {
  it('is for what waits on the user', () => {
    expect(needsAttention({ ...automation, status: 'pending' })).toBe(true);
    expect(needsAttention(automation)).toBe(false);
    expect(needsAttention({ ...automation, status: 'paused' })).toBe(false);
  });
});
