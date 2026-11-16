// Writes the extension's icons and the README's mark from brand/mark.json: pnpm --filter @itsme/extension icons
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markPng } from './brand-mark.mjs';

const dir = join(import.meta.dirname, '../public/icon');
for (const size of [16, 32, 48, 128]) writeFileSync(join(dir, `${size}.png`), markPng(size));

const mark = JSON.parse(readFileSync(join(import.meta.dirname, '../brand/mark.json'), 'utf8'));
const { d, width, dotAt, dotRadius } = mark.full;
writeFileSync(
  join(import.meta.dirname, '../brand/mark.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><title>itsme</title>` +
    `<rect width="64" height="64" rx="${mark.radius}" fill="${mark.tile}"/>` +
    `<path d="${d}" fill="none" stroke="${mark.stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${dotAt[0]}" cy="${dotAt[1]}" r="${dotRadius}" fill="${mark.dot}"/></svg>\n`,
);
