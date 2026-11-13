import { BridgeError, type Target } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { keyInfo } from '../../shared/keys.ts';
import { callAgent } from '../agent-client.ts';
import { pngAtViewportSize } from '../image.ts';
import { currentInput } from '../input/index.ts';
import type { Handlers } from '../router.ts';
import { sessionTab } from '../session-tabs.ts';
import { getTab, showTab, toTab, watchLoad } from '../tabs.ts';
import { openSessionTab } from './tabs.ts';

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

function targetOf({ ref, x, y }: Target): Target {
  const byRef = ref !== undefined && x === undefined && y === undefined;
  const byPoint = ref === undefined && x !== undefined && y !== undefined;
  if (!byRef && !byPoint) {
    throw new BridgeError('INVALID_PARAMS', 'Give either ref, or both x and y');
  }
  return { ref, x, y };
}

export const pageHandlers: Handlers = {
  'page.navigate': async ({ tabId, url }) => {
    let tab: Awaited<ReturnType<typeof sessionTab>>;
    try {
      tab = await sessionTab(tabId);
    } catch (error) {
      // Nothing open yet and no tab asked for: start one.
      if (tabId === undefined && error instanceof BridgeError && error.code === 'TAB_NOT_FOUND') {
        return { tab: await openSessionTab(url, true) };
      }
      throw error;
    }
    const loaded = watchLoad(tab.id, false);
    await browser.tabs.update(tab.id, { url });
    await loaded;
    return { tab: toTab(await getTab(tab.id)) };
  },

  'page.history': async ({ tabId, direction }) => {
    const tab = await sessionTab(tabId);
    const loaded = watchLoad(tab.id, false);
    await traverse(tab.id, direction);
    await loaded;
    return { tab: toTab(await getTab(tab.id)) };
  },

  'page.snapshot': async ({ tabId, filter, ref, maxDepth, maxChars }) => {
    const tab = await sessionTab(tabId);
    return callAgent(tab.id, { kind: 'snapshot', filter, ref, maxDepth, maxChars });
  },

  'page.find': async ({ tabId, query }) => {
    const tab = await sessionTab(tabId);
    return callAgent(tab.id, { kind: 'find', query });
  },

  'page.text': async ({ tabId, maxChars }) => {
    const tab = await sessionTab(tabId);
    return callAgent(tab.id, { kind: 'text', maxChars });
  },

  'page.click': async ({ tabId, button, count, modifiers, ...target }) => {
    const tab = await sessionTab(tabId);
    const input = await currentInput();
    await input.click(tab.id, targetOf(target), { button, count, modifiers });
    return {};
  },

  'page.hover': async ({ tabId, ...target }) => {
    const tab = await sessionTab(tabId);
    await (await currentInput()).hover(tab.id, targetOf(target));
    return {};
  },

  'page.drag': async ({ tabId, from, to }) => {
    const tab = await sessionTab(tabId);
    await (await currentInput()).drag(tab.id, targetOf(from), targetOf(to));
    return {};
  },

  'page.scroll': async ({ tabId, ref, direction, amount }) => {
    const tab = await sessionTab(tabId);
    return callAgent(tab.id, { kind: 'scroll', ref, direction, amount });
  },

  'page.type': async ({ tabId, ref, text, clear, submit }) => {
    const tab = await sessionTab(tabId);
    // Without a ref there is no field to empty; the text goes in at the caret.
    const replace = clear && ref !== undefined;
    await (await currentInput()).type(tab.id, ref, text, replace, submit);
    return {};
  },

  'page.press': async ({ tabId, key, modifiers, count }) => {
    const tab = await sessionTab(tabId);
    const info = keyInfo(key);
    if (!info) throw new BridgeError('INVALID_PARAMS', `Unknown key "${key}"`);
    await (await currentInput()).press(tab.id, info, modifiers, count);
    return {};
  },

  'page.screenshot': async ({ tabId }) => {
    const tab = await sessionTab(tabId);
    await showTab(tab.id);
    let dataUrl: string;
    try {
      dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BridgeError('PAGE_NOT_ACCESSIBLE', `Cannot capture this tab: ${detail}`);
    }
    const viewport = await callAgent(tab.id, { kind: 'viewport' }).catch(() => null);
    return { mimeType: 'image/png', ...(await pngAtViewportSize(dataUrl, viewport)) };
  },
};
