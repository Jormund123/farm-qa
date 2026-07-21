import { useMemo } from "react";
import { CopyCheck, ShieldCheck, Wrench } from "lucide-react";
import { useFix, useQA, useRows } from "@/hooks";
import { useApp } from "@/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const TIERS = [
  { key: "exact", label: "Exact", tone: "warning", hint: "byte-identical geometry" },
  { key: "normalized", label: "Reordered", tone: "warning", hint: "same shape, different vertex order" },
  { key: "near", label: "Near", tone: "warning", hint: "boundaries overlap ≥ 98%" },
  { key: "overlaps", label: "Conflict", tone: "destructive", hint: "different fields sharing ground" },
] as const;

/** Clickable plot chip — selecting flies the map and highlights the table row. */
function PlotChip({ fid }: { fid: number }) {
  const selectedFid = useApp((s) => s.selectedFid);
  const select = useApp((s) => s.select);
  const active = selectedFid === fid;
  return (
    <button
      onClick={() => select(active ? undefined : fid)}
      className={cn(
        "rounded-full px-3 py-1 text-sm font-medium tabular-nums transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-chip hover:bg-chip/70"
      )}
    >
      Plot {fid}
    </button>
  );
}

export function IssuesPanel() {
  const { data: qa, isLoading } = useQA();
  const { data: rows } = useRows();
  const fix = useFix();

  // QA reports 0-based dataframe indices; the UI speaks in plot fids.
  const fidOf = useMemo(() => {
    const m = new Map<number, number>();
    rows?.forEach((r) => m.set(r.index, Number(r.properties.fid)));
    return (index: number) => m.get(index) ?? index;
  }, [rows]);

  if (isLoading || !qa) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-[1.75rem]" />
        <Skeleton className="h-56 rounded-[1.75rem]" />
      </div>
    );
  }

  const tiers = TIERS.map((t) => ({ ...t, groups: qa.duplicates[t.key] })).filter(
    (t) => t.groups.length > 0
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ---- Geometry issues ---- */}
      <section className="rounded-[1.75rem] bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold tracking-tight">Geometry issues</h2>
            <p className="text-sm text-muted-foreground">
              Broken rings, self-intersections, misplaced holes
            </p>
          </div>
          {qa.invalid.length > 0 && (
            <Button variant="accent" size="sm" onClick={() => fix.mutate()} disabled={fix.isPending}>
              <Wrench className={cn("size-3.5", fix.isPending && "animate-spin")} />
              {fix.isPending ? "Repairing…" : "Fix all"}
            </Button>
          )}
        </div>

        <div className="mt-5 space-y-2.5">
          {qa.invalid.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-2xl bg-success/10 px-4 py-3.5 text-sm text-success">
              <ShieldCheck className="size-4 shrink-0" />
              All geometries are valid.
            </div>
          ) : (
            qa.invalid.map((issue) => (
              <div
                key={issue.index}
                className="flex flex-wrap items-center gap-3 rounded-2xl bg-raised px-4 py-3"
              >
                <PlotChip fid={fidOf(issue.index)} />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={issue.reason}>
                  {issue.reason.split("[")[0].trim()}
                </span>
                <Badge variant={issue.fixable ? "success" : "destructive"}>
                  {issue.fixable ? "auto-fixable" : "manual"}
                </Badge>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ---- Duplicates ---- */}
      <section className="rounded-[1.75rem] bg-card p-6">
        <div>
          <h2 className="font-semibold tracking-tight">Duplicates & conflicts</h2>
          <p className="text-sm text-muted-foreground">
            Plots reporting the same field, or intruding on another — click to compare
          </p>
        </div>

        <div className="mt-5 space-y-2.5">
          {tiers.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-2xl bg-success/10 px-4 py-3.5 text-sm text-success">
              <CopyCheck className="size-4 shrink-0" />
              Every plot is unique.
            </div>
          ) : (
            tiers.map((t) =>
              t.groups.map((group, i) => (
                <div
                  key={`${t.key}-${i}`}
                  className="flex flex-wrap items-center gap-3 rounded-2xl bg-raised px-4 py-3"
                >
                  <Badge variant={t.tone}>{t.label}</Badge>
                  <div className="flex flex-wrap gap-1.5">
                    {group.map((index) => (
                      <PlotChip key={index} fid={fidOf(index)} />
                    ))}
                  </div>
                  <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
                    {t.hint}
                  </span>
                </div>
              ))
            )
          )}
        </div>
      </section>
    </div>
  );
}
