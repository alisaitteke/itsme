import type { CallAgent, InputDriver } from './driver.ts';

export interface DebuggerInputDeps {
  agent: CallAgent;
  sessions: {
    attach(tabId: number): Promise<void>;
    send(tabId: number, method: string, params?: object): Promise<unknown>;
  };
  /** Makes the tab the visible one in its window; a hidden tab never answers input. */
  showTab(tabId: number): Promise<void>;
  /** Takes over whenever real input isn't possible. */
  fallback: InputDriver;
}

const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };

/** Real mouse and keyboard input through the DevTools protocol (Chromium only). */
export function createDebuggerInput(deps: DebuggerInputDeps): InputDriver {
  const { agent, sessions, showTab, fallback } = deps;

  async function attached(tabId: number): Promise<boolean> {
    try {
      await sessions.attach(tabId);
      return true;
    } catch {
      return false;
    }
  }

  return {
    async click(tabId, ref) {
      await showTab(tabId);
      const point = await agent(tabId, { kind: 'locate', ref });
      // A pointer would land on whatever covers the element, so click it directly instead.
      if (!point.hittable || !(await attached(tabId))) return fallback.click(tabId, ref);

      const { x, y } = point;
      const press = { x, y, button: 'left', clickCount: 1 };
      await sessions.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await sessions.send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...press });
      await sessions.send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...press });
    },

    async type(tabId, ref, text, clear, submit) {
      await showTab(tabId);
      const { control } = await agent(tabId, { kind: 'focus', ref, select: clear });
      // Typing can't pick a select option or produce an empty value.
      if (control === 'select' || text === '' || !(await attached(tabId))) {
        return fallback.type(tabId, ref, text, clear, submit);
      }

      // Replaces the selection the agent made, or lands at the caret.
      await sessions.send(tabId, 'Input.insertText', { text });
      if (submit) {
        // The text is what turns the key press into a form submission.
        await sessions.send(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          ...ENTER,
          text: '\r',
        });
        await sessions.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...ENTER });
      }
    },
  };
}
