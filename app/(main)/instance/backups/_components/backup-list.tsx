'use client';

import React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  DownloadIcon,
  MoreHorizontal,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react';

import { useConfigurableOptions } from '@/app/_hooks/server';
import type { InstanceBackup } from '@/app/_incus/types';
import { DateTimePicker } from '../../_components/date-time-picker';
import { toOptionalIsoDateTime } from '../../_lib/date-time';
import { formatDate, getInstanceResourceShortName } from '../../_lib/utils';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Button } from 'ui-web/components/button';
import { Checkbox } from 'ui-web/components/checkbox';
import DataTable from 'ui-web/components/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'ui-web/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'ui-web/components/dropdown-menu';
import { Input } from 'ui-web/components/input';
import { Label } from 'ui-web/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'ui-web/components/select';
import { Spinner } from 'ui-web/components/spinner';
import { Skeleton } from 'ui-web/components/skeleton';

interface BackupListProps {
  backups: InstanceBackup[];
  isLoading: boolean;
  isError: unknown;
  onCreate: (
    name?: string,
    instanceOnly?: boolean,
    optimizedStorage?: boolean,
    compressionAlgorithm?: string,
    expiresAt?: string,
  ) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onRename: (oldName: string, newName: string) => Promise<void>;
  onDownload: (name: string) => void;
  canUseOptimizedStorage?: boolean;
}

const DEFAULT_COMPRESSION_VALUE = '__default__';
const FALLBACK_COMPRESSION_OPTIONS = [
  'bzip2',
  'gzip',
  'lz4',
  'lzma',
  'xz',
  'zstd',
  'none',
];

function getBackupCompressionOptionDetails(configurableOptions?: {
  configs?: {
    project?: Record<string, { keys?: Array<Record<string, { enum_options?: string[]; shortdesc?: string; display_shortdesc?: string }>> }>;
  };
}) {
  const category = configurableOptions?.configs?.project?.backups;
  if (!category?.keys) {
    return {
      options: [] as string[],
      description: undefined as string | undefined,
    };
  }

  for (const keyGroup of category.keys) {
    for (const [key, metadata] of Object.entries(keyGroup)) {
      const fullKey = key.includes('.') ? key : `backups.${key}`;
      if (fullKey !== 'backups.compression_algorithm') continue;

      return {
        options: metadata.enum_options?.length
          ? metadata.enum_options
          : FALLBACK_COMPRESSION_OPTIONS,
        description: metadata.display_shortdesc ?? metadata.shortdesc,
      };
    }
  }

  return {
    options: FALLBACK_COMPRESSION_OPTIONS,
    description: undefined as string | undefined,
  };
}

export function BackupList({
  backups,
  isLoading,
  isError,
  onCreate,
  onDelete,
  onRename,
  onDownload,
  canUseOptimizedStorage = false,
}: BackupListProps) {
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [renameBackup, setRenameBackup] = React.useState<InstanceBackup | null>(null);
  const [deleteBackup, setDeleteBackup] = React.useState<InstanceBackup | null>(null);

  const columns: ColumnDef<InstanceBackup>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <span className="font-medium">
          {getInstanceResourceShortName(row.original.name)}
        </span>
      ),
    },
    {
      accessorKey: 'created_at',
      header: 'Created At',
      cell: ({ row }) => formatDate(row.original.created_at),
    },
    {
      accessorKey: 'expires_at',
      header: 'Expires At',
      cell: ({ row }) =>
        row.original.expires_at ? formatDate(row.original.expires_at) : 'Never',
    },
    {
      id: 'exclude_snapshots',
      header: 'Exclude Snapshots',
      cell: ({ row }) =>
        row.original.container_only || row.original.instance_only ? 'Yes' : 'No',
    },
    {
      accessorKey: 'optimized_storage',
      header: 'Optimized Storage',
      cell: ({ row }) => (row.original.optimized_storage ? 'Yes' : 'No'),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const backup = row.original;

        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onDownload(backup.name)}
            >
              <DownloadIcon className="mr-2 h-4 w-4" />
              Download
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setRenameBackup(backup)}>
                  <PencilIcon className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setDeleteBackup(backup)}
                  className="text-destructive focus:text-destructive"
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

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to load backups.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Backups</h2>
        <CreateBackupDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          canUseOptimizedStorage={canUseOptimizedStorage}
          onCreate={(name, instanceOnly, optimizedStorage, compressionAlgorithm, expiresAt) =>
            onCreate(
              name,
              instanceOnly,
              optimizedStorage,
              compressionAlgorithm,
              expiresAt,
            ).catch((error) =>
              setActionError(
                error instanceof Error ? error.message : 'Failed to create backup.',
              ),
            )
          }
        />
      </div>

      {actionError ? (
        <Alert variant="destructive">
          <AlertTitle>Action Failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <DataTable
        data={backups}
        cols={columns as any}
        disablePagination
        loading={isLoading}
        skeletonRows={6}
        renderSkeletonCell={renderBackupSkeletonCell}
        virtualizeRows
        virtualScrollMaxHeightClassName="max-h-[min(60vh,620px)]"
        virtualRowEstimatePx={52}
      />

      {renameBackup ? (
        <RenameBackupDialog
          currentName={getInstanceResourceShortName(renameBackup.name)}
          open={!!renameBackup}
          onOpenChange={(open) => !open && setRenameBackup(null)}
          onRename={(newName) =>
            onRename(renameBackup.name, newName)
              .then(() => setRenameBackup(null))
              .catch((error) =>
                setActionError(
                  error instanceof Error ? error.message : 'Failed to rename backup.',
                ),
              )
          }
        />
      ) : null}

      {deleteBackup ? (
        <DeleteBackupDialog
          name={getInstanceResourceShortName(deleteBackup.name)}
          open={!!deleteBackup}
          onOpenChange={(open) => !open && setDeleteBackup(null)}
          onConfirm={() =>
            onDelete(deleteBackup.name)
              .then(() => setDeleteBackup(null))
              .catch((error) =>
                setActionError(
                  error instanceof Error ? error.message : 'Failed to delete backup.',
                ),
              )
          }
        />
      ) : null}
    </div>
  );
}

function renderBackupSkeletonCell(columnId: string) {
  if (columnId === 'name') return <Skeleton className="h-4 w-32" />;
  if (columnId === 'created_at') return <Skeleton className="h-4 w-28" />;
  if (columnId === 'expires_at') return <Skeleton className="h-4 w-24" />;
  if (columnId === 'exclude_snapshots') return <Skeleton className="h-4 w-8" />;
  if (columnId === 'optimized_storage') return <Skeleton className="h-4 w-8" />;
  if (columnId === 'actions') {
    return (
      <div className="flex items-center justify-end gap-2">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="size-8 rounded-md" />
      </div>
    );
  }
  return <Skeleton className="h-4 w-24" />;
}

function CreateBackupDialog({
  open,
  onOpenChange,
  onCreate,
  canUseOptimizedStorage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (
    name?: string,
    instanceOnly?: boolean,
    optimizedStorage?: boolean,
    compressionAlgorithm?: string,
    expiresAt?: string,
  ) => Promise<void>;
  canUseOptimizedStorage: boolean;
}) {
  const { data: configurableOptions } = useConfigurableOptions();
  const [name, setName] = React.useState('');
  const [instanceOnly, setInstanceOnly] = React.useState(false);
  const [optimizedStorage, setOptimizedStorage] = React.useState(false);
  const [compressionAlgorithm, setCompressionAlgorithm] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const backupCompression = React.useMemo(
    () => getBackupCompressionOptionDetails(configurableOptions),
    [configurableOptions],
  );

  React.useEffect(() => {
    if (!open) {
      setName('');
      setInstanceOnly(false);
      setOptimizedStorage(false);
      setCompressionAlgorithm('');
      setExpiresAt('');
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await onCreate(
        name,
        instanceOnly,
        optimizedStorage,
        compressionAlgorithm.trim() || undefined,
        toOptionalIsoDateTime(expiresAt),
      );
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="mr-2 h-4 w-4" />
          Create Backup
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Backup</DialogTitle>
          <DialogDescription>Create a new backup.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="backup-name">Name (Optional)</Label>
            <Input
              id="backup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="backup-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="backup-compression">
              Compression Algorithm (Optional)
            </Label>
            <Select
              value={compressionAlgorithm || DEFAULT_COMPRESSION_VALUE}
              onValueChange={(value) =>
                setCompressionAlgorithm(
                  value === DEFAULT_COMPRESSION_VALUE ? '' : value,
                )
              }
            >
              <SelectTrigger id="backup-compression" className="w-full">
                <SelectValue placeholder="Project default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_COMPRESSION_VALUE}>
                  Project default
                </SelectItem>
                {backupCompression.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Expiry (Optional)</Label>
            <DateTimePicker value={expiresAt} onChange={setExpiresAt} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="backup-instance-only"
              checked={instanceOnly}
              onCheckedChange={(checked) => setInstanceOnly(!!checked)}
            />
            <Label htmlFor="backup-instance-only">Exclude Snapshots</Label>
          </div>
          {canUseOptimizedStorage ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="backup-optimized-storage"
                checked={optimizedStorage}
                onCheckedChange={(checked) => setOptimizedStorage(!!checked)}
              />
              <Label htmlFor="backup-optimized-storage">Optimized Storage</Label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameBackupDialog({
  currentName,
  open,
  onOpenChange,
  onRename,
}: {
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (newName: string) => Promise<void>;
}) {
  const [newName, setNewName] = React.useState(currentName);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    setNewName(currentName);
  }, [currentName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onRename(newName);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Backup</DialogTitle>
          <DialogDescription>
            Enter a new name for the backup <strong>{currentName}</strong>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rename-backup-name">New Name</Label>
            <Input
              id="rename-backup-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBackupDialog({
  name,
  open,
  onOpenChange,
  onConfirm,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [isLoading, setIsLoading] = React.useState(false);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Backup</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete the backup <strong>{name}</strong>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
