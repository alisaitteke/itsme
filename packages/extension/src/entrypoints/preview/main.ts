import { pulseIndicator, showIndicator, watchIndicatorStyle } from '../../agent/indicator.ts';

const ACT_EVERY_MS = 2_600;
const HIT_MS = 500;

const spots = [...document.querySelectorAll<HTMLElement>('[data-spot]')];
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let turn = 0;

/** Pretends itsme did something on the page, the way the agent reports a real action. */
function act(): void {
  // Each call also keeps the overlay from fading out, as real activity does.
  showIndicator();
  const spot = spots[turn++ % spots.length];
  if (still || !spot) return;
  const box = spot.getBoundingClientRect();
  pulseIndicator({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, spot.dataset.spot ?? '');
  spot.classList.add('hit');
  setTimeout(() => spot.classList.remove('hit'), HIT_MS);
}

watchIndicatorStyle();
showIndicator();
setInterval(act, ACT_EVERY_MS);
