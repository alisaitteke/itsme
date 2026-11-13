# itsme

Browser extension plus MCP server that let an MCP client drive the browser you already use: open tabs, read pages, click, type, drag, press keys and take screenshots.

Works in Chrome 116+. The Firefox build compiles but has not been run yet.

```
MCP client --stdio--> server --WebSocket 127.0.0.1:47821--> extension --> tabs / scripting APIs
```

The server listens on localhost and the extension connects to it, retrying until the server is up. Each MCP client starts its own server process; the first one owns the port and the others relay through it, taking over if it exits.

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

The extension popup shows whether it is connected, shares the current tab with itsme, and has the on/off switch, port, token and the real-input option.

## Tools

| Tool                                                    | What it does                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `browser_status`                                        | Is a browser connected, and which one                               |
| `tabs_list`, `tabs_open`, `tabs_close`, `tabs_activate` | Manage the tabs in the itsme group                                  |
| `page_navigate`, `page_history`                         | Load a URL, go back or forward                                      |
| `page_snapshot`                                         | Outline of the page with a ref on every element                     |
| `page_find`                                             | Elements whose name, value or text contains a query                 |
| `page_text`                                             | Readable text, preferring the main article                          |
| `page_click`, `page_hover`, `page_drag`                 | Pointer actions on a ref or on `x`, `y` from a screenshot           |
| `page_type`, `page_press`                               | Text into a field or the focused element; single keys and shortcuts |
| `page_scroll`                                           | Scroll the page or the area around an element                       |
| `page_screenshot`                                       | PNG of the visible area, in viewport pixels                         |

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

## Real input

On Chromium, pointer and keyboard tools send real input through `chrome.debugger`, so pages see trusted events and a user gesture. While a tab is attached the browser shows a "started debugging this browser" bar.

- The debugger attaches on the first pointer or keyboard action in a tab, and detaches after two minutes without input or when the server disconnects.
- Pressing Cancel on the bar turns the option off. Turn it back on in the popup.
- The tab is made the visible one in its window first; a hidden tab doesn't answer input.
- Scripted DOM events are used instead when the option is off, in Firefox, when the debugger can't attach, when something covers the element, for `<select>` elements and for clearing a field to empty. `page_drag` has no scripted version and answers `UNSUPPORTED`.

## Configuration

| Variable           | Default | Notes                                                         |
| ------------------ | ------- | ------------------------------------------------------------- |
| `ITSME_PORT`       | `47821` | Also `--port`. Set the same port in the popup                 |
| `ITSME_TOKEN`      | (none)  | Shared secret; enter the same value in the popup              |
| `ITSME_TIMEOUT_MS` | `30000` | Per-command timeout                                           |
| `ITSME_LOG_LEVEL`  | `info`  | `debug`, `info`, `warn`, `error`, `silent`. Logs go to stderr |

## Development

```bash
pnpm dev:extension   # Chrome with the extension loaded and hot reload
pnpm dev:server      # rebuild the server on change
pnpm test            # unit and integration tests
pnpm typecheck
pnpm lint
pnpm build:firefox   # output in packages/extension/.output/firefox-mv3
```

`pnpm test:e2e` runs the built extension in a real browser with a throwaway profile, on its own port, so it never reaches a browser you have connected. It needs a Chromium that still accepts `--load-extension`, such as Chrome for Testing; Google Chrome dropped the flag.

```bash
CHROME_PATH="/path/to/Google Chrome for Testing" pnpm test:e2e
```

### Layout

```
packages/
  protocol/    wire messages, command schemas, error codes (zod); shared by both sides
  server/      MCP server on stdio and the WebSocket hub
    src/bridge/    hub, peer relay, takeover
    src/mcp/       tool definitions
  extension/   WXT project
    src/background/   connection, command router, handlers (extension APIs)
      input/            pointer and keyboard drivers: debugger (real input) and DOM
      debugger/         debugger sessions: attach on demand, detach when idle
      session-tabs.ts   the itsme tab group
    src/agent/        content script: outline, find, geometry, scripted actions (DOM only)
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
- The Chromium build asks for the `debugger` permission. It is used only for the input events above.

## Known limits

- Where real input isn't used (see above), clicks and typing are scripted DOM events. Sites that require trusted events or a user gesture (popups, file pickers, clipboard) won't respond to those. Firefox has no debugger API, so it always works this way.
- Typed text arrives as one insertion, without per-key `keydown`/`keyup` events.
- Cross-origin iframes and closed shadow roots can't be read; a cross-origin frame shows up in the snapshot as a single `frame` line.
- `page_drag` moves the mouse with the button held. It works for sliders, sortable lists and canvases, but not for pages built on the HTML5 drag-and-drop API.
- Some editing shortcuts are handled by the operating system rather than the page, so `page_press` with a modifier may reach the page without having its usual effect.
- Browser pages such as `chrome://` and the extension store can't be scripted; tools return `PAGE_NOT_ACCESSIBLE`.
- With several browsers connected, commands go to the one that connected last.
- Firefox will need `data_collection_permissions` in the manifest before it can be published.
