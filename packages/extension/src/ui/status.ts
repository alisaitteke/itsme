import { browser } from 'wxt/browser';
import { STATUS_REQUEST, type StatusResponse } from '../shared/runtime-messages.ts';
import { describeStatus, type StatusView } from '../shared/status-view.ts';

const POLL_MS = 1_000;

/** Keeps the page told about the connection; returns a function that checks again now. */
export function watchStatus(onChange: (view: StatusView) => void): () => Promise<void> {
  const refresh = async () => {
    let status: StatusResponse = null;
    try {
      status = await browser.runtime.sendMessage(STATUS_REQUEST);
    } catch {
      // The background is restarting; the next poll will reach it.
      return;
    }
    onChange(describeStatus(status));
  };
  void refresh();
  setInterval(() => void refresh(), POLL_MS);
  return refresh;
}

/** Shows a status in a pill: a colored dot and the label next to it. */
export function showInPill(pill: HTMLElement, view: StatusView): void {
  pill.dataset.state = view.state;
  pill.textContent = view.label;
  pill.title = view.help;
}
