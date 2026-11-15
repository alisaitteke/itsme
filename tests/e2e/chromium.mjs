// Drives the extension in a real Chromium through the built MCP server.
// Needs a Chromium that still accepts --load-extension (Chrome for Testing, not Google Chrome):
//   CHROME_PATH=/path/to/chromium pnpm test:e2e

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = resolve(import.meta.dirname, '../..');
const serverEntry = join(root, 'packages/server/dist/cli.mjs');
const extensionRoot = join(root, 'packages/extension');
const extensionDir = join(extensionRoot, '.output/e2e/chrome-mv3');
const chromePath = process.env.CHROME_PATH;

if (!chromePath) throw new Error('Set CHROME_PATH to a Chrome for Testing or Chromium binary');
if (!existsSync(serverEntry)) throw new Error(`${serverEntry} is missing; run pnpm build first`);

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
<button onclick="fetch('/api/data?token=abc123').then(() => { log.textContent = 'fetched' })">
  Fetch</button>
<p id="log">no pointer event</p>
<label>Attachment
  <input type="file" hidden
    onchange="uploaded.textContent = 'got ' + this.files[0].name + ' ' + this.files[0].size">
</label>
<p id="uploaded">no file</p>
<button onclick="setTimeout(() => { late.textContent = 'late text here' }, 700)">Slow</button>
<p id="late"></p>
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
  console.log('hello from page', { a: 1 });
  console.error('boom');
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

/** Every press of the Ping button on the /auto page, as the site saw it. */
const hits = [];

const site = createServer((req, res) => {
  if (req.url.startsWith('/api/hit')) {
    hits.push({ who: new URL(req.url, 'http://x').searchParams.get('who'), at: Date.now() });
  }
  if (req.url.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(pages[req.url] ?? pageHtml);
});
await new Promise((done) => site.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${site.address().port}`;
// "Away" leads to another host name, which no automation here is approved for.
pages['/auto'] = `<!doctype html><title>Auto</title>
<label>Who <input id="who"></label>
<input type="password" aria-label="Secret">
<button onclick="fetch('/api/hit?who=' + encodeURIComponent(who.value))
  .then(() => { out.textContent = 'pinged ' + who.value })">Ping</button>
<a href="http://localhost:${site.address().port}/second">Away</a>
<p id="out"></p>`;

async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}
const debugPort = await freePort();
// Not the default port: the developer's own browser and server may be using it, and
// this script must never touch either. The extension gets the port at build time, so
// it doesn't try the default one even once.
const bridgePort = await freePort();
const build = spawnSync('pnpm', ['exec', 'wxt', 'build'], {
  cwd: extensionRoot,
  env: { ...process.env, WXT_ITSME_PORT: String(bridgePort), ITSME_OUT_DIR: '.output/e2e' },
  encoding: 'utf8',
});
if (build.status !== 0) throw new Error(`Extension build failed:\n${build.stdout}${build.stderr}`);

/** A DevTools protocol connection to one target of the test browser. */
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error(`Cannot reach ${target.url}`));
  });
  const waiting = new Map();
  let lastId = 0;
  // Protocol events arrive on the same socket; only messages with an id are answers.
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  };
  return {
    async send(method, params = {}) {
      const id = ++lastId;
      const reply = new Promise((done) => waiting.set(id, done));
      socket.send(JSON.stringify({ id, method, params }));
      const message = await reply;
      if (message.error) throw new Error(`${method}: ${message.error.message}`);
      return message.result;
    },
    close: () => socket.close(),
  };
}

const listTargets = async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();

async function evaluate(target, expression) {
  const session = await connect(target);
  try {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`Evaluation failed: ${result.exceptionDetails.exception?.description}`);
    }
    return result.result.value;
  } finally {
    session.close();
  }
}

/**
 * Runs `use` with a button of one of the extension's in-page overlays (null when it
 * isn't showing). They sit in closed shadow roots, which only the DevTools protocol
 * can see into.
 */
async function withOverlayButton(buttonId, use, where = base) {
  const page = (await listTargets()).find(
    (target) => target.type === 'page' && target.url.startsWith(where),
  );
  const session = await connect(page);
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    const search = (node) => {
      if (node.attributes?.includes(buttonId)) return node;
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        const hit = search(child);
        if (hit) return hit;
      }
      return null;
    };
    return await use(search(root), session);
  } finally {
    session.close();
  }
}

/** With ITSME_E2E_SHOTS set to a folder, saves a picture of the page as the user sees it. */
async function snap(name) {
  const dir = process.env.ITSME_E2E_SHOTS;
  if (!dir) return;
  const page = (await listTargets()).find(
    (target) => target.type === 'page' && target.url.startsWith(base),
  );
  const session = await connect(page);
  try {
    const { data } = await session.send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
    writeFileSync(join(dir, `${name}.jpg`), Buffer.from(data, 'base64'));
  } finally {
    session.close();
  }
}

const hasOverlayButton = (buttonId, where) =>
  withOverlayButton(buttonId, (button) => button !== null, where);

/** Presses an overlay button with a real click, as a person would. */
const pressOverlayButton = (buttonId, where) =>
  withOverlayButton(
    buttonId,
    async (button, session) => {
      if (!button) return false;
      const { model } = await session.send('DOM.getBoxModel', { nodeId: button.nodeId });
      const [left, top, , , right, bottom] = model.content;
      const press = { x: (left + right) / 2, y: (top + bottom) / 2, button: 'left', clickCount: 1 };
      await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...press });
      await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...press });
      return true;
    },
    where,
  );

// Chromium ships extensions of its own, so pick the worker by the manifest name.
async function findServiceWorker() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      for (const target of await listTargets()) {
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

/** Opens one of the extension's own pages in a background tab, evaluates there, closes it. */
async function inExtensionPage(path, expression) {
  const url = await inExtension(`chrome.runtime.getURL('${path}')`);
  const tabId = await inExtension(
    `chrome.tabs.create({ url: '${url}', active: false }).then((tab) => tab.id)`,
  );
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      target = (await listTargets()).find((candidate) => candidate.url === url);
      if (!target) await sleep(100);
    }
    await sleep(500);
    return await evaluate(target, expression);
  } finally {
    await inExtension(`chrome.tabs.remove(${tabId}).then(() => true)`);
  }
}

// Tests change settings from inside the service worker, the way the options page does.
const updateSettings = (patch) =>
  inExtension(`chrome.storage.local.get('settings').then(({ settings }) =>
    chrome.storage.local.set({ settings: { ...settings, ...${JSON.stringify(patch)} } }))`);

// The only folder page_upload may read from in this run.
const uploadDir = mkdtempSync(join(tmpdir(), 'itsme-e2e-uploads-'));
writeFileSync(join(uploadDir, 'hello.txt'), 'hello world');

async function startServer() {
  const client = new Client({ name: 'e2e', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry, '--port', String(bridgePort)],
      env: { ...process.env, ITSME_LOG_LEVEL: 'warn', ITSME_UPLOAD_DIRS: uploadDir },
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
  // Site prompts get their own section below; until then every site is allowed.
  await updateSettings({ siteAccess: 'all' });
  const browser = await waitForBrowser(20_000);
  check('extension connects', browser !== null);
  if (!browser) throw new Error('The extension never connected');

  // --- popup and options page ---
  const stored = await inExtension(`chrome.storage.local.get('launch').then((all) => all.launch)`);
  check(
    'the extension learns how the server was started',
    stored?.command === process.execPath && stored?.args?.[0] === serverEntry,
    JSON.stringify(stored),
  );
  const setupUrl = await inExtension(`chrome.runtime.getURL('setup.html')`);
  const welcome = await inExtension(
    `chrome.tabs.query({}).then((all) => all.filter((t) => t.url === '${setupUrl}').map((t) => t.id))`,
  );
  check(
    'installing the extension opens the setup page',
    welcome.length === 1,
    JSON.stringify(welcome),
  );
  await inExtension(`chrome.tabs.remove(${JSON.stringify(welcome)}).then(() => true)`);

  const popup = await inExtensionPage(
    'popup.html',
    `(() => {
      const text = (id) => document.getElementById(id).textContent.trim();
      return {
        status: text('status'), share: text('share'), add: text('add'), power: text('power'),
        settingsInPopup: document.getElementById('port') !== null,
      };
    })()`,
  );
  check(
    'the popup shows the connection and its actions',
    popup.status.startsWith('Connected') &&
      popup.share === 'Share this tab' &&
      popup.add === 'Add to an AI app' &&
      popup.power === 'Turn off',
    JSON.stringify(popup),
  );
  check('the popup holds no settings', popup.settingsInPopup === false);

  const setup = await inExtensionPage(
    'setup.html',
    `(() => {
      const actions = {};
      for (const button of document.querySelectorAll('#clients button')) {
        actions[button.dataset.client] = { kind: button.dataset.kind, payload: button.dataset.payload };
      }
      return {
        actions,
        status: document.getElementById('status').textContent,
        byHand: document.getElementById('snippet').textContent,
      };
    })()`,
  );
  // This browser talks to a build in this checkout, so the entries point at that build.
  const localCommand = `-e ITSME_PORT=${bridgePort} -- ${process.execPath} ${serverEntry}`;
  check(
    'the setup page has one action per app',
    Object.keys(setup.actions).join() === 'claude-desktop,cursor,vscode,claude-code,codex,other',
    JSON.stringify(Object.keys(setup.actions)),
  );
  check(
    'Claude Desktop gets the bundle download',
    setup.actions['claude-desktop'].payload.endsWith('/releases/latest/download/itsme.mcpb'),
    setup.actions['claude-desktop'].payload,
  );
  check(
    'Cursor and VS Code get install links',
    setup.actions.cursor.payload.startsWith(
      'cursor://anysphere.cursor-deeplink/mcp/install?name=itsme&config=',
    ) && decodeURIComponent(setup.actions.vscode.payload).includes(serverEntry),
    setup.actions.cursor.payload + setup.actions.vscode.payload,
  );
  check(
    'Claude Code gets a command for this server, on this port',
    setup.actions['claude-code'].kind === 'copy' &&
      setup.actions['claude-code'].payload === `claude mcp add --scope user itsme ${localCommand}`,
    setup.actions['claude-code'].payload,
  );
  check(
    'the setup page shows the connection and the entry to add by hand',
    setup.status.startsWith('Connected') &&
      JSON.parse(setup.byHand).mcpServers.itsme.args[0] === serverEntry,
    setup.status + setup.byHand,
  );
  const options = await inExtensionPage(
    'options.html',
    `(async () => {
      const value = (id) => document.getElementById(id).value;
      const before = { port: value('port'), indicator: value('indicator'), enabled: document.getElementById('enabled').checked };
      const select = document.getElementById('indicator');
      select.value = 'orbit';
      select.dispatchEvent(new Event('change'));
      await new Promise((done) => setTimeout(done, 400));
      const { settings } = await chrome.storage.local.get('settings');
      return { ...before, saved: settings.indicator, note: document.getElementById('saved').textContent };
    })()`,
  );
  check(
    'the options page shows the settings and saves a change',
    options.port === String(bridgePort) &&
      options.indicator === 'aurora' &&
      options.enabled &&
      options.saved === 'orbit' &&
      options.note === 'Saved',
    JSON.stringify(options),
  );
  await updateSettings({ indicator: 'aurora' });

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

  // --- named groups ---
  const second = `${base}/second`;
  const first = await json('tabs_open', {
    url: second,
    group: 'Research',
    color: 'green',
    active: false,
  });
  check(
    'tabs_open puts the tab in a named group with the given color',
    first.tab.group?.name === 'Research' && first.tab.group?.color === 'green',
    JSON.stringify(first.tab),
  );
  const joined = await json('tabs_open', { url: second, group: 'Research', active: false });
  let named = await inExtension(`chrome.tabGroups.query({ title: 'Research' })`);
  check(
    'a second tab joins the group and leaves its color alone',
    named.length === 1 && joined.tab.group?.color === 'green',
    JSON.stringify(named),
  );
  const [twinA, twinB] = await Promise.all([
    json('tabs_open', { url: second, group: 'Twins', active: false }),
    json('tabs_open', { url: second, group: 'Twins', active: false }),
  ]);
  named = await inExtension(`chrome.tabGroups.query({ title: 'Twins' })`);
  const picked = twinA.tab.group?.color;
  check('two tabs opened at once share one new group', named.length === 1, JSON.stringify(named));
  check(
    'a new group without a color gets one no other group has',
    typeof picked === 'string' &&
      !['blue', 'green'].includes(picked) &&
      twinB.tab.group?.color === picked,
    String(picked),
  );
  const moved = await json('tabs_group', { tabIds: [joined.tab.id], group: 'Twins', color: 'red' });
  const listed = (await json('tabs_list')).tabs;
  check(
    'tabs_group moves a tab and recolors the group',
    moved.tabs[0].group?.name === 'Twins' &&
      listed.filter((entry) => entry.group?.name === 'Twins' && entry.group.color === 'red')
        .length === 3,
    JSON.stringify(listed.map((entry) => entry.group)),
  );
  check(
    'tabs_list reports the group of every tab',
    listed.length === 5 && listed.find((entry) => entry.id === tab.id)?.group?.name === 'itsme',
    JSON.stringify(listed.map((entry) => entry.group)),
  );
  const grabbed = await call('tabs_group', { tabIds: [tab.id, blankId], group: 'Twins' });
  check(
    'tabs_group refuses a tab that is not shared, and moves none',
    grabbed.text.startsWith('TAB_NOT_SHARED') &&
      (await json('tabs_list')).tabs.find((entry) => entry.id === tab.id)?.group?.name === 'itsme',
    grabbed.text,
  );
  await inExtension(`chrome.tabs.group({ tabIds: [${blankId}] })
    .then((id) => chrome.tabGroups.update(id, { title: 'Research' })).then(() => true)`);
  const lookalike = await call('page_snapshot', { tabId: blankId });
  check(
    "a group of the user's with the same name stays out of reach",
    lookalike.text.startsWith('TAB_NOT_SHARED'),
    lookalike.text,
  );
  await inExtension(`chrome.tabs.ungroup([${blankId}]).then(() => true)`);
  for (const extra of [first, joined, twinA, twinB])
    await call('tabs_close', { tabId: extra.tab.id });
  check('closing the extra tabs leaves the first one', (await json('tabs_list')).tabs.length === 1);

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
  // The field just above the track: both ends of a drag have to be on screen together.
  const drag = await on('page_drag', { from: { ref: knobRef }, to: { ref: keysRef } });
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

  // --- console and network ---
  let logs = await on('page_console');
  check(
    'page_console returns what the page logged before recording',
    logs.text.includes('[log] hello from page') && logs.text.includes('[error] boom'),
    logs.text,
  );
  logs = await on('page_console', { onlyErrors: true });
  check(
    'page_console filters errors',
    logs.text.includes('boom') && !logs.text.includes('hello'),
    logs.text,
  );
  logs = await on('page_console', { pattern: 'HELLO' });
  check(
    'page_console filters by pattern',
    logs.text.includes('hello') && !logs.text.includes('boom'),
    logs.text,
  );

  let requests = await on('page_network');
  check(
    'page_network says how long it has recorded',
    requests.text.startsWith('Recording for'),
    requests.text,
  );
  await on('page_click', { ref: refIn(text, /\[(e\d+)\] button "Fetch"/) });
  await sleep(500);
  requests = await on('page_network', { urlPattern: '/api/' });
  check(
    'page_network records a fetch and redacts its token',
    requests.text.includes(`200 GET ${base}/api/data?token=REDACTED (fetch`),
    requests.text,
  );

  // --- upload, wait, batch ---
  text = await outline();
  const fileRef = refIn(text, /\[(e\d+)\] fileinput "Attachment" files=0/);
  check('snapshot shows a hidden file input', Boolean(fileRef), text);
  const uploaded = await on('page_upload', { ref: fileRef, paths: [join(uploadDir, 'hello.txt')] });
  check(
    'page_upload fills the file input',
    uploaded.text === 'Uploaded hello.txt' && (await outline()).includes('text "got hello.txt 11"'),
    uploaded.text,
  );
  const outside = await on('page_upload', { ref: fileRef, paths: [serverEntry] });
  check(
    'page_upload refuses a file outside the allowed folder',
    outside.text.includes('outside the folders'),
    outside.text,
  );

  await on('page_click', { ref: refIn(text, /\[(e\d+)\] button "Slow"/) });
  const waited = await on('page_wait', { text: 'late text here' });
  check(
    'page_wait waits for text to appear',
    waited.text === 'OK' && (await outline()).includes('late text here'),
    waited.text,
  );
  const timedOut = await on('page_wait', { text: 'never shown', timeoutMs: 400 });
  check('page_wait reports a timeout', timedOut.text.startsWith('Timed out'), timedOut.text);

  const batch = await call('batch', {
    steps: [
      { tool: 'page_type', args: { tabId: tab.id, ref: nameRef, text: 'Batch' } },
      { tool: 'page_click', args: { tabId: tab.id, ref: greetRef } },
      { tool: 'page_find', args: { tabId: tab.id, query: 'Hello, Batch' } },
    ],
  });
  check(
    'batch runs its steps in order',
    !batch.isError &&
      batch.text.includes('--- 3. page_find ---') &&
      batch.text.includes('text "Hello, Batch!"'),
    batch.text,
  );
  const broken = await call('batch', {
    steps: [
      { tool: 'page_click', args: { tabId: tab.id, ref: 'e99999' } },
      { tool: 'page_text', args: { tabId: tab.id } },
    ],
  });
  check(
    'batch stops at the first failure',
    broken.isError &&
      broken.text.includes('1 later step(s) were not run') &&
      !broken.text.includes('page_text ---'),
    broken.text,
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
  const noConsole = await on('page_console');
  check(
    'page_console needs the debugger',
    noConsole.text.startsWith('UNSUPPORTED'),
    noConsole.text,
  );
  await updateSettings({ realInput: true });
  // Switching the debugger off stopped the recording; start it again before the page loads below.
  await on('page_network');

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

  requests = await on('page_network', { urlPattern: base });
  check(
    'page_network records a page load',
    requests.text.includes(`200 GET ${base}/ (document`),
    requests.text,
  );

  // --- site permission ---
  await updateSettings({ siteAccess: 'ask', allowedSites: [], blockedSites: [] });
  let waiting = on('page_snapshot');
  await sleep(1_000);
  check('an unknown site gets a prompt on the page', await pressOverlayButton('itsme-deny'));
  let answer = await waiting;
  check('"Not now" refuses the call', answer.text.startsWith('SITE_NOT_ALLOWED'), answer.text);

  waiting = on('page_snapshot');
  await sleep(1_000);
  await pressOverlayButton('itsme-allow');
  answer = await waiting;
  check('"Allow" lets the call through', answer.text.includes('heading "Greeter"'), answer.text);
  const allowedSites = await inExtension(
    `chrome.storage.local.get('settings').then(({ settings }) => settings.allowedSites)`,
  );
  check('the allowed site is remembered', allowedSites.includes('127.0.0.1'), String(allowedSites));
  check('an allowed site needs no prompt', (await outline()).includes('heading "Greeter"'));

  await updateSettings({ blockedSites: ['127.0.0.1'] });
  answer = await on('page_snapshot');
  check('a blocked site is refused', answer.text.includes('blocked list'), answer.text);
  answer = await on('page_navigate', { url: `${base}/second` });
  check(
    'navigating to a blocked site is refused',
    answer.text.startsWith('SITE_NOT_ALLOWED'),
    answer.text,
  );
  await updateSettings({ siteAccess: 'all', blockedSites: [] });

  // --- animation styles ---
  await outline();
  check('the default animation is Aurora', await hasOverlayButton('aurora'));
  for (const style of ['aurora', 'orbit', 'viewfinder', 'ripple', 'none']) {
    await updateSettings({ indicator: style });
    await sleep(300);
    const fresh = await outline();
    await on('page_type', { ref: refIn(fresh, /\[(e\d+)\] textbox "Your name"/), text: style });
    await on('page_click', { ref: refIn(fresh, /\[(e\d+)\] button "Greet"/) });
    await sleep(220);
    await snap(style);
    check(
      `${style}: shown, with the badge, and input still reaches the page`,
      (await hasOverlayButton(style)) &&
        (await hasOverlayButton('itsme-stop')) &&
        (await outline()).includes(`Hello, ${style}!`),
    );
  }
  await updateSettings({ indicator: 'aurora' });
  await sleep(300);

  // --- badge and stop ---
  await outline();
  check('the page shows that itsme is using it', await hasOverlayButton('itsme-stop'));
  await on('page_screenshot');
  check('the badge is hidden for a screenshot', !(await hasOverlayButton('itsme-stop')));
  await outline();
  await pressOverlayButton('itsme-stop');
  await sleep(1_000);
  check('Stop disconnects the browser', (await json('browser_status')).browsers.length === 0);
  await updateSettings({ enabled: true });
  check('switching it back on reconnects', (await waitForBrowser(15_000)) !== null);

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

  // --- automations ---
  {
    const stored = async (id) =>
      (
        await inExtension(`chrome.storage.local.get('automations').then((all) => all.automations)`)
      ).find((automation) => automation.id === id);
    const automationsPage = (expression) => inExtensionPage('automations.html', expression);
    // What the page's own buttons send; the background takes it from extension pages only.
    const press = (action, id) =>
      automationsPage(
        `chrome.runtime.sendMessage({ type: 'itsme/automation', action: '${action}', id: '${id}' })`,
      );
    const idOf = (text) => /^\[(\w+)\]/.exec(text)?.[1];
    const hitsBy = (who) => hits.filter((hit) => hit.who === who);
    const everySecond = (name, steps) =>
      call('automation_create', {
        name,
        url: `${base}/auto`,
        schedule: { every: 'interval', seconds: 1 },
        steps,
      });
    const badge = () => inExtension(`chrome.action.getBadgeText({})`);

    const created = await everySecond('Ping every second', [
      { do: 'type', target: { role: 'textbox', name: 'Who' }, text: 'bot' },
      { do: 'click', target: { role: 'button', name: 'Ping' } },
    ]);
    const pingId = idOf(created.text);
    check(
      'automation_create saves it as waiting for approval',
      Boolean(pingId) && created.text.includes('waiting for the user to approve it'),
      created.text,
    );
    await sleep(2_500);
    check('an automation does not run before it is approved', hits.length === 0);
    check('the toolbar button shows that one is waiting', (await badge()) === '1');
    const listed = await automationsPage(`document.getElementById('list').textContent`);
    check(
      'the automations page lists it in plain words',
      ['Ping every second', 'Every 1 s', 'Click button "Ping"', 'Approve'].every((part) =>
        listed.includes(part),
      ),
      listed,
    );
    await automationsPage(
      `(document.querySelector('[data-action="approve"]').click(), new Promise((done) => setTimeout(done, 500)))`,
    );
    check('a scripted click on Approve does nothing', (await stored(pingId)).status === 'pending');

    await press('approve', pingId);
    await sleep(6_500);
    const pings = hitsBy('bot');
    const gaps = pings.slice(1).map((hit, index) => hit.at - pings[index].at);
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    console.log(
      `     every 1 s, in a background tab: ${pings.length} runs, gaps ${gaps.join(' ')} ms`,
    );
    check(
      'once approved it runs by itself, about once a second',
      pings.length >= 4 && median >= 800 && median <= 1_600,
      `${pings.length} runs, median gap ${median} ms`,
    );
    check('its tab is out of reach of the tools', (await json('tabs_list')).tabs.length === 1);
    const autoGroups = await inExtension(`chrome.tabGroups.query({ title: 'itsme automations' })`);
    check('its tab sits in a tab group of its own', autoGroups.length === 1);

    const paused = await call('automation_pause', { id: pingId });
    await sleep(1_500);
    const seen = hits.length;
    await sleep(2_500);
    check(
      'automation_pause stops it',
      paused.text.includes('paused (Paused by the AI app)') && hits.length === seen,
      paused.text,
    );
    await press('resume', pingId);
    await sleep(2_500);
    check('turning it on in the extension starts it again', hits.length > seen);

    await pressOverlayButton('itsme-stop', `${base}/auto`);
    await sleep(1_000);
    let state = await stored(pingId);
    check(
      'Stop on its page pauses the automation and leaves the bridge on',
      state.status === 'paused' &&
        state.pausedBecause === 'Stopped on the page' &&
        (await json('browser_status')).browsers.length === 1,
      JSON.stringify(state),
    );

    await press('resume', pingId);
    await sleep(2_000);
    const autoTabs = await inExtension(
      `chrome.tabs.query({}).then((all) => all.filter((t) => t.url === '${base}/auto').map((t) => t.id))`,
    );
    check('it keeps to one tab', autoTabs.length === 1, JSON.stringify(autoTabs));
    await inExtension(`chrome.tabs.remove(${JSON.stringify(autoTabs)}).then(() => true)`);
    await sleep(1_000);
    state = await stored(pingId);
    check(
      'closing its tab pauses a repeating automation',
      state.status === 'paused' && state.pausedBecause === 'Its tab was closed',
      JSON.stringify(state),
    );
    await call('automation_remove', { id: pingId });

    const doomed = {
      missing: [{ do: 'click', target: { role: 'button', name: 'Nope' } }],
      secret: [{ do: 'type', target: { name: 'Secret' }, text: 'x' }],
      away: [{ do: 'click', target: { role: 'link', name: 'Away' } }],
    };
    const doomedIds = {};
    for (const [name, steps] of Object.entries(doomed)) {
      doomedIds[name] = idOf((await everySecond(name, steps)).text);
      await press('approve', doomedIds[name]);
    }
    await sleep(12_000);
    const expected = {
      missing: 'No button "Nope" on the page',
      secret: 'do not type into password fields',
      away: 'left the approved sites for localhost',
    };
    for (const [name, reason] of Object.entries(expected)) {
      state = await stored(doomedIds[name]);
      check(
        `"${name}" fails with its reason and pauses itself after three tries`,
        state.status === 'paused' &&
          state.pausedBecause === 'Failed 3 times in a row' &&
          (state.history.at(-1)?.note ?? '').includes(reason),
        JSON.stringify(state.history),
      );
    }
    check('the toolbar button counts the ones that gave up', (await badge()) === '3');
    const listing = await call('automation_list');
    check(
      'automation_list reports why the latest run failed',
      listing.text.includes('the latest failed: Step 1 (Click button "Nope")'),
      listing.text,
    );
    for (const id of Object.values(doomedIds)) await call('automation_remove', { id });
    const leftovers = await inExtension(
      `chrome.tabs.query({}).then((all) => all.filter((t) => t.url.includes('/auto') || t.url.includes('localhost')).length)`,
    );
    check(
      'automation_remove deletes them and closes their tabs',
      (await call('automation_list')).text === 'No automations' &&
        leftovers === 0 &&
        (await badge()) === '',
      `${leftovers} tabs left`,
    );

    // A daily one, due at the next full minute that is at least 20 s away.
    const due = new Date(Date.now() + 20_000);
    due.setMinutes(due.getMinutes() + 1, 0, 0);
    const clock = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
    hits.length = 0;
    const daily = await call('automation_create', {
      name: 'Daily ping',
      url: `${base}/auto`,
      schedule: { every: 'day', at: clock },
      steps: [
        { do: 'type', target: { role: 'textbox', name: 'Who' }, text: 'daily' },
        { do: 'click', target: { role: 'button', name: 'Ping' } },
        { do: 'wait', text: 'pinged daily' },
      ],
    });
    const dailyId = idOf(daily.text);
    await press('approve', dailyId);
    await sleep(2_000);
    check('a daily automation waits for its time', hits.length === 0);

    // With the server gone nothing keeps the service worker alive past 30s, so only
    // alarms can bring the connection back, or start the daily automation on time.
    const idleMs = Math.max(45_000, due.getTime() - Date.now() + 10_000);
    console.log(
      `Stopping the server for ${Math.round(idleMs / 1000)}s; "Daily ping" is due at ${clock}...`,
    );
    await client.close();
    await sleep(idleMs);
    const [ran] = hitsBy('daily');
    check(
      'the daily automation ran on time with no server and no AI app running',
      hits.length === 1 && ran !== undefined && Math.abs(ran.at - due.getTime()) < 8_000,
      ran ? `${ran.at - due.getTime()} ms after its time, ${hits.length} runs` : 'it did not run',
    );
    if (ran) console.log(`     daily run started ${ran.at - due.getTime()} ms after ${clock}`);

    client = await startServer();
    const again = await waitForBrowser(45_000);
    check('extension reconnects after the worker was idle', again !== null);
    if (again) {
      check('commands work after reconnecting', (await json('tabs_list')).tabs.length === 1);
      const report = await call('automation_list');
      const open = await inExtension(
        `chrome.tabs.query({}).then((all) => all.filter((t) => t.url.includes('/auto')).length)`,
      );
      check(
        'a daily run is on the record and its tab is closed again',
        report.text.includes('1 run(s); the latest worked') && open === 0,
        `${report.text}\n${open} tabs open`,
      );
      await call('automation_remove', { id: dailyId });
    }
  }
} finally {
  chrome.kill();
  await client.close();
  site.close();
  await sleep(300);
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(uploadDir, { recursive: true, force: true });
}

process.exit(failures > 0 ? 1 : 0);
