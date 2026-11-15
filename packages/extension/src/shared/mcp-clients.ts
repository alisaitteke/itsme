import { DEFAULT_PORT, type Launch } from '@itsme/protocol';

const SERVER_NAME = 'itsme';
const NPM_PACKAGE = 'itsme-mcp';
const BUNDLE_URL = 'https://github.com/alisaitteke/itsme/releases/latest/download/itsme.mcpb';

export const CLIENTS = [
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'other', label: 'Another client' },
] as const;
export type ClientId = (typeof CLIENTS)[number]['id'];

export interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The quickest way to add the server to a client. */
export type QuickAction =
  /** Opens a link: a download, or a link the client itself handles. */
  | { kind: 'open'; label: string; url: string; next: string }
  /** Puts text on the clipboard. */
  | { kind: 'copy'; label: string; text: string; next: string };

export interface Snippet {
  text: string;
  /** Where the text goes. */
  where: string;
}

/** A server run from a checkout of this repository, as its developers do. */
const isLocalBuild = (launch: Launch) =>
  /[\\/]packages[\\/]server[\\/]dist[\\/]cli\.mjs$/.test(launch.args[0] ?? '');

/**
 * The entry a client needs to start the server on the same port and with the same token.
 * It runs the published package, unless this browser is talking to a local build.
 */
export function serverEntry(
  launch: Launch | null,
  settings: { port: number; token: string },
): ServerEntry {
  const env: Record<string, string> = {};
  if (settings.port !== DEFAULT_PORT) env.ITSME_PORT = String(settings.port);
  if (settings.token) env.ITSME_TOKEN = settings.token;
  return launch && isLocalBuild(launch)
    ? { command: launch.command, args: launch.args, env }
    : { command: 'npx', args: ['-y', NPM_PACKAGE], env };
}

function shellQuote(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandLine(entry: ServerEntry): string {
  return [entry.command, ...entry.args].map(shellQuote).join(' ');
}

function envFlags(entry: ServerEntry, flag: string): string {
  return Object.entries(entry.env)
    .map(([name, value]) => `${flag} ${shellQuote(`${name}=${value}`)} `)
    .join('');
}

/** The entry as it appears in a client's JSON, without `env` when there is nothing to set. */
function jsonEntry(entry: ServerEntry): Record<string, unknown> {
  return {
    command: entry.command,
    args: entry.args,
    ...(Object.keys(entry.env).length > 0 ? { env: entry.env } : {}),
  };
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** What to paste or run to add the server by hand. */
export function snippetFor(client: ClientId, entry: ServerEntry): Snippet {
  switch (client) {
    case 'claude-code':
      return {
        text: `claude mcp add --scope user ${SERVER_NAME} ${envFlags(entry, '-e')}-- ${commandLine(entry)}`,
        where: 'Run it in a terminal, then start a new Claude Code session.',
      };
    case 'codex':
      return {
        text: `codex mcp add ${SERVER_NAME} ${envFlags(entry, '--env')}-- ${commandLine(entry)}`,
        where: 'Run it in a terminal.',
      };
    case 'claude-desktop':
      return {
        text: json({ mcpServers: { [SERVER_NAME]: jsonEntry(entry) } }),
        where:
          'Merge it into claude_desktop_config.json (Settings, Developer, Edit Config), then restart the app.',
      };
    case 'cursor':
      return {
        text: json({ mcpServers: { [SERVER_NAME]: jsonEntry(entry) } }),
        where: 'Merge it into ~/.cursor/mcp.json.',
      };
    case 'vscode':
      return {
        text: json({ servers: { [SERVER_NAME]: { type: 'stdio', ...jsonEntry(entry) } } }),
        where: 'Merge it into .vscode/mcp.json in your workspace.',
      };
    case 'other':
      return {
        text: json({ mcpServers: { [SERVER_NAME]: jsonEntry(entry) } }),
        where: 'Most clients take this entry in their MCP settings file.',
      };
  }
}

function base64(text: string): string {
  // btoa only takes Latin-1, and a path can hold any character.
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** Cursor's install link: opening it makes Cursor offer to add the server. */
function cursorLink(entry: ServerEntry): string {
  const config = encodeURIComponent(base64(JSON.stringify(jsonEntry(entry))));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${config}`;
}

/** VS Code's install link: opening it shows the server for review before it is added. */
function vscodeLink(entry: ServerEntry): string {
  const config = { name: SERVER_NAME, ...jsonEntry(entry) };
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(config))}`;
}

export function quickActionFor(client: ClientId, entry: ServerEntry): QuickAction {
  switch (client) {
    case 'claude-desktop':
      return {
        kind: 'open',
        label: 'Download',
        url: BUNDLE_URL,
        // Claude Desktop brings its own Node, so this is the one route that needs nothing else.
        next: 'Open the downloaded itsme.mcpb and press Install. Nothing else to set up.',
      };
    case 'cursor':
      return {
        kind: 'open',
        label: 'Add to Cursor',
        url: cursorLink(entry),
        next: 'Cursor opens and asks you to confirm. It needs Node.js on this computer.',
      };
    case 'vscode':
      return {
        kind: 'open',
        label: 'Add to VS Code',
        url: vscodeLink(entry),
        next: 'VS Code opens with the server ready to review. It needs Node.js on this computer.',
      };
    case 'claude-code':
    case 'codex':
      return {
        kind: 'copy',
        label: 'Copy command',
        text: snippetFor(client, entry).text,
        next: 'Copied. Paste it in a terminal and press Enter. It needs Node.js on this computer.',
      };
    case 'other':
      return {
        kind: 'copy',
        label: 'Copy entry',
        text: snippetFor(client, entry).text,
        next: "Copied. Paste it into the client's MCP settings. It needs Node.js on this computer.",
      };
  }
}
