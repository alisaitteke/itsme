import type { Point } from '../geometry.ts';

export type { Point };

export interface EffectEnv {
  /** The page has a dark background, so the effect needs lighter colors. */
  dark: boolean;
  /** The user asked the system for less motion: show a still frame. */
  still: boolean;
}

export interface Effect {
  /**
   * itsme just did something. `at` is where in the viewport, or null when the action
   * has no place; `what` is a word for it, such as "click".
   */
  pulse(at: Point | null, what: string): void;
  stop(): void;
}

export interface EffectDef {
  css: string;
  mount(layer: HTMLElement, env: EffectEnv): Effect;
}

/** Restarts a one-shot CSS animation that is tied to the "go" class. */
export function kick(el: Element | null): void {
  if (!el) return;
  el.classList.remove('go');
  // Reading a layout property makes the browser notice the class was gone.
  void (el as HTMLElement).offsetWidth;
  el.classList.add('go');
}
