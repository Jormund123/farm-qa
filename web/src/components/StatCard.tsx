import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/**
 * KPI block: card title, giant tabular metric with a status pill to its
 * right, muted caption below. Color lives only in the pill — numbers stay white.
 */
export function StatCard({
  title,
  value,
  unit,
  badge,
  caption,
}: {
  title: string;
  value: ReactNode;
  unit?: string;
  badge?: ReactNode;
  caption?: ReactNode;
}) {
  return (
    <Card className="p-6 md:p-7">
      <div className="text-[15px] font-medium text-muted-foreground">{title}</div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-[2.75rem] font-medium leading-none tracking-tight tabular-nums">
          {value}
          {unit && <span className="ml-1.5 text-xl font-normal text-muted-foreground">{unit}</span>}
        </span>
        {badge}
      </div>
      {caption && <div className="mt-3.5 text-sm text-muted-foreground">{caption}</div>}
    </Card>
  );
}
