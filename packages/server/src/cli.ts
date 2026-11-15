#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import pkg from '../package.json' with { type: 'json' };
import { Bridge } from './bridge/bridge.ts';
import { type CliAction, parseCli, usage } from './config.ts';
import { createLogger } from './logger.ts';
import { createMcpServer } from './mcp/server.ts';
import { resolveUploadDirs } from './mcp/uploads.ts';

async function main(): Promise<void> {
  let action: CliAction;
  try {
    action = parseCli(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${usage}`);
    process.exit(2);
  }
  if (action.kind === 'help') {
    process.stdout.write(usage);
    return;
  }
  if (action.kind === 'version') {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  const { config } = action;
  const logger = createLogger(config.logLevel);
  const bridge = new Bridge({
    port: config.port,
    token: config.token,
    requestTimeoutMs: config.requestTimeoutMs,
    serverVersion: pkg.version,
    launch: { command: process.execPath, args: [fileURLToPath(import.meta.url)] },
    logger,
  });
  await bridge.start();

  const uploadDirs = await resolveUploadDirs(config.uploadDirs);
  const server = createMcpServer(bridge, pkg.version, { uploadDirs });
  await server.connect(new StdioServerTransport());

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await Promise.allSettled([server.close(), bridge.stop()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // The MCP client closing stdin is the normal way this process ends.
  process.stdin.on('close', shutdown);
}

main().catch((error) => {
  process.stderr.write(`[itsme] fatal ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
