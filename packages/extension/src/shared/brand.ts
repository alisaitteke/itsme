import mark from '../../brand/mark.json';

/**
 * The itsme mark as inline SVG. Small sizes get the simpler drawing, the same one the
 * toolbar icons are made from, because the full signature turns to mush under 40px.
 */
export function markSvg(size: number): string {
  const shape = size <= 32 ? mark.small : mark.full;
  const [dotX, dotY] = shape.dotAt;
  return (
    `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">` +
    `<rect width="64" height="64" rx="${mark.radius}" fill="${mark.tile}"/>` +
    `<path d="${shape.d}" fill="none" stroke="${mark.stroke}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${dotX}" cy="${dotY}" r="${shape.dotRadius}" fill="${mark.dot}"/></svg>`
  );
}

/** Colors of the parts of itsme that sit on other people's pages, where no stylesheet reaches. */
export const BRAND = {
  green: '#0b8a62',
  greenSolid: '#0a7d59',
  mint: '#bdf7dc',
  ink: '#0c2a21',
  paper: '#f4fbf8',
} as const;
