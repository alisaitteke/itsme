import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'NOT_CONNECTED',
  'TIMEOUT',
  'INVALID_MESSAGE',
  'INVALID_PARAMS',
  'UNKNOWN_COMMAND',
  'UNSUPPORTED',
  'TAB_NOT_FOUND',
  'ELEMENT_NOT_FOUND',
  'PAGE_NOT_ACCESSIBLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const wireErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
});
export type WireError = z.infer<typeof wireErrorSchema>;

export class BridgeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }

  static from(error: WireError): BridgeError {
    return new BridgeError(error.code, error.message);
  }
}

export function toWireError(error: unknown): WireError {
  if (error instanceof BridgeError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) {
    return { code: 'INVALID_PARAMS', message: z.prettifyError(error) };
  }
  return { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) };
}
