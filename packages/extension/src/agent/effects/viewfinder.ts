import { type EffectDef, kick } from './types.ts';

const IDLE_LABEL = 'itsme · watching';
const LABEL_MS = 1_300;

const tick = (direction: string) =>
  `linear-gradient(${direction}, #000 0 9px, transparent 9px calc(100% - 9px), #000 0)`;

const css = `
.vf { position: absolute; inset: 0; filter: drop-shadow(0 0 5px color-mix(in srgb, var(--a) 55%, transparent)); }
.vf .c { position: absolute; width: 30px; height: 30px; border: 3px solid var(--a); animation: vf-drift 3.2s ease-in-out infinite; }
.vf .tl { top: 12px; left: 12px; border-right: 0; border-bottom: 0; border-top-left-radius: 11px; --dx: -1; --dy: -1; }
.vf .tr { top: 12px; right: 12px; border-left: 0; border-bottom: 0; border-top-right-radius: 11px; --dx: 1; --dy: -1; }
.vf .bl { bottom: 12px; left: 12px; border-right: 0; border-top: 0; border-bottom-left-radius: 11px; --dx: -1; --dy: 1; }
.vf .br { bottom: 12px; right: 12px; border-left: 0; border-top: 0; border-bottom-right-radius: 11px; --dx: 1; --dy: 1; }
.vf.go .c { animation: vf-drift 3.2s ease-in-out infinite, vf-snap .5s cubic-bezier(.2, .8, .2, 1); }
.vf-label {
  position: absolute; top: 15px; left: 50px; display: flex; align-items: center; gap: 7px;
  padding: 5px 9px; border-radius: 6px; background: var(--a); color: #fff;
  font: 500 11px/1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; letter-spacing: .08em; text-transform: uppercase;
}
.vf-label i { width: 7px; height: 7px; border-radius: 50%; background: #fff; animation: vf-blink 1.2s steps(2, jump-none) infinite; }
.reticle { position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px; border: 2px solid var(--a); border-radius: 50%; opacity: 0; }
.reticle::before, .reticle::after { content: ""; position: absolute; background: var(--a); }
.reticle::before { left: 50%; top: -9px; bottom: -9px; width: 2px; margin-left: -1px; -webkit-mask: ${tick('to bottom')}; mask: ${tick('to bottom')}; }
.reticle::after { top: 50%; left: -9px; right: -9px; height: 2px; margin-top: -1px; -webkit-mask: ${tick('to right')}; mask: ${tick('to right')}; }
.reticle.go { animation: vf-lock .8s cubic-bezier(.2, .8, .2, 1); }
@keyframes vf-drift { 50% { translate: calc(var(--dx) * 3px) calc(var(--dy) * 3px); } }
@keyframes vf-snap { 30% { transform: translate(calc(var(--dx) * -9px), calc(var(--dy) * -9px)); } }
@keyframes vf-blink { 50% { opacity: .25; } }
@keyframes vf-lock { 0% { opacity: 0; transform: scale(2.4) rotate(-40deg); } 35% { opacity: 1; transform: scale(1) rotate(0deg); } 75% { opacity: 1; } 100% { opacity: 0; transform: scale(.9); } }
`;

export const viewfinder: EffectDef = {
  css,
  mount(layer) {
    layer.innerHTML =
      '<div class="vf"><b class="c tl"></b><b class="c tr"></b><b class="c bl"></b><b class="c br"></b>' +
      '<span class="vf-label"><i></i><span></span></span><div class="reticle"></div></div>';
    const frame = layer.querySelector('.vf');
    const reticle = layer.querySelector<HTMLElement>('.reticle');
    const label = layer.querySelector('.vf-label span');
    if (label) label.textContent = IDLE_LABEL;
    let timer: ReturnType<typeof setTimeout> | undefined;

    return {
      pulse(at, what) {
        if (label) label.textContent = `itsme · ${what}`;
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (label) label.textContent = IDLE_LABEL;
        }, LABEL_MS);
        if (!at || !reticle) return;
        reticle.style.left = `${at.x}px`;
        reticle.style.top = `${at.y}px`;
        kick(reticle);
        kick(frame);
      },
      stop: () => clearTimeout(timer),
    };
  },
};
