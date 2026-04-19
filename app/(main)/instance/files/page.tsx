'use client';

import React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useInstanceContext } from '../_context/instance';
import { useFiles } from './_hooks/files';
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
  const { instance, isLoading } = useInstanceContext();

  if (isLoading) {
    return <Spinner />;
  }

  if (!instance) {
    return null;
  }

  return <Files instance={instance} />;
}

function Files({ instance }: { instance: Instance }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const homePath = React.useMemo(() => getInstanceFilesHomePath(instance), [instance]);
  const pathParam = searchParams.get('path');
  const currentPath = React.useMemo(() => {
    const raw = pathParam ?? homePath;
    return normalizeInstanceFsPath(raw) ?? homePath;
  }, [pathParam, homePath]);

  const handleNavigate = (path: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (path === '/') {
      params.set('path', '/');
    } else if (path === homePath && homePath !== '/') {
      params.delete('path');
    } else {
      params.set('path', path);
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const {
    files,
    isLoading,
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
  } = useFiles(instance.name, currentPath);

  return (
    <FileBrowser
      files={files}
      isLoading={isLoading}
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
