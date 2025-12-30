export function getApiUrl(path: string) {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

export function uploadFile(
  instanceName: string,
  currentPath: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const filePath = `${currentPath === '/' ? '' : currentPath}/${file.name}`;
    const xhr = new XMLHttpRequest();
    const url = getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    );

    xhr.open('POST', url);
    xhr.setRequestHeader('X-Incus-uid', '0');
    xhr.setRequestHeader('X-Incus-gid', '0');
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
    const extIndex = file.name.lastIndexOf('.');
    const ext =
      extIndex > 0 ? file.name.slice(extIndex).toLowerCase() : undefined;
    const isExecutable = ext ? scriptExtensions.includes(ext) : false;
    xhr.setRequestHeader('X-Incus-mode', isExecutable ? '0755' : '0644');
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
