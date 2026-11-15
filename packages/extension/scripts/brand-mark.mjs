// Draws the itsme mark as a PNG without any image library: the shapes in
// brand/mark.json are sampled pixel by pixel.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const mark = JSON.parse(readFileSync(join(import.meta.dirname, '../brand/mark.json'), 'utf8'));
const BOX = 64;

const rgb = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** The points of a path made of one M and any number of absolute C commands. */
function flatten(d) {
  const numbers = d.match(/-?\d+(\.\d+)?/g).map(Number);
  let [x0, y0] = numbers;
  const points = [[x0, y0]];
  for (let at = 2; at + 5 < numbers.length; at += 6) {
    const [x1, y1, x2, y2, x3, y3] = numbers.slice(at, at + 6);
    for (let step = 1; step <= 24; step++) {
      const t = step / 24;
      const u = 1 - t;
      points.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
    [x0, y0] = [x3, y3];
  }
  return points;
}

function distanceToLine(x, y, points) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let c = 0xffffffff;
  for (const byte of body) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, body.length + 4);
  return out;
}

/** The mark at `size` pixels. Small sizes get the simpler drawing, which stays legible. */
export function markPng(size) {
  const shape = size <= 32 ? mark.small : mark.full;
  const line = flatten(shape.d);
  const [tile, stroke, dot] = [mark.tile, mark.stroke, mark.dot].map(rgb);
  const r = mark.radius;

  const colorAt = (x, y) => {
    const dx = Math.max(r - x, x - (BOX - r), 0);
    const dy = Math.max(r - y, y - (BOX - r), 0);
    if (Math.hypot(dx, dy) > r) return null;
    if (Math.hypot(x - shape.dotAt[0], y - shape.dotAt[1]) <= shape.dotRadius) return dot;
    return distanceToLine(x, y, line) <= shape.width / 2 ? stroke : tile;
  };

  const SUB = 4;
  const row = size * 4 + 1;
  const raw = Buffer.alloc(row * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      let hits = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const color = colorAt(
            ((px + (sx + 0.5) / SUB) / size) * BOX,
            ((py + (sy + 0.5) / SUB) / size) * BOX,
          );
          if (!color) continue;
          for (let c = 0; c < 3; c++) sum[c] += color[c];
          hits += 1;
        }
      }
      const at = py * row + 1 + px * 4;
      for (let c = 0; c < 3; c++) raw[at + c] = hits ? sum[c] / hits : 0;
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
