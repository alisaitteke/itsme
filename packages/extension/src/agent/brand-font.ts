import { browser } from 'wxt/browser';
import { FONT_REQUEST, type FontFile } from '../shared/runtime-messages.ts';

/** The name the brand's typeface goes by on a page, unlikely to be one the page uses. */
export const BRAND_FONT = 'itsme Figtree';

let asked = false;

/**
 * Brings the brand's typeface into the page. Whatever names BRAND_FONT in its font
 * stack is set in the next font down until the typeface is there, and in it from then on.
 */
export function loadBrandFont(): void {
  if (asked) return;
  asked = true;
  void browser.runtime
    .sendMessage(FONT_REQUEST)
    .then((files: FontFile[]) => {
      for (const { data, unicodeRange } of files) {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        document.fonts.add(new FontFace(BRAND_FONT, bytes, { weight: '300 900', unicodeRange }));
      }
    })
    // Without it the overlays are set in the system's font, which is fine.
    .catch(() => {});
}
