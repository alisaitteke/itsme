# itsme

Browser extension plus MCP server that let an MCP client drive the browser you already use: tabs, navigation, reading pages, clicking, typing and screenshots.

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

The extension popup shows whether it is connected, and has the on/off switch, port, token and the real-input option.

## Tools

| Tool                                                    | What it does                                                |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `browser_status`                                        | Is a browser connected, and which one                       |
| `tabs_list`, `tabs_open`, `tabs_close`, `tabs_activate` | Manage tabs                                                 |
| `page_navigate`, `page_history`                         | Load a URL, go back or forward                              |
| `page_snapshot`                                         | Visible text plus the interactive elements, each with a ref |
| `page_click`, `page_type`                               | Act on an element by its ref                                |
| `page_screenshot`                                       | PNG of the visible area                                     |

Page tools default to the active tab. Refs come from `page_snapshot` and stop working when the page navigates.

## Real input

On Chromium, `page_click` and `page_type` send real mouse and keyboard input through `chrome.debugger`, so pages see trusted events and a user gesture. While a tab is attached the browser shows a "started debugging this browser" bar.

- The debugger attaches on the first click or type in a tab, and detaches after two minutes without input or when the server disconnects.
- Pressing Cancel on the bar turns the option off. Turn it back on in the popup.
- The tab is made the visible one in its window first; a hidden tab doesn't answer input.
- Scripted DOM events are used instead when the option is off, in Firefox, when the debugger can't attach, when something covers the element, for `<select>` elements and for clearing a field to empty.

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
      input/            click and type drivers: debugger (real input) and DOM
      debugger/         debugger sessions: attach on demand, detach when idle
    src/agent/        content script: snapshot, locate, click, type (DOM only)
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
- The Chromium build asks for the `debugger` permission. It is used only for the input events above.

## Known limits

- Where real input isn't used (see above), clicks and typing are scripted DOM events. Sites that require trusted events or a user gesture (popups, file pickers, clipboard) won't respond to those. Firefox has no debugger API, so it always works this way.
- Typed text arrives as one insertion, without per-key `keydown`/`keyup` events.
- Only the top frame is read and driven, not iframes.
- Browser pages such as `chrome://` and the extension store can't be scripted; tools return `PAGE_NOT_ACCESSIBLE`.
- With several browsers connected, commands go to the one that connected last.
- Firefox will need `data_collection_permissions` in the manifest before it can be published.
