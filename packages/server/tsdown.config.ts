import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node20',
  clean: true,
  // One file with everything in it: `npx` has nothing to install, and the Claude
  // Desktop bundle needs no node_modules.
  deps: { alwaysBundle: [/./] },
});
