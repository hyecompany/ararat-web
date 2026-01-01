export function getApiUrl(path: string) {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

/**
 * Determines the appropriate file mode based on file name and optional override.
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
) {
  const normalizedSource = sourcePath.startsWith('/')
    ? sourcePath
    : `/${sourcePath}`;
  const normalizedDestination = destinationPath.startsWith('/')
    ? destinationPath
    : `/${destinationPath}`;
  const sourceName = normalizedSource.split('/').pop() || '';

  const sourceMeta = await getFileMetadata(instanceName, normalizedSource);
  if (sourceMeta.type === 'directory') {
    throw new Error('Moving directories is not supported yet.');
  }

  // Fetch source
  const { data, mode } = await fetchFileBinary(instanceName, normalizedSource);

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
  if (!fileName) {
    throw new Error('Destination must include a file name');
  }

  const blob = new Blob([data], { type: 'application/octet-stream' });
  const file = new File([blob], fileName, { type: 'application/octet-stream' });
  await uploadFile(
    instanceName,
    destDir || '/',
    file,
    undefined,
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
    }
    throw deleteError;
  }
}
