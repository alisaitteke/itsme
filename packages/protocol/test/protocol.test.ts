import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BridgeError, commands, decodeMessage, encodeMessage, toWireError } from '../src/index.ts';

describe('messages', () => {
  it('round-trips a request', () => {
    const message = { type: 'request', id: '1', command: 'tabs.list', params: {} } as const;
    expect(decodeMessage(encodeMessage(message))).toEqual(message);
  });

  it('rejects malformed input with INVALID_MESSAGE', () => {
    for (const raw of ['not json', '{"type":"nope"}', '{"type":"request"}']) {
      expect(() => decodeMessage(raw)).toThrowError(
        expect.objectContaining({ code: 'INVALID_MESSAGE' }),
      );
    }
  });
});

describe('commands', () => {
  it('applies defaults', () => {
    expect(commands['tabs.open'].params.parse({ url: 'https://example.com' })).toEqual({
      url: 'https://example.com',
      active: true,
    });
  });

  it('only accepts http(s) URLs', () => {
    const { params } = commands['page.navigate'];
    expect(params.safeParse({ url: 'https://example.com/a?b=1' }).success).toBe(true);
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'x']) {
      expect(params.safeParse({ url }).success).toBe(false);
    }
  });

  it('converts every params schema to JSON Schema', () => {
    for (const def of Object.values(commands)) {
      expect(z.toJSONSchema(def.params, { io: 'input' })).toMatchObject({ type: 'object' });
    }
  });
});

describe('toWireError', () => {
  it('keeps the code of a BridgeError', () => {
    expect(toWireError(new BridgeError('TAB_NOT_FOUND', 'gone'))).toEqual({
      code: 'TAB_NOT_FOUND',
      message: 'gone',
    });
  });

  it('maps validation failures to INVALID_PARAMS', () => {
    const result = commands['tabs.close'].params.safeParse({});
    expect(toWireError(result.error).code).toBe('INVALID_PARAMS');
  });

  it('maps anything else to INTERNAL', () => {
    expect(toWireError(new Error('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' });
  });
});
