import type { SnapshotElement } from '@itsme/protocol';
import type { AgentResults } from './messages.ts';
import { refFor } from './refs.ts';

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(',');

const MAX_ELEMENTS = 400;
const MAX_NAME_LENGTH = 120;

const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);

function isVisible(element: Element): boolean {
  if (!element.checkVisibility({ checkVisibilityCSS: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function visibleText(element: Element | null): string {
  // biome-ignore lint/performance/useDomNodeTextContent: textContent includes hidden text, scripts and styles
  return (element as HTMLElement | null)?.innerText ?? '';
}

function clean(text: string | null | undefined): string {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_NAME_LENGTH
    ? `${collapsed.slice(0, MAX_NAME_LENGTH - 1)}…`
    : collapsed;
}

function roleOf(element: Element): string {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  if (element instanceof HTMLAnchorElement) return 'link';
  if (element instanceof HTMLSelectElement) return 'combobox';
  if (element instanceof HTMLTextAreaElement) return 'textbox';
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') return element.type;
    return BUTTON_INPUT_TYPES.has(element.type) ? 'button' : 'textbox';
  }
  if (element instanceof HTMLElement && element.isContentEditable) return 'textbox';
  return 'button';
}

function labelledBy(element: Element): string {
  const ids = element.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

function nameOf(element: Element): string {
  const candidates: Array<() => string | null | undefined> = [
    () => element.getAttribute('aria-label'),
    () => labelledBy(element),
    () => (element as HTMLInputElement).labels?.[0]?.textContent,
    () => element.getAttribute('placeholder'),
    () =>
      element instanceof HTMLInputElement && BUTTON_INPUT_TYPES.has(element.type)
        ? element.value
        : null,
    () =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? null
        : visibleText(element),
    () => element.querySelector('img[alt]')?.getAttribute('alt'),
    () => element.getAttribute('title'),
    () => element.getAttribute('name'),
  ];
  for (const candidate of candidates) {
    const name = clean(candidate());
    if (name) return name;
  }
  return '';
}

function stateOf(element: Element): string | undefined {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? 'checked' : 'unchecked';
    }
    // Password contents never leave the page.
    if (element.type === 'password' || BUTTON_INPUT_TYPES.has(element.type)) return undefined;
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.label;
  return undefined;
}

function describe(element: Element): SnapshotElement {
  const value = stateOf(element);
  return {
    ref: refFor(element),
    role: roleOf(element),
    name: nameOf(element),
    ...(value === undefined ? {} : { value: clean(value) }),
  };
}

export function takeSnapshot(maxTextLength: number): AgentResults['snapshot'] {
  const elements: SnapshotElement[] = [];
  for (const element of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (isVisible(element)) elements.push(describe(element));
  }

  const text = visibleText(document.body)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    url: location.href,
    title: document.title,
    text: text.slice(0, maxTextLength),
    truncated: text.length > maxTextLength,
    elements,
  };
}
