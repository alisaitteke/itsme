import {
  BridgeError,
  type BrowserInfo,
  type CommandInput,
  type CommandName,
  type CommandResult,
  commands,
} from '@itsme/protocol';
import { Hub } from './hub.ts';
import type { Link, LinkOptions } from './link.ts';
import { PeerLink } from './peer.ts';

export type BridgeMode = 'hub' | 'peer' | 'offline';

export interface BridgeStatus {
  mode: BridgeMode;
  port: number;
  browsers: BrowserInfo[];
}

const RETRY_DELAY_MS = 2_000;

/**
 * Every MCP client starts its own server process, but only one can own the port.
 * The first becomes the hub; the rest relay through it and take over when it exits.
 */
export class Bridge {
  readonly #options: LinkOptions;
  #link: Link | null = null;
  #mode: BridgeMode = 'offline';
  #retry: NodeJS.Timeout | undefined;
  #stopped = false;

  constructor(options: LinkOptions) {
    this.#options = options;
  }

  get mode(): BridgeMode {
    return this.#mode;
  }

  /** Never rejects: when the port is unusable it keeps retrying in the background. */
  async start(): Promise<void> {
    this.#stopped = false;
    await this.#establish();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#retry);
    const link = this.#link;
    this.#link = null;
    this.#mode = 'offline';
    await link?.close();
  }

  async call<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
    if (!this.#link) {
      throw new BridgeError(
        'NOT_CONNECTED',
        `Bridge is offline: port ${this.#options.port} is unavailable`,
      );
    }
    const raw = await this.#link.request(name, input);
    const parsed = commands[name].result.safeParse(raw);
    if (!parsed.success) {
      throw new BridgeError('INTERNAL', `Browser returned an unexpected result for ${name}`);
    }
    return parsed.data as CommandResult<N>;
  }

  async status(): Promise<BridgeStatus> {
    const browsers = (await this.#link?.browsers().catch(() => [])) ?? [];
    return { mode: this.#mode, port: this.#options.port, browsers };
  }

  async #establish(): Promise<void> {
    const { logger, port } = this.#options;

    const hub = new Hub(this.#options);
    try {
      await hub.listen();
      logger.info(`Listening for the extension on port ${port}`);
      await this.#adopt(hub, 'hub');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        logger.warn(`Cannot listen on port ${port}: ${(error as Error).message}`);
        this.#retryLater();
        return;
      }
    }

    try {
      const peer = await PeerLink.connect(this.#options);
      peer.onClose = () => {
        this.#link = null;
        this.#mode = 'offline';
        void this.#establish();
      };
      logger.info(`Port ${port} belongs to another itsme server; relaying through it`);
      await this.#adopt(peer, 'peer');
    } catch (error) {
      logger.warn(`Port ${port} is busy: ${(error as Error).message}`);
      this.#retryLater();
    }
  }

  async #adopt(link: Link, mode: BridgeMode): Promise<void> {
    if (this.#stopped) {
      await link.close();
      return;
    }
    this.#link = link;
    this.#mode = mode;
  }

  #retryLater(): void {
    if (this.#stopped) return;
    this.#retry = setTimeout(() => void this.#establish(), RETRY_DELAY_MS);
    this.#retry.unref();
  }
}
