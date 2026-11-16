import { delimiter } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_PORT, DEFAULT_REQUEST_TIMEOUT_MS } from '@itsme/protocol';
import { isLogLevel, type LogLevel } from './logger.ts';

export interface Config {
  port: number;
  requestTimeoutMs: number;
  /** Folders page_upload may read from. Empty: uploads are off. */
  uploadDirs: string[];
  logLevel: LogLevel;
}

export type CliAction = { kind: 'run'; config: Config } | { kind: 'help' } | { kind: 'version' };

export const usage = `Usage: itsme-mcp [options]

Starts an MCP server on stdio and a local bridge for the browser extension.

Options:
  --port <number>   Bridge port (default ${DEFAULT_PORT})
  -h, --help        Show this help
  -v, --version     Show the version

Environment:
  ITSME_PORT         Same as --port
  ITSME_TIMEOUT_MS   Per-command timeout (default ${DEFAULT_REQUEST_TIMEOUT_MS})
  ITSME_LOG_LEVEL    debug | info | warn | error | silent (default info)
  ITSME_UPLOAD_DIRS  Folders page_upload may read from, separated by "${delimiter}" (default: none)
`;

/**
 * A setting from the environment. A Claude Desktop bundle fills these in from its own
 * settings form, and an optional field left empty can arrive blank or as the
 * placeholder itself; both count as not set.
 */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value && !value.startsWith('${') ? value : undefined;
}

function positiveInt(value: string, name: string, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}, got "${value}"`);
  }
  return parsed;
}

export function parseCli(argv: string[], env: NodeJS.ProcessEnv): CliAction {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  const port = values.port ?? setting(env, 'ITSME_PORT');
  const timeout = setting(env, 'ITSME_TIMEOUT_MS');
  const logLevel = setting(env, 'ITSME_LOG_LEVEL') ?? 'info';
  if (!isLogLevel(logLevel)) throw new Error(`Unknown ITSME_LOG_LEVEL "${logLevel}"`);

  return {
    kind: 'run',
    config: {
      port: port ? positiveInt(port, 'Port', 65_535) : DEFAULT_PORT,
      requestTimeoutMs: timeout
        ? positiveInt(timeout, 'ITSME_TIMEOUT_MS', 600_000)
        : DEFAULT_REQUEST_TIMEOUT_MS,
      uploadDirs: (setting(env, 'ITSME_UPLOAD_DIRS') ?? '').split(delimiter).filter(Boolean),
      logLevel,
    },
  };
}
