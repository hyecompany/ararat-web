import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  startTransition,
} from 'react';
import {
  absPathParent,
  basenameAbsPath,
  joinAbsPath,
  normalizeAbsPath,
  resolveSymlinkTarget,
} from '../../../_lib/files/path';
import { moveRemoteFile } from '../_lib/move-file-client';
import { useIncusClient } from '@/app/_incus/provider';
import type { InstanceFileMetadata } from '@/app/_incus/types';
import { useInstanceFileChildren } from '@/app/_incus/resources/instances/files/hooks';

type FileWithMetadata = {
  name: string;
  type?: string;
  size?: number;
  mode?: string;
  uid?: string;
  gid?: string;
};

type InstancePathKind = 'directory' | 'file' | 'missing';

type FileMetadataFetcher = (
  filePath: string,
) => Promise<Pick<InstanceFileMetadata, 'type' | 'size' | 'mode' | 'uid' | 'gid'>>;

/** Bounded parallelism for HEAD/metadata fan-out (large dirs + browser connection limits). */
const METADATA_FETCH_BATCH = 16;

async function fetchEntryMetadata(
  fetchMetadata: FileMetadataFetcher,
  listingParent: string,
  fileName: string,
): Promise<FileWithMetadata> {
  try {
    const filePath = joinAbsPath(listingParent, fileName);
    const meta = await fetchMetadata(filePath);
    const type = meta.type ?? undefined;
    return {
      name: fileName,
      type,
      size: meta.size,
      mode: meta.mode ?? undefined,
      uid: meta.uid ?? undefined,
      gid: meta.gid ?? undefined,
    };
  } catch {
    return { name: fileName };
  }
}

function rowFromCachedMetadata(
  metadata: InstanceFileMetadata | undefined,
  name: string,
): FileWithMetadata {
  return {
    name,
    type: metadata?.type,
    size: metadata?.size,
    mode: metadata?.mode,
    uid: metadata?.uid,
    gid: metadata?.gid,
  };
}

/** Directory listing + metadata for breadcrumb peek / one-off previews. */
async function fetchDirectoryEntriesForInstance(
  instanceName: string,
  project: string | null | undefined,
  dirPath: string,
  fetchMetadata: FileMetadataFetcher,
  fetchChildren: (path: string) => Promise<string[]>,
): Promise<FileWithMetadata[]> {
  const normalizedPath = normalizeAbsPath(dirPath);
  const names = await fetchChildren(normalizedPath);
  if (!names.length) return [];
  const entries: FileWithMetadata[] = names.map((name) => ({ name }));
  for (let i = 0; i < names.length; i += METADATA_FETCH_BATCH) {
    const slice = names.slice(i, i + METADATA_FETCH_BATCH);
    const batch = await Promise.all(
      slice.map((fileName) =>
        fetchEntryMetadata(fetchMetadata, normalizedPath, fileName),
      ),
    );
    batch.forEach((row, j) => {
      entries[i + j] = row;
    });
  }
  return entries;
}

export function useFiles(
  instanceName: string,
  path: string,
  project?: string | null,
) {
  const incusClient = useIncusClient();
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  /**
   * Last path for which a listing GET finished. HEAD metadata probes should
   * target the listing payload currently on screen, not an in-flight route path.
   */
  const settledListingPathRef = useRef(normalizedPath);

  const listing = useInstanceFileChildren({
    instanceName,
    project,
    path: normalizedPath,
  });
  const error = listing.error;

  const hasListingPayload = Array.isArray(listing.names);

  /** Full-area spinner only when there is no listing to show yet (cold load / empty cache). */
  const isListingLoading =
    !error && !hasListingPayload && listing.status === 'loading';

  /** Stale listing visible while the next folder's GET is in flight. */
  const isListingRevalidating =
    !error && hasListingPayload && (listing.status === 'stale' || listing.status === 'refreshing');

  useLayoutEffect(() => {
    if (!hasListingPayload || error) return;
    if (listing.status !== 'refreshing') {
      settledListingPathRef.current = normalizedPath;
    }
  }, [hasListingPayload, listing.status, normalizedPath, error]);

  const [filesWithMetadata, setFilesWithMetadata] = useState<FileWithMetadata[]>(
    [],
  );
  const [metadataRequestCount, setMetadataRequestCount] = useState(0);

  /** Bumped whenever the listing payload / directory changes so stale HEAD batches drop. */
  const listingGenerationRef = useRef(0);
  const nameToIndexRef = useRef<Map<string, number>>(new Map());
  /** Parent path used for HEAD requests (matches skeleton listing). */
  const metadataParentDirRef = useRef('');
  const loadedMetadataNamesRef = useRef<Set<string>>(new Set());
  const inFlightMetadataNamesRef = useRef<Set<string>>(new Set());
  /** Last merged listing fingerprint; unchanged refreshes must not wipe HEAD metadata. */
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
      setMetadataRequestCount((count) => count + toFetch.length);

      void (async () => {
        try {
          for (let i = 0; i < toFetch.length; i += METADATA_FETCH_BATCH) {
            const slice = toFetch.slice(i, i + METADATA_FETCH_BATCH);
            const batch = await Promise.all(
              slice.map((fileName) =>
                fetchEntryMetadata(
                  (filePath) =>
                    incusClient.instanceFiles.getMetadata({
                      instanceName,
                      project,
                      path: filePath,
                    }),
                  parent,
                  fileName,
                ),
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
        } finally {
          for (const n of toFetch) {
            inFlightMetadataNamesRef.current.delete(n);
          }
          setMetadataRequestCount((count) => Math.max(0, count - toFetch.length));
        }
      })();
    },
    [incusClient, instanceName, project],
  );

  useEffect(() => {
    if (error) {
      setFilesWithMetadata([]);
      listingSignatureRef.current = '';
      return;
    }

    if (!listing.names || !Array.isArray(listing.names)) {
      setFilesWithMetadata([]);
      listingSignatureRef.current = '';
      return;
    }

    const names = listing.names;
    const listingSignature = `${normalizedPath}\n${names.join('\n')}`;
    if (listingSignatureRef.current === listingSignature) {
      const parentDirForMetadata = listing.status !== 'refreshing'
        ? normalizedPath
        : settledListingPathRef.current;
      metadataParentDirRef.current = parentDirForMetadata;
      return;
    }

    listingSignatureRef.current = listingSignature;

    listingGenerationRef.current += 1;
    loadedMetadataNamesRef.current = new Set();
    inFlightMetadataNamesRef.current = new Set();

    const parentDirForMetadata = listing.status !== 'refreshing'
      ? normalizedPath
      : settledListingPathRef.current;
    metadataParentDirRef.current = parentDirForMetadata;

    const idx = new Map<string, number>();
    names.forEach((n, i) => idx.set(n, i));
    nameToIndexRef.current = idx;

    const readyNames = new Set<string>();
    const initialRows = names.map((name) => {
      const fullPath = joinAbsPath(parentDirForMetadata, name);
      const cached = incusClient.instanceFiles.getCachedMetadata({
        instanceName,
        project,
        path: fullPath,
      });
      if (cached) {
        readyNames.add(name);
      }
      return rowFromCachedMetadata(cached, name);
    });

    loadedMetadataNamesRef.current = readyNames;
    setFilesWithMetadata(initialRows);

    queueMicrotask(() => {
      requestMetadataForNames(names.slice(0, 128));
    });
  }, [listing.names, error, listing.status, incusClient, instanceName, normalizedPath, project, requestMetadataForNames]);

  const uploadFile = async (
    currentPath: string,
    file: File,
    onProgress?: (percent: number | null) => void,
  ) => {
    await incusClient.instanceFiles.uploadFile({
      instanceName,
      project,
      parentPath: currentPath,
      path: joinAbsPath(currentPath, file.name),
      file,
      onProgress,
    });
  };

  const createEmptyFile = async (currentPath: string, fileName: string) => {
    await incusClient.instanceFiles.createEmptyFile({
      instanceName,
      project,
      parentPath: currentPath,
      path: joinAbsPath(currentPath, fileName),
      name: fileName,
    });
  };

  const createDirectory = async (currentPath: string, dirName: string) => {
    await incusClient.instanceFiles.createDirectory({
      instanceName,
      project,
      parentPath: currentPath,
      path: joinAbsPath(currentPath, dirName),
      name: dirName,
    });
  };

  const deleteFile = async (filePath: string) => {
    await incusClient.instanceFiles.deleteFile({ instanceName, project, path: filePath });
  };

  const downloadFile = (filePath: string) => {
    incusClient.instanceFiles.download({ instanceName, project, path: filePath });
  };

  const fetchFileContent = async (filePath: string) => {
    return incusClient.instanceFiles.fetchContent({ instanceName, project, path: filePath });
  };

  const fetchFileRaw = async (filePath: string) => {
    return incusClient.instanceFiles.fetchRaw({ instanceName, project, path: filePath });
  };

  const saveFileContent = async (filePath: string, content: string, mode?: string) => {
    await incusClient.instanceFiles.saveFileContent({
      instanceName,
      project,
      path: filePath,
      content,
      mode,
    });
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
        fetchFileBlob: (p) =>
          incusClient.instanceFiles.fetchBlob({ instanceName, project, path: p }),
        sourcePath: s.sourcePath,
        destParentPath: dest,
        fileName: s.fileName,
        uploadToParent: (parent, file, prog) =>
          incusClient.instanceFiles.uploadFile({
            instanceName,
            project,
            parentPath: parent,
            path: joinAbsPath(parent, file.name),
            file,
            onProgress: prog,
          }),
        deleteFile: (p) =>
          incusClient.instanceFiles.deleteFile({ instanceName, project, path: p }),
        onProgress: (phase, pct) =>
          onProgress?.(phase, pct, {
            index: i + 1,
            total: sources.length,
            label: s.fileName,
          }),
      });
      incusClient.instanceFiles.removeMetadata({
        instanceName,
        project,
        path: s.sourcePath,
      });
      incusClient.instanceFiles.markMetadataMissing({
        instanceName,
        project,
        path: joinAbsPath(dest, s.fileName),
      });
    }
    for (const p of refresh) {
      incusClient.instanceFiles.markChildrenStale({ instanceName, project, path: p });
    }
  };

  const listChildDirectories = useCallback(
    async (parentPath: string) => {
      const parent = normalizeAbsPath(parentPath);
      const names = await incusClient.instanceFiles.getChildren({
        instanceName,
        project,
        path: parent,
      });
      const directories: string[] = [];

      for (let i = 0; i < names.length; i += METADATA_FETCH_BATCH) {
        const slice = names.slice(i, i + METADATA_FETCH_BATCH);
        const batch = await Promise.all(
          slice.map(async (name) => {
            const fullPath = joinAbsPath(parent, name);
            try {
              const metadata = await incusClient.instanceFiles.getMetadata({
                instanceName,
                project,
                path: fullPath,
              });
              const type = metadata.type?.toLowerCase();
              return type === 'directory' || type === 'symlink' ? fullPath : null;
            } catch {
              return null;
            }
          }),
        );
        for (const path of batch) {
          if (path) directories.push(path);
        }
      }

      return directories.sort((a, b) => a.localeCompare(b));
    },
    [incusClient, instanceName, project],
  );

  const probeInstancePathKind = useCallback(
    async (absPath: string): Promise<InstancePathKind> => {
      const probe = async (pathToProbe: string, depth: number): Promise<InstancePathKind> => {
        if (depth > 12) return 'missing';
        try {
          const normalized = normalizeAbsPath(pathToProbe);
          const metadata = await incusClient.instanceFiles.getMetadata({
            instanceName,
            project,
            path: normalized,
          });
          const type = metadata.type?.toLowerCase();
          if (type === 'directory') return 'directory';
          if (type === 'file') return 'file';
          if (type === 'symlink') {
            const rawTarget = await incusClient.instanceFiles.fetchSymlinkTarget({
              instanceName,
              project,
              path: normalized,
            });
            if (!rawTarget) return 'directory';
            const resolved = resolveSymlinkTarget(normalized, rawTarget);
            return probe(resolved, depth + 1);
          }
        } catch {
          return 'missing';
        }
        return 'missing';
      };

      return probe(absPath, 0);
    },
    [incusClient, instanceName, project],
  );

  const resolveSymlinkNavTarget = useCallback(
    async (
      linkAbsPath: string,
    ): Promise<{ directoryPath: string; fileBasename?: string }> => {
      const resolve = async (
        pathToResolve: string,
        depth: number,
      ): Promise<{ directoryPath: string; fileBasename?: string }> => {
        if (depth > 12) {
          return { directoryPath: normalizeAbsPath(pathToResolve) };
        }

        const normalized = normalizeAbsPath(pathToResolve);
        const rawTarget = await incusClient.instanceFiles.fetchSymlinkTarget({
          instanceName,
          project,
          path: normalized,
        });
        if (!rawTarget) {
          return { directoryPath: normalized };
        }

        const resolved = resolveSymlinkTarget(normalized, rawTarget);
        try {
          const metadata = await incusClient.instanceFiles.getMetadata({
            instanceName,
            project,
            path: resolved,
          });
          const type = metadata.type?.toLowerCase();
          if (type === 'directory') return { directoryPath: resolved };
          if (type === 'symlink') return resolve(resolved, depth + 1);
          if (type === 'file') {
            return {
              directoryPath: absPathParent(resolved),
              fileBasename: basenameAbsPath(resolved),
            };
          }
        } catch {
          return { directoryPath: resolved };
        }

        return { directoryPath: resolved };
      };

      return resolve(linkAbsPath, 0);
    },
    [incusClient, instanceName, project],
  );

  const fetchDirectoryEntries = useCallback(
    (dirPath: string) =>
      fetchDirectoryEntriesForInstance(instanceName, project, dirPath, (filePath) =>
        incusClient.instanceFiles.getMetadata({
          instanceName,
          project,
          path: filePath,
        }),
      (dir) =>
        incusClient.instanceFiles.getChildren({
          instanceName,
          project,
          path: dir,
        }),
      ),
    [incusClient, instanceName, project],
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
    isMetadataLoading: metadataRequestCount > 0,
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
    resolveSymlinkNavTarget,
  };
}
