import { normalizeAbsPath } from '../../../_lib/files/path';

export function supportsBrowserOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  );
}

export type FetchFileRawFn = (
  fullPath: string,
) => Promise<{ buffer: ArrayBuffer; mode?: string }>;

/** Move remote file: GET bytes → POST upload → DELETE source (in-memory staging only; OPFS was dropped after hangs blocked the upload step). */
export async function moveRemoteFile(opts: {
  fetchFileRaw: FetchFileRawFn;
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
  const { buffer } = await opts.fetchFileRaw(opts.sourcePath);
  opts.onProgress?.('download', 100);

  const uploadBody = new File([buffer], opts.fileName, {
    type: 'application/octet-stream',
  });

  const destParent = normalizeAbsPath(opts.destParentPath);

  await opts.uploadToParent(destParent, uploadBody, (pct) =>
    opts.onProgress?.('upload', pct ?? null),
  );

  await opts.deleteFile(opts.sourcePath);
}
