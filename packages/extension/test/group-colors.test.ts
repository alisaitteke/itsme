import { groupColorSchema } from '@itsme/protocol';
import { describe, expect, it } from 'vitest';
import { pickColor } from '../src/shared/group-colors.ts';

const all = groupColorSchema.options;

describe('pickColor', () => {
  it('avoids the colors other groups have', () => {
    const used = all.filter((color) => color !== 'pink' && color !== 'cyan');
    for (const roll of [0, 0.3, 0.6, 0.999]) {
      expect(['pink', 'cyan']).toContain(pickColor(used, () => roll));
    }
  });

  it('follows the random source', () => {
    expect(pickColor([], () => 0)).toBe(all[0]);
    expect(pickColor([], () => 0.999)).toBe(all.at(-1));
  });

  it('reuses a color once all are taken', () => {
    expect(all).toContain(pickColor(all));
  });

  it('ignores colors it does not know', () => {
    expect(pickColor(['teal'], () => 0)).toBe(all[0]);
  });
});
