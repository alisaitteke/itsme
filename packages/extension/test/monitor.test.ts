import { describe, expect, it, vi } from 'vitest';
import { PageMonitor, redactUrl } from '../src/background/debugger/monitor.ts';
import type { EventListener } from '../src/background/debugger/sessions.ts';

const ALL = { onlyErrors: false, limit: 100, clear: false };

function setup() {
  let emit: EventListener = () => {};
  let detach: (tabId: number) => void = () => {};
  const sessions = {
    attach: vi.fn(async (_tabId: number) => {}),
    send: vi.fn(async (_tabId: number, _method: string) => ({})),
    extendIdle: vi.fn(),
    onEvent: (listener: EventListener) => {
      emit = listener;
    },
    onDetached: (listener: (tabId: number) => void) => {
      detach = listener;
    },
  };
  const monitor = new PageMonitor(sessions);
  return {
    monitor,
    sessions,
    emit: (method: string, params: object, tabId = 1) => emit(tabId, method, params),
    detach: (tabId = 1) => detach(tabId),
  };
}

const log = (type: string, ...values: unknown[]) => ({
  type,
  args: values.map((value) => ({ type: typeof value, value })),
});

describe('PageMonitor: lifecycle', () => {
  it('starts recording on the first call only', async () => {
    const { monitor, sessions } = setup();

    await monitor.console(1, ALL);
    expect(sessions.send.mock.calls.map(([, method]) => method)).toEqual([
      'Runtime.enable',
      'Log.enable',
      'Network.enable',
    ]);
    expect(sessions.extendIdle).toHaveBeenCalled();

    const { recordingMs } = await monitor.network(1, ALL);
    expect(recordingMs).toBeGreaterThanOrEqual(0);
    expect(sessions.send).toHaveBeenCalledTimes(3);
  });

  it('ignores events of tabs it is not recording', async () => {
    const { monitor, emit } = setup();
    emit('Runtime.consoleAPICalled', log('log', 'too early'));
    expect((await monitor.console(1, ALL)).entries).toEqual([]);
  });

  it('keeps requests across a detach and starts the console over', async () => {
    const { monitor, emit, detach } = setup();
    await monitor.console(1, ALL);
    emit('Runtime.consoleAPICalled', log('log', 'before'));
    emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://example.com/a', method: 'GET' },
      timestamp: 1,
    });

    detach();
    emit('Runtime.consoleAPICalled', log('log', 'while detached'));

    // Enabling the console again replays the page's messages, so the old copy goes.
    const again = await monitor.console(1, ALL);
    expect(again.entries).toEqual([]);
    expect((await monitor.network(1, ALL)).requests).toHaveLength(1);
  });

  it('reports a tab the debugger cannot attach to', async () => {
    const { monitor, sessions } = setup();
    sessions.attach.mockRejectedValue(new Error('Cannot access a chrome:// URL'));
    await expect(monitor.console(1, ALL)).rejects.toMatchObject({ code: 'PAGE_NOT_ACCESSIBLE' });
  });
});

describe('PageMonitor: console', () => {
  it('formats messages, exceptions and browser log entries', async () => {
    const { monitor, emit } = setup();
    await monitor.console(1, ALL);

    emit('Runtime.consoleAPICalled', {
      type: 'log',
      args: [
        { type: 'string', value: 'user' },
        { type: 'number', value: 7 },
        {
          type: 'object',
          preview: { properties: [{ name: 'a', value: '1' }], overflow: true },
        },
        { type: 'object', subtype: 'array', preview: { properties: [{ name: '0', value: 'x' }] } },
        { type: 'function', description: 'function f()' },
      ],
      stackTrace: { callFrames: [{ url: 'https://example.com/app.js', lineNumber: 9 }] },
    });
    emit('Runtime.exceptionThrown', {
      exceptionDetails: {
        text: 'Uncaught',
        exception: { description: 'TypeError: x is not a function' },
        url: 'https://example.com/app.js',
        lineNumber: 0,
      },
    });
    emit('Log.entryAdded', {
      entry: { level: 'warning', text: 'Mixed content', url: 'https://example.com/' },
    });

    expect((await monitor.console(1, ALL)).entries).toEqual([
      {
        level: 'log',
        text: 'user 7 {a: 1, …} [x] function f()',
        source: 'https://example.com/app.js:10',
      },
      {
        level: 'error',
        text: 'TypeError: x is not a function',
        source: 'https://example.com/app.js:1',
      },
      { level: 'warning', text: 'Mixed content', source: 'https://example.com/' },
    ]);
  });

  it('filters by pattern and level, newest first to go', async () => {
    const { monitor, emit } = setup();
    await monitor.console(1, ALL);
    emit('Runtime.consoleAPICalled', log('log', 'Loaded user'));
    emit('Runtime.consoleAPICalled', log('error', 'user failed'));
    emit('Runtime.consoleAPICalled', log('assert', 'bad state'));
    emit('Runtime.consoleAPICalled', log('debug', 'tick'));

    const users = await monitor.console(1, { ...ALL, pattern: 'USER' });
    expect(users.entries.map((entry) => entry.text)).toEqual(['Loaded user', 'user failed']);

    const errors = await monitor.console(1, { ...ALL, onlyErrors: true });
    expect(errors.entries.map((entry) => entry.text)).toEqual(['user failed', 'bad state']);

    const last = await monitor.console(1, { ...ALL, limit: 1 });
    expect(last).toMatchObject({ entries: [{ text: 'tick', level: 'debug' }], total: 4 });
  });

  it('forgets the messages when asked to clear', async () => {
    const { monitor, emit } = setup();
    await monitor.console(1, ALL);
    emit('Runtime.consoleAPICalled', log('log', 'once'));

    expect((await monitor.console(1, { ...ALL, clear: true })).entries).toHaveLength(1);
    expect((await monitor.console(1, ALL)).entries).toEqual([]);
  });

  it('rejects a pattern that is not a regular expression', async () => {
    const { monitor } = setup();
    await expect(monitor.console(1, { ...ALL, pattern: '(' })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
    });
  });
});

describe('PageMonitor: network', () => {
  it('follows a request from start to finish', async () => {
    const { monitor, emit } = setup();
    await monitor.network(1, ALL);
    const request = { url: 'https://api.example.com/items?page=2', method: 'GET' };

    emit('Network.requestWillBeSent', { requestId: 'r1', request, type: 'Fetch', timestamp: 10 });
    expect((await monitor.network(1, ALL)).requests).toEqual([
      { method: 'GET', url: request.url, type: 'fetch' },
    ]);

    emit('Network.responseReceived', { requestId: 'r1', response: { status: 200 } });
    emit('Network.loadingFinished', { requestId: 'r1', timestamp: 10.25, encodedDataLength: 512 });
    expect((await monitor.network(1, ALL)).requests).toEqual([
      { method: 'GET', url: request.url, type: 'fetch', status: 200, durationMs: 250, bytes: 512 },
    ]);
  });

  it('records why a request failed', async () => {
    const { monitor, emit } = setup();
    await monitor.network(1, ALL);
    emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://down.example/', method: 'POST' },
      timestamp: 1,
    });
    emit('Network.loadingFailed', {
      requestId: 'r1',
      timestamp: 2,
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });

    expect((await monitor.network(1, ALL)).requests[0]).toMatchObject({
      method: 'POST',
      error: 'net::ERR_CONNECTION_REFUSED',
    });
  });

  it('filters by URL and keeps the tabs apart', async () => {
    const { monitor, emit } = setup();
    await monitor.network(1, ALL);
    await monitor.network(2, ALL);
    const send = (id: string, url: string, tabId: number) =>
      emit(
        'Network.requestWillBeSent',
        { requestId: id, request: { url, method: 'GET' }, timestamp: 1 },
        tabId,
      );
    send('a', 'https://example.com/api/users', 1);
    send('b', 'https://example.com/logo.png', 1);
    send('c', 'https://other.example/api/x', 2);

    const api = await monitor.network(1, { ...ALL, urlPattern: '/api/' });
    expect(api.requests.map((request) => request.url)).toEqual(['https://example.com/api/users']);
    expect((await monitor.network(2, ALL)).requests).toHaveLength(1);
  });
});

describe('redactUrl', () => {
  it('hides credentials in the query string and the user info', () => {
    expect(redactUrl('https://user:pw@example.com/cb?access_token=abc&page=2&api_key=k')).toBe(
      'https://example.com/cb?access_token=REDACTED&page=2&api_key=REDACTED',
    );
  });

  it('leaves ordinary URLs alone and shortens data URLs', () => {
    expect(redactUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(redactUrl(`data:image/png;base64,${'A'.repeat(500)}`)).toHaveLength(60);
  });
});
