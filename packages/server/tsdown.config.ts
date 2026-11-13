import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,
  // The protocol package is private, so it ships inside the bundle.
  deps: { alwaysBundle: ['@itsme/protocol'] },
});
