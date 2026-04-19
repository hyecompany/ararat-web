import { isBinary } from 'istextorbinary';

/** Ask before loading full body into editor for very large files. */
export const LARGE_FILE_CONFIRM_BYTES = 8 * 1024 * 1024;

const KNOWN_TEXT_FILENAMES = new Set(
  [
    'dockerfile',
    'makefile',
    'rakefile',
    'gemfile',
    'jenkinsfile',
    'vagrantfile',
    'license',
    'copying',
    'readme',
    'changelog',
    'contributing',
    'authors',
    'owners',
    'codeowners',
  ].map((s) => s.toLowerCase()),
);

/** Names like `.bashrc`, `.npmrc`, `Dockerfile`, `Makefile`. */
export function looksLikelyTextFilename(fileName: string): boolean {
  const base = fileName.split('/').pop() ?? fileName;
  const lower = base.toLowerCase();
  if (KNOWN_TEXT_FILENAMES.has(lower)) return true;
  if (base.startsWith('.') && base.length > 1) return true;
  return false;
}

/**
 * Force download without opening editor (extension-level).
 * istextorbinary also uses binaryextensions; this list catches media/codecs we always stream.
 */
const FORCE_DOWNLOAD_EXT = new Set([
  'mp4',
  'webm',
  'mkv',
  'avi',
  'mov',
  'mp3',
  'wav',
  'flac',
  'ogg',
  'zip',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'pdf',
  'exe',
  'dll',
  'so',
  'dylib',
  'wasm',
  'dmg',
  'iso',
  'deb',
  'rpm',
  'msi',
  'apk',
  'jar',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'ico',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'heic',
]);

function extensionOf(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1).toLowerCase();
}

/** Preflight before fetching body: immediate download vs fetch + classify. */
export type PreflightOpen =
  | { kind: 'download_now' }
  | { kind: 'fetch_then_classify' };

export function preflightOpen(fileName: string): PreflightOpen {
  const ext = extensionOf(fileName);
  if (FORCE_DOWNLOAD_EXT.has(ext)) {
    return { kind: 'download_now' };
  }
  if (looksLikelyTextFilename(fileName)) {
    return { kind: 'fetch_then_classify' };
  }
  if (!ext) {
    return { kind: 'fetch_then_classify' };
  }
  return { kind: 'fetch_then_classify' };
}

export function classifyBufferIsBinary(
  fileName: string,
  buffer: ArrayBuffer,
): boolean {
  const u8 = new Uint8Array(buffer);
  const result = isBinary(fileName, u8 as unknown as Buffer);
  if (result === null) return true;
  return result;
}
