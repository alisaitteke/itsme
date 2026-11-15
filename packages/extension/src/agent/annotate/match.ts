/** A place in a list of text pieces: which piece, and how far into it. */
export interface TextSpot {
  piece: number;
  offset: number;
}

/** From `start` up to, but not including, `end`. */
export interface TextSpan {
  start: TextSpot;
  end: TextSpot;
}

// Whitespace and the characters that take no room: soft hyphen, zero-width ones, BOM.
const IGNORED = /[\s­​-‍﻿]/;

const PLAIN: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
  '‐': '-',
  '‑': '-',
  '–': '-',
  '—': '-',
  '−': '-',
};

/** One character made comparable: one case, plain quotes and dashes. Always one unit long. */
function fold(unit: string): string {
  const plain = PLAIN[unit];
  if (plain) return plain;
  const lower = unit.toLowerCase();
  // A few letters, like İ, grow when lowered; offsets must keep counting one for one.
  return lower.length === 1 ? lower : unit;
}

/** The text as it is compared: folded, with everything in IGNORED left out. */
function squeeze(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index++) {
    const unit = text.charAt(index);
    if (!IGNORED.test(unit)) out += fold(unit);
  }
  return out;
}

/** Offset in `text` of its `count`-th compared character. */
function offsetOf(text: string, count: number): number {
  let seen = 0;
  for (let index = 0; index < text.length; index++) {
    if (IGNORED.test(text.charAt(index))) continue;
    if (seen === count) return index;
    seen++;
  }
  return text.length;
}

/**
 * Prepares pieces of text, in reading order, for looking quotes up in them. A quote
 * matches whatever the whitespace, the case or the kind of quotes and dashes, because
 * the text a model read and the text nodes of the page differ in exactly those.
 */
export function quoteFinder(pieces: readonly string[]): (quote: string) => TextSpan | null {
  const starts: number[] = [];
  let all = '';
  for (const piece of pieces) {
    starts.push(all.length);
    all += squeeze(piece);
  }

  const spotAt = (index: number): TextSpot => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= index) low = middle;
      else high = middle - 1;
    }
    return { piece: low, offset: offsetOf(pieces[low] ?? '', index - (starts[low] ?? 0)) };
  };

  return (quote) => {
    const wanted = squeeze(quote);
    const at = wanted ? all.indexOf(wanted) : -1;
    if (at < 0) return null;
    const last = spotAt(at + wanted.length - 1);
    return { start: spotAt(at), end: { piece: last.piece, offset: last.offset + 1 } };
  };
}
