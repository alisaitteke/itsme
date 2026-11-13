import { BRIDGE_HOST, type BrowserInfo, EXTENSION_PATH } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { isStatusRequest, type StatusResponse } from '../shared/runtime-messages.ts';
import { loadSettings, onSettingsChanged } from '../shared/settings.ts';
import { BridgeConnection } from './connection.ts';
import { handlers } from './handlers/index.ts';
import { detachDebugger, setupInput } from './input/index.ts';
import { createRouter } from './router.ts';

const RECONNECT_ALARM = 'itsme/reconnect';

const router = createRouter(handlers);
let connection: BridgeConnection | null = null;
/** Port and token of the live connection; empty while switched off. */
let endpoint = '';

function describeBrowser(): BrowserInfo {
  const version = /(?:Chrome|Firefox|Version)\/([\d.]+)/.exec(navigator.userAgent)?.[1];
  return {
    name: import.meta.env.BROWSER,
    version: version ?? 'unknown',
    extensionVersion: browser.runtime.getManifest().version,
    commands: router.commands,
  };
}

async function configure(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.realInput) detachDebugger();

  // A change that doesn't concern the socket must not drop a live connection.
  const wanted = settings.enabled ? `${settings.port}\n${settings.token}` : '';
  if (wanted === endpoint) return;
  endpoint = wanted;
  connection?.stop();
  connection = null;
  if (!settings.enabled) return;

  connection = new BridgeConnection({
    url: `ws://${BRIDGE_HOST}:${settings.port}${EXTENSION_PATH}`,
    token: settings.token || undefined,
    browser: describeBrowser(),
    onRequest: router.dispatch,
    // No server, no reason to keep the debugger's warning bar on screen.
    onDisconnect: detachDebugger,
  });
  connection.start();
}

/** Runs each time the background wakes up; all listeners must be added synchronously. */
export function startBackground(): void {
  setupInput();
  let configured = configure();

  // Having these listeners is what makes the browser start the background at launch.
  browser.runtime.onStartup.addListener(() => {});
  browser.runtime.onInstalled.addListener(() => {});

  // While the server is down nothing keeps the background alive, so the in-memory
  // backoff dies with it. The alarm wakes it up to try again.
  browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) void configured.then(() => connection?.start());
  });

  onSettingsChanged(() => {
    configured = configured.then(configure, configure);
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isStatusRequest(message)) return;
    const reply = () => sendResponse((connection?.status ?? null) satisfies StatusResponse);
    configured.then(reply, reply);
    return true;
  });
}
