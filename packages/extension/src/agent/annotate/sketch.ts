import type { MarkStyle } from '@itsme/protocol';
import { RoughGenerator } from 'roughjs/bin/generator.js';
import { type Box, boundsOf } from './lines.ts';

/** One stroke of the pen: an SVG path and how thick it is. */
export interface Stroke {
  d: string;
  width: number;
}

const generator = new RoughGenerator();
const PEN = 2.4;

/**
 * Draws a mark by hand over lines of text. The same seed gives the same wobble, so a
 * mark that has to be drawn again after the page reflows doesn't jump about.
 */
export function sketch(style: MarkStyle, lines: readonly Box[], seed: number): Stroke[] {
  const pen = { seed, roughness: 1.5, bowing: 1, strokeWidth: PEN };
  const all = boundsOf(lines);

  const drawables = (() => {
    switch (style) {
      case 'highlight':
        // A marker stroke through the middle of each line, nearly as thick as the line.
        return lines.map((line) =>
          generator.line(
            line.x - 2,
            line.y + line.h / 2,
            line.x + line.w + 2,
            line.y + line.h / 2,
            {
              ...pen,
              roughness: 1.1,
              bowing: 0.4,
              strokeWidth: line.h * 0.86,
            },
          ),
        );
      case 'underline':
        return lines.map((line) => {
          const y = line.y + line.h + 1;
          return generator.line(line.x, y, line.x + line.w, y, pen);
        });
      case 'box':
        // A phrase that wraps gets a box on each line; one around both would take in
        // words that aren't part of it. Three lines or more read as a paragraph.
        return (lines.length === 2 ? lines : [all]).map((box) =>
          generator.rectangle(box.x - 5, box.y - 4, box.w + 10, box.h + 8, pen),
        );
      case 'circle': {
        const padX = Math.max(12, all.h * 0.6);
        const padY = Math.max(8, all.h * 0.4);
        return [
          generator.ellipse(
            all.x + all.w / 2,
            all.y + all.h / 2,
            all.w + padX * 2,
            all.h + padY * 2,
            { ...pen, roughness: 1.1, curveFitting: 0.9 },
          ),
        ];
      }
      case 'bracket': {
        const x = all.x - 12;
        return [
          generator.linearPath(
            [
              [x + 7, all.y - 2],
              [x, all.y - 2],
              [x, all.y + all.h + 2],
              [x + 7, all.y + all.h + 2],
            ],
            pen,
          ),
        ];
      }
    }
  })();

  return drawables.flatMap((drawable) =>
    generator.toPaths(drawable).flatMap((path) =>
      // The pen goes over each shape twice; apart, the passes can be drawn one after the other.
      path.d
        .split(/(?=M)/)
        .filter((d) => d.trim() !== '')
        .map((d) => ({ d, width: path.strokeWidth })),
    ),
  );
}
