import { BridgeError, DEFAULT_GROUP, type GroupColor, type Tab } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { pickColor } from '../shared/group-colors.ts';
import { type BrowserTab, getTab, toTab } from './tabs.ts';

// The tabs itsme may touch are the ones in its tab groups: the groups it made itself,
// and any group titled "itsme". It opens its own tabs there, and the user hands over
// a tab by putting it in one of them.
const DEFAULT_COLOR: GroupColor = 'blue';
const GROUPS_KEY = 'ownedGroups';
const OWNED_KEY = 'ownedTabs';

export interface GroupOptions {
  /** Defaults to the "itsme" group. */
  name?: string;
  /** Left out, an existing group keeps its color and a new one gets a free one. */
  color?: GroupColor;
}

interface TabGroup {
  id: number;
  windowId: number;
  title?: string;
  color: string;
}

interface TabGroupsApi {
  query(filter: object): Promise<TabGroup[]>;
  update(groupId: number, changes: { title?: string; color?: string }): Promise<unknown>;
}

/** Null where the browser has no tab groups; a stored list of tab ids stands in. */
function tabGroups(): TabGroupsApi | null {
  const api = (browser as { tabGroups?: TabGroupsApi }).tabGroups;
  return api && typeof browser.tabs.group === 'function' ? api : null;
}

async function stored(key: string): Promise<number[]> {
  const found = await browser.storage.session.get(key);
  return (found[key] as number[] | undefined) ?? [];
}

/**
 * Groups made by itsme are known by id, not by title: a group of the user's that
 * happens to share a name with one of them stays out of reach. Ids only last until
 * the browser restarts, and so does session storage.
 */
async function ownGroups(groups: TabGroupsApi): Promise<TabGroup[]> {
  // The query rejects while the browser has no window open at all.
  const all = await groups.query({}).catch(() => []);
  const made = new Set(await stored(GROUPS_KEY));
  return all.filter((group) => made.has(group.id) || group.title === DEFAULT_GROUP);
}

async function remember(groups: TabGroupsApi, groupId: number): Promise<void> {
  const live = new Set((await groups.query({}).catch(() => [])).map((group) => group.id));
  const made = (await stored(GROUPS_KEY)).filter((id) => live.has(id));
  await browser.storage.session.set({ [GROUPS_KEY]: [...made, groupId] });
}

// Two tabs opened at once for a group that doesn't exist yet must not make two groups.
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

export async function sessionTabs(): Promise<BrowserTab[]> {
  const groups = tabGroups();
  const tabs = (await browser.tabs.query({})).filter(
    (tab): tab is BrowserTab => tab.id !== undefined,
  );
  if (groups) {
    const ids = new Set((await ownGroups(groups)).map((group) => group.id));
    return tabs.filter((tab) => ids.has(tab.groupId));
  }
  const owned = new Set(await stored(OWNED_KEY));
  return tabs.filter((tab) => owned.has(tab.id));
}

/** Puts a tab into one of itsme's groups, making the group if there is none by that name. */
export function addToSession(tabId: number, options: GroupOptions = {}): Promise<void> {
  return oneAtATime(async () => {
    const groups = tabGroups();
    if (!groups) {
      const ids = new Set(await stored(OWNED_KEY)).add(tabId);
      await browser.storage.session.set({ [OWNED_KEY]: [...ids] });
      return;
    }

    const name = options.name ?? DEFAULT_GROUP;
    const { windowId } = await getTab(tabId);
    const own = await ownGroups(groups);
    // A group can't span windows, so each window gets its own.
    const existing = own.find((group) => group.windowId === windowId && group.title === name);
    if (existing) {
      await browser.tabs.group({ tabIds: [tabId], groupId: existing.id });
      if (options.color && options.color !== existing.color) {
        await groups.update(existing.id, { color: options.color });
      }
      return;
    }

    const groupId = await browser.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
    const sameName = own.find((group) => group.title === name);
    const color =
      options.color ??
      // The same name looks the same in every window.
      sameName?.color ??
      (name === DEFAULT_GROUP ? DEFAULT_COLOR : pickColor(own.map((group) => group.color)));
    await groups.update(groupId, { title: name, color });
    await remember(groups, groupId);
  });
}

export async function removeFromSession(tabId: number): Promise<void> {
  if (tabGroups()) {
    await browser.tabs.ungroup([tabId]);
    return;
  }
  const ids = (await stored(OWNED_KEY)).filter((id) => id !== tabId);
  await browser.storage.session.set({ [OWNED_KEY]: ids });
}

/** The given session tab, or the one used most recently. */
export async function sessionTab(tabId: number | undefined): Promise<BrowserTab> {
  const tabs = await sessionTabs();
  if (tabId === undefined) {
    const latest = tabs.reduce<BrowserTab | undefined>(
      (best, tab) => (!best || (tab.lastAccessed ?? 0) >= (best.lastAccessed ?? 0) ? tab : best),
      undefined,
    );
    if (!latest) {
      throw new BridgeError('TAB_NOT_FOUND', 'No itsme tab is open; open one with tabs_open');
    }
    return latest;
  }

  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (tab) return tab;
  await getTab(tabId);
  throw new BridgeError(
    'TAB_NOT_SHARED',
    `Tab ${tabId} is not in an itsme tab group. The user can share it from the extension popup.`,
  );
}

/** Tabs as the tools report them, each with the group it is in. */
export async function describeTabs(tabs: readonly BrowserTab[]): Promise<Tab[]> {
  const groups = tabGroups();
  const own = groups ? await ownGroups(groups) : [];
  return tabs.map((tab) => {
    const group = own.find((candidate) => candidate.id === tab.groupId);
    return group
      ? { ...toTab(tab), group: { name: group.title ?? '', color: group.color } }
      : toTab(tab);
  });
}

export async function describeTab(tabId: number): Promise<Tab> {
  const [tab] = await describeTabs([await getTab(tabId)]);
  return tab as Tab;
}
