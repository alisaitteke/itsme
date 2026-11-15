// Read by the content script, so nothing here may pull in zod.

/** Key the extension's settings are stored under in storage.local. */
export const SETTINGS_KEY = 'settings';

/** The animation shown around a page while itsme uses it. "none" leaves just the badge. */
export const INDICATOR_STYLES = ['aurora', 'orbit', 'viewfinder', 'ripple', 'none'] as const;
export type IndicatorStyle = (typeof INDICATOR_STYLES)[number];

export const DEFAULT_INDICATOR: IndicatorStyle = 'aurora';

export function isIndicatorStyle(value: unknown): value is IndicatorStyle {
  return (INDICATOR_STYLES as readonly unknown[]).includes(value);
}
