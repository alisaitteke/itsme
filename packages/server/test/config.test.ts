import { DEFAULT_PORT } from '@itsme/protocol';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../src/config.ts';

function configFor(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const action = parseCli(argv, env);
  if (action.kind !== 'run') throw new Error(`expected a run action, got ${action.kind}`);
  return action.config;
}

describe('parseCli', () => {
  it('uses the defaults with nothing set', () => {
    expect(configFor([])).toMatchObject({
      port: DEFAULT_PORT,
      uploadDirs: [],
      logLevel: 'info',
    });
  });

  it('reads settings from the environment, and --port wins over ITSME_PORT', () => {
    const env = { ITSME_PORT: ' 5001 ', ITSME_UPLOAD_DIRS: '/a:/b' };
    expect(configFor([], env)).toMatchObject({ port: 5001, uploadDirs: ['/a', '/b'] });
    expect(configFor(['--port', '5002'], env).port).toBe(5002);
  });

  it('treats blank values and unfilled placeholders as not set', () => {
    const env = {
      ITSME_PORT: '${user_config.port}',
      ITSME_UPLOAD_DIRS: '',
      ITSME_LOG_LEVEL: '  ',
    };
    expect(configFor([], env)).toMatchObject({
      port: DEFAULT_PORT,
      uploadDirs: [],
      logLevel: 'info',
    });
  });

  it('rejects a port that is not a port', () => {
    expect(() => parseCli(['--port', '70000'], {})).toThrow(/Port/);
    expect(() => parseCli([], { ITSME_LOG_LEVEL: 'loud' })).toThrow(/ITSME_LOG_LEVEL/);
  });

  it('answers --help and --version without starting', () => {
    expect(parseCli(['--help'], {}).kind).toBe('help');
    expect(parseCli(['-v'], {}).kind).toBe('version');
  });
});
