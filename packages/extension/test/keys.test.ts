import { describe, expect, it } from 'vitest';
import { isShortcut, keyInfo } from '../src/shared/keys.ts';

describe('keyInfo', () => {
  it('knows named keys, whatever their case', () => {
    expect(keyInfo('Enter')).toMatchObject({ key: 'Enter', keyCode: 13, text: '\r' });
    expect(keyInfo('escape')).toMatchObject({ key: 'Escape', keyCode: 27 });
    expect(keyInfo('ArrowDown')).toMatchObject({ key: 'ArrowDown', keyCode: 40 });
    expect(keyInfo('F5')).toEqual({ key: 'F5', code: 'F5', keyCode: 116 });
  });

  it('accepts common aliases', () => {
    expect(keyInfo('esc')?.key).toBe('Escape');
    expect(keyInfo('return')?.key).toBe('Enter');
    expect(keyInfo('down')?.key).toBe('ArrowDown');
    expect(keyInfo(' ')?.code).toBe('Space');
  });

  it('describes single characters', () => {
    expect(keyInfo('a')).toEqual({ key: 'a', code: 'KeyA', keyCode: 65, text: 'a' });
    expect(keyInfo('A')).toEqual({ key: 'A', code: 'KeyA', keyCode: 65, text: 'A' });
    expect(keyInfo('7')).toEqual({ key: '7', code: 'Digit7', keyCode: 55, text: '7' });
    expect(keyInfo('ş')).toEqual({ key: 'ş', code: '', keyCode: 0, text: 'ş' });
  });

  it('rejects anything else', () => {
    expect(keyInfo('Entr')).toBeUndefined();
    expect(keyInfo('F13')).toBeUndefined();
    expect(keyInfo('ab')).toBeUndefined();
  });
});

describe('isShortcut', () => {
  it('treats shift alone as typing', () => {
    expect(isShortcut([])).toBe(false);
    expect(isShortcut(['shift'])).toBe(false);
    expect(isShortcut(['meta'])).toBe(true);
    expect(isShortcut(['shift', 'ctrl'])).toBe(true);
  });
});
