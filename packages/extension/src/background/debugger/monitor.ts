import { BridgeError, type CommandParams, type CommandResult } from '@itsme/protocol';
import type { EventListener } from './sessions.ts';

type ConsoleEntry = CommandResult<'page.console'>['entries'][number];
type NetworkEntry = CommandResult<'page.network'>['requests'][number];

export interface MonitorSessions {
  attach(tabId: number): Promise<void>;
  send(tabId: number, method: string, params?: object): Promise<unknown>;
  extendIdle(idleMs: number): void;
  onEvent(listener: EventListener): void;
  onDetached(listener: (tabId: number) => void): void;
}

const MAX_ENTRIES = 500;
const MAX_TEXT_LENGTH = 2_000;
const MAX_URL_LENGTH = 500;
// A recording is only worth something while it keeps running between looks at it.
const MONITOR_IDLE_MS = 10 * 60_000;
// Enabling the console replays earlier messages; give them a moment to arrive.
const REPLAY_SETTLE_MS = 50;

const SECRET_PARAM = /token|key|secret|passw|auth|sig|session|credential/i;

interface RemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  preview?: { overflow?: boolean; properties?: Array<{ name: string; value?: string }> };
}

interface TabLog {
  console: ConsoleEntry[];
  requests: Map<string, NetworkEntry & { startedAt?: number }>;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatArgument(arg: RemoteObject): string {
  if ('value' in arg) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  const properties = arg.preview?.properties;
  if (!properties) return arg.description ?? arg.type ?? '';
  const more = arg.preview?.overflow ? ', …' : '';
  if (arg.subtype === 'array') return `[${properties.map((p) => p.value).join(', ')}${more}]`;
  return `{${properties.map((p) => `${p.name}: ${p.value}`).join(', ')}${more}}`;
}

/** Hides credentials that travel in a URL; headers and bodies are never recorded. */
export function redactUrl(raw: string): string {
  if (raw.startsWith('data:')) return clip(raw, 60);
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(name)) url.searchParams.set(name, 'REDACTED');
    }
    return clip(url.href, MAX_URL_LENGTH);
  } catch {
    return clip(raw, MAX_URL_LENGTH);
  }
}

function sourceOf(url: unknown, line: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined;
  return typeof line === 'number' ? `${redactUrl(url)}:${line + 1}` : redactUrl(url);
}

function newest<T>(items: T[], limit: number): T[] {
  return items.slice(Math.max(0, items.length - limit));
}

/** Records console output and network requests of tabs through the debugger. */
export class PageMonitor {
  readonly #sessions: MonitorSessions;
  readonly #logs = new Map<number, TabLog>();
  /** When recording began, per tab being recorded. */
  readonly #recording = new Map<number, number>();

  constructor(sessions: MonitorSessions) {
    this.#sessions = sessions;
    sessions.onEvent((tabId, method, params) => this.#record(tabId, method, params));
    // The recording stops with the debugger; what was captured so far stays readable.
    sessions.onDetached((tabId) => this.#recording.delete(tabId));
  }

  async console(
    tabId: number,
    options: Omit<CommandParams<'page.console'>, 'tabId'>,
  ): Promise<CommandResult<'page.console'>> {
    let pattern: RegExp | null = null;
    try {
      if (options.pattern) pattern = new RegExp(options.pattern, 'i');
    } catch {
      throw new BridgeError('INVALID_PARAMS', `Not a valid pattern: ${options.pattern}`);
    }

    await this.#start(tabId);
    const log = this.#log(tabId);
    const matching = log.console.filter(
      (entry) =>
        (!options.onlyErrors || entry.level === 'error') && (!pattern || pattern.test(entry.text)),
    );
    if (options.clear) log.console = [];
    return { entries: newest(matching, options.limit), total: matching.length };
  }

  async network(
    tabId: number,
    options: Omit<CommandParams<'page.network'>, 'tabId'>,
  ): Promise<CommandResult<'page.network'>> {
    const recordingMs = Date.now() - (await this.#start(tabId));
    const log = this.#log(tabId);
    const matching = [...log.requests.values()]
      .filter((request) => !options.urlPattern || request.url.includes(options.urlPattern))
      .map(({ startedAt: _, ...request }) => request);
    if (options.clear) log.requests.clear();
    return { requests: newest(matching, options.limit), total: matching.length, recordingMs };
  }

  /** Drops what was recorded for a tab that no longer exists. */
  forget(tabId: number): void {
    this.#logs.delete(tabId);
    this.#recording.delete(tabId);
  }

  #log(tabId: number): TabLog {
    let log = this.#logs.get(tabId);
    if (!log) {
      log = { console: [], requests: new Map() };
      this.#logs.set(tabId, log);
    }
    return log;
  }

  /** Makes sure the tab is being recorded and returns when that began. */
  async #start(tabId: number): Promise<number> {
    try {
      await this.#sessions.attach(tabId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new BridgeError('PAGE_NOT_ACCESSIBLE', `Cannot attach the debugger: ${detail}`);
    }
    const since = this.#recording.get(tabId);
    if (since !== undefined) return since;

    const startedAt = Date.now();
    this.#recording.set(tabId, startedAt);
    // The replay brings back everything the page logged so far, so start from empty.
    this.#log(tabId).console = [];
    try {
      for (const domain of ['Runtime', 'Log', 'Network']) {
        await this.#sessions.send(tabId, `${domain}.enable`);
      }
    } catch (error) {
      this.#recording.delete(tabId);
      throw error;
    }
    this.#sessions.extendIdle(MONITOR_IDLE_MS);
    await new Promise((resolve) => setTimeout(resolve, REPLAY_SETTLE_MS));
    return startedAt;
  }

  #record(tabId: number, method: string, params: object): void {
    if (!this.#recording.has(tabId)) return;
    const event: unknown = params;
    const log = this.#log(tabId);

    switch (method) {
      case 'Runtime.consoleAPICalled': {
        const { type, args, stackTrace } = event as {
          type: string;
          args: RemoteObject[];
          stackTrace?: { callFrames?: Array<{ url: string; lineNumber: number }> };
        };
        const frame = stackTrace?.callFrames?.[0];
        this.#addConsole(log, {
          level: this.#level(type),
          text: args.map(formatArgument).join(' '),
          source: sourceOf(frame?.url, frame?.lineNumber),
        });
        break;
      }
      case 'Runtime.exceptionThrown': {
        const details = (event as { exceptionDetails: Record<string, unknown> }).exceptionDetails;
        const exception = details.exception as RemoteObject | undefined;
        this.#addConsole(log, {
          level: 'error',
          text: exception?.description ?? String(details.text),
          source: sourceOf(details.url, details.lineNumber),
        });
        break;
      }
      case 'Log.entryAdded': {
        const { entry } = event as { entry: Record<string, unknown> };
        this.#addConsole(log, {
          level: this.#level(String(entry.level)),
          text: String(entry.text),
          source: sourceOf(entry.url, entry.lineNumber),
        });
        break;
      }
      case 'Network.requestWillBeSent': {
        const { requestId, request, type, timestamp } = event as {
          requestId: string;
          request: { url: string; method: string };
          type?: string;
          timestamp: number;
        };
        log.requests.delete(requestId);
        log.requests.set(requestId, {
          method: request.method,
          url: redactUrl(request.url),
          type: (type ?? 'other').toLowerCase(),
          startedAt: timestamp,
        });
        // A Map keeps insertion order, so the first key is the oldest request.
        if (log.requests.size > MAX_ENTRIES) {
          log.requests.delete(log.requests.keys().next().value as string);
        }
        break;
      }
      case 'Network.responseReceived': {
        const { requestId, response } = event as {
          requestId: string;
          response: { status: number };
        };
        const request = log.requests.get(requestId);
        if (request) request.status = response.status;
        break;
      }
      case 'Network.loadingFinished':
      case 'Network.loadingFailed': {
        const { requestId, timestamp, encodedDataLength, errorText } = event as {
          requestId: string;
          timestamp: number;
          encodedDataLength?: number;
          errorText?: string;
        };
        const request = log.requests.get(requestId);
        if (!request) break;
        if (request.startedAt !== undefined) {
          request.durationMs = Math.round((timestamp - request.startedAt) * 1000);
        }
        if (encodedDataLength !== undefined) request.bytes = encodedDataLength;
        if (errorText) request.error = errorText;
        break;
      }
    }
  }

  #level(type: string): ConsoleEntry['level'] {
    if (type === 'error' || type === 'assert') return 'error';
    if (type === 'warning') return 'warning';
    if (type === 'info') return 'info';
    if (type === 'debug' || type === 'verbose') return 'debug';
    return 'log';
  }

  #addConsole(log: TabLog, entry: ConsoleEntry): void {
    log.console.push({ ...entry, text: clip(entry.text, MAX_TEXT_LENGTH) });
    if (log.console.length > MAX_ENTRIES) log.console.shift();
  }
}
