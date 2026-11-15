import { BRIDGE_HOST, type BrowserInfo, EXTENSION_PATH } from '@itsme/protocol';
import { browser } from 'wxt/browser';
import { type AutomationActionResult, isAutomationAction } from '../shared/automations.ts';
import { saveLaunch } from '../shared/launch.ts';
import { pageUrlOf } from '../shared/reader.ts';
import {
  isFontRequest,
  isSiteDecision,
  isStatusRequest,
  isStopRequest,
  type StatusResponse,
} from '../shared/runtime-messages.ts';
import { loadSettings, onSettingsChanged, saveSettings } from '../shared/settings.ts';
import { hostOf } from '../shared/sites.ts';
import { performAction, startAutomations, stopAutomationOfTab } from './automations/scheduler.ts';
import { BRAND_FONT_FILES } from './brand-font.ts';
import { BridgeConnection } from './connection.ts';
import { detachDebugger, setupDebugger } from './debugger/index.ts';
import { handlers } from './handlers/index.ts';
import { createRouter } from './router.ts';
import { recordDecision } from './site-access.ts';

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
    onWelcome: ({ launch }) => {
      if (launch) void saveLaunch(launch);
    },
  });
  connection.start();
}

/** Runs each time the background wakes up; all listeners must be added synchronously. */
export function startBackground(): void {
  setupDebugger();
  startAutomations();
  let configured = configure();

  // Having these listeners is what makes the browser start the background at launch.
  browser.runtime.onStartup.addListener(() => {});
  browser.runtime.onInstalled.addListener(({ reason }) => {
    // A new user has an extension and nothing to connect it to: show them the one step left.
    if (reason === 'install')
      void browser.tabs.create({ url: browser.runtime.getURL('/setup.html') });
  });

  // While the server is down nothing keeps the background alive, so the in-memory
  // backoff dies with it. The alarm wakes it up to try again.
  browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) void configured.then(() => connection?.start());
  });

  onSettingsChanged(() => {
    configured = configured.then(configure, configure);
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isSiteDecision(message)) {
      // The site is whatever page the answer came from, never something the message
      // claims. For a PDF in the reader, that is the site the PDF came from.
      const host = sender.frameId === 0 ? hostOf(pageUrlOf(sender.tab?.url ?? '')) : null;
      if (host) void recordDecision(host, message.allow);
      return;
    }
    if (isFontRequest(message)) {
      sendResponse(BRAND_FONT_FILES);
      return;
    }
    if (isStopRequest(message)) {
      // On an automation's tab, Stop pauses that automation. Anywhere else it switches
      // the bridge off until the user turns it back on in the popup.
      const tabId = sender.tab?.id;
      void (tabId === undefined ? Promise.resolve(false) : stopAutomationOfTab(tabId)).then(
        (wasAutomation) => {
          if (!wasAutomation) void saveSettings({ enabled: false });
        },
      );
      return;
    }
    if (isAutomationAction(message)) {
      // Approving is the user's alone: only the extension's own pages may ask for it,
      // never a script in a web page.
      if (!sender.url?.startsWith(browser.runtime.getURL(''))) return;
      const done = (result: AutomationActionResult) => sendResponse(result);
      performAction(message).then(
        () => done({ ok: true }),
        (error) =>
          done({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      return true;
    }
    if (!isStatusRequest(message)) return;
    const reply = () => sendResponse((connection?.status ?? null) satisfies StatusResponse);
    configured.then(reply, reply);
    return true;
  });
}
