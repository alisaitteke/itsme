import type { Locator, Match } from '@itsme/protocol';
import { isInteractive, isLeaf, nameOf, roleOf, stateOf } from './describe.ts';
import { clean, composedChildren, frameDocument, isInput, isRendered, visibleText } from './dom.ts';
import type { AgentCall, AgentResults } from './messages.ts';
import { refFor, resolveRef } from './refs.ts';

const MAX_TEXT_LINE = 200;
const MAX_MATCHES = 20;
const MIN_ARTICLE_LENGTH = 200;

const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'svg']);

// Text on either side of one of these is not part of the same sentence.
// biome-ignore format: a word list reads better packed
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'details', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hr', 'li', 'main', 'nav',
  'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul',
]);

// Pages hide their file inputs behind styled buttons, but an upload needs the input itself.
const isFileInput = (el: Element) => isInput(el) && el.type === 'file';

function describeLine(el: Element, role: string): string {
  const state = stateOf(el, role);
  const frame = role === 'frame' && !frameDocument(el) ? ['cross-origin, not readable'] : [];
  const suffix = [...state, ...frame].map((item) => ` ${item}`).join('');
  return `[${refFor(el)}] ${role} ${JSON.stringify(nameOf(el, role))}${suffix}`;
}

/** Builds the indented outline one line at a time, within a character budget. */
class OutlineWriter {
  readonly #lines: string[] = [];
  readonly #maxChars: number;
  #size = 0;
  #pendingText = '';
  #pendingDepth = 0;
  truncated = false;

  constructor(maxChars: number) {
    this.#maxChars = maxChars;
  }

  line(depth: number, content: string): void {
    this.flushText();
    this.#push(depth, content);
  }

  /** Inline fragments collect here until a block boundary turns them into one line. */
  text(depth: number, fragment: string): void {
    if (!this.#pendingText) this.#pendingDepth = depth;
    this.#pendingText += fragment;
  }

  flushText(): void {
    const text = clean(this.#pendingText, MAX_TEXT_LINE);
    this.#pendingText = '';
    if (text) this.#push(this.#pendingDepth, `text ${JSON.stringify(text)}`);
  }

  toString(): string {
    this.flushText();
    return this.#lines.join('\n');
  }

  #push(depth: number, content: string): void {
    if (this.truncated) return;
    const line = `${'  '.repeat(depth)}${content}`;
    if (this.#size + line.length > this.#maxChars) {
      this.truncated = true;
      return;
    }
    this.#size += line.length + 1;
    this.#lines.push(line);
  }
}

type SnapshotOptions = Extract<AgentCall, { kind: 'snapshot' }>;

function walk(el: Element, depth: number, out: OutlineWriter, options: SnapshotOptions): void {
  if (out.truncated || SKIPPED_TAGS.has(el.localName)) return;
  if (!isRendered(el) && !isFileInput(el)) return;

  const interactiveOnly = options.filter === 'interactive';
  const role = roleOf(el);
  const shown = role !== null && (!interactiveOnly || isInteractive(role));
  const block = BLOCK_TAGS.has(el.localName);

  if (block) out.flushText();
  if (role !== null && shown) out.line(depth, describeLine(el, role));
  if (isLeaf(role) || depth >= options.maxDepth) return;

  // A filtered outline is a flat list; a full one nests under each shown element.
  const childDepth = shown && !interactiveOnly ? depth + 1 : depth;
  for (const child of composedChildren(el)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!interactiveOnly) out.text(childDepth, child.textContent ?? '');
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      walk(child as Element, childDepth, out, options);
    }
  }
  if (block || shown) out.flushText();
}

export function takeSnapshot(options: SnapshotOptions): AgentResults['snapshot'] {
  const root = options.ref ? resolveRef(options.ref) : document.body;
  const out = new OutlineWriter(options.maxChars);
  if (root) walk(root, 0, out, options);
  const outline = out.toString();
  return { url: location.href, title: document.title, outline, truncated: out.truncated };
}

function ownText(el: Element): string {
  let text = '';
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
  }
  return text;
}

export function find(query: string): AgentResults['find'] {
  const wanted = query.toLowerCase();
  const matches: Match[] = [];
  let more = false;

  const visit = (el: Element): void => {
    if (more || SKIPPED_TAGS.has(el.localName)) return;
    if (!isRendered(el) && !isFileInput(el)) return;
    const role = roleOf(el);
    let match: Match | null = null;
    if (role !== null) {
      const name = nameOf(el, role);
      const haystack = `${role} ${name} ${stateOf(el, role).join(' ')}`.toLowerCase();
      if (haystack.includes(wanted)) match = { ref: refFor(el), role, name };
    } else if (ownText(el).toLowerCase().includes(wanted)) {
      match = { ref: refFor(el), role: 'text', name: clean(ownText(el), MAX_TEXT_LINE) };
    }
    if (match) {
      if (matches.length >= MAX_MATCHES) {
        more = true;
        return;
      }
      matches.push(match);
    }
    if (isLeaf(role)) return;
    for (const child of composedChildren(el)) {
      if (child.nodeType === Node.ELEMENT_NODE) visit(child as Element);
    }
  };

  if (document.body) visit(document.body);
  return { matches, more };
}

/**
 * Finds the element an automation step names: the first whose role and name are what a
 * snapshot prints for it, or failing that the first whose name contains the wanted one.
 */
export function resolveLocator(locator: Locator): AgentResults['resolve'] {
  const wanted = locator.name.trim().toLowerCase();
  const found: { exact: Element | null; partial: Element | null } = { exact: null, partial: null };

  const visit = (el: Element): void => {
    if (found.exact || SKIPPED_TAGS.has(el.localName)) return;
    if (!isRendered(el) && !isFileInput(el)) return;
    const role = roleOf(el);
    const name = (role ? nameOf(el, role) : clean(ownText(el), MAX_TEXT_LINE)).toLowerCase();
    if (name && (!locator.role || locator.role === (role ?? 'text'))) {
      if (name === wanted) found.exact = el;
      else if (!found.partial && name.includes(wanted)) found.partial = el;
    }
    if (isLeaf(role)) return;
    for (const child of composedChildren(el)) {
      if (child.nodeType === Node.ELEMENT_NODE) visit(child as Element);
    }
  };
  if (document.body) visit(document.body);

  const el = found.exact ?? found.partial;
  return {
    ref: el ? refFor(el) : null,
    password: el !== null && isInput(el) && el.type === 'password',
  };
}

export function hasText(text: string): boolean {
  return visibleText(document.body).toLowerCase().includes(text.toLowerCase());
}

export function readText(maxChars: number): AgentResults['text'] {
  // Prefer the article over the navigation and footers around it.
  const main = document.querySelector('article, main, [role="main"]');
  const mainText = visibleText(main);
  const source = mainText.length >= MIN_ARTICLE_LENGTH ? mainText : visibleText(document.body);
  const text = source.replace(/\n{3,}/g, '\n\n').trim();
  return {
    url: location.href,
    title: document.title,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}
