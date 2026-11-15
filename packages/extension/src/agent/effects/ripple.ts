import type { EffectDef, Point } from './types.ts';

const STEP = 15;
/** Speed of a ripple's front, in pixels per millisecond. */
const SPEED = 0.85;
const LIFE_MS = 1_700;
/** How far either side of the front a dot still swells. */
const REACH = 70;

interface Wave extends Point {
  start: number;
}

/**
 * A frame of dots that shrink towards the middle of the page. A ripple spreads from
 * wherever itsme acts and swells the dots it passes.
 */
export const ripple: EffectDef = {
  css: '.ripple { position: absolute; inset: 0; width: 100%; height: 100%; }',
  mount(layer, env) {
    layer.innerHTML = '<canvas class="ripple"></canvas>';
    const canvas = layer.firstElementChild as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    const lightness = env.dark ? 66 : 52;
    let waves: Wave[] = [];
    let frame = 0;

    const draw = (now: number) => {
      if (!ctx || !canvas.isConnected) return;
      const width = innerWidth;
      const height = innerHeight;
      const ratio = devicePixelRatio || 1;
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      waves = waves.filter((wave) => now - wave.start < LIFE_MS);
      const band = Math.min(92, width * 0.15);
      const seconds = now / 1000;
      for (let y = STEP / 2; y < height; y += STEP) {
        for (let x = STEP / 2; x < width; x += STEP) {
          const edge = Math.min(x, y, width - x, height - y);
          if (edge > band) continue;
          const base = (1 - edge / band) ** 1.7;
          const idle = env.still ? 0.5 : 0.5 + 0.5 * Math.sin((x + y) * 0.013 - seconds * 1.5);
          let boost = 0;
          for (const wave of waves) {
            const age = now - wave.start;
            const off = Math.abs(Math.hypot(x - wave.x, y - wave.y) - age * SPEED);
            if (off < REACH) boost += (1 - off / REACH) * (1 - age / LIFE_MS);
          }
          boost = Math.min(boost, 1);
          const radius = (0.6 + 3.1 * base) * (1 + 1.3 * boost);
          const alpha = Math.min(1, base * (0.34 + 0.4 * idle) + boost * Math.sqrt(base) * 0.85);
          ctx.fillStyle = `hsl(${222 - 36 * boost} 95% ${lightness + 10 * boost}% / ${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // A still frame is drawn once; it only needs redrawing while a ripple is on its way.
      if (!env.still || waves.length > 0) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return {
      pulse(at) {
        if (!at) return;
        waves.push({ ...at, start: performance.now() });
        if (env.still) {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(draw);
        }
      },
      stop: () => cancelAnimationFrame(frame),
    };
  },
};
