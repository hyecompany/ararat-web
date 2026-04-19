import {
  basenameAbsPath,
  joinAbsPath,
  normalizeAbsPath,
  resolveSymlinkTarget,
  absPathParent,
} from '../../../_lib/files/path';
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
  await postFileXhr(
    url,
    file,
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

/**
 * For a symlink, GET returns the link target as plain text (same as “file contents” for the path).
 */
export async function fetchSymlinkTargetRawPath(
  instanceName: string,
  absPath: string,
): Promise<string | null> {
  const p = normalizeAbsPath(absPath);
  const res = await fetch(
    getApiUrl(
      `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(p)}`,
    ),
  );
  if (!res.ok) return null;
  const ct = (res.headers.get('Content-Type') || '').toLowerCase();
  if (ct.includes('application/json')) return null;
  const text = await res.text();
  const line = text.replace(/\r\n/g, '\n').split('\n')[0]?.trim() ?? '';
  return line || null;
}

const SYMLINK_PROBE_MAX_DEPTH = 12;

/** Where to navigate after opening a symlink row: list this directory, optionally then open this file. */
export async function getSymlinkResolvedNavTarget(
  instanceName: string,
  linkAbsPath: string,
  depth = 0,
): Promise<{ directoryPath: string; fileBasename?: string }> {
  if (depth > SYMLINK_PROBE_MAX_DEPTH) {
    return { directoryPath: normalizeAbsPath(linkAbsPath) };
  }
  const raw = await fetchSymlinkTargetRawPath(instanceName, linkAbsPath);
  if (!raw) {
    return { directoryPath: normalizeAbsPath(linkAbsPath) };
  }
  const resolved = resolveSymlinkTarget(linkAbsPath, raw);
  let meta;
  try {
    meta = await getFileMetadata(instanceName, resolved);
  } catch {
    return { directoryPath: resolved };
  }
  const t = (meta.type ?? '').toLowerCase();
  if (t === 'directory') {
    return { directoryPath: resolved };
  }
  if (t === 'symlink') {
    return getSymlinkResolvedNavTarget(instanceName, resolved, depth + 1);
  }
  if (t === 'file') {
    return {
      directoryPath: absPathParent(resolved),
      fileBasename: basenameAbsPath(resolved),
    };
  }
  return { directoryPath: resolved };
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

/** Parallelism for HEAD fan-out when classifying listing entries as directories. */
const DIRECTORY_HEAD_BATCH = 16;

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
  for (let i = 0; i < names.length; i += DIRECTORY_HEAD_BATCH) {
    const slice = names.slice(i, i + DIRECTORY_HEAD_BATCH);
    const flags = await Promise.all(
      slice.map(async (name) => {
        const full = joinAbsPath(parent, name);
        try {
          const meta = await getFileMetadata(instanceName, full);
          const mt = (meta.type ?? '').toLowerCase();
          if (mt === 'directory') return full;
          if (mt === 'symlink') return full;
        } catch {
          /* skip */
        }
        return null;
      }),
    );
    for (const f of flags) {
      if (f !== null) out.push(f);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export type InstancePathKind = 'directory' | 'file' | 'missing';

export async function probeInstancePathKind(
  instanceName: string,
  absPath: string,
): Promise<InstancePathKind> {
  return probeInstancePathKindInner(instanceName, absPath, 0);
}

async function probeInstancePathKindInner(
  instanceName: string,
  absPath: string,
  depth: number,
): Promise<InstancePathKind> {
  if (depth > SYMLINK_PROBE_MAX_DEPTH) return 'missing';
  try {
    const p = normalizeAbsPath(absPath);
    const meta = await getFileMetadata(instanceName, p);
    const t = (meta.type ?? '').toLowerCase();
    if (t === 'directory') return 'directory';
    if (t === 'symlink') {
      const raw = await fetchSymlinkTargetRawPath(instanceName, p);
      if (!raw) return 'directory';
      const resolved = resolveSymlinkTarget(p, raw);
      return probeInstancePathKindInner(instanceName, resolved, depth + 1);
    }
    if (t === 'file') return 'file';
    return 'missing';
  } catch {
    return 'missing';
  }
}

export { downloadArrayBufferAsFile } from '../../../_lib/files/download-array-buffer';
