import {
  BRIDGE_HOST,
  CloseCode,
  encodeMessage,
  PEER_PATH,
  PROTOCOL_VERSION,
} from '@itsme/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { Bridge } from '../src/bridge/bridge.ts';
import { PeerLink } from '../src/bridge/peer.ts';
import { connectFakeExtension, freePort, linkOptions } from './helpers.ts';

const tab = { id: 1, windowId: 1, url: 'https://example.com/', title: 'Example', active: true };

describe('Bridge', () => {
  const bridges: Bridge[] = [];

  /** Says hello to the hub as a peer server would, and resolves with the close code. */
  function peerHello(port: number, protocolVersion: number): Promise<number> {
    const socket = new WebSocket(`ws://${BRIDGE_HOST}:${port}${PEER_PATH}`);
    socket.on('open', () => socket.send(encodeMessage({ type: 'hello', protocolVersion })));
    return new Promise((resolve) => socket.on('close', resolve));
  }

  async function startBridge(port: number, overrides = {}) {
    const bridge = new Bridge(linkOptions(port, overrides));
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

  it('gives the port up to a server with a newer protocol', async () => {
    const port = await freePort();
    const old = await startBridge(port);

    expect(await peerHello(port, PROTOCOL_VERSION + 1)).toBe(CloseCode.ProtocolMismatch);
    await vi.waitFor(() => expect(old.mode).toBe('outdated'));
    await expect(old.call('tabs.list', {})).rejects.toThrow(/newer itsme server/);

    const newer = await startBridge(port);
    expect(newer.mode).toBe('hub');
  });

  it('keeps the port from an older server', async () => {
    const port = await freePort();
    const bridge = await startBridge(port);

    expect(await peerHello(port, PROTOCOL_VERSION - 1)).toBe(CloseCode.ProtocolMismatch);
    expect(bridge.mode).toBe('hub');
  });

  it('says so when the port is held by a server that still asks for a token', async () => {
    const port = await freePort();
    const old = new WebSocketServer({ host: BRIDGE_HOST, port });
    old.on('connection', (socket) => socket.close(CloseCode.Unauthorized, 'Token mismatch'));
    try {
      await expect(PeerLink.connect(linkOptions(port))).rejects.toThrow(/older itsme server/);
    } finally {
      await new Promise((done) => old.close(done));
    }
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
