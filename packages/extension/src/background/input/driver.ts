import type { AgentCall, AgentResults } from '../../agent/messages.ts';

/** How clicks and keystrokes reach the page. */
export interface InputDriver {
  click(tabId: number, ref: string): Promise<void>;
  type(tabId: number, ref: string, text: string, clear: boolean, submit: boolean): Promise<void>;
}

export type CallAgent = <K extends AgentCall['kind']>(
  tabId: number,
  call: Extract<AgentCall, { kind: K }>,
) => Promise<AgentResults[K]>;
