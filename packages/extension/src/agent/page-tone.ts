import { composedParent } from './dom.ts';

const DARK_BELOW = 110;

/** How light a CSS color is, from 0 to 255, or null when it lets what is behind it through. */
function lightnessOf(color: string): number | null {
  const parts = /rgba?\(([^)]+)\)/.exec(color)?.[1];
  if (!parts) return null;
  const [r = 255, g = 255, b = 255, alpha = 1] = parts.split(/[\s,/]+/).map(Number);
  return alpha < 0.5 ? null : 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether what an element lies on is dark: its own background, or the nearest one behind it. */
export function darkBehind(el: Element | null): boolean {
  for (let at = el; at; at = composedParent(at)) {
    const lightness = lightnessOf(getComputedStyle(at).backgroundColor);
    if (lightness !== null) return lightness < DARK_BELOW;
  }
  return false;
}

/** Whether the page as a whole is dark. */
export function pageIsDark(): boolean {
  return darkBehind(document.body ?? document.documentElement);
}
