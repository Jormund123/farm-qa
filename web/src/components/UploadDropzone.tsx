import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileJson, UploadCloud } from "lucide-react";
import { uploadFiles, ApiError } from "@/api/client";
import { useApp } from "@/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function UploadDropzone() {
  const setFile = useApp((s) => s.setFile);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: uploadFiles,
    onSuccess: (res, files) => {
      res.qa.warnings.forEach((w) => toast.warning(w));
      toast.success(`Loaded ${res.featureCount} plots from ${files[0]?.name ?? "file"}`);
      setFile(res.fileId, files[0]?.name ?? "upload.geojson");
    },
    onError: (e: Error) => {
      toast.error(e.message, { description: e instanceof ApiError ? e.hint : undefined });
    },
  });

  const send = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length) upload.mutate(files);
  };

  return (
    <div className="mx-auto flex min-h-[75vh] max-w-2xl flex-col items-center justify-center px-4">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-medium tracking-tight">Farm plot QA</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          Upload GeoJSON plot files to validate geometries, detect duplicates,
          compute geodesic areas, and edit or export the cleaned data.
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload GeoJSON"
        className={cn(
          "group w-full cursor-pointer rounded-[2rem] border-2 border-dashed bg-card p-14 text-center transition-all",
          dragging
            ? "border-primary bg-primary/5 ring-4 ring-primary/15"
            : "border-border hover:border-primary/50 hover:bg-raised/60"
        )}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          send(e.dataTransfer.files);
        }}
      >
        <input
          ref={input}
          type="file"
          accept=".geojson,.json,application/geo+json"
          multiple
          hidden
          onChange={(e) => send(e.target.files)}
        />
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-3xl bg-primary/15 text-primary transition-transform group-hover:scale-105">
          {upload.isPending ? (
            <UploadCloud className="size-7 animate-pulse" />
          ) : (
            <FileJson className="size-7" />
          )}
        </div>
        <div className="text-lg font-medium">
          {upload.isPending ? "Reading file…" : "Drop your GeoJSON here"}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          or click to browse — supports multiple <code className="text-xs">.geojson</code> files
        </p>
        <Button className="mt-7" disabled={upload.isPending}>
          <UploadCloud className="size-4" />
          Browse files
        </Button>
      </div>
    </div>
  );
}
