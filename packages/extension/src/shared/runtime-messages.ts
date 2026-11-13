import type { ConnectionStatus } from '../background/connection.ts';

export const STATUS_REQUEST = { type: 'itsme/status' } as const;

/** Null while the bridge is switched off. */
export type StatusResponse = ConnectionStatus | null;

export function isStatusRequest(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === STATUS_REQUEST.type
  );
}
