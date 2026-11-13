import { browser } from 'wxt/browser';
import { STATUS_REQUEST, type StatusResponse } from '../../shared/runtime-messages.ts';
import { loadSettings, saveSettings } from '../../shared/settings.ts';

const STATUS_POLL_MS = 1_000;

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const dot = byId('dot');
const statusText = byId('status');
const form = byId<HTMLFormElement>('settings');
const enabled = byId<HTMLInputElement>('enabled');
const port = byId<HTMLInputElement>('port');
const token = byId<HTMLInputElement>('token');
const realInput = byId<HTMLInputElement>('real-input');

function describe(status: StatusResponse): { state: string; text: string } {
  if (!status) return { state: 'off', text: 'Switched off' };
  if (status.state === 'connected') {
    return { state: 'connected', text: `Connected to server ${status.serverVersion ?? ''}` };
  }
  if (status.state === 'connecting') return { state: 'connecting', text: 'Connecting…' };
  return { state: 'disconnected', text: status.lastError ?? 'Not connected' };
}

async function refreshStatus(): Promise<void> {
  let status: StatusResponse = null;
  try {
    status = await browser.runtime.sendMessage(STATUS_REQUEST);
  } catch {
    // The background is restarting; the next poll will reach it.
    return;
  }
  const { state, text } = describe(status);
  dot.dataset.state = state;
  statusText.textContent = text;
}

async function save(): Promise<void> {
  await saveSettings({
    enabled: enabled.checked,
    port: port.valueAsNumber,
    token: token.value,
    realInput: realInput.checked,
  });
  await refreshStatus();
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  enabled.checked = settings.enabled;
  port.value = String(settings.port);
  token.value = settings.token;
  realInput.checked = settings.realInput;
  // Only Chromium has the debugger API behind this option.
  byId('real-input-row').hidden = !('debugger' in browser);

  enabled.addEventListener('change', () => void save());
  realInput.addEventListener('change', () => void save());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });

  await refreshStatus();
  setInterval(() => void refreshStatus(), STATUS_POLL_MS);
}

void init();
