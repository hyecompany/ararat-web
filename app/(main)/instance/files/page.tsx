'use client';

import React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useInstanceContext } from '../_context/instance';
import { useFiles } from '../_hooks/files';
import { Spinner } from 'ui-web/components/spinner';
import { FileBrowser } from '../../_components/files';
import type { Instance } from '../../instances/_lib/instances.d';

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
  const currentPath = searchParams.get('path') || '/';

  const handleNavigate = (path: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (path === '/') {
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
    createDirectory,
    deleteFile,
    downloadFile,
    fetchFileContent,
    saveFileContent,
  } = useFiles(instance.name, currentPath);

  return (
    <FileBrowser
      files={files}
      isLoading={isLoading}
      isError={isError}
      currentPath={currentPath}
      onNavigate={handleNavigate}
      onUpload={(file) => uploadFile(currentPath, file)}
      onCreateDirectory={(name) => createDirectory(currentPath, name)}
      onDelete={deleteFile}
      onDownload={downloadFile}
      onFetchContent={fetchFileContent}
      onSaveContent={saveFileContent}
    />
  );
}
