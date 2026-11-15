import { BridgeError, type Tab } from '@itsme/protocol';
import { type Browser, browser } from 'wxt/browser';

const LOAD_TIMEOUT_MS = 15_000;
// How long to wait for a navigation to begin before assuming it stayed in the same document.
const NAVIGATION_GRACE_MS = 1_500;
// Time for a newly activated tab to paint before it is captured or clicked.
const PAINT_DELAY_MS = 150;

export type BrowserTab = Browser.tabs.Tab & { id: number };

export function toTab(tab: BrowserTab): Tab {
  return {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    active: tab.active,
  };
}

export async function getTab(tabId: number): Promise<BrowserTab> {
  try {
    return (await browser.tabs.get(tabId)) as BrowserTab;
  } catch {
    throw new BridgeError('TAB_NOT_FOUND', `No tab with id ${tabId}`);
  }
}

export async function createTab(url: string, active: boolean): Promise<BrowserTab> {
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

/**
 * Resolves when the tab finishes loading, or after a timeout: a page that is slow to
 * settle is still usable. Call it before starting the navigation so no event is missed.
 */
export function watchLoad(tabId: number, alreadyLoading: boolean): Promise<void> {
  return new Promise((resolve) => {
    let loading = alreadyLoading;

    const finish = () => {
      clearTimeout(timeout);
      clearTimeout(grace);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      resolve();
    };
    const onUpdated = (id: number, change: { status?: string }) => {
      if (id !== tabId) return;
      if (change.status === 'loading') loading = true;
      else if (change.status === 'complete' && loading) finish();
    };
    const onRemoved = (id: number) => {
      if (id === tabId) finish();
    };

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    const timeout = setTimeout(finish, LOAD_TIMEOUT_MS);
    const grace = setTimeout(() => {
      if (!loading) finish();
    }, NAVIGATION_GRACE_MS);

    if (alreadyLoading) {
      browser.tabs.get(tabId).then(
        (tab) => {
          if (tab.status === 'complete') finish();
        },
        () => finish(),
      );
    }
  });
}

/** Makes the tab the visible one in its window. Capture and real input only reach that tab. */
export async function showTab(tabId: number): Promise<void> {
  const tab = await getTab(tabId);
  if (tab.active) return;
  await browser.tabs.update(tabId, { active: true });
  await new Promise((resolve) => setTimeout(resolve, PAINT_DELAY_MS));
}
