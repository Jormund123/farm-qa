import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from "lucide-react";
import type { PlotRow, PropValue } from "@/api/types";
import { useFeatures, useReplaceFeatures, useRows } from "@/hooks";
import { useApp } from "@/store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const prettify = (k: string) => (k === "fid" ? "FID" : k.charAt(0).toUpperCase() + k.slice(1));
const fmt = (v: PropValue | undefined) =>
  typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toString()) : String(v ?? "—");

function SortHeader({ column, label, align }: { column: Column<PlotRow>; label: string; align?: "right" }) {
  const dir = column.getIsSorted();
  return (
    <button
      className={cn(
        "-ml-2 inline-flex items-center gap-1 rounded px-2 py-1 font-medium hover:text-foreground",
        align === "right" && "ml-0 -mr-2"
      )}
      onClick={() => column.toggleSorting(dir === "asc")}
    >
      {label}
      {dir === "asc" ? <ArrowUp className="size-3.5" /> : dir === "desc" ? <ArrowDown className="size-3.5" /> : <ChevronsUpDown className="size-3.5 opacity-50" />}
    </button>
  );
}

/** Double-click to edit; Enter/blur commits, Escape cancels. */
function EditableCell({
  value,
  onCommit,
}: {
  value: PropValue | undefined;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    setEditing(false);
    if (draft !== String(value ?? "")) onCommit(draft);
  };

  if (!editing) {
    return (
      <span
        className="cursor-text tabular-nums"
        title="Double-click to edit"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(String(value ?? ""));
          setEditing(true);
        }}
      >
        {fmt(value)}
      </span>
    );
  }
  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      onBlur={commit}
      className="h-8 w-28 px-3"
    />
  );
}

function StatusCell({ row }: { row: PlotRow }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {!row.valid && <Badge variant="destructive">invalid</Badge>}
      {row.duplicate && <Badge variant="warning">duplicate</Badge>}
      {row.valid && !row.duplicate && <Badge variant="success">valid</Badge>}
    </div>
  );
}

export function FeatureTable() {
  const { data: rows, isLoading } = useRows();
  const { data: fc } = useFeatures();
  const replace = useReplaceFeatures();
  const selectedFid = useApp((s) => s.selectedFid);
  const select = useApp((s) => s.select);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");

  const columns = useMemo<ColumnDef<PlotRow>[]>(() => {
    // Commit an attribute edit by rewriting that property on the matching
    // feature and sending the collection through the validated PUT.
    const commitProp = (fid: number, key: string, raw: string) => {
      if (!fc) return;
      const value = raw.trim() !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
      const features = fc.features.map((f) =>
        Number(f.properties.fid) === fid
          ? { ...f, properties: { ...f.properties, [key]: value } }
          : f
      );
      replace.mutate({ type: "FeatureCollection", features });
    };

    const keys = rows?.length ? Object.keys(rows[0].properties) : [];
    const propCols: ColumnDef<PlotRow>[] = keys.map((k) => ({
      id: k,
      accessorFn: (r) => r.properties[k],
      header: ({ column }) => <SortHeader column={column} label={prettify(k)} />,
      cell: ({ getValue, row }) => (
        <EditableCell
          value={getValue() as PropValue}
          onCommit={(v) => commitProp(Number(row.original.properties.fid), k, v)}
        />
      ),
    }));
    return [
      ...propCols,
      {
        id: "area",
        accessorKey: "area_ha",
        header: ({ column }) => (
          <div className="text-right">
            <SortHeader column={column} label="Area (ha)" align="right" />
          </div>
        ),
        cell: ({ getValue }) => (
          <div className="text-right">
            <span className="inline-flex rounded-full bg-chip px-3 py-1 font-medium tabular-nums">
              {(getValue() as number).toFixed(2)}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        header: () => <div className="text-right">Status</div>,
        enableSorting: false,
        cell: ({ row }) => <StatusCell row={row.original} />,
      },
    ];
  }, [rows, fc, replace]);

  // Pagination keeps the DOM shallow when a reviewer uploads thousands of plots.
  const table = useReactTable({
    data: rows ?? [],
    columns,
    state: { sorting, globalFilter: filter },
    initialState: { pagination: { pageSize: 50 } },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  if (isLoading) return <Skeleton className="h-72 w-full rounded-[1.75rem]" />;

  return (
    <div className="rounded-[1.75rem] bg-card pb-3">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h2 className="font-semibold tracking-tight">Plots</h2>
          <p className="text-sm text-muted-foreground">
            {rows?.length ?? 0} geometries · click a row to highlight it on the map · double-click a value to edit
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter plots…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Table className="px-3">
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => (
                <TableHead key={h.id} className="px-6">
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((r) => {
              const fid = r.original.properties.fid as number;
              return (
                <TableRow
                  key={r.id}
                  data-state={selectedFid === fid ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => select(selectedFid === fid ? undefined : fid)}
                >
                  {r.getVisibleCells().map((c) => (
                    <TableCell key={c.id} className="px-6 py-3">
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                No plots match your filter.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {table.getFilteredRowModel().rows.length > 50 && (
        <div className="flex items-center justify-between px-6 py-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} ·{" "}
            {table.getFilteredRowModel().rows.length.toLocaleString()} plots
          </span>
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
