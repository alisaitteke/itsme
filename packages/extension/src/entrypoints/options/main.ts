import { browser } from 'wxt/browser';
import { DEFAULT_INDICATOR, isIndicatorStyle } from '../../shared/indicator-styles.ts';
import { loadSettings, onSettingsChanged, saveSettings } from '../../shared/settings.ts';
import { normalizeSite } from '../../shared/sites.ts';
import { byId, watchStatus } from '../../ui/status.ts';

const SAVED_NOTE_MS = 1_500;

const form = byId<HTMLFormElement>('settings');
const enabled = byId<HTMLInputElement>('enabled');
const port = byId<HTMLInputElement>('port');
const token = byId<HTMLInputElement>('token');
const realInput = byId<HTMLInputElement>('real-input');
const askSites = byId<HTMLInputElement>('ask-sites');
const indicator = byId<HTMLSelectElement>('indicator');
const allowedList = byId<HTMLUListElement>('allowed');
const blocked = byId<HTMLTextAreaElement>('blocked');
const saved = byId('saved');

const refreshStatus = watchStatus(byId('dot'), byId('status'));
let savedTimer: ReturnType<typeof setTimeout> | undefined;

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
        await saveSettings({ allowedSites: allowedSites.filter((s) => s !== site) });
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
    indicator: isIndicatorStyle(indicator.value) ? indicator.value : DEFAULT_INDICATOR,
    blockedSites: [...new Set(blockedSites)],
  });
  saved.textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    saved.textContent = '';
  }, SAVED_NOTE_MS);
  await refreshStatus();
}

/** Fills the form from storage; `all` is false when only what the popup can change is wanted. */
async function fill(all: boolean): Promise<void> {
  const settings = await loadSettings();
  enabled.checked = settings.enabled;
  realInput.checked = settings.realInput;
  renderAllowed(settings.allowedSites);
  if (!all) return;
  port.value = String(settings.port);
  token.value = settings.token;
  askSites.checked = settings.siteAccess === 'ask';
  indicator.value = settings.indicator;
  blocked.value = settings.blockedSites.join('\n');
}

async function init(): Promise<void> {
  await fill(true);
  // Only Chromium has the debugger API behind this option.
  byId('real-input-row').hidden = !('debugger' in browser);

  for (const control of [enabled, realInput, askSites, indicator]) {
    control.addEventListener('change', () => void save());
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
  // The popup, the Stop button and the site prompt change settings too. Text the user
  // may be typing here is left alone.
  onSettingsChanged(() => void fill(false));
}

void init();
