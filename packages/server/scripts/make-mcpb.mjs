// Packs the built server as a Claude Desktop bundle: dist/itsme.mcpb.
// Run through `pnpm bundle`, which builds dist/cli.mjs first.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { markPng } from '../../extension/scripts/brand-mark.mjs';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'dist/cli.mjs');
const stage = join(root, 'dist/mcpb');
const output = join(root, 'dist/itsme.mcpb');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repo = 'https://github.com/alisaitteke/itsme';

/** The tools as the built server reports them, so the manifest can't drift from the code. */
async function listTools() {
  // A port of its own: the default one may belong to a server that is really in use.
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));

  const client = new Client({ name: 'make-mcpb', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cli, '--port', String(port)],
      env: { ...process.env, ITSME_LOG_LEVEL: 'silent' },
    }),
  );
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      // The first sentence is enough for a list.
      description: (tool.description ?? '').split(/(?<=\.)\s/)[0],
    }));
  } finally {
    await client.close();
  }
}

const manifest = {
  manifest_version: '0.3',
  name: 'itsme',
  display_name: 'itsme',
  version: pkg.version,
  description: 'Lets Claude drive your own browser through the itsme extension.',
  long_description:
    'itsme connects Claude to the browser you already use, with your logins. Claude can open ' +
    'tabs, read pages, click, type and take screenshots, but only in the tabs of its own tab ' +
    'group and only on sites you have allowed. It needs the itsme browser extension.',
  author: { name: 'Ali Sait Teke', url: 'https://github.com/alisaitteke' },
  homepage: repo,
  documentation: `${repo}#readme`,
  support: `${repo}/issues`,
  repository: { type: 'git', url: `${repo}.git` },
  icon: 'icon.png',
  keywords: ['browser', 'automation', 'tabs', 'web'],
  server: {
    type: 'node',
    entry_point: 'server/cli.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/cli.mjs'],
      env: {
        ITSME_PORT: '${user_config.port}',
        ITSME_UPLOAD_DIRS: '${user_config.upload_dir}',
      },
    },
  },
  user_config: {
    port: {
      type: 'number',
      title: 'Port',
      description: 'Port the browser extension connects to. Change it in the extension too.',
      default: 47821,
      min: 1,
      max: 65535,
      required: false,
    },
    upload_dir: {
      type: 'directory',
      title: 'Upload folder',
      description: 'Optional. The only folder files may be uploaded to web pages from.',
      required: false,
    },
  },
  compatibility: {
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: pkg.engines.node },
  },
  tools: await listTools(),
};

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'server'), { recursive: true });
copyFileSync(cli, join(stage, 'server/cli.mjs'));
writeFileSync(join(stage, 'icon.png'), markPng(512));
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const mcpb = (...args) =>
  execFileSync('pnpm', ['exec', 'mcpb', ...args], { cwd: root, stdio: 'inherit' });
mcpb('validate', join(stage, 'manifest.json'));
rmSync(output, { force: true });
mcpb('pack', stage, output);
rmSync(stage, { recursive: true, force: true });

console.log(
  `${output} (${Math.round(statSync(output).size / 1024)} kB, ${manifest.tools.length} tools)`,
);
