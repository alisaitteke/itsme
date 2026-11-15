import { defineContentScript } from 'wxt/utils/define-content-script';
import { startAgent } from '../agent/main.ts';

export default defineContentScript({
  matches: ['<all_urls>'],
  // Injected on demand by the background instead of into every page.
  registration: 'runtime',
  main: () => startAgent(),
});
