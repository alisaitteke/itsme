import { type EffectDef, kick } from './types.ts';

// The colors come from two conic gradients on squares big enough to cover the viewport
// at any angle. Only their transform animates, so the page's own thread does no work.
const css = `
.aurora {
  position: absolute; inset: 0; overflow: hidden;
  animation: aurora-breathe 4.6s ease-in-out infinite;
  -webkit-mask-image:
    linear-gradient(to right, #000, rgb(0 0 0 / .32) 26px, transparent 84px, transparent calc(100% - 84px), rgb(0 0 0 / .32) calc(100% - 26px), #000),
    linear-gradient(to bottom, #000, rgb(0 0 0 / .32) 22px, transparent 72px, transparent calc(100% - 72px), rgb(0 0 0 / .32) calc(100% - 22px), #000);
  mask-image:
    linear-gradient(to right, #000, rgb(0 0 0 / .32) 26px, transparent 84px, transparent calc(100% - 84px), rgb(0 0 0 / .32) calc(100% - 26px), #000),
    linear-gradient(to bottom, #000, rgb(0 0 0 / .32) 22px, transparent 72px, transparent calc(100% - 72px), rgb(0 0 0 / .32) calc(100% - 22px), #000);
}
.aurora i {
  position: absolute; left: 50%; top: 50%; width: 150vmax; height: 150vmax; margin: -75vmax 0 0 -75vmax;
  background: conic-gradient(var(--a), var(--b), var(--c), var(--a), var(--b), var(--c), var(--a));
  animation: aurora-turn 16s linear infinite; will-change: transform;
}
.aurora i + i {
  opacity: .55; animation: aurora-turn 27s linear infinite reverse;
  background: conic-gradient(var(--c), transparent, var(--b), transparent, var(--a), transparent, var(--c));
}
.aurora-flash {
  position: absolute; inset: 0; opacity: 0;
  box-shadow: inset 0 0 60px 10px color-mix(in srgb, var(--c) 65%, transparent);
}
.aurora-flash.go { animation: aurora-flash .75s ease-out; }
.still .aurora { opacity: .6; }
@keyframes aurora-breathe { 0%, 100% { opacity: .42; } 50% { opacity: .85; } }
@keyframes aurora-turn { to { transform: rotate(360deg); } }
@keyframes aurora-flash { 0% { opacity: 0; } 22% { opacity: 1; } 100% { opacity: 0; } }
`;

export const aurora: EffectDef = {
  css,
  mount(layer) {
    layer.innerHTML = '<div class="aurora"><i></i><i></i></div><div class="aurora-flash"></div>';
    const flash = layer.querySelector('.aurora-flash');
    return {
      pulse: (at) => {
        if (at) kick(flash);
      },
      stop: () => {},
    };
  },
};
