'use client';

import React, { use } from 'react';
import { ColumnDef, Row } from '@tanstack/react-table';
import {
  PlayIcon,
  RotateCcwIcon,
  SnowflakeIcon,
  SquareIcon,
  Trash2Icon,
} from 'lucide-react';

import CreateInstance from './_components/create';
import DataTable from 'ui-web/components/data-table';
import { Input } from 'ui-web/components/input';
import { LoadableSurface } from 'ui-web/components/loadable-surface';
import { Skeleton } from 'ui-web/components/skeleton';
import { useInstances } from '@/app/(main)/instances/_hooks/instances';
import type { Instance, InstanceState } from './_lib/instances.d';
import { deleteInstance } from './_lib/instances';
import { useIncusClient } from '@/app/_incus/provider';
import { Badge } from 'ui-web/components/badge';
import { Button } from 'ui-web/components/button';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from 'ui-web/components/sheet';
import { Spinner } from 'ui-web/components/spinner';
import { PageTransition } from 'ui-web/components/view-transitions';
import ProjectsContext from '@/app/(main)/_context/projects';
import { Progress } from 'ui-web/components/progress';
import IsClientContext from '@/app/_context/isClient';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './_components/alert-dialog';
import Link from 'next/link';

type InstanceAction = 'start' | 'stop' | 'restart' | 'freeze';

const instanceActionDetails: Record<
  InstanceAction,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  start: { label: 'Start', Icon: PlayIcon },
  stop: { label: 'Stop', Icon: SquareIcon },
  restart: { label: 'Restart', Icon: RotateCcwIcon },
  freeze: { label: 'Freeze', Icon: SnowflakeIcon },
};

function isDeleteProtected(instance: Instance): boolean {
  const config = instance.expanded_config ?? instance.config ?? {};
  return config['security.protection.delete'] === 'true';
}

function isRunning(instance: Instance): boolean {
  const status = instance.status?.toLowerCase();
  return status === 'running' || status === 'started';
}

function canDelete(instance: Instance): boolean {
  return !isDeleteProtected(instance) && !isRunning(instance);
}

function canPerformAction(action: InstanceAction, instance: Instance): boolean {
  const status = instance.status?.toLowerCase();
  switch (action) {
    case 'start':
      return status === 'stopped';
    case 'stop':
      return status === 'running' || status === 'started' || status === 'frozen';
    case 'restart':
      return status === 'running' || status === 'started';
    case 'freeze':
      return status === 'running' || status === 'started';
    default:
      return false;
  }
}

export default function Instances() {
  const incusClient = useIncusClient();
  const { currentProject } = use(ProjectsContext);
  const [visibleRange, setVisibleRange] = React.useState({
    start: 0,
    count: 30,
    overscan: 10,
  });
  const { data, error, status, mutate } = useInstances({
    project: currentProject,
    visibleRange,
    include: { metadata: true, state: true },
  });
  const [search, setSearch] = React.useState('');
  const [selectedInstances, setSelectedInstances] = React.useState<Instance[]>(
    [],
  );
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionInFlight, setActionInFlight] =
    React.useState<InstanceAction | null>(null);
  const [inspectorInstance, setInspectorInstance] =
    React.useState<Instance | null>(null);
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);
  const isClient = use(IsClientContext);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deleteInFlight, setDeleteInFlight] = React.useState(false);
  const [singleDeleteInstance, setSingleDeleteInstance] =
    React.useState<Instance | null>(null);

  const columns = React.useMemo(() => {
    const baseColumns = [
      {
        header: 'Name',
        accessorKey: 'name',
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          const query: Record<string, string> = {
            name: instance.name,
            project: instance.project ?? 'default',
          };
          return (
            <Link
              href={{
                pathname: '/instance',
                query,
              }}
              transitionTypes={['nav-forward']}
              className="text-left font-medium text-primary underline focus:outline-none cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {instance.name}
            </Link>
          );
        },
      },
      {
        header: 'Description',
        accessorKey: 'description',
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          return (
            <span className="text-muted-foreground">
              {instance.description || '—'}
            </span>
          );
        },
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          const isRunning =
            instance.status?.toLowerCase() === 'running' ||
            instance.status?.toLowerCase() === 'started';
          return (
            <Badge variant={isRunning ? 'default' : 'secondary'}>
              {instance.status}
            </Badge>
          );
        },
      },
      {
        header: 'Type',
        accessorKey: 'type',
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          return instance.type === 'virtual-machine'
            ? 'Virtual Machine'
            : 'Container';
        },
      },
      {
        header: 'Usage',
        id: 'usage',
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          const memoryUsage = instance.state?.memory?.usage ?? 0;
          const diskUsage = getRootDiskUsage(instance.state) ?? 0;
          const memoryPercent = calcResourcePercent(
            memoryUsage,
            instance.state?.memory?.total ?? instance.state?.memory?.usage_peak,
          );
          const diskPercent = calcResourcePercent(
            diskUsage,
            instance.state?.disk?.root?.total,
          );
          return (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Memory</span>
                <span>
                  {formatBytes(memoryUsage)}
                  {instance.state?.memory?.total
                    ? ` / ${formatBytes(instance.state.memory.total)}`
                    : ''}
                </span>
              </div>
              <Progress value={memoryPercent} className="h-1.5" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Disk</span>
                <span>
                  {formatBytes(diskUsage)}
                  {instance.state?.disk?.root?.total
                    ? ` / ${formatBytes(instance.state.disk.root.total)}`
                    : ''}
                </span>
              </div>
              <Progress value={diskPercent} className="h-1.5 bg-muted" />
            </div>
          );
        },
      },
    ] as ColumnDef<object, unknown>[];

    if (currentProject === 'all') {
      baseColumns.splice(1, 0, {
        header: 'Project',
        accessorKey: 'project',
        cell: ({ row }: { row: Row<object> }) => {
          const instance = row.original as Instance;
          return instance.project ?? 'default';
        },
      });
    }

    return baseColumns;
  }, [currentProject]);

  const hasSelection = selectedInstances.length > 0;

  const handleMassAction = React.useCallback(
    async (action: InstanceAction) => {
      const targetInstances = selectedInstances.filter((instance) =>
        canPerformAction(action, instance),
      );

      if (!targetInstances.length) return;
      try {
        setActionError(null);
        setActionInFlight(action);
        await Promise.all(
          targetInstances.map((instance) =>
            incusClient.instances.setState({
              action,
              instance: {
                ...instance,
                project:
                  currentProject === 'all'
                    ? (instance.project ?? 'default')
                    : (currentProject ?? instance.project ?? 'default'),
              },
            }),
          ),
        );
        await mutate();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to update instances.';
        setActionError(message);
      } finally {
        setActionInFlight(null);
      }
    },
    [currentProject, incusClient, mutate, selectedInstances],
  );

  const handleSelectionChange = React.useCallback((rows: Row<object>[]) => {
    setSelectedInstances(rows.map((row) => row.original as Instance));
  }, []);

  const handleRowClick = React.useCallback((row: Row<object>) => {
    const instance = row.original as Instance;
    setInspectorInstance(instance);
    setIsSheetOpen(true);
  }, []);

  const handleVirtualVisibleRangeChange = React.useCallback(
    (range: { start: number; count: number; overscan: number }) => {
      setVisibleRange((current) =>
        current.start === range.start &&
        current.count === range.count &&
        current.overscan === range.overscan
          ? current
          : range,
      );
    },
    [],
  );

  // Compute deletable, protected, and running instances for mass deletion
  const deletableInstances = React.useMemo(
    () => selectedInstances.filter((instance) => canDelete(instance)),
    [selectedInstances],
  );
  const protectedInstances = React.useMemo(
    () => selectedInstances.filter((instance) => isDeleteProtected(instance)),
    [selectedInstances],
  );
  const runningInstances = React.useMemo(
    () =>
      selectedInstances.filter(
        (instance) => isRunning(instance) && !isDeleteProtected(instance),
      ),
    [selectedInstances],
  );

  // Open the mass delete confirmation dialog
  const openMassDeleteDialog = React.useCallback(() => {
    setSingleDeleteInstance(null);
    setDeleteDialogOpen(true);
  }, []);

  // Open the single instance delete confirmation dialog
  const openSingleDeleteDialog = React.useCallback((instance: Instance) => {
    setSingleDeleteInstance(instance);
    setDeleteDialogOpen(true);
  }, []);

  // Perform the delete action
  const handleDelete = React.useCallback(async () => {
    const instancesToDelete = singleDeleteInstance
      ? [singleDeleteInstance]
      : deletableInstances;
    if (instancesToDelete.length === 0) return;

    try {
      setActionError(null);
      setDeleteInFlight(true);
      const results = await Promise.all(
        instancesToDelete.map((instance) =>
          deleteInstance(
            instance.name,
            currentProject === 'all'
              ? (instance.project ?? null)
              : (currentProject ?? instance.project ?? null),
          ),
        ),
      );
      const errors = results.filter((r) => r.error).map((r) => r.error);
      if (errors.length > 0) {
        setActionError(errors.join('; '));
        return; // Keep dialog open when there are errors
      }
      await mutate();
      setSelectedInstances([]); // Clear selection after successful deletion
      setDeleteDialogOpen(false);
      setSingleDeleteInstance(null);
      if (singleDeleteInstance && isSheetOpen) {
        setIsSheetOpen(false);
        setInspectorInstance(null);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to delete instances.';
      setActionError(message);
    } finally {
      setDeleteInFlight(false);
    }
  }, [
    currentProject,
    deletableInstances,
    mutate,
    singleDeleteInstance,
    isSheetOpen,
  ]);

  const tableStatus = !isClient ? 'loading' : status;
  const hasRows = Boolean(data?.length);

  React.useEffect(() => {
    setSelectedInstances([]);
  }, [currentProject]);

  return (
    <PageTransition>
      <div className="space-y-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-2xl font-semibold">Instances</p>
          <div className="flex flex-1 flex-wrap items-center gap-3 justify-end">
            {!hasSelection ? (
              isClient ? (
                <Input
                  placeholder="Search instances..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full sm:w-64"
                />
              ) : (
                <Skeleton className="h-10 w-full sm:w-64" />
              )
            ) : null}
            {hasSelection ? (
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                {(
                  Object.entries(instanceActionDetails) as [
                    InstanceAction,
                    {
                      label: string;
                      Icon: React.ComponentType<{ className?: string }>;
                    },
                  ][]
                )
                  .filter(([action]) =>
                    selectedInstances.some((instance) =>
                      canPerformAction(action, instance),
                    ),
                  )
                  .map(([action, { label, Icon }]) => (
                    <Button
                      key={action}
                      variant="outline"
                      size="sm"
                      disabled={actionInFlight !== null || deleteInFlight}
                      onClick={() => handleMassAction(action)}
                    >
                      {actionInFlight === action ? (
                        <Spinner className="mr-2 size-3" />
                      ) : (
                        <Icon className="mr-2 size-3" />
                      )}
                      {label}
                    </Button>
                  ))}
                {deletableInstances.length > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={actionInFlight !== null || deleteInFlight}
                    onClick={openMassDeleteDialog}
                  >
                    <Trash2Icon className="mr-2 size-3" />
                    Delete
                  </Button>
                )}
              </div>
            ) : (
              <CreateInstance className="w-full sm:w-auto" />
            )}
          </div>
        </div>
        {actionError ? (
          <Alert variant="destructive">
            <AlertTitle>Mass action failed</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to load instances</AlertTitle>
            <AlertDescription>
              {error.message ||
                'Check your Incus API connection and try again.'}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <LoadableSurface
        status={tableStatus}
        hasData={hasRows}
        freshness
        skeleton={
          <DataTable
            key={`${currentProject}-skeleton`}
            enableSelection
            data={[]}
            cols={columns}
            disablePagination
            loading
            skeletonRows={7}
            virtualRowEstimatePx={76}
            renderSkeletonCell={renderInstanceSkeletonCell}
          />
        }
        empty={
          <DataTable
            key={`${currentProject}-empty`}
            enableSelection
            data={[]}
            cols={columns}
            disablePagination
            stringFilter={search}
          />
        }
      >
        <DataTable
          key={currentProject}
          enableSelection
          data={(data as Instance[]) ?? []}
          cols={columns}
          disablePagination
          virtualizeRows
          virtualScrollMaxHeightClassName="max-h-[min(72vh,760px)]"
          virtualRowEstimatePx={76}
          onVirtualVisibleRangeChange={handleVirtualVisibleRangeChange}
          stringFilter={search}
          onSelectionChange={handleSelectionChange}
          onRowClick={(row) => handleRowClick(row)}
        />
      </LoadableSurface>

      <Sheet
        open={isSheetOpen}
        onOpenChange={(open) => {
          setIsSheetOpen(open);
          if (!open) setInspectorInstance(null);
        }}
      >
        <SheetContent side="right" className="sm:max-w-md">
          {inspectorInstance ? (
            <InstanceDetails
              instance={inspectorInstance}
              onDelete={
                canDelete(inspectorInstance)
                  ? () => openSingleDeleteDialog(inspectorInstance)
                  : undefined
              }
            />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              Select an instance to view its details.
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {singleDeleteInstance
                ? `Delete ${singleDeleteInstance.name}?`
                : `Delete ${deletableInstances.length} instance${deletableInstances.length === 1 ? '' : 's'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {singleDeleteInstance ? (
                <>
                  This action cannot be undone. This will permanently delete the
                  instance <strong>{singleDeleteInstance.name}</strong> and all
                  its data.
                </>
              ) : (
                <>
                  This action cannot be undone. This will permanently delete the
                  following instances and all their data:
                  <ul className="list-disc list-inside mt-2">
                    {deletableInstances.map((instance) => (
                      <li key={instance.name}>{instance.name}</li>
                    ))}
                  </ul>
                  {runningInstances.length > 0 && (
                    <div className="mt-3 p-3 rounded-md bg-muted text-muted-foreground">
                      <strong>Note:</strong> The following instances are
                      currently running and must be stopped before deletion:
                      <ul className="list-disc list-inside mt-1">
                        {runningInstances.map((instance) => (
                          <li key={instance.name}>{instance.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {protectedInstances.length > 0 && (
                    <div className="mt-3 p-3 rounded-md bg-muted text-muted-foreground">
                      <strong>Note:</strong> The following instances have delete
                      protection enabled and will not be deleted:
                      <ul className="list-disc list-inside mt-1">
                        {protectedInstances.map((instance) => (
                          <li key={instance.name}>{instance.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInFlight}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteInFlight}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteInFlight ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageTransition>
  );
}

function renderInstanceSkeletonCell(columnId: string) {
  if (columnId === 'select') return <Skeleton className="size-4 rounded-sm" />;
  if (columnId === 'name') return <Skeleton className="h-4 w-32" />;
  if (columnId === 'project') return <Skeleton className="h-4 w-20" />;
  if (columnId === 'description') {
    return <Skeleton className="h-4 w-48 max-w-full" />;
  }
  if (columnId === 'status') {
    return <Skeleton className="h-6 w-20 rounded-full" />;
  }
  if (columnId === 'type') return <Skeleton className="h-4 w-24" />;
  if (columnId === 'usage') {
    return (
      <div className="space-y-2">
        <div className="flex justify-between gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-1.5 w-full" />
        <div className="flex justify-between gap-3">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-1.5 w-full" />
      </div>
    );
  }
  return <Skeleton className="h-4 w-28" />;
}

function InstanceDetails({
  instance,
  onDelete,
}: {
  instance: Instance;
  onDelete?: () => void;
}) {
  const memoryUsage = instance.state?.memory?.usage;
  const diskUsage = getRootDiskUsage(instance.state);
  const networkDetails = React.useMemo(
    () => getNetworkDetails(instance),
    [instance],
  );
  const baseImage = getBaseImage(instance);
  const rootDiskPool = getRootDiskPool(instance);
  const hasStateData = Boolean(instance.state);
  const hasNetworking =
    networkDetails.ipv4.length > 0 ||
    networkDetails.ipv6.length > 0 ||
    networkDetails.macs.length > 0;

  return (
    <>
      <SheetHeader className="px-4 pt-4">
        <SheetTitle>{instance.name}</SheetTitle>
        <SheetDescription>
          {instance.description || 'No description available.'}
        </SheetDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <Badge>{instance.status}</Badge>
          <Badge variant="outline" className="capitalize">
            {instance.type}
          </Badge>
        </div>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <Section title="Overview">
          <DetailRow
            label="Instance Memory"
            value={
              instance.state?.memory?.total
                ? `${formatBytes(memoryUsage)} / ${formatBytes(instance.state.memory.total)}`
                : formatBytes(memoryUsage)
            }
            hidden={!hasStateData || typeof memoryUsage !== 'number'}
          />
          <DetailRow
            label="Instance Root Disk Usage"
            value={formatBytes(diskUsage)}
            hidden={!hasStateData || typeof diskUsage !== 'number'}
          />
        </Section>
        <Section title="Metadata">
          <DetailRow
            label="Project"
            value={instance.project ?? 'default'}
            hidden={false}
          />
          <DetailRow
            label="Base Image"
            value={baseImage ?? '—'}
            hidden={false}
          />
          <DetailRow
            label="Architecture"
            value={instance.architecture ?? '—'}
            hidden={false}
          />
          <DetailRow
            label="Cluster Member"
            value={instance.location ?? '—'}
            hidden={false}
          />
          <DetailRow
            label="Root Disk Storage Pool"
            value={rootDiskPool ?? '—'}
            hidden={false}
          />
          <DetailRow
            label="Process ID"
            value={instance.state?.pid?.toString() ?? '—'}
            hidden={!instance.state?.pid}
          />
          <DetailRow
            label="Creation Date"
            value={formatDate(instance.created_at)}
            hidden={false}
          />
          <DetailRow
            label="Date of Last Use"
            value={formatDate(instance.last_used_at)}
            hidden={false}
          />
        </Section>
        <Section title="Networking" hidden={!hasNetworking}>
          <DetailRow
            label="IPv4 Addresses"
            value={
              <TagList
                items={networkDetails.ipv4}
                placeholder="No IPv4 addresses"
              />
            }
            hidden={networkDetails.ipv4.length === 0}
          />
          <DetailRow
            label="IPv6 Addresses"
            value={
              <TagList
                items={networkDetails.ipv6}
                placeholder="No IPv6 addresses"
              />
            }
            hidden={networkDetails.ipv6.length === 0}
          />
          <DetailRow
            label="MAC Addresses"
            value={
              <TagList
                items={networkDetails.macs}
                placeholder="No MAC addresses"
              />
            }
            hidden={networkDetails.macs.length === 0}
          />
        </Section>
        <Section title="Profiles">
          {instance.profiles?.length ? (
            <div className="flex flex-wrap gap-2 justify-end">
              {instance.profiles.map((profile) => (
                <Badge key={profile} variant="outline">
                  {profile}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-right">
              No profiles
            </p>
          )}
        </Section>
        <Section title="Snapshots">
          {instance.snapshots?.length ? (
            <div className="space-y-2">
              {instance.snapshots.map((snapshot) => (
                <div
                  key={snapshot.name}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{snapshot.name}</span>
                    <Badge variant="outline">
                      {snapshot.stateful ? 'Stateful' : 'Stateless'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(snapshot.created_at)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-right">
              No snapshots
            </p>
          )}
        </Section>
        {onDelete && (
          <Section title="Danger Zone">
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={onDelete}
            >
              <Trash2Icon className="mr-2 size-4" />
              Delete Instance
            </Button>
          </Section>
        )}
      </div>
    </>
  );
}

function DetailRow({
  label,
  value,
  hidden,
}: {
  label: string;
  value: React.ReactNode;
  hidden?: boolean;
}) {
  if (hidden) {
    return null;
  }
  return (
    <div className="flex justify-between gap-4 text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Section({
  title,
  children,
  hidden,
}: {
  title: string;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  if (hidden) {
    return null;
  }
  return (
    <div className="mt-4 first:mt-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function TagList({
  items,
  placeholder,
}: {
  items: string[];
  placeholder: string;
}) {
  if (!items.length) {
    return <span className="text-muted-foreground">{placeholder}</span>;
  }
  return (
    <div className="flex flex-wrap gap-2 justify-end">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-mono"
        >
          {item}
        </span>
      ))}
    </div>
  );
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

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getRootDiskUsage(state?: InstanceState) {
  if (!state?.disk) return undefined;
  const rootDisk =
    state.disk['root'] ||
    state.disk['/'] ||
    Object.values(state.disk)[0] ||
    null;
  return rootDisk?.usage;
}

function getNetworkDetails(instance: Instance) {
  const ipv4 = new Set<string>();
  const ipv6 = new Set<string>();
  const macs = new Set<string>();
  const network = instance.state?.network ?? {};
  Object.values(network).forEach((iface) => {
    iface.addresses?.forEach((address) => {
      if (!address.address) return;
      if (address.family === 'inet') {
        ipv4.add(address.address);
      } else if (address.family === 'inet6' && address.scope !== 'link') {
        ipv6.add(address.address);
      }
    });
    if (iface.hwaddr) {
      macs.add(iface.hwaddr);
    }
  });
  return {
    ipv4: Array.from(ipv4),
    ipv6: Array.from(ipv6),
    macs: Array.from(macs),
  };
}

function getBaseImage(instance: Instance) {
  return (
    instance.config?.['image.description'] ||
    instance.config?.['image.alias'] ||
    instance.config?.['image.os'] ||
    instance.expanded_config?.['volatile.base_image'] ||
    instance.config?.['volatile.base_image'] ||
    null
  );
}

function getRootDiskPool(instance: Instance) {
  const rootDisk = instance.expanded_devices?.root || instance.devices?.root;
  return rootDisk?.pool ?? null;
}

function calcResourcePercent(current?: number, peak?: number) {
  if (!peak || peak <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, ((current ?? 0) / peak) * 100));
}
