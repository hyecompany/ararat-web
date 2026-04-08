import { useState, useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  uploadFile as apiUploadFile,
  createDirectory as apiCreateDirectory,
  deleteFile as apiDeleteFile,
  downloadFile as apiDownloadFile,
  fetchFileContent as apiFetchFileContent,
  saveFileContent as apiSaveFileContent,
  getFileMetadata as apiFetchFileMetadata,
} from '../_lib/files';

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
            const filePath = `${normalizedPath === '/' ? '' : normalizedPath}/${fileName}`;
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

  const uploadFile = async (currentPath: string, file: File) => {
    await apiUploadFile(instanceName, currentPath, file);
    await mutate(buildFilesCacheKey(instanceName, currentPath));
  };

  const createDirectory = async (currentPath: string, dirName: string) => {
    await apiCreateDirectory(instanceName, currentPath, dirName);
    await mutate(buildFilesCacheKey(instanceName, currentPath));
  };

  const deleteFile = async (filePath: string) => {
    await apiDeleteFile(instanceName, filePath);
    const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    await mutate(buildFilesCacheKey(instanceName, parentPath));
  };

  const downloadFile = (filePath: string) => {
    apiDownloadFile(instanceName, filePath);
  };

  const fetchFileContent = async (filePath: string) => {
    return apiFetchFileContent(instanceName, filePath);
  };

  const saveFileContent = async (filePath: string, content: string, mode?: string) => {
    await apiSaveFileContent(instanceName, filePath, content, mode);
    const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    await mutate(buildFilesCacheKey(instanceName, parentPath));
  };

  return {
    files: filesWithMetadata,
    isLoading: isLoading || (isMetadataLoading && filesWithMetadata.length === 0),
    isError: error,
    uploadFile,
    createDirectory,
    deleteFile,
    downloadFile,
    fetchFileContent,
    saveFileContent,
  };
}
