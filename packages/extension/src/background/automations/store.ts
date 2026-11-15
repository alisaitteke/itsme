import {
  type Automation,
  type AutomationInput,
  BridgeError,
  MAX_AUTOMATIONS,
  withRun,
} from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { AUTOMATIONS_KEY, loadAutomations } from '../../shared/automations.ts';

// The background is the only writer, and it writes one change at a time: a run being
// recorded must not undo an approval made in the same moment.
let queue: Promise<unknown> = Promise.resolve();

function update<T>(change: (list: Automation[]) => { list: Automation[]; result: T }): Promise<T> {
  const run = queue.then(async () => {
    const { list, result } = change(await loadAutomations());
    await browser.storage.local.set({ [AUTOMATIONS_KEY]: list });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function notFound(id: string): BridgeError {
  return new BridgeError('INVALID_PARAMS', `No automation with id "${id}"`);
}

function change(id: string, edit: (automation: Automation) => Automation): Promise<Automation> {
  return update((list) => {
    const index = list.findIndex((automation) => automation.id === id);
    const current = list[index];
    if (!current) throw notFound(id);
    const next = edit(current);
    return { list: list.with(index, next), result: next };
  });
}

/** Saved as pending: it runs only once the user has approved it. */
export function createAutomation(input: AutomationInput): Promise<Automation> {
  return update((list) => {
    if (list.length >= MAX_AUTOMATIONS) {
      throw new BridgeError(
        'INVALID_PARAMS',
        `There are already ${MAX_AUTOMATIONS} automations; remove one first`,
      );
    }
    const automation: Automation = {
      ...input,
      id: crypto.randomUUID().slice(0, 8),
      status: 'pending',
      createdAt: Date.now(),
      runs: 0,
      failures: 0,
      history: [],
    };
    return { list: [...list, automation], result: automation };
  });
}

/** Switches an automation on. Only ever called for something the user did. */
export function enableAutomation(id: string): Promise<Automation> {
  return change(id, (automation) => ({
    ...automation,
    status: 'on',
    pausedBecause: undefined,
    enabledAt: Date.now(),
    failures: 0,
  }));
}

/** Pauses a running automation. One still waiting for approval stays waiting. */
export function pauseAutomation(id: string, because?: string): Promise<Automation> {
  return change(id, (automation) =>
    automation.status === 'on'
      ? { ...automation, status: 'paused', pausedBecause: because }
      : automation,
  );
}

export function removeAutomation(id: string): Promise<void> {
  return update((list) => {
    if (!list.some((automation) => automation.id === id)) throw notFound(id);
    return { list: list.filter((automation) => automation.id !== id), result: undefined };
  });
}

const SAVE_EVERY_MS = 5_000;
const unsaved = new Map<string, { times: number; at: number }>();
const savedAt = new Map<string, number>();

/**
 * Puts a finished run on the automation's record. Successes of an automation that
 * runs every second or so are saved in batches; a failure is saved at once.
 */
export async function recordRun(
  id: string,
  result: { ok: boolean; note?: string },
  at: number,
): Promise<void> {
  if (result.ok) {
    const batch = unsaved.get(id) ?? { times: 0, at };
    unsaved.set(id, { times: batch.times + 1, at });
    if (at - (savedAt.get(id) ?? 0) < SAVE_EVERY_MS) return;
  }
  const batch = unsaved.get(id);
  unsaved.delete(id);
  savedAt.set(id, at);
  await change(id, (automation) => {
    const counted = batch
      ? withRun(automation, { ok: true, at: batch.at }, batch.times)
      : automation;
    return result.ok ? counted : withRun(counted, { ...result, at });
  }).catch(() => {
    // Removed while it was running: nothing left to record on.
  });
}
