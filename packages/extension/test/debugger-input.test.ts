import { describe, expect, it, vi } from 'vitest';
import type { AgentCall } from '../src/agent/messages.ts';
import { createDebuggerInput } from '../src/background/input/debugger.ts';
import type { CallAgent } from '../src/background/input/driver.ts';

function setup(agentResults: { locate?: object; focus?: object } = {}) {
  const calls: AgentCall[] = [];
  const agent = (async (_tabId: number, call: AgentCall) => {
    calls.push(call);
    if (call.kind === 'locate') return agentResults.locate ?? { x: 10, y: 20, hittable: true };
    if (call.kind === 'focus') return agentResults.focus ?? { control: 'text' };
    return {};
  }) as CallAgent;
  const sessions = {
    attach: vi.fn(async (_tabId: number) => {}),
    send: vi.fn(async (_tabId: number, _method: string, _params?: object) => ({})),
  };
  const fallback = { click: vi.fn(async () => {}), type: vi.fn(async () => {}) };
  const showTab = vi.fn(async () => {});
  const input = createDebuggerInput({ agent, sessions, showTab, fallback });
  const sent = () => sessions.send.mock.calls.map(([, method, params]) => [method, params]);
  return { input, calls, sessions, fallback, showTab, sent };
}

describe('debugger input', () => {
  it('clicks with a move, press and release at the located point', async () => {
    const { input, sent, showTab, fallback } = setup();
    await input.click(1, 'e1');

    expect(showTab).toHaveBeenCalledWith(1);
    expect(sent()).toEqual([
      ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 20 }],
      [
        'Input.dispatchMouseEvent',
        { type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1 },
      ],
      [
        'Input.dispatchMouseEvent',
        { type: 'mouseReleased', x: 10, y: 20, button: 'left', clickCount: 1 },
      ],
    ]);
    expect(fallback.click).not.toHaveBeenCalled();
  });

  it('falls back when something covers the element', async () => {
    const { input, sessions, fallback } = setup({ locate: { x: 1, y: 1, hittable: false } });
    await input.click(1, 'e1');

    expect(sessions.attach).not.toHaveBeenCalled();
    expect(fallback.click).toHaveBeenCalledWith(1, 'e1');
  });

  it('falls back when the debugger cannot attach', async () => {
    const { input, sessions, fallback } = setup();
    sessions.attach.mockRejectedValue(new Error('Another debugger is already attached'));

    await input.click(1, 'e1');
    await input.type(1, 'e2', 'hi', true, false);
    expect(sessions.send).not.toHaveBeenCalled();
    expect(fallback.click).toHaveBeenCalledWith(1, 'e1');
    expect(fallback.type).toHaveBeenCalledWith(1, 'e2', 'hi', true, false);
  });

  it('types over the selection and submits with Enter', async () => {
    const { input, calls, sent } = setup();
    await input.type(1, 'e2', 'Ada', true, true);

    expect(calls).toEqual([{ kind: 'focus', ref: 'e2', select: true }]);
    expect(sent()).toEqual([
      ['Input.insertText', { text: 'Ada' }],
      ['Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyDown', key: 'Enter' })],
      ['Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp', key: 'Enter' })],
    ]);
  });

  it('appends without selecting when clear is off', async () => {
    const { input, calls, sent } = setup();
    await input.type(1, 'e2', 'more', false, false);

    expect(calls).toEqual([{ kind: 'focus', ref: 'e2', select: false }]);
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
});
