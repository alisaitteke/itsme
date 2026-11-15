import type { Tab } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import type { Handlers } from '../router.ts';
import {
  addToSession,
  describeTab,
  describeTabs,
  type GroupOptions,
  sessionTab,
  sessionTabs,
} from '../session-tabs.ts';
import { refuseBlocked } from '../site-access.ts';
import { createTab, watchLoad } from '../tabs.ts';

/** Opens a URL in a new tab of one of itsme's groups and waits for it to load. */
export async function openSessionTab(
  url: string,
  active: boolean,
  group: GroupOptions = {},
): Promise<Tab> {
  await refuseBlocked(url);
  const created = await createTab(url, active);
  await addToSession(created.id, group);
  await watchLoad(created.id, true);
  return describeTab(created.id);
}

export const tabHandlers: Handlers = {
  'tabs.list': async () => ({ tabs: await describeTabs(await sessionTabs()) }),

  'tabs.open': async ({ url, active, group, color }) => ({
    tab: await openSessionTab(url, active, { name: group, color }),
  }),

  'tabs.group': async ({ tabIds, group, color }) => {
    // Checked for every tab before any is moved: only tabs itsme already has can be regrouped.
    for (const tabId of tabIds) await sessionTab(tabId);
    for (const tabId of tabIds) await addToSession(tabId, { name: group, color });
    return { tabs: await Promise.all(tabIds.map(describeTab)) };
  },

  'tabs.close': async ({ tabId }) => {
    await sessionTab(tabId);
    await browser.tabs.remove(tabId);
    return {};
  },

  'tabs.activate': async ({ tabId }) => {
    const tab = await sessionTab(tabId);
    await browser.tabs.update(tabId, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
    return { tab: await describeTab(tabId) };
  },
};
