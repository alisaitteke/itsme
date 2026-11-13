import type { CallAgent, InputDriver } from './driver.ts';

/** Scripted DOM events. Works in every browser, but pages see them as untrusted. */
export function createDomInput(agent: CallAgent): InputDriver {
  return {
    async click(tabId, ref) {
      await agent(tabId, { kind: 'click', ref });
    },
    async type(tabId, ref, text, clear, submit) {
      await agent(tabId, { kind: 'type', ref, text, clear, submit });
    },
  };
}
