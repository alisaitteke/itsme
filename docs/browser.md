# Working in the browser

How itsme reaches tabs and sites, what it shows the user, and where it stops. Setup is in the [README](../README.md); connecting apps by hand is in [clients.md](clients.md).

## Tab groups

itsme only sees and touches tabs in its own tab groups. Tabs it opens go into a group named "itsme", or into one the agent names:

```json
{ "url": "https://example.com/fares", "group": "Flight prices", "color": "cyan" }
```

`tabs_open` creates the group if there is none by that name, and `tabs_group` moves tabs between groups or gives a group another color. The colors are the browser's: grey, blue, red, yellow, green, pink, purple, cyan, orange. A new group without a color gets a random one that no other itsme group has.

To let itsme work on a tab you already have open, press "Share this tab" in the popup or drag the tab into one of its groups; any other tab answers `TAB_NOT_SHARED`.

A group counts as itsme's because itsme made it, not because of its name, so a group of yours with the same name stays out of reach. The browser forgets which groups those were when it restarts or the extension is reloaded; only a group titled "itsme" is picked up again.

Firefox has no tab group API, so there the extension keeps its own list of shared tabs instead, and group names and colors are ignored.

## Sites

A site has to be allowed before its pages are read or driven. The first time a tool touches a new site, a prompt appears on the page and the tool call waits up to a minute for the answer:

- "Allow" remembers the site, subdomains included.
- "Not now" fails that call with `SITE_NOT_ALLOWED`; the next call asks again.
- Sharing a tab from the popup allows its site.

The Settings page lists the allowed and the blocked sites; blocked ones are refused whatever else is set, navigation included. Turn "Ask before using a new site" off there to allow every site that isn't blocked.

## Snapshots and refs

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

## Marks and legend

`page_annotate` draws on the page for the user: a highlighter, an underline, a box, a circle or a bracket over quoted text or an element, each with a number, and a legend at the left that lists them. It is how a summary lands on the page itself, and how "where does it say that?" gets an answer the user can see.

- A mark is found by its `quote`, compared without regard to whitespace, case or the kind of quotes and dashes, or by an element `ref`. A quote that isn't on the page stays in the legend without a place, and the tool says so.
- Pressing a legend entry scrolls to its mark and draws it again. "Clear marks" removes everything, as does calling the tool with no marks or leaving the page.
- The legend is set in the extension's own typeface, which the background hands to the page as data because a page may forbid fonts from elsewhere.
- Nothing is added to the page's own elements. The marks are drawn in a layer over the page and follow the text when it moves. While the open legend would cover marked text, the page gets a left margin; folding the legend gives it back.
- Text inside iframes can't be marked.

## PDFs

The browser's own PDF viewer shows a document no extension can read or draw on. When a page tool reaches a tab that shows a PDF, itsme moves the tab into a reader of its own, built on pdf.js, and works there: `page_text` and `page_snapshot` give the text with a "Page 3 of 12" line before each page, and `page_annotate` marks it like any other page.

- The tools keep reporting the PDF's own address and name. Site permissions go by the site the PDF came from: a new site is asked about in the browser's viewer, and only a yes moves the tab into the reader.
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

## Uploads

`page_upload` is off until you name the folders it may read from:

```json
"env": { "ITSME_UPLOAD_DIRS": "/Users/me/Downloads:/Users/me/project/fixtures" }
```

Files outside those folders are refused, symlinks are resolved first, and so is anything that looks like a credential (`.env`, `*.pem`, `id_rsa`, anything under `.ssh` or `.aws`). One call can carry 10 MB. The files are set on the input by script, so no file dialog opens.

## Debugger

On Chromium the extension uses `chrome.debugger` for three things: real mouse and keyboard input, so pages see trusted events and a user gesture; the console; and network recording. While a tab is attached the browser shows a "started debugging this browser" bar.

- The debugger attaches on the first pointer, keyboard, console or network call in a tab. It detaches when the server disconnects, or after two minutes without use (ten while a tab is being recorded).
- This is "Real mouse and keyboard" on the Settings page. Pressing Cancel on the bar turns it off; turn it back on there.
- For input, the tab is made the visible one in its window first; a hidden tab doesn't answer input.
- Scripted DOM events are used instead when it is off, in Firefox, when the debugger can't attach, when something covers the element, for `<select>` elements and for clearing a field to empty. `page_drag`, `page_console` and `page_network` have no scripted version and answer `UNSUPPORTED`.
- `page_console` returns what the page logged before the recording started as well. `page_network` only has requests made after its first call on a tab, so call it once and then reload to capture a page load.

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
