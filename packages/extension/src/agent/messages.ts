import type {
  CommandParams,
  CommandResult,
  Locator,
  Modifier,
  Target,
  WireError,
} from '@itsme/protocol';
import type { KeyInfo } from '../shared/keys.ts';

// Type-only imports from the protocol package keep zod out of the injected script.

export const AGENT_CHANNEL = 'itsme/agent';

export type Button = 'left' | 'right' | 'middle';
export type UploadFile = CommandParams<'page.upload'>['files'][number];
export type Direction = 'up' | 'down' | 'left' | 'right';

export type AgentCall =
  | {
      kind: 'snapshot';
      filter: 'all' | 'interactive';
      ref?: string;
      maxDepth: number;
      maxChars: number;
    }
  | { kind: 'find'; query: string }
  | { kind: 'text'; maxChars: number }
  | { kind: 'viewport' }
  | { kind: 'prompt'; host: string }
  | { kind: 'hideIndicator' }
  | { kind: 'hasText'; text: string }
  | { kind: 'resolve'; locator: Locator }
  | { kind: 'upload'; ref: string; files: UploadFile[] }
  | { kind: 'locate'; target: Target; scroll: boolean; why: 'click' | 'hover' | 'drag' }
  | { kind: 'click'; target: Target; button: Button; count: number; modifiers: Modifier[] }
  | { kind: 'hover'; target: Target }
  | { kind: 'focus'; ref: string; select: boolean }
  | { kind: 'type'; ref?: string; text: string; clear: boolean; submit: boolean }
  | { kind: 'press'; key: KeyInfo; modifiers: Modifier[]; count: number }
  | { kind: 'scroll'; ref?: string; direction: Direction; amount: number };

export type AgentRequest = AgentCall & { channel: typeof AGENT_CHANNEL };

export interface AgentResults {
  snapshot: CommandResult<'page.snapshot'>;
  find: CommandResult<'page.find'>;
  text: CommandResult<'page.text'>;
  viewport: { width: number; height: number };
  prompt: Record<string, never>;
  hideIndicator: Record<string, never>;
  hasText: boolean;
  /** `ref` is null when nothing on the page matches. */
  resolve: { ref: string | null; password: boolean };
  upload: Record<string, never>;
  /** Viewport point to press, and whether a real pointer there would hit the target. */
  locate: { x: number; y: number; hittable: boolean; inViewport: boolean };
  click: Record<string, never>;
  hover: Record<string, never>;
  /** What kind of control now has focus; a select can't take typed text. */
  focus: { control: 'text' | 'select' };
  type: Record<string, never>;
  press: Record<string, never>;
  scroll: CommandResult<'page.scroll'>;
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
