import { describe, expect, it } from 'vitest';
import { CLIENTS, quickActionFor, serverEntry, snippetFor } from '../src/shared/mcp-clients.ts';

const local = { command: '/usr/local/bin/node', args: ['/src/itsme/packages/server/dist/cli.mjs'] };
const defaults = { port: 47821, token: '' };
const npx = { command: 'npx', args: ['-y', 'itsme-mcp'], env: {} };

describe('serverEntry', () => {
  it('runs the published package for a browser that has never connected', () => {
    expect(serverEntry(null, defaults)).toEqual(npx);
  });

  it('runs the published package when the server came from npm or a bundle', () => {
    for (const path of [
      '/Users/me/.npm/_npx/ab12/node_modules/itsme-mcp/dist/cli.mjs',
      '/Users/me/Library/Application Support/Claude/Claude Extensions/itsme/server/cli.mjs',
      'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\itsme-mcp\\dist\\cli.mjs',
    ]) {
      expect(serverEntry({ command: 'node', args: [path] }, defaults)).toEqual(npx);
    }
  });

  it('keeps the path of a local build, on any platform', () => {
    expect(serverEntry(local, defaults)).toEqual({ ...local, env: {} });
    const windows = {
      command: 'node.exe',
      args: ['C:\\src\\itsme\\packages\\server\\dist\\cli.mjs'],
    };
    expect(serverEntry(windows, defaults).command).toBe('node.exe');
  });

  it('carries a changed port and a token over to the new client', () => {
    expect(serverEntry(null, { port: 5000, token: 's3cret' }).env).toEqual({
      ITSME_PORT: '5000',
      ITSME_TOKEN: 's3cret',
    });
  });
});

describe('snippetFor', () => {
  const entry = serverEntry(null, defaults);

  it('gives Claude Code and Codex a command', () => {
    expect(snippetFor('claude-code', entry).text).toBe(
      'claude mcp add --scope user itsme -- npx -y itsme-mcp',
    );
    expect(snippetFor('codex', entry).text).toBe('codex mcp add itsme -- npx -y itsme-mcp');
  });

  it('puts settings before the -- and quotes what a shell would split', () => {
    const spaced = serverEntry(
      { command: '/Users/me/My Tools/node', args: ["/it's/packages/server/dist/cli.mjs"] },
      { port: 5000, token: 'a b' },
    );
    expect(snippetFor('claude-code', spaced).text).toBe(
      "claude mcp add --scope user itsme -e ITSME_PORT=5000 -e 'ITSME_TOKEN=a b' -- " +
        "'/Users/me/My Tools/node' '/it'\\''s/packages/server/dist/cli.mjs'",
    );
    expect(snippetFor('codex', spaced).text).toContain("--env 'ITSME_TOKEN=a b' -- ");
  });

  it('gives JSON clients an mcpServers entry, without env when there is none', () => {
    for (const client of ['claude-desktop', 'cursor', 'other'] as const) {
      expect(JSON.parse(snippetFor(client, entry).text)).toEqual({
        mcpServers: { itsme: { command: 'npx', args: ['-y', 'itsme-mcp'] } },
      });
    }
    const withToken = serverEntry(null, { port: 47821, token: 't' });
    expect(JSON.parse(snippetFor('cursor', withToken).text).mcpServers.itsme.env).toEqual({
      ITSME_TOKEN: 't',
    });
  });

  it('uses the "servers" key and a type for VS Code', () => {
    expect(JSON.parse(snippetFor('vscode', entry).text)).toEqual({
      servers: { itsme: { type: 'stdio', command: 'npx', args: ['-y', 'itsme-mcp'] } },
    });
  });
});

describe('quickActionFor', () => {
  const entry = serverEntry(null, { port: 47821, token: 'gizli-şifre' });

  it('has an action and a next step for every client', () => {
    for (const { id } of CLIENTS) {
      const action = quickActionFor(id, entry);
      expect(action.label).not.toBe('');
      expect(action.next).not.toBe('');
    }
  });

  it('sends Claude Desktop to the bundle of the latest release', () => {
    expect(quickActionFor('claude-desktop', entry)).toMatchObject({
      kind: 'open',
      url: 'https://github.com/alisaitteke/itsme/releases/latest/download/itsme.mcpb',
    });
  });

  it('gives Cursor its install link, with the entry as base64 JSON', () => {
    const action = quickActionFor('cursor', entry);
    if (action.kind !== 'open') throw new Error('expected a link');
    const link = new URL(action.url);

    expect(`${link.protocol}//${link.host}${link.pathname}`).toBe(
      'cursor://anysphere.cursor-deeplink/mcp/install',
    );
    expect(link.searchParams.get('name')).toBe('itsme');
    // Also for text outside Latin-1, which plain btoa refuses.
    const config = Buffer.from(link.searchParams.get('config') ?? '', 'base64').toString('utf8');
    expect(JSON.parse(config)).toEqual({
      command: 'npx',
      args: ['-y', 'itsme-mcp'],
      env: { ITSME_TOKEN: 'gizli-şifre' },
    });
  });

  it('gives VS Code its install link, with the name in the entry', () => {
    const action = quickActionFor('vscode', entry);
    if (action.kind !== 'open') throw new Error('expected a link');
    expect(action.url.startsWith('vscode:mcp/install?')).toBe(true);
    expect(JSON.parse(decodeURIComponent(action.url.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'itsme',
      command: 'npx',
      args: ['-y', 'itsme-mcp'],
      env: { ITSME_TOKEN: 'gizli-şifre' },
    });
  });

  it('copies the command for the terminal clients', () => {
    expect(quickActionFor('claude-code', serverEntry(null, defaults))).toMatchObject({
      kind: 'copy',
      text: 'claude mcp add --scope user itsme -- npx -y itsme-mcp',
    });
  });
});
