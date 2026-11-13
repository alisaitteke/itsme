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

/** "outdated": a newer server took the port over; this one stays out of its way. */
export type BridgeMode = 'hub' | 'peer' | 'offline' | 'outdated';

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
  #lastWarning = '';

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
        this.#mode === 'outdated'
          ? 'A newer itsme server is running on this machine. Restart this MCP client to load it.'
          : `Bridge is offline: port ${this.#options.port} is unavailable`,
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
    if (this.#mode === 'outdated') return;

    const hub: Hub = new Hub(this.#options, () => void this.#yieldTo(hub));
    try {
      await hub.listen();
      logger.info(`Listening for the extension on port ${port}`);
      await this.#adopt(hub, 'hub');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        this.#warnOnce(`Cannot listen on port ${port}: ${(error as Error).message}`);
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
      this.#warnOnce(`Port ${port} is busy: ${(error as Error).message}`);
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
    this.#lastWarning = '';
  }

  async #yieldTo(hub: Hub): Promise<void> {
    if (this.#link !== hub) return;
    this.#link = null;
    this.#mode = 'outdated';
    this.#options.logger.warn(
      'A newer itsme server started; this one let go of the port. Restart this MCP client.',
    );
    await hub.close();
  }

  /** The retry loop hits the same problem every two seconds; say it once. */
  #warnOnce(message: string): void {
    if (message === this.#lastWarning) return;
    this.#lastWarning = message;
    this.#options.logger.warn(message);
  }

  #retryLater(): void {
    if (this.#stopped || this.#mode === 'outdated') return;
    this.#retry = setTimeout(() => void this.#establish(), RETRY_DELAY_MS);
    this.#retry.unref();
  }
}
