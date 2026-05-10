'use client';

import React, { addTransitionType } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInstanceContext } from '../_context/instance';
import { useInstance } from '../_hooks/instance';
import { useFiles } from './_hooks/files';
import { FileBrowser } from '../../_components/files';
import { classifyFileNavigationTransition } from '../../_lib/files';
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

function getNextRouterPathname(pathname: string) {
  // The desktop proxy exposes the app at /ui, but Next's router still expects
  // internal paths like /instance/files. Passing /ui/... to router.push causes
  // the external URL to become /ui/ui/...
  if (pathname === '/ui') {
    return '/';
  }

  return pathname.startsWith('/ui/') ? pathname.slice('/ui'.length) : pathname;
}

export default function FilesPage() {
  const searchParams = useSearchParams();
  const urlName = searchParams.get('name');
  const { name, project } = useInstanceContext();
  const instanceName = urlName ?? name;
  const instanceProject = searchParams.get('project') ?? project;
  const { instance } = useInstance(instanceName, instanceProject, {
    metadata: true,
  });

  if (!urlName || !instanceName) {
    return null;
  }

  return (
    <Files
      key={urlName}
      instance={instance}
      instanceName={instanceName}
      project={instanceProject}
    />
  );
}

function Files({
  instance,
  instanceName,
  project,
}: {
  instance?: Instance;
  instanceName: string;
  project: string | null;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isRoutePending, startRouteTransition] = React.useTransition();
  const homePath = React.useMemo(
    () => (instance ? getInstanceFilesHomePath(instance) : '/'),
    [instance],
  );
  const instanceProject = instance?.project ?? project ?? null;
  const pathParam = searchParams.get('path');
  const currentPath = React.useMemo(() => {
    const raw = pathParam ?? homePath;
    return normalizeInstanceFsPath(raw) ?? homePath;
  }, [pathParam, homePath]);

  const handleNavigate = React.useCallback((path: string) => {
    const targetPath = normalizeInstanceFsPath(path) ?? '/';
    const transitionType = classifyFileNavigationTransition(
      currentPath,
      targetPath,
    );

    startRouteTransition(() => {
      addTransitionType(transitionType);

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
      if (targetPath === '/') {
        params.set('path', '/');
      } else if (targetPath === homePath && homePath !== '/') {
        params.delete('path');
      } else {
        params.set('path', targetPath);
      }

      const query = params.toString();
      const currentPathname = getNextRouterPathname(window.location.pathname);
      const target = query ? `${currentPathname}?${query}` : currentPathname;
      router.push(target, {
        scroll: false,
        transitionTypes: [transitionType],
      });
    });
  }, [
    currentPath,
    homePath,
    instanceName,
    instanceProject,
    router,
    startRouteTransition,
  ]);

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
    resolveSymlinkNavTarget,
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
      resolveSymlinkNavTarget={resolveSymlinkNavTarget}
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
