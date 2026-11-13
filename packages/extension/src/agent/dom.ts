// Elements inside a same-origin iframe belong to that frame's realm, so `instanceof`
// against this window's classes is false for them. Everything here goes by tag name.

export const isInput = (el: Element): el is HTMLInputElement => el.localName === 'input';
export const isTextArea = (el: Element): el is HTMLTextAreaElement => el.localName === 'textarea';
export const isSelect = (el: Element): el is HTMLSelectElement => el.localName === 'select';
export const isHtml = (el: Element): el is HTMLElement => 'isContentEditable' in el;

const isFrame = (el: Element): el is HTMLIFrameElement =>
  el.localName === 'iframe' || el.localName === 'frame';

/** Null for a cross-origin frame, whose document this script can't touch. */
export function frameDocument(el: Element): Document | null {
  if (!isFrame(el)) return null;
  try {
    return el.contentDocument;
  } catch {
    return null;
  }
}

/** Children as rendered: through open shadow roots, slots and same-origin iframes. */
export function composedChildren(el: Element): Node[] {
  const frame = frameDocument(el);
  if (frame) return frame.body ? [frame.body] : [];
  if (el.localName === 'slot') {
    const assigned = (el as HTMLSlotElement).assignedNodes({ flatten: true });
    if (assigned.length > 0) return assigned;
  }
  return [...(el.shadowRoot ?? el).childNodes];
}

/** Parent in the rendered tree: the shadow host for a shadow child, the iframe for a body. */
export function composedParent(el: Element): Element | null {
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  if ('host' in root) return (root as ShadowRoot).host;
  return el.ownerDocument.defaultView?.frameElement ?? null;
}

export function isRendered(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.checkVisibility({ checkVisibilityCSS: true })) return true;
  // display: contents has no box of its own but its children still render.
  return el.ownerDocument.defaultView?.getComputedStyle(el).display === 'contents';
}

export function clean(text: string | null | undefined, maxLength: number): string {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

export function visibleText(el: Element | null | undefined): string {
  // biome-ignore lint/performance/useDomNodeTextContent: textContent includes hidden text, scripts and styles
  return (el as HTMLElement | null | undefined)?.innerText ?? '';
}

/** The focused element, followed into shadow roots and same-origin iframes. */
export function deepActiveElement(): Element | null {
  let active = document.activeElement;
  for (;;) {
    const inner = active
      ? (frameDocument(active)?.activeElement ?? active.shadowRoot?.activeElement)
      : null;
    if (!inner || inner === active) return active;
    active = inner;
  }
}
