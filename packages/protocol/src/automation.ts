import { z } from 'zod';
import { httpUrl } from './url.ts';

export const MAX_AUTOMATIONS = 20;
/** Failed runs in a row after which an automation pauses itself. */
export const MAX_FAILURES = 3;
const MAX_STEPS = 20;
const MAX_HISTORY = 10;

/** An element named the way page_snapshot names it, so it can be found again on a later day. */
export const locatorSchema = z.object({
  role: z.string().min(1).optional().describe('Role as page_snapshot shows it, e.g. "button"'),
  name: z.string().min(1).describe('Name as page_snapshot shows it, e.g. "Sign in"'),
});
export type Locator = z.infer<typeof locatorSchema>;

export const stepSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('open'), url: httpUrl.describe('Page to go to in the same tab') }),
  z.object({ do: z.literal('click'), target: locatorSchema }),
  z.object({
    do: z.literal('type'),
    target: locatorSchema,
    text: z.string(),
    submit: z.boolean().default(false).describe('Press Enter afterwards'),
  }),
  z.object({ do: z.literal('press'), key: z.string().min(1).describe('Key name, e.g. Enter') }),
  z.object({
    do: z.literal('wait'),
    text: z.string().min(1).optional().describe('Wait until this text is on the page'),
    seconds: z
      .number()
      .min(0.1)
      .max(60)
      .optional()
      .describe(
        'How long to wait: at most this long for the text (default 10), or exactly this long',
      ),
  }),
]);
export type Step = z.infer<typeof stepSchema>;

export const weekdaySchema = z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
export type Weekday = z.infer<typeof weekdaySchema>;

export const scheduleSchema = z.discriminatedUnion('every', [
  z.object({
    every: z.literal('day'),
    at: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Use HH:MM, e.g. 09:00' })
      .describe("Time of day on the user's clock, HH:MM"),
    days: z
      .array(weekdaySchema)
      .min(1)
      .optional()
      .describe('Only on these days; every day if left out'),
  }),
  z.object({
    every: z.literal('interval'),
    seconds: z.number().min(1).max(86_400).describe('Seconds between runs, at least 1'),
  }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

/** What an MCP client sends to create an automation. */
export const automationInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: httpUrl.describe('Page the automation works on. It gets a tab of its own'),
  schedule: scheduleSchema,
  steps: z
    .array(stepSchema)
    .min(1)
    .max(MAX_STEPS)
    .describe('What to do on each run, in order. The page is already open before the first step'),
});
export type AutomationInput = z.infer<typeof automationInputSchema>;

const runSchema = z.object({
  at: z.number(),
  ok: z.boolean(),
  note: z.string().optional(),
  /** Runs in a row that ended this same way; `at` is the latest of them. */
  times: z.number().int(),
});
export type RunRecord = z.infer<typeof runSchema>;

export const automationSchema = automationInputSchema.extend({
  id: z.string(),
  /** "pending" until the user approves it in the extension; only "on" ever runs. */
  status: z.enum(['pending', 'on', 'paused']),
  pausedBecause: z.string().optional(),
  createdAt: z.number(),
  /** When it was last switched on; nothing scheduled before that is made up for. */
  enabledAt: z.number().optional(),
  runs: z.number().int(),
  /** Runs that failed in a row. */
  failures: z.number().int(),
  history: z.array(runSchema),
});
export type Automation = z.infer<typeof automationSchema>;

const quote = (text: string) => JSON.stringify(text);

export function describeLocator({ role, name }: Locator): string {
  return `${role ?? 'element'} ${quote(name)}`;
}

export function describeStep(step: Step): string {
  switch (step.do) {
    case 'open':
      return `Open ${step.url}`;
    case 'click':
      return `Click ${describeLocator(step.target)}`;
    case 'type':
      return `Type ${quote(step.text)} into ${describeLocator(step.target)}${step.submit ? ' and press Enter' : ''}`;
    case 'press':
      return `Press ${step.key}`;
    case 'wait':
      return step.text ? `Wait for ${quote(step.text)}` : `Wait ${step.seconds ?? 1} s`;
  }
}

export function describeSchedule(schedule: Schedule): string {
  if (schedule.every === 'interval') {
    const { seconds } = schedule;
    if (seconds >= 3600 && seconds % 3600 === 0) return `Every ${seconds / 3600} h`;
    if (seconds >= 60 && seconds % 60 === 0) return `Every ${seconds / 60} min`;
    return `Every ${seconds} s`;
  }
  return `Every ${describeDays(schedule.days)} at ${schedule.at}`;
}

const WORKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

function describeDays(days: readonly Weekday[] | undefined): string {
  const chosen = new Set(days);
  if (!days || chosen.size === 7) return 'day';
  if (chosen.size === 5 && WORKDAYS.every((day) => chosen.has(day))) return 'weekday';
  return days.map((day) => day.charAt(0).toUpperCase() + day.slice(1)).join(', ');
}

/** The sites an automation touches: its page and every page a step opens. */
export function automationHosts(automation: Pick<AutomationInput, 'url' | 'steps'>): string[] {
  const urls = [
    automation.url,
    ...automation.steps.flatMap((step) => (step.do === 'open' ? [step.url] : [])),
  ];
  return [...new Set(urls.map((url) => new URL(url).hostname))];
}

/** An automation with one more result on its record; it pauses itself after repeated failures. */
export function withRun(
  automation: Automation,
  result: { ok: boolean; note?: string; at: number },
  times = 1,
): Automation {
  const failures = result.ok ? 0 : automation.failures + times;
  const history = [...automation.history];
  const last = history.at(-1);
  // A run every few seconds would bury everything else, so repeats share one line.
  if (last && last.ok === result.ok && last.note === result.note) {
    history[history.length - 1] = { ...last, at: result.at, times: last.times + times };
  } else {
    history.push({ at: result.at, ok: result.ok, note: result.note, times });
  }
  const gaveUp = failures >= MAX_FAILURES && automation.status === 'on';
  return {
    ...automation,
    runs: automation.runs + times,
    failures,
    history: history.slice(-MAX_HISTORY),
    ...(gaveUp ? { status: 'paused', pausedBecause: `Failed ${MAX_FAILURES} times in a row` } : {}),
  };
}

/** Waiting for the user: to be approved, or to be looked at after it gave up. */
export function needsAttention(automation: Automation): boolean {
  return (
    automation.status === 'pending' ||
    (automation.status === 'paused' && automation.failures >= MAX_FAILURES)
  );
}
