# itsme

Browser extension plus MCP server that let an MCP client drive the browser you already use: open tabs, read pages, click, type, drag, press keys, take screenshots and read the console and network. It can also save steps as an automation that the extension repeats on a schedule by itself.

Works in Chrome 116+. The Firefox build compiles but has not been run yet.

```
MCP client --stdio--> server --WebSocket 127.0.0.1:47821--> extension --> tabs / scripting APIs
```

The server listens on localhost and the extension connects to it, retrying until the server is up. Each MCP client starts its own server process; the first one owns the port and the others relay through it, taking over if it exits. A server left running from before an update gives the port up when a newer one starts; its MCP client has to be restarted to use the browser again.

## Setup

### 1. The extension

```bash
pnpm install
pnpm build
```

Open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and pick `packages/extension/.output/chrome-mv3`.

### 2. The AI app

The extension opens a setup page when it is first installed, with one action per app. "Connect an AI app" in the popup opens it again.

| App             | What to do                                                                                                                       | Needs Node.js |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Claude Desktop  | Download `itsme.mcpb` from the [latest release](https://github.com/alisaitteke/itsme/releases/latest), open it and press Install | No            |
| Cursor, VS Code | Press "Add to Cursor" or "Add to VS Code" on the setup page and confirm in the app                                               | Yes           |
| Claude Code     | `claude mcp add --scope user itsme -- npx -y itsme-mcp`                                                                          | Yes           |
| Anything else   | Add the entry below to its MCP settings                                                                                          | Yes           |

```json
{
  "mcpServers": {
    "itsme": { "command": "npx", "args": ["-y", "itsme-mcp"] }
  }
}
```

[docs/clients.md](docs/clients.md) has the steps for each app and a troubleshooting table.

To run a build from this checkout instead of the published package, use `node /absolute/path/to/itsme/packages/server/dist/cli.mjs` as the command. Once the browser is connected to such a build, the setup page offers that path by itself.

The popup shows whether the browser is connected and holds the actions: share the current tab, open the Automations, Connect and Settings pages, switch itsme off. Everything else is on the Settings page, which is the extension's options page: the debugger option, the animation, allowed and blocked sites, port and token.

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

## Tab groups

itsme only sees and touches tabs in its own tab groups. Tabs it opens go into a group named "itsme", or into one the agent names:

```json
{ "url": "https://example.com/fares", "group": "Flight prices", "color": "cyan" }
```

`tabs_open` creates the group if there is none by that name, and `tabs_group` moves tabs between groups or gives a group another color. The colors are the browser's: grey, blue, red, yellow, green, pink, purple, cyan, orange. A new group without a color gets a random one that no other itsme group has.

To let itsme work on a tab you already have open, press "Share this tab" in the popup or drag the tab into one of its groups; any other tab answers `TAB_NOT_SHARED`.

A group counts as itsme's because itsme made it, not because of its name, so a group of yours with the same name stays out of reach. The browser forgets which groups those were when it restarts or the extension is reloaded; only a group titled "itsme" is picked up again.

Firefox has no tab group API, so there the extension keeps its own list of shared tabs instead, and group names and colors are ignored.

## Marks and legend

`page_annotate` draws on the page for the user: a highlighter, an underline, a box, a circle or a bracket over quoted text or an element, each with a number, and a legend at the left that lists them. It is how a summary lands on the page itself, and how "where does it say that?" gets an answer the user can see.

- A mark is found by its `quote`, compared without regard to whitespace, case or the kind of quotes and dashes, or by an element `ref`. A quote that isn't on the page stays in the legend without a place, and the tool says so.
- Pressing a legend entry scrolls to its mark and draws it again. "Clear marks" removes everything, as does calling the tool with no marks or leaving the page.
- Nothing is added to the page's own elements. The marks are drawn in a layer over the page and follow the text when it moves. While the open legend would cover marked text, the page gets a left margin; folding the legend gives it back.
- Text inside iframes can't be marked.

## PDFs

The browser's own PDF viewer shows a document no extension can read or draw on. When a page tool reaches a tab that shows a PDF, itsme moves the tab into a reader of its own, built on pdf.js, and works there: `page_text` and `page_snapshot` give the text with a "Page 3 of 12" line before each page, and `page_annotate` marks it like any other page.

- The tools keep reporting the PDF's own address and name, and site permissions go by the site the PDF came from.
- "Open the original" in the reader opens the PDF in a new tab, in the browser's viewer. Back in the tab's history goes to it too.
- A scanned PDF is pictures of pages and has no text to read or mark. A password-protected one doesn't open; the reader says so.
- A PDF opened from disk needs "Allow access to file URLs" switched on for the extension.
- The whole document is read before the first answer, so a very long PDF takes a moment.

## Indicator

While itsme reads or drives a tab, the page shows an animation around its edges and a badge with a Stop button. Both go away four seconds after the last action. Pick the animation on the Settings page, which plays the chosen one on a made-up page:

| Style            | What you see                                        | When itsme acts                                                     |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| Aurora (default) | A band of green and mint light around the edges     | The frame flashes                                                   |
| Orbit            | Two light trails circling the frame                 | A third trail does a lap, starting from the side nearest the action |
| Viewfinder       | Corner marks and a label saying what itsme is doing | A reticle lands on the spot                                         |
| Ripple           | A frame of dots                                     | A ripple spreads from the spot and swells the dots it passes        |
| None             | Only the badge                                      |                                                                     |

The overlay never takes a click; only Stop does. It is left out of `page_screenshot`, and with "reduce motion" set in the system it shows a still frame.

## Automations

An automation is a page, a schedule and a list of steps. The AI app saves it; from then on the extension runs it by itself, with no server and no AI app running.

```json
{
  "name": "Morning check-in",
  "url": "https://hr.example.com/attendance",
  "schedule": { "every": "day", "at": "09:00", "days": ["mon", "tue", "wed", "thu", "fri"] },
  "steps": [
    { "do": "click", "target": { "role": "button", "name": "Check in" } },
    { "do": "wait", "text": "Checked in" }
  ]
}
```

- **Schedule:** every day at a time on your clock, optionally on some weekdays only, or every N seconds (`{ "every": "interval", "seconds": 3 }`, at least 1).
- **Steps:** `click`, `type`, `press`, `wait` and `open`. A step names its element by the role and name `page_snapshot` prints for it, so it is found again on a later day.
- **Approval:** a new automation waits until you approve it on the Automations page, which the popup opens. The toolbar button shows a count while one is waiting. No tool can approve one or turn one back on.
- **Sites:** it works only on the sites of its own URLs. A click that leads anywhere else fails the run. Blocked sites stay blocked.
- **Tabs:** each automation has a tab of its own, opened in the background in a tab group named "itsme automations", which the MCP tools can't reach. A daily one opens its tab for the run and closes it afterwards; after a failed run the tab stays so you can look at the page.
- **Stopping:** Stop on the automation's page, Pause on the Automations page, or closing the tab of a repeating one. The switch in the popup stops all of them.
- **Failures:** an element that doesn't show up within 10 seconds fails the run (within the interval, for one that repeats faster than that). Three failed runs in a row pause the automation, and the toolbar button says so.
- **Missed runs:** if the browser was closed at the time of a daily automation, it runs when the browser is opened later the same day.

Automations click and type with scripted events, so they work in a background tab and show no debugging bar; sites that need real input won't respond to them. They never type into a password field, and the text of a `type` step is stored as it is in the extension's storage, so keep secrets out of it.

Nothing runs while the browser is closed or the computer is asleep.

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

The Settings page lists the allowed and the blocked sites; blocked ones are refused whatever else is set, navigation included. Turn "Ask before using a new site" off there to allow every site that isn't blocked.

## Debugger

On Chromium the extension uses `chrome.debugger` for three things: real mouse and keyboard input, so pages see trusted events and a user gesture; the console; and network recording. While a tab is attached the browser shows a "started debugging this browser" bar.

- The debugger attaches on the first pointer, keyboard, console or network call in a tab. It detaches when the server disconnects, or after two minutes without use (ten while a tab is being recorded).
- Pressing Cancel on the bar turns the option off. Turn it back on in the Settings page.
- For input, the tab is made the visible one in its window first; a hidden tab doesn't answer input.
- Scripted DOM events are used instead when the option is off, in Firefox, when the debugger can't attach, when something covers the element, for `<select>` elements and for clearing a field to empty. `page_drag`, `page_console` and `page_network` have no scripted version and answer `UNSUPPORTED`.
- `page_console` returns what the page logged before the recording started as well. `page_network` only has requests made after its first call on a tab, so call it once and then reload to capture a page load.

## Configuration

| Variable            | Default | Notes                                                                  |
| ------------------- | ------- | ---------------------------------------------------------------------- |
| `ITSME_PORT`        | `47821` | Also `--port`. Set the same port in the extension's options            |
| `ITSME_TOKEN`       | (none)  | Shared secret; enter the same value in the extension's options         |
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
pnpm bundle          # Claude Desktop bundle: packages/server/dist/itsme.mcpb
```

[docs/releasing.md](docs/releasing.md) has the steps for publishing a release.

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
    scripts/       builds the Claude Desktop bundle
  extension/   WXT project
    src/background/   connection, command router, handlers (extension APIs)
      input/            pointer and keyboard drivers: debugger (real input) and DOM
      debugger/         debugger sessions, console and network recording
      session-tabs.ts   itsme's tab groups
      automations/      store, runner and scheduler for saved automations
      site-access.ts    allowed and blocked sites, the wait for the prompt
    src/agent/        content script: outline, find, geometry, scripted actions, site prompt, indicator
      annotate/         marks drawn over the page and their legend
      effects/          the indicator's animations, one file each
    src/entrypoints/  background, agent content script, popup, options, setup and automations pages, the animation preview, the PDF reader
    src/ui/           what the pages share: styles, top bar, status
    brand/, scripts/  the mark and the script that draws the icons from it (`pnpm --filter @itsme/extension icons`)
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
- An automation runs only after the user approves it in the extension, only on the sites of its own URLs, and never types into password fields. Its page takes the approval from the extension's own pages only, and only from a real click.
- Tabs outside itsme's groups can't be listed, read or driven, and `tabs_group` only moves tabs that are already in one.
- While itsme reads or drives a tab, the page shows an animation and a badge with a Stop button. Stop switches the bridge off until it is turned back on in the popup.
- Pages of a site the user hasn't allowed can't be read or driven. The prompt sits in a closed shadow root and only accepts a real click, so neither the page nor a tool call can answer it.
- `page_network` records no headers or bodies, and redacts credentials in URLs.
- `page_upload` reads only from the folders in `ITSME_UPLOAD_DIRS` and refuses credential files.
- The Chromium build asks for the `debugger` permission. It is used for input, the console and network recording, nothing else.

## Known limits

- Where real input isn't used (see above), clicks and typing are scripted DOM events. Sites that require trusted events or a user gesture (popups, file pickers, clipboard) won't respond to those. Firefox has no debugger API, so it always works this way.
- Typed text arrives as one insertion, without per-key `keydown`/`keyup` events.
- Automations have no conditions or loops, and can't report what they read on a page back to the AI app.
- A repeating automation's run count is saved every few seconds, so the count can trail by a few runs.
- A file input is listed even when the page hides it, but not when it sits inside a hidden container.
- Objects in console messages logged before the recording started show up as `Object`, without their contents.
- Cross-origin iframes and closed shadow roots can't be read; a cross-origin frame shows up in the snapshot as a single `frame` line.
- `page_drag` moves the mouse with the button held. It works for sliders, sortable lists and canvases, but not for pages built on the HTML5 drag-and-drop API.
- Some editing shortcuts are handled by the operating system rather than the page, so `page_press` with a modifier may reach the page without having its usual effect.
- Browser pages such as `chrome://` and the extension store can't be scripted; tools return `PAGE_NOT_ACCESSIBLE`.
- With several browsers connected, commands go to the one that connected last.
- Firefox will need `data_collection_permissions` in the manifest before it can be published.
