import { type Automation, BridgeError, needsAttention } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import {
  type AutomationAction,
  loadAutomations,
  onAutomationsChanged,
} from '../../shared/automations.ts';
import { isDue, nextDue } from '../../shared/schedule.ts';
import { loadSettings, onSettingsChanged } from '../../shared/settings.ts';
import {
  automationOfTab,
  closeAutomationTab,
  closedByRunner,
  forgetTab,
  runAutomation,
} from './runner.ts';
import { enableAutomation, pauseAutomation, recordRun, removeAutomation } from './store.ts';

const TICK_ALARM = 'itsme/automations';
const DUE_ALARM = 'itsme/automation-due';
// The shortest wait the browser's alarms can be trusted with. Anything sooner is a
// timer in this process, which stays alive because every run calls extension APIs.
const ALARM_FLOOR_MS = 30_000;

const running = new Set<string>();
/** When each automation's latest run began, as far as this process has seen. */
const started = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;

const lastStart = (automation: Automation) =>
  started.get(automation.id) ?? automation.history.at(-1)?.at;

async function run(automation: Automation): Promise<void> {
  if (running.has(automation.id)) return;
  running.add(automation.id);
  const at = Date.now();
  started.set(automation.id, at);
  try {
    await recordRun(automation.id, await runAutomation(automation), at);
  } finally {
    running.delete(automation.id);
    void pump();
  }
}

/** Starts every run that is owed and arranges to be called again for the next one. */
async function pump(): Promise<void> {
  clearTimeout(timer);
  const [settings, automations] = await Promise.all([loadSettings(), loadAutomations()]);
  // "Turn off" in the popup stops everything itsme does, automations included.
  if (!settings.enabled) return;

  const now = Date.now();
  let soonest = Number.POSITIVE_INFINITY;
  for (const automation of automations) {
    // One still running is looked at again when it finishes.
    if (automation.status !== 'on' || running.has(automation.id)) continue;
    if (isDue(automation, lastStart(automation), now)) void run(automation);
    else soonest = Math.min(soonest, nextDue(automation, lastStart(automation), now));
  }

  if (soonest - now < ALARM_FLOOR_MS) {
    timer = setTimeout(() => void pump(), Math.max(soonest - now, 0));
  } else if (Number.isFinite(soonest)) {
    await browser.alarms.create(DUE_ALARM, { when: soonest });
  }
}

async function refreshBadge(): Promise<void> {
  const waiting = (await loadAutomations()).filter(needsAttention).length;
  await browser.action.setBadgeText({ text: waiting > 0 ? String(waiting) : '' });
  await browser.action.setBadgeBackgroundColor({ color: '#d97706' });
}

async function onTabClosed(tabId: number): Promise<void> {
  if (closedByRunner(tabId)) return;
  const id = await automationOfTab(tabId);
  if (!id) return;
  await forgetTab(tabId);
  const automation = (await loadAutomations()).find((candidate) => candidate.id === id);
  // Closing the tab of something that keeps repeating is the plainest way to say stop.
  if (automation?.status === 'on' && automation.schedule.every === 'interval') {
    await pauseAutomation(id, 'Its tab was closed');
  }
}

/** Stop pressed on a page: pauses the automation that owns the tab. False if none does. */
export async function stopAutomationOfTab(tabId: number): Promise<boolean> {
  const id = await automationOfTab(tabId);
  if (!id) return false;
  await pauseAutomation(id, 'Stopped on the page');
  return true;
}

export async function deleteAutomation(id: string): Promise<void> {
  await removeAutomation(id);
  started.delete(id);
  await closeAutomationTab(id);
}

/** Carries out what the user pressed on the automations page. */
export async function performAction({ action, id }: AutomationAction): Promise<void> {
  switch (action) {
    case 'approve':
    case 'resume':
      await enableAutomation(id);
      return;
    case 'pause':
      await pauseAutomation(id);
      return;
    case 'remove':
      await deleteAutomation(id);
      return;
    case 'run': {
      const automation = (await loadAutomations()).find((candidate) => candidate.id === id);
      if (!automation) throw new BridgeError('INVALID_PARAMS', `No automation with id "${id}"`);
      if (automation.status === 'pending') {
        throw new BridgeError('INVALID_PARAMS', 'Approve the automation before running it');
      }
      void run(automation);
    }
  }
}

/** Call once when the background starts; listeners have to be added synchronously. */
export function startAutomations(): void {
  // A wake-up twice a minute, for what a timer lost when this process was put to sleep.
  browser.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TICK_ALARM || alarm.name === DUE_ALARM) void pump();
  });
  browser.tabs.onRemoved.addListener((tabId) => void onTabClosed(tabId));
  onAutomationsChanged(() => {
    void refreshBadge();
    void pump();
  });
  onSettingsChanged(() => void pump());
  void refreshBadge();
  void pump();
}
