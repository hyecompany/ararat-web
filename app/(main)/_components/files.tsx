'use client';

import React from 'react';
import { Spinner } from '@/app/_components/ui/spinner';
import { Button } from '@/app/_components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/_components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/app/_components/ui/dialog';
import { Input } from '@/app/_components/ui/input';
import { Label } from '@/app/_components/ui/label';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/app/_components/ui/breadcrumb';
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
} from 'lucide-react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/app/_components/ui/alert';
import Editor from '@monaco-editor/react';
import DataTable from '@/app/_components/ui/data-table';
import { ColumnDef } from '@tanstack/react-table';

interface FileBrowserProps {
  files: (string | FileItem)[];
  isLoading: boolean;
  isError: any;
  currentPath: string;
  onNavigate: (path: string) => void;
  onUpload: (file: File) => Promise<void>;
  onCreateDirectory: (name: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
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

export function FileBrowser({
  files,
  isLoading,
  isError,
  currentPath,
  onNavigate,
  onUpload,
  onCreateDirectory,
  onDelete,
  onDownload,
  onFetchContent,
  onSaveContent,
}: FileBrowserProps) {
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isCreateDirOpen, setIsCreateDirOpen] = React.useState(false);
  const [isUploadOpen, setIsUploadOpen] = React.useState(false);

  // Editor State
  const [editingFile, setEditingFile] = React.useState<string | null>(null);
  const [fileContent, setFileContent] = React.useState<string>('');
  const [fileMode, setFileMode] = React.useState<string | undefined>(undefined);
  const [isFetchingContent, setIsFetchingContent] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

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
      setEditingFile(null);
      setFileMode(undefined);
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
          <div className="flex items-center gap-2">
            {isDirectory ? (
              <FolderIcon className="h-4 w-4 text-blue-500" />
            ) : (
              <FileIcon className="h-4 w-4 text-gray-500" />
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
                <DropdownMenuItem onClick={() => onDownload(fullPath)}>
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Download
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onNavigate(fullPath)}>
                  <FolderIcon className="mr-2 h-4 w-4" />
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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleUp}
            disabled={currentPath === '/' && !editingFile}
          >
            <ArrowUpIcon className="h-4 w-4" />
          </Button>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  onClick={() => onNavigate('/')}
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
                      onClick={() => !editingFile && onNavigate(crumb.path)}
                      className={!editingFile ? 'cursor-pointer' : ''}
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
            <UploadFileDialog
              currentPath={currentPath}
              open={isUploadOpen}
              onOpenChange={setIsUploadOpen}
              onUpload={(file) =>
                onUpload(file).catch((e) => setActionError(e.message))
              }
            />
          </div>
        )}
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Action Failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
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
                defaultLanguage="plaintext" // We could try to detect language from extension
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
            {isLoading ? (
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

function UploadFileDialog({
  currentPath,
  open,
  onOpenChange,
  onUpload,
}: {
  currentPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setIsLoading(true);
    try {
      await onUpload(file);
      onOpenChange(false);
      setFile(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UploadIcon className="mr-2 h-4 w-4" />
          Upload File
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload File</DialogTitle>
          <DialogDescription>Upload a file to {currentPath}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">File</Label>
            <Input
              id="file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
          </div>
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
