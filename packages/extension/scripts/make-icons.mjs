// Writes the extension's icons from brand/mark.json: pnpm --filter @itsme/extension icons
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markPng } from './brand-mark.mjs';

const dir = join(import.meta.dirname, '../public/icon');
for (const size of [16, 32, 48, 128]) writeFileSync(join(dir, `${size}.png`), markPng(size));
