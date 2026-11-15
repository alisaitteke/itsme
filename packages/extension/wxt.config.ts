import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'wxt';

const pdfjs = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

/**
 * What pdf.js fetches by name while it reads a PDF: character maps and fonts for
 * documents that don't embed their own, and the plain-JavaScript image decoders.
 * The WebAssembly ones would need a looser content security policy.
 */
const PDF_ASSETS: Record<string, (name: string) => boolean> = {
  cmaps: (name) => name.endsWith('.bcmap') || name === 'LICENSE',
  standard_fonts: () => true,
  wasm: (name) =>
    name.endsWith('_nowasm_fallback.js') || /^LICENSE_(PDFJS_)?(JBIG2|OPENJPEG)$/.test(name),
};

export default defineConfig({
  srcDir: 'src',
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      files.push({ absoluteSrc: join(pdfjs, 'LICENSE'), relativeDest: 'pdfjs/LICENSE' });
      for (const [dir, wanted] of Object.entries(PDF_ASSETS)) {
        for (const name of readdirSync(join(pdfjs, dir)).filter(wanted)) {
          files.push({ absoluteSrc: join(pdfjs, dir, name), relativeDest: `pdfjs/${dir}/${name}` });
        }
      }
    },
  },
  outDir: process.env.ITSME_OUT_DIR ?? '.output',
  manifest: ({ browser }) => ({
    name: 'itsme',
    description: 'Lets an MCP server on this machine drive the browser.',
    permissions: [
      'tabs',
      'scripting',
      'storage',
      'alarms',
      // Real input and the tab group itsme works in; only Chromium has these APIs.
      ...(browser === 'firefox' || browser === 'safari' ? [] : ['debugger', 'tabGroups']),
    ],
    host_permissions: ['<all_urls>'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { id: 'itsme@itsme.local', strict_min_version: '128.0' },
          },
        }
      : // An open WebSocket only keeps the service worker alive from Chrome 116.
        { minimum_chrome_version: '116' }),
  }),
});
