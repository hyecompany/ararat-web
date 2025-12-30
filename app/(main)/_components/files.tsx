'use client';

import React from 'react';
import { Spinner } from 'ui-web/components/spinner';
import { Button } from 'ui-web/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'ui-web/components/dropdown-menu';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from 'ui-web/components/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'ui-web/components/dialog';
import EventEmitterContext from '../../_context/events';
import { Input } from 'ui-web/components/input';
import { Label } from 'ui-web/components/label';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from 'ui-web/components/breadcrumb';
import {
  FileIcon,
  FolderIcon,
  MoreHorizontal,
  UploadIcon,
  PlusIcon,
  TrashIcon,
  DownloadIcon,
  ArrowUpIcon,
  HomeIcon,
  SaveIcon,
  XIcon,
  PencilIcon,
  FilePlus,
  FileCode,
  FileJson,
  FileType,
  FileImage,
  FileText,
  FileArchive,
  FileVideo,
  FileAudio,
  FileSpreadsheet,
  FileBox,
} from 'lucide-react';
import { Progress } from 'ui-web/components/progress';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import Editor from '@monaco-editor/react';
import DataTable from 'ui-web/components/data-table';
import { ColumnDef } from '@tanstack/react-table';

interface FileBrowserProps {
  files: (string | FileItem)[];
  isLoading: boolean;
  isError: any;
  currentPath: string;
  instanceName: string;
  homePath?: string;
  onNavigate: (path: string) => void;
  onUpload: (
    file: File,
    onProgress?: (progress: number) => void,
  ) => Promise<void>;
  onCreateDirectory: (name: string) => Promise<void>;
  onCreateFile: (name: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onRename?: (oldName: string, newName: string) => Promise<void>;
  onDownload: (path: string) => void;
  onFetchContent: (path: string) => Promise<{ content: string; mode?: string }>;
  onSaveContent: (
    path: string,
    content: string,
    mode?: string,
  ) => Promise<void>;
}

export interface FileItem {
  name: string;
  type?: string;
  size?: number;
  mode?: string;
  uid?: string;
  gid?: string;
}

function formatBytes(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  if (value === 0) return '0 B';
  const exponent = Math.min(
    Math.max(Math.floor(Math.log(value) / Math.log(1024)), 0),
    units.length - 1,
  );
  const num = value / Math.pow(1024, exponent);
  return `${num.toFixed(num >= 10 ? 0 : 1)} ${units[exponent]}`;
}

function getFileExtension(filename: string) {
  const parts = filename.split('.');
  // No extension or dotfile without a real extension
  if (parts.length <= 1 || (parts.length === 2 && filename.startsWith('.'))) {
    return undefined;
  }
  return parts.pop()?.toLowerCase();
}

const FILE_ICON_CLASS = 'h-4 w-4 text-gray-500';
const FILE_TYPE_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; language?: string }
> = {
  js: { icon: FileCode, language: 'javascript' },
  jsx: { icon: FileCode, language: 'javascript' },
  ts: { icon: FileCode, language: 'typescript' },
  tsx: { icon: FileCode, language: 'typescript' },
  json: { icon: FileJson, language: 'json' },
  html: { icon: FileCode, language: 'html' },
  xml: { icon: FileCode, language: 'html' },
  css: { icon: FileType, language: 'css' },
  scss: { icon: FileType, language: 'css' },
  less: { icon: FileType, language: 'css' },
  png: { icon: FileImage },
  jpg: { icon: FileImage },
  jpeg: { icon: FileImage },
  gif: { icon: FileImage },
  svg: { icon: FileImage },
  webp: { icon: FileImage },
  txt: { icon: FileText },
  md: { icon: FileText, language: 'markdown' },
  zip: { icon: FileArchive },
  tar: { icon: FileArchive },
  gz: { icon: FileArchive },
  '7z': { icon: FileArchive },
  rar: { icon: FileArchive },
  mp4: { icon: FileVideo },
  mov: { icon: FileVideo },
  avi: { icon: FileVideo },
  mkv: { icon: FileVideo },
  mp3: { icon: FileAudio },
  wav: { icon: FileAudio },
  ogg: { icon: FileAudio },
  csv: { icon: FileSpreadsheet },
  xls: { icon: FileSpreadsheet },
  xlsx: { icon: FileSpreadsheet },
  iso: { icon: FileBox },
  img: { icon: FileBox },
  py: { icon: FileCode, language: 'python' },
  go: { icon: FileCode, language: 'go' },
  sh: { icon: FileCode, language: 'shell' },
  bash: { icon: FileCode, language: 'shell' },
  yaml: { icon: FileCode, language: 'yaml' },
  yml: { icon: FileCode, language: 'yaml' },
};

function getFileIcon(filename: string) {
  const ext = getFileExtension(filename) || '';
  const config = FILE_TYPE_CONFIG[ext];
  const Icon = config?.icon || FileIcon;
  return <Icon className={FILE_ICON_CLASS} />;
}

function isEditableFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  // Files with language mapping are editable
  if (ext && FILE_TYPE_CONFIG[ext]?.language) {
    return true;
  }
  // Files without extension are treated as text (editable)
  if (!ext || !filename.includes('.')) {
    return true;
  }
  // All other files (binary) are not editable
  return false;
}

export function FileBrowser({
  files,
  isLoading,
  isError,
  currentPath,
  instanceName,
  homePath = '/',
  onNavigate,
  onUpload,
  onCreateDirectory,
  onCreateFile,
  onDelete,
  onRename,
  onDownload,
  onFetchContent,
  onSaveContent,
}: FileBrowserProps) {
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isCreateDirOpen, setIsCreateDirOpen] = React.useState(false);
  const [isCreateFileOpen, setIsCreateFileOpen] = React.useState(false);
  const [isUploadOpen, setIsUploadOpen] = React.useState(false);
  const [isRenameOpen, setIsRenameOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [deletedFile, setDeletedFile] = React.useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = React.useState(true);
  const [dropProgress, setDropProgress] = React.useState<number | null>(null);
  const [dropFileName, setDropFileName] = React.useState<string | null>(null);
  const dragCounter = React.useRef(0);
  const { socket } = React.useContext(EventEmitterContext);

  // Reset editing state when path changes
  React.useEffect(() => {
    setEditingFile(null);
    setFileContent('');
    setFileMode(undefined);
    setDeletedFile(null);
  }, [currentPath]);

  // Track when data loads for the first time (to distinguish initial load from refetches)
  React.useEffect(() => {
    if (!isLoading && isInitialLoad) {
      setIsInitialLoad(false);
    }
  }, [isLoading, isInitialLoad]);

  // Editor State
  const [editingFile, setEditingFile] = React.useState<string | null>(null);
  const [fileContent, setFileContent] = React.useState<string>('');
  const [fileMode, setFileMode] = React.useState<string | undefined>(undefined);
  const [isFetchingContent, setIsFetchingContent] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  // Listen for file deletion lifecycle events directly from the WebSocket
  React.useEffect(() => {
    if (!socket) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          type?: string;
          metadata?: {
            action?: string;
            source?: string;
            context?: Record<string, any>;
          };
        };

        if (data.type !== 'lifecycle' || !data.metadata) return;

        const { action, source, context } = data.metadata;
        if (action !== 'instance-file-deleted') return;

        const instanceMatch = source?.match(
          /\/1\.0\/instances\/([^\/]+)\/files/,
        );
        if (!instanceMatch || instanceMatch[1] !== instanceName) return;

        const filePath = context?.path;
        if (filePath && editingFile === filePath) {
          setDeletedFile(filePath);
        }
      } catch (e) {
        console.error('Failed to handle lifecycle message in FileBrowser', e);
      }
    };

    socket.addEventListener('message', handleMessage);
    return () => {
      socket.removeEventListener('message', handleMessage);
    };
  }, [socket, editingFile, instanceName]);

  // Prepare data for DataTable
  // If files already have metadata, use them. If they are just strings (legacy), map them.
  const fileData: FileItem[] = React.useMemo(() => {
    return files.map((f: any) => {
      if (typeof f === 'string') return { name: f };
      return f;
    });
  }, [files]);

  const handleUp = () => {
    if (editingFile) {
      setEditingFile(null);
      setFileMode(undefined);
      return;
    }
    if (currentPath === '/') return;
    const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
    onNavigate(parentPath || '/');
  };

  const handleEdit = async (fileName: string) => {
    const filePath = `${currentPath === '/' ? '' : currentPath}/${fileName}`;

    // Download binary files instead of opening in editor
    if (!isEditableFile(fileName)) {
      onDownload(filePath);
      return;
    }

    setEditingFile(filePath);
    setIsFetchingContent(true);
    setActionError(null);
    try {
      const { content, mode } = await onFetchContent(filePath);
      setFileContent(content);
      setFileMode(mode);
    } catch (err: any) {
      if (err.message === 'IS_DIRECTORY') {
        setEditingFile(null);
        setFileMode(undefined);
        onNavigate(filePath);
        return;
      }
      setActionError(err.message);
      setEditingFile(null);
      setFileMode(undefined);
    } finally {
      setIsFetchingContent(false);
    }
  };

  const handleSave = async () => {
    if (!editingFile) return;
    setIsSaving(true);
    setActionError(null);
    try {
      await onSaveContent(editingFile, fileContent, fileMode);
      // Clear deleted file warning if it was set (file is being recreated)
      setDeletedFile(null);
      // Don't close editor on save
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingFile(null);
    setFileContent('');
    setFileMode(undefined);
  };

  const breadcrumbs = React.useMemo(() => {
    const path = editingFile ? editingFile : currentPath;
    const parts = path.split('/').filter(Boolean);
    return parts.map((part, index) => {
      const crumbPath = '/' + parts.slice(0, index + 1).join('/');
      return { name: part, path: crumbPath };
    });
  }, [currentPath, editingFile]);

  const columns: ColumnDef<FileItem>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const name = row.original.name;
        const type = row.original.type;
        // Fallback to extension check if type is missing
        const isDirectory =
          type === 'directory' || (!type && !name.includes('.'));

        return (
          <ContextMenu>
            <ContextMenuTrigger className="w-full">
              <div className="flex items-center gap-2">
                {isDirectory ? (
                  <FolderIcon className="h-4 w-4 text-blue-500" />
                ) : (
                  getFileIcon(name)
                )}
                <span
                  className="font-medium cursor-pointer hover:underline"
                  onClick={() => {
                    if (isDirectory) {
                      onNavigate(
                        `${currentPath === '/' ? '' : currentPath}/${name}`,
                      );
                    } else {
                      handleEdit(name);
                    }
                  }}
                >
                  {name}
                </span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {!isDirectory && (
                <ContextMenuItem onClick={() => handleEdit(name)}>
                  <PencilIcon className="mr-2 h-4 w-4" />
                  Edit
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onClick={() => {
                  const fullPath = `${currentPath === '/' ? '' : currentPath}/${name}`;
                  onDownload(fullPath);
                }}
              >
                <DownloadIcon className="mr-2 h-4 w-4" />
                Download
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  setRenameTarget(name);
                  setIsRenameOpen(true);
                }}
              >
                <PencilIcon className="mr-2 h-4 w-4" />
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  const fullPath = `${currentPath === '/' ? '' : currentPath}/${name}`;
                  if (isDirectory) {
                    onNavigate(fullPath);
                  } else {
                    handleEdit(name);
                  }
                }}
              >
                <FolderIcon className="mr-2 h-4 w-4" />
                Open
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => {
                  const fullPath = `${currentPath === '/' ? '' : currentPath}/${name}`;
                  onDelete(fullPath).catch((e) => setActionError(e.message));
                }}
                className="text-red-600"
              >
                <TrashIcon className="mr-2 h-4 w-4" />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      },
    },
    {
      id: 'size',
      header: 'Size',
      cell: ({ row }) => {
        if (row.original.type === 'directory') return '—';
        return formatBytes(row.original.size);
      },
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => {
        const name = row.original.name;
        const type = row.original.type;
        if (type) return type === 'directory' ? 'Directory' : 'File';
        return !name.includes('.') ? 'Directory' : 'File';
      },
    },
    {
      id: 'actions',
      size: 50,
      cell: ({ row }) => {
        const name = row.original.name;
        const type = row.original.type;
        const isDirectory =
          type === 'directory' || (!type && !name.includes('.'));
        const fullPath = `${currentPath === '/' ? '' : currentPath}/${name}`;

        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {!isDirectory && (
                  <DropdownMenuItem onClick={() => handleEdit(name)}>
                    <PencilIcon className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    setRenameTarget(name);
                    setIsRenameOpen(true);
                  }}
                >
                  <PencilIcon className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDownload(fullPath)}>
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Download
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (isDirectory) {
                      onNavigate(fullPath);
                    } else {
                      handleEdit(name);
                    }
                  }}
                >
                  {isDirectory ? (
                    <FolderIcon className="mr-2 h-4 w-4" />
                  ) : (
                    <PencilIcon className="mr-2 h-4 w-4" />
                  )}
                  Open
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    onDelete(fullPath).catch((e) => setActionError(e.message))
                  }
                  className="text-red-600"
                >
                  <TrashIcon className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    setActionError(null);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const errors: string[] = [];

    await Promise.all(
      files.map(async (file) => {
        try {
          setDropFileName(file.name);
          setDropProgress(0);
          await onUpload(file, (p) => setDropProgress(p));
        } catch (err: any) {
          errors.push(err?.message || 'Upload failed');
        } finally {
          setDropProgress(null);
          setDropFileName(null);
        }
      }),
    );

    if (errors.length > 0) {
      setActionError(errors.join('\n'));
    }
  };

  const getLanguageFromFilename = (filename: string) => {
    const ext = getFileExtension(filename) || '';
    return FILE_TYPE_CONFIG[ext]?.language || 'plaintext';
  };

  return (
    <div
      className="space-y-4 relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div
          className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center border-2 border-dashed border-primary rounded-lg"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label="Drop files to upload"
        >
          <div className="text-center">
            <UploadIcon className="mx-auto h-12 w-12 text-primary" />
            <h3 className="mt-2 text-lg font-semibold">Drop files to upload</h3>
          </div>
        </div>
      )}
      {dropProgress !== null && dropFileName && (
        <div className="absolute right-4 top-4 z-40 min-w-[220px] rounded-md border bg-card p-3 shadow">
          <div className="text-sm font-medium truncate">
            Uploading {dropFileName}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Progress value={dropProgress} className="h-2 flex-1" />
            <span>{Math.round(dropProgress)}%</span>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleUp}
            disabled={currentPath === homePath}
          >
            <ArrowUpIcon className="h-4 w-4" />
          </Button>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  onClick={() => onNavigate(homePath)}
                  className="cursor-pointer"
                >
                  <HomeIcon className="h-4 w-4" />
                </BreadcrumbLink>
              </BreadcrumbItem>
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={crumb.path}>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      onClick={() => onNavigate(crumb.path)}
                      className="cursor-pointer"
                    >
                      {crumb.name}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        {editingFile ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
            >
              <XIcon className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : (
                <SaveIcon className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <CreateDirectoryDialog
              currentPath={currentPath}
              open={isCreateDirOpen}
              onOpenChange={setIsCreateDirOpen}
              onCreate={(name) =>
                onCreateDirectory(name).catch((e) => setActionError(e.message))
              }
            />
            <CreateFileDialog
              currentPath={currentPath}
              open={isCreateFileOpen}
              onOpenChange={setIsCreateFileOpen}
              onCreate={(name) =>
                onCreateFile(name).catch((e) => setActionError(e.message))
              }
            />
            <UploadFileDialog
              currentPath={currentPath}
              open={isUploadOpen}
              onOpenChange={setIsUploadOpen}
              onUpload={(file, onProgress) =>
                onUpload(file, onProgress).catch((e) =>
                  setActionError(e.message),
                )
              }
            />
            {renameTarget && (
              <RenameFileDialog
                oldName={renameTarget}
                open={isRenameOpen}
                onOpenChange={(open) => {
                  setIsRenameOpen(open);
                  if (!open) setRenameTarget(null);
                }}
                onRename={(newName) => {
                  if (onRename) {
                    return onRename(renameTarget, newName).catch((e) =>
                      setActionError(e.message),
                    );
                  }
                  return Promise.reject(new Error('Rename not implemented'));
                }}
              />
            )}
          </div>
        )}
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Action Failed</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {actionError}
          </AlertDescription>
        </Alert>
      )}

      {deletedFile && editingFile && (
        <Alert variant="destructive">
          <AlertTitle>File Deleted</AlertTitle>
          <AlertDescription>
            The file <code className="text-sm">{deletedFile}</code> has been
            deleted. You can save the current content to recreate it, or close
            the editor to return to the file listing.
          </AlertDescription>
        </Alert>
      )}

      <div className="bg-background">
        {editingFile ? (
          <div className="h-[600px] w-full">
            {isFetchingContent ? (
              <div className="flex h-full items-center justify-center">
                <Spinner className="size-8" />
              </div>
            ) : (
              <Editor
                height="100%"
                defaultLanguage={getLanguageFromFilename(editingFile)}
                value={fileContent}
                onChange={(value) => setFileContent(value || '')}
                theme="vs-dark" // Or based on system theme
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                }}
              />
            )}
          </div>
        ) : (
          <>
            {isLoading && !isInitialLoad ? (
              <div className="animate-pulse">
                <DataTable
                  data={fileData}
                  cols={columns as any}
                  disablePagination
                />
              </div>
            ) : isLoading && isInitialLoad ? (
              <div className="flex justify-center p-8">
                <Spinner />
              </div>
            ) : isError ? (
              <Alert variant="destructive" className="m-4">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>Failed to load files.</AlertDescription>
              </Alert>
            ) : (
              <DataTable
                data={fileData}
                cols={columns as any}
                disablePagination
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CreateDirectoryDialog({
  currentPath,
  open,
  onOpenChange,
  onCreate,
}: {
  currentPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onCreate(name);
      onOpenChange(false);
      setName('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <PlusIcon className="mr-2 h-4 w-4" />
          New Folder
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Directory</DialogTitle>
          <DialogDescription>
            Create a new directory in {currentPath}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Directory Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="new-folder"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Spinner className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameFileDialog({
  oldName,
  open,
  onOpenChange,
  onRename,
}: {
  oldName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (
    newName: string,
    onProgress?: (progress: number) => void,
  ) => Promise<void>;
}) {
  const [name, setName] = React.useState(oldName);
  const [isLoading, setIsLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  // Reset name when dialog opens with a new file
  React.useEffect(() => {
    if (open) setName(oldName);
  }, [open, oldName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name === oldName) {
      onOpenChange(false);
      return;
    }
    setIsLoading(true);
    setProgress(0);
    try {
      await onRename(name, (p) => setProgress(p));
      onOpenChange(false);
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename File</DialogTitle>
          <DialogDescription>Enter a new name for {oldName}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rename-name">New Name</Label>
            <Input
              id="rename-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={oldName}
              required
            />
          </div>
          {isLoading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Renaming...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" /> Renaming...
                </>
              ) : (
                'Rename'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UploadFileDialog({
  currentPath,
  open,
  onOpenChange,
  onUpload,
}: {
  currentPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File, onProgress?: (progress: number) => void) => Promise<void>;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsLoading(true);
    setProgress(0);

    try {
      await onUpload(file, (p) => setProgress(p));
      onOpenChange(false);
      setFile(null);
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <UploadIcon className="mr-2 h-4 w-4" />
          Upload
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload File</DialogTitle>
          <DialogDescription>
            Upload a file to {currentPath}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">File</Label>
            <Input
              id="file"
              type="file"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  setFile(files[0]);
                }
              }}
              required
            />
          </div>
          {isLoading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Uploading...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isLoading || !file}>
              {isLoading && <Spinner className="mr-2 h-4 w-4" />}
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}



function CreateFileDialog({
  currentPath,
  open,
  onOpenChange,
  onCreate,
}: {
  currentPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onCreate(name);
      onOpenChange(false);
      setName('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FilePlus className="mr-2 h-4 w-4" />
          New File
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create File</DialogTitle>
          <DialogDescription>
            Create a new file in {currentPath}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">File Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="new-file.txt"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Spinner className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
