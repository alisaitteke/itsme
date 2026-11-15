import { browser } from 'wxt/browser';
import { STATUS_REQUEST, type StatusResponse } from '../shared/runtime-messages.ts';

const POLL_MS = 1_000;

function describe(status: StatusResponse): { state: string; text: string } {
  if (!status) return { state: 'off', text: 'Switched off' };
  if (status.state === 'connected') {
    return { state: 'connected', text: `Connected to server ${status.serverVersion ?? ''}` };
  }
  if (status.state === 'connecting') return { state: 'connecting', text: 'Connecting…' };
  return { state: 'disconnected', text: status.lastError ?? 'Not connected' };
}

/** Keeps a status dot and line up to date; returns a function that refreshes them now. */
export function watchStatus(dot: HTMLElement, line: HTMLElement): () => Promise<void> {
  const refresh = async () => {
    let status: StatusResponse = null;
    try {
      status = await browser.runtime.sendMessage(STATUS_REQUEST);
    } catch {
      // The background is restarting; the next poll will reach it.
      return;
    }
    const { state, text } = describe(status);
    dot.dataset.state = state;
    line.textContent = text;
  };
  void refresh();
  setInterval(() => void refresh(), POLL_MS);
  return refresh;
}

export function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
