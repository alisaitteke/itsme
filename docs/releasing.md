# Releasing

A release has three parts that have to match: the npm package, the Claude Desktop bundle and the extension. The extension's setup page points at the first two by name, so both must exist before anyone installs the extension.

## 1. Version

Set the same version in `packages/server/package.json`, `packages/extension/package.json` and `packages/protocol/package.json`.

If the wire format changed in a way the other side can't ignore, `PROTOCOL_VERSION` in `packages/protocol/src/constants.ts` goes up too. Server and extension then refuse to talk across the change, so release them together.

## 2. Check

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
CHROME_PATH="/path/to/Google Chrome for Testing" pnpm test:e2e
```

## 3. npm package

```bash
cd packages/server
npm publish
```

`prepublishOnly` builds first. The package is one file, `dist/cli.mjs`, with every dependency inside it. Check what goes out with `npm pack --dry-run`.

Afterwards, in an empty folder:

```bash
npx -y itsme-mcp --version
```

## 4. Claude Desktop bundle

```bash
pnpm bundle
```

That writes `packages/server/dist/itsme.mcpb`: the same `cli.mjs`, an icon and a manifest whose tool list is read from the built server. Install it in Claude Desktop once before publishing it: open the file, press Install, restart the app, ask for `browser_status`.

Attach the file to a GitHub release under exactly the name `itsme.mcpb`. The setup page downloads `releases/latest/download/itsme.mcpb`.

```bash
gh release create v0.1.0 packages/server/dist/itsme.mcpb --title v0.1.0 --notes "First release"
```

## 5. Extension

```bash
pnpm --filter @itsme/extension zip
pnpm --filter @itsme/extension zip:firefox
```

The zips are in `packages/extension/.output/`. Upload the Chrome one to the Chrome Web Store.

## Not decided yet

- The repository has no license file, and the npm package and the bundle name none.
- The Firefox build has never been run in Firefox.
