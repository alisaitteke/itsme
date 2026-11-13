import { AgentError } from './messages.ts';

// Refs live in the content script, not in the DOM, so the page can't see or break them.
const elements = new Map<string, WeakRef<Element>>();
const refs = new WeakMap<Element, string>();
let counter = 0;

/** The same element keeps its ref across snapshots of one document. */
export function refFor(element: Element): string {
  let ref = refs.get(element);
  if (!ref) {
    ref = `e${++counter}`;
    refs.set(element, ref);
    elements.set(ref, new WeakRef(element));
  }
  return ref;
}

export function resolveRef(ref: string): Element {
  const element = elements.get(ref)?.deref();
  if (!element?.isConnected) {
    elements.delete(ref);
    throw new AgentError(
      'ELEMENT_NOT_FOUND',
      `Element ${ref} is no longer on the page; take a new snapshot`,
    );
  }
  return element;
}
