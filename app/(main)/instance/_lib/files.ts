import { normalizePath } from './utils';

export function getApiUrl(path: string) {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

/**
 * Determines the appropriate file mode based on file name and optional override.
 *
 * File modes are Unix permissions in octal notation:
 * - '0755' grants read/write/execute for owner, read/execute for group and others
 *   (used for script files like .sh, .py, .js to make them executable)
 * - '0644' grants read/write for owner, read-only for group and others
 *   (used for regular data files without execute permissions)
 *
 * @param filename The name of the file
 * @param modeOverride Optional mode to use instead of auto-detection
 * @returns The file mode string (e.g., '0755' for executables, '0644' for regular files)
 */
export function getFileMode(filename: string, modeOverride?: string): string {
  if (modeOverride) {
    return modeOverride;
  }

  const scriptExtensions = [
    '.sh',
    '.bash',
    '.py',
    '.pl',
    '.rb',
    '.js',
    '.mjs',
    '.cjs',
    '.bat',
    '.cgi',
    '.php',
  ];
  const extIndex = filename.lastIndexOf('.');
  const ext =
    extIndex > 0 ? filename.slice(extIndex).toLowerCase() : undefined;
  const isExecutable = ext ? scriptExtensions.includes(ext) : false;
  return isExecutable ? '0755' : '0644';
}

export function uploadFile(
  instanceName: string,
  currentPath: string,
  file: File,
  onProgress?: (progress: number) => void,
  modeOverride?: string,
  uidOverride?: string | null,
  gidOverride?: string | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const filePath = `${currentPath === '/' ? '' : currentPath}/${file.name}`;
    const xhr = new XMLHttpRequest();
    const url = getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    );

    xhr.open('POST', url);
    xhr.setRequestHeader('X-Incus-uid', uidOverride ?? '0');
    xhr.setRequestHeader('X-Incus-gid', gidOverride ?? '0');
    xhr.setRequestHeader('X-Incus-mode', getFileMode(file.name, modeOverride));
    xhr.setRequestHeader('X-Incus-type', 'file');
    xhr.setRequestHeader('X-Incus-write', 'overwrite');

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100;
          onProgress(percentComplete);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(xhr.statusText || 'Upload failed'));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error'));
    };

    xhr.send(file);
  });
}

/**
 * Creates a new empty file in the specified instance and path.
 *
 * This function checks if the file already exists by sending a HEAD request
 * to the file path. If the file exists (status 200), it throws an error.
 * If the file doesn't exist (status 404), it proceeds to create an empty file.
 * Any other status code indicates an error condition.
 *
 * @param instanceName The name of the instance
 * @param currentPath The directory path where the file should be created
 * @param fileName The name of the file to create
 * @throws Error if the file already exists or if there's an API error
 */
export async function createFile(
  instanceName: string,
  currentPath: string,
  fileName: string,
) {
  const filePath = `${currentPath === '/' ? '' : currentPath}/${fileName}`;
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    ),
    {
      method: 'HEAD',
    },
  );
  if (res.ok) {
    throw createFileExistsError(fileName);
  }
  if (res.status !== 404) {
    throw new Error(res.statusText);
  }
  await saveFileContent(instanceName, filePath, '');
}

export async function createDirectory(
  instanceName: string,
  currentPath: string,
  dirName: string,
) {
  const dirPath = `${currentPath === '/' ? '' : currentPath}/${dirName}`;
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(dirPath)}`,
    ),
    {
      method: 'POST',
      headers: {
        'X-Incus-uid': '0',
        'X-Incus-gid': '0',
        'X-Incus-mode': '0644',
        'X-Incus-type': 'directory',
      },
    },
  );

  if (!res.ok) {
    throw new Error(res.statusText);
  }
}

export async function deleteFile(instanceName: string, filePath: string) {
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    ),
    {
      method: 'DELETE',
    },
  );

  if (!res.ok) {
    throw new Error(res.statusText);
  }
}

export function downloadFile(instanceName: string, filePath: string) {
  const url = getApiUrl(
    `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filePath.split('/').pop() || 'download';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function fetchFileContent(instanceName: string, filePath: string) {
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    ),
  );
  if (!res.ok) throw new Error('Failed to fetch file content');
  const mode = res.headers.get('X-Incus-mode') || undefined;
  return { content: await res.text(), mode };
}

export async function fetchFileBinary(
  instanceName: string,
  filePath: string,
): Promise<{ data: ArrayBuffer; mode?: string }> {
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    ),
  );
  if (!res.ok) throw new Error('Failed to fetch file content');
  const mode = res.headers.get('X-Incus-mode') || undefined;
  const data = await res.arrayBuffer();
  return { data, mode };
}

export async function saveFileContent(
  instanceName: string,
  filePath: string,
  content: string,
  mode: string = '0644',
) {
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    ),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Incus-uid': '0',
        'X-Incus-gid': '0',
        'X-Incus-mode': mode,
        'X-Incus-type': 'file',
        'X-Incus-write': 'overwrite',
      },
      body: content,
    },
  );

  if (!res.ok) {
    throw new Error(res.statusText);
  }
}

export async function getFileMetadata(instanceName: string, filePath: string) {
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    ),
    {
      method: 'HEAD',
    },
  );

  if (!res.ok) {
    throw new Error(res.statusText);
  }

  return {
    uid: res.headers.get('X-Incus-uid'),
    gid: res.headers.get('X-Incus-gid'),
    mode: res.headers.get('X-Incus-mode'),
    type: res.headers.get('X-Incus-type'),
    size: res.headers.get('Content-Length'),
  };
}

export function createFileExistsError(label: string) {
  const error = new Error(`File "${label}" already exists`);
  (error as any).code = 'EEXIST';
  (error as any).path = label;
  return error;
}

export async function fileExists(
  instanceName: string,
  filePath: string,
): Promise<boolean> {
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    ),
    {
      method: 'HEAD',
    },
  );

  if (res.ok) {
    return true;
  }

  if (res.status === 404) {
    return false;
  }

  throw new Error(res.statusText);
}

export async function moveFile(
  instanceName: string,
  sourcePath: string,
  destinationPath: string,
  allowOverwrite: boolean = false,
  onProgress?: (progress: number) => void,
) {
  const normalizedSource = normalizePath(sourcePath);
  const normalizedDestination = normalizePath(destinationPath);
  const sourceName = normalizedSource.split('/').filter(Boolean).pop() || '';
  if (!sourceName) {
    // Defensive check: upstream path normalization should prevent this by
    // ensuring file paths do not end with a trailing slash or contain empty segments,
    // but we validate here to guarantee that a file name is always present.
    throw new Error('Source path must include a valid file name');
  }

  const sourceMeta = await getFileMetadata(instanceName, normalizedSource);
  if (sourceMeta.type === 'directory') {
    throw new Error('Moving directories is not supported yet.');
  }

  onProgress?.(0);

  // Fetch source
  const { data, mode } = await fetchFileBinary(instanceName, normalizedSource);
  onProgress?.(50);

  // Determine destination path. If the destination exists and is a directory,
  // or the input ends with a slash, place the file inside using the same name.
  let destinationIsDirectory = normalizedDestination.endsWith('/');
  if (!destinationIsDirectory) {
    try {
      const meta = await getFileMetadata(instanceName, normalizedDestination);
      destinationIsDirectory = meta.type === 'directory';
    } catch (e) {
      destinationIsDirectory = false;
    }
  }

  const destinationPathWithName = destinationIsDirectory
    ? `${normalizedDestination.replace(/\/$/, '') || '/'}${
        normalizedDestination === '/' ? '' : '/'
      }${sourceName}`
    : normalizedDestination;

  if (destinationPathWithName === normalizedSource) {
    // No-op if destination is the same as source
    onProgress?.(100);
    return;
  }

  if (!allowOverwrite && (await fileExists(instanceName, destinationPathWithName))) {
    throw createFileExistsError(destinationPathWithName);
  }

  const lastSlashIndex = destinationPathWithName.lastIndexOf('/');
  const destDir =
    lastSlashIndex > 0
      ? destinationPathWithName.substring(0, lastSlashIndex)
      : '/';
  const fileName = destinationPathWithName.split('/').pop() || '';

  const blob = new Blob([data], { type: 'application/octet-stream' });
  const file = new File([blob], fileName, { type: 'application/octet-stream' });
  await uploadFile(
    instanceName,
    destDir || '/',
    file,
    (p) => {
      if (p === null || p === undefined) return;
      // Map 0-100 upload to 50-100 overall
      const scaled = 50 + p / 2;
      onProgress?.(scaled);
    },
    mode,
    sourceMeta.uid,
    sourceMeta.gid,
  );

  // Delete source; rollback destination if cleanup fails to avoid duplicates.
  try {
    await deleteFile(instanceName, normalizedSource);
  } catch (deleteError) {
    try {
      await deleteFile(instanceName, destinationPathWithName);
    } catch (cleanupError) {
      console.error(
        'Failed to cleanup moved file after delete failure:',
        cleanupError,
      );
      throw new Error(
        `Failed to delete original file at ${normalizedSource} after moving. A copy exists at ${destinationPathWithName}. Original error: ${
          (deleteError as Error).message
        }`,
      );
    }
    throw deleteError;
  }
  onProgress?.(100);
}
