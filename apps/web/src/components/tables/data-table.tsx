"use client";

import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/states";

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  pageSize?: number;
  rowKey?: (row: T) => string;
  dense?: boolean;
  /**
   * True while rows are being fetched. With no data yet this renders the real
   * header plus skeleton rows (never the empty state); with stale data present
   * it keeps the rows visible, dimmed, until the refetch lands.
   */
  loading?: boolean;
}

const SKELETON_CELL_WIDTHS = ["w-3/4", "w-1/2", "w-full"];

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  emptyTitle = "Nothing here",
  emptyDescription = "No rows match the current filters.",
  pageSize = 25,
  rowKey,
  dense = true,
  loading = false,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const header = (
    <TableHeader>
      {table.getHeaderGroups().map((hg) => (
        <TableRow key={hg.id} className="hover:bg-transparent">
          {hg.headers.map((h) => {
            const sortable = h.column.getCanSort();
            const sorted = h.column.getIsSorted();
            return (
              <TableHead key={h.id} className="h-9 whitespace-nowrap text-xs">
                {sortable ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {sorted === "asc" && <ChevronUp className="size-3" aria-hidden />}
                    {sorted === "desc" && <ChevronDown className="size-3" aria-hidden />}
                  </button>
                ) : (
                  flexRender(h.column.columnDef.header, h.getContext())
                )}
              </TableHead>
            );
          })}
        </TableRow>
      ))}
    </TableHeader>
  );

  if (data.length === 0) {
    if (loading) {
      return (
        <div className="overflow-x-auto rounded-lg border" role="status" aria-busy aria-label="Loading rows">
          <Table>
            {header}
            <TableBody>
              {Array.from({ length: Math.min(pageSize, 8) }).map((_, r) => (
                <TableRow key={r} className="hover:bg-transparent">
                  {columns.map((_, c) => (
                    <TableCell key={c} className={cn("whitespace-nowrap", dense ? "py-1.5" : "py-2.5")}>
                      <Skeleton
                        className={cn("h-4", SKELETON_CELL_WIDTHS[(r + c) % SKELETON_CELL_WIDTHS.length])}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    }
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();

  return (
    <div
      className={cn("space-y-2", loading && "pointer-events-none opacity-60")}
      aria-busy={loading || undefined}
    >
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          {header}
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={rowKey ? rowKey(row.original) : row.id}
                className={cn(onRowClick && "cursor-pointer")}
                onClick={() => onRowClick?.(row.original)}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onRowClick && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                    e.preventDefault();
                    onRowClick(row.original);
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn("whitespace-nowrap", dense ? "py-1.5 text-[13px]" : "py-2.5 text-sm")}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="tnum text-xs text-muted-foreground">
            {data.length.toLocaleString()} rows · page {pageIndex + 1} of {pageCount}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              aria-label="Next page"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
