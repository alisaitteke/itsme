import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: ({ browser }) => ({
    name: 'itsme',
    description: 'Lets an MCP server on this machine drive the browser.',
    permissions: [
      'tabs',
      'scripting',
      'storage',
      'alarms',
      // Real mouse and keyboard input; only Chromium has the API.
      ...(browser === 'firefox' || browser === 'safari' ? [] : ['debugger']),
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
