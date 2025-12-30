import { useState, useEffect, useContext } from 'react';
import useSWR, { mutate } from 'swr';
import EventEmitterContext from '../../../_context/events';
import {
  uploadFile as apiUploadFile,
  createDirectory as apiCreateDirectory,
  deleteFile as apiDeleteFile,
  downloadFile as apiDownloadFile,
  fetchFileContent as apiFetchFileContent,
  saveFileContent as apiSaveFileContent,
  getFileMetadata as apiFetchFileMetadata,
  createFile as apiCreateFile,
} from '../_lib/files';
import { incusEventTarget } from '../../../_context/events';

const directoryFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = new Error('An error occurred while fetching the data.');
    (error as any).status = res.status;
    throw error;
  }

  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (json.type === 'sync' && Array.isArray(json.metadata)) {
      return json;
    }
  } catch (e) {
    // Not JSON
  }

  throw new Error('NOT_A_DIRECTORY');
};

export function useFiles(instanceName: string, path: string) {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const getSWRKey = (p: string) => {
    const norm = p.startsWith('/') ? p : `/${p}`;
    return `/1.0/instances/${instanceName}/files?path=${encodeURIComponent(norm)}`;
  };
  const revalidateCurrentPath = () =>
    mutate(getSWRKey(normalizedPath), undefined, { revalidate: true });
  const scheduleRevalidate = () => {
    revalidateCurrentPath();
    // Some Incus operations emit events slightly before the listing is updated; re-run shortly after.
    setTimeout(revalidateCurrentPath, 300);
  };

  // Fetch file listing
  const { data, error, isLoading } = useSWR(
    getSWRKey(normalizedPath),
    directoryFetcher,
  );

  const [filesWithMetadata, setFilesWithMetadata] = useState<any[]>([]);
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
              type: meta.type,
              size: meta.size ? parseInt(meta.size, 10) : undefined,
              mode: meta.mode,
              uid: meta.uid,
              gid: meta.gid,
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

  const { socket } = useContext(EventEmitterContext);

  // Listen for Incus events (via WebSocket and shared EventTarget) to revalidate when files change
  useEffect(() => {
    const handleIncusEvent = (data: any) => {
      try {
        const { type, metadata } = data || {};
        if (!type) return;

        if (type === 'lifecycle' && metadata) {
          const { action, source } = metadata as {
            action?: string;
            source?: string;
          };
          const sourceText = source || '';
          const isSameInstance = sourceText.includes(
            `/1.0/instances/${instanceName}`,
          );
          if (!isSameInstance) return;

          // Prefer matching known actions but don't rely on exact names.
          const fileActions = new Set([
            'instance-file-pushed',
            'instance-file-deleted',
            'instance-file-retrieved',
            'instance-file-created',
          ]);
          if (action && fileActions.has(action)) {
            scheduleRevalidate();
            return;
          }

          // Fallback: refresh on any lifecycle event for this instance (covers mislabelled actions).
          scheduleRevalidate();
          return;
        }

        if (type === 'operation' && metadata) {
          const resources = (metadata as any).resources as
            | Record<string, string[]>
            | undefined;
          const instanceResources =
            resources?.instances || resources?.instance || resources?.target;
          const touchesInstance = Array.isArray(instanceResources)
            ? instanceResources.some((r) =>
                r.includes(`/instances/${instanceName}`),
              )
            : false;
          if (touchesInstance) {
            scheduleRevalidate();
            return;
          }

          // Some operations report the target instance in metadata context instead of resources.
          const maybeContext = (metadata as any).context;
          const ctxInstance =
            maybeContext?.instance ||
            maybeContext?.target ||
            maybeContext?.name ||
            '';
          if (
            typeof ctxInstance === 'string' &&
            ctxInstance.includes(instanceName)
          ) {
            scheduleRevalidate();
          }
        }
      } catch (e) {
        console.error('Failed to handle lifecycle message', e);
      }
    };

    const socketListener = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data);
        handleIncusEvent(parsed);
      } catch (e) {
        console.error('Failed to parse Incus event', e);
      }
    };

    if (socket) {
      socket.addEventListener('message', socketListener);
    }

    const eventTargetListener = (event: Event) => {
      const custom = event as CustomEvent;
      handleIncusEvent(custom.detail);
    };

    if (incusEventTarget) {
      incusEventTarget.addEventListener('incus-event', eventTargetListener);
    }

    return () => {
      if (socket) {
        socket.removeEventListener('message', socketListener);
      }
      if (incusEventTarget) {
        incusEventTarget.removeEventListener(
          'incus-event',
          eventTargetListener,
        );
      }
    };
  }, [socket, instanceName, normalizedPath]);

  const uploadFile = async (
    currentPath: string,
    file: File,
    onProgress?: (progress: number) => void,
  ) => {
    await apiUploadFile(instanceName, currentPath, file, onProgress);
    await revalidateCurrentPath();
  };

  const createFile = async (currentPath: string, fileName: string) => {
    await apiCreateFile(instanceName, currentPath, fileName);
    await revalidateCurrentPath();
  };

  const createDirectory = async (currentPath: string, dirName: string) => {
    await apiCreateDirectory(instanceName, currentPath, dirName);
    await revalidateCurrentPath();
  };

  const deleteFile = async (filePath: string) => {
    await apiDeleteFile(instanceName, filePath);
    await revalidateCurrentPath();
  };

  const renameFile = async (
    oldName: string,
    newName: string,
    onProgress?: (progress: number) => void,
  ) => {
    const parentPath = normalizedPath === '/' ? '' : normalizedPath;
    const oldPath = `${parentPath}/${oldName}`;
    const newPath = `${parentPath}/${newName}`;

    try {
      // Signal start
      onProgress?.(0);

      // 1. Read old content
      const { content, mode } = await apiFetchFileContent(
        instanceName,
        oldPath,
      );
      onProgress?.(50);

      // 2. Upload new file with progress tracking
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const file = new File([blob], newName, {
        type: 'application/octet-stream',
      });
      await apiUploadFile(instanceName, parentPath, file, (p) => {
        if (p === undefined || p === null) return;
        // Map 0-100 upload to 50-100 overall
        const scaled = 50 + p / 2;
        onProgress?.(scaled);
      });
      // 3. Delete old file
      await apiDeleteFile(instanceName, oldPath);
      onProgress?.(100);
      await revalidateCurrentPath();
    } catch (e) {
      console.error('Failed to rename file:', e);
      throw e;
    }
  };

  const downloadFile = (filePath: string) => {
    apiDownloadFile(instanceName, filePath);
  };

  const fetchFileContent = async (filePath: string) => {
    return apiFetchFileContent(instanceName, filePath);
  };

  const saveFileContent = async (
    filePath: string,
    content: string,
    mode?: string,
  ) => {
    await apiSaveFileContent(instanceName, filePath, content, mode);
    await revalidateCurrentPath();
  };

  return {
    files: filesWithMetadata,
    isLoading: isLoading || isMetadataLoading,
    isError: error,
    uploadFile,
    createDirectory,
    createFile,
    deleteFile,
    renameFile,
    downloadFile,
    fetchFileContent,
    saveFileContent,
  };
}
