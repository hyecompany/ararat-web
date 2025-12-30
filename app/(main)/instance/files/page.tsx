'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useInstanceContext } from '../_context/instance';
import { useFiles } from '../_hooks/files';
import { Spinner } from 'ui-web/components/spinner';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { FileBrowser } from '../../_components/files';
import { getFileMetadata } from '../_lib/files';

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

function Files({ instance }: { instance: any }) {
  const router = useRouter();
  const pathname = usePathname();
  const normalizePath = (value: string) =>
    value?.startsWith('/') ? value : `/${value || ''}`;
  const homePath = normalizePath(instance?.expanded_config?.['oci.cwd'] || '/');
  const initialPath = React.useMemo(() => {
    if (typeof window === 'undefined') return homePath;
    const params = new URLSearchParams(window.location.search);
    return normalizePath(params.get('path') || homePath);
  }, [homePath]);

  const [currentPath, setCurrentPath] = React.useState(initialPath);
  const validatedPathRef = React.useRef<string | null>(null);
  const [pathError, setPathError] = React.useState<string | null>(null);

  // Read path from URL on mount using manual JS
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const pathParam = params.get('path');
    const targetPath = normalizePath(pathParam || homePath);

    if (validatedPathRef.current === targetPath) return;
    let cancelled = false;

    const updateUrl = (nextPath: string) => {
      const nextParams = new URLSearchParams(window.location.search);
      if (nextPath === '/' && homePath === '/') {
        nextParams.delete('path');
      } else {
        nextParams.set('path', nextPath);
      }
      const nextQuery = nextParams.toString();
      const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (nextUrl !== currentUrl) {
        router.replace(nextUrl);
      }
    };

    (async () => {
      try {
        await getFileMetadata(instance.name, targetPath);
        if (cancelled) return;
        validatedPathRef.current = targetPath;
        setCurrentPath(targetPath);
        setPathError(null);
        if (!pathParam && homePath !== '/') {
          updateUrl(targetPath);
        }
      } catch (err) {
        if (cancelled) return;
        validatedPathRef.current = '/';
        setCurrentPath('/');
        setPathError(
          `Default path "${targetPath}" is not accessible. Showing root instead.`,
        );
        updateUrl('/');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [homePath, pathname, router, instance.name]);

  // Listen for back/forward navigation
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const pathParam = params.get('path') || homePath;
      setCurrentPath(normalizePath(pathParam));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [homePath]);

  const handleNavigate = (path: string) => {
    setPathError(null);
    const nextPath = normalizePath(path);
    setCurrentPath(nextPath);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (nextPath === '/' && homePath === '/') {
        params.delete('path');
      } else {
        params.set('path', nextPath);
      }
      const target = params.toString();
      const url = target ? `${pathname}?${target}` : pathname;
      router.push(url);
    }
  };

  const {
    files,
    isLoading,
    isError,
    uploadFile,
    createDirectory,
    createFile,
    deleteFile,
    renameFile,
    downloadFile,
    fetchFileContent,
    saveFileContent,
  } = useFiles(instance.name, currentPath);

  return (
    <>
      {pathError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Default path unavailable</AlertTitle>
          <AlertDescription>{pathError}</AlertDescription>
        </Alert>
      )}
      <FileBrowser
        files={files}
        isLoading={isLoading}
        isError={isError}
        currentPath={currentPath}
        instanceName={instance.name}
        homePath={homePath}
        onNavigate={handleNavigate}
        onUpload={(file, onProgress) =>
          uploadFile(currentPath, file, onProgress)
        }
        onCreateDirectory={(name) => createDirectory(currentPath, name)}
        onCreateFile={(name) => createFile(currentPath, name)}
        onDelete={deleteFile}
        onRename={renameFile}
        onDownload={downloadFile}
        onFetchContent={fetchFileContent}
        onSaveContent={saveFileContent}
      />
    </>
  );
}
