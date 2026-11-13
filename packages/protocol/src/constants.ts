/** Bumped on any wire change the other side can't ignore. */
export const PROTOCOL_VERSION = 2;

export const DEFAULT_PORT = 47821;
export const BRIDGE_HOST = '127.0.0.1';

export const EXTENSION_PATH = '/extension';
export const PEER_PATH = '/peer';

// Chrome stops an idle service worker after 30s; socket traffic resets that timer.
export const KEEPALIVE_INTERVAL_MS = 20_000;

export const HELLO_TIMEOUT_MS = 5_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export const CloseCode = {
  BadHello: 4000,
  ProtocolMismatch: 4001,
  Unauthorized: 4002,
  Unresponsive: 4003,
} as const;
