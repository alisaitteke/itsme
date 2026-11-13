import { BridgeError } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { type BrowserTab, getTab } from './tabs.ts';

// The tabs itsme may touch are the ones in a tab group with this title. It opens its
// own tabs there, and the user hands over a tab by putting it in the group.
const GROUP_TITLE = 'itsme';
const GROUP_COLOR = 'blue';
const OWNED_KEY = 'ownedTabs';

interface TabGroupsApi {
  query(filter: { title?: string; windowId?: number }): Promise<Array<{ id: number }>>;
  update(groupId: number, changes: { title: string; color: string }): Promise<unknown>;
}

/** Null where the browser has no tab groups; a stored list of tab ids stands in. */
function tabGroups(): TabGroupsApi | null {
  const api = (browser as { tabGroups?: TabGroupsApi }).tabGroups;
  return api && typeof browser.tabs.group === 'function' ? api : null;
}

async function ownedIds(): Promise<number[]> {
  const stored = await browser.storage.session.get(OWNED_KEY);
  return (stored[OWNED_KEY] as number[] | undefined) ?? [];
}

export async function sessionTabs(): Promise<BrowserTab[]> {
  const groups = tabGroups();
  const tabs = (await browser.tabs.query({})).filter(
    (tab): tab is BrowserTab => tab.id !== undefined,
  );
  if (groups) {
    // The query rejects while the browser has no window open at all.
    const found = await groups.query({ title: GROUP_TITLE }).catch(() => []);
    const ids = new Set(found.map((group) => group.id));
    return tabs.filter((tab) => ids.has(tab.groupId));
  }
  const owned = new Set(await ownedIds());
  return tabs.filter((tab) => owned.has(tab.id));
}

export async function addToSession(tabId: number): Promise<void> {
  const groups = tabGroups();
  if (!groups) {
    const ids = new Set(await ownedIds()).add(tabId);
    await browser.storage.session.set({ [OWNED_KEY]: [...ids] });
    return;
  }
  // A group can't span windows, so each window gets its own.
  const { windowId } = await getTab(tabId);
  const [existing] = await groups.query({ title: GROUP_TITLE, windowId });
  if (existing) {
    await browser.tabs.group({ tabIds: [tabId], groupId: existing.id });
  } else {
    const groupId = await browser.tabs.group({ tabIds: [tabId] });
    await groups.update(groupId, { title: GROUP_TITLE, color: GROUP_COLOR });
  }
}

export async function removeFromSession(tabId: number): Promise<void> {
  if (tabGroups()) {
    await browser.tabs.ungroup([tabId]);
    return;
  }
  const ids = (await ownedIds()).filter((id) => id !== tabId);
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
    `Tab ${tabId} is not in the itsme tab group. The user can share it from the extension popup.`,
  );
}
