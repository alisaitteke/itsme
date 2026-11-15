import type { MarkColor, MarkStyle } from '@itsme/protocol';
import type { AgentResults, MarkInput } from '../messages.ts';
import { pageIsDark } from '../page-tone.ts';
import { resolveRef } from '../refs.ts';
import { type Anchor, elementAnchor, quoteAnchors } from './anchor.ts';
import { LEGEND_CSS, renderLegend } from './legend.ts';
import { type Box, boundsOf } from './lines.ts';
import { inkOf, MARK_COLORS, tonesFor } from './palette.ts';
import { sketch } from './sketch.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_TITLE = 'Notes';
/** How long one mark takes to draw. */
const DRAW_MS = 620;
/** The marks of one call start one after the other, this far apart at most. */
const STAGGER_MS = 140;
const STAGGER_TOTAL_MS = 1_400;
/** A smooth scroll to the first mark gets this head start on the drawing. */
const SCROLL_HEAD_START_MS = 450;
const PIN = 17;
/** The panel's width with the gaps around it: what the page gives up to it. */
const PANEL_ROOM = 322;
/** Narrower than this, the page can't spare that room and the list starts folded. */
const ROOMY = 960;

// Both layers sit at the document's origin and scroll with it, so marks stay on their
// text while the page scrolls without any script running.
const HOST =
  'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none;';

const INK_CSS = `
svg { position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: visible; }
path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.highlight path { stroke-linecap: butt; stroke-opacity: 0.62; }
@keyframes itsme-draw { to { stroke-dashoffset: 0; } }
`;

const PIN_CSS = `
.pin {
  position: absolute; top: 0; left: 0; display: grid; place-items: center; box-sizing: border-box;
  width: ${PIN}px; height: ${PIN}px; font: 700 10px/1 system-ui, sans-serif; font-variant-numeric: tabular-nums;
  color: #ffffff; border: 1.5px solid #ffffff; border-radius: 50%; box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
}
.pin[hidden] { display: none; }
`;

interface Entry {
  number: number;
  label: string;
  note?: string;
  style: MarkStyle;
  color: MarkColor;
  seed: number;
  /** Null when what the mark quotes isn't on the page; it is then only in the legend. */
  anchor: Anchor | null;
  strokes: SVGGElement;
  pin: HTMLElement;
  /** The lines the strokes were drawn for, to tell a reflow from a mere move. */
  drawnFor: string;
}

interface Layer {
  /** The page the marks belong to; an app that goes to another one takes them along otherwise. */
  page: string;
  title: string;
  dark: boolean;
  still: boolean;
  ink: HTMLElement;
  ui: HTMLElement;
  svg: SVGSVGElement;
  pins: HTMLElement;
  panel: HTMLElement;
  entries: Entry[];
  /** The page's own left margin from before it was moved aside, or null while it isn't. */
  moved: { value: string; priority: string } | null;
  unwatch(): void;
}

let layer: Layer | null = null;

const pageKey = () => location.origin + location.pathname + location.search;

function createLayer(): Layer {
  const dark = pageIsDark();
  const ink = document.createElement('div');
  // Like a highlighter on paper: marks darken a light page and lighten a dark one, and
  // the text under them stays as sharp as it was. Only a whole layer can blend with the page.
  ink.style.cssText = `${HOST} mix-blend-mode: ${dark ? 'screen' : 'multiply'};`;
  // Closed, so the page's own scripts can't reach in.
  const inkRoot = ink.attachShadow({ mode: 'closed' });
  inkRoot.innerHTML = `<style>${INK_CSS}</style><svg aria-hidden="true"></svg>`;

  const ui = document.createElement('div');
  ui.style.cssText = HOST;
  const uiRoot = ui.attachShadow({ mode: 'closed' });
  uiRoot.innerHTML = `<style>${PIN_CSS}${LEGEND_CSS}</style><div class="pins" aria-hidden="true"></div><aside class="panel" aria-label="itsme notes"></aside>`;

  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      follow();
    });
  };
  // Capturing, to hear scrolling inside any box on the page, which doesn't bubble.
  addEventListener('scroll', later, { capture: true, passive: true });
  addEventListener('resize', later, { passive: true });
  const resized = new ResizeObserver(later);
  resized.observe(document.documentElement);
  if (document.body) resized.observe(document.body);

  const panel = uiRoot.querySelector('.panel') as HTMLElement;
  panel.classList.toggle('dark', dark);
  panel.classList.toggle('closed', innerWidth < ROOMY);

  document.documentElement.append(ink, ui);
  return {
    page: pageKey(),
    title: DEFAULT_TITLE,
    dark,
    still: matchMedia('(prefers-reduced-motion: reduce)').matches,
    ink,
    ui,
    svg: inkRoot.querySelector('svg') as SVGSVGElement,
    pins: uiRoot.querySelector('.pins') as HTMLElement,
    panel,
    entries: [],
    moved: null,
    unwatch() {
      removeEventListener('scroll', later, { capture: true });
      removeEventListener('resize', later);
      resized.disconnect();
    },
  };
}

function draw(entry: Entry, lines: readonly Box[], delay: number | null): void {
  if (!layer) return;
  const tones = tonesFor(entry.color, layer.dark);
  const paths = sketch(entry.style, lines, entry.seed).map((stroke) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', stroke.d);
    path.setAttribute('stroke-width', String(stroke.width));
    path.setAttribute('stroke', entry.style === 'highlight' ? tones.wash : tones.line);
    return path;
  });
  entry.strokes.replaceChildren(...paths);
  if (delay === null || layer.still) return;

  const each = Math.max(90, DRAW_MS / paths.length);
  paths.forEach((path, index) => {
    const length = String(Math.ceil(path.getTotalLength()));
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;
    path.style.animation = `itsme-draw ${each}ms ease-out ${delay + index * each}ms forwards`;
  });
}

/** Puts a mark where its text is now. `delay` draws it stroke by stroke, starting then. */
function place(entry: Entry, origin: DOMRect, delay: number | null = null): void {
  const lines = entry.anchor?.lines() ?? [];
  const gone = lines.length === 0;
  entry.strokes.style.display = gone ? 'none' : '';
  entry.pin.hidden = gone;
  if (gone) return;

  const bounds = boundsOf(lines);
  const local = lines.map((line) => ({ ...line, x: line.x - bounds.x, y: line.y - bounds.y }));
  const shape = local.map((line) => [line.x, line.y, line.w, line.h].map(Math.round)).join(';');
  if (shape !== entry.drawnFor || delay !== null) {
    entry.drawnFor = shape;
    draw(entry, local, delay);
  }
  const x = bounds.x - origin.left;
  const y = bounds.y - origin.top;
  entry.strokes.setAttribute('transform', `translate(${x} ${y})`);
  // The number hangs on the corner where the mark starts, where it covers the least text.
  const startX = (lines[0]?.x ?? bounds.x) - origin.left;
  entry.pin.style.transform = `translate(${Math.max(2, startX - PIN + 4)}px, ${y - PIN + 5}px)`;
}

/**
 * Moves the page aside while the open list would lie on marked text. Decided while the
 * page is where it belongs: once moved, nothing is under the list to tell by.
 */
function makeRoom(): void {
  if (!layer) return;
  const root = document.documentElement;
  const open = !layer.panel.classList.contains('closed');
  if (!open || innerWidth < ROOMY) {
    if (layer.moved) root.style.setProperty('margin-left', layer.moved.value, layer.moved.priority);
    layer.moved = null;
    return;
  }
  if (layer.moved) return;
  const covered = layer.entries.some((entry) =>
    entry.anchor?.lines().some((line) => line.x < PANEL_ROOM),
  );
  if (!covered) return;
  layer.moved = {
    value: root.style.getPropertyValue('margin-left'),
    priority: root.style.getPropertyPriority('margin-left'),
  };
  root.style.setProperty('margin-left', `${PANEL_ROOM}px`, 'important');
}

function follow(): void {
  if (!layer) return;
  if (pageKey() !== layer.page) {
    clearAnnotations();
    return;
  }
  const origin = layer.ink.getBoundingClientRect();
  for (const entry of layer.entries) place(entry, origin);
}

/** Scrolls to a mark unless it is in view already. Says whether it had to. */
function reveal(entry: Entry): boolean {
  const first = entry.anchor?.lines()[0];
  if (!first || !layer) return false;
  if (first.y >= 70 && first.y + first.h <= innerHeight - 70) return false;
  entry.anchor
    ?.element()
    ?.scrollIntoView({ block: 'center', behavior: layer.still ? 'auto' : 'smooth' });
  return true;
}

function showLegend(): void {
  if (!layer) return;
  const { entries } = layer;
  renderLegend(
    layer.panel,
    layer.title,
    entries.map(({ number, label, note, color, anchor }) => ({
      number,
      label,
      note,
      ink: inkOf(color),
      found: anchor !== null,
    })),
    {
      pick(number) {
        const entry = entries.find((candidate) => candidate.number === number);
        if (!entry || !layer) return;
        const delay = reveal(entry) ? SCROLL_HEAD_START_MS : 0;
        place(entry, layer.ink.getBoundingClientRect(), delay);
      },
      folded() {
        makeRoom();
        follow();
      },
      clear: clearAnnotations,
    },
  );
}

/** Draws marks on the page and lists them in the legend. No marks removes what is there. */
export function annotate(
  title: string | undefined,
  marks: readonly MarkInput[],
  keep: boolean,
): AgentResults['annotate'] {
  // Everything that can fail comes first, so a bad ref leaves the page as it was.
  const findQuote = quoteAnchors();
  const anchors = marks.map((mark) =>
    mark.ref !== undefined ? elementAnchor(resolveRef(mark.ref)) : findQuote(mark.quote ?? ''),
  );

  if (!keep || marks.length === 0) clearAnnotations();
  if (marks.length === 0) return { marked: 0, missing: [] };

  layer ??= createLayer();
  const current = layer;
  if (title) current.title = title;

  const added = marks.map((mark, index): Entry => {
    const number = current.entries.length + index + 1;
    const color = mark.color ?? MARK_COLORS[(number - 1) % MARK_COLORS.length] ?? 'yellow';
    const strokes = document.createElementNS(SVG_NS, 'g');
    strokes.setAttribute('class', mark.style);
    const pin = document.createElement('span');
    pin.className = 'pin';
    pin.textContent = String(number);
    pin.style.background = inkOf(color);
    return {
      number,
      label: mark.label,
      note: mark.note,
      style: mark.style,
      color,
      seed: number * 7_919,
      anchor: anchors[index] ?? null,
      strokes,
      pin,
      drawnFor: '',
    };
  });
  current.entries.push(...added);
  current.svg.append(...added.map((entry) => entry.strokes));
  current.pins.append(...added.map((entry) => entry.pin));
  showLegend();
  // Before anything is drawn: moving the page reflows the text the marks go on.
  makeRoom();

  const placed = added.filter((entry) => entry.anchor !== null);
  const first = placed[0];
  const start = first && reveal(first) ? SCROLL_HEAD_START_MS : 0;
  const gap = Math.min(STAGGER_MS, STAGGER_TOTAL_MS / Math.max(1, placed.length));
  const origin = current.ink.getBoundingClientRect();
  for (const [index, entry] of placed.entries()) place(entry, origin, start + index * gap);

  return {
    marked: placed.length,
    missing: added.filter((entry) => entry.anchor === null).map((entry) => entry.label),
  };
}

export function clearAnnotations(): void {
  if (layer?.moved) {
    const { value, priority } = layer.moved;
    document.documentElement.style.setProperty('margin-left', value, priority);
  }
  layer?.unwatch();
  layer?.ink.remove();
  layer?.ui.remove();
  layer = null;
}
