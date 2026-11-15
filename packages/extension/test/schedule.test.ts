import { describe, expect, it } from 'vitest';
import { isDue, nextDue } from '../src/shared/schedule.ts';

// A Wednesday. Times are on the local clock, as the schedule's are.
const at = (hours: number, minutes = 0, day = 11) =>
  new Date(2026, 10, day, hours, minutes).getTime();

const daily = (time: string, days?: Array<'mon' | 'tue' | 'wed' | 'thu'>, enabledAt = 0) => ({
  schedule: { every: 'day' as const, at: time, days },
  enabledAt,
});
const every = (seconds: number, enabledAt = 0) => ({
  schedule: { every: 'interval' as const, seconds },
  enabledAt,
});

describe('daily schedules', () => {
  it('is due from its time on, once', () => {
    const nine = daily('09:00');
    expect(isDue(nine, undefined, at(8, 59))).toBe(false);
    expect(isDue(nine, undefined, at(9, 0))).toBe(true);
    expect(isDue(nine, at(9, 0), at(9, 1))).toBe(false);
    expect(isDue(nine, at(9, 0, 10), at(9, 0))).toBe(true);
  });

  it('makes up for a missed run later the same day, not on the next', () => {
    const nine = daily('09:00');
    const yesterdaysRun = at(9, 0, 10);
    expect(isDue(nine, yesterdaysRun, at(17, 30))).toBe(true);
    // Nothing ran on the 11th; by the morning of the 12th that run is gone.
    expect(isDue(nine, yesterdaysRun, at(8, 0, 12))).toBe(false);
  });

  it('does not run for a time before it was switched on', () => {
    const switchedOnAtTen = daily('09:00', undefined, at(10, 0));
    expect(isDue(switchedOnAtTen, undefined, at(10, 1))).toBe(false);
    expect(isDue(switchedOnAtTen, undefined, at(9, 0, 12))).toBe(true);
  });

  it('skips the days it is not for', () => {
    expect(isDue(daily('09:00', ['mon', 'tue']), undefined, at(9, 30))).toBe(false);
    expect(isDue(daily('09:00', ['wed']), undefined, at(9, 30))).toBe(true);
  });

  it('knows when it is next', () => {
    const nine = daily('09:00');
    expect(nextDue(nine, undefined, at(8, 0))).toBe(at(9, 0));
    expect(nextDue(nine, at(9, 0), at(9, 5))).toBe(at(9, 0, 12));
    expect(nextDue(nine, undefined, at(9, 5))).toBe(at(9, 5));
    // From Wednesday afternoon, the next Monday or Tuesday is the 16th.
    expect(nextDue(daily('09:00', ['mon', 'tue']), undefined, at(12, 0))).toBe(at(9, 0, 16));
  });
});

describe('interval schedules', () => {
  it('runs at once, then each time the gap has passed', () => {
    const three = every(3);
    expect(isDue(three, undefined, 1_000)).toBe(true);
    expect(isDue(three, 1_000, 3_999)).toBe(false);
    expect(isDue(three, 1_000, 4_000)).toBe(true);
    expect(nextDue(three, 1_000, 2_000)).toBe(4_000);
    expect(nextDue(three, 1_000, 9_000)).toBe(9_000);
  });

  it('starts over when it is switched back on', () => {
    const hourly = every(3600, 50_000);
    expect(isDue(hourly, 10_000, 50_001)).toBe(true);
    expect(isDue(hourly, 50_001, 60_000)).toBe(false);
  });
});
