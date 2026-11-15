import { needsAttention } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { addToSession, removeFromSession, sessionTabs } from '../../background/session-tabs.ts';
import { loadAutomations } from '../../shared/automations.ts';
import { allowSite, loadSettings, saveSettings } from '../../shared/settings.ts';
import { hostOf } from '../../shared/sites.ts';
import { byId, watchStatus } from '../../ui/status.ts';

const share = byId<HTMLButtonElement>('share');
const power = byId<HTMLButtonElement>('power');

const refreshStatus = watchStatus(byId('dot'), byId('status'));

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
      if (host) await allowSite(host);
    }
    await render();
  });
  await render();
}

async function setupPower(): Promise<void> {
  const render = async () => {
    power.textContent = (await loadSettings()).enabled ? 'Turn off' : 'Turn on';
  };
  power.addEventListener('click', async () => {
    const { enabled } = await loadSettings();
    await saveSettings({ enabled: !enabled });
    await render();
    await refreshStatus();
  });
  await render();
}

/** Says on the button when an automation is waiting for the user. */
async function setupAutomations(): Promise<void> {
  const button = byId<HTMLButtonElement>('automations');
  button.addEventListener('click', () => {
    void browser.tabs.create({ url: browser.runtime.getURL('/automations.html') });
  });
  const waiting = (await loadAutomations()).filter(needsAttention).length;
  if (waiting === 0) return;
  button.textContent = `Automations (${waiting} to review)`;
  button.classList.remove('secondary');
}

byId('add').addEventListener('click', () => {
  void browser.tabs.create({ url: browser.runtime.getURL('/setup.html') });
});
void setupAutomations();
byId('settings').addEventListener('click', () => void browser.runtime.openOptionsPage());
void setupSharing();
void setupPower();
