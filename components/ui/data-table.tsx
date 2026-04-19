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
            column.toggleSorting(column.getIsSorted() === 'asc' ? true : false)
          }
        >
          <span>{title}</span>
          <ArrowDown
            className={`transition-all duration-100 rotate-0 ${
              column.getIsSorted() == 'desc'
                ? ''
                : column.getIsSorted() == 'asc'
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
}) {
  let columns: ColumnDef<object, unknown>[] = cols.map((col) => {
    console.log(typeof col.header);
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
  const table = useReactTable({
    data,
    columns,
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
  return (
    <div className={cn('w-full', className)}>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  console.log(header.getSize());
                  return (
                    <TableHead
                      className="min-w-0"
                      style={{
                        width: header.getSize().toString() + 'px',
                        maxWidth: header.getSize().toString() + 'px',
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
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                const rowEl = (
                  <TableRow
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
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className="min-w-0"
                        style={{
                          width: cell.column.getSize().toString() + 'px',
                          maxWidth: cell.column.getSize().toString() + 'px',
                        }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
                return (
                  <React.Fragment key={row.id}>
                    {wrapTableRow ? wrapTableRow(row, rowEl) : rowEl}
                  </React.Fragment>
                );
              })
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
