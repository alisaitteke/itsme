import { CloseCode } from '@itsme/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hub } from '../src/bridge/hub.ts';
import { browserInfo, connectFakeExtension, linkOptions } from './helpers.ts';

describe('Hub', () => {
  let hub: Hub;

  async function startHub(overrides = {}) {
    hub = new Hub(linkOptions(0, overrides));
    await hub.listen();
  }

  beforeEach(() => startHub());
  afterEach(() => hub.close());

  it('reports NOT_CONNECTED without a browser', async () => {
    await expect(hub.request('tabs.list', {})).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(await hub.browsers()).toEqual([]);
  });

  it('round-trips a request through the extension', async () => {
    await connectFakeExtension(hub.port, { 'tabs.list': () => ({ tabs: [] }) });
    expect(await hub.browsers()).toEqual([browserInfo]);
    expect(await hub.request('tabs.list', {})).toEqual({ tabs: [] });
  });

  it('times out when the extension never answers', async () => {
    await hub.close();
    await startHub({ requestTimeoutMs: 50 });
    await connectFakeExtension(hub.port);
    await expect(hub.request('tabs.list', {})).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('fails in-flight requests when the browser disconnects', async () => {
    const extension = await connectFakeExtension(hub.port);
    const request = hub.request('tabs.list', {});
    extension.socket.close();
    await expect(request).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('refuses commands the browser did not advertise', async () => {
    await connectFakeExtension(hub.port);
    await expect(hub.request('page.print', {})).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('tells the extension how the server was started', async () => {
    await hub.close();
    const launch = { command: '/usr/bin/node', args: ['/opt/itsme/cli.mjs'] };
    await startHub({ launch });
    const extension = await connectFakeExtension(hub.port);
    expect(extension.welcome).toMatchObject({ type: 'welcome', launch });
  });

  it('rejects connections from web page origins', async () => {
    const page = await connectFakeExtension(hub.port, {}, { origin: 'https://evil.example' });
    await page.closed;
    expect(await hub.browsers()).toEqual([]);
  });

  it('closes on protocol mismatch', async () => {
    const extension = await connectFakeExtension(hub.port, {}, { protocolVersion: 999 });
    expect(await extension.closed).toBe(CloseCode.ProtocolMismatch);
  });

  it('enforces the token when one is set', async () => {
    await hub.close();
    await startHub({ token: 'secret' });

    const wrong = await connectFakeExtension(hub.port, {}, { token: 'nope' });
    expect(await wrong.closed).toBe(CloseCode.Unauthorized);
    const missing = await connectFakeExtension(hub.port);
    expect(await missing.closed).toBe(CloseCode.Unauthorized);

    await connectFakeExtension(hub.port, {}, { token: 'secret' });
    expect(await hub.browsers()).toHaveLength(1);
  });
});
