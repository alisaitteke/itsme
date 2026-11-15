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

/** Sent by an in-page overlay that wants to be set in the brand's typeface. */
export const FONT_REQUEST = { type: 'itsme/brand-font' } as const;

/** One file of the typeface: its bytes in base64, and the characters it holds. */
export interface FontFile {
  data: string;
  unicodeRange: string;
}

function hasType(message: unknown, type: string): boolean {
  return (
    typeof message === 'object' && message !== null && (message as { type?: unknown }).type === type
  );
}

export const isStatusRequest = (message: unknown): boolean => hasType(message, STATUS_REQUEST.type);

export const isStopRequest = (message: unknown): boolean => hasType(message, STOP_REQUEST.type);

export const isFontRequest = (message: unknown): boolean => hasType(message, FONT_REQUEST.type);

export const isSiteDecision = (message: unknown): message is SiteDecision =>
  hasType(message, 'itsme/site-decision') &&
  typeof (message as { allow?: unknown }).allow === 'boolean';
