import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
}

/** Color at a point of the unit square: a rounded blue tile with a white bridge on it. */
function sample(x, y) {
  const r = 0.22;
  const dx = Math.max(r - x, x - (1 - r), 0);
  const dy = Math.max(r - y, y - (1 - r), 0);
  if (Math.hypot(dx, dy) > r) return null;
  const d = Math.hypot(x - 0.5, y - 0.66);
  const arch = y <= 0.66 && d >= 0.2 && d <= 0.3;
  const deck = y >= 0.66 && y <= 0.75 && x >= 0.14 && x <= 0.86;
  return arch || deck ? [255, 255, 255] : [37, 99, 235];
}

/** The itsme icon as a PNG, the same drawing the extension's icons were made from. */
export function iconPng(size) {
  const SUB = 3;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const color = sample((px + (sx + 0.5) / SUB) / size, (py + (sy + 0.5) / SUB) / size);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          hits += 1;
        }
      }
      const at = py * (size * 4 + 1) + 1 + px * 4;
      if (hits > 0) {
        raw[at] = r / hits;
        raw[at + 1] = g / hits;
        raw[at + 2] = b / hits;
      }
      raw[at + 3] = (hits / (SUB * SUB)) * 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
