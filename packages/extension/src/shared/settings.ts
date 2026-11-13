import { DEFAULT_PORT } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { z } from 'zod';

const STORAGE_KEY = 'settings';

const settingsSchema = z.object({
  enabled: z.boolean().catch(true),
  port: z.number().int().min(1).max(65_535).catch(DEFAULT_PORT),
  token: z.string().catch(''),
  /** Send clicks and keystrokes through the debugger where the browser has one. */
  realInput: z.boolean().catch(true),
});
export type Settings = z.infer<typeof settingsSchema>;

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return settingsSchema.parse(stored[STORAGE_KEY] ?? {});
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await loadSettings()), ...patch });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function onSettingsChanged(listener: () => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && STORAGE_KEY in changes) listener();
  });
}
