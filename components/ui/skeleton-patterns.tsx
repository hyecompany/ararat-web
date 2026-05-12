import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

function TableSkeleton({
  rows = 3,
  rowHeightClassName = 'h-10',
  className,
}: {
  rows?: number;
  rowHeightClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className={cn(rowHeightClassName, 'w-full')} />
      ))}
    </div>
  );
}

function ToolbarSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Skeleton className="h-10 w-full sm:w-64" />
      <Skeleton className="ml-auto h-10 w-28" />
    </div>
  );
}

function DetailSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="grid grid-cols-[8rem_1fr] gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

function FileTableSkeleton({ rows = 12 }: { rows?: number }) {
  return (
    <div className="rounded-md border" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="grid h-[49px] grid-cols-[2rem_minmax(0,1fr)_7rem_7rem_3rem] items-center gap-3 border-b px-2 last:border-b-0"
        >
          <Skeleton className="size-4" />
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-4 w-48 max-w-[70%]" />
          </div>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="size-8 rounded-md" />
        </div>
      ))}
    </div>
  );
}

function ComboboxOptionsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1 p-1" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex h-9 items-center gap-2 rounded-sm px-2">
          <Skeleton className="size-4 rounded-sm" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className="h-3.5 w-3/5" />
            {index % 2 === 0 ? <Skeleton className="h-3 w-4/5" /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export {
  ComboboxOptionsSkeleton,
  DetailSkeleton,
  FileTableSkeleton,
  TableSkeleton,
  ToolbarSkeleton,
};
