import { browser } from 'wxt/browser';
import { INDICATOR_STYLES, type IndicatorStyle } from '../../shared/indicator-styles.ts';
import {
  loadSettings,
  onSettingsChanged,
  type Settings,
  saveSettings,
} from '../../shared/settings.ts';
import { normalizeSite } from '../../shared/sites.ts';
import { byId, el } from '../../ui/dom.ts';
import { mountShell } from '../../ui/shell.ts';

const SAVED_NOTE_MS = 1_800;
// The width the preview frame is laid out at in style.css.
const PREVIEW_WIDTH = 960;

const INDICATORS: Record<IndicatorStyle, { name: string; desc: string }> = {
  aurora: { name: 'Aurora', desc: 'Soft glow at the edges' },
  orbit: { name: 'Orbit', desc: 'Light circling the edge' },
  viewfinder: { name: 'Viewfinder', desc: 'Corner marks' },
  ripple: { name: 'Ripple', desc: 'Dots along the edge' },
  none: { name: 'None', desc: 'Just the badge' },
};

type SiteKey = 'allowedSites' | 'blockedSites';

const enabled = byId<HTMLInputElement>('enabled');
const realInput = byId<HTMLInputElement>('real-input');
const askSites = byId<HTMLInputElement>('ask-sites');
const indicator = byId('indicator');
const port = byId<HTMLInputElement>('port');
const saved = byId('saved');

const refreshStatus = mountShell('settings');
let savedTimer: ReturnType<typeof setTimeout> | undefined;

async function save(patch: Partial<Settings>): Promise<void> {
  await saveSettings(patch);
  saved.textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    saved.textContent = '';
  }, SAVED_NOTE_MS);
  await refreshStatus();
}

function renderIndicators(): void {
  indicator.replaceChildren(
    ...INDICATOR_STYLES.map((style) => {
      const input = el('input');
      input.type = 'radio';
      input.name = 'indicator';
      input.value = style;
      input.addEventListener('change', () => void save({ indicator: style }));
      const thumb = el('span', 'thumb');
      thumb.dataset.style = style;
      const choice = el('label', 'choice');
      choice.append(
        input,
        thumb,
        el('span', 'name', INDICATORS[style].name),
        el('span', 'desc', INDICATORS[style].desc),
      );
      return choice;
    }),
  );
}

/** A list of sites with a way to add one and to take one out. Returns how to redraw it. */
function siteList(key: SiteKey, listId: string, formId: string, none: string) {
  const list = byId<HTMLUListElement>(listId);
  const form = byId<HTMLFormElement>(formId);
  const input = form.elements.namedItem('site') as HTMLInputElement;
  const error = form.nextElementSibling as HTMLElement;
  const write = (sites: string[]) =>
    save(key === 'allowedSites' ? { allowedSites: sites } : { blockedSites: sites });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const site = normalizeSite(input.value);
    error.hidden = site !== null;
    if (site === null) {
      error.textContent = 'That isn’t a site address. Try one like example.com.';
      input.focus();
      return;
    }
    const current = (await loadSettings())[key];
    if (!current.includes(site)) await write([...current, site]);
    input.value = '';
  });

  return (sites: readonly string[]) => {
    if (sites.length === 0) {
      list.replaceChildren(el('li', 'none', none));
      return;
    }
    list.replaceChildren(
      ...sites.map((site) => {
        const remove = el('button', 'remove', 'Remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${site}`);
        remove.addEventListener('click', async () => {
          const current = (await loadSettings())[key];
          await write(current.filter((entry) => entry !== site));
        });
        const item = el('li');
        item.append(el('span', 'site', site), remove);
        return item;
      }),
    );
  };
}

const showAllowed = siteList('allowedSites', 'allowed', 'allow-form', 'None yet');
const showBlocked = siteList('blockedSites', 'blocked', 'block-form', 'None');

/** Fills the page from storage; `all` is false when text being typed must be left alone. */
async function fill(all: boolean): Promise<void> {
  const settings = await loadSettings();
  enabled.checked = settings.enabled;
  realInput.checked = settings.realInput;
  askSites.checked = settings.siteAccess === 'ask';
  for (const input of indicator.querySelectorAll('input')) {
    input.checked = input.value === settings.indicator;
  }
  showAllowed(settings.allowedSites);
  showBlocked(settings.blockedSites);
  if (!all) return;
  port.value = String(settings.port);
}

/** Keeps the preview, drawn 960px wide, scaled to the room it has. */
function fitPreview(): void {
  const preview = byId('preview');
  new ResizeObserver(() => {
    preview.style.setProperty('--scale', String(preview.clientWidth / PREVIEW_WIDTH));
  }).observe(preview);
}

async function init(): Promise<void> {
  renderIndicators();
  fitPreview();
  await fill(true);
  // Only Chromium has the debugger API behind this option.
  byId('real-input-row').hidden = !('debugger' in browser);

  enabled.addEventListener('change', () => void save({ enabled: enabled.checked }));
  realInput.addEventListener('change', () => void save({ realInput: realInput.checked }));
  askSites.addEventListener(
    'change',
    () => void save({ siteAccess: askSites.checked ? 'ask' : 'all' }),
  );
  byId<HTMLFormElement>('connection').addEventListener('submit', (event) => {
    event.preventDefault();
    void save({ port: port.valueAsNumber });
  });
  // The popup, the Stop button and the site prompt change settings too.
  onSettingsChanged(() => void fill(false));
}

void init();
