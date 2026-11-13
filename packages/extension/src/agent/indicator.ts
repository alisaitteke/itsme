import { browser } from 'wxt/browser';
import { STOP_REQUEST } from '../shared/runtime-messages.ts';

// How long the badge stays after the last thing itsme did in the tab.
const LINGER_MS = 4_000;

const MARKUP = `
<style>
  .pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    font: 12px/1.4 system-ui, sans-serif;
    color: #ffffff;
    background: #1f2937;
    border-radius: 999px;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.3);
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #60a5fa; }
  button {
    padding: 3px 10px;
    font: inherit;
    font-weight: 600;
    color: #1f2937;
    background: #ffffff;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    pointer-events: auto;
  }
</style>
<div class="pill" role="status">
  <span class="dot"></span>
  <span>itsme is using this tab</span>
  <button id="itsme-stop" type="button">Stop</button>
</div>`;

let badge: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows the user that the tab is being read or driven, with a way to stop it. */
export function showIndicator(): void {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideIndicator, LINGER_MS);
  if (badge?.isConnected) return;

  const container = document.createElement('div');
  // Clicks pass through everything but the button, so the badge never blocks the page.
  container.style.cssText =
    'all: initial; position: fixed; bottom: 12px; right: 12px; z-index: 2147483647; pointer-events: none;';
  const root = container.attachShadow({ mode: 'closed' });
  root.innerHTML = MARKUP;
  root.getElementById('itsme-stop')?.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    hideIndicator();
    void browser.runtime.sendMessage(STOP_REQUEST);
  });

  document.documentElement.append(container);
  badge = container;
}

export function hideIndicator(): void {
  clearTimeout(hideTimer);
  badge?.remove();
  badge = null;
}
