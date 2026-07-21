import { useEffect } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { useQA } from "@/hooks";
import { Header } from "@/components/Header";
import { QASummary } from "@/components/QASummary";
import { MapView } from "@/components/MapView";
import { IssuesPanel } from "@/components/IssuesPanel";
import { AssistantChat } from "@/components/AssistantChat";
import { FeatureTable } from "@/components/FeatureTable";
import { UploadDropzone } from "@/components/UploadDropzone";
import { useApp } from "@/store";

export default function App() {
  const fileId = useApp((s) => s.fileId);
  const reset = useApp((s) => s.reset);
  const { error } = useQA();

  // A 404 on the QA query means the server-side store no longer has this
  // dataset (restart) — explain and return to the upload screen.
  useEffect(() => {
    if (fileId && error instanceof ApiError && error.status === 404) {
      toast.error(error.message, { description: error.hint });
      reset();
    }
  }, [fileId, error, reset]);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="container px-4 pb-16 pt-4 md:px-6">
        {fileId ? (
          <div className="space-y-4">
            <QASummary />
            <FeatureTable />
            <MapView />
            <IssuesPanel />
          </div>
        ) : (
          <UploadDropzone />
        )}
      </main>
      <AssistantChat />
    </div>
  );
}
