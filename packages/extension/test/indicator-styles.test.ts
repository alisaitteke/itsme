import { describe, expect, it } from 'vitest';
import { effects } from '../src/agent/effects/index.ts';
import {
  DEFAULT_INDICATOR,
  INDICATOR_STYLES,
  isIndicatorStyle,
} from '../src/shared/indicator-styles.ts';

describe('indicator styles', () => {
  it('defaults to Aurora', () => {
    expect(DEFAULT_INDICATOR).toBe('aurora');
  });

  it('recognises the styles and nothing else', () => {
    for (const style of INDICATOR_STYLES) expect(isIndicatorStyle(style)).toBe(true);
    for (const value of ['Aurora', 'glow', '', undefined, null, 3]) {
      expect(isIndicatorStyle(value)).toBe(false);
    }
  });

  it('has an effect for every style but "none"', () => {
    expect(Object.keys(effects).sort()).toEqual(
      INDICATOR_STYLES.filter((style) => style !== 'none').sort(),
    );
  });
});
