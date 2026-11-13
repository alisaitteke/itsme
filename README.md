# itsme

Browser extension plus MCP server that let an MCP client drive the browser you already use: open tabs, read pages, click, type, drag, press keys, take screenshots and read the console and network.

Works in Chrome 116+. The Firefox build compiles but has not been run yet.

```
MCP client --stdio--> server --WebSocket 127.0.0.1:47821--> extension --> tabs / scripting APIs
```

The server listens on localhost and the extension connects to it, retrying until the server is up. Each MCP client starts its own server process; the first one owns the port and the others relay through it, taking over if it exits. A server left running from before an update gives the port up when a newer one starts; its MCP client has to be restarted to use the browser again.

## Setup

```bash
pnpm install
pnpm build
```

Open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and pick `packages/extension/.output/chrome-mv3`.

Point your MCP client at the server:

```json
{
  "mcpServers": {
    "itsme": {
      "command": "node",
      "args": ["/absolute/path/to/itsme/packages/server/dist/cli.mjs"]
    }
  }
}
```

The extension popup shows whether it is connected, shares the current tab with itsme, lists the allowed and blocked sites, and has the on/off switch, port, token and the debugger option.

## Tools

| Tool                                                    | What it does                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `browser_status`                                        | Is a browser connected, and which one                                     |
| `tabs_list`, `tabs_open`, `tabs_close`, `tabs_activate` | Manage the tabs in the itsme group                                        |
| `page_navigate`, `page_history`                         | Load a URL, go back or forward                                            |
| `page_snapshot`                                         | Outline of the page with a ref on every element                           |
| `page_find`                                             | Elements whose name, value or text contains a query                       |
| `page_text`                                             | Readable text, preferring the main article                                |
| `page_click`, `page_hover`, `page_drag`                 | Pointer actions on a ref or on `x`, `y` from a screenshot                 |
| `page_type`, `page_press`                               | Text into a field or the focused element; single keys and shortcuts       |
| `page_scroll`                                           | Scroll the page or the area around an element                             |
| `page_wait`                                             | Wait for text to appear or disappear, or for a moment                     |
| `page_upload`                                           | Put local files into a file input                                         |
| `page_screenshot`                                       | PNG of the visible area, in viewport pixels                               |
| `page_console`                                          | Console messages and uncaught errors, filtered by pattern or level        |
| `page_network`                                          | Requests the page made: status, method, URL, type, time, size             |
| `batch`                                                 | Run several of the tools above in one call, stopping at the first failure |

Refs come from `page_snapshot` and `page_find`, and stop working when the page navigates. Page tools default to the itsme tab used last.

A snapshot looks like this:

```
[e1] heading "Greeter" level=1
[e2] form ""
  [e3] textbox "Your name" value=""
  [e4] combobox "Colour" value="Red" options=["Red","Blue"]
  [e5] button "Greet"
text "Nothing yet"
[e6] list ""
  [e7] listitem ""
    text "First bold item"
```

Pass `filter: "interactive"` for a flat list of controls, or `ref` to read one part of a large page.

## Tab group

itsme only sees and touches tabs in a tab group named "itsme". Tabs it opens go there. To let it work on a tab you already have open, press "Share this tab" in the popup or drag the tab into the group; a tab outside the group answers `TAB_NOT_SHARED`.

Firefox has no tab group API, so there the extension keeps its own list of shared tabs instead.

## Uploads

`page_upload` is off until you name the folders it may read from:

```json
"env": { "ITSME_UPLOAD_DIRS": "/Users/me/Downloads:/Users/me/project/fixtures" }
```

Files outside those folders are refused, symlinks are resolved first, and so is anything that looks like a credential (`.env`, `*.pem`, `id_rsa`, anything under `.ssh` or `.aws`). One call can carry 10 MB. The files are set on the input by script, so no file dialog opens.

## Sites

A site has to be allowed before its pages are read or driven. The first time a tool touches a new site, a prompt appears on the page and the tool call waits up to a minute for the answer:

- "Allow" remembers the site, subdomains included.
- "Not now" fails that call with `SITE_NOT_ALLOWED`; the next call asks again.
- Sharing a tab from the popup allows its site.

The popup lists the allowed sites and takes a list of blocked ones, which are refused whatever else is set, navigation included. Turn "Ask before using a new site" off to allow every site that isn't blocked.

## Debugger

On Chromium the extension uses `chrome.debugger` for three things: real mouse and keyboard input, so pages see trusted events and a user gesture; the console; and network recording. While a tab is attached the browser shows a "started debugging this browser" bar.

- The debugger attaches on the first pointer, keyboard, console or network call in a tab. It detaches when the server disconnects, or after two minutes without use (ten while a tab is being recorded).
- Pressing Cancel on the bar turns the option off. Turn it back on in the popup.
- For input, the tab is made the visible one in its window first; a hidden tab doesn't answer input.
- Scripted DOM events are used instead when the option is off, in Firefox, when the debugger can't attach, when something covers the element, for `<select>` elements and for clearing a field to empty. `page_drag`, `page_console` and `page_network` have no scripted version and answer `UNSUPPORTED`.
- `page_console` returns what the page logged before the recording started as well. `page_network` only has requests made after its first call on a tab, so call it once and then reload to capture a page load.

## Configuration

| Variable            | Default | Notes                                                                  |
| ------------------- | ------- | ---------------------------------------------------------------------- |
| `ITSME_PORT`        | `47821` | Also `--port`. Set the same port in the popup                          |
| `ITSME_TOKEN`       | (none)  | Shared secret; enter the same value in the popup                       |
| `ITSME_TIMEOUT_MS`  | `30000` | Per-command timeout                                                    |
| `ITSME_LOG_LEVEL`   | `info`  | `debug`, `info`, `warn`, `error`, `silent`. Logs go to stderr          |
| `ITSME_UPLOAD_DIRS` | (none)  | Folders `page_upload` may read from, separated by `:` (`;` on Windows) |

## Development

```bash
pnpm dev:extension   # Chrome with the extension loaded and hot reload
pnpm dev:server      # rebuild the server on change
pnpm test            # unit and integration tests
pnpm typecheck
pnpm lint
pnpm build:firefox   # output in packages/extension/.output/firefox-mv3
```

`pnpm test:e2e` builds a copy of the extension with its own port and runs it in a real browser with a throwaway profile, so it never reaches a browser or server you are using. It needs a Chromium that still accepts `--load-extension`, such as Chrome for Testing; Google Chrome dropped the flag.

```bash
CHROME_PATH="/path/to/Google Chrome for Testing" pnpm test:e2e
```

### Layout

```
packages/
  protocol/    wire messages, command schemas, error codes (zod); shared by both sides
  server/      MCP server on stdio and the WebSocket hub
    src/bridge/    hub, peer relay, takeover
    src/mcp/       tool definitions, batch, upload file checks
  extension/   WXT project
    src/background/   connection, command router, handlers (extension APIs)
      input/            pointer and keyboard drivers: debugger (real input) and DOM
      debugger/         debugger sessions, console and network recording
      session-tabs.ts   the itsme tab group
      site-access.ts    allowed and blocked sites, the wait for the prompt
    src/agent/        content script: outline, find, geometry, scripted actions, site prompt, badge
    src/entrypoints/  background, agent content script, popup
tests/
  integration/   MCP client through to the extension's connection and router, in Node
  e2e/           the same path in a real Chromium
```

### Adding a command

1. Define params and result in `packages/protocol/src/commands.ts`.
2. Add a handler under `packages/extension/src/background/handlers/`.
3. Register the tool in `packages/server/src/mcp/tools.ts`.

A browser build that can't support a command leaves its handler out; the extension reports the commands it has, and the server answers `UNSUPPORTED` for the rest.

## Security

- The server binds to `127.0.0.1` only.
- The extension endpoint requires an extension `Origin`, which web pages can't forge, so a website can't connect to the port.
- Any local process can still connect. Set `ITSME_TOKEN` to require a shared secret on both sides.
- `tabs_open` and `page_navigate` accept only `http` and `https` URLs.
- `page_snapshot` never returns password field values.
- Tabs outside the itsme group can't be listed, read or driven.
- While itsme reads or drives a tab, the page shows a badge with a Stop button. Stop switches the bridge off until it is turned back on in the popup.
- Pages of a site the user hasn't allowed can't be read or driven. The prompt sits in a closed shadow root and only accepts a real click, so neither the page nor a tool call can answer it.
- `page_network` records no headers or bodies, and redacts credentials in URLs.
- `page_upload` reads only from the folders in `ITSME_UPLOAD_DIRS` and refuses credential files.
- The Chromium build asks for the `debugger` permission. It is used for input, the console and network recording, nothing else.

## Known limits

- Where real input isn't used (see above), clicks and typing are scripted DOM events. Sites that require trusted events or a user gesture (popups, file pickers, clipboard) won't respond to those. Firefox has no debugger API, so it always works this way.
- Typed text arrives as one insertion, without per-key `keydown`/`keyup` events.
- A file input is listed even when the page hides it, but not when it sits inside a hidden container.
- Objects in console messages logged before the recording started show up as `Object`, without their contents.
- Cross-origin iframes and closed shadow roots can't be read; a cross-origin frame shows up in the snapshot as a single `frame` line.
- `page_drag` moves the mouse with the button held. It works for sliders, sortable lists and canvases, but not for pages built on the HTML5 drag-and-drop API.
- Some editing shortcuts are handled by the operating system rather than the page, so `page_press` with a modifier may reach the page without having its usual effect.
- Browser pages such as `chrome://` and the extension store can't be scripted; tools return `PAGE_NOT_ACCESSIBLE`.
- With several browsers connected, commands go to the one that connected last.
- Firefox will need `data_collection_permissions` in the manifest before it can be published.
