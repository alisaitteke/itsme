import { BridgeError, type Modifier } from '@itsme/protocol';
import type { Button } from '../../agent/messages.ts';
import { isShortcut, type KeyInfo } from '../../shared/keys.ts';
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

// Bit values the DevTools protocol uses for held modifiers and pressed buttons.
const MODIFIER_BITS: Record<Modifier, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const BUTTON_BITS: Record<Button, number> = { left: 1, right: 2, middle: 4 };

const ENTER: KeyInfo = { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' };
const DRAG_STEPS = 10;

const modifierMask = (modifiers: readonly Modifier[]) =>
  modifiers.reduce((mask, modifier) => mask | MODIFIER_BITS[modifier], 0);

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

  const mouse = (tabId: number, type: string, params: object) =>
    sessions.send(tabId, 'Input.dispatchMouseEvent', { type, ...params });

  async function pressKey(tabId: number, key: KeyInfo, modifiers: readonly Modifier[]) {
    const types = key.text !== undefined && !isShortcut(modifiers);
    const event = {
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode,
      modifiers: modifierMask(modifiers),
    };
    await sessions.send(tabId, 'Input.dispatchKeyEvent', {
      // Only a key event that carries text makes the page see a typed character.
      type: types ? 'keyDown' : 'rawKeyDown',
      ...event,
      ...(types ? { text: key.text } : {}),
    });
    await sessions.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...event });
  }

  return {
    async click(tabId, target, options) {
      await showTab(tabId);
      const point = await agent(tabId, { kind: 'locate', target, scroll: true, why: 'click' });
      // A pointer would land on whatever covers the element, so click it directly instead.
      if (!point.hittable || !(await attached(tabId))) {
        return fallback.click(tabId, target, options);
      }

      const { x, y } = point;
      const modifiers = modifierMask(options.modifiers);
      await mouse(tabId, 'mouseMoved', { x, y, modifiers });
      for (let clickCount = 1; clickCount <= options.count; clickCount++) {
        const press = { x, y, button: options.button, clickCount, modifiers };
        await mouse(tabId, 'mousePressed', { ...press, buttons: BUTTON_BITS[options.button] });
        await mouse(tabId, 'mouseReleased', press);
      }
    },

    async hover(tabId, target) {
      await showTab(tabId);
      const { x, y } = await agent(tabId, { kind: 'locate', target, scroll: true, why: 'hover' });
      if (!(await attached(tabId))) return fallback.hover(tabId, target);
      await mouse(tabId, 'mouseMoved', { x, y });
    },

    async drag(tabId, from, to) {
      await showTab(tabId);
      const start = await agent(tabId, { kind: 'locate', target: from, scroll: true, why: 'drag' });
      // Scrolling again for the drop target would move the start point.
      const end = await agent(tabId, { kind: 'locate', target: to, scroll: false, why: 'drag' });
      if (!start.inViewport || !end.inViewport) {
        throw new BridgeError(
          'INVALID_PARAMS',
          'Both ends of a drag must be visible at once; scroll or resize first',
        );
      }
      if (!(await attached(tabId))) return fallback.drag(tabId, from, to);

      const held = { button: 'left', buttons: BUTTON_BITS.left };
      await mouse(tabId, 'mouseMoved', { x: start.x, y: start.y });
      await mouse(tabId, 'mousePressed', { x: start.x, y: start.y, ...held, clickCount: 1 });
      // Pages track a drag through the moves in between, not just the end points.
      for (let step = 1; step <= DRAG_STEPS; step++) {
        const x = start.x + ((end.x - start.x) * step) / DRAG_STEPS;
        const y = start.y + ((end.y - start.y) * step) / DRAG_STEPS;
        await mouse(tabId, 'mouseMoved', { x, y, ...held });
      }
      await mouse(tabId, 'mouseReleased', { x: end.x, y: end.y, button: 'left', clickCount: 1 });
    },

    async type(tabId, ref, text, clear, submit) {
      await showTab(tabId);
      const control =
        ref === undefined
          ? 'text'
          : (await agent(tabId, { kind: 'focus', ref, select: clear })).control;
      // Typing can't pick a select option or produce an empty value.
      if (control === 'select' || text === '' || !(await attached(tabId))) {
        return fallback.type(tabId, ref, text, clear, submit);
      }

      // Replaces the selection the agent made, or lands at the caret.
      await sessions.send(tabId, 'Input.insertText', { text });
      if (submit) await pressKey(tabId, ENTER, []);
    },

    async press(tabId, key, modifiers, count) {
      await showTab(tabId);
      if (!(await attached(tabId))) return fallback.press(tabId, key, modifiers, count);
      for (let i = 0; i < count; i++) await pressKey(tabId, key, modifiers);
    },
  };
}
