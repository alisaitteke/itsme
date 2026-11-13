import { browser } from 'wxt/browser';
import type { Handlers } from '../router.ts';
import { type BrowserTab, getTab, toTab, watchLoad } from '../tabs.ts';

export const tabHandlers: Handlers = {
  'tabs.list': async () => {
    const tabs = await browser.tabs.query({});
    return { tabs: tabs.filter((tab): tab is BrowserTab => tab.id !== undefined).map(toTab) };
  },

  'tabs.open': async ({ url, active }) => {
    const created = (await browser.tabs.create({ url, active })) as BrowserTab;
    await watchLoad(created.id, true);
    return { tab: toTab(await getTab(created.id)) };
  },

  'tabs.close': async ({ tabId }) => {
    await getTab(tabId);
    await browser.tabs.remove(tabId);
    return {};
  },

  'tabs.activate': async ({ tabId }) => {
    const tab = await getTab(tabId);
    await browser.tabs.update(tabId, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
    return { tab: toTab(await getTab(tabId)) };
  },
};
