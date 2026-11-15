export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const middle = (box: Box) => box.y + box.h / 2;
const holds = (box: Box, y: number) => y > box.y && y < box.y + box.h;

/**
 * Turns the many small boxes a browser reports for a stretch of text (one for each
 * inline element it runs through) into one box per line of text.
 */
export function mergeLines(boxes: readonly Box[]): Box[] {
  const lines: Box[] = [];
  const sized = boxes.filter((box) => box.w > 0.5 && box.h > 0.5);
  for (const box of sized.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((known) => holds(known, middle(box)) || holds(box, middle(known)));
    if (!line) {
      lines.push({ ...box });
      continue;
    }
    const right = Math.max(line.x + line.w, box.x + box.w);
    const bottom = Math.max(line.y + line.h, box.y + box.h);
    line.x = Math.min(line.x, box.x);
    line.y = Math.min(line.y, box.y);
    line.w = right - line.x;
    line.h = bottom - line.y;
  }
  return lines;
}

/** The box around all of them. */
export function boundsOf(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((box) => box.x + box.w)) - x,
    h: Math.max(...boxes.map((box) => box.y + box.h)) - y,
  };
}
