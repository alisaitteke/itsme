import { DEFAULT_PORT } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { z } from 'zod';

const STORAGE_KEY = 'settings';

// A test build sets its own port, so it can never reach a server someone is really using.
const defaultPort = Number(import.meta.env.WXT_ITSME_PORT) || DEFAULT_PORT;

const settingsSchema = z.object({
  enabled: z.boolean().catch(true),
  port: z.number().int().min(1).max(65_535).catch(defaultPort),
  token: z.string().catch(''),
  /** Use the debugger where the browser has one: real input, console and network. */
  realInput: z.boolean().catch(true),
  /** "ask": a site has to be allowed by the user before its pages are read or driven. */
  siteAccess: z.enum(['ask', 'all']).catch('ask'),
  allowedSites: z.array(z.string()).catch([]),
  /** Wins over everything else, including "all". */
  blockedSites: z.array(z.string()).catch([]),
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

export async function allowSite(host: string): Promise<void> {
  const { allowedSites } = await loadSettings();
  if (!allowedSites.includes(host)) await saveSettings({ allowedSites: [...allowedSites, host] });
}

export function onSettingsChanged(listener: () => void): void {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && STORAGE_KEY in changes) listener();
  });
}
