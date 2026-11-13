import {
  BRIDGE_HOST,
  BridgeError,
  type BrowserInfo,
  browserInfoSchema,
  decodeMessage,
  encodeMessage,
  HELLO_TIMEOUT_MS,
  type Message,
  PEER_PATH,
  PROTOCOL_VERSION,
} from '@itsme/protocol';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { LIST_BROWSERS_COMMAND, type Link, type LinkOptions } from './link.ts';
import { PendingRequests } from './pending.ts';

// The hub enforces the real timeout; this only covers a hub that never answers.
const HUB_SLACK_MS = 2_000;

/** Reaches the browser through the hub of another server process on the same port. */
export class PeerLink implements Link {
  readonly #socket: WebSocket;
  readonly #options: LinkOptions;
  readonly #pending = new PendingRequests();
  onClose: (() => void) | undefined;

  private constructor(socket: WebSocket, options: LinkOptions) {
    this.#socket = socket;
    this.#options = options;
    socket.on('message', (data) => {
      let message: Message;
      try {
        message = decodeMessage(String(data));
      } catch {
        return;
      }
      if (message.type === 'response') this.#pending.settle(message);
    });
    socket.on('close', () => {
      this.#pending.rejectAll(new BridgeError('NOT_CONNECTED', 'Lost the bridge hub'));
      this.onClose?.();
    });
  }

  static connect(options: LinkOptions): Promise<PeerLink> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${BRIDGE_HOST}:${options.port}${PEER_PATH}`, {
        handshakeTimeout: HELLO_TIMEOUT_MS,
      });
      const timer = setTimeout(() => socket.terminate(), HELLO_TIMEOUT_MS);
      const fail = (reason: string) => {
        clearTimeout(timer);
        socket.terminate();
        reject(new Error(reason));
      };

      socket.once('error', (error) => fail(error.message));
      socket.once('close', (code, reason) => fail(`Hub closed the connection (${code} ${reason})`));
      socket.once('open', () => {
        socket.send(
          encodeMessage({ type: 'hello', protocolVersion: PROTOCOL_VERSION, token: options.token }),
        );
      });
      socket.once('message', (data) => {
        try {
          if (decodeMessage(String(data)).type !== 'welcome') throw new Error();
        } catch {
          fail('Port is in use by something other than an itsme hub');
          return;
        }
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.on('error', (error) => options.logger.debug(`Hub socket error: ${error.message}`));
        resolve(new PeerLink(socket, options));
      });
    });
  }

  async request(command: string, params: unknown): Promise<unknown> {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new BridgeError('NOT_CONNECTED', 'Lost the bridge hub');
    }
    const timeoutMs = this.#options.requestTimeoutMs + HUB_SLACK_MS;
    const { id, promise } = this.#pending.create(timeoutMs, command);
    this.#socket.send(encodeMessage({ type: 'request', id, command, params }));
    return promise;
  }

  async browsers(): Promise<BrowserInfo[]> {
    return z.array(browserInfoSchema).parse(await this.request(LIST_BROWSERS_COMMAND, {}));
  }

  async close(): Promise<void> {
    this.onClose = undefined;
    this.#socket.terminate();
  }
}
