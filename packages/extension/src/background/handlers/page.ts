import { BridgeError } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { callAgent } from '../agent-client.ts';
import { currentInput } from '../input/index.ts';
import type { Handlers } from '../router.ts';
import { getTab, resolveTab, showTab, toTab, watchLoad } from '../tabs.ts';

async function traverse(tabId: number, direction: 'back' | 'forward'): Promise<void> {
  try {
    if (direction === 'back') await browser.tabs.goBack(tabId);
    else await browser.tabs.goForward(tabId);
  } catch (error) {
    // Chrome hides history entries of pages the user never interacted with from
    // goBack/goForward, and scripted clicks don't count. history.go still reaches them.
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        func: (delta: number) => history.go(delta),
        args: [direction === 'back' ? -1 : 1],
      });
    } catch {
      throw error;
    }
  }
}

export const pageHandlers: Handlers = {
  'page.navigate': async ({ tabId, url }) => {
    const tab = await resolveTab(tabId);
    const loaded = watchLoad(tab.id, false);
    await browser.tabs.update(tab.id, { url });
    await loaded;
    return { tab: toTab(await getTab(tab.id)) };
  },

  'page.history': async ({ tabId, direction }) => {
    const tab = await resolveTab(tabId);
    const loaded = watchLoad(tab.id, false);
    await traverse(tab.id, direction);
    await loaded;
    return { tab: toTab(await getTab(tab.id)) };
  },

  'page.snapshot': async ({ tabId, maxTextLength }) => {
    const tab = await resolveTab(tabId);
    return callAgent(tab.id, { kind: 'snapshot', maxTextLength });
  },

  'page.click': async ({ tabId, ref }) => {
    const tab = await resolveTab(tabId);
    await (await currentInput()).click(tab.id, ref);
    return {};
  },

  'page.type': async ({ tabId, ref, text, clear, submit }) => {
    const tab = await resolveTab(tabId);
    await (await currentInput()).type(tab.id, ref, text, clear, submit);
    return {};
  },

  'page.screenshot': async ({ tabId }) => {
    const tab = await resolveTab(tabId);
    await showTab(tab.id);
    let dataUrl: string;
    try {
      dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BridgeError('PAGE_NOT_ACCESSIBLE', `Cannot capture this tab: ${detail}`);
    }
    return { mimeType: 'image/png', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  },
};
