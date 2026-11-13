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
<nav><a href="/second">Second page</a></nav>
<form onsubmit="event.preventDefault(); out.textContent = 'Hello, ' + who.value + '!'">
  <label>Your name
    <input id="who" oninput="typed.textContent = 'input trusted: ' + event.isTrusted">
  </label>
  <input type="password" value="hunter2" aria-label="Secret">
  <select aria-label="Colour"><option>Red</option><option>Blue</option></select>
  <button type="submit" onclick="clicked.textContent = 'click trusted: ' + event.isTrusted">
    Greet
  </button>
</form>
<p id="out">Nothing yet</p>
<p id="clicked"></p>
<p id="typed"></p>
<ul><li>First <b>bold</b> item</li><li>Second item</li></ul>
<button ondblclick="log.textContent = 'double clicked'"
  oncontextmenu="event.preventDefault(); log.textContent = 'context menu'">Multi</button>
<button onmouseover="log.textContent = 'hovered'">Hover target</button>
<p id="log">no pointer event</p>
<input aria-label="Keys"
  onkeydown="keylog.textContent = 'key: ' + (event.metaKey ? 'meta+' : '') + event.key">
<p id="keylog"></p>
<div style="position:relative; width:300px; height:30px; background:#ddd">
  <div id="knob" role="slider" aria-label="Knob"
    style="position:absolute; left:0; width:30px; height:30px; background:#333"></div>
</div>
<p id="dragged">not dragged</p>
<button style="position:fixed; right:0; bottom:0; width:100px; height:40px"
  onclick="this.textContent = 'Corner clicked'">Corner</button>
<iframe src="/frame" title="Inner frame" style="width:300px; height:60px"></iframe>
<div style="height:3000px"></div>
<p>Bottom text</p>
<script>
  let startX = null;
  knob.addEventListener('mousedown', (event) => { startX = event.clientX; });
  addEventListener('mouseup', (event) => {
    if (startX === null) return;
    dragged.textContent = 'dragged ' + Math.round(event.clientX - startX);
    startX = null;
  });
  const host = document.createElement('div');
  document.querySelector('iframe').before(host);
  host.attachShadow({ mode: 'open' }).innerHTML =
    '<button onclick="this.textContent = \\'Shadow clicked\\'">Shadow button</button>';
</script>`;

const pages = {
  '/second': '<title>Second</title><p>Second page body</p>',
  '/frame': `<button onclick="this.textContent = 'Frame clicked'">Frame button</button>`,
};

const site = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(pages[req.url] ?? pageHtml);
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

/** Runs an expression inside the extension, where the chrome.* APIs are. */
const inExtension = async (expression) => evaluate(await findServiceWorker(), expression);

// The popup is the only UI for settings, so change them from inside the service worker.
const updateSettings = (patch) =>
  inExtension(`chrome.storage.local.get('settings').then(({ settings }) =>
    chrome.storage.local.set({ settings: { ...settings, ...${JSON.stringify(patch)} } }))`);

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
  return {
    isError: Boolean(result.isError),
    text: result.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n'),
    image: result.content.find((part) => part.type === 'image'),
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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? `\n     ${detail}` : ''}`);
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
    // Screenshots come out at 2x, as on a high-density display.
    '--force-device-scale-factor=2',
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  await updateSettings({ port: bridgePort });
  const browser = await waitForBrowser(20_000);
  check('extension connects', browser !== null);
  if (!browser) throw new Error('The extension never connected');

  // --- tabs and the itsme group ---
  const { tab } = await json('tabs_open', { url: `${base}/` });
  check('tabs_open waits for the load', tab.title === 'E2E page');
  const { tabs } = await json('tabs_list');
  check('tabs_list shows only itsme tabs', tabs.length === 1 && tabs[0].id === tab.id);
  const groups = await inExtension(`chrome.tabGroups.query({ title: 'itsme' })`);
  check('the tab is in an "itsme" tab group', groups.length === 1);

  const blankId = await inExtension(
    `chrome.tabs.query({}).then((all) => all.find((t) => t.url === 'about:blank').id)`,
  );
  const unshared = await call('page_snapshot', { tabId: blankId });
  check('a tab outside the group is refused', unshared.text.startsWith('TAB_NOT_SHARED'));

  const on = (name, args = {}) => call(name, { tabId: tab.id, ...args });
  const outline = async (args) => (await on('page_snapshot', args)).text;
  const refIn = (text, pattern) => pattern.exec(text)?.[1];

  // --- reading ---
  let text = await outline();
  const nameRef = refIn(text, /\[(e\d+)\] textbox "Your name"/);
  const greetRef = refIn(text, /\[(e\d+)\] button "Greet"/);
  const linkRef = refIn(text, /\[(e\d+)\] link "Second page"/);
  const formRef = refIn(text, /\[(e\d+)\] form/);
  check('snapshot lists the controls', Boolean(nameRef && greetRef && linkRef), text);
  check('snapshot leaves out the password', !text.includes('hunter2'));
  check('snapshot shows structure', /\[e\d+\] heading "Greeter" level=1/.test(text), text);
  check('snapshot nests list items', /\[e\d+\] list ""\n {2}\[e\d+\] listitem/.test(text), text);
  check('snapshot joins inline text', text.includes('text "First bold item"'), text);
  check(
    'snapshot lists select options',
    /combobox "Colour" value="Red" options=\["Red","Blue"\]/.test(text),
    text,
  );
  check('snapshot reads open shadow DOM', text.includes('button "Shadow button"'), text);
  check('snapshot reads a same-origin iframe', text.includes('button "Frame button"'), text);

  text = await outline({ filter: 'interactive' });
  check(
    'interactive filter drops structure and text',
    text.includes('button "Greet"') && !text.includes('heading') && !text.includes('text "'),
    text,
  );
  text = await outline({ ref: formRef });
  check(
    'snapshot of a ref reads only that part',
    text.includes('button "Greet"') && !text.includes('Second page'),
    text,
  );
  text = await outline({ maxChars: 500 });
  check('snapshot truncates at maxChars', text.includes('Truncated.') && text.length < 800);

  let found = await on('page_find', { query: 'greet' });
  check(
    'page_find matches names',
    found.text.includes('button "Greet"') && found.text.includes('heading "Greeter"'),
    found.text,
  );
  found = await on('page_find', { query: 'bottom text' });
  check('page_find matches plain text', /\[e\d+\] text "Bottom text"/.test(found.text), found.text);
  check(
    'page_find reports no match',
    (await on('page_find', { query: 'zzzz' })).text === 'No match',
  );
  check('page_text reads the page', (await on('page_text')).text.includes('Bottom text'));

  // --- real input ---
  await on('page_type', { ref: nameRef, text: 'Ada' });
  await on('page_click', { ref: greetRef });
  text = await outline();
  check('page_type and page_click act on the page', text.includes('Hello, Ada!'), text);
  check('real input is trusted', /click trusted: true[\s\S]*input trusted: true/.test(text));

  await on('page_type', { ref: nameRef, text: 'Grace', submit: true });
  check('page_type submits the form', (await outline()).includes('Hello, Grace!'));
  await on('page_type', { ref: nameRef, text: ' Hopper', clear: false });
  await on('page_click', { ref: greetRef });
  check('page_type appends when clear is off', (await outline()).includes('Hello, Grace Hopper!'));

  const colourRef = refIn(text, /\[(e\d+)\] combobox "Colour"/);
  await on('page_type', { ref: colourRef, text: 'Blue' });
  check(
    'page_type picks a select option',
    (await outline()).includes('combobox "Colour" value="Blue"'),
  );

  const multiRef = refIn(text, /\[(e\d+)\] button "Multi"/);
  await on('page_click', { ref: multiRef, count: 2 });
  check('double click', (await outline()).includes('text "double clicked"'));
  await on('page_click', { ref: multiRef, button: 'right' });
  check('right click', (await outline()).includes('text "context menu"'));
  await on('page_hover', { ref: refIn(text, /\[(e\d+)\] button "Hover target"/) });
  check('page_hover', (await outline()).includes('text "hovered"'));

  const keysRef = refIn(text, /\[(e\d+)\] textbox "Keys"/);
  await on('page_click', { ref: keysRef });
  await on('page_type', { text: 'abc' });
  check(
    'page_type goes to the focused field without a ref',
    (await outline()).includes('textbox "Keys" value="abc"'),
  );
  await on('page_press', { key: 'Backspace' });
  text = await outline();
  check(
    'page_press edits with Backspace',
    text.includes('textbox "Keys" value="ab"'),
    text.match(/textbox "Keys".*/)?.[0],
  );
  await on('page_press', { key: 'a', modifiers: ['meta'] });
  text = await outline();
  check(
    'page_press sends a shortcut',
    text.includes('text "key: meta+a"'),
    text.match(/key: .*/)?.[0],
  );
  check(
    'a shortcut is not typed',
    text.includes('textbox "Keys" value="ab"'),
    text.match(/textbox "Keys".*/)?.[0],
  );
  const unknownKey = await on('page_press', { key: 'Entr' });
  check('an unknown key is refused', unknownKey.text.startsWith('INVALID_PARAMS'), unknownKey.text);

  const knobRef = refIn(text, /\[(e\d+)\] slider "Knob"/);
  const drag = await on('page_drag', { from: { ref: knobRef }, to: { ref: multiRef } });
  text = await outline();
  check(
    'page_drag moves with the button held',
    /text "dragged -?[1-9]\d*"/.test(text),
    drag.text + text.match(/dragged.*/)?.[0],
  );

  await on('page_click', { ref: refIn(text, /\[(e\d+)\] button "Shadow button"/) });
  await on('page_click', { ref: refIn(text, /\[(e\d+)\] button "Frame button"/) });
  text = await outline();
  check('click inside open shadow DOM', text.includes('button "Shadow clicked"'), text);
  check('click inside a same-origin iframe', text.includes('button "Frame clicked"'), text);

  // --- screenshot and coordinates ---
  const shot = await on('page_screenshot');
  const [, width, height] = /Viewport (\d+)x(\d+)/.exec(shot.text) ?? [];
  const png = Buffer.from(shot.image?.data ?? '', 'base64');
  check('page_screenshot returns a PNG', png.subarray(1, 4).toString() === 'PNG', shot.text);
  check(
    'the screenshot is scaled to viewport pixels',
    png.readUInt32BE(16) === Number(width) && Number(width) <= 900,
    `image ${png.readUInt32BE(16)} wide, viewport ${width}`,
  );
  await on('page_click', { x: Number(width) - 50, y: Number(height) - 20 });
  check('click by coordinates', (await outline()).includes('button "Corner clicked"'));
  const both = await on('page_click', { ref: greetRef, x: 1, y: 1 });
  check(
    'ref and coordinates together are refused',
    both.text.startsWith('INVALID_PARAMS'),
    both.text,
  );

  // --- scrolling ---
  let scrolled = await json('page_scroll', { tabId: tab.id, direction: 'down', amount: 10_000 });
  check('page_scroll moves the page', scrolled.moved === true);
  scrolled = await json('page_scroll', { tabId: tab.id, direction: 'down', amount: 10_000 });
  check('page_scroll reports the end', scrolled.moved === false);

  // --- scripted input ---
  await updateSettings({ realInput: false });
  await on('page_type', { ref: nameRef, text: 'Linus' });
  await on('page_click', { ref: greetRef });
  text = await outline();
  check('scripted input works with real input off', text.includes('Hello, Linus!'), text);
  check(
    'scripted input is untrusted',
    /click trusted: false[\s\S]*input trusted: false/.test(text),
  );
  await on('page_type', { ref: nameRef, text: 'Grace', submit: true });
  check('scripted input submits the form', (await outline()).includes('Hello, Grace!'));
  await on('page_click', { ref: multiRef, count: 2 });
  check('scripted double click', (await outline()).includes('text "double clicked"'));
  const noDrag = await on('page_drag', { from: { ref: knobRef }, to: { ref: multiRef } });
  check('page_drag needs real input', noDrag.text.startsWith('UNSUPPORTED'), noDrag.text);
  await updateSettings({ realInput: true });

  // --- navigation ---
  await on('page_click', { ref: linkRef });
  await sleep(700);
  check(
    'agent is injected again after a navigation',
    (await outline()).includes('Second page body'),
  );
  const stale = await on('page_click', { ref: greetRef });
  check(
    'a ref from the old page is refused',
    stale.text.startsWith('ELEMENT_NOT_FOUND'),
    stale.text,
  );
  const back = await on('page_history', { direction: 'back' });
  check('page_history goes back', back.text.includes('"E2E page"'), back.text);
  const forward = await on('page_history', { direction: 'forward' });
  check('page_history goes forward', forward.text.includes('"Second"'), forward.text);
  const navigated = await on('page_navigate', { url: `${base}/` });
  check('page_navigate loads a URL', navigated.text.includes('"E2E page"'), navigated.text);

  // --- sharing and closing ---
  await inExtension(`chrome.tabGroups.query({ title: 'itsme' }).then(([group]) =>
    chrome.tabs.group({ tabIds: [${blankId}], groupId: group.id }))`);
  const refused = await call('page_snapshot', { tabId: blankId });
  check(
    'a shared but unscriptable page is reported',
    refused.text.startsWith('PAGE_NOT_ACCESSIBLE'),
    refused.text,
  );
  await call('tabs_close', { tabId: blankId });

  await call('tabs_close', { tabId: tab.id });
  const gone = await call('tabs_close', { tabId: tab.id });
  check('tabs_close closes the tab', gone.text.startsWith('TAB_NOT_FOUND'), gone.text);
  const none = await call('page_snapshot');
  check('with no itsme tab, page tools say so', none.text.startsWith('TAB_NOT_FOUND'), none.text);
  const fresh = await json('page_navigate', { url: `${base}/second` });
  check('page_navigate opens a tab when none is open', fresh.tab.title === 'Second');

  // With the server gone nothing keeps the service worker alive past 30s, so only
  // the alarm can bring the connection back.
  console.log('Stopping the server for 45s to let the service worker go idle...');
  await client.close();
  await sleep(45_000);
  client = await startServer();
  const again = await waitForBrowser(45_000);
  check('extension reconnects after the worker was idle', again !== null);
  if (again) {
    check('commands work after reconnecting', (await json('tabs_list')).tabs.length === 1);
  }
} finally {
  chrome.kill();
  await client.close();
  site.close();
  await sleep(300);
  rmSync(profileDir, { recursive: true, force: true });
}

process.exit(failures > 0 ? 1 : 0);
