'use client';

import * as React from 'react';
import {
  CellContext,
  Column,
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  HeaderContext,
  Row,
  SortingState,
  useReactTable,
  VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Button } from './button';
import { Checkbox } from './checkbox';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';
import { Input } from './input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';
import { ArrowDown } from 'lucide-react';
import { cn } from 'ui-web/lib/utils';

interface DataTableColumnHeaderProps<
  TData,
  TValue,
> extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  ...props
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>;
  }
  if (!column.getCanFilter()) {
    return (
      <div className={cn('flex items-center gap-2', className)} {...props}>
        <Button
          variant="ghost"
          size="sm"
          className="data-[state=open]:bg-accent -ml-3 h-8"
          onClick={() =>
            column.toggleSorting(column.getIsSorted() === 'asc')
          }
        >
          <span>{title}</span>
          <ArrowDown
            className={`transition-all duration-100 rotate-0 ${
              column.getIsSorted() === 'desc'
                ? ''
                : column.getIsSorted() === 'asc'
                  ? 'rotate-180'
                  : 'hidden'
            }`}
          />
        </Button>
      </div>
    );
  }
  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="data-[state=open]:bg-accent -ml-3 h-8"
          >
            <span>{title}</span>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent align="center" portalled={false}>
          <Input placeholder="Search..." />
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

export default function DataTable({
  data,
  className,
  cols,
  enableSelection,
  stringFilter,
  onSelectionChange,
  onRowClick,
  getRowClassName,
  wrapTableRow,
  disablePagination,
  virtualizeRows,
  virtualScrollMaxHeightClassName,
  virtualRowEstimatePx,
  onVirtualVisibleRowsChange,
}: {
  data: object[];
  cols: ColumnDef<object, unknown>[];
  className?: string;
  enableSelection?: boolean;
  stringFilter?: string;
  onSelectionChange?: (rows: Row<object>[]) => void;
  onRowClick?: (
    row: Row<object>,
    event: React.MouseEvent<HTMLTableRowElement, MouseEvent>,
  ) => void;
  getRowClassName?: (row: Row<object>) => string | undefined;
  wrapTableRow?: (
    row: Row<object>,
    rowElement: React.ReactElement<
      React.ComponentProps<typeof TableRow>
    >,
  ) => React.ReactNode;
  disablePagination?: boolean;
  virtualizeRows?: boolean;
  virtualScrollMaxHeightClassName?: string;
  virtualRowEstimatePx?: number;
  onVirtualVisibleRowsChange?: (rows: Row<object>[]) => void;
}) {
  let columns: ColumnDef<object, unknown>[] = cols.map((col) => {
    return {
      ...col,
      id:
        typeof col.header == 'string' && !col.id
          ? col.header.toString().toLowerCase()
          : col.id,
      header:
        typeof col.header == 'string'
          ? ({ column }: HeaderContext<object, unknown>) => (
              <DataTableColumnHeader
                column={column}
                title={col.header as string}
              />
            )
          : col.header,
      cell: col.cell
        ? col.cell
        : ({ getValue }: { getValue: () => unknown }) => {
            return <div>{getValue() as string}</div>;
          },
    } as ColumnDef<object, unknown>;
  });
  if (enableSelection) {
    columns = [
      {
        id: 'select',
        header: ({ table }: HeaderContext<object, unknown>) => (
          <Checkbox
            className="w-4"
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select all"
          />
        ),
        cell: ({ row }: CellContext<object, unknown>) => (
          <div onClick={(event) => event.stopPropagation()} role="presentation">
            <Checkbox
              className="w-4"
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
              aria-label="Select row"
            />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
        size: 20,
      } as ColumnDef<object, unknown>,
      ...columns,
    ];
  }
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});

  // Note: React Compiler warning about useReactTable is expected.
  // TanStack Table's useReactTable returns functions that cannot be memoized safely,
  // which is why the React Compiler correctly skips memoization for this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<object>({
    data,
    columns,
    getRowId: (orig, index) => {
      const row = orig as { id?: string; name?: string; project?: string };
      if (row.id) return String(row.id);
      if (row.name && row.project) return `${row.project}:${row.name}`;
      if (row.name) return String(row.name);
      return `row-${index}`;
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    ...(disablePagination
      ? {}
      : { getPaginationRowModel: getPaginationRowModel() }),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: 'includesString',

    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });
  React.useEffect(() => {
    table.setGlobalFilter(stringFilter ?? '');
  }, [stringFilter, table]);
  React.useEffect(() => {
    if (!enableSelection || !onSelectionChange) return;
    onSelectionChange(table.getFilteredSelectedRowModel().rows);
  }, [enableSelection, onSelectionChange, rowSelection, table]);

  const scrollParentRef = React.useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  const estimate = virtualRowEstimatePx ?? 44;

  const useVirtual =
    Boolean(virtualizeRows && disablePagination && tableRows.length > 0);

  const rowVirtualizer = useVirtualizer({
    count: useVirtual ? tableRows.length : 0,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => estimate,
    overscan: 10,
  });

  const virtualItems =
    useVirtual ? rowVirtualizer.getVirtualItems() : [];

  const paddingTop =
    virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() -
        (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0;

  /** Re-measure when the scroll parent or row count changes so the first paint has virtual items. */
  React.useLayoutEffect(() => {
    if (!useVirtual) return;
    const v = rowVirtualizer as { measure?: () => void };
    v.measure?.();
  }, [rowVirtualizer, useVirtual, tableRows.length]);

  React.useLayoutEffect(() => {
    if (
      !virtualizeRows ||
      !disablePagination ||
      !onVirtualVisibleRowsChange
    ) {
      return;
    }
    const run = () => {
      const items = rowVirtualizer.getVirtualItems();
      if (items.length === 0) return;
      const visibleRows = items
        .map((vi) => tableRows[vi.index])
        .filter((r): r is Row<object> => r != null);
      onVirtualVisibleRowsChange(visibleRows);
    };
    run();
    const raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [
    virtualItems,
    tableRows.length,
    virtualizeRows,
    disablePagination,
    onVirtualVisibleRowsChange,
    rowVirtualizer,
  ]);

  const renderOneRow = (row: Row<object>) => {
    const rowEl = (
      <TableRow
        key={row.id}
        data-state={row.getIsSelected() && 'selected'}
        className={cn(
          onRowClick ? 'cursor-pointer' : '',
          getRowClassName ? getRowClassName(row) : '',
        )}
        onClick={
          onRowClick
            ? (event) => {
                onRowClick(row, event);
              }
            : undefined
        }
      >
        {row.getVisibleCells().map((cell) => {
          const cellSizePx = `${cell.column.getSize()}px`;
          return (
            <TableCell
              key={cell.id}
              className="min-w-0"
              style={{
                width: cellSizePx,
                maxWidth: cellSizePx,
              }}
            >
              {flexRender(
                cell.column.columnDef.cell,
                cell.getContext(),
              )}
            </TableCell>
          );
        })}
      </TableRow>
    );
    return wrapTableRow ? wrapTableRow(row, rowEl) : rowEl;
  };

  return (
    <div className={cn('w-full', className)}>
      <div
        ref={useVirtual ? scrollParentRef : undefined}
        className={cn(
          'rounded-md border',
          useVirtual
            ? virtualScrollMaxHeightClassName ??
              'max-h-[min(66vh,664px)] overflow-auto'
            : 'overflow-auto',
        )}
      >
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const headerSizePx = `${header.getSize()}px`;
                  return (
                    <TableHead
                      className="min-w-0"
                      style={{
                        width: headerSizePx,
                        maxWidth: headerSizePx,
                      }}
                      key={header.id}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {tableRows.length ? (
              useVirtual ? (
                <>
                  {paddingTop > 0 ? (
                    <TableRow aria-hidden className="hover:bg-transparent">
                      <TableCell
                        colSpan={columns.length}
                        className="p-0"
                        style={{ height: paddingTop, border: 'none' }}
                      />
                    </TableRow>
                  ) : null}
                  {virtualItems.map((vi) => {
                    const row = tableRows[vi.index];
                    if (!row) return null;
                    return (
                      <React.Fragment key={row.id}>
                        {renderOneRow(row)}
                      </React.Fragment>
                    );
                  })}
                  {paddingBottom > 0 ? (
                    <TableRow aria-hidden className="hover:bg-transparent">
                      <TableCell
                        colSpan={columns.length}
                        className="p-0"
                        style={{ height: paddingBottom, border: 'none' }}
                      />
                    </TableRow>
                  ) : null}
                </>
              ) : (
                tableRows.map((row) => renderOneRow(row))
              )
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {!disablePagination && (
        <div className="flex items-center justify-end space-x-2 py-4">
          {enableSelection ? (
            <div className="text-muted-foreground flex-1 text-sm">
              {table.getFilteredSelectedRowModel().rows.length} of{' '}
              {table.getFilteredRowModel().rows.length} selected.
            </div>
          ) : null}
          <div className="space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
