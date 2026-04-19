import { joinAbsPath, normalizeAbsPath } from '../../../_lib/files/path';
import { errorMessageFromResponse } from '../../_lib/incus-fetch-error';

export function getApiUrl(path: string) {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

function postFileXhr(
  url: string,
  body: BodyInit,
  headers: Record<string, string>,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.responseType = 'text';
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        onProgress?.(ev.loaded, ev.total);
      } else {
        onProgress?.(ev.loaded, null);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        const body = xhr.responseText;
        let msg = body;
        if (body) {
          try {
            const j: unknown = JSON.parse(body);
            if (typeof j === 'object' && j !== null) {
              const e = (j as { error?: string }).error;
              if (typeof e === 'string' && e.trim()) msg = e;
            }
          } catch {
            if (body.length > 200) msg = body.slice(0, 200) + '…';
          }
        } else {
          msg = xhr.statusText || `HTTP ${xhr.status}`;
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(body as XMLHttpRequestBodyInit);
  });
}

export async function uploadFile(
  instanceName: string,
  currentPath: string,
  file: File,
  onProgress?: (percent: number | null) => void,
) {
  const parentDir = normalizeAbsPath(currentPath);
  const filePath = joinAbsPath(parentDir, file.name);
  const url = getApiUrl(
    `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
  );
  const buffer = await file.arrayBuffer();
  await postFileXhr(
    url,
    buffer,
    {
      'Content-Type': 'application/octet-stream',
      'X-Incus-uid': '0',
      'X-Incus-gid': '0',
      'X-Incus-mode': '0644',
      'X-Incus-type': 'file',
      'X-Incus-write': 'overwrite',
    },
    (loaded, total) => {
      if (total != null && total > 0) {
        onProgress?.(Math.round((loaded / total) * 100));
      } else {
        onProgress?.(null);
      }
    },
  );
}

export async function createDirectory(
  instanceName: string,
  currentPath: string,
  dirName: string,
) {
  const dirPath = joinAbsPath(currentPath, dirName);
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
    throw new Error(await errorMessageFromResponse(res));
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
    throw new Error(await errorMessageFromResponse(res));
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
  const raw = await fetchFileRaw(instanceName, filePath);
  const content = new TextDecoder('utf-8', { fatal: false }).decode(raw.buffer);
  return { content, mode: raw.mode };
}

/** Full file bytes for classification / binary handling (single GET). */
export async function fetchFileRaw(
  instanceName: string,
  filePath: string,
): Promise<{ buffer: ArrayBuffer; mode?: string }> {
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(filePath)}`,
    ),
  );
  if (!res.ok) {
    throw new Error(await errorMessageFromResponse(res));
  }
  const ct = res.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) {
    throw new Error('IS_DIRECTORY');
  }
  const buffer = await res.arrayBuffer();
  const mode = res.headers.get('X-Incus-mode') || undefined;
  return { buffer, mode };
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
    throw new Error(await errorMessageFromResponse(res));
  }
}

export async function createEmptyFile(
  instanceName: string,
  currentPath: string,
  fileName: string,
) {
  const filePath = joinAbsPath(currentPath, fileName);
  await saveFileContent(instanceName, filePath, '', '0644');
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
    throw new Error(await errorMessageFromResponse(res));
  }

  return {
    uid: res.headers.get('X-Incus-uid'),
    gid: res.headers.get('X-Incus-gid'),
    mode: res.headers.get('X-Incus-mode'),
    type: res.headers.get('X-Incus-type'),
    size: res.headers.get('Content-Length'),
  };
}

/** True if `path` exists on the instance and is a directory (HEAD + X-Incus-type). */
export async function checkDirectoryExists(
  instanceName: string,
  dirPath: string,
): Promise<boolean> {
  try {
    const p = normalizeAbsPath(dirPath);
    const meta = await getFileMetadata(instanceName, p);
    return (meta.type ?? '').toLowerCase() === 'directory';
  } catch {
    return false;
  }
}

function parseSyncDirectoryListing(text: string): string[] | null {
  try {
    const json: unknown = JSON.parse(text);
    if (
      typeof json === 'object' &&
      json !== null &&
      'type' in json &&
      (json as { type?: string }).type === 'sync' &&
      'metadata' in json &&
      Array.isArray((json as { metadata: unknown }).metadata)
    ) {
      return (json as { metadata: string[] }).metadata;
    }
  } catch {
    return null;
  }
  return null;
}

/** Immediate child directories of `parentDir` (HEAD each entry). */
export async function listChildDirectoryPaths(
  instanceName: string,
  parentDir: string,
): Promise<string[]> {
  const parent = normalizeAbsPath(parentDir);
  const url = getApiUrl(
    `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(parent)}`,
  );
  const res = await fetch(url);
  if (!res.ok) return [];
  const names = parseSyncDirectoryListing(await res.text());
  if (!names?.length) return [];
  const out: string[] = [];
  for (const name of names) {
    const full = joinAbsPath(parent, name);
    try {
      const meta = await getFileMetadata(instanceName, full);
      if ((meta.type ?? '').toLowerCase() === 'directory') {
        out.push(full);
      }
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export type InstancePathKind = 'directory' | 'file' | 'missing';

export async function probeInstancePathKind(
  instanceName: string,
  absPath: string,
): Promise<InstancePathKind> {
  try {
    const p = normalizeAbsPath(absPath);
    const meta = await getFileMetadata(instanceName, p);
    const t = (meta.type ?? '').toLowerCase();
    if (t === 'directory') return 'directory';
    if (t === 'file' || t === 'symlink') return 'file';
    return 'missing';
  } catch {
    return 'missing';
  }
}

export { downloadArrayBufferAsFile } from '../../../_lib/files/download-array-buffer';
