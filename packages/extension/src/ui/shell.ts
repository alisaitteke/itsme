import { needsAttention } from '@itsme/protocol';
import { loadAutomations, onAutomationsChanged } from '../shared/automations.ts';
import { markSvg } from '../shared/brand.ts';
import type { StatusView } from '../shared/status-view.ts';
import { byId } from './dom.ts';
import { showInPill, watchStatus } from './status.ts';

const PAGES = [
  { id: 'connect', label: 'Connect', href: '/setup.html' },
  { id: 'automations', label: 'Automations', href: '/automations.html' },
  { id: 'settings', label: 'Settings', href: '/options.html' },
] as const;
export type PageId = (typeof PAGES)[number]['id'];

/**
 * Puts the bar every full page shares at the top: the mark, the way to the other
 * pages, and the connection. Returns a function that checks the connection again now.
 */
export function mountShell(
  current: PageId,
  onStatus?: (view: StatusView) => void,
): () => Promise<void> {
  const links = PAGES.map(
    ({ id, label, href }) =>
      `<a href="${href}" data-page="${id}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');
  const top = document.createElement('header');
  top.className = 'top';
  top.innerHTML =
    `<a class="skip" href="#main">Skip to content</a><div class="top-inner">` +
    `<a class="brand" href="/setup.html" translate="no">${markSvg(28)}<span>itsme</span></a>` +
    `<nav aria-label="Pages">${links}</nav>` +
    `<span id="status" class="status" role="status">Checking…</span></div>`;
  document.body.prepend(top);

  // The count of automations waiting on the user follows them to every page.
  const automations = top.querySelector<HTMLElement>('[data-page="automations"]');
  const showWaiting = async () => {
    const waiting = (await loadAutomations()).filter(needsAttention).length;
    automations?.querySelector('.count')?.remove();
    if (waiting === 0 || !automations) return;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(waiting);
    count.setAttribute('aria-label', `${waiting} to review`);
    automations.append(count);
  };
  onAutomationsChanged(() => void showWaiting());
  void showWaiting();

  return watchStatus((view) => {
    showInPill(byId('status'), view);
    onStatus?.(view);
  });
}
