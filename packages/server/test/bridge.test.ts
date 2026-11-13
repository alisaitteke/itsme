import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bridge } from '../src/bridge/bridge.ts';
import { connectFakeExtension, freePort, linkOptions } from './helpers.ts';

const tab = { id: 1, windowId: 1, url: 'https://example.com/', title: 'Example', active: true };

describe('Bridge', () => {
  const bridges: Bridge[] = [];

  async function startBridge(port: number) {
    const bridge = new Bridge(linkOptions(port));
    bridges.push(bridge);
    await bridge.start();
    return bridge;
  }

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
  });

  it('validates the result shape', async () => {
    const port = await freePort();
    const bridge = await startBridge(port);
    await connectFakeExtension(port, { 'tabs.list': () => ({ tabs: [{ id: 'not a number' }] }) });
    await expect(bridge.call('tabs.list', {})).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('relays a second server through the first', async () => {
    const port = await freePort();
    const first = await startBridge(port);
    const second = await startBridge(port);
    expect([first.mode, second.mode]).toEqual(['hub', 'peer']);

    await connectFakeExtension(port, { 'tabs.list': () => ({ tabs: [tab] }) });
    expect(await second.call('tabs.list', {})).toEqual({ tabs: [tab] });
    expect((await second.status()).browsers).toHaveLength(1);
  });

  it('passes browser errors through to a peer', async () => {
    const port = await freePort();
    await startBridge(port);
    const second = await startBridge(port);
    await expect(second.call('tabs.list', {})).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('promotes a peer when the hub exits', async () => {
    const port = await freePort();
    const first = await startBridge(port);
    const second = await startBridge(port);

    await first.stop();
    await vi.waitFor(() => expect(second.mode).toBe('hub'));

    await connectFakeExtension(port, { 'tabs.list': () => ({ tabs: [] }) });
    expect(await second.call('tabs.list', {})).toEqual({ tabs: [] });
  });
});
