import { BridgeError } from '@itsme/protocol';
import type { CallAgent, InputDriver } from './driver.ts';

/** Scripted DOM events. Works in every browser, but pages see them as untrusted. */
export function createDomInput(agent: CallAgent): InputDriver {
  return {
    async click(tabId, target, { button, count, modifiers }) {
      await agent(tabId, { kind: 'click', target, button, count, modifiers });
    },
    async hover(tabId, target) {
      await agent(tabId, { kind: 'hover', target });
    },
    async drag() {
      // Scripted mouse events don't move anything a page drags by pointer capture.
      throw new BridgeError(
        'UNSUPPORTED',
        'Dragging needs real input: a Chromium browser with "Real mouse and keyboard input" on',
      );
    },
    async type(tabId, ref, text, clear, submit) {
      await agent(tabId, { kind: 'type', ref, text, clear, submit });
    },
    async press(tabId, key, modifiers, count) {
      await agent(tabId, { kind: 'press', key, modifiers, count });
    },
  };
}
