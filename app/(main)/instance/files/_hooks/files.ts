import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  startTransition,
} from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  uploadFile as apiUploadFile,
  createDirectory as apiCreateDirectory,
  createEmptyFile as apiCreateEmptyFile,
  deleteFile as apiDeleteFile,
  downloadFile as apiDownloadFile,
  fetchFileContent as apiFetchFileContent,
  fetchFileBlob as apiFetchFileBlob,
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

/** Bounded parallelism for HEAD/metadata fan-out (large dirs + browser connection limits). */
const METADATA_FETCH_BATCH = 16;

async function fetchEntryMetadata(
  instanceName: string,
  listingParent: string,
  fileName: string,
): Promise<FileWithMetadata> {
  try {
    const filePath = joinAbsPath(listingParent, fileName);
    const meta = await apiFetchFileMetadata(instanceName, filePath);
    const type = meta.type ?? undefined;
    return {
      name: fileName,
      type,
      size: meta.size ? parseInt(meta.size, 10) : undefined,
      mode: meta.mode ?? undefined,
      uid: meta.uid ?? undefined,
      gid: meta.gid ?? undefined,
    };
  } catch {
    return { name: fileName };
  }
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
  const entries: FileWithMetadata[] = names.map((name) => ({ name }));
  for (let i = 0; i < names.length; i += METADATA_FETCH_BATCH) {
    const slice = names.slice(i, i + METADATA_FETCH_BATCH);
    const batch = await Promise.all(
      slice.map((fileName) =>
        fetchEntryMetadata(instanceName, normalizedPath, fileName),
      ),
    );
    batch.forEach((row, j) => {
      entries[i + j] = row;
    });
  }
  return entries;
}

export function useFiles(instanceName: string, path: string) {
  const { mutate } = useSWRConfig();
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  /**
   * Last path for which a listing GET finished (`!isValidating`). HEAD metadata probes
   * should target the listing payload currently on screen, not an in-flight route path.
   */
  const settledListingPathRef = useRef(normalizedPath);

  // Fetch file listing (one GET per folder). HEAD requests for metadata run after, in batches.
  const {
    data,
    error,
    isLoading: swrIsLoading,
    isValidating,
  } = useSWR(
    buildFilesCacheKey(instanceName, normalizedPath),
    directoryFetcher,
    { keepPreviousData: false },
  );

  const hasListingPayload =
    isDirectoryResponse(data) && Array.isArray(data.metadata);

  /** Full-area spinner only when there is no listing to show yet (cold load / empty cache). */
  const isListingLoading =
    !error && !hasListingPayload && (swrIsLoading || isValidating);

  /** Stale listing visible while the next folder's GET is in flight. */
  const isListingRevalidating = !error && hasListingPayload && isValidating;

  useLayoutEffect(() => {
    if (!hasListingPayload || error) return;
    if (!isValidating) {
      settledListingPathRef.current = normalizedPath;
    }
  }, [hasListingPayload, isValidating, normalizedPath, error]);

  const [filesWithMetadata, setFilesWithMetadata] = useState<FileWithMetadata[]>(
    [],
  );

  /** Bumped whenever the listing payload / directory changes so stale HEAD batches drop. */
  const listingGenerationRef = useRef(0);
  const nameToIndexRef = useRef<Map<string, number>>(new Map());
  /** Parent path used for HEAD requests (matches skeleton listing). */
  const metadataParentDirRef = useRef('');
  const loadedMetadataNamesRef = useRef<Set<string>>(new Set());
  const inFlightMetadataNamesRef = useRef<Set<string>>(new Set());
  /** Last merged listing fingerprint; unchanged SWR revalidation must not wipe HEAD metadata. */
  const listingSignatureRef = useRef<string>('');

  const requestMetadataForNames = useCallback(
    (rawNames: string[]) => {
      if (rawNames.length === 0) return;
      const generation = listingGenerationRef.current;
      const parent = metadataParentDirRef.current;

      const toFetch: string[] = [];
      for (let i = 0; i < rawNames.length; i++) {
        const n = rawNames[i];
        if (!nameToIndexRef.current.has(n)) continue;
        if (loadedMetadataNamesRef.current.has(n)) continue;
        if (inFlightMetadataNamesRef.current.has(n)) continue;
        inFlightMetadataNamesRef.current.add(n);
        toFetch.push(n);
      }
      if (toFetch.length === 0) return;

      void (async () => {
        for (let i = 0; i < toFetch.length; i += METADATA_FETCH_BATCH) {
          const slice = toFetch.slice(i, i + METADATA_FETCH_BATCH);
          const batch = await Promise.all(
            slice.map((fileName) =>
              fetchEntryMetadata(instanceName, parent, fileName),
            ),
          );
          batch.forEach((row) =>
            inFlightMetadataNamesRef.current.delete(row.name),
          );
          if (generation !== listingGenerationRef.current) return;
          batch.forEach((row) =>
            loadedMetadataNamesRef.current.add(row.name),
          );
          startTransition(() => {
            if (generation !== listingGenerationRef.current) return;
            setFilesWithMetadata((prev) => {
              const next = [...prev];
              for (const row of batch) {
                const j = nameToIndexRef.current.get(row.name);
                if (j !== undefined) next[j] = row;
              }
              return next;
            });
          });
        }
      })();
    },
    [instanceName],
  );

  useEffect(() => {
    if (error) {
      setFilesWithMetadata([]);
      listingSignatureRef.current = '';
      return;
    }

    if (!data?.metadata || !Array.isArray(data.metadata)) {
      setFilesWithMetadata([]);
      listingSignatureRef.current = '';
      return;
    }

    const names = data.metadata as string[];
    const listingSignature = `${normalizedPath}\n${names.join('\n')}`;
    if (listingSignatureRef.current === listingSignature) {
      const parentDirForMetadata = !isValidating
        ? normalizedPath
        : settledListingPathRef.current;
      metadataParentDirRef.current = parentDirForMetadata;
      return;
    }

    listingSignatureRef.current = listingSignature;

    listingGenerationRef.current += 1;
    loadedMetadataNamesRef.current = new Set();
    inFlightMetadataNamesRef.current = new Set();

    const parentDirForMetadata = !isValidating
      ? normalizedPath
      : settledListingPathRef.current;
    metadataParentDirRef.current = parentDirForMetadata;

    const idx = new Map<string, number>();
    names.forEach((n, i) => idx.set(n, i));
    nameToIndexRef.current = idx;

    setFilesWithMetadata(names.map((n) => ({ name: n })));

    queueMicrotask(() => {
      requestMetadataForNames(names.slice(0, 128));
    });
  }, [data, error, isValidating, normalizedPath, requestMetadataForNames]);

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
        fetchFileBlob: (p) => apiFetchFileBlob(instanceName, p),
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
    isLoading: isListingLoading,
    isListingRevalidating,
    isMetadataLoading: false,
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
    requestMetadataForNames,
  };
}
