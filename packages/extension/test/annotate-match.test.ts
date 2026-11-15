import { describe, expect, it } from 'vitest';
import { boundsOf, mergeLines } from '../src/agent/annotate/lines.ts';
import { quoteFinder } from '../src/agent/annotate/match.ts';

describe('quoteFinder', () => {
  it('finds a quote inside one piece', () => {
    const find = quoteFinder(['The quick brown fox']);
    expect(find('quick brown')).toEqual({
      start: { piece: 0, offset: 4 },
      end: { piece: 0, offset: 15 },
    });
  });

  it('finds a quote that runs through several pieces', () => {
    // As in <p>Prices rose <b>4.2%</b> last</p><p>year.</p>
    const find = quoteFinder(['Prices rose ', '4.2%', ' last', 'year.']);
    expect(find('rose 4.2% last year')).toEqual({
      start: { piece: 0, offset: 7 },
      end: { piece: 3, offset: 4 },
    });
  });

  it('does not care about whitespace, case, or the kind of quotes and dashes', () => {
    const find = quoteFinder(['She said “it’s\n   fine” — twice']);
    expect(find('SHE SAID "it\'s fine" - twice')).toEqual({
      start: { piece: 0, offset: 0 },
      end: { piece: 0, offset: 31 },
    });
  });

  it('keeps offsets right after letters that grow when lowered', () => {
    const find = quoteFinder(['İstanbul ve İzmir']);
    expect(find('İzmir')).toEqual({
      start: { piece: 0, offset: 12 },
      end: { piece: 0, offset: 17 },
    });
  });

  it('skips pieces that hold nothing to compare', () => {
    const find = quoteFinder(['one', '  ', 'two']);
    expect(find('two')).toEqual({ start: { piece: 2, offset: 0 }, end: { piece: 2, offset: 3 } });
  });

  it('gives null for text that is not there, and for nothing', () => {
    const find = quoteFinder(['one two']);
    expect(find('three')).toBeNull();
    expect(find('   ')).toBeNull();
  });
});

describe('mergeLines', () => {
  it('joins the boxes of one line and keeps lines apart', () => {
    const lines = mergeLines([
      { x: 120, y: 40, w: 60, h: 18 },
      { x: 10, y: 20, w: 50, h: 18 },
      { x: 60, y: 18, w: 40, h: 22 },
      { x: 10, y: 40, w: 110, h: 18 },
      { x: 0, y: 0, w: 0, h: 18 },
    ]);
    expect(lines).toEqual([
      { x: 10, y: 18, w: 90, h: 22 },
      { x: 10, y: 40, w: 170, h: 18 },
    ]);
    expect(boundsOf(lines)).toEqual({ x: 10, y: 18, w: 170, h: 40 });
  });
});
