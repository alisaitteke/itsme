import { browser } from 'wxt/browser';
import type { SiteDecision } from '../shared/runtime-messages.ts';

const MARKUP = `
<style>
  .card {
    box-sizing: border-box;
    width: 300px;
    padding: 14px;
    font: 13px/1.4 system-ui, sans-serif;
    color: #111827;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
  }
  strong { font-size: 14px; }
  p { margin: 6px 0 0; }
  .host { font-weight: 600; overflow-wrap: anywhere; }
  .row { display: flex; gap: 8px; margin-top: 12px; }
  button {
    flex: 1;
    padding: 7px;
    font: inherit;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
  }
  #itsme-allow { color: #ffffff; background: #2563eb; border: 0; }
  #itsme-deny { color: #111827; background: transparent; border: 1px solid #d1d5db; }
</style>
<div class="card" role="dialog" aria-label="itsme">
  <strong>itsme</strong>
  <p>An MCP client wants to read and control pages on</p>
  <p class="host"></p>
  <div class="row">
    <button id="itsme-allow" type="button">Allow</button>
    <button id="itsme-deny" type="button">Not now</button>
  </div>
</div>`;

let shown: HTMLElement | null = null;

/** Asks the user, in the page itself, whether this site may be read and driven. */
export function showSitePrompt(host: string): void {
  if (shown?.isConnected) return;

  const container = document.createElement('div');
  container.style.cssText =
    'all: initial; position: fixed; top: 12px; right: 12px; z-index: 2147483647;';
  // Closed, so the page's own scripts can't reach the buttons.
  const root = container.attachShadow({ mode: 'closed' });
  root.innerHTML = MARKUP;
  const hostLine = root.querySelector('.host');
  if (hostLine) hostLine.textContent = host;

  const answer = (allow: boolean) => (event: Event) => {
    // Only a real click counts; a page can dispatch events but can't make them trusted.
    if (!event.isTrusted) return;
    container.remove();
    shown = null;
    void browser.runtime.sendMessage({ type: 'itsme/site-decision', allow } satisfies SiteDecision);
  };
  root.getElementById('itsme-allow')?.addEventListener('click', answer(true));
  root.getElementById('itsme-deny')?.addEventListener('click', answer(false));

  document.documentElement.append(container);
  shown = container;
}
