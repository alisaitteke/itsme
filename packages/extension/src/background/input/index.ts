import { browser } from 'wxt/browser';
import { loadSettings, saveSettings } from '../../shared/settings.ts';
import { callAgent } from '../agent-client.ts';
import { type DebuggerApi, DebuggerSessions } from '../debugger/sessions.ts';
import { showTab } from '../tabs.ts';
import { createDebuggerInput } from './debugger.ts';
import { createDomInput } from './dom.ts';
import type { InputDriver } from './driver.ts';

const domInput = createDomInput(callAgent);
let debuggerSessions: DebuggerSessions | null = null;
let debuggerInput: InputDriver | null = null;

/**
 * Call once when the background starts. Not done at import time because WXT loads
 * this module during the build, where extension APIs don't exist.
 */
export function setupInput(): void {
  // Firefox and Safari have no debugger API; their builds don't request the permission.
  const api = (browser as { debugger?: DebuggerApi }).debugger;
  if (!api) return;

  debuggerSessions = new DebuggerSessions(api, {
    // Cancel on the warning bar means stop, not "ask me again on the next click".
    onUserCancel: () => void saveSettings({ realInput: false }),
  });
  debuggerInput = createDebuggerInput({
    agent: callAgent,
    sessions: debuggerSessions,
    showTab,
    fallback: domInput,
  });
}

export async function currentInput(): Promise<InputDriver> {
  if (debuggerInput && (await loadSettings()).realInput) return debuggerInput;
  return domInput;
}

export function detachDebugger(): void {
  void debuggerSessions?.detachAll();
}
