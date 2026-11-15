import type { Launch } from '@itsme/protocol';
import { browser } from 'wxt/browser';

const LAUNCH_KEY = 'launch';

/** Remembers how the server this browser last connected to was started. */
export async function saveLaunch(launch: Launch): Promise<void> {
  await browser.storage.local.set({ [LAUNCH_KEY]: launch });
}

/** Null until the browser has connected to a server once. */
export async function loadLaunch(): Promise<Launch | null> {
  const stored = (await browser.storage.local.get(LAUNCH_KEY))[LAUNCH_KEY] as
    | Partial<Launch>
    | undefined;
  if (typeof stored?.command !== 'string' || !Array.isArray(stored.args)) return null;
  return { command: stored.command, args: stored.args.map(String) };
}
