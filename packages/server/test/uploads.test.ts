import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readUploads, resolveUploadDirs } from '../src/mcp/uploads.ts';

describe('readUploads', () => {
  let root: string;
  let allowed: string;
  let outside: string;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'itsme-uploads-')));
    allowed = join(root, 'allowed');
    outside = join(root, 'outside');
    await mkdir(join(allowed, '.ssh'), { recursive: true });
    await mkdir(outside);
    await writeFile(join(allowed, 'notes.txt'), 'hello');
    await writeFile(join(allowed, 'photo.PNG'), 'png');
    await writeFile(join(allowed, 'data.bin'), 'bin');
    await writeFile(join(allowed, '.env.local'), 'SECRET=1');
    await writeFile(join(allowed, 'server.pem'), 'key');
    await writeFile(join(allowed, '.ssh', 'config'), 'Host x');
    await writeFile(join(allowed, 'big.bin'), Buffer.alloc(6 * 1024 * 1024));
    await writeFile(join(outside, 'secret.txt'), 'nope');
    await symlink(join(outside, 'secret.txt'), join(allowed, 'link.txt'));
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  it('reads a file as base64 with its name and type', async () => {
    expect(await readUploads([join(allowed, 'notes.txt')], [allowed])).toEqual([
      { name: 'notes.txt', mimeType: 'text/plain', data: Buffer.from('hello').toString('base64') },
    ]);
  });

  it('guesses the type from the extension, whatever its case', async () => {
    const files = await readUploads(
      [join(allowed, 'photo.PNG'), join(allowed, 'data.bin')],
      [allowed],
    );
    expect(files.map((file) => file.mimeType)).toEqual(['image/png', 'application/octet-stream']);
  });

  it('is off until a folder is allowed', async () => {
    await expect(readUploads([join(allowed, 'notes.txt')], [])).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });

  it('refuses files outside the allowed folders', async () => {
    const refused = { code: 'INVALID_PARAMS' };
    await expect(readUploads([join(outside, 'secret.txt')], [allowed])).rejects.toMatchObject(
      refused,
    );
    await expect(readUploads(['notes.txt'], [allowed])).rejects.toMatchObject(refused);
    await expect(readUploads([join(allowed, 'missing.txt')], [allowed])).rejects.toMatchObject(
      refused,
    );
    await expect(readUploads([allowed], [root])).rejects.toMatchObject(refused);
  });

  it('follows a symlink before deciding', async () => {
    await expect(readUploads([join(allowed, 'link.txt')], [allowed])).rejects.toThrow(
      /outside the folders/,
    );
  });

  it('refuses files that look like credentials', async () => {
    for (const name of ['.env.local', 'server.pem', join('.ssh', 'config')]) {
      await expect(readUploads([join(allowed, name)], [allowed])).rejects.toThrow(/credential/);
    }
  });

  it('caps the total size of one upload', async () => {
    const big = join(allowed, 'big.bin');
    expect(await readUploads([big], [allowed])).toHaveLength(1);
    await expect(readUploads([big, big], [allowed])).rejects.toThrow(/10 MB/);
  });

  it('drops allowed folders that do not exist', async () => {
    expect(await resolveUploadDirs([allowed, join(root, 'nowhere')])).toEqual([allowed]);
  });
});
