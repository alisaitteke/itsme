import { type EffectDef, kick } from './types.ts';

// A conic gradient turning about the centre of the viewport, seen through a mask that
// leaves only the frame: a sharp 3px line with a soft falloff inside it.
const frame = (line: number, glow: number) => `
  linear-gradient(to right, #000 ${line}px, rgb(0 0 0 / .4) ${line}px, transparent ${glow}px, transparent calc(100% - ${glow}px), rgb(0 0 0 / .4) calc(100% - ${line}px), #000 calc(100% - ${line}px)),
  linear-gradient(to bottom, #000 ${line}px, rgb(0 0 0 / .4) ${line}px, transparent ${glow}px, transparent calc(100% - ${glow}px), rgb(0 0 0 / .4) calc(100% - ${line}px), #000 calc(100% - ${line}px))`;

const css = `
.orbit-base {
  position: absolute; inset: 0;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--a) 55%, transparent), inset 0 0 30px color-mix(in srgb, var(--a) 22%, transparent);
}
.orbit { position: absolute; inset: 0; overflow: hidden; -webkit-mask-image: ${frame(3, 16)}; mask-image: ${frame(3, 16)}; }
.orbit i {
  position: absolute; left: 50%; top: 50%; width: 150vmax; height: 150vmax; margin: -75vmax 0 0 -75vmax;
  will-change: transform;
}
.orbit.pair i {
  background: conic-gradient(transparent 0 27%, var(--a) 43%, var(--c) 48.6%, #fff 49.8%, transparent 50% 77%, var(--a) 93%, var(--c) 98.6%, #fff 99.8%, transparent 100%);
  animation: orbit-turn 7s linear infinite;
}
.orbit.lap { -webkit-mask-image: ${frame(4, 20)}; mask-image: ${frame(4, 20)}; opacity: 0; }
.orbit.lap i { background: conic-gradient(transparent 0 76%, var(--b) 90%, var(--c) 97%, #fff 99.6%, transparent 100%); transform: rotate(var(--from, 0deg)); }
.orbit.lap.go { animation: orbit-show 1.05s linear; }
.orbit.lap.go i { animation: orbit-lap 1.05s cubic-bezier(.45, 0, .2, 1); }
@keyframes orbit-turn { to { transform: rotate(360deg); } }
@keyframes orbit-lap { from { transform: rotate(var(--from, 0deg)); } to { transform: rotate(calc(var(--from, 0deg) + 360deg)); } }
@keyframes orbit-show { 0% { opacity: 0; } 12%, 78% { opacity: 1; } 100% { opacity: 0; } }
`;

export const orbit: EffectDef = {
  css,
  mount(layer) {
    layer.innerHTML =
      '<div class="orbit-base"></div><div class="orbit pair"><i></i></div><div class="orbit lap"><i></i></div>';
    const lap = layer.querySelector<HTMLElement>('.lap');
    return {
      pulse: (at) => {
        if (!at || !lap) return;
        // The extra trail sets off from the side of the frame the action is nearest to.
        const angle = Math.atan2(at.x - innerWidth / 2, innerHeight / 2 - at.y);
        lap.style.setProperty('--from', `${(angle * 180) / Math.PI}deg`);
        kick(lap);
      },
      stop: () => {},
    };
  },
};
