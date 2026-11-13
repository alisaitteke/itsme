import { callAgent } from '../agent-client.ts';
import { activeDebugger } from '../debugger/index.ts';
import { showTab } from '../tabs.ts';
import { createDebuggerInput } from './debugger.ts';
import { createDomInput } from './dom.ts';
import type { InputDriver } from './driver.ts';

const domInput = createDomInput(callAgent);
let debuggerInput: InputDriver | null = null;

export async function currentInput(): Promise<InputDriver> {
  const active = await activeDebugger();
  if (!active) return domInput;
  debuggerInput ??= createDebuggerInput({
    agent: callAgent,
    sessions: active.sessions,
    showTab,
    fallback: domInput,
  });
  return debuggerInput;
}
