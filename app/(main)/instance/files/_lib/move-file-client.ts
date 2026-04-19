import { normalizeAbsPath } from '../../../_lib/files/path';

export function supportsBrowserOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  );
}

export type FetchFileBlobFn = (
  fullPath: string,
) => Promise<{ blob: Blob; mode?: string }>;

/**
 * Move remote file: GET body as Blob → POST upload → DELETE source.
 * Blob staging may reduce peak heap vs ArrayBuffer on some engines; server-side rename is unavailable.
 */
export async function moveRemoteFile(opts: {
  fetchFileBlob: FetchFileBlobFn;
  sourcePath: string;
  destParentPath: string;
  fileName: string;
  uploadToParent: (
    parentPath: string,
    file: File,
    onProgress?: (percent: number | null) => void,
  ) => Promise<void>;
  deleteFile: (fullPath: string) => Promise<void>;
  onProgress?: (phase: 'download' | 'upload', percent: number | null) => void;
}): Promise<void> {
  const { blob } = await opts.fetchFileBlob(opts.sourcePath);
  opts.onProgress?.('download', 100);

  const uploadBody = new File([blob], opts.fileName, {
    type: 'application/octet-stream',
  });

  const destParent = normalizeAbsPath(opts.destParentPath);

  await opts.uploadToParent(destParent, uploadBody, (pct) =>
    opts.onProgress?.('upload', pct ?? null),
  );

  await opts.deleteFile(opts.sourcePath);
}
