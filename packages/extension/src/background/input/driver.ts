import type { Modifier, Target } from '@itsme/protocol';
import type { AgentCall, AgentResults, Button } from '../../agent/messages.ts';
import type { KeyInfo } from '../../shared/keys.ts';

export interface ClickOptions {
  button: Button;
  count: number;
  modifiers: Modifier[];
}

/** How pointer and keyboard actions reach the page. */
export interface InputDriver {
  click(tabId: number, target: Target, options: ClickOptions): Promise<void>;
  hover(tabId: number, target: Target): Promise<void>;
  drag(tabId: number, from: Target, to: Target): Promise<void>;
  /** Without a ref the text goes to whatever has focus. */
  type(
    tabId: number,
    ref: string | undefined,
    text: string,
    clear: boolean,
    submit: boolean,
  ): Promise<void>;
  press(tabId: number, key: KeyInfo, modifiers: Modifier[], count: number): Promise<void>;
}

export type CallAgent = <K extends AgentCall['kind']>(
  tabId: number,
  call: Extract<AgentCall, { kind: K }>,
) => Promise<AgentResults[K]>;
