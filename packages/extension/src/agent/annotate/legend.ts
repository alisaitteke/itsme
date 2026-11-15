import { BRAND, markSvg } from '../../shared/brand.ts';
import { BRAND_FONT, loadBrandFont } from '../brand-font.ts';

// The stroke under the title: the signature the brand puts under every heading of its own.
const FLOURISH =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 132 12' preserveAspectRatio='none'%3E%3Cpath d='M2 8c15-8 24 5 40 0s24-8 40-2 26 4 48-2' fill='none' stroke='%23000' stroke-width='2.6' stroke-linecap='round'/%3E%3C/svg%3E\") no-repeat center / 100% 100%";

export interface LegendEntry {
  number: number;
  label: string;
  note?: string;
  /** Color of its number, the same one its mark has on the page. */
  ink: string;
  /** False when what it quotes isn't on the page, so there is nowhere to go. */
  found: boolean;
}

export interface LegendActions {
  /** The user pressed an entry. */
  pick(number: number): void;
  /** The list was folded away or brought back. */
  folded(): void;
  clear(): void;
}

export const LEGEND_CSS = `
.panel {
  position: fixed; top: 14px; left: 14px; display: flex; flex-direction: column;
  box-sizing: border-box; width: 292px; max-width: calc(100vw - 28px); max-height: min(74vh, 640px);
  font: 15px/1.4 "${BRAND_FONT}", system-ui, sans-serif; color: #14281f; background: #ffffff;
  border: 1px solid #b0c6bc; border-radius: 14px; box-shadow: 0 12px 34px rgb(12 42 33 / 0.24);
  pointer-events: auto;
  --soft: #e7f2ed; --muted: #50645c; --line: #d3e2db; --accent: ${BRAND.greenSolid}; --strong: ${BRAND.ink};
  --flourish: ${BRAND.green};
}
.panel header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 0 14px; }
.wordmark {
  flex: 1; font-size: 18px; font-weight: 800; letter-spacing: -0.035em; color: var(--strong);
}
.panel h2 {
  margin: 0; padding: 8px 16px 12px; font-size: 19px; line-height: 1.2; font-weight: 760;
  letter-spacing: -0.02em; color: var(--strong); overflow-wrap: anywhere;
}
.panel h2::after {
  content: ""; display: block; width: 76px; height: 8px; margin-top: 6px;
  background: var(--flourish); -webkit-mask: ${FLOURISH}; mask: ${FLOURISH};
}
.closed h2 { padding-bottom: 12px; font-size: 16px; }
.closed h2::after { display: none; }
.panel .mark { display: block; flex: none; }
.panel button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.panel button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.fold { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 8px; }
.fold:hover, .entry:hover { background: var(--soft); }
.fold svg { transition: transform 0.15s ease; }
.closed .fold svg { transform: rotate(-90deg); }
.closed ol, .closed footer { display: none; }
.panel ol { margin: 0; padding: 0 8px 8px; overflow: auto; list-style: none; }
.entry, .lost { display: flex; gap: 10px; box-sizing: border-box; width: 100%; padding: 8px; text-align: left; border-radius: 10px; }
.entry[aria-current="true"] { background: var(--soft); }
.num {
  display: grid; place-items: center; flex: none; width: 22px; height: 22px; margin-top: 1px;
  font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: #ffffff; border-radius: 50%;
}
.words { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.label { font-weight: 650; color: var(--strong); }
.note, .lost .label { color: var(--muted); }
.note { font-size: 14px; }
.lost .num { background: #93a59e; }
.panel footer { padding: 6px 8px; border-top: 1px solid var(--line); }
.clear { padding: 7px 8px; font-size: 14px; font-weight: 650; color: var(--accent); border-radius: 8px; }
.clear:hover { background: var(--soft); }
/* The panel takes the tone of the page it lies on. */
.panel.dark {
  color: #e4e6e5; background: #1c1d1d; border-color: #4c504e;
  --soft: #2a2c2c; --muted: #a3a8a6; --line: #2f3231; --accent: #63dab0; --strong: #f5f6f6;
  --flourish: #2cbf8c;
}
@media (prefers-reduced-motion: reduce) { .fold svg { transition: none; } }
`;

const CHEVRON =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function words(entry: LegendEntry): HTMLElement {
  const node = el('span', 'words');
  node.append(el('span', 'label', entry.label));
  if (entry.note) node.append(el('span', 'note', entry.note));
  if (!entry.found) node.append(el('span', 'note', 'Not found on this page'));
  return node;
}

function row(entry: LegendEntry, actions: LegendActions, list: HTMLElement): HTMLLIElement {
  const number = el('span', 'num', String(entry.number));
  const item = el('li');
  if (!entry.found) {
    const lost = el('div', 'lost');
    lost.append(number, words(entry));
    item.append(lost);
    return item;
  }
  number.style.background = entry.ink;
  const button = el('button', 'entry');
  button.type = 'button';
  button.append(number, words(entry));
  button.addEventListener('click', () => {
    for (const other of list.querySelectorAll('[aria-current]'))
      other.removeAttribute('aria-current');
    button.setAttribute('aria-current', 'true');
    actions.pick(entry.number);
  });
  item.append(button);
  return item;
}

/** Fills the panel that lists the marks. It keeps being folded or open across calls. */
export function renderLegend(
  panel: HTMLElement,
  title: string,
  entries: readonly LegendEntry[],
  actions: LegendActions,
): void {
  loadBrandFont();
  const header = el('header');
  header.innerHTML = markSvg(24);
  const wordmark = el('span', 'wordmark', 'itsme');
  wordmark.translate = false;
  const fold = el('button', 'fold');
  fold.type = 'button';
  fold.id = 'itsme-notes-fold';
  fold.innerHTML = CHEVRON;
  const showFolded = () => {
    const open = !panel.classList.contains('closed');
    fold.setAttribute('aria-expanded', String(open));
    fold.setAttribute('aria-label', open ? 'Hide the list' : 'Show the list');
  };
  fold.addEventListener('click', () => {
    panel.classList.toggle('closed');
    showFolded();
    actions.folded();
  });
  showFolded();
  header.append(wordmark, fold);

  const list = el('ol');
  list.append(...entries.map((entry) => row(entry, actions, list)));

  const clear = el('button', 'clear', 'Clear marks');
  clear.type = 'button';
  clear.id = 'itsme-notes-clear';
  clear.addEventListener('click', actions.clear);
  const footer = el('footer');
  footer.append(clear);

  panel.replaceChildren(header, el('h2', undefined, title), list, footer);
}
