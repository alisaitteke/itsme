/** Whether the page is dark, going by its background color. */
export function pageIsDark(): boolean {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const parts = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor)?.[1];
    if (!parts) continue;
    const [r = 255, g = 255, b = 255, alpha = 1] = parts.split(/[\s,/]+/).map(Number);
    if (alpha < 0.5) continue;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
  }
  return false;
}
