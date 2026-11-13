import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DebuggerApi, DebuggerSessions } from '../src/background/debugger/sessions.ts';

function fakeApi() {
  let onDetach: (source: { tabId?: number }, reason: string) => void = () => {};
  let onEvent: (source: { tabId?: number }, method: string, params?: object) => void = () => {};
  const api = {
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
    sendCommand: vi.fn(async (): Promise<unknown> => ({})),
    onDetach: {
      addListener: (listener: typeof onDetach) => {
        onDetach = listener;
      },
    },
    onEvent: {
      addListener: (listener: typeof onEvent) => {
        onEvent = listener;
      },
    },
  } satisfies DebuggerApi;
  return {
    api,
    emitDetach: (tabId: number, reason: string) => onDetach({ tabId }, reason),
    emitEvent: (tabId: number, method: string, params?: object) =>
      onEvent({ tabId }, method, params),
  };
}

describe('DebuggerSessions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('attaches a tab once, even for concurrent callers', async () => {
    const { api } = fakeApi();
    const sessions = new DebuggerSessions(api, { onUserCancel: () => {} });

    await Promise.all([sessions.attach(1), sessions.attach(1)]);
    await sessions.attach(1);
    expect(api.attach).toHaveBeenCalledTimes(1);
    expect(api.attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
  });

  it('retries after a failed attach', async () => {
    const { api } = fakeApi();
    api.attach.mockRejectedValueOnce(new Error('Cannot access a chrome:// URL'));
    const sessions = new DebuggerSessions(api, { onUserCancel: () => {} });

    await expect(sessions.attach(1)).rejects.toThrow('chrome://');
    await sessions.attach(1);
    expect(api.attach).toHaveBeenCalledTimes(2);
  });

  it('attaches again after the tab was detached', async () => {
    const { api, emitDetach } = fakeApi();
    const sessions = new DebuggerSessions(api, { onUserCancel: () => {} });

    await sessions.attach(1);
    emitDetach(1, 'target_closed');
    await sessions.attach(1);
    expect(api.attach).toHaveBeenCalledTimes(2);
  });

  it('reports only a user cancel', async () => {
    const { api, emitDetach } = fakeApi();
    const onUserCancel = vi.fn();
    new DebuggerSessions(api, { onUserCancel });

    emitDetach(1, 'target_closed');
    expect(onUserCancel).not.toHaveBeenCalled();
    emitDetach(1, 'canceled_by_user');
    expect(onUserCancel).toHaveBeenCalledTimes(1);
  });

  it('detaches everything once idle, and use pushes that back', async () => {
    const { api } = fakeApi();
    const sessions = new DebuggerSessions(api, { onUserCancel: () => {}, idleMs: 1_000 });
    await sessions.attach(1);
    await sessions.attach(2);

    await vi.advanceTimersByTimeAsync(900);
    await sessions.send(1, 'Input.insertText', { text: 'a' });
    await vi.advanceTimersByTimeAsync(900);
    expect(api.detach).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(api.detach.mock.calls).toEqual([[{ tabId: 1 }], [{ tabId: 2 }]]);
  });

  it('passes debugger events to listeners and tells them about detaches', async () => {
    const { api, emitEvent, emitDetach } = fakeApi();
    const sessions = new DebuggerSessions(api, { onUserCancel: () => {} });
    const events: unknown[] = [];
    const detached: number[] = [];
    sessions.onEvent((...event) => events.push(event));
    sessions.onDetached((tabId) => detached.push(tabId));

    await sessions.attach(1);
    emitEvent(1, 'Log.entryAdded', { entry: {} });
    emitDetach(1, 'target_closed');
    emitDetach(1, 'target_closed');
    expect(events).toEqual([[1, 'Log.entryAdded', { entry: {} }]]);
    expect(detached).toEqual([1]);
  });

  it('stays attached longer once the idle time is extended', async () => {
    const { api } = fakeApi();
    const sessions = new DebuggerSessions(api, { onUserCancel: () => {}, idleMs: 1_000 });
    await sessions.attach(1);
    sessions.extendIdle(5_000);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(api.detach).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.detach).toHaveBeenCalledTimes(1);

    // Detaching puts the idle time back to the default.
    await sessions.attach(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.detach).toHaveBeenCalledTimes(2);
  });

  it('times out a command the tab never answers', async () => {
    const { api } = fakeApi();
    api.sendCommand.mockReturnValue(new Promise(() => {}));
    const sessions = new DebuggerSessions(api, { onUserCancel: () => {} });

    const sent = sessions.send(1, 'Input.dispatchMouseEvent');
    const failure = expect(sent).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;
  });
});
