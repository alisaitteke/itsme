import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  BRIDGE_HOST,
  BridgeError,
  type BrowserInfo,
  CloseCode,
  decodeMessage,
  EXTENSION_PATH,
  encodeMessage,
  HELLO_TIMEOUT_MS,
  KEEPALIVE_INTERVAL_MS,
  type Message,
  PEER_PATH,
  PROTOCOL_VERSION,
  toWireError,
} from '@itsme/protocol';
import { WebSocket, WebSocketServer } from 'ws';
import { LIST_BROWSERS_COMMAND, type Link, type LinkOptions } from './link.ts';
import { PendingRequests } from './pending.ts';

type Role = 'extension' | 'peer';

interface ExtensionConnection {
  socket: WebSocket;
  info: BrowserInfo;
  pending: PendingRequests;
  lastSeen: number;
}

const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//;
const UNRESPONSIVE_AFTER_MS = KEEPALIVE_INTERVAL_MS * 2.5;

const digest = (value: string) => createHash('sha256').update(value).digest();

function send(socket: WebSocket, message: Message): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(message));
}

/** Owns the bridge port. Extensions connect here, and so do other server processes. */
export class Hub implements Link {
  readonly #options: LinkOptions;
  readonly #http: Server;
  readonly #wss = new WebSocketServer({ noServer: true });
  readonly #extensions: ExtensionConnection[] = [];
  #sweep: NodeJS.Timeout | undefined;

  constructor(options: LinkOptions) {
    this.#options = options;
    this.#http = createServer((_req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain' }).end('WebSocket only\n');
    });
    this.#http.on('upgrade', (req, socket, head) => this.#onUpgrade(req, socket, head));
  }

  /** Rejects with code EADDRINUSE when another process already holds the port. */
  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#http.once('error', reject);
      this.#http.listen(this.#options.port, BRIDGE_HOST, () => {
        this.#http.off('error', reject);
        this.#sweep = setInterval(() => this.#dropUnresponsive(), KEEPALIVE_INTERVAL_MS);
        this.#sweep.unref();
        resolve();
      });
    });
  }

  get port(): number {
    const address = this.#http.address();
    return typeof address === 'object' && address ? address.port : this.#options.port;
  }

  async request(command: string, params: unknown): Promise<unknown> {
    // With several browsers attached, the one that connected last takes the commands.
    const connection = this.#extensions.at(-1);
    if (!connection) {
      throw new BridgeError(
        'NOT_CONNECTED',
        `No browser is connected. Open a browser with the itsme extension enabled (port ${this.port}).`,
      );
    }
    if (!connection.info.commands.includes(command)) {
      throw new BridgeError('UNSUPPORTED', `${connection.info.name} does not support ${command}`);
    }
    const { id, promise } = connection.pending.create(this.#options.requestTimeoutMs, command);
    send(connection.socket, { type: 'request', id, command, params });
    return promise;
  }

  async browsers(): Promise<BrowserInfo[]> {
    return this.#extensions.map((connection) => connection.info);
  }

  async close(): Promise<void> {
    clearInterval(this.#sweep);
    for (const client of this.#wss.clients) client.terminate();
    this.#wss.close();
    await new Promise<void>((resolve) => this.#http.close(() => resolve()));
  }

  #onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const role = this.#roleFor(req);
    if (!role) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    this.#wss.handleUpgrade(req, socket, head, (ws) => this.#awaitHello(ws, role));
  }

  #roleFor(req: IncomingMessage): Role | null {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const { origin } = req.headers;
    // Browsers always send Origin and pages can't forge it, so a website can reach neither path.
    if (pathname === EXTENSION_PATH && origin && EXTENSION_ORIGIN.test(origin)) return 'extension';
    if (pathname === PEER_PATH && origin === undefined) return 'peer';
    return null;
  }

  #awaitHello(socket: WebSocket, role: Role): void {
    const { logger } = this.#options;
    const timer = setTimeout(
      () => socket.close(CloseCode.BadHello, 'No hello received'),
      HELLO_TIMEOUT_MS,
    );
    socket.once('close', () => clearTimeout(timer));
    socket.on('error', (error) => logger.debug(`${role} socket error: ${error.message}`));

    socket.once('message', (data) => {
      clearTimeout(timer);
      let hello: Message;
      try {
        hello = decodeMessage(String(data));
      } catch {
        socket.close(CloseCode.BadHello, 'Malformed hello');
        return;
      }
      if (hello.type !== 'hello' || (role === 'extension' && !hello.browser)) {
        socket.close(CloseCode.BadHello, 'Expected hello');
        return;
      }
      if (hello.protocolVersion !== PROTOCOL_VERSION) {
        const reason = `Server speaks protocol ${PROTOCOL_VERSION}, client ${hello.protocolVersion}`;
        logger.warn(`Rejected ${role}: ${reason}`);
        socket.close(CloseCode.ProtocolMismatch, reason);
        return;
      }
      if (!this.#tokenMatches(hello.token)) {
        logger.warn(`Rejected ${role}: wrong or missing token`);
        socket.close(CloseCode.Unauthorized, 'Token mismatch');
        return;
      }

      send(socket, {
        type: 'welcome',
        protocolVersion: PROTOCOL_VERSION,
        serverVersion: this.#options.serverVersion,
      });
      if (role === 'extension' && hello.browser) this.#attachExtension(socket, hello.browser);
      else this.#attachPeer(socket);
    });
  }

  #tokenMatches(presented: string | undefined): boolean {
    const expected = this.#options.token;
    if (expected === undefined) return true;
    return presented !== undefined && timingSafeEqual(digest(presented), digest(expected));
  }

  #attachExtension(socket: WebSocket, info: BrowserInfo): void {
    const { logger } = this.#options;
    const connection: ExtensionConnection = {
      socket,
      info,
      pending: new PendingRequests(),
      lastSeen: Date.now(),
    };
    this.#extensions.push(connection);
    logger.info(`Browser connected: ${info.name} ${info.version}`);

    socket.on('message', (data) => {
      connection.lastSeen = Date.now();
      let message: Message;
      try {
        message = decodeMessage(String(data));
      } catch (error) {
        logger.warn(`Dropped message from ${info.name}: ${toWireError(error).message}`);
        return;
      }
      if (message.type === 'response') connection.pending.settle(message);
      else if (message.type === 'ping') send(socket, { type: 'pong' });
    });

    socket.on('close', () => {
      const index = this.#extensions.indexOf(connection);
      if (index !== -1) this.#extensions.splice(index, 1);
      connection.pending.rejectAll(new BridgeError('NOT_CONNECTED', 'Browser disconnected'));
      logger.info(`Browser disconnected: ${info.name}`);
    });
  }

  #attachPeer(socket: WebSocket): void {
    socket.on('message', async (data) => {
      let message: Message;
      try {
        message = decodeMessage(String(data));
      } catch {
        return;
      }
      if (message.type !== 'request') return;
      const { id, command, params } = message;
      try {
        const result =
          command === LIST_BROWSERS_COMMAND
            ? await this.browsers()
            : await this.request(command, params);
        send(socket, { type: 'response', id, result });
      } catch (error) {
        send(socket, { type: 'response', id, error: toWireError(error) });
      }
    });
  }

  #dropUnresponsive(): void {
    const cutoff = Date.now() - UNRESPONSIVE_AFTER_MS;
    for (const connection of this.#extensions) {
      if (connection.lastSeen < cutoff) connection.socket.terminate();
    }
  }
}
