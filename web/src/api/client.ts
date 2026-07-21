import type {
  AssistantResponse,
  FixResponse,
  PlotFeatureCollection,
  PlotRow,
  QAReport,
  ReplaceResponse,
  UploadResponse,
} from "./types";

/** Error carrying the backend's typed envelope (message + hint + status). */
export class ApiError extends Error {
  hint?: string;
  status: number;
  constructor(message: string, status: number, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return res.json();
  const body: { message?: string; hint?: string } = await res.json().catch(() => ({}));
  throw new ApiError(body.message ?? res.statusText, res.status, body.hint);
}

export async function uploadFiles(files: File[]): Promise<UploadResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return unwrap(await fetch("/api/files", { method: "POST", body: form }));
}

export async function getQA(fileId: string): Promise<QAReport> {
  return unwrap(await fetch(`/api/files/${fileId}/qa`));
}

export async function getFeatures(fileId: string): Promise<PlotFeatureCollection> {
  return unwrap(await fetch(`/api/files/${fileId}/features`));
}

export async function getRows(fileId: string): Promise<PlotRow[]> {
  const data = await unwrap<{ rows: PlotRow[] }>(await fetch(`/api/files/${fileId}/rows`));
  return data.rows;
}

export async function fixGeometries(fileId: string): Promise<FixResponse> {
  return unwrap(await fetch(`/api/files/${fileId}/fix`, { method: "POST" }));
}

export async function askAssistant(
  fileId: string,
  messages: { role: string; content: string }[]
): Promise<AssistantResponse> {
  return unwrap(
    await fetch(`/api/files/${fileId}/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    })
  );
}

export async function putFeatures(
  fileId: string,
  fc: PlotFeatureCollection
): Promise<ReplaceResponse> {
  return unwrap(
    await fetch(`/api/files/${fileId}/features`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fc),
    })
  );
}
