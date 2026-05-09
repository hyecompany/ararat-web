'use client';

import React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  BoxesIcon,
  MoreHorizontal,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react';

import type { InstanceSnapshot } from '@/app/(main)/instances/_lib/instances.d';
import { useSnapshots } from '../../_hooks/snapshots';
import { DateTimePicker } from '../../_components/date-time-picker';
import { toDateTimeLocalValue, toOptionalIsoDateTime } from '../../_lib/date-time';
import { formatBytes, formatDate, getInstanceResourceShortName } from '../../_lib/utils';
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
import { Spinner } from 'ui-web/components/spinner';

type SuccessMessage =
  | {
      title: string;
      description: string;
    }
  | null;

export function SnapshotsContent({
  instanceName,
  instanceProject,
  instanceType,
  snapshots,
  isLoading = false,
  isError = null,
}: {
  instanceName: string;
  instanceProject: string | null;
  instanceType: string;
  snapshots: InstanceSnapshot[];
  isLoading?: boolean;
  isError?: Error | null;
}) {
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<SuccessMessage>(null);
  const [editSnapshot, setEditSnapshot] = React.useState<InstanceSnapshot | null>(null);
  const [restoreSnapshot, setRestoreSnapshot] = React.useState<InstanceSnapshot | null>(null);
  const [deleteSnapshot, setDeleteSnapshot] = React.useState<InstanceSnapshot | null>(null);
  const [createInstanceSnapshot, setCreateInstanceSnapshot] =
    React.useState<InstanceSnapshot | null>(null);
  const [createImageSnapshot, setCreateImageSnapshot] =
    React.useState<InstanceSnapshot | null>(null);

  const columns: ColumnDef<InstanceSnapshot>[] = [
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
      accessorKey: 'stateful',
      header: 'Stateful',
      cell: ({ row }) => (row.original.stateful ? 'Yes' : 'No'),
    },
    {
      accessorKey: 'size',
      header: 'Size',
      cell: ({ row }) =>
        row.original.size != null ? formatBytes(row.original.size) : '—',
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const snapshot = row.original;

        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRestoreSnapshot(snapshot)}
            >
              Restore
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
                <DropdownMenuItem onClick={() => setEditSnapshot(snapshot)}>
                  <PencilIcon className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setCreateInstanceSnapshot(snapshot)}
                >
                  <BoxesIcon className="mr-2 h-4 w-4" />
                  Create Instance
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCreateImageSnapshot(snapshot)}>
                  <PackageIcon className="mr-2 h-4 w-4" />
                  Create Image
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setDeleteSnapshot(snapshot)}
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Snapshots</h2>
        <CreateSnapshotDialog
          instanceName={instanceName}
          instanceProject={instanceProject}
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
        />
      </div>

      {actionError ? (
        <Alert variant="destructive">
          <AlertTitle>Action Failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>Snapshots failed to load</AlertTitle>
          <AlertDescription>{isError.message}</AlertDescription>
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert>
          <div className="flex items-start justify-between gap-4">
            <div>
              <AlertTitle>{successMessage.title}</AlertTitle>
              <AlertDescription>{successMessage.description}</AlertDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setSuccessMessage(null)}
            >
              Dismiss
            </Button>
          </div>
        </Alert>
      ) : null}

      <DataTable
        data={snapshots}
        cols={columns as any}
        disablePagination
        loading={isLoading}
        skeletonRows={6}
        renderSkeletonCell={renderSnapshotSkeletonCell}
        virtualizeRows
        virtualScrollMaxHeightClassName="max-h-[min(60vh,620px)]"
        virtualRowEstimatePx={52}
      />

      {editSnapshot ? (
        <EditSnapshotDialog
          instanceName={instanceName}
          instanceProject={instanceProject}
          snapshot={editSnapshot}
          open={!!editSnapshot}
          onOpenChange={(open) => !open && setEditSnapshot(null)}
          onError={setActionError}
        />
      ) : null}

      {restoreSnapshot ? (
        <RestoreSnapshotDialog
          instanceName={instanceName}
          instanceProject={instanceProject}
          snapshotName={restoreSnapshot.name}
          open={!!restoreSnapshot}
          onOpenChange={(open) => !open && setRestoreSnapshot(null)}
          onError={setActionError}
        />
      ) : null}

      {deleteSnapshot ? (
        <DeleteSnapshotDialog
          instanceName={instanceName}
          instanceProject={instanceProject}
          snapshotName={deleteSnapshot.name}
          open={!!deleteSnapshot}
          onOpenChange={(open) => !open && setDeleteSnapshot(null)}
          onError={setActionError}
        />
      ) : null}

      {createInstanceSnapshot ? (
        <CreateInstanceFromSnapshotDialog
          instanceName={instanceName}
          instanceProject={instanceProject}
          instanceType={instanceType}
          snapshotName={createInstanceSnapshot.name}
          open={!!createInstanceSnapshot}
          onOpenChange={(open) => !open && setCreateInstanceSnapshot(null)}
          onError={setActionError}
          onSuccess={(targetName) =>
            setSuccessMessage({
              title: 'Instance Created',
              description: `Created instance ${targetName} from snapshot ${getInstanceResourceShortName(
                createInstanceSnapshot.name,
              )}.`,
            })
          }
        />
      ) : null}

      {createImageSnapshot ? (
        <CreateImageFromSnapshotDialog
          instanceName={instanceName}
          instanceProject={instanceProject}
          snapshotName={createImageSnapshot.name}
          open={!!createImageSnapshot}
          onOpenChange={(open) => !open && setCreateImageSnapshot(null)}
          onError={setActionError}
          onSuccess={(alias) =>
            setSuccessMessage({
              title: 'Image Created',
              description: alias
                ? `Created image alias ${alias} from snapshot ${getInstanceResourceShortName(
                    createImageSnapshot.name,
                  )}.`
                : `Created an image from snapshot ${getInstanceResourceShortName(
                    createImageSnapshot.name,
                  )}.`,
            })
          }
        />
      ) : null}
    </div>
  );
}

function renderSnapshotSkeletonCell(columnId: string) {
  if (columnId === 'select') return null;
  if (columnId === 'name') return <div className="h-4 w-32 rounded-md bg-accent freshness-shimmer" />;
  if (columnId === 'created_at') return <div className="h-4 w-36 rounded-md bg-accent freshness-shimmer" />;
  if (columnId === 'expires_at') return <div className="h-4 w-24 rounded-md bg-accent freshness-shimmer" />;
  if (columnId === 'stateful') return <div className="h-4 w-10 rounded-md bg-accent freshness-shimmer" />;
  if (columnId === 'size') return <div className="h-4 w-16 rounded-md bg-accent freshness-shimmer" />;
  if (columnId === 'actions') return <div className="ml-auto h-8 w-24 rounded-md bg-accent freshness-shimmer" />;
  return <div className="h-4 w-28 rounded-md bg-accent freshness-shimmer" />;
}

function CreateSnapshotDialog({
  instanceName,
  instanceProject,
  open,
  onOpenChange,
}: {
  instanceName: string;
  instanceProject: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = React.useState('');
  const [stateful, setStateful] = React.useState(false);
  const [expiresAt, setExpiresAt] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { createSnapshot } = useSnapshots(instanceName, instanceProject);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await createSnapshot(
        name,
        stateful,
        toOptionalIsoDateTime(expiresAt),
      );
      onOpenChange(false);
      setName('');
      setStateful(false);
      setExpiresAt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create snapshot.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="mr-2 h-4 w-4" />
          Create Snapshot
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Snapshot</DialogTitle>
          <DialogDescription>
            Create a new snapshot of {instanceName}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="snapshot-name">Name (Optional)</Label>
            <Input
              id="snapshot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="snap0"
            />
          </div>
          <div className="space-y-2">
            <Label>Expiry (Optional)</Label>
            <DateTimePicker value={expiresAt} onChange={setExpiresAt} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="snapshot-stateful"
              checked={stateful}
              onCheckedChange={(checked) => setStateful(!!checked)}
            />
            <Label htmlFor="snapshot-stateful">Stateful snapshot</Label>
          </div>
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

function EditSnapshotDialog({
  instanceName,
  instanceProject,
  snapshot,
  open,
  onOpenChange,
  onError,
}: {
  instanceName: string;
  instanceProject: string | null;
  snapshot: InstanceSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (error: string | null) => void;
}) {
  const [newName, setNewName] = React.useState(getInstanceResourceShortName(snapshot.name));
  const [expiresAt, setExpiresAt] = React.useState(
    toDateTimeLocalValue(snapshot.expires_at),
  );
  const [isLoading, setIsLoading] = React.useState(false);
  const { editSnapshot } = useSnapshots(instanceName, instanceProject);

  React.useEffect(() => {
    setNewName(getInstanceResourceShortName(snapshot.name));
    setExpiresAt(toDateTimeLocalValue(snapshot.expires_at));
  }, [snapshot]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    onError(null);

    try {
      await editSnapshot(
        snapshot.name,
        newName,
        toOptionalIsoDateTime(expiresAt),
      );
      onOpenChange(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update snapshot.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Snapshot</DialogTitle>
          <DialogDescription>
            Update the name and expiry for {getInstanceResourceShortName(snapshot.name)}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-snapshot-name">Name</Label>
            <Input
              id="edit-snapshot-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Expiry (Optional)</Label>
            <DateTimePicker value={expiresAt} onChange={setExpiresAt} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RestoreSnapshotDialog({
  instanceName,
  instanceProject,
  snapshotName,
  open,
  onOpenChange,
  onError,
}: {
  instanceName: string;
  instanceProject: string | null;
  snapshotName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (error: string | null) => void;
}) {
  const [isLoading, setIsLoading] = React.useState(false);
  const shortName = getInstanceResourceShortName(snapshotName);
  const { restoreSnapshot } = useSnapshots(instanceName, instanceProject);

  const handleRestore = async () => {
    setIsLoading(true);
    onError(null);

    try {
      await restoreSnapshot(snapshotName);
      onOpenChange(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to restore snapshot.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore Snapshot</DialogTitle>
          <DialogDescription>
            Are you sure you want to restore {instanceName} to snapshot{' '}
            <span className="font-semibold">{shortName}</span>? This will overwrite
            the current state.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleRestore} disabled={isLoading}>
            {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSnapshotDialog({
  instanceName,
  instanceProject,
  snapshotName,
  open,
  onOpenChange,
  onError,
}: {
  instanceName: string;
  instanceProject: string | null;
  snapshotName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (error: string | null) => void;
}) {
  const [isLoading, setIsLoading] = React.useState(false);
  const shortName = getInstanceResourceShortName(snapshotName);
  const { deleteSnapshot } = useSnapshots(instanceName, instanceProject);

  const handleDelete = async () => {
    setIsLoading(true);
    onError(null);

    try {
      await deleteSnapshot(snapshotName);
      onOpenChange(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete snapshot.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Snapshot</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete snapshot{' '}
            <span className="font-semibold">{shortName}</span>? This action cannot
            be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
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

function CreateInstanceFromSnapshotDialog({
  instanceName,
  instanceProject,
  instanceType,
  snapshotName,
  open,
  onOpenChange,
  onError,
  onSuccess,
}: {
  instanceName: string;
  instanceProject: string | null;
  instanceType: string;
  snapshotName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (error: string | null) => void;
  onSuccess: (targetName: string) => void;
}) {
  const [targetName, setTargetName] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const { createInstanceFromSnapshot } = useSnapshots(instanceName, instanceProject);

  React.useEffect(() => {
    if (!open) {
      setTargetName('');
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    onError(null);

    try {
      await createInstanceFromSnapshot(snapshotName, targetName, instanceType);
      const normalizedTargetName = targetName.trim();
      onOpenChange(false);
      onSuccess(normalizedTargetName);
      setTargetName('');
    } catch (err) {
      onError(
        err instanceof Error
          ? err.message
          : 'Failed to create instance from snapshot.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Instance</DialogTitle>
          <DialogDescription>
            Create a new instance from snapshot {getInstanceResourceShortName(snapshotName)}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="snapshot-instance-name">Instance Name</Label>
            <Input
              id="snapshot-instance-name"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
              placeholder="new-instance"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Create Instance
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateImageFromSnapshotDialog({
  instanceName,
  instanceProject,
  snapshotName,
  open,
  onOpenChange,
  onError,
  onSuccess,
}: {
  instanceName: string;
  instanceProject: string | null;
  snapshotName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (error: string | null) => void;
  onSuccess: (alias?: string) => void;
}) {
  const [alias, setAlias] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const { createImageFromSnapshot } = useSnapshots(instanceName, instanceProject);

  React.useEffect(() => {
    if (!open) {
      setAlias('');
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    onError(null);

    try {
      const normalizedAlias = alias.trim();
      await createImageFromSnapshot(snapshotName, normalizedAlias || undefined);
      onOpenChange(false);
      onSuccess(normalizedAlias || undefined);
      setAlias('');
    } catch (err) {
      onError(
        err instanceof Error ? err.message : 'Failed to create image from snapshot.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Image</DialogTitle>
          <DialogDescription>
            Publish snapshot {getInstanceResourceShortName(snapshotName)} as an image.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="snapshot-image-alias">Image Alias (Optional)</Label>
            <Input
              id="snapshot-image-alias"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="snapshot-image"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Create Image
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
