import { browser } from 'wxt/browser';
import { BRAND, markSvg } from '../shared/brand.ts';
import type { SiteDecision } from '../shared/runtime-messages.ts';

const MARKUP = `
<style>
  .card {
    box-sizing: border-box;
    width: 340px;
    max-width: calc(100vw - 28px);
    padding: 18px;
    font: 15px/1.45 system-ui, sans-serif;
    color: #14281f;
    background: #ffffff;
    border: 1px solid #b0c6bc;
    border-radius: 14px;
    box-shadow: 0 12px 34px rgb(12 42 33 / 0.26);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: ${BRAND.ink};
  }
  p { margin: 12px 0 0; }
  .host {
    margin-top: 2px;
    font-size: 19px;
    font-weight: 700;
    color: ${BRAND.ink};
    overflow-wrap: anywhere;
  }
  .row { display: flex; gap: 8px; margin-top: 16px; }
  button {
    flex: 1;
    min-height: 40px;
    font: inherit;
    font-weight: 650;
    border-radius: 10px;
    cursor: pointer;
  }
  button:focus-visible { outline: 2px solid ${BRAND.ink}; outline-offset: 2px; }
  #itsme-allow { color: #ffffff; background: ${BRAND.greenSolid}; border: 0; }
  #itsme-deny { color: ${BRAND.ink}; background: transparent; border: 1px solid #b0c6bc; }
</style>
<div class="card" role="dialog" aria-label="itsme">
  <div class="brand" translate="no">${markSvg(24)}itsme</div>
  <p>Your AI app wants to read and control pages on</p>
  <p class="host"></p>
  <div class="row">
    <button id="itsme-allow" type="button">Allow this site</button>
    <button id="itsme-deny" type="button">Not now</button>
  </div>
</div>`;

let shown: HTMLElement | null = null;

/** Asks the user, in the page itself, whether this site may be read and driven. */
export function showSitePrompt(host: string): void {
  if (shown?.isConnected) return;

  const container = document.createElement('div');
  container.style.cssText =
    'all: initial; position: fixed; top: 14px; right: 14px; z-index: 2147483647;';
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
