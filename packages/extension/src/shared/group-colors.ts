import { type GroupColor, groupColorSchema } from '@itsme/protocol';

/** A color no other group has, so groups are easy to tell apart; any color once all are taken. */
export function pickColor(used: readonly string[], random: () => number = Math.random): GroupColor {
  const all = groupColorSchema.options;
  const free = all.filter((color) => !used.includes(color));
  const pool = free.length > 0 ? free : all;
  return pool[Math.floor(random() * pool.length)] ?? 'blue';
}
