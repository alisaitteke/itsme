import { once } from 'node:events';
import { createServer } from 'node:net';
import {
  BRIDGE_HOST,
  type BrowserInfo,
  commandNames,
  decodeMessage,
  EXTENSION_PATH,
  encodeMessage,
  type Message,
  PROTOCOL_VERSION,
} from '@itsme/protocol';
import { WebSocket } from 'ws';
import type { LinkOptions } from '../src/bridge/link.ts';
import { silentLogger } from '../src/logger.ts';

export const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

export async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, BRIDGE_HOST);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  server.close();
  await once(server, 'close');
  return port;
}

export function linkOptions(port: number, overrides: Partial<LinkOptions> = {}): LinkOptions {
  return {
    port,
    token: undefined,
    requestTimeoutMs: 1_000,
    serverVersion: '0.0.0-test',
    logger: silentLogger,
    ...overrides,
  };
}

export const browserInfo: BrowserInfo = {
  name: 'chrome',
  version: '142.0',
  extensionVersion: '0.0.0-test',
  commands: commandNames,
};

type Handler = (params: unknown) => unknown;

export interface FakeExtension {
  socket: WebSocket;
  /** Resolves with the close code. */
  closed: Promise<number>;
  /** The server's answer to the hello; absent when it closed the socket instead. */
  welcome?: Message;
}

/** Stands in for the browser: says hello, then answers requests from `handlers`. */
export async function connectFakeExtension(
  port: number,
  handlers: Record<string, Handler> = {},
  hello: { token?: string; protocolVersion?: number; origin?: string } = {},
): Promise<FakeExtension> {
  const socket = new WebSocket(`ws://${BRIDGE_HOST}:${port}${EXTENSION_PATH}`, {
    origin: hello.origin ?? EXTENSION_ORIGIN,
  });
  // A refused upgrade emits 'error' before 'close'; only the close matters here.
  socket.on('error', () => {});
  const closed = new Promise<number>((resolve) => socket.on('close', resolve));
  socket.on('message', (data) => {
    const message = decodeMessage(String(data));
    if (message.type !== 'request') return;
    const handler = handlers[message.command];
    if (!handler) return;
    socket.send(
      encodeMessage({ type: 'response', id: message.id, result: handler(message.params) }),
    );
  });

  const opened = await Promise.race([
    once(socket, 'open').then(
      () => true,
      () => false,
    ),
    closed.then(() => false),
  ]);
  if (!opened) return { socket, closed };

  const welcomed = Promise.race([once(socket, 'message'), closed]);
  socket.send(
    encodeMessage({
      type: 'hello',
      protocolVersion: hello.protocolVersion ?? PROTOCOL_VERSION,
      token: hello.token,
      browser: browserInfo,
    }),
  );
  const answer = await welcomed;
  const welcome = Array.isArray(answer) ? decodeMessage(String(answer[0])) : undefined;
  return { socket, closed, welcome };
}
