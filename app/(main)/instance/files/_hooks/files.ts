import { useState, useEffect, useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  uploadFile as apiUploadFile,
  createDirectory as apiCreateDirectory,
  createEmptyFile as apiCreateEmptyFile,
  deleteFile as apiDeleteFile,
  downloadFile as apiDownloadFile,
  fetchFileContent as apiFetchFileContent,
  fetchFileRaw as apiFetchFileRaw,
  saveFileContent as apiSaveFileContent,
  getFileMetadata as apiFetchFileMetadata,
  listChildDirectoryPaths as apiListChildDirectoryPaths,
  probeInstancePathKind as apiProbeInstancePathKind,
} from '../_lib/files';
import {
  absPathParent,
  joinAbsPath,
  normalizeAbsPath,
} from '../../../_lib/files/path';
import { moveRemoteFile } from '../_lib/move-file-client';

type DirectoryResponse = {
  type: 'sync';
  metadata: string[];
};

type FileWithMetadata = {
  name: string;
  type?: string;
  size?: number;
  mode?: string;
  uid?: string;
  gid?: string;
};

function isDirectoryResponse(value: unknown): value is DirectoryResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'sync' &&
    'metadata' in value &&
    Array.isArray(value.metadata)
  );
}

const directoryFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error: Error & { status?: number } = new Error(
      'An error occurred while fetching the data.',
    );
    error.status = res.status;
    throw error;
  }

  const text = await res.text();
  try {
    const json: unknown = JSON.parse(text);
    if (isDirectoryResponse(json)) {
      return json;
    }
  } catch {
    // Not JSON
  }

  throw new Error('NOT_A_DIRECTORY');
};

function buildFilesCacheKey(instanceName: string, path: string) {
  return `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(path)}`;
}

/** Directory listing + metadata for breadcrumb peek / one-off previews (not SWR-backed). */
async function fetchDirectoryEntriesForInstance(
  instanceName: string,
  dirPath: string,
): Promise<FileWithMetadata[]> {
  const normalizedPath = normalizeAbsPath(dirPath);
  const data = await directoryFetcher(buildFilesCacheKey(instanceName, normalizedPath));
  if (!data?.metadata?.length) return [];
  const names = data.metadata as string[];
  const entries = await Promise.all(
    names.map(async (fileName) => {
      try {
        const filePath = joinAbsPath(normalizedPath, fileName);
        const meta = await apiFetchFileMetadata(instanceName, filePath);
        return {
          name: fileName,
          type: meta.type ?? undefined,
          size: meta.size ? parseInt(meta.size, 10) : undefined,
          mode: meta.mode ?? undefined,
          uid: meta.uid ?? undefined,
          gid: meta.gid ?? undefined,
        };
      } catch {
        return { name: fileName };
      }
    }),
  );
  return entries;
}

export function useFiles(instanceName: string, path: string) {
  const { mutate } = useSWRConfig();
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Fetch file listing
  const { data, error, isLoading } = useSWR(
    buildFilesCacheKey(instanceName, normalizedPath),
    directoryFetcher,
  );

  const [filesWithMetadata, setFilesWithMetadata] = useState<FileWithMetadata[]>([]);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);

  useEffect(() => {
    if (!data?.metadata || !Array.isArray(data.metadata)) {
      setFilesWithMetadata([]);
      return;
    }

    const fetchMetadata = async () => {
      setIsMetadataLoading(true);
      try {
        const files = data.metadata as string[];
        const metadataPromises = files.map(async (fileName) => {
          try {
            const filePath = joinAbsPath(normalizedPath, fileName);
            const meta = await apiFetchFileMetadata(instanceName, filePath);
            return {
              name: fileName,
              type: meta.type ?? undefined,
              size: meta.size ? parseInt(meta.size, 10) : undefined,
              mode: meta.mode ?? undefined,
              uid: meta.uid ?? undefined,
              gid: meta.gid ?? undefined,
            };
          } catch (e) {
            console.error(`Failed to fetch metadata for ${fileName}`, e);
            return { name: fileName };
          }
        });

        const results = await Promise.all(metadataPromises);
        setFilesWithMetadata(results);
      } catch (e) {
        console.error('Error fetching metadata', e);
      } finally {
        setIsMetadataLoading(false);
      }
    };

    fetchMetadata();
  }, [data, instanceName, normalizedPath]);

  const uploadFile = async (
    currentPath: string,
    file: File,
    onProgress?: (percent: number | null) => void,
  ) => {
    await apiUploadFile(instanceName, currentPath, file, onProgress);
    await mutate(buildFilesCacheKey(instanceName, currentPath));
  };

  const createEmptyFile = async (currentPath: string, fileName: string) => {
    await apiCreateEmptyFile(instanceName, currentPath, fileName);
    await mutate(buildFilesCacheKey(instanceName, currentPath));
  };

  const createDirectory = async (currentPath: string, dirName: string) => {
    await apiCreateDirectory(instanceName, currentPath, dirName);
    await mutate(buildFilesCacheKey(instanceName, currentPath));
  };

  const deleteFile = async (filePath: string) => {
    await apiDeleteFile(instanceName, filePath);
    await mutate(buildFilesCacheKey(instanceName, absPathParent(filePath)));
  };

  const downloadFile = (filePath: string) => {
    apiDownloadFile(instanceName, filePath);
  };

  const fetchFileContent = async (filePath: string) => {
    return apiFetchFileContent(instanceName, filePath);
  };

  const fetchFileRaw = async (filePath: string) => {
    return apiFetchFileRaw(instanceName, filePath);
  };

  const saveFileContent = async (filePath: string, content: string, mode?: string) => {
    await apiSaveFileContent(instanceName, filePath, content, mode);
    await mutate(buildFilesCacheKey(instanceName, absPathParent(filePath)));
  };

  const moveFiles = async (
    sources: { sourcePath: string; fileName: string }[],
    destParentPath: string,
    onProgress?: (
      phase: 'download' | 'upload',
      percent: number | null,
      detail: { index: number; total: number; label: string },
    ) => void,
  ) => {
    const dest = normalizeAbsPath(destParentPath);
    const refresh = new Set<string>();
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      refresh.add(absPathParent(s.sourcePath));
      refresh.add(dest);
      await moveRemoteFile({
        fetchFileRaw: (p) => apiFetchFileRaw(instanceName, p),
        sourcePath: s.sourcePath,
        destParentPath: dest,
        fileName: s.fileName,
        uploadToParent: (parent, file, prog) =>
          apiUploadFile(instanceName, parent, file, prog),
        deleteFile: (p) => apiDeleteFile(instanceName, p),
        onProgress: (phase, pct) =>
          onProgress?.(phase, pct, {
            index: i + 1,
            total: sources.length,
            label: s.fileName,
          }),
      });
    }
    for (const p of refresh) {
      await mutate(buildFilesCacheKey(instanceName, p));
    }
  };

  const listChildDirectories = useCallback(
    async (parentPath: string) =>
      apiListChildDirectoryPaths(instanceName, parentPath),
    [instanceName],
  );

  const probeInstancePathKind = useCallback(
    async (absPath: string) => apiProbeInstancePathKind(instanceName, absPath),
    [instanceName],
  );

  const fetchDirectoryEntries = useCallback(
    (dirPath: string) => fetchDirectoryEntriesForInstance(instanceName, dirPath),
    [instanceName],
  );

  const renameEntry = async (fullPath: string, newBaseName: string) => {
    const name = newBaseName.trim();
    if (!name) throw new Error('Enter a file name.');
    const parent = absPathParent(fullPath);
    const oldBase = fullPath.slice(fullPath.lastIndexOf('/') + 1);
    if (name === oldBase) return;
    await moveFiles([{ sourcePath: fullPath, fileName: name }], parent);
  };

  return {
    files: filesWithMetadata,
    isLoading: isLoading || (isMetadataLoading && filesWithMetadata.length === 0),
    isError: error,
    uploadFile,
    createEmptyFile,
    createDirectory,
    deleteFile,
    downloadFile,
    fetchFileContent,
    fetchFileRaw,
    saveFileContent,
    moveFiles,
    renameEntry,
    listChildDirectories,
    probeInstancePathKind,
    fetchDirectoryEntries,
  };
}
