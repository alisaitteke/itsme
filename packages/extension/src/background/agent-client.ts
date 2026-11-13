import { BridgeError } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import {
  AGENT_CHANNEL,
  type AgentCall,
  type AgentResponse,
  type AgentResults,
} from '../agent/messages.ts';

// Output path WXT gives src/entrypoints/agent.content.ts.
const AGENT_SCRIPT = '/content-scripts/agent.js';

async function send(tabId: number, call: AgentCall): Promise<AgentResponse> {
  return browser.tabs.sendMessage(tabId, { ...call, channel: AGENT_CHANNEL }, { frameId: 0 });
}

async function inject(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [AGENT_SCRIPT] });
  } catch (error) {
    // Browser pages, the extension store and similar refuse scripts.
    const detail = error instanceof Error ? error.message : String(error);
    throw new BridgeError('PAGE_NOT_ACCESSIBLE', `Cannot script this page: ${detail}`);
  }
}

/** Runs a call in the tab's main frame, injecting the agent on first use. */
export async function callAgent<K extends AgentCall['kind']>(
  tabId: number,
  call: Extract<AgentCall, { kind: K }>,
): Promise<AgentResults[K]> {
  let response: AgentResponse | undefined;
  try {
    response = await send(tabId, call);
  } catch {
    // No listener yet: the agent isn't in this document.
  }
  if (!response) {
    await inject(tabId);
    response = await send(tabId, call);
  }
  if (!response.ok) throw BridgeError.from(response.error);
  return response.result as AgentResults[K];
}
