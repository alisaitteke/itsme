# itsme-mcp

MCP server that lets an AI client drive the browser you already use, through the [itsme](https://github.com/alisaitteke/itsme) browser extension: open tabs, read pages, click, type and take screenshots.

It does nothing without the extension. Install that first; its setup page adds this server to Claude Desktop, Cursor, VS Code, Claude Code and Codex.

## Use

Add it to an MCP client as a stdio server:

```json
{
  "mcpServers": {
    "itsme": { "command": "npx", "args": ["-y", "itsme-mcp"] }
  }
}
```

```bash
claude mcp add --scope user itsme -- npx -y itsme-mcp
```

Needs Node.js 20 or newer.

## Configuration

| Variable            | Default | Notes                                                         |
| ------------------- | ------- | ------------------------------------------------------------- |
| `ITSME_PORT`        | `47821` | Port the extension connects to. Also `--port`                 |
| `ITSME_UPLOAD_DIRS` | (none)  | Folders `page_upload` may read from                           |
| `ITSME_TIMEOUT_MS`  | `30000` | Per-command timeout                                           |
| `ITSME_LOG_LEVEL`   | `info`  | `debug`, `info`, `warn`, `error`, `silent`. Logs go to stderr |

Tools and security notes are in the [project README](https://github.com/alisaitteke/itsme#readme), limits in [docs/browser.md](https://github.com/alisaitteke/itsme/blob/main/docs/browser.md#known-limits).
