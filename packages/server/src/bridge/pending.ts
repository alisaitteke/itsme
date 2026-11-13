import { BridgeError, type ResponseMessage } from '@itsme/protocol';

interface Entry {
  resolve(result: unknown): void;
  reject(error: BridgeError): void;
  timer: NodeJS.Timeout;
}

/** In-flight requests on one socket, matched to responses by id. */
export class PendingRequests {
  #nextId = 0;
  readonly #entries = new Map<string, Entry>();

  create(timeoutMs: number, label: string): { id: string; promise: Promise<unknown> } {
    const id = String(++this.#nextId);
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#entries.delete(id);
        reject(new BridgeError('TIMEOUT', `${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#entries.set(id, { resolve, reject, timer });
    });
    return { id, promise };
  }

  settle(response: ResponseMessage): void {
    const entry = this.#entries.get(response.id);
    // A late reply to a request that already timed out lands here.
    if (!entry) return;
    this.#entries.delete(response.id);
    clearTimeout(entry.timer);
    if (response.error) entry.reject(BridgeError.from(response.error));
    else entry.resolve(response.result);
  }

  rejectAll(error: BridgeError): void {
    for (const entry of this.#entries.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#entries.clear();
  }
}
