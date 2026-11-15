import { composedChildren, isRendered } from '../dom.ts';
import { type Box, mergeLines } from './lines.ts';
import { quoteFinder } from './match.ts';

/** What a mark is drawn on: some text or an element, wherever the page moves it. */
export interface Anchor {
  /** Where it is in the viewport now, one box per line; empty once it is gone. */
  lines(): Box[];
  /** Something to scroll to. */
  element(): Element | null;
}

const UNREAD = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'frame']);

const toBox = (rect: DOMRect): Box => ({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });

/** The page's text nodes in reading order, through open shadow roots, without hidden ones. */
function textNodes(el: Element, out: Text[]): Text[] {
  // A frame has a viewport of its own, which the marks, drawn in this one, can't follow.
  if (UNREAD.has(el.localName) || !isRendered(el)) return out;
  for (const child of composedChildren(el)) {
    if (child.nodeType === Node.ELEMENT_NODE) textNodes(child as Element, out);
    else if (child.nodeType === Node.TEXT_NODE && /\S/.test((child as Text).data)) {
      out.push(child as Text);
    }
  }
  return out;
}

/** Reads the page once and returns how to find quotes in it. */
export function quoteAnchors(): (quote: string) => Anchor | null {
  const nodes = document.body ? textNodes(document.body, []) : [];
  const find = quoteFinder(nodes.map((node) => node.data));

  return (quote) => {
    const span = find(quote);
    if (!span) return null;
    // One range per text node: a range across elements also reports the whole box of
    // every block it covers, and one range can't cross a shadow root at all.
    const ranges: Range[] = [];
    for (let index = span.start.piece; index <= span.end.piece; index++) {
      const node = nodes[index];
      if (!node) continue;
      const from = index === span.start.piece ? span.start.offset : 0;
      const to = index === span.end.piece ? span.end.offset : node.data.length;
      if (from >= to) continue;
      const range = node.ownerDocument.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      ranges.push(range);
    }
    return {
      lines: () =>
        mergeLines(
          ranges
            .filter((range) => range.startContainer.isConnected)
            .flatMap((range) => [...range.getClientRects()].map(toBox)),
        ),
      element: () => ranges[0]?.startContainer.parentElement ?? null,
    };
  };
}

export function elementAnchor(el: Element): Anchor {
  return {
    lines: () => (el.isConnected ? mergeLines([...el.getClientRects()].map(toBox)) : []),
    element: () => el,
  };
}
