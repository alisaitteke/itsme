import { GlobalWorkerOptions, getDocument, type PDFPageProxy, TextLayer } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { browser } from 'wxt/browser';
import { startAgent } from '../../agent/main.ts';
import { markSvg } from '../../shared/brand.ts';
import { pdfShownAt } from '../../shared/reader.ts';
import { byId, el } from '../../ui/dom.ts';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Zoom at which a PDF's own units are CSS pixels. Pages open no larger than this. */
const COMFORTABLE = 1.5;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;
/** Pages this far outside the window still get their picture, so scrolling doesn't show blanks. */
const PAINT_AHEAD = '800px';
const GUTTER = 32;

const pages = byId('pages');
const note = byId('note');
const assets = (dir: string) => browser.runtime.getURL(`/pdfjs/${dir}/` as '/reader.html');

/** One page: a box of the right size, its text straight away, its picture when it comes near. */
class Leaf {
  readonly box = el('div', 'paper');
  readonly element = el('section', 'leaf');
  readonly #text = el('div', 'textLayer');
  readonly #page: PDFPageProxy;
  #layer: TextLayer | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #painting: { cancel(): void } | null = null;
  #zoom = 1;
  near = false;

  constructor(page: PDFPageProxy, count: number) {
    this.#page = page;
    this.element.dataset.page = String(page.pageNumber);
    this.box.append(this.#text);
    this.element.append(el('p', 'leaf-name', `Page ${page.pageNumber} of ${count}`), this.box);
  }

  get width(): number {
    return this.#page.getViewport({ scale: 1 }).width;
  }

  resize(zoom: number): void {
    this.#zoom = zoom;
    const viewport = this.#page.getViewport({ scale: zoom });
    this.box.style.setProperty('--total-scale-factor', String(zoom));
    this.box.style.width = `${Math.floor(viewport.width)}px`;
    this.box.style.height = `${Math.floor(viewport.height)}px`;
    this.#layer?.update({ viewport });
    this.#drop();
    if (this.near) void this.paint();
  }

  async readText(): Promise<void> {
    this.#layer = new TextLayer({
      textContentSource: await this.#page.getTextContent(),
      container: this.#text,
      viewport: this.#page.getViewport({ scale: this.#zoom }),
    });
    await this.#layer.render();
  }

  async paint(): Promise<void> {
    if (this.#canvas) return;
    const sharp = devicePixelRatio || 1;
    const viewport = this.#page.getViewport({ scale: this.#zoom });
    const canvas = el('canvas');
    canvas.width = Math.floor(viewport.width * sharp);
    canvas.height = Math.floor(viewport.height * sharp);
    this.#canvas = canvas;
    this.box.prepend(canvas);
    const task = this.#page.render({
      canvas,
      viewport,
      transform: sharp === 1 ? undefined : [sharp, 0, 0, sharp, 0, 0],
    });
    this.#painting = task;
    try {
      await task.promise;
    } catch {
      // Cancelled because the page went out of reach or changed size; it is painted anew.
    }
  }

  /** Gives the picture's memory back; a long PDF would otherwise keep hundreds of them. */
  leave(): void {
    this.near = false;
    this.#drop();
  }

  #drop(): void {
    this.#painting?.cancel();
    this.#painting = null;
    this.#canvas?.remove();
    this.#canvas = null;
  }
}

function fail(message: string): never {
  note.textContent = message;
  note.classList.add('danger');
  note.hidden = false;
  throw new Error(message);
}

function nameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '') || 'PDF';
  } catch {
    return 'PDF';
  }
}

async function open(): Promise<void> {
  const source = pdfShownAt(location.href);
  if (!source) fail('There is no PDF to open here.');

  // In a tab of its own, which itsme doesn't work in, so the browser's viewer keeps it.
  const original = el('a', 'small', 'Open the original');
  original.href = source;
  original.target = '_blank';
  original.rel = 'noopener';
  document.querySelector('.bar')?.append(original);
  byId('name').textContent = nameOf(source);
  document.title = nameOf(source);

  const pdf = await getDocument({
    url: source,
    // The user's own sign-in, for a PDF behind one.
    withCredentials: true,
    cMapUrl: assets('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assets('standard_fonts'),
    wasmUrl: assets('wasm'),
    useWasm: false,
  }).promise.catch((error: unknown) => {
    const password = (error as { name?: string } | null)?.name === 'PasswordException';
    return fail(
      password
        ? 'This PDF is locked with a password. Open the original to read it.'
        : 'itsme could not open this PDF. Open the original instead.',
    );
  });

  const info = (await pdf.getMetadata().catch(() => null))?.info as { Title?: string } | undefined;
  const title = info?.Title?.trim();
  if (title) {
    byId('name').textContent = title;
    document.title = title;
  }

  const leaves: Leaf[] = [];
  let fitted = true;
  let zoom = 1;

  const fit = () => {
    const widest = Math.max(...leaves.map((leaf) => leaf.width));
    return Math.min(COMFORTABLE, Math.max(MIN_ZOOM, (pages.clientWidth - GUTTER) / widest));
  };
  const setZoom = (next: number) => {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    byId('zoom-level').textContent = `${Math.round((zoom / COMFORTABLE) * 100)}%`;
    for (const leaf of leaves) leaf.resize(zoom);
  };
  const step = (factor: number) => {
    fitted = false;
    setZoom(zoom * factor);
  };
  byId('zoom-in').addEventListener('click', () => step(ZOOM_STEP));
  byId('zoom-out').addEventListener('click', () => step(1 / ZOOM_STEP));

  const byElement = new Map<Element, Leaf>();
  const painter = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const leaf = byElement.get(entry.target);
        if (!leaf) continue;
        if (!entry.isIntersecting) leaf.leave();
        else if (!leaf.near) {
          leaf.near = true;
          void leaf.paint();
        }
      }
    },
    { rootMargin: PAINT_AHEAD },
  );
  // Which page the reader is on: the one that crosses the middle of the window.
  const place = new IntersectionObserver(
    (entries) => {
      const current = entries.find((entry) => entry.isIntersecting)?.target as HTMLElement | null;
      if (current) byId('place').textContent = `Page ${current.dataset.page} of ${pdf.numPages}`;
    },
    { rootMargin: '-50% 0px -50% 0px' },
  );

  note.textContent = `Reading ${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}…`;
  for (let number = 1; number <= pdf.numPages; number++) {
    const leaf = new Leaf(await pdf.getPage(number), pdf.numPages);
    leaves.push(leaf);
    if (number === 1) zoom = fit();
    leaf.resize(zoom);
    byElement.set(leaf.element, leaf);
    pages.append(leaf.element);
    painter.observe(leaf.element);
    place.observe(leaf.element);
    await leaf.readText();
  }
  setZoom(zoom);
  note.hidden = true;

  // Follows the window, and the room the legend takes, until the user picks a zoom.
  let width = pages.clientWidth;
  new ResizeObserver(() => {
    if (!fitted || pages.clientWidth === width) return;
    width = pages.clientWidth;
    setZoom(fit());
  }).observe(pages);
}

byId('mark').innerHTML = markSvg(26);
// This page is the content script of its own tab: itsme reads and marks it like any other.
startAgent(open());
