// Drives the built extension in a real Chromium through the built MCP server.
// Needs a Chromium that still accepts --load-extension (Chrome for Testing, not Google Chrome):
//   CHROME_PATH=/path/to/chromium pnpm test:e2e

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = resolve(import.meta.dirname, '../..');
const serverEntry = join(root, 'packages/server/dist/cli.mjs');
const extensionDir = join(root, 'packages/extension/.output/chrome-mv3');
const chromePath = process.env.CHROME_PATH;

if (!chromePath) throw new Error('Set CHROME_PATH to a Chrome for Testing or Chromium binary');
for (const path of [serverEntry, extensionDir]) {
  if (!existsSync(path)) throw new Error(`${path} is missing; run pnpm build first`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const pageHtml = `<!doctype html><title>E2E page</title>
<h1>Greeter</h1>
<form onsubmit="event.preventDefault(); out.textContent = 'Hello, ' + who.value + '!'">
  <label>Your name
    <input id="who" oninput="typed.textContent = 'input trusted: ' + event.isTrusted">
  </label>
  <input type="password" value="hunter2" aria-label="Secret">
  <button type="submit" onclick="clicked.textContent = 'click trusted: ' + event.isTrusted">
    Greet
  </button>
</form>
<p id="out">Nothing yet</p>
<p id="clicked"></p>
<p id="typed"></p>
<a href="/second">Second page</a>`;

const site = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(req.url === '/second' ? '<title>Second</title><p>Second page body</p>' : pageHtml);
});
await new Promise((done) => site.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${site.address().port}`;

async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}
const debugPort = await freePort();
// Not the default port: a browser the developer uses may be connected there, and
// this script must never drive it.
const bridgePort = await freePort();

async function evaluate(target, expression) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error('Cannot reach the service worker'));
  });
  // Protocol events arrive on the same socket; only the message with our id is the answer.
  const reply = new Promise((done) => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) done(message);
    };
  });
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  );
  const { result } = await reply;
  socket.close();
  if (!result || result.exceptionDetails) {
    throw new Error(`Evaluation failed: ${result?.exceptionDetails?.exception?.description}`);
  }
  return result.result.value;
}

// Chromium ships extensions of its own, so pick the worker by the manifest name.
async function findServiceWorker() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      for (const target of targets) {
        if (target.type !== 'service_worker') continue;
        const name = await evaluate(target, 'chrome.runtime.getManifest().name').catch(() => '');
        if (name === 'itsme') return target;
      }
    } catch {
      // The browser isn't listening yet.
    }
    await sleep(100);
  }
  throw new Error('Extension service worker not found');
}

// The popup is the only UI for settings, so change them from inside the service worker.
async function updateSettings(patch) {
  const expression = `chrome.storage.local.get('settings').then(({ settings }) =>
    chrome.storage.local.set({ settings: { ...settings, ...${JSON.stringify(patch)} } }))`;
  await evaluate(await findServiceWorker(), expression);
}

async function startServer() {
  const client = new Client({ name: 'e2e', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry, '--port', String(bridgePort)],
      env: { ...process.env, ITSME_LOG_LEVEL: 'warn' },
      stderr: 'inherit',
    }),
  );
  return client;
}

let client = await startServer();

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content;
  return {
    isError: Boolean(result.isError),
    text: first.type === 'text' ? first.text : '',
    image: first.type === 'image' ? first : undefined,
  };
}
const json = async (name, args) => JSON.parse((await call(name, args)).text);

async function waitForBrowser(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await json('browser_status');
    if (status.browsers.length > 0) return status.browsers[0];
    await sleep(500);
  }
  return null;
}

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
}

const profileDir = mkdtempSync(join(tmpdir(), 'itsme-e2e-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=900,700',
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  await updateSettings({ port: bridgePort });
  const browser = await waitForBrowser(20_000);
  check('extension connects', browser !== null, browser && `${browser.name} ${browser.version}`);
  if (!browser) throw new Error('The extension never connected');

  const { tab } = await json('tabs_open', { url: `${base}/` });
  check('tabs_open waits for the load', tab.title === 'E2E page');
  const { tabs } = await json('tabs_list');
  check(
    'tabs_list has the new tab',
    tabs.some((candidate) => candidate.id === tab.id),
  );

  const snapshot = (await call('page_snapshot', { tabId: tab.id })).text;
  const refOf = (pattern) => pattern.exec(snapshot)?.[1];
  const nameRef = refOf(/\[(e\d+)\] textbox "Your name"/);
  const greetRef = refOf(/\[(e\d+)\] button "Greet"/);
  const linkRef = refOf(/\[(e\d+)\] link "Second page"/);
  check('page_snapshot lists the controls', Boolean(nameRef && greetRef && linkRef));
  check('page_snapshot leaves out the password', !snapshot.includes('hunter2'));

  const snapshotText = async () => (await call('page_snapshot', { tabId: tab.id })).text;

  await call('page_type', { tabId: tab.id, ref: nameRef, text: 'Ada' });
  await call('page_click', { tabId: tab.id, ref: greetRef });
  let text = await snapshotText();
  check('page_type and page_click act on the page', text.includes('Hello, Ada!'));
  check('debugger input is trusted', /click trusted: true[\s\S]*input trusted: true/.test(text));

  await call('page_type', { tabId: tab.id, ref: nameRef, text: 'Grace', submit: true });
  check('page_type submits the form', (await snapshotText()).includes('Hello, Grace!'));
  await call('page_type', { tabId: tab.id, ref: nameRef, text: ' Hopper', clear: false });
  await call('page_click', { tabId: tab.id, ref: greetRef });
  check(
    'page_type appends when clear is off',
    (await snapshotText()).includes('Hello, Grace Hopper!'),
  );

  await updateSettings({ realInput: false });
  await call('page_type', { tabId: tab.id, ref: nameRef, text: 'Linus' });
  await call('page_click', { tabId: tab.id, ref: greetRef });
  text = await snapshotText();
  check('DOM input still works with real input off', text.includes('Hello, Linus!'));
  check('DOM input is untrusted', /click trusted: false[\s\S]*input trusted: false/.test(text));
  await call('page_type', { tabId: tab.id, ref: nameRef, text: 'Grace', submit: true });
  check('DOM input submits the form', (await snapshotText()).includes('Hello, Grace!'));

  const shot = await call('page_screenshot', { tabId: tab.id });
  check('page_screenshot returns a PNG', shot.image?.data.startsWith('iVBOR') ?? false, shot.text);

  await call('page_click', { tabId: tab.id, ref: linkRef });
  await sleep(700);
  check(
    'agent is injected again after a navigation',
    (await call('page_snapshot', { tabId: tab.id })).text.includes('Second page body'),
  );
  const stale = await call('page_click', { tabId: tab.id, ref: greetRef });
  check('a ref from the old page is refused', stale.text.startsWith('ELEMENT_NOT_FOUND'));

  const back = await call('page_history', { tabId: tab.id, direction: 'back' });
  check('page_history goes back', back.text.includes('"E2E page"'), back.isError ? back.text : '');
  const forward = await call('page_history', { tabId: tab.id, direction: 'forward' });
  check('page_history goes forward', forward.text.includes('"Second"'));
  const navigated = await call('page_navigate', { tabId: tab.id, url: `${base}/` });
  check('page_navigate loads a URL', navigated.text.includes('"E2E page"'));

  const blank = (await json('tabs_list')).tabs.find((other) => other.url === 'about:blank');
  if (blank) {
    const refused = await call('page_snapshot', { tabId: blank.id });
    check('an unscriptable page is reported', refused.text.startsWith('PAGE_NOT_ACCESSIBLE'));
  }

  await call('tabs_close', { tabId: tab.id });
  const gone = await call('tabs_close', { tabId: tab.id });
  check('tabs_close closes the tab', gone.text.startsWith('TAB_NOT_FOUND'));

  // With the server gone nothing keeps the service worker alive past 30s, so only
  // the alarm can bring the connection back.
  console.log('Stopping the server for 45s to let the service worker go idle...');
  await client.close();
  await sleep(45_000);
  client = await startServer();
  const again = await waitForBrowser(45_000);
  check('extension reconnects after the worker was idle', again !== null);
  if (again) {
    check('commands work after reconnecting', Array.isArray((await json('tabs_list')).tabs));
  }
} finally {
  chrome.kill();
  await client.close();
  site.close();
  await sleep(300);
  rmSync(profileDir, { recursive: true, force: true });
}

process.exit(failures > 0 ? 1 : 0);
