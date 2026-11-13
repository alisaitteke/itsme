import { browser } from 'wxt/browser';
import { addToSession, removeFromSession, sessionTabs } from '../../background/session-tabs.ts';
import { STATUS_REQUEST, type StatusResponse } from '../../shared/runtime-messages.ts';
import { allowSite, loadSettings, saveSettings } from '../../shared/settings.ts';
import { hostOf, normalizeSite } from '../../shared/sites.ts';

const STATUS_POLL_MS = 1_000;

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const dot = byId('dot');
const statusText = byId('status');
const form = byId<HTMLFormElement>('settings');
const enabled = byId<HTMLInputElement>('enabled');
const port = byId<HTMLInputElement>('port');
const token = byId<HTMLInputElement>('token');
const realInput = byId<HTMLInputElement>('real-input');
const askSites = byId<HTMLInputElement>('ask-sites');
const allowedList = byId<HTMLUListElement>('allowed');
const blocked = byId<HTMLTextAreaElement>('blocked');
const share = byId<HTMLButtonElement>('share');

function describe(status: StatusResponse): { state: string; text: string } {
  if (!status) return { state: 'off', text: 'Switched off' };
  if (status.state === 'connected') {
    return { state: 'connected', text: `Connected to server ${status.serverVersion ?? ''}` };
  }
  if (status.state === 'connecting') return { state: 'connecting', text: 'Connecting…' };
  return { state: 'disconnected', text: status.lastError ?? 'Not connected' };
}

async function refreshStatus(): Promise<void> {
  let status: StatusResponse = null;
  try {
    status = await browser.runtime.sendMessage(STATUS_REQUEST);
  } catch {
    // The background is restarting; the next poll will reach it.
    return;
  }
  const { state, text } = describe(status);
  dot.dataset.state = state;
  statusText.textContent = text;
}

function renderAllowed(sites: readonly string[]): void {
  allowedList.replaceChildren(
    ...sites.map((site) => {
      const item = document.createElement('li');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${site}`);
      remove.addEventListener('click', async () => {
        const { allowedSites } = await loadSettings();
        const next = await saveSettings({ allowedSites: allowedSites.filter((s) => s !== site) });
        renderAllowed(next.allowedSites);
      });
      item.append(site, remove);
      return item;
    }),
  );
  if (sites.length === 0) allowedList.textContent = 'None yet';
}

async function save(): Promise<void> {
  const blockedSites = blocked.value
    .split('\n')
    .map(normalizeSite)
    .filter((site): site is string => site !== null);
  await saveSettings({
    enabled: enabled.checked,
    port: port.valueAsNumber,
    token: token.value,
    realInput: realInput.checked,
    siteAccess: askSites.checked ? 'ask' : 'all',
    blockedSites: [...new Set(blockedSites)],
  });
  await refreshStatus();
}

/** Lets the user hand the tab they are looking at to itsme, or take it back. */
async function setupSharing(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  if (tabId === undefined) return;

  const render = async () => {
    const shared = (await sessionTabs()).some((candidate) => candidate.id === tabId);
    share.textContent = shared ? 'Stop sharing this tab' : 'Share this tab';
    share.classList.toggle('secondary', shared);
    share.dataset.shared = String(shared);
    share.disabled = false;
  };
  share.addEventListener('click', async () => {
    share.disabled = true;
    if (share.dataset.shared === 'true') {
      await removeFromSession(tabId);
    } else {
      await addToSession(tabId);
      // Sharing a page is the user saying its site is fine to work on.
      const host = hostOf(tab?.url ?? '');
      if (host) {
        await allowSite(host);
        renderAllowed((await loadSettings()).allowedSites);
      }
    }
    await render();
  });
  await render();
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  enabled.checked = settings.enabled;
  port.value = String(settings.port);
  token.value = settings.token;
  realInput.checked = settings.realInput;
  askSites.checked = settings.siteAccess === 'ask';
  blocked.value = settings.blockedSites.join('\n');
  renderAllowed(settings.allowedSites);
  // Only Chromium has the debugger API behind this option.
  byId('real-input-row').hidden = !('debugger' in browser);

  for (const toggle of [enabled, realInput, askSites]) {
    toggle.addEventListener('change', () => void save());
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });

  await setupSharing();
  await refreshStatus();
  setInterval(() => void refreshStatus(), STATUS_POLL_MS);
}

void init();
