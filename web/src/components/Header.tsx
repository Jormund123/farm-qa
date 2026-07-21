import { FileJson, Leaf, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/store";
import { useQA } from "@/hooks";

export function Header() {
  const { fileName, reset } = useApp();
  const { data: qa } = useQA();

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2">
          <Leaf className="size-5 text-success" />
          <span className="text-lg font-semibold lowercase tracking-tight">farmqa</span>
        </div>

        {fileName && (
          <div className="flex items-center gap-2.5">
            <span className="hidden items-center gap-2 rounded-full bg-card py-1.5 pl-3 pr-4 text-sm sm:flex">
              <FileJson className="size-4 text-success" />
              <span className="max-w-[150px] truncate">{fileName}</span>
              {qa && <span className="text-muted-foreground">· {qa.count} plots</span>}
            </span>
            <Button size="sm" onClick={reset}>
              <Plus className="size-3.5" />
              New file
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
