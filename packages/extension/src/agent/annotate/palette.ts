import type { MarkColor } from '@itsme/protocol';

/** The order colors are handed out in when a mark doesn't ask for one. */
export const MARK_COLORS: readonly MarkColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
  'orange',
  'purple',
];

// `marker` is the pale tone of a highlighter, `ink` the strong one of a pen.
const TONES: Record<MarkColor, { marker: string; ink: string }> = {
  yellow: { marker: '#ffe34d', ink: '#d99a00' },
  green: { marker: '#8ff0bd', ink: '#0b8a62' },
  blue: { marker: '#a5d4ff', ink: '#2f7de1' },
  pink: { marker: '#ffb3d1', ink: '#e0457f' },
  orange: { marker: '#ffc98a', ink: '#e57a14' },
  purple: { marker: '#d6c2ff', ink: '#7a4fe0' },
};

/** The color a mark's legend entry and number carry, readable on light and dark alike. */
export const inkOf = (color: MarkColor): string => TONES[color].ink;

/**
 * Colors for drawing on the page. Ink darkens light ground and lightens dark ground
 * (see inkLayer in index.ts), so on dark ground the two tones swap jobs.
 */
export function tonesFor(color: MarkColor, dark: boolean): { wash: string; line: string } {
  const { marker, ink } = TONES[color];
  return dark ? { wash: ink, line: marker } : { wash: marker, line: ink };
}
