import { BridgeError } from '@itsme/protocol';

const CDP_VERSION = '1.3';
const COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_MS = 120_000;

interface Debuggee {
  tabId?: number;
}

/** The part of chrome.debugger this module uses. */
export interface DebuggerApi {
  attach(target: Debuggee, version: string): Promise<void>;
  detach(target: Debuggee): Promise<void>;
  sendCommand(target: Debuggee, method: string, params?: object): Promise<unknown>;
  onDetach: { addListener(listener: (source: Debuggee, reason: string) => void): void };
  onEvent: {
    addListener(listener: (source: Debuggee, method: string, params?: object) => void): void;
  };
}

export interface SessionsOptions {
  /** The user pressed Cancel on the browser's "is debugging this browser" bar. */
  onUserCancel(): void;
  idleMs?: number;
}

export type EventListener = (tabId: number, method: string, params: object) => void;

/**
 * Attaches the debugger to tabs on demand and lets go of them when nothing has used
 * them for a while, since the browser shows a warning bar for as long as one is attached.
 */
export class DebuggerSessions {
  readonly #api: DebuggerApi;
  readonly #defaultIdleMs: number;
  readonly #attached = new Map<number, Promise<void>>();
  readonly #eventListeners: EventListener[] = [];
  readonly #detachListeners: Array<(tabId: number) => void> = [];
  #idleMs: number;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(api: DebuggerApi, options: SessionsOptions) {
    this.#api = api;
    this.#defaultIdleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.#idleMs = this.#defaultIdleMs;

    api.onDetach.addListener((source, reason) => {
      if (source.tabId !== undefined) this.#forget(source.tabId);
      if (reason === 'canceled_by_user') options.onUserCancel();
    });
    api.onEvent.addListener((source, method, params) => {
      if (source.tabId === undefined) return;
      for (const listener of this.#eventListeners) listener(source.tabId, method, params ?? {});
    });
  }

  onEvent(listener: EventListener): void {
    this.#eventListeners.push(listener);
  }

  /** Called whenever a tab stops being attached, whatever the reason. */
  onDetached(listener: (tabId: number) => void): void {
    this.#detachListeners.push(listener);
  }

  /** Rejects when the tab can't be debugged, e.g. a browser page or one another debugger holds. */
  attach(tabId: number): Promise<void> {
    this.#touch();
    let attaching = this.#attached.get(tabId);
    if (!attaching) {
      attaching = this.#attach(tabId);
      this.#attached.set(tabId, attaching);
      attaching.catch(() => this.#attached.delete(tabId));
    }
    return attaching;
  }

  async send(tabId: number, method: string, params?: object): Promise<unknown> {
    this.#touch();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new BridgeError('TIMEOUT', `${method} got no answer from the tab`)),
        COMMAND_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([this.#api.sendCommand({ tabId }, method, params), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Stays attached longer between uses, for work that is only useful while attached. */
  extendIdle(idleMs: number): void {
    this.#idleMs = Math.max(this.#idleMs, idleMs);
    this.#touch();
  }

  async detachAll(): Promise<void> {
    clearTimeout(this.#idleTimer);
    this.#idleMs = this.#defaultIdleMs;
    const tabIds = [...this.#attached.keys()];
    for (const tabId of tabIds) this.#forget(tabId);
    await Promise.allSettled(tabIds.map((tabId) => this.#api.detach({ tabId })));
  }

  async #attach(tabId: number): Promise<void> {
    await this.#api.attach({ tabId }, CDP_VERSION);
    // Without this a tab in an unfocused window ignores focus changes and typed text.
    await this.#api
      .sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true })
      .catch(() => {});
  }

  #forget(tabId: number): void {
    if (!this.#attached.delete(tabId)) return;
    for (const listener of this.#detachListeners) listener(tabId);
  }

  #touch(): void {
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => void this.detachAll(), this.#idleMs);
  }
}
