import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fixGeometries, getFeatures, getQA, getRows, putFeatures, ApiError } from "./api/client";
import type { PlotFeatureCollection } from "./api/types";
import { useApp } from "./store";

/** Shared QA query — deduped across components by React Query. */
export function useQA() {
  const fileId = useApp((s) => s.fileId);
  return useQuery({
    queryKey: ["qa", fileId],
    queryFn: () => getQA(fileId as string),
    enabled: Boolean(fileId),
  });
}

export function useRows() {
  const fileId = useApp((s) => s.fileId);
  return useQuery({
    queryKey: ["rows", fileId],
    queryFn: () => getRows(fileId as string),
    enabled: Boolean(fileId),
  });
}

export function useFeatures() {
  const fileId = useApp((s) => s.fileId);
  return useQuery({
    queryKey: ["features", fileId],
    queryFn: () => getFeatures(fileId as string),
    enabled: Boolean(fileId),
  });
}

/** Runs server-side geometry repair, then refetches everything derived from it. */
export function useFix() {
  const fileId = useApp((s) => s.fileId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fixGeometries(fileId as string),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["qa", fileId] });
      queryClient.invalidateQueries({ queryKey: ["rows", fileId] });
      queryClient.invalidateQueries({ queryKey: ["features", fileId] });
      const repaired = res.fixed.filter((f) => f.repaired);
      if (repaired.length) {
        toast.success(
          `Repaired ${repaired.length} ${repaired.length === 1 ? "geometry" : "geometries"}`,
          { description: repaired.map((f) => f.reason.split("[")[0].trim()).join(" · ") }
        );
      } else {
        toast.info("Nothing to repair — all geometries are valid.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Persists edited geometries/attributes; the server re-validates and re-runs QA. */
export function useReplaceFeatures() {
  const fileId = useApp((s) => s.fileId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fc: PlotFeatureCollection) => putFeatures(fileId as string, fc),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["qa", fileId] });
      queryClient.invalidateQueries({ queryKey: ["rows", fileId] });
      queryClient.invalidateQueries({ queryKey: ["features", fileId] });
      toast.success(`Changes saved — QA re-run on ${res.featureCount} plots`);
    },
    onError: (e: Error) => {
      toast.error(e.message, { description: e instanceof ApiError ? e.hint : undefined });
    },
  });
}
