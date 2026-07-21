import { ArrowUpRight, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Duplicates } from "@/api/types";
import { useQA } from "@/hooks";
import { StatCard } from "./StatCard";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/** Plots involved in any duplicate tier (union of member indices). */
function redundantCount(d: Duplicates): number {
  const s = new Set<number>();
  [...d.exact, ...d.normalized, ...d.near].forEach((g) => g.forEach((i) => s.add(i)));
  return s.size;
}

export function QASummary() {
  const { data: qa, isLoading } = useQA();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[168px] rounded-[1.75rem]" />
        ))}
      </div>
    );
  }
  if (!qa) return null;

  const redundant = redundantCount(qa.duplicates);
  const clean = qa.invalid.length === 0;
  const types = Object.entries(qa.geometry_types)
    .map(([t, n]) => `${t} · ${n}`)
    .join(", ");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Plots"
          value={qa.count}
          badge={<Badge variant="secondary">{types}</Badge>}
          caption={`Uploaded features in ${qa.crs}`}
        />
        <StatCard
          title="Total area"
          value={qa.total_area_ha.toFixed(2)}
          unit="ha"
          caption="Geodesic measurement on the WGS84 ellipsoid"
        />
        <StatCard
          title="Invalid geometry"
          value={qa.invalid.length}
          badge={
            clean ? (
              <Badge variant="success">
                <ShieldCheck /> all valid
              </Badge>
            ) : (
              <Badge variant="destructive">
                <TriangleAlert /> needs fixing
              </Badge>
            )
          }
          caption={clean ? "Every ring checks out" : "Can be repaired automatically below"}
        />
        <StatCard
          title="Redundant plots"
          value={redundant}
          badge={
            redundant ? (
              <Badge variant="warning">
                <ArrowUpRight /> duplicates
              </Badge>
            ) : (
              <Badge variant="success">unique</Badge>
            )
          }
          caption="Exact, reordered and near-identical tiers"
        />
      </div>

      {qa.warnings.length > 0 && (
        <div className="flex items-start gap-3 rounded-3xl bg-warning/10 px-6 py-4 text-sm text-warning">
          <Info className="mt-0.5 size-4 shrink-0" />
          <ul className="space-y-0.5">
            {qa.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
