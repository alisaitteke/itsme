# Development

To point an app at this checkout instead of the published package, use `node /absolute/path/to/itsme/packages/server/dist/cli.mjs` as the command. Once the browser is connected to such a build, the Connect page offers that path by itself.

```bash
pnpm dev:extension   # Chrome with the extension loaded and hot reload
pnpm dev:server      # rebuild the server on change
pnpm test            # unit and integration tests
pnpm typecheck
pnpm lint
pnpm build:firefox   # output in packages/extension/.output/firefox-mv3
pnpm bundle          # Claude Desktop bundle: packages/server/dist/itsme.mcpb
```

[releasing.md](releasing.md) has the steps for publishing a release.

`pnpm test:e2e` builds a copy of the extension with its own port and runs it in a real browser with a throwaway profile, so it never reaches a browser or server you are using. It needs a Chromium that still accepts `--load-extension`, such as Chrome for Testing; Google Chrome dropped the flag.

```bash
CHROME_PATH="/path/to/Google Chrome for Testing" pnpm test:e2e
```

## Layout

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
    brand/, scripts/  the mark and the script that draws the icons and `mark.svg` from it (`pnpm --filter @itsme/extension icons`)
tests/
  integration/   MCP client through to the extension's connection and router, in Node
  e2e/           the same path in a real Chromium
```

## Adding a command

1. Define params and result in `packages/protocol/src/commands.ts`.
2. Add a handler under `packages/extension/src/background/handlers/`.
3. Register the tool in `packages/server/src/mcp/tools.ts`.

A browser build that can't support a command leaves its handler out; the extension reports the commands it has, and the server answers `UNSUPPORTED` for the rest.
