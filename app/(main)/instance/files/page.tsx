'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { useInstanceContext } from '../_context/instance';
import { useFiles } from './_hooks/files';
import { getSymlinkResolvedNavTarget } from './_lib/files';
import { Spinner } from 'ui-web/components/spinner';
import { FileBrowser } from '../../_components/files';
import type { Instance } from '../../instances/_lib/instances.d';

function normalizeInstanceFsPath(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  let p = raw.trim();
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function getInstanceFilesHomePath(instance: Instance): string {
  const raw =
    instance.expanded_config?.['oci.cwd'] ?? instance.config?.['oci.cwd'];
  return normalizeInstanceFsPath(raw) ?? '/';
}

export default function FilesPage() {
  const searchParams = useSearchParams();
  const urlName = searchParams.get('name');
  const { instance, project, isLoading } = useInstanceContext();

  if (isLoading) {
    return <Spinner />;
  }

  if (!urlName || !instance) {
    return null;
  }

  // URL query is authoritative for active instance; wait for context to align.
  if (instance.name !== urlName) {
    return <Spinner />;
  }

  return (
    <Files
      key={urlName}
      instance={instance}
      instanceName={urlName}
      project={project}
    />
  );
}

function Files({
  instance,
  instanceName,
  project,
}: {
  instance: Instance;
  instanceName: string;
  project: string | null;
}) {
  const searchParams = useSearchParams();
  const [isRoutePending, startRouteTransition] = React.useTransition();
  const homePath = React.useMemo(() => getInstanceFilesHomePath(instance), [instance]);
  const instanceProject = instance.project ?? project ?? null;
  const pathParam = searchParams.get('path');
  const currentPath = React.useMemo(() => {
    const raw = pathParam ?? homePath;
    return normalizeInstanceFsPath(raw) ?? homePath;
  }, [pathParam, homePath]);

  const handleNavigate = React.useCallback((path: string) => {
    startRouteTransition(() => {
      // Ignore delayed callbacks from a previously mounted instance view.
      const liveParams = new URLSearchParams(window.location.search);
      const liveName = liveParams.get('name');
      if (liveName !== instanceName) {
        return;
      }

      const params = new URLSearchParams();
      params.set('name', instanceName);
      if (instanceProject) {
        params.set('project', instanceProject);
      }
      if (path === '/') {
        params.set('path', '/');
      } else if (path === homePath && homePath !== '/') {
        params.delete('path');
      } else {
        params.set('path', path);
      }

      const query = params.toString();
      const currentPathname = window.location.pathname;
      const target = query ? `${currentPathname}?${query}` : currentPathname;
      window.history.pushState(null, '', target);
    });
  }, [homePath, instanceName, instanceProject, startRouteTransition]);

  const {
    files,
    isLoading,
    isListingRevalidating,
    isMetadataLoading,
    isError,
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
  } = useFiles(instanceName, currentPath, instanceProject);

  return (
    <FileBrowser
      key={instanceName}
      files={files}
      isLoading={isLoading}
      isRoutePending={isRoutePending}
      isListingRevalidating={isListingRevalidating}
      isMetadataLoading={isMetadataLoading}
      isError={isError}
      homePath={homePath}
      currentPath={currentPath}
      onNavigate={handleNavigate}
      onUpload={(file, onProgress) => uploadFile(currentPath, file, onProgress)}
      onMoveFiles={moveFiles}
      onRenameFile={renameEntry}
      listChildDirectories={listChildDirectories}
      probePathKind={probeInstancePathKind}
      fetchDirectoryEntries={fetchDirectoryEntries}
      requestMetadataForNames={requestMetadataForNames}
      resolveSymlinkNavTarget={(path) =>
        getSymlinkResolvedNavTarget(instanceName, instanceProject, path)
      }
      onCreateEmptyFile={(name) => createEmptyFile(currentPath, name)}
      onCreateDirectory={(name) => createDirectory(currentPath, name)}
      onDelete={deleteFile}
      onDownload={downloadFile}
      onFetchContent={fetchFileContent}
      onFetchRaw={fetchFileRaw}
      onSaveContent={saveFileContent}
    />
  );
}
