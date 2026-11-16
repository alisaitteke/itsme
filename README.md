<p align="center">
  <img src="packages/extension/brand/mark.svg" width="80" height="80" alt="">
</p>

<h1 align="center">itsme</h1>

<p align="center">Let your AI app work in the browser you already use.<br>It only touches the tabs you share and the sites you allow.</p>

Chrome extension plus a local MCP server. Your AI app (Claude, Cursor, VS Code, Codex or any MCP client) gets to open tabs, read pages, click, type and take screenshots in your own browser, with your logins. It can also save steps as an automation that the extension runs on a schedule by itself.

Works in Chrome 116+. The Firefox build compiles but hasn't been run yet.

## Setup

Build the extension:

```bash
pnpm install
pnpm build
```

Open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and pick `packages/extension/.output/chrome-mv3`.

The extension then opens its Connect page, with one action per app. "Connect an AI app" in the popup brings it back.

| App             | What to do                                                                                                                       | Needs Node.js |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Claude Desktop  | Download `itsme.mcpb` from the [latest release](https://github.com/alisaitteke/itsme/releases/latest), open it and press Install | No            |
| Cursor, VS Code | Press "Add to Cursor" or "Add to VS Code" on the Connect page and confirm in the app                                             | Yes           |
| Claude Code     | `claude mcp add --scope user itsme -- npx -y itsme-mcp`                                                                          | Yes           |
| Codex           | `codex mcp add itsme -- npx -y itsme-mcp`                                                                                        | Yes           |
| Anything else   | Add the entry below to its MCP settings                                                                                          | Yes           |

```json
{
  "mcpServers": {
    "itsme": { "command": "npx", "args": ["-y", "itsme-mcp"] }
  }
}
```

Restart the app after adding itsme; it starts the server when it starts. [docs/clients.md](docs/clients.md) has the steps for each app and a troubleshooting table.

To try it, ask the app:

```
Open example.com in my browser and tell me what it says.
```

The tab opens in a tab group of its own, and the page asks you before itsme uses a new site.

## How it works

```
MCP client --stdio--> server --WebSocket 127.0.0.1:47821--> extension --> tabs / scripting APIs
```

Each MCP client starts its own server process. The first one owns the port and the others relay through it, taking over if it exits. The extension keeps retrying until a server is up. A server left over from before an update gives up the port when a newer one starts; restart its app to get the browser back.

itsme only touches tabs in its own tab groups and sites you've allowed. To hand it a tab you already have open, press "Share this tab" in the popup. While it works, the page shows an animation and a badge with a Stop button.

## Tools

| Tool                                                                            | What it does                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `browser_status`                                                                | Is a browser connected, and which one                                     |
| `tabs_list`, `tabs_open`, `tabs_close`, `tabs_activate`                         | Manage the tabs in itsme's groups                                         |
| `tabs_group`                                                                    | Move tabs into a named, colored tab group                                 |
| `page_navigate`, `page_history`                                                 | Load a URL, go back or forward                                            |
| `page_snapshot`                                                                 | Outline of the page with a ref on every element                           |
| `page_find`                                                                     | Elements whose name, value or text contains a query                       |
| `page_text`                                                                     | Readable text, preferring the main article                                |
| `page_annotate`                                                                 | Mark passages on the page and list them in a legend the user sees         |
| `page_click`, `page_hover`, `page_drag`                                         | Pointer actions on a ref or on `x`, `y` from a screenshot                 |
| `page_type`, `page_press`                                                       | Text into a field or the focused element; single keys and shortcuts       |
| `page_scroll`                                                                   | Scroll the page or the area around an element                             |
| `page_wait`                                                                     | Wait for text to appear or disappear, or for a moment                     |
| `page_upload`                                                                   | Put local files into a file input                                         |
| `page_screenshot`                                                               | PNG of the visible area, in viewport pixels                               |
| `page_console`                                                                  | Console messages and uncaught errors, filtered by pattern or level        |
| `page_network`                                                                  | Requests the page made: status, method, URL, type, time, size             |
| `batch`                                                                         | Run several of the tools above in one call, stopping at the first failure |
| `automation_create`, `automation_list`, `automation_pause`, `automation_remove` | Save steps for the extension to repeat on a schedule                      |

Refs come from `page_snapshot` and `page_find` and stop working when the page navigates. Page tools default to the itsme tab used last.

## Configuration

| Variable            | Default | Notes                                                                  |
| ------------------- | ------- | ---------------------------------------------------------------------- |
| `ITSME_PORT`        | `47821` | Also `--port`. Set the same port in the extension's options            |
| `ITSME_TIMEOUT_MS`  | `30000` | Per-command timeout                                                    |
| `ITSME_LOG_LEVEL`   | `info`  | `debug`, `info`, `warn`, `error`, `silent`. Logs go to stderr          |
| `ITSME_UPLOAD_DIRS` | (none)  | Folders `page_upload` may read from, separated by `:` (`;` on Windows) |

`page_upload` stays off until `ITSME_UPLOAD_DIRS` is set. Everything on the extension side (site lists, the animation, "Real mouse and keyboard", the port) is on its Settings page.

## Security

- The server binds to `127.0.0.1` only, and the extension endpoint requires an extension `Origin`, so a website can't connect. Any program on this computer still can; there is no shared secret.
- Tabs outside itsme's groups and sites you haven't allowed can't be read or driven. The site prompt only takes a real click, so neither the page nor a tool call can answer it.
- `tabs_open` and `page_navigate` accept only `http` and `https` URLs.
- Stop on the badge switches itsme off until you turn it back on in the popup.
- `page_snapshot` never returns password values, automations never type into password fields, and `page_network` records no headers or bodies and redacts credentials in URLs.
- An automation runs only after you approve it in the extension, and only on the sites of its own URLs.
- The Chromium build asks for the `debugger` permission, for real input, the console and network recording.

## Docs

- [docs/browser.md](docs/browser.md): tab groups, sites, snapshots, marks, PDFs, the indicator, uploads, the debugger and known limits
- [docs/automations.md](docs/automations.md): schedules, steps, approval and failures
- [docs/clients.md](docs/clients.md): connecting each app by hand
- [docs/development.md](docs/development.md): dev commands, e2e tests, code layout, adding a command
- [docs/releasing.md](docs/releasing.md): publishing a release
