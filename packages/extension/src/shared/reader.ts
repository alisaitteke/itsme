import { browser } from 'wxt/browser';

/**
 * The browser's own PDF viewer shows a document no extension can read or draw on, so
 * itsme shows PDFs in a page of its own. That page's address carries the PDF's.
 */
const READER_PAGE = '/reader.html';
const SOURCE = 'src';

export function readerUrlFor(pdfUrl: string): string {
  return `${browser.runtime.getURL(READER_PAGE)}?${SOURCE}=${encodeURIComponent(pdfUrl)}`;
}

/** The PDF a reader tab shows, or null for any other address. */
export function pdfShownAt(url: string): string | null {
  if (!url.startsWith(browser.runtime.getURL(READER_PAGE))) return null;
  const source = new URL(url).searchParams.get(SOURCE);
  // Only what a browser would open as a document; never javascript: and the like.
  return source && /^(https?|file):/i.test(source) ? source : null;
}

/** The address that counts for a tab: the PDF's own when the reader is showing it. */
export const pageUrlOf = (url: string): string => pdfShownAt(url) ?? url;
