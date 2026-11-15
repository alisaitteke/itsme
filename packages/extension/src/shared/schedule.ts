import type { Automation, Schedule, Weekday } from '@itsme/protocol';

type Daily = Extract<Schedule, { every: 'day' }>;
type Timed = Pick<Automation, 'schedule' | 'enabledAt'>;

const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The moment the schedule names on the day that is `daysAhead` after `now`, or null on a day off. */
function momentOn(schedule: Daily, now: number, daysAhead: number): number | null {
  const [hours = 0, minutes = 0] = schedule.at.split(':').map(Number);
  const day = new Date(now);
  // Built from calendar parts, so it stays on the wall-clock time across a clock change.
  const moment = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + daysAhead,
    hours,
    minutes,
  );
  const weekday = WEEKDAYS[moment.getDay()] as Weekday;
  return !schedule.days || schedule.days.includes(weekday) ? moment.getTime() : null;
}

/**
 * Whether a run is owed now. `lastStart` is when the latest run began.
 *
 * A daily automation missed while the browser was closed is made up for later the same
 * day, never on a later one, and never for a time before it was switched on.
 */
export function isDue(automation: Timed, lastStart: number | undefined, now: number): boolean {
  const { schedule, enabledAt = 0 } = automation;
  if (schedule.every === 'interval') {
    // Switched on since the last run: start over instead of waiting out the old gap.
    if (lastStart === undefined || lastStart < enabledAt) return true;
    return now >= lastStart + schedule.seconds * 1000;
  }
  const today = momentOn(schedule, now, 0);
  return today !== null && today <= now && Math.max(lastStart ?? 0, enabledAt) < today;
}

/** When the next run is owed; `now` when one is owed already. */
export function nextDue(automation: Timed, lastStart: number | undefined, now: number): number {
  if (isDue(automation, lastStart, now)) return now;
  const { schedule } = automation;
  if (schedule.every === 'interval') return (lastStart ?? now) + schedule.seconds * 1000;
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const moment = momentOn(schedule, now, daysAhead);
    if (moment !== null && moment > now) return moment;
  }
  return Number.POSITIVE_INFINITY;
}
