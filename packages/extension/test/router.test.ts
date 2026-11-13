import { describe, expect, it, vi } from 'vitest';
import { createRouter } from '../src/background/router.ts';

describe('router', () => {
  it('advertises only the commands it has handlers for', () => {
    const router = createRouter({ 'tabs.list': async () => ({ tabs: [] }) });
    expect(router.commands).toEqual(['tabs.list']);
  });

  it('passes parsed params with defaults to the handler', async () => {
    const open = vi.fn(async () => ({
      tab: { id: 1, windowId: 1, url: 'https://example.com/', title: '', active: true },
    }));
    const router = createRouter({ 'tabs.open': open });

    await router.dispatch('tabs.open', { url: 'https://example.com/' });
    expect(open).toHaveBeenCalledWith({ url: 'https://example.com/', active: true });
  });

  it('rejects invalid params before the handler runs', async () => {
    const close = vi.fn(async () => ({}));
    const router = createRouter({ 'tabs.close': close });

    await expect(router.dispatch('tabs.close', { tabId: 'x' })).rejects.toThrow();
    expect(close).not.toHaveBeenCalled();
  });

  it('distinguishes unknown commands from unsupported ones', async () => {
    const router = createRouter({});
    await expect(router.dispatch('nope', {})).rejects.toMatchObject({ code: 'UNKNOWN_COMMAND' });
    await expect(router.dispatch('tabs.list', {})).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});
