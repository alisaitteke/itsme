import { once } from 'node:events';
import { createServer } from 'node:net';
import { BRIDGE_HOST, BridgeError, EXTENSION_PATH } from '@itsme/protocol';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeConnection } from '../../packages/extension/src/background/connection.ts';
import { createRouter, type Handlers } from '../../packages/extension/src/background/router.ts';
import { Bridge } from '../../packages/server/src/bridge/bridge.ts';
import { silentLogger } from '../../packages/server/src/logger.ts';
import { createMcpServer } from '../../packages/server/src/mcp/server.ts';

// MCP client -> MCP server -> hub -> the extension's real connection and router.
// Only the browser APIs behind the handlers are faked.

const tab = { id: 3, windowId: 1, url: 'https://example.com/', title: 'Example', active: true };

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, BRIDGE_HOST);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  server.close();
  await once(server, 'close');
  return port;
}

describe('MCP client to extension', () => {
  const cleanups: Array<() => unknown> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function startServer(port: number, token?: string) {
    const bridge = new Bridge({
      port,
      token,
      requestTimeoutMs: 1_000,
      serverVersion: '0.0.0-test',
      logger: silentLogger,
    });
    await bridge.start();
    cleanups.push(() => bridge.stop());

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMcpServer(bridge, '0.0.0-test').connect(serverTransport);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
    cleanups.push(() => client.close());
    return { bridge, client };
  }

  function startExtension(port: number, handlers: Handlers, token?: string) {
    const router = createRouter(handlers);
    const connection = new BridgeConnection({
      url: `ws://${BRIDGE_HOST}:${port}${EXTENSION_PATH}`,
      token,
      browser: {
        name: 'chrome',
        version: '142.0',
        extensionVersion: '0.0.0-test',
        commands: router.commands,
      },
      onRequest: router.dispatch,
      reconnectDelaysMs: [20],
      createSocket: (url) =>
        new WebSocket(url, { headers: { Origin: 'chrome-extension://test' } } as never),
    });
    connection.start();
    cleanups.push(() => connection.stop());
    return connection;
  }

  const connected = (connection: BridgeConnection) =>
    vi.waitFor(() => expect(connection.status.state).toBe('connected'));

  it('runs a tool call in the extension', async () => {
    const port = await freePort();
    const { client } = await startServer(port);
    const open = vi.fn(async () => ({ tab }));
    await connected(startExtension(port, { 'tabs.open': open }));

    const result = await client.callTool({
      name: 'tabs_open',
      arguments: { url: 'https://example.com/' },
    });

    expect(open).toHaveBeenCalledWith({ url: 'https://example.com/', active: true });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? '')).toEqual({ tab });
  });

  it('reports handler errors with their code', async () => {
    const port = await freePort();
    const { client } = await startServer(port);
    const extension = startExtension(port, {
      'tabs.close': async () => {
        throw new BridgeError('TAB_NOT_FOUND', 'No tab with id 9');
      },
    });
    await connected(extension);

    const result = await client.callTool({ name: 'tabs_close', arguments: { tabId: 9 } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'TAB_NOT_FOUND: No tab with id 9' }]);
  });

  it('refuses a tool the extension has no handler for', async () => {
    const port = await freePort();
    const { client } = await startServer(port);
    await connected(startExtension(port, {}));

    const result = await client.callTool({ name: 'tabs_list', arguments: {} });
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('UNSUPPORTED') },
    ]);
  });

  it('reconnects when the server comes back', async () => {
    const port = await freePort();
    const first = await startServer(port);
    const extension = startExtension(port, { 'tabs.list': async () => ({ tabs: [tab] }) });
    await connected(extension);

    await first.bridge.stop();
    await vi.waitFor(() => expect(extension.status.state).not.toBe('connected'));

    const second = await startServer(port);
    await connected(extension);
    const result = await second.client.callTool({ name: 'tabs_list', arguments: {} });
    expect(result.isError).toBeFalsy();
  });

  it('explains a rejected token', async () => {
    const port = await freePort();
    await startServer(port, 'secret');
    const extension = startExtension(port, {}, 'wrong');

    await vi.waitFor(() => expect(extension.status.lastError).toMatch(/rejected the token/));
    expect(extension.status.state).not.toBe('connected');
  });
});
