const levels = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof levels)[number];

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function isLogLevel(value: string): value is LogLevel {
  return (levels as readonly string[]).includes(value);
}

// stdout carries the MCP stream, so logs go to stderr.
export function createLogger(level: LogLevel): Logger {
  const threshold = levels.indexOf(level);
  const write = (at: LogLevel) => (message: string) => {
    if (levels.indexOf(at) >= threshold) process.stderr.write(`[itsme] ${at} ${message}\n`);
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

export const silentLogger: Logger = createLogger('silent');
