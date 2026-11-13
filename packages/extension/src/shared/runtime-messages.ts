import type { ConnectionStatus } from '../background/connection.ts';

export const STATUS_REQUEST = { type: 'itsme/status' } as const;

/** Null while the bridge is switched off. */
export type StatusResponse = ConnectionStatus | null;

/** Sent by the in-page badge when the user presses Stop. */
export const STOP_REQUEST = { type: 'itsme/stop' } as const;

/** Sent by the in-page prompt when the user answers it. */
export interface SiteDecision {
  type: 'itsme/site-decision';
  allow: boolean;
}

function hasType(message: unknown, type: string): boolean {
  return (
    typeof message === 'object' && message !== null && (message as { type?: unknown }).type === type
  );
}

export const isStatusRequest = (message: unknown): boolean => hasType(message, STATUS_REQUEST.type);

export const isStopRequest = (message: unknown): boolean => hasType(message, STOP_REQUEST.type);

export const isSiteDecision = (message: unknown): message is SiteDecision =>
  hasType(message, 'itsme/site-decision') &&
  typeof (message as { allow?: unknown }).allow === 'boolean';
