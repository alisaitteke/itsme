import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, sep } from 'node:path';
import { BridgeError, type CommandInput } from '@itsme/protocol';

type UploadFile = CommandInput<'page.upload'>['files'][number];

const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

// A tool that sends local files to web pages must not be talked into sending secrets.
const CREDENTIAL_NAMES = [
  /^\.env(\..+)?$/,
  /^\.(netrc|npmrc|pypirc|pgpass)$/,
  /^id_(rsa|dsa|ecdsa|ed25519)/,
  /^credentials(\..+)?$/,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i,
];
const CREDENTIAL_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker']);

const MIME_TYPES: Record<string, string> = {
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
};

const refuse = (message: string) => new BridgeError('INVALID_PARAMS', message);

function looksLikeCredential(path: string): boolean {
  const parts = path.split(sep);
  const name = parts.at(-1) ?? '';
  return (
    CREDENTIAL_NAMES.some((pattern) => pattern.test(name)) ||
    parts.some((part) => CREDENTIAL_DIRS.has(part))
  );
}

/** Folders from ITSME_UPLOAD_DIRS that exist, with symlinks resolved. */
export async function resolveUploadDirs(dirs: readonly string[]): Promise<string[]> {
  const resolved = await Promise.all(dirs.map((dir) => realpath(dir).catch(() => null)));
  return resolved.filter((dir): dir is string => dir !== null);
}

/** Reads the files for an upload, refusing anything outside `allowedDirs`. */
export async function readUploads(
  paths: readonly string[],
  allowedDirs: readonly string[],
): Promise<UploadFile[]> {
  if (allowedDirs.length === 0) {
    throw new BridgeError(
      'UNSUPPORTED',
      'File upload is off. The user can turn it on by setting ITSME_UPLOAD_DIRS to the folders files may be uploaded from.',
    );
  }

  const files: UploadFile[] = [];
  let total = 0;
  for (const path of paths) {
    if (!isAbsolute(path)) throw refuse(`${path} is not an absolute path`);
    // Resolved first, so a symlink can't lead out of an allowed folder.
    const real = await realpath(path).catch(() => {
      throw refuse(`${path} does not exist`);
    });
    if (!allowedDirs.some((dir) => real.startsWith(dir + sep))) {
      throw refuse(`${path} is outside the folders uploads are allowed from`);
    }
    if (looksLikeCredential(real)) {
      throw refuse(`${basename(real)} looks like a credential file and can't be uploaded`);
    }
    const info = await stat(real);
    if (!info.isFile()) throw refuse(`${path} is not a file`);
    total += info.size;
    if (total > MAX_TOTAL_BYTES) throw refuse('Uploads are limited to 10 MB in total');

    files.push({
      name: basename(real),
      mimeType: MIME_TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream',
      data: (await readFile(real)).toString('base64'),
    });
  }
  return files;
}
