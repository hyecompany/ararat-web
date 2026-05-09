'use client';

import { useMemo, useState } from 'react';
import { ColumnDef, Row } from '@tanstack/react-table';

import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Badge } from 'ui-web/components/badge';
import { Button } from 'ui-web/components/button';
import DataTable from 'ui-web/components/data-table';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from 'ui-web/components/empty';
import { Input } from 'ui-web/components/input';
import { LoadableSurface } from 'ui-web/components/loadable-surface';
import { Skeleton } from 'ui-web/components/skeleton';
import { Spinner } from 'ui-web/components/spinner';
import { PageTransition } from 'ui-web/components/view-transitions';
import { cn } from 'ui-web/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from 'ui-web/components/sheet';
import { ListChecksIcon } from 'lucide-react';
import { useOperations } from '@/app/_incus/resources/operations/hooks';
import type { IncusOperation } from '@/app/_incus/types';

const OPERATION_ROW_HEIGHT_PX = 58;

const STATUS_STYLES: Record<
  string,
  {
    label: string;
    className: string;
  }
> = {
  running: {
    label: 'Running',
    className: 'border-blue-500/40 bg-blue-500/10 text-blue-100',
  },
  pending: {
    label: 'Pending',
    className: 'border-zinc-600 bg-zinc-900 text-zinc-200',
  },
  cancelling: {
    label: 'Cancelling',
    className: 'border-blue-300/40 bg-blue-300/10 text-blue-100',
  },
  success: {
    label: 'Success',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
  },
  failure: {
    label: 'Failure',
    className: 'border-red-500/40 bg-red-500/10 text-red-100',
  },
};

function formatDateTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function OperationsPage() {
  const { items: operations, status, cancel, error } = useOperations();
  const [filter, setFilter] = useState('');
  const [selectedOperationIds, setSelectedOperationIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [inspectorOperationId, setInspectorOperationId] = useState<string | null>(
    null,
  );
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  const selectedOperations = useMemo(() => {
    const byId = new Map(operations.map((operation) => [operation.id, operation]));
    return selectedOperationIds
      .map((id) => byId.get(id))
      .filter((operation): operation is IncusOperation => Boolean(operation));
  }, [operations, selectedOperationIds]);
  const inspectorOperation = useMemo(
    () =>
      inspectorOperationId
        ? operations.find((operation) => operation.id === inspectorOperationId) ?? null
        : null,
    [inspectorOperationId, operations],
  );

  const columns = useMemo<ColumnDef<object, unknown>[]>(
    () => [
      {
        header: 'Operation ID',
        accessorKey: 'id',
        cell: ({ row }: { row: Row<object> }) => {
          const operation = row.original as IncusOperation;
          return (
            <div className="font-mono text-xs truncate max-w-[200px]">
              {operation.id}
            </div>
          );
        },
      },
      {
        header: 'Type',
        accessorKey: 'class',
        cell: ({ row }: { row: Row<object> }) => {
          const operation = row.original as IncusOperation;
          return operation.class ?? '—';
        },
      },
      {
        header: 'Description',
        accessorKey: 'description',
        cell: ({ row }: { row: Row<object> }) => {
          const operation = row.original as IncusOperation;
          return operation.description ?? '—';
        },
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }: { row: Row<object> }) => {
          const operation = row.original as IncusOperation;
          const statusKey = operation.status?.toLowerCase() ?? '';
          const statusMeta = STATUS_STYLES[statusKey] ?? {
            label: operation.status || 'Unknown',
            className: 'border-zinc-600 bg-zinc-900 text-zinc-300',
          };
          return (
            <Badge
              variant="outline"
              className={cn(
                'border px-2 py-0.5 text-xs font-medium',
                statusMeta.className,
              )}
            >
              {statusMeta.label}
            </Badge>
          );
        },
      },
      {
        header: 'Creation Time',
        accessorKey: 'created_at',
        cell: ({ row }: { row: Row<object> }) => {
          const operation = row.original as IncusOperation;
          return (
            <span className="text-sm text-zinc-300">
              {formatDateTime(operation.created_at)}
            </span>
          );
        },
      },
    ],
    [],
  );

  const handleCancelSelected = async () => {
    if (!selectedOperations.length) return;
    setActionError(null);
    setIsCancelling(true);
    try {
      await Promise.all(selectedOperations.map((operation) => cancel(operation.id)));
      setSelectedOperationIds([]);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to cancel operations.',
      );
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <PageTransition className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-2xl font-semibold">Operations</p>
          <p className="text-sm text-muted-foreground">
            Live tasks and background operations
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {selectedOperations.length ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isCancelling}
              onClick={handleCancelSelected}
            >
              {isCancelling ? <Spinner className="mr-2 size-3" /> : null}
              Cancel Selected
            </Button>
          ) : (
            <Input
              placeholder="Search operations..."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="w-full sm:w-64"
            />
          )}
        </div>
      </div>
      {actionError ? (
        <Alert variant="destructive">
          <AlertTitle>Cancel action failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to load operations</AlertTitle>
          <AlertDescription>
            {error.message || 'Check your Incus API connection and try again.'}
          </AlertDescription>
        </Alert>
      ) : null}
      <LoadableSurface
        status={status}
        hasData={operations.length > 0}
        freshness
        skeleton={
          <DataTable
            enableSelection
            data={[]}
            cols={columns}
            disablePagination
            loading
            skeletonRows={8}
            virtualRowEstimatePx={OPERATION_ROW_HEIGHT_PX}
            renderSkeletonCell={renderOperationSkeletonCell}
          />
        }
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecksIcon />
              </EmptyMedia>
              <EmptyTitle>No operations running</EmptyTitle>
              <EmptyDescription>
                Background tasks and live Incus operations will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      >
        <DataTable
          enableSelection
          data={operations}
          cols={columns}
          stringFilter={filter}
          disablePagination
          virtualizeRows
          virtualScrollMaxHeightClassName="max-h-[min(72vh,760px)]"
          virtualRowEstimatePx={OPERATION_ROW_HEIGHT_PX}
          onSelectionChange={(rows) => {
            const next = rows.map((row) => (row.original as IncusOperation).id);
            setSelectedOperationIds((prev) =>
              prev.length === next.length &&
              prev.every((item, index) => item === next[index])
                ? prev
                : next,
            );
          }}
          onRowClick={(row) => {
            setInspectorOperationId((row.original as IncusOperation).id);
            setIsInspectorOpen(true);
          }}
        />
      </LoadableSurface>
      <Sheet
        open={isInspectorOpen}
        onOpenChange={(open) => {
          setIsInspectorOpen(open);
          if (!open) setInspectorOperationId(null);
        }}
      >
        <SheetContent className="sm:max-w-md">
          {inspectorOperation ? (
            <OperationInspector operation={inspectorOperation} />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">
              Select an operation to view details.
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageTransition>
  );
}

function renderOperationSkeletonCell(columnId: string, rowIndex: number) {
  const rowWidths = [
    {
      id: 'w-44',
      class: 'w-16',
      description: 'w-64',
      status: 'w-20',
      created_at: 'w-32',
    },
    {
      id: 'w-36',
      class: 'w-20',
      description: 'w-52',
      status: 'w-24',
      created_at: 'w-28',
    },
    {
      id: 'w-48',
      class: 'w-14',
      description: 'w-72',
      status: 'w-20',
      created_at: 'w-36',
    },
    {
      id: 'w-40',
      class: 'w-16',
      description: 'w-56',
      status: 'w-24',
      created_at: 'w-32',
    },
  ];
  const widths = rowWidths[rowIndex % rowWidths.length];

  if (columnId === 'select') return <Skeleton className="size-4 rounded-sm" />;
  if (columnId === 'status') {
    return <Skeleton className={cn('h-5 rounded-full', widths.status)} />;
  }
  return (
    <Skeleton
      className={cn(
        'h-4',
        widths[columnId as keyof typeof widths] ?? 'w-28',
      )}
    />
  );
}

function OperationInspector({ operation }: { operation: IncusOperation }) {
  return (
    <>
      <SheetHeader className="px-4 pt-4">
        <SheetTitle>{operation.description ?? operation.id}</SheetTitle>
        <SheetDescription>
          {operation.class ?? 'Operation'} · {operation.status ?? 'Unknown'}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        <MetadataSection title="Metadata" metadata={operation.metadata} />
        <MetadataSection title="Resources" metadata={operation.resources} />
      </div>
    </>
  );
}

function isPlainObject(obj: unknown): obj is Record<string, unknown> {
  return (
    !!obj &&
    typeof obj === 'object' &&
    Object.prototype.toString.call(obj) === '[object Object]'
  );
}

function MetadataSection({
  title,
  metadata,
}: {
  title: string;
  metadata: unknown;
}) {
  if (
    !metadata ||
    (isPlainObject(metadata) && Object.keys(metadata).length === 0)
  ) {
    return null;
  }

  const entries = (
    isPlainObject(metadata) ? Object.entries(metadata) : [['value', metadata]]
  ) as [string, unknown][];

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {title}
      </p>
      <div className="space-y-2 rounded-md border border-white/10 bg-black/30 p-3 text-sm">
        {entries.map(([key, value]) => (
          <KeyValueCard key={`${title}-${key}`} label={key}>
            {renderValue(value)}
          </KeyValueCard>
        ))}
      </div>
    </div>
  );
}

function KeyValueCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-md border border-white/5 bg-zinc-900/70 px-3 py-2">
      <p className="text-[10px] font-medium uppercase text-muted-foreground tracking-wide">
        {label}
      </p>
      <div className="text-xs text-white wrap-break-word">{children}</div>
    </div>
  );
}

function renderValue(value: unknown): React.ReactNode {
  if (value === null || typeof value === 'undefined') return '—';
  if (typeof value === 'string' || typeof value === 'number')
    return value.toString();
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return (
      <ul className="list-disc pl-4 space-y-1">
        {value.map((item, idx) => (
          <li key={idx} className="wrap-break-word">
            {renderValue(item)}
          </li>
        ))}
      </ul>
    );
  }
  if (isPlainObject(value)) {
    return (
      <div className="space-y-2 pl-1">
        {Object.entries(value).map(([k, v]) => (
          <KeyValueCard key={`nested-${k}`} label={k}>
            {renderValue(v)}
          </KeyValueCard>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}
