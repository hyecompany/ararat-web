'use client';

import * as React from 'react';
import { ColumnDef, Row } from '@tanstack/react-table';
import { DatabaseIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/data-table';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { StaleShimmer } from '@/components/ui/freshness';
import { Input } from '@/components/ui/input';
import { LoadableSurface } from '@/components/ui/loadable-surface';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { PageTransition } from '@/components/ui/view-transitions';
import { isStaleResourceStatus } from '@/app/_incus/status';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  useStoragePools,
  type StoragePoolRow,
} from '@/app/_incus/resources/storage-pools/hooks';
import type { ResourceStatus } from '@/app/_incus/types';

function formatBytes(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (value === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / Math.pow(1024, exponent);
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[exponent]}`;
}

function percent(used?: number, total?: number) {
  if (!used || !total || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function statusBadgeVariant(status?: string): React.ComponentProps<typeof Badge>['variant'] {
  if (status === 'Created') return 'default';
  if (status === 'Errored') return 'destructive';
  return 'secondary';
}

function isSoftLoading(status: ResourceStatus) {
  return isStaleResourceStatus(status);
}

export default function StoragePoolsPage() {
  const [filter, setFilter] = React.useState('');
  const [selectedPool, setSelectedPool] = React.useState<StoragePoolRow | null>(
    null,
  );
  const [isInspectorOpen, setIsInspectorOpen] = React.useState(false);
  const { rows, status, collectionStatus } = useStoragePools({
    visibleRange: { start: 0, count: 100, overscan: 25 },
    include: { resources: true },
  });

  const columns = React.useMemo<ColumnDef<object, unknown>[]>(
    () => [
      {
        header: 'Name',
        accessorKey: 'name',
        cell: ({ row }: { row: Row<object> }) => {
          const pool = row.original as StoragePoolRow;
          return (
            <div className="flex items-center gap-2 font-medium">
              <DatabaseIcon className="size-4 text-muted-foreground" />
              <span>{pool.name}</span>
            </div>
          );
        },
      },
      {
        header: 'Driver',
        accessorKey: 'driver',
        cell: ({ row }: { row: Row<object> }) => {
          const pool = row.original as StoragePoolRow;
          return pool.metadata ? (
            <Badge variant="outline" className="font-mono">
              {pool.metadata.driver}
            </Badge>
          ) : (
            <Skeleton className="h-5 w-14" />
          );
        },
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }: { row: Row<object> }) => {
          const pool = row.original as StoragePoolRow;
          return pool.metadata ? (
            <Badge variant={statusBadgeVariant(pool.metadata.status)}>
              {pool.metadata.status}
            </Badge>
          ) : (
            <Skeleton className="h-5 w-20" />
          );
        },
      },
      {
        header: 'Space',
        id: 'space',
        cell: ({ row }: { row: Row<object> }) => {
          const pool = row.original as StoragePoolRow;
          const space = pool.resources?.space;
          if (!space) return <Skeleton className="h-7 w-40" />;

          const value = percent(space.used, space.total);
          return (
            <StaleShimmer active={isSoftLoading(pool.resourcesStatus)} asChild>
              <div className="min-w-40 space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatBytes(space.used)}</span>
                  <span>{formatBytes(space.total)}</span>
                </div>
                <Progress value={value} className="h-1.5" />
              </div>
            </StaleShimmer>
          );
        },
      },
      {
        header: 'Locations',
        id: 'locations',
        cell: ({ row }: { row: Row<object> }) => {
          const pool = row.original as StoragePoolRow;
          const locations = pool.metadata?.locations ?? [];
          return pool.metadata ? (
            <span className="text-muted-foreground">
              {locations.length ? locations.join(', ') : '—'}
            </span>
          ) : (
            <Skeleton className="h-5 w-24" />
          );
        },
      },
      {
        header: 'Used by',
        id: 'used_by',
        cell: ({ row }: { row: Row<object> }) => {
          const pool = row.original as StoragePoolRow;
          return pool.metadata ? pool.metadata.used_by?.length ?? 0 : '—';
        },
      },
      {
        header: 'Description',
        id: 'description',
        cell: ({ row }: { row: Row<object> }) => {
          const pool = row.original as StoragePoolRow;
          return (
            <span className="text-muted-foreground">
              {pool.metadata?.description || '—'}
            </span>
          );
        },
      },
    ],
    [],
  );

  const loadableStatus =
    collectionStatus === 'loading' || collectionStatus === 'refreshing'
      ? collectionStatus
      : status;

  return (
    <PageTransition className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-2xl font-semibold">Storage Pools</p>
          <p className="text-sm text-muted-foreground">
            Capacity, drivers, and pool consumers
          </p>
        </div>
        <div className="ml-auto">
          <Input
            placeholder="Search storage pools..."
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="w-full sm:w-64"
          />
        </div>
      </div>

      <LoadableSurface
        status={loadableStatus}
        hasData={rows.length > 0}
        freshness
        skeleton={
          <DataTable
            data={[]}
            cols={columns}
            disablePagination
            loading
            skeletonRows={7}
            virtualRowEstimatePx={64}
            renderSkeletonCell={renderStoragePoolSkeletonCell}
          />
        }
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <DatabaseIcon />
              </EmptyMedia>
              <EmptyTitle>No storage pools</EmptyTitle>
              <EmptyDescription>
                Storage pools will appear here after they are created.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      >
        <DataTable
          data={rows}
          cols={columns}
          disablePagination
          virtualizeRows
          virtualScrollMaxHeightClassName="max-h-[min(72vh,760px)]"
          virtualRowEstimatePx={64}
          stringFilter={filter}
          onRowClick={(row) => {
            setSelectedPool(row.original as StoragePoolRow);
            setIsInspectorOpen(true);
          }}
        />
      </LoadableSurface>

      <Sheet
        open={isInspectorOpen}
        onOpenChange={(open) => {
          setIsInspectorOpen(open);
          if (!open) setSelectedPool(null);
        }}
      >
        <SheetContent className="sm:max-w-md">
          {selectedPool ? <StoragePoolInspector pool={selectedPool} /> : null}
        </SheetContent>
      </Sheet>
    </PageTransition>
  );
}

function renderStoragePoolSkeletonCell(columnId: string) {
  if (columnId === 'name') {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="size-4 rounded-sm" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }
  if (columnId === 'driver') {
    return <Skeleton className="h-5 w-14 rounded-full" />;
  }
  if (columnId === 'status') {
    return <Skeleton className="h-5 w-20 rounded-full" />;
  }
  if (columnId === 'space') {
    return (
      <div className="space-y-2">
        <div className="flex justify-between gap-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-1.5 w-full" />
      </div>
    );
  }
  if (columnId === 'locations') return <Skeleton className="h-4 w-20" />;
  if (columnId === 'used_by') return <Skeleton className="h-4 w-8" />;
  return <Skeleton className="h-4 w-48 max-w-full" />;
}

function StoragePoolInspector({ pool }: { pool: StoragePoolRow }) {
  const config = Object.entries(pool.metadata?.config ?? {});
  return (
    <>
      <SheetHeader className="px-4 pt-4">
        <SheetTitle>{pool.name}</SheetTitle>
        <SheetDescription>
          {pool.metadata?.driver ?? 'Storage pool'} ·{' '}
          {pool.metadata?.status ?? pool.metadataStatus}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-5">
        <section className="space-y-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Resources
          </p>
          <div className="rounded-md border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Space used</span>
              <span>{formatBytes(pool.resources?.space?.used)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Space total</span>
              <span>{formatBytes(pool.resources?.space?.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Inodes used</span>
              <span>{pool.resources?.inodes?.used?.toLocaleString() ?? '—'}</span>
            </div>
          </div>
        </section>
        <section className="space-y-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Configuration
          </p>
          <div className="space-y-2 rounded-md border p-3 text-sm">
            {config.length ? (
              config.map(([key, value]) => (
                <div key={key} className="flex justify-between gap-4">
                  <span className="text-muted-foreground">{key}</span>
                  <span className="font-mono text-xs">{value}</span>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No configuration values.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
