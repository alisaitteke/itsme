import type { CommandResult, WireError } from '@itsme/protocol';

// Type-only imports from the protocol package keep zod out of the injected script.

export const AGENT_CHANNEL = 'itsme/agent';

export type AgentCall =
  | { kind: 'snapshot'; maxTextLength: number }
  | { kind: 'click'; ref: string }
  | { kind: 'type'; ref: string; text: string; clear: boolean; submit: boolean }
  | { kind: 'locate'; ref: string }
  | { kind: 'focus'; ref: string; select: boolean };

export type AgentRequest = AgentCall & { channel: typeof AGENT_CHANNEL };

export interface AgentResults {
  snapshot: CommandResult<'page.snapshot'>;
  click: CommandResult<'page.click'>;
  type: CommandResult<'page.type'>;
  /** Viewport point to press, and whether a real pointer there would hit the element. */
  locate: { x: number; y: number; hittable: boolean };
  /** What kind of control now has focus; a select can't take typed text. */
  focus: { control: 'text' | 'select' };
}

export type AgentResponse = { ok: true; result: unknown } | { ok: false; error: WireError };

export class AgentError extends Error {
  readonly code: WireError['code'];

  constructor(code: WireError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function isAgentRequest(message: unknown): message is AgentRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { channel?: unknown }).channel === AGENT_CHANNEL
  );
}
