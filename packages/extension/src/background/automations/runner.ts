import {
  type Automation,
  automationHosts,
  describeLocator,
  describeStep,
  type Locator,
  type Step,
} from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { keyInfo } from '../../shared/keys.ts';
import { loadSettings } from '../../shared/settings.ts';
import { hostOf, matchesSite } from '../../shared/sites.ts';
import { callAgent } from '../agent-client.ts';
import { createTab, watchLoad } from '../tabs.ts';

const TABS_KEY = 'automationTabs';
const GROUP_TITLE = 'itsme automations';
const POLL_MS = 250;
const MAX_ELEMENT_WAIT_MS = 10_000;
// How long after a click the browser may take to start loading the page it leads to.
const NAVIGATION_START_MS = 150;

export interface RunResult {
  ok: boolean;
  note?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tabs the runner closes itself, so that closing them isn't taken for the user's doing. */
const closing = new Set<number>();

async function tabMap(): Promise<Record<string, number>> {
  const stored = (await browser.storage.session.get(TABS_KEY))[TABS_KEY];
  return (stored as Record<string, number> | undefined) ?? {};
}

async function rememberTab(id: string, tabId: number | undefined): Promise<void> {
  const map = await tabMap();
  if (tabId === undefined) delete map[id];
  else map[id] = tabId;
  await browser.storage.session.set({ [TABS_KEY]: map });
}

/** The automation a tab belongs to, if any. */
export async function automationOfTab(tabId: number): Promise<string | undefined> {
  return Object.entries(await tabMap()).find(([, owned]) => owned === tabId)?.[0];
}

/** True once for a tab the runner closed itself. */
export function closedByRunner(tabId: number): boolean {
  return closing.delete(tabId);
}

export async function forgetTab(tabId: number): Promise<void> {
  const id = await automationOfTab(tabId);
  if (id) await rememberTab(id, undefined);
}

export async function closeAutomationTab(id: string): Promise<void> {
  const tabId = (await tabMap())[id];
  if (tabId === undefined) return;
  await rememberTab(id, undefined);
  closing.add(tabId);
  await browser.tabs.remove(tabId).catch(() => closing.delete(tabId));
}

interface GroupsApi {
  query(filter: { title: string; windowId: number }): Promise<Array<{ id: number }>>;
  update(groupId: number, changes: { title: string; color: string }): Promise<unknown>;
}

/**
 * Collects automation tabs in a tab group of their own where the browser has groups.
 * It is not one of the groups the MCP tools reach: what an automation does was approved
 * as it is, and a tool call must not be able to steer it.
 */
async function group(tabId: number, windowId: number): Promise<void> {
  const groups = (browser as { tabGroups?: GroupsApi }).tabGroups;
  if (!groups || typeof browser.tabs.group !== 'function') return;
  const [existing] = await groups.query({ title: GROUP_TITLE, windowId });
  if (existing) {
    await browser.tabs.group({ tabIds: [tabId], groupId: existing.id });
    return;
  }
  const groupId = await browser.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
  await groups.update(groupId, { title: GROUP_TITLE, color: 'grey' });
}

async function openTab(automation: Automation): Promise<number> {
  // In the background: an automation must not take the window from what the user is doing.
  const tab = await createTab(automation.url, false);
  await rememberTab(automation.id, tab.id);
  await group(tab.id, tab.windowId).catch(() => {});
  // A discarded tab can't be scripted, and this one is meant to sit unused between runs.
  await browser.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  await watchLoad(tab.id, true);
  return tab.id;
}

async function hostOfTab(tabId: number): Promise<string | null> {
  const tab = await browser.tabs.get(tabId);
  // Where it is going counts, not where it still is.
  return hostOf(tab.pendingUrl ?? tab.url ?? '');
}

/** Lets a page load that the step just set off finish, so the next step meets the new page. */
async function settle(tabId: number): Promise<void> {
  await sleep(NAVIGATION_START_MS);
  const tab = await browser.tabs.get(tabId);
  if (tab.status === 'loading') await watchLoad(tabId, true);
}

/** A daily run starts on a fresh page; a repeating one keeps working on the page it has. */
async function prepareTab(automation: Automation, hosts: string[]): Promise<number> {
  if (automation.schedule.every === 'day') {
    await closeAutomationTab(automation.id);
    return openTab(automation);
  }
  const tabId = (await tabMap())[automation.id];
  const host = tabId === undefined ? null : await hostOfTab(tabId).catch(() => undefined);
  if (tabId === undefined || host === undefined) return openTab(automation);
  if (host === null || !matchesSite(host, hosts)) {
    // The last run left it somewhere else: bring it back to where it works.
    const loaded = watchLoad(tabId, false);
    await browser.tabs.update(tabId, { url: automation.url });
    await loaded;
  }
  return tabId;
}

/** Polls for the element, since a step often follows a click that is still loading a page. */
async function find(tabId: number, locator: Locator, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // A page in the middle of navigating can't answer; that counts as "not there yet".
    const found = await callAgent(tabId, { kind: 'resolve', locator }).catch(() => null);
    if (found?.ref) return { ref: found.ref, password: found.password };
    if (Date.now() >= deadline) throw new Error(`No ${describeLocator(locator)} on the page`);
    await sleep(POLL_MS);
  }
}

async function runStep(tabId: number, step: Step, timeoutMs: number): Promise<void> {
  switch (step.do) {
    case 'open': {
      const loaded = watchLoad(tabId, false);
      await browser.tabs.update(tabId, { url: step.url });
      await loaded;
      return;
    }
    case 'click': {
      const { ref } = await find(tabId, step.target, timeoutMs);
      await callAgent(tabId, {
        kind: 'click',
        target: { ref },
        button: 'left',
        count: 1,
        modifiers: [],
      });
      return;
    }
    case 'type': {
      const { ref, password } = await find(tabId, step.target, timeoutMs);
      // The text of a step is stored as it is, and a password has no business there.
      if (password) throw new Error('Automations do not type into password fields');
      const { text, submit } = step;
      await callAgent(tabId, { kind: 'type', ref, text, clear: true, submit });
      return;
    }
    case 'press': {
      const key = keyInfo(step.key);
      if (!key) throw new Error(`Unknown key "${step.key}"`);
      await callAgent(tabId, { kind: 'press', key, modifiers: [], count: 1 });
      return;
    }
    case 'wait': {
      const { text } = step;
      if (text === undefined) {
        await sleep((step.seconds ?? 1) * 1000);
        return;
      }
      const deadline = Date.now() + (step.seconds ?? 10) * 1000;
      while (!(await callAgent(tabId, { kind: 'hasText', text }).catch(() => false))) {
        if (Date.now() >= deadline) throw new Error(`"${text}" did not show up`);
        await sleep(POLL_MS);
      }
    }
  }
}

/** Runs the steps once, in the automation's own tab, and says how it went. */
export async function runAutomation(automation: Automation): Promise<RunResult> {
  const { schedule } = automation;
  const daily = schedule.every === 'day';
  // A run must not outlast the gap to the next one waiting for something that isn't there.
  const timeoutMs =
    schedule.every === 'day'
      ? MAX_ELEMENT_WAIT_MS
      : Math.min(MAX_ELEMENT_WAIT_MS, Math.max(1_000, schedule.seconds * 1000));
  try {
    const hosts = automationHosts(automation);
    const { blockedSites } = await loadSettings();
    const blocked = hosts.find((host) => matchesSite(host, blockedSites));
    if (blocked) throw new Error(`${blocked} is on the blocked list`);

    const tabId = await prepareTab(automation, hosts);
    for (const [index, step] of automation.steps.entries()) {
      try {
        await runStep(tabId, step, timeoutMs);
        if (step.do !== 'wait') await settle(tabId);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Step ${index + 1} (${describeStep(step)}): ${detail}`);
      }
      // Approval covered these sites and no others, wherever a click may lead.
      const host = await hostOfTab(tabId);
      if (host !== null && !matchesSite(host, hosts)) {
        throw new Error(`Step ${index + 1} left the approved sites for ${host}`);
      }
    }
    // After a failure the tab stays, so the user can see what the page looked like.
    if (daily) await closeAutomationTab(automation.id);
    return { ok: true };
  } catch (error) {
    return { ok: false, note: error instanceof Error ? error.message : String(error) };
  }
}
