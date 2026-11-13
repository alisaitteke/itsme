import { parseArgs } from 'node:util';
import { DEFAULT_PORT, DEFAULT_REQUEST_TIMEOUT_MS } from '@itsme/protocol';
import { isLogLevel, type LogLevel } from './logger.ts';

export interface Config {
  port: number;
  token: string | undefined;
  requestTimeoutMs: number;
  logLevel: LogLevel;
}

export type CliAction = { kind: 'run'; config: Config } | { kind: 'help' } | { kind: 'version' };

export const usage = `Usage: itsme [options]

Starts an MCP server on stdio and a local bridge for the browser extension.

Options:
  --port <number>   Bridge port (default ${DEFAULT_PORT})
  -h, --help        Show this help
  -v, --version     Show the version

Environment:
  ITSME_PORT         Same as --port
  ITSME_TOKEN        Shared secret the extension must present
  ITSME_TIMEOUT_MS   Per-command timeout (default ${DEFAULT_REQUEST_TIMEOUT_MS})
  ITSME_LOG_LEVEL    debug | info | warn | error | silent (default info)
`;

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

  const port = values.port ?? env.ITSME_PORT;
  const timeout = env.ITSME_TIMEOUT_MS;
  const logLevel = env.ITSME_LOG_LEVEL ?? 'info';
  if (!isLogLevel(logLevel)) throw new Error(`Unknown ITSME_LOG_LEVEL "${logLevel}"`);

  return {
    kind: 'run',
    config: {
      port: port ? positiveInt(port, 'Port', 65_535) : DEFAULT_PORT,
      token: env.ITSME_TOKEN || undefined,
      requestTimeoutMs: timeout
        ? positiveInt(timeout, 'ITSME_TIMEOUT_MS', 600_000)
        : DEFAULT_REQUEST_TIMEOUT_MS,
      logLevel,
    },
  };
}
