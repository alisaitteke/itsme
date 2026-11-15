import type { IndicatorStyle } from '../../shared/indicator-styles.ts';
import { aurora } from './aurora.ts';
import { orbit } from './orbit.ts';
import { ripple } from './ripple.ts';
import type { EffectDef } from './types.ts';
import { viewfinder } from './viewfinder.ts';

export const effects: Record<Exclude<IndicatorStyle, 'none'>, EffectDef> = {
  aurora,
  orbit,
  viewfinder,
  ripple,
};
