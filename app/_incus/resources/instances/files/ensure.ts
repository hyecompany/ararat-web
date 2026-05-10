'use client';

import { normalizeAbsPath } from '@/app/(main)/_lib/files/path';
import { instanceKey } from '../../../keys';
import { resourceKeys } from '../../../resources';
import type { RequestRegistry } from '../../../requests';
import type { IncusStore } from '../../../store';
import { shouldFetchStoredStatus } from '../../../status';
import { requestRaw, requestUpload } from '../../../transport';
import type { InstanceFileMetadata } from '../../../types';

export type InstanceFileMetadataRequest = {
  instanceName: string;
  project?: string | null;
  path: string;
};

export type InstanceFileChildrenRequest = InstanceFileMetadataRequest;
type ProgressCallback = (percent: number | null) => void;

function fileMetadataPath(instanceName: string, project: string, path: string) {
  return {
    path: `/1.0/instances/${encodeURIComponent(instanceName)}/files`,
    params: { project, path },
  };
}

async function fetchFileMetadataHeaders(
  instanceName: string,
  project: string,
  path: string,
): Promise<InstanceFileMetadata> {
  const target = fileMetadataPath(instanceName, project, path);
  const response = await requestRaw(target.path, {
    params: target.params,
    init: { method: 'HEAD' },
  });

  const size = response.headers.get('Content-Length');
  return {
    path,
    uid: response.headers.get('X-Incus-uid') ?? undefined,
    gid: response.headers.get('X-Incus-gid') ?? undefined,
    mode: response.headers.get('X-Incus-mode') ?? undefined,
    type: response.headers.get('X-Incus-type') ?? undefined,
    size: size ? Number.parseInt(size, 10) : undefined,
  };
}

function isDirectoryResponse(value: unknown): value is { type: 'sync'; metadata: string[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'sync' &&
    'metadata' in value &&
    Array.isArray(value.metadata)
  );
}

async function fetchDirectoryChildren(
  instanceName: string,
  project: string,
  path: string,
): Promise<string[]> {
  const target = fileMetadataPath(instanceName, project, path);
  const response = await requestRaw(target.path, { params: target.params });

  const text = await response.text();
  try {
    const json: unknown = JSON.parse(text);
    if (isDirectoryResponse(json)) return json.metadata;
  } catch {
    // A plain-text response means Incus returned file content, not a directory
    // listing. Keep this distinction in the data layer so UI code can treat it
    // as "not a folder" without issuing a second probe.
  }

  throw new Error('NOT_A_DIRECTORY');
}

export function createInstanceFilesResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  async function getChildren(request: InstanceFileChildrenRequest) {
    const project = request.project || 'default';
    const path = normalizeAbsPath(request.path);
    const key = instanceKey(project, request.instanceName);
    const storeKey = resourceKeys.instanceFileChildren(key, path);
    const item =
      store.getSnapshot().state.instances.items[key]?.files.items[path] ??
      store.ensureInstanceFile(key, path);
    const current = item.children;

    if (current?.names && current.status === 'ready') {
      return current.names;
    }

    const refresh = () =>
      requests.run(`instance-file:children:${key}:${path}`, [storeKey], async () => {
        const latest =
          store.getSnapshot().state.instances.items[key]?.files.items[path]
            ?.children;
        if (latest?.names && latest.status === 'ready') return latest.names;

        try {
          const names = await fetchDirectoryChildren(
            request.instanceName,
            project,
            path,
          );
          store.update((state) => {
            const file = state.instances.items[key]?.files.items[path];
            if (!file) return;
            file.children = { status: 'ready', names };
          }, [storeKey]);
          return names;
        } catch (error) {
          store.update((state) => {
            const file = state.instances.items[key]?.files.items[path];
            if (!file) return;
            file.children = {
              status: 'error',
              names: file.children?.names ?? [],
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to load folder.',
            };
          }, [storeKey]);
          throw error;
        }
      });

    if (current?.names?.length || current?.status === 'stale') {
      if (shouldFetchStoredStatus(current.status)) {
        void refresh().catch(() => undefined);
      }
      return current.names;
    }

    return refresh();
  }

  async function getMetadata(request: InstanceFileMetadataRequest) {
    const project = request.project || 'default';
    const path = normalizeAbsPath(request.path);
    const key = instanceKey(project, request.instanceName);
    const storeKey = resourceKeys.instanceFileMetadata(key, path);
    const item =
      store.getSnapshot().state.instances.items[key]?.files.items[path] ??
      store.ensureInstanceFile(key, path);
    const current = item.metadata;

    if (current.data && current.status === 'ready') {
      return current.data;
    }

    const refresh = () =>
      requests.run(`instance-file:metadata:${key}:${path}`, [storeKey], async () => {
        const latest =
          store.getSnapshot().state.instances.items[key]?.files.items[path]
            ?.metadata;
        if (latest?.data && latest.status === 'ready') return latest.data;

        try {
          const metadata = await fetchFileMetadataHeaders(
            request.instanceName,
            project,
            path,
          );
          store.update((state) => {
            const file = state.instances.items[key]?.files.items[path];
            if (file) file.metadata = { status: 'ready', data: metadata };
          }, [storeKey]);
          return metadata;
        } catch (error) {
          store.update((state) => {
            const file = state.instances.items[key]?.files.items[path];
            if (!file) return;
            file.metadata = {
              ...file.metadata,
              status: 'error',
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to load file metadata.',
            };
          }, [storeKey]);
          throw error;
        }
      });

    if (current.data) {
      if (shouldFetchStoredStatus(current.status)) {
        // Persisted or disconnected metadata can still render a useful file icon
        // and type label. Refresh in the background so reloads do not flash back
        // to unknown file types just because the HEAD cache is stale.
        void refresh().catch(() => undefined);
      }
      return current.data;
    }

    return refresh();
  }

  function getCachedMetadata(request: InstanceFileMetadataRequest) {
    const project = request.project || 'default';
    const path = normalizeAbsPath(request.path);
    const key = instanceKey(project, request.instanceName);
    return store.getSnapshot().state.instances.items[key]?.files.items[path]
      ?.metadata.data;
  }

  async function uploadFile(
    request: InstanceFileMetadataRequest & {
      parentPath: string;
      file: File;
      onProgress?: ProgressCallback;
    },
  ) {
    const project = request.project || 'default';
    const parentPath = normalizeAbsPath(request.parentPath);
    const filePath = normalizeAbsPath(`${parentPath}/${request.file.name}`);
    await requestUpload(
      `/1.0/instances/${encodeURIComponent(request.instanceName)}/files`,
      request.file,
      {
        params: { project, path: filePath },
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Incus-uid': '0',
          'X-Incus-gid': '0',
          'X-Incus-mode': '0644',
          'X-Incus-type': 'file',
          'X-Incus-write': 'overwrite',
        },
        onProgress: (loaded, total) => {
          request.onProgress?.(
            total !== null && total > 0 ? Math.round((loaded / total) * 100) : null,
          );
        },
      },
    );
  }

  async function saveFileContent(
    request: InstanceFileMetadataRequest & { content: string; mode?: string },
  ) {
    const project = request.project || 'default';
    const path = normalizeAbsPath(request.path);
    await requestRaw(`/1.0/instances/${encodeURIComponent(request.instanceName)}/files`, {
      params: { project, path },
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Incus-uid': '0',
          'X-Incus-gid': '0',
          'X-Incus-mode': request.mode ?? '0644',
          'X-Incus-type': 'file',
          'X-Incus-write': 'overwrite',
        },
        body: request.content,
      },
    });
  }

  async function createDirectory(
    request: InstanceFileMetadataRequest & { parentPath: string; name: string },
  ) {
    const project = request.project || 'default';
    const parentPath = normalizeAbsPath(request.parentPath);
    const path = normalizeAbsPath(`${parentPath}/${request.name}`);
    await requestRaw(`/1.0/instances/${encodeURIComponent(request.instanceName)}/files`, {
      params: { project, path },
      init: {
        method: 'POST',
        headers: {
          'X-Incus-uid': '0',
          'X-Incus-gid': '0',
          'X-Incus-mode': '0644',
          'X-Incus-type': 'directory',
        },
      },
    });
  }

  async function createEmptyFile(
    request: InstanceFileMetadataRequest & { parentPath: string; name: string },
  ) {
    const path = normalizeAbsPath(`${normalizeAbsPath(request.parentPath)}/${request.name}`);
    await saveFileContent({ ...request, path, content: '', mode: '0644' });
  }

  async function deleteFile(request: InstanceFileMetadataRequest) {
    const project = request.project || 'default';
    const path = normalizeAbsPath(request.path);
    await requestRaw(`/1.0/instances/${encodeURIComponent(request.instanceName)}/files`, {
      params: { project, path },
      init: { method: 'DELETE' },
    });
  }

  async function fetchRaw(request: InstanceFileMetadataRequest) {
    const project = request.project || 'default';
    const path = normalizeAbsPath(request.path);
    const response = await requestRaw(
      `/1.0/instances/${encodeURIComponent(request.instanceName)}/files`,
      { params: { project, path } },
    );
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) throw new Error('IS_DIRECTORY');
    return {
      buffer: await response.arrayBuffer(),
      mode: response.headers.get('X-Incus-mode') || undefined,
    };
  }

  async function fetchBlob(request: InstanceFileMetadataRequest) {
    const project = request.project || 'default';
    const path = normalizeAbsPath(request.path);
    const response = await requestRaw(
      `/1.0/instances/${encodeURIComponent(request.instanceName)}/files`,
      { params: { project, path } },
    );
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) throw new Error('IS_DIRECTORY');
    return {
      blob: await response.blob(),
      mode: response.headers.get('X-Incus-mode') || undefined,
    };
  }

  async function fetchContent(request: InstanceFileMetadataRequest) {
    const project = request.project || 'default';
    const path = normalizeAbsPath(request.path);
    const key = instanceKey(project, request.instanceName);
    const storeKey = resourceKeys.instanceFileContent(key, path);
    const item =
      store.getSnapshot().state.instances.items[key]?.files.items[path] ??
      store.ensureInstanceFile(key, path);
    const current = item.content;
    if (typeof current?.data === 'string' && current.status === 'ready') {
      return {
        content: current.data,
        mode: item.metadata.data?.mode,
      };
    }

    return requests.run(`instance-file:content:${key}:${path}`, [storeKey], async () => {
      const latest =
        store.getSnapshot().state.instances.items[key]?.files.items[path]
          ?.content;
      if (typeof latest?.data === 'string' && latest.status === 'ready') {
        return {
          content: latest.data,
          mode: store.getSnapshot().state.instances.items[key]?.files.items[path]
            ?.metadata.data?.mode,
        };
      }

      try {
        const raw = await fetchRaw({ ...request, project, path });
        const content = new TextDecoder('utf-8', { fatal: false }).decode(raw.buffer);
        const hadMetadata = Boolean(
          store.getSnapshot().state.instances.items[key]?.files.items[path]
            ?.metadata.data,
        );
        store.update((state) => {
          const file = state.instances.items[key]?.files.items[path] ??
            store.ensureInstanceFile(key, path);
          file.content = { status: 'ready', data: content };
          if (raw.mode && file.metadata.data) {
            file.metadata = {
              ...file.metadata,
              status: file.metadata.status,
              data: {
                ...file.metadata.data,
                mode: raw.mode,
              },
            };
          }
        }, [
          storeKey,
          ...(raw.mode && hadMetadata
            ? [resourceKeys.instanceFileMetadata(key, path)]
            : []),
        ]);
        return { content, mode: raw.mode };
      } catch (error) {
        store.update((state) => {
          const file = state.instances.items[key]?.files.items[path];
          if (!file) return;
          file.content = {
            ...file.content,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load file content.',
          };
        }, [storeKey]);
        throw error;
      }
    });
  }

  async function fetchSymlinkTarget(request: InstanceFileMetadataRequest) {
    try {
      const response = await requestRaw(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/files`,
        {
          params: {
            project: request.project || 'default',
            path: normalizeAbsPath(request.path),
          },
        },
      );
      const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
      if (contentType.includes('application/json')) return null;
      const text = await response.text();
      return text.replace(/\r\n/g, '\n').split('\n')[0]?.trim() || null;
    } catch {
      return null;
    }
  }

  function download(request: InstanceFileMetadataRequest) {
    const url = new URL(
      `/1.0/instances/${encodeURIComponent(request.instanceName)}/files`,
      window.location.origin,
    );
    url.searchParams.set('project', request.project || 'default');
    url.searchParams.set('path', normalizeAbsPath(request.path));
    const link = document.createElement('a');
    link.href = url.toString();
    link.download = request.path.split('/').pop() || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return {
    getChildren,
    getMetadata,
    getCachedMetadata,
    uploadFile,
    createDirectory,
    createEmptyFile,
    deleteFile,
    download,
    fetchRaw,
    fetchBlob,
    fetchContent,
    fetchSymlinkTarget,
    saveFileContent,
  };
}
