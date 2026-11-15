import { needsAttention } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { addToSession, removeFromSession, sessionTabs } from '../../background/session-tabs.ts';
import { loadAutomations } from '../../shared/automations.ts';
import { markSvg } from '../../shared/brand.ts';
import { allowSite, loadSettings, saveSettings } from '../../shared/settings.ts';
import { hostOf } from '../../shared/sites.ts';
import { byId } from '../../ui/dom.ts';
import { showInPill, watchStatus } from '../../ui/status.ts';

const share = byId<HTMLButtonElement>('share');
const power = byId<HTMLInputElement>('power');
const help = byId('help');

byId('mark').innerHTML = markSvg(26);

const refreshStatus = watchStatus((view) => {
  showInPill(byId('status'), view);
  // While all is well the popup stays quiet; otherwise it says what to do.
  help.hidden = view.state === 'connected';
  help.textContent = view.help;
  help.classList.toggle('danger', view.state === 'problem');
});

/** Lets the user hand the tab they are looking at to itsme, or take it back. */
async function setupSharing(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  const host = hostOf(tab?.url ?? '');
  if (tabId === undefined || !host) {
    byId('site').textContent = 'This page';
    byId('tab-note').textContent = 'Browser pages like this one can’t be shared with itsme.';
    return;
  }
  byId('site').textContent = host;

  const render = async () => {
    const shared = (await sessionTabs()).some((candidate) => candidate.id === tabId);
    byId('tab-note').textContent = shared
      ? 'Your AI app can read and control this tab.'
      : 'Your AI app can’t see this tab.';
    share.textContent = shared ? 'Stop sharing this tab' : 'Share this tab';
    share.classList.toggle('quiet', shared);
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
      await allowSite(host);
    }
    await render();
  });
  await render();
}

async function setupPower(): Promise<void> {
  const render = (on: boolean) => {
    power.checked = on;
    byId('power-name').textContent = on ? 'itsme is on' : 'itsme is off';
    byId('power-desc').textContent = on
      ? 'Your AI apps can use this browser.'
      : 'Nothing can use this browser.';
  };
  power.addEventListener('change', async () => {
    render(power.checked);
    await saveSettings({ enabled: power.checked });
    await refreshStatus();
  });
  render((await loadSettings()).enabled);
}

/** Goes to one of itsme's pages: the tab that already shows it, or a new one. */
function setupLinks(): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.links a')) {
    link.addEventListener('click', async (event) => {
      // Leave modified clicks to the browser: they mean "new tab" or "new window".
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      const [open] = await browser.tabs.query({ url: link.href });
      if (open?.id === undefined) {
        await browser.tabs.create({ url: link.href });
      } else {
        await browser.tabs.update(open.id, { active: true });
        await browser.windows.update(open.windowId, { focused: true });
      }
      window.close();
    });
  }
}

async function showWaitingAutomations(): Promise<void> {
  const waiting = (await loadAutomations()).filter(needsAttention).length;
  const badge = byId('review');
  badge.hidden = waiting === 0;
  badge.textContent = String(waiting);
  badge.setAttribute('aria-label', `${waiting} to review`);
}

setupLinks();
void setupSharing();
void setupPower();
void showWaitingAutomations();
