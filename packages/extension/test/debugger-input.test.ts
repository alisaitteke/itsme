import { describe, expect, it, vi } from 'vitest';
import type { AgentCall } from '../src/agent/messages.ts';
import { createDebuggerInput } from '../src/background/input/debugger.ts';
import type { CallAgent, ClickOptions, InputDriver } from '../src/background/input/driver.ts';
import { keyInfo } from '../src/shared/keys.ts';

const LEFT: ClickOptions = { button: 'left', count: 1, modifiers: [] };

function setup(agentResults: { locate?: object; focus?: object } = {}) {
  const calls: AgentCall[] = [];
  const agent = (async (_tabId: number, call: AgentCall) => {
    calls.push(call);
    if (call.kind === 'locate') {
      return agentResults.locate ?? { x: 10, y: 20, hittable: true, inViewport: true };
    }
    if (call.kind === 'focus') return agentResults.focus ?? { control: 'text' };
    return {};
  }) as CallAgent;
  const sessions = {
    attach: vi.fn(async (_tabId: number) => {}),
    send: vi.fn(async (_tabId: number, _method: string, _params?: object) => ({})),
  };
  const fallback = {
    click: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    drag: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    press: vi.fn(async () => {}),
  } satisfies InputDriver;
  const showTab = vi.fn(async () => {});
  const input = createDebuggerInput({ agent, sessions, showTab, fallback });
  const sent = () => sessions.send.mock.calls.map(([, method, params]) => [method, params]);
  const mouseEvents = () =>
    sent().map(([, params]) => {
      const { type, x, y, clickCount } = params as Record<string, unknown>;
      return clickCount === undefined ? [type, x, y] : [type, x, y, clickCount];
    });
  return { input, calls, sessions, fallback, showTab, sent, mouseEvents };
}

describe('debugger input: pointer', () => {
  it('clicks with a move, press and release at the located point', async () => {
    const { input, mouseEvents, showTab, fallback } = setup();
    await input.click(1, { ref: 'e1' }, LEFT);

    expect(showTab).toHaveBeenCalledWith(1);
    expect(mouseEvents()).toEqual([
      ['mouseMoved', 10, 20],
      ['mousePressed', 10, 20, 1],
      ['mouseReleased', 10, 20, 1],
    ]);
    expect(fallback.click).not.toHaveBeenCalled();
  });

  it('counts up the presses of a double click', async () => {
    const { input, mouseEvents } = setup();
    await input.click(1, { ref: 'e1' }, { ...LEFT, count: 2 });

    expect(mouseEvents().slice(1)).toEqual([
      ['mousePressed', 10, 20, 1],
      ['mouseReleased', 10, 20, 1],
      ['mousePressed', 10, 20, 2],
      ['mouseReleased', 10, 20, 2],
    ]);
  });

  it('passes the button and held modifiers', async () => {
    const { input, sent } = setup();
    await input.click(
      1,
      { x: 5, y: 6 },
      { button: 'right', count: 1, modifiers: ['shift', 'meta'] },
    );

    expect(sent()[1]).toEqual([
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed', button: 'right', buttons: 2, modifiers: 12 }),
    ]);
  });

  it('falls back when something covers the element', async () => {
    const { input, sessions, fallback } = setup({
      locate: { x: 1, y: 1, hittable: false, inViewport: true },
    });
    await input.click(1, { ref: 'e1' }, LEFT);

    expect(sessions.attach).not.toHaveBeenCalled();
    expect(fallback.click).toHaveBeenCalledWith(1, { ref: 'e1' }, LEFT);
  });

  it('falls back when the debugger cannot attach', async () => {
    const { input, sessions, fallback } = setup();
    sessions.attach.mockRejectedValue(new Error('Another debugger is already attached'));

    await input.click(1, { ref: 'e1' }, LEFT);
    await input.hover(1, { ref: 'e1' });
    await input.type(1, 'e2', 'hi', true, false);
    expect(sessions.send).not.toHaveBeenCalled();
    expect(fallback.click).toHaveBeenCalled();
    expect(fallback.hover).toHaveBeenCalledWith(1, { ref: 'e1' });
    expect(fallback.type).toHaveBeenCalledWith(1, 'e2', 'hi', true, false);
  });

  it('drags through intermediate points with the button held', async () => {
    const { input, calls, mouseEvents, sent } = setup();
    await input.drag(1, { ref: 'e1' }, { x: 110, y: 20 });

    // Only the start is scrolled into view; scrolling for the end would move the start.
    expect(calls.map((call) => call.kind === 'locate' && call.scroll)).toEqual([true, false]);
    const events = mouseEvents();
    expect(events[0]).toEqual(['mouseMoved', 10, 20]);
    expect(events[1]).toEqual(['mousePressed', 10, 20, 1]);
    expect(events.at(-1)).toEqual(['mouseReleased', 10, 20, 1]);
    const moves = sent().slice(2, -1);
    expect(moves.length).toBeGreaterThan(3);
    for (const [, params] of moves)
      expect(params).toMatchObject({ type: 'mouseMoved', buttons: 1 });
  });

  it('refuses a drag whose ends are not both on screen', async () => {
    const { input, sessions } = setup({
      locate: { x: 10, y: 2000, hittable: true, inViewport: false },
    });
    await expect(input.drag(1, { ref: 'e1' }, { ref: 'e2' })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
    expect(sessions.send).not.toHaveBeenCalled();
  });
});

describe('debugger input: keyboard', () => {
  it('types over the selection and submits with Enter', async () => {
    const { input, calls, sent } = setup();
    await input.type(1, 'e2', 'Ada', true, true);

    expect(calls).toEqual([{ kind: 'focus', ref: 'e2', select: true }]);
    expect(sent()).toEqual([
      ['Input.insertText', { text: 'Ada' }],
      [
        'Input.dispatchKeyEvent',
        expect.objectContaining({ type: 'keyDown', key: 'Enter', text: '\r' }),
      ],
      ['Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp', key: 'Enter' })],
    ]);
  });

  it('types into the focused element when no ref is given', async () => {
    const { input, calls, sent } = setup();
    await input.type(1, undefined, 'more', false, false);

    expect(calls).toEqual([]);
    expect(sent()).toEqual([['Input.insertText', { text: 'more' }]]);
  });

  it('leaves selects and empty text to the fallback', async () => {
    const select = setup({ focus: { control: 'select' } });
    await select.input.type(1, 'e3', 'Blue', true, false);
    expect(select.fallback.type).toHaveBeenCalledWith(1, 'e3', 'Blue', true, false);

    const empty = setup();
    await empty.input.type(1, 'e2', '', true, false);
    expect(empty.fallback.type).toHaveBeenCalledWith(1, 'e2', '', true, false);
    expect(empty.sessions.send).not.toHaveBeenCalled();
  });

  it('sends a shortcut without text, so it is not typed', async () => {
    const { input, sent } = setup();
    const a = keyInfo('a');
    if (!a) throw new Error('missing key');
    await input.press(1, a, ['meta'], 1);

    expect(sent()[0]).toEqual([
      'Input.dispatchKeyEvent',
      {
        type: 'rawKeyDown',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
        modifiers: 4,
      },
    ]);
  });

  it('repeats a key press', async () => {
    const { input, sent } = setup();
    const down = keyInfo('ArrowDown');
    if (!down) throw new Error('missing key');
    await input.press(1, down, [], 3);

    expect(sent().map(([, params]) => (params as { type: string }).type)).toEqual([
      'rawKeyDown',
      'keyUp',
      'rawKeyDown',
      'keyUp',
      'rawKeyDown',
      'keyUp',
    ]);
  });
});
