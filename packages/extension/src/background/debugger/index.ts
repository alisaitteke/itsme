import { browser } from 'wxt/browser';
import { loadSettings, saveSettings } from '../../shared/settings.ts';
import { PageMonitor } from './monitor.ts';
import { type DebuggerApi, DebuggerSessions } from './sessions.ts';

let sessions: DebuggerSessions | null = null;
let monitor: PageMonitor | null = null;

/**
 * Call once when the background starts. Not done at import time because WXT loads
 * this module during the build, where extension APIs don't exist.
 */
export function setupDebugger(): void {
  // Firefox and Safari have no debugger API; their builds don't request the permission.
  const api = (browser as { debugger?: DebuggerApi }).debugger;
  if (!api) return;

  sessions = new DebuggerSessions(api, {
    // Cancel on the warning bar means stop, not "ask me again on the next click".
    onUserCancel: () => void saveSettings({ realInput: false }),
  });
  const recorder = new PageMonitor(sessions);
  monitor = recorder;
  browser.tabs.onRemoved.addListener((tabId) => recorder.forget(tabId));
}

/** Null where the browser has no debugger API, or the user has switched it off. */
export async function activeDebugger(): Promise<{
  sessions: DebuggerSessions;
  monitor: PageMonitor;
} | null> {
  if (!sessions || !monitor || !(await loadSettings()).realInput) return null;
  return { sessions, monitor };
}

export function detachDebugger(): void {
  void sessions?.detachAll();
}
