import type { BrowserInfo, Launch } from '@itsme/protocol';
import type { Logger } from '../logger.ts';

/** A route to the browser: the hub itself, or a socket to another process's hub. */
export interface Link {
  request(command: string, params: unknown): Promise<unknown>;
  browsers(): Promise<BrowserInfo[]>;
  close(): Promise<void>;
}

export interface LinkOptions {
  port: number;
  requestTimeoutMs: number;
  serverVersion: string;
  /** Passed on to the extension in the welcome. */
  launch?: Launch;
  logger: Logger;
}

/** Peer-only command the hub answers itself instead of forwarding to a browser. */
export const LIST_BROWSERS_COMMAND = 'bridge.browsers';
