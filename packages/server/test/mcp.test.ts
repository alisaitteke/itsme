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
    const expected = [
      'browser_status',
      'batch',
      ...commandNames.map((name) => name.replace('.', '_')),
    ];
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

  it("runs a batch in order and applies each tool's defaults", async () => {
    const calls: unknown[] = [];
    const record = (name: string, result: object) => (params: unknown) => {
      calls.push([name, params]);
      return result;
    };
    await connectFakeExtension(port, {
      'page.type': record('type', {}),
      'page.press': record('press', {}),
      'page.find': record('find', {
        matches: [{ ref: 'e4', role: 'text', name: 'Saved' }],
        more: false,
      }),
    });

    const result = await client.callTool({
      name: 'batch',
      arguments: {
        steps: [
          { tool: 'page_type', args: { ref: 'e1', text: 'hi' } },
          { tool: 'page_press', args: { key: 'Enter' } },
          { tool: 'page_find', args: { query: 'saved' } },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    expect((result.content as Array<{ text: string }>).map((part) => part.text)).toEqual([
      '--- 1. page_type ---',
      'OK',
      '--- 2. page_press ---',
      'OK',
      '--- 3. page_find ---',
      '[e4] text "Saved"',
    ]);
    expect(calls).toEqual([
      ['type', { ref: 'e1', text: 'hi', clear: true, submit: false }],
      ['press', { key: 'Enter', modifiers: [], count: 1 }],
      ['find', { query: 'saved' }],
    ]);
  });

  it('stops a batch at the first failing step', async () => {
    let clicked = false;
    await connectFakeExtension(port, {
      'page.click': () => {
        clicked = true;
        return {};
      },
    });

    const result = await client.callTool({
      name: 'batch',
      arguments: {
        steps: [
          { tool: 'page_press', args: {} },
          { tool: 'page_click', args: { ref: 'e1' } },
          { tool: 'batch', args: { steps: [] } },
        ],
      },
    });

    expect(result.isError).toBe(true);
    const [failure] = result.content as Array<{ text: string }>;
    expect(failure?.text).toMatch(/^--- 1\. page_press failed ---\nINVALID_PARAMS/);
    expect(failure?.text).toContain('2 later step(s) were not run');
    expect(clicked).toBe(false);
  });

  it('does not let a batch call itself or an unknown tool', async () => {
    await connectFakeExtension(port);
    const result = await client.callTool({
      name: 'batch',
      arguments: { steps: [{ tool: 'batch', args: { steps: [] } }] },
    });
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('No tool named "batch"') },
    ]);
  });

  it('keeps uploads off unless a folder is allowed', async () => {
    await connectFakeExtension(port, { 'page.upload': () => ({}) });
    const result = await client.callTool({
      name: 'page_upload',
      arguments: { ref: 'e1', paths: ['/tmp/x.txt'] },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('ITSME_UPLOAD_DIRS') },
    ]);
  });

  it('answers OK for a command with no result', async () => {
    await connectFakeExtension(port, { 'page.click': () => ({}) });
    const result = await client.callTool({ name: 'page_click', arguments: { ref: 'e1' } });
    expect(result.content).toEqual([{ type: 'text', text: 'OK' }]);
  });
});
