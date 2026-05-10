/** Ask before loading full body into editor for very large files. */
export const LARGE_FILE_CONFIRM_BYTES = 8 * 1024 * 1024;
const BINARY_CLASSIFICATION_SAMPLE_BYTES = 24 * 1024;

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
 * Keep this limited to formats we always stream without fetching a body.
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
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'pdf',
  'o',
  'obj',
  'a',
  'lib',
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

const BINARY_MAGIC_NUMBERS = [
  // Archive/container formats. OOXML (.docx/.pptx/.xlsx) starts as a ZIP.
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
  // Native object/executable formats.
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal
  [0xfe, 0xed, 0xfa, 0xce], // Mach-O 32-bit
  [0xce, 0xfa, 0xed, 0xfe],
  [0xfe, 0xed, 0xfa, 0xcf], // Mach-O 64-bit
  [0xcf, 0xfa, 0xed, 0xfe],
  [0x4d, 0x5a], // DOS/PE
  // Common document/media signatures not already caught by extension preflight.
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], // OLE compound docs
  [0x25, 0x50, 0x44, 0x46], // PDF
] as const;

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]) {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function hasBinaryMagicNumber(bytes: Uint8Array) {
  return BINARY_MAGIC_NUMBERS.some((magic) => startsWithBytes(bytes, magic));
}

function isAllowedTextControlByte(byte: number) {
  return byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x1b;
}

function isValidUtf8(bytes: Uint8Array) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function classifyBufferIsBinary(
  fileName: string,
  buffer: ArrayBuffer,
): boolean {
  void fileName;
  const u8 = new Uint8Array(buffer);
  if (u8.length === 0) return false;
  const sample = u8.subarray(0, BINARY_CLASSIFICATION_SAMPLE_BYTES);
  if (hasBinaryMagicNumber(sample)) return true;

  let suspiciousControlBytes = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 0x20 && !isAllowedTextControlByte(byte)) {
      suspiciousControlBytes += 1;
    }
  }

  if (!isValidUtf8(sample)) return true;
  return suspiciousControlBytes / sample.length > 0.01;
}
