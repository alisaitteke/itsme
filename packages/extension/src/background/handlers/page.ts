import { BridgeError, type Target } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { keyInfo } from '../../shared/keys.ts';
import { pdfShownAt, readerUrlFor } from '../../shared/reader.ts';
import { callAgent } from '../agent-client.ts';
import { activeDebugger } from '../debugger/index.ts';
import { pngAtViewportSize } from '../image.ts';
import { currentInput } from '../input/index.ts';
import type { Handlers } from '../router.ts';
import { describeTab, sessionTab } from '../session-tabs.ts';
import { ensureSiteAllowed, refuseBlocked } from '../site-access.ts';
import { type BrowserTab, getTab, showTab, watchLoad } from '../tabs.ts';
import { openSessionTab } from './tabs.ts';

const WAIT_POLL_MS = 200;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** The tab and address last asked whether it shows a PDF, and the answer. */
let lastPdfCheck: { tabId: number; url: string; pdf: boolean } | null = null;

async function showsPdf(tab: BrowserTab): Promise<boolean> {
  const url = tab.url ?? '';
  if (pdfShownAt(url) !== null) return false;
  if (lastPdfCheck?.tabId === tab.id && lastPdfCheck.url === url) return lastPdfCheck.pdf;
  let pdf = false;
  try {
    const [frame] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.contentType === 'application/pdf',
    });
    pdf = frame?.result === true;
  } catch {
    // A page that can't be scripted says so itself when a call reaches it.
  }
  lastPdfCheck = { tabId: tab.id, url, pdf };
  return pdf;
}

/** Moves a tab that shows a PDF into itsme's reader, where it can be read and marked. */
async function intoReader(tab: BrowserTab): Promise<BrowserTab> {
  if (!(await showsPdf(tab))) return tab;
  const loaded = watchLoad(tab.id, false);
  await browser.tabs.update(tab.id, { url: readerUrlFor(tab.url ?? '') });
  await loaded;
  return getTab(tab.id);
}

/** The session tab, once the user has allowed the site it is showing. */
async function pageTab(tabId: number | undefined): Promise<BrowserTab> {
  const tab = await sessionTab(tabId);
  // A PDF's site is asked about where the user has it open, in the browser's own
  // viewer. Only a yes moves the tab into the reader.
  await ensureSiteAllowed(tab);
  return intoReader(tab);
}

async function monitorFor(what: string) {
  const active = await activeDebugger();
  if (!active) {
    throw new BridgeError(
      'UNSUPPORTED',
      `${what} needs the debugger: a Chromium browser with the debugger option on in the popup`,
    );
  }
  return active.monitor;
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
    await refuseBlocked(url);
    const loaded = watchLoad(tab.id, false);
    await browser.tabs.update(tab.id, { url });
    await loaded;
    return { tab: await describeTab(tab.id) };
  },

  'page.history': async ({ tabId, direction }) => {
    const tab = await sessionTab(tabId);
    const loaded = watchLoad(tab.id, false);
    await traverse(tab.id, direction);
    await loaded;
    return { tab: await describeTab(tab.id) };
  },

  'page.snapshot': async ({ tabId, filter, ref, maxDepth, maxChars }) => {
    const tab = await pageTab(tabId);
    return callAgent(tab.id, { kind: 'snapshot', filter, ref, maxDepth, maxChars });
  },

  'page.find': async ({ tabId, query }) => {
    const tab = await pageTab(tabId);
    return callAgent(tab.id, { kind: 'find', query });
  },

  'page.text': async ({ tabId, maxChars }) => {
    const tab = await pageTab(tabId);
    return callAgent(tab.id, { kind: 'text', maxChars });
  },

  'page.annotate': async ({ tabId, title, marks, keep }) => {
    if (marks.some((mark) => (mark.quote === undefined) === (mark.ref === undefined))) {
      throw new BridgeError('INVALID_PARAMS', 'Give each mark either a quote or a ref');
    }
    const tab = await pageTab(tabId);
    return callAgent(tab.id, { kind: 'annotate', title, marks, keep });
  },

  'page.click': async ({ tabId, button, count, modifiers, ...target }) => {
    const tab = await pageTab(tabId);
    const input = await currentInput();
    await input.click(tab.id, targetOf(target), { button, count, modifiers });
    return {};
  },

  'page.hover': async ({ tabId, ...target }) => {
    const tab = await pageTab(tabId);
    await (await currentInput()).hover(tab.id, targetOf(target));
    return {};
  },

  'page.drag': async ({ tabId, from, to }) => {
    const tab = await pageTab(tabId);
    await (await currentInput()).drag(tab.id, targetOf(from), targetOf(to));
    return {};
  },

  'page.scroll': async ({ tabId, ref, direction, amount }) => {
    const tab = await pageTab(tabId);
    return callAgent(tab.id, { kind: 'scroll', ref, direction, amount });
  },

  'page.type': async ({ tabId, ref, text, clear, submit }) => {
    const tab = await pageTab(tabId);
    // Without a ref there is no field to empty; the text goes in at the caret.
    const replace = clear && ref !== undefined;
    await (await currentInput()).type(tab.id, ref, text, replace, submit);
    return {};
  },

  'page.press': async ({ tabId, key, modifiers, count }) => {
    const tab = await pageTab(tabId);
    const info = keyInfo(key);
    if (!info) throw new BridgeError('INVALID_PARAMS', `Unknown key "${key}"`);
    await (await currentInput()).press(tab.id, info, modifiers, count);
    return {};
  },

  'page.wait': async ({ tabId, text, gone, timeoutMs }) => {
    const tab = await pageTab(tabId);
    if (text === undefined) {
      await sleep(timeoutMs);
      return { met: true };
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // A page in the middle of navigating can't answer; that counts as "not there".
      const present = await callAgent(tab.id, { kind: 'hasText', text }).catch(() => false);
      if (present !== gone) return { met: true };
      if (Date.now() >= deadline) return { met: false };
      await sleep(WAIT_POLL_MS);
    }
  },

  'page.upload': async ({ tabId, ref, files }) => {
    const tab = await pageTab(tabId);
    return callAgent(tab.id, { kind: 'upload', ref, files });
  },

  'page.console': async ({ tabId, ...options }) => {
    const tab = await pageTab(tabId);
    return (await monitorFor('The console')).console(tab.id, options);
  },

  'page.network': async ({ tabId, ...options }) => {
    const tab = await pageTab(tabId);
    return (await monitorFor('Network recording')).network(tab.id, options);
  },

  'page.screenshot': async ({ tabId }) => {
    const tab = await pageTab(tabId);
    await showTab(tab.id);
    // The picture should show the page, not the extension's own badge.
    await callAgent(tab.id, { kind: 'hideIndicator' }).catch(() => {});
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
