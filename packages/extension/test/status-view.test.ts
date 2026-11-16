import { describe, expect, it } from 'vitest';
import { OLD_SERVER } from '../src/shared/runtime-messages.ts';
import { describeStatus } from '../src/shared/status-view.ts';

const base = { url: 'ws://127.0.0.1:47821/extension' };

describe('describeStatus', () => {
  it('says off when the extension is switched off', () => {
    expect(describeStatus(null).state).toBe('off');
  });

  it('says connected, with the version the app runs', () => {
    const view = describeStatus({ ...base, state: 'connected', serverVersion: '0.3.0' });
    expect(view).toMatchObject({ state: 'connected', label: 'Connected' });
    expect(view.help).toContain('0.3.0');
  });

  it('waits for an app when nothing answers on the port', () => {
    const view = describeStatus({ ...base, state: 'disconnected', lastError: 'Connection lost' });
    expect(view).toMatchObject({ state: 'waiting', label: 'Waiting for an AI app' });
  });

  it('names an old server and a version mismatch as problems to fix', () => {
    const refused = { ...base, state: 'disconnected' as const };
    expect(describeStatus({ ...refused, lastError: OLD_SERVER })).toMatchObject({
      state: 'problem',
      label: 'Restart your AI apps',
    });
    expect(
      describeStatus({ ...refused, lastError: 'Version mismatch: update the extension' }),
    ).toMatchObject({ state: 'problem', label: 'Update needed' });
  });
});
