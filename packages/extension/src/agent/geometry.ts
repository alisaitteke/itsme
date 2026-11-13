import type { Target } from '@itsme/protocol';
import { composedParent, frameDocument } from './dom.ts';
import { AgentError } from './messages.ts';
import { resolveRef } from './refs.ts';

export interface Point {
  x: number;
  y: number;
}

/** Offset of an element's own document inside the top viewport. */
function frameOffset(el: Element): Point {
  let x = 0;
  let y = 0;
  let frame = el.ownerDocument.defaultView?.frameElement;
  while (frame) {
    const rect = frame.getBoundingClientRect();
    x += rect.left + frame.clientLeft;
    y += rect.top + frame.clientTop;
    frame = frame.ownerDocument.defaultView?.frameElement;
  }
  return { x, y };
}

/** Where to press an element, in top-viewport coordinates. */
export function centerOf(el: Element): Point {
  // The first box, not the bounding box: a link wrapped over two lines has a
  // bounding box whose centre can fall outside the link.
  const rect = el.getClientRects()[0] ?? el.getBoundingClientRect();
  const offset = frameOffset(el);
  return { x: offset.x + rect.left + rect.width / 2, y: offset.y + rect.top + rect.height / 2 };
}

/** The innermost element at a top-viewport point, through shadow roots and same-origin iframes. */
export function elementAt(point: Point): Element | null {
  let root: Document | ShadowRoot = document;
  let { x, y } = point;
  let found: Element | null = null;
  for (;;) {
    const hit: Element | null = root.elementFromPoint(x, y);
    if (!hit || hit === found) return found;
    found = hit;
    const inner = frameDocument(hit);
    if (inner) {
      const rect = hit.getBoundingClientRect();
      x -= rect.left + hit.clientLeft;
      y -= rect.top + hit.clientTop;
      root = inner;
    } else if (hit.shadowRoot) {
      root = hit.shadowRoot;
    } else {
      return found;
    }
  }
}

function composedContains(ancestor: Element, el: Element): boolean {
  for (let node: Element | null = el; node; node = composedParent(node)) {
    if (node === ancestor) return true;
  }
  return false;
}

/** Would a real pointer at `point` land on `el`, or on something covering it? */
export function isHittable(el: Element, point: Point): boolean {
  const top = elementAt(point);
  return top !== null && (composedContains(el, top) || composedContains(top, el));
}

export function inViewport(point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x <= innerWidth && point.y <= innerHeight;
}

export function isPoint(target: Target): target is Point {
  return target.x !== undefined && target.y !== undefined;
}

export function elementFor(target: Target): Element {
  if (target.ref !== undefined) return resolveRef(target.ref);
  if (!isPoint(target)) throw new AgentError('INVALID_PARAMS', 'Give a ref, or both x and y');
  const el = elementAt(target);
  if (!el) throw new AgentError('ELEMENT_NOT_FOUND', `Nothing at ${target.x}, ${target.y}`);
  return el;
}
