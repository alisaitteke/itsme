import type { Tab } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import type { Handlers } from '../router.ts';
import { addToSession, sessionTab, sessionTabs } from '../session-tabs.ts';
import { refuseBlocked } from '../site-access.ts';
import { type BrowserTab, getTab, toTab, watchLoad } from '../tabs.ts';

async function createTab(url: string, active: boolean): Promise<BrowserTab> {
  try {
    return (await browser.tabs.create({ url, active })) as BrowserTab;
  } catch (error) {
    // A browser can be running with no window, which on macOS is common. Open one.
    const created = await browser.windows.create({ url, focused: active });
    const tab = created?.tabs?.[0];
    if (tab?.id === undefined) throw error;
    return tab as BrowserTab;
  }
}

/** Opens a URL in a new tab of the itsme group and waits for it to load. */
export async function openSessionTab(url: string, active: boolean): Promise<Tab> {
  await refuseBlocked(url);
  const created = await createTab(url, active);
  await addToSession(created.id);
  await watchLoad(created.id, true);
  return toTab(await getTab(created.id));
}

export const tabHandlers: Handlers = {
  'tabs.list': async () => ({ tabs: (await sessionTabs()).map(toTab) }),

  'tabs.open': async ({ url, active }) => ({ tab: await openSessionTab(url, active) }),

  'tabs.close': async ({ tabId }) => {
    await sessionTab(tabId);
    await browser.tabs.remove(tabId);
    return {};
  },

  'tabs.activate': async ({ tabId }) => {
    const tab = await sessionTab(tabId);
    await browser.tabs.update(tabId, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
    return { tab: toTab(await getTab(tabId)) };
  },
};
