import { commandNames } from '@itsme/protocol';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Bridge } from '../src/bridge/bridge.ts';
import { createMcpServer } from '../src/mcp/server.ts';
import { connectFakeExtension, freePort, linkOptions } from './helpers.ts';

describe('MCP server', () => {
  let port: number;
  let bridge: Bridge;
  let client: Client;

  beforeEach(async () => {
    port = await freePort();
    bridge = new Bridge(linkOptions(port));
    await bridge.start();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMcpServer(bridge, '0.0.0-test').connect(serverTransport);
    client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await bridge.stop();
  });

  it('exposes one tool per command plus browser_status', async () => {
    const { tools } = await client.listTools();
    const expected = ['browser_status', ...commandNames.map((name) => name.replace('.', '_'))];
    expect(tools.map((tool) => tool.name).sort()).toEqual(expected.sort());
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');
  });

  it('returns an error result while no browser is connected', async () => {
    const result = await client.callTool({ name: 'tabs_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('NOT_CONNECTED') },
    ]);
  });

  it('sends defaults-applied arguments to the browser', async () => {
    let received: unknown;
    const tab = { id: 7, windowId: 1, url: 'https://example.com/', title: '', active: true };
    await connectFakeExtension(port, {
      'tabs.open': (params) => {
        received = params;
        return { tab };
      },
    });

    const result = await client.callTool({
      name: 'tabs_open',
      arguments: { url: 'https://example.com/' },
    });
    expect(result.isError).toBeFalsy();
    expect(received).toEqual({ url: 'https://example.com/', active: true });
  });

  it('rejects arguments that fail the schema', async () => {
    await connectFakeExtension(port, { 'tabs.open': () => ({}) });
    const call = client.callTool({ name: 'tabs_open', arguments: { url: 'javascript:alert(1)' } });
    await expect(
      call.then((result) => {
        if (result.isError) throw new Error('tool error');
      }),
    ).rejects.toThrow();
  });

  it('returns screenshots as image content', async () => {
    await connectFakeExtension(port, {
      'page.screenshot': () => ({ mimeType: 'image/png', data: 'aGk=', width: 900, height: 700 }),
    });
    const result = await client.callTool({ name: 'page_screenshot', arguments: {} });
    expect(result.content).toEqual([
      { type: 'image', mimeType: 'image/png', data: 'aGk=' },
      { type: 'text', text: expect.stringContaining('Viewport 900x700') },
    ]);
  });

  it('renders a snapshot as an outline under the page header', async () => {
    await connectFakeExtension(port, {
      'page.snapshot': () => ({
        url: 'https://example.com/',
        title: 'Example',
        outline: '[e1] heading "Hi" level=1',
        truncated: true,
      }),
    });
    const result = await client.callTool({ name: 'page_snapshot', arguments: {} });
    expect(result.content).toEqual([
      {
        type: 'text',
        text: [
          'URL: https://example.com/',
          'Title: Example',
          '',
          '[e1] heading "Hi" level=1',
          '',
          'Truncated. Pass ref to read one part, or raise maxChars.',
        ].join('\n'),
      },
    ]);
  });

  it('answers OK for a command with no result', async () => {
    await connectFakeExtension(port, { 'page.click': () => ({}) });
    const result = await client.callTool({ name: 'page_click', arguments: { ref: 'e1' } });
    expect(result.content).toEqual([{ type: 'text', text: 'OK' }]);
  });
});
