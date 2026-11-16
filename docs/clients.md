# Connecting an MCP client

itsme is a local stdio MCP server, published on npm as `itsme-mcp`. The extension's Connect page ("Connect an AI app" in the popup) does this for Claude Desktop, Cursor, VS Code, Claude Code and Codex in one click or one pasted command. This page covers the same apps by hand, and the ones the Connect page doesn't list.

The steps follow each app's own documentation as of November 2026. Only the Claude Code entry has been used with this project so far, and Devin Desktop's documentation doesn't spell out its file format.

## What an app needs

Claude Desktop needs nothing: its bundle carries the server, and the app brings its own Node.js.

Every other app starts the server with `npx`, so it needs Node.js 20 or newer on the computer. Most take an entry of this shape:

```json
{
  "mcpServers": {
    "itsme": {
      "command": "npx",
      "args": ["-y", "itsme-mcp"]
    }
  }
}
```

Settings go in `env`. All of them are optional; see the [README](../README.md#configuration) for what each does.

```json
"env": {
  "ITSME_UPLOAD_DIRS": "/Users/me/Downloads"
}
```

If an app says it can't find `npx`, it isn't reading your shell's `PATH`, which is common for desktop apps when Node comes from nvm, fnm or asdf. Give it the full path instead, from `command -v npx`.

To run a build from a checkout of this repository, use `node` as the command and the absolute path to `packages/server/dist/cli.mjs` as its only argument.

## Claude Desktop

Download `itsme.mcpb` from the [latest release](https://github.com/alisaitteke/itsme/releases/latest), open it and press Install. Port and upload folder are on the extension's page under Settings → Extensions.

By hand instead: Settings → Developer → Edit Config opens `claude_desktop_config.json`. Add the entry above under `mcpServers`, then quit the app completely and open it again.

| OS      | File                                                              |
| ------- | ----------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                     |

## Claude Code

```bash
claude mcp add --scope user itsme -- npx -y itsme-mcp
```

`--scope user` makes it available in every project; leave it out to add it to the current project only. Check with `/mcp` in a session.

Settings go after the name and before the `--`:

```bash
claude mcp add --scope user itsme -e ITSME_UPLOAD_DIRS=/Users/me/Downloads -- npx -y itsme-mcp
```

## Cursor

"Add to Cursor" on the Connect page opens Cursor's own install prompt.

By hand: put the entry above in `~/.cursor/mcp.json` for every project, or in `.cursor/mcp.json` at a project root for that project. A project entry wins over a global one with the same name. Cursor's MCP settings page shows whether the server started.

## VS Code (Copilot)

"Add to VS Code" on the Connect page opens the server in VS Code for review before it is added.

By hand: run **Chat: Open Customizations**, pick **MCP Servers**, press **Add Server** in the User group, choose **Command (stdio)**, enter `npx -y itsme-mcp`, name it `itsme` and pick **Global**.

VS Code also still reads `.vscode/mcp.json`, whose top-level key is `servers`, not `mcpServers`. Its documentation marks that format as deprecated, to be removed in February 2027.

```json
{
  "servers": {
    "itsme": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "itsme-mcp"]
    }
  }
}
```

## Codex

```bash
codex mcp add itsme -- npx -y itsme-mcp
```

Add settings with `--env NAME=value` before the `--`. The CLI, the IDE extension and the desktop app share `~/.codex/config.toml`, where the same entry looks like this:

```toml
[mcp_servers.itsme]
command = "npx"
args = ["-y", "itsme-mcp"]

[mcp_servers.itsme.env]
ITSME_UPLOAD_DIRS = "/Users/me/Downloads"
```

Check with `codex mcp list`, or `/mcp` inside a session.

## Antigravity CLI and Gemini CLI

Antigravity CLI replaced Gemini CLI in June 2026. Put the entry above in `~/.gemini/config/mcp_config.json`, restart `agy` and check with `/mcp`.

In Gemini CLI itself:

```bash
gemini mcp add -s user itsme npx -y itsme-mcp
```

Options go before the name: `-s user` writes to `~/.gemini/settings.json` instead of the project, `-e NAME=value` adds a setting. A stdio server stays disconnected in a folder Gemini CLI doesn't trust; run `gemini trust` there.

## Devin Desktop (formerly Windsurf)

Open **Customize** in the agent sidebar, go to the **MCPs** tab, choose **This computer** and add the server there. The file behind it is `~/.config/devin/mcp_config.json`.

Older Windsurf builds read `~/.codeium/windsurf/mcp_config.json`, which takes the entry above as is.

## Cline

In the Cline panel, open the MCP Servers icon, the **Configure** tab, then **Configure MCP Servers**. That opens `cline_mcp_settings.json`; add the entry above. Cline's own fields are optional:

```json
"itsme": {
  "command": "npx",
  "args": ["-y", "itsme-mcp"],
  "disabled": false,
  "autoApprove": ["browser_status", "tabs_list", "page_snapshot", "page_find", "page_text"]
}
```

Keep `autoApprove` to tools that only read.

## Zed

Settings → AI → MCP Servers → Add Server → Add Local Server, or add this to `settings.json`. The key is `context_servers`:

```json
{
  "context_servers": {
    "itsme": {
      "command": "npx",
      "args": ["-y", "itsme-mcp"],
      "env": {}
    }
  }
}
```

A green dot next to the name in the MCP Servers list means it is running.

## opencode

In `opencode.json`, the command and its arguments are one array, and settings go in `environment`:

```json
{
  "mcp": {
    "itsme": {
      "type": "local",
      "command": ["npx", "-y", "itsme-mcp"],
      "enabled": true,
      "environment": {}
    }
  }
}
```

## Any other client

Anything that can start a stdio MCP server works. Give it `npx` as the command and `-y`, `itsme-mcp` as the arguments. The server takes its settings from environment variables.

## Check that it works

1. Open the browser with the extension enabled. The popup should say "Connected to server".
2. Ask the agent to call `browser_status`. It should list one browser.
3. Ask it to open a page. The tab appears in a tab group named "itsme", and the page asks you to allow the site the first time.

## Several clients at once

Each client starts its own server, and they all reach the same browser: the first server takes port 47821 and the others relay through it. Nothing has to be configured for that. Clients that set `ITSME_PORT` must all set the same value.

## After updating itsme

Reload the extension on its browser's extensions page and restart every client so that each starts the new server. A server left running from before the update gives up the port when a newer one starts, and its tools answer that the client needs a restart.

`npx` keeps the copy it downloaded. To move to a newer release, use `npx -y itsme-mcp@latest` as the command, or clear its cache with `npx clear-npx-cache`.

## Troubleshooting

| Symptom                                                    | Cause and fix                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| The tools don't show up, or the server fails to start      | The app can't find `npx`. Use the full path from `command -v npx`                             |
| `NOT_CONNECTED: No browser is connected`                   | The browser is closed, or itsme is turned off in its popup                                    |
| Popup says "Version mismatch"                              | Server and extension are from different releases. Reload the extension and restart the client |
| Popup says "Restart your AI apps"                          | An app still runs a server from before tokens were dropped. Quit and reopen the apps          |
| Log says the port is busy with a server of another version | An old server is still running. Close the client that started it                              |
| `TAB_NOT_SHARED`                                           | The tab isn't in an itsme group. Press "Share this tab" in the popup                          |
| `SITE_NOT_ALLOWED`                                         | Press Allow on the page, or add the site in the extension's options                           |
| `page_upload` says uploads are off                         | Set `ITSME_UPLOAD_DIRS` in the client's entry                                                 |
