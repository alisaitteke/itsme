import { z } from 'zod';
import { BridgeError, wireErrorSchema } from './errors.ts';

export const browserInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  extensionVersion: z.string(),
  /** Command names this browser can run; lets a build drop what its browser lacks. */
  commands: z.array(z.string()),
});
export type BrowserInfo = z.infer<typeof browserInfoSchema>;

const helloSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: z.number().int(),
  token: z.string().optional(),
  /** Set by extensions, absent for peer servers. */
  browser: browserInfoSchema.optional(),
});

/** How the server was started, so the extension can show how to add it to another client. */
export const launchSchema = z.object({ command: z.string(), args: z.array(z.string()) });
export type Launch = z.infer<typeof launchSchema>;

const welcomeSchema = z.object({
  type: z.literal('welcome'),
  protocolVersion: z.number().int(),
  serverVersion: z.string(),
  launch: launchSchema.optional(),
});

const requestSchema = z.object({
  type: z.literal('request'),
  id: z.string(),
  command: z.string(),
  params: z.unknown(),
});

const responseSchema = z.object({
  type: z.literal('response'),
  id: z.string(),
  result: z.unknown().optional(),
  error: wireErrorSchema.optional(),
});

const pingSchema = z.object({ type: z.literal('ping') });
const pongSchema = z.object({ type: z.literal('pong') });

export const messageSchema = z.discriminatedUnion('type', [
  helloSchema,
  welcomeSchema,
  requestSchema,
  responseSchema,
  pingSchema,
  pongSchema,
]);

export type Message = z.infer<typeof messageSchema>;
export type HelloMessage = z.infer<typeof helloSchema>;
export type WelcomeMessage = z.infer<typeof welcomeSchema>;
export type RequestMessage = z.infer<typeof requestSchema>;
export type ResponseMessage = z.infer<typeof responseSchema>;

export function encodeMessage(message: Message): string {
  return JSON.stringify(message);
}

export function decodeMessage(raw: string): Message {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new BridgeError('INVALID_MESSAGE', 'Message is not valid JSON');
  }
  const parsed = messageSchema.safeParse(json);
  if (!parsed.success) {
    throw new BridgeError('INVALID_MESSAGE', z.prettifyError(parsed.error));
  }
  return parsed.data;
}
