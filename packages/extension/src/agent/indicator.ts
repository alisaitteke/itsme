import { browser } from 'wxt/browser';
import { BRAND, markSvg } from '../shared/brand.ts';
import {
  DEFAULT_INDICATOR,
  type IndicatorStyle,
  isIndicatorStyle,
  SETTINGS_KEY,
} from '../shared/indicator-styles.ts';
import { STOP_REQUEST } from '../shared/runtime-messages.ts';
import { effects } from './effects/index.ts';
import type { Effect, Point } from './effects/types.ts';
import { pageIsDark } from './page-tone.ts';

// How long the indicator stays after the last thing itsme did in the tab.
const LINGER_MS = 4_000;
const FADE_MS = 350;
// How long the badge stays out of the way of a real click.
const TUCK_MS = 800;

const BASE_CSS = `
.wrap {
  position: fixed; inset: 0; pointer-events: none; transition: opacity ${FADE_MS}ms ease;
  animation: itsme-in .3s ease-out;
  --a: ${BRAND.green}; --b: #19b98a; --c: #62e6c0;
}
.wrap.dark { --a: #2cbf8c; }
.wrap.out { opacity: 0; }
.fx { position: absolute; inset: 0; overflow: hidden; }
.still, .still .fx * { animation: none !important; transition: none !important; }
.pill {
  position: absolute; right: 14px; bottom: 14px; display: flex; align-items: center; gap: 10px;
  padding: 6px 6px 6px 8px; font: 600 14px/1.4 system-ui, sans-serif; color: ${BRAND.paper};
  background: ${BRAND.ink}; border-radius: 999px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.3);
}
.pill[hidden] { display: none; }
.mark { display: block; border-radius: 50%; }
button {
  padding: 5px 14px; font: inherit; font-weight: 700; color: ${BRAND.ink}; background: ${BRAND.mint};
  border: 0; border-radius: 999px; cursor: pointer; pointer-events: auto;
}
button:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
@keyframes itsme-in { from { opacity: 0; } }
`;

const PILL = `
<div class="pill" role="status">
  ${markSvg(24)}
  <span>itsme is using this tab</span>
  <button id="itsme-stop" type="button">Stop</button>
</div>`;

interface Shown {
  host: HTMLElement;
  wrap: HTMLElement;
  pill: HTMLElement;
  effect: Effect | null;
}

let style: IndicatorStyle = DEFAULT_INDICATOR;
let shown: Shown | null = null;
let lingerTimer: ReturnType<typeof setTimeout> | undefined;
let removeTimer: ReturnType<typeof setTimeout> | undefined;
let tuckTimer: ReturnType<typeof setTimeout> | undefined;

function styleIn(settings: unknown): IndicatorStyle {
  const value = (settings as { indicator?: unknown } | undefined)?.indicator;
  return isIndicatorStyle(value) ? value : DEFAULT_INDICATOR;
}

/** Follows the style picked in the popup. Call once when the agent starts. */
export function watchIndicatorStyle(): void {
  void browser.storage.local.get(SETTINGS_KEY).then((stored) => {
    restyle(styleIn(stored[SETTINGS_KEY]));
  });
  browser.storage.onChanged.addListener((changes, area) => {
    const change = area === 'local' ? changes[SETTINGS_KEY] : undefined;
    if (change) restyle(styleIn(change.newValue));
  });
}

function restyle(next: IndicatorStyle): void {
  if (next === style) return;
  style = next;
  // Shown right now: swap it, so a change in the popup is visible at once.
  if (shown) {
    hideIndicator();
    showIndicator();
  }
}

function build(): Shown {
  const host = document.createElement('div');
  // The overlay covers the page but lets every click through; only Stop takes one.
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  // Closed, so the page's own scripts can't reach the button.
  const root = host.attachShadow({ mode: 'closed' });
  const def = style === 'none' ? null : effects[style];
  root.innerHTML = `<style>${BASE_CSS}${def?.css ?? ''}</style><div class="wrap"><div class="fx"></div>${PILL}</div>`;

  const wrap = root.querySelector('.wrap') as HTMLElement;
  const layer = root.querySelector('.fx') as HTMLElement;
  const pill = root.querySelector('.pill') as HTMLElement;
  const env = {
    dark: pageIsDark(),
    still: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  wrap.classList.toggle('dark', env.dark);
  wrap.classList.toggle('still', env.still);
  layer.dataset.style = style;

  root.getElementById('itsme-stop')?.addEventListener('click', (event) => {
    // Only a real click counts; a page can dispatch events but can't make them trusted.
    if (!event.isTrusted) return;
    hideIndicator();
    void browser.runtime.sendMessage(STOP_REQUEST);
  });

  document.documentElement.append(host);
  return { host, wrap, pill, effect: def ? def.mount(layer, env) : null };
}

/** Shows the user that the tab is being read or driven, with a way to stop it. */
export function showIndicator(): void {
  clearTimeout(lingerTimer);
  clearTimeout(removeTimer);
  lingerTimer = setTimeout(fadeOut, LINGER_MS);

  if (!shown?.host.isConnected) shown = build();
  shown.wrap.classList.remove('out');
}

/** Tells the effect that itsme just did something, and where. */
export function pulseIndicator(at: Point | null, what: string): void {
  shown?.effect?.pulse(at, what);
}

/** Takes the badge away for a moment: a real click must not land on Stop. */
export function tuckBadge(): void {
  const pill = shown?.pill;
  if (!pill) return;
  pill.hidden = true;
  clearTimeout(tuckTimer);
  tuckTimer = setTimeout(() => {
    pill.hidden = false;
  }, TUCK_MS);
}

function fadeOut(): void {
  if (!shown) return;
  shown.wrap.classList.add('out');
  removeTimer = setTimeout(hideIndicator, FADE_MS);
}

export function hideIndicator(): void {
  clearTimeout(lingerTimer);
  clearTimeout(removeTimer);
  clearTimeout(tuckTimer);
  shown?.effect?.stop();
  shown?.host.remove();
  shown = null;
}
