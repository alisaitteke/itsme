import {
  type BrowserInfo,
  CloseCode,
  decodeMessage,
  encodeMessage,
  HELLO_TIMEOUT_MS,
  KEEPALIVE_INTERVAL_MS,
  type Message,
  PROTOCOL_VERSION,
  type RequestMessage,
  toWireError,
  type WelcomeMessage,
} from '@itsme/protocol';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface ConnectionStatus {
  state: ConnectionState;
  url: string;
  serverVersion?: string;
  lastError?: string;
}

export interface ConnectionOptions {
  url: string;
  token?: string;
  browser: BrowserInfo;
  onRequest(command: string, params: unknown): Promise<unknown>;
  onDisconnect?(): void;
  onWelcome?(welcome: WelcomeMessage): void;
  /** For tests: Node has to set the Origin header that a browser adds by itself. */
  createSocket?(url: string): WebSocket;
  reconnectDelaysMs?: readonly number[];
}

const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const UNRESPONSIVE_AFTER_MS = KEEPALIVE_INTERVAL_MS * 2.5;

/**
 * Keeps one WebSocket to the MCP server open, reconnecting with backoff.
 * Uses no extension APIs, so it runs the same in a service worker, an event page or Node.
 */
export class BridgeConnection {
  readonly #options: ConnectionOptions;
  #socket: WebSocket | null = null;
  #state: ConnectionState = 'disconnected';
  #serverVersion: string | undefined;
  #lastError: string | undefined;
  #lastSeen = 0;
  #attempt = 0;
  #stopped = true;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #helloTimer: ReturnType<typeof setTimeout> | undefined;
  #keepaliveTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: ConnectionOptions) {
    this.#options = options;
  }

  get status(): ConnectionStatus {
    return {
      state: this.#state,
      url: this.#options.url,
      serverVersion: this.#serverVersion,
      lastError: this.#lastError,
    };
  }

  /** Safe to call repeatedly: does nothing while a socket is open or opening. */
  start(): void {
    this.#stopped = false;
    if (this.#socket) return;
    clearTimeout(this.#reconnectTimer);
    this.#open();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    if (this.#socket) this.#drop(this.#socket, undefined);
  }

  #open(): void {
    this.#state = 'connecting';
    let socket: WebSocket;
    try {
      socket = this.#options.createSocket?.(this.#options.url) ?? new WebSocket(this.#options.url);
    } catch (error) {
      this.#state = 'disconnected';
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;

    socket.onopen = () => {
      this.#send(socket, {
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        token: this.#options.token,
        browser: this.#options.browser,
      });
      this.#helloTimer = setTimeout(
        () => this.#drop(socket, 'Server did not answer the hello'),
        HELLO_TIMEOUT_MS,
      );
    };
    socket.onmessage = (event) => this.#onMessage(socket, String(event.data));
    socket.onclose = (event) => this.#drop(socket, this.#closeReason(event.code, event.reason));
    // Browsers follow an error with a close event; Node's WebSocket doesn't when the
    // connection is refused, so don't wait for it.
    socket.onerror = () => this.#drop(socket, this.#closeReason(undefined, ''));
  }

  #onMessage(socket: WebSocket, raw: string): void {
    if (socket !== this.#socket) return;
    let message: Message;
    try {
      message = decodeMessage(raw);
    } catch {
      return;
    }
    this.#lastSeen = Date.now();

    if (message.type === 'welcome') {
      clearTimeout(this.#helloTimer);
      this.#state = 'connected';
      this.#serverVersion = message.serverVersion;
      this.#lastError = undefined;
      this.#attempt = 0;
      this.#keepaliveTimer = setInterval(() => this.#keepalive(socket), KEEPALIVE_INTERVAL_MS);
      this.#options.onWelcome?.(message);
    } else if (message.type === 'request') {
      void this.#answer(socket, message);
    }
  }

  async #answer(socket: WebSocket, request: RequestMessage): Promise<void> {
    try {
      const result = await this.#options.onRequest(request.command, request.params);
      this.#send(socket, { type: 'response', id: request.id, result });
    } catch (error) {
      this.#send(socket, { type: 'response', id: request.id, error: toWireError(error) });
    }
  }

  #keepalive(socket: WebSocket): void {
    if (Date.now() - this.#lastSeen > UNRESPONSIVE_AFTER_MS) {
      this.#drop(socket, 'Server stopped responding');
      return;
    }
    this.#send(socket, { type: 'ping' });
  }

  #send(socket: WebSocket, message: Message): void {
    if (socket === this.#socket && socket.readyState === WebSocket.OPEN) {
      socket.send(encodeMessage(message));
    }
  }

  #closeReason(code: number | undefined, reason: string): string {
    if (code === CloseCode.Unauthorized) return 'The server rejected the token';
    if (code === CloseCode.ProtocolMismatch) {
      return `Version mismatch: ${reason || 'update the extension or the server'}`;
    }
    return this.#state === 'connected' ? 'Connection lost' : 'Server is not running';
  }

  #drop(socket: WebSocket, reason: string | undefined): void {
    if (socket !== this.#socket) return;
    this.#socket = null;
    clearTimeout(this.#helloTimer);
    clearInterval(this.#keepaliveTimer);
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    socket.close();

    this.#state = 'disconnected';
    this.#serverVersion = undefined;
    this.#lastError = reason;
    this.#options.onDisconnect?.();
    if (!this.#stopped) this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    const delays = this.#options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    const delay = delays[Math.min(this.#attempt, delays.length - 1)] ?? 1_000;
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      if (!this.#stopped && !this.#socket) this.#open();
    }, delay);
  }
}
