import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, MessageCircle, SendHorizontal, Sparkles, Wrench, X } from "lucide-react";
import { ApiError, askAssistant } from "@/api/client";
import { useApp } from "@/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  error?: boolean;
}

/** Tools that change server-side data — the UI must refetch after them. */
const MUTATING_TOOLS = ["fix_geometries"];

/** Human-readable badge labels for the audit trail under each answer. */
const TOOL_LABELS: Record<string, string> = {
  get_qa_report: "Checked QA report",
  list_plots: "Listed plots",
  fix_geometries: "Repaired geometries",
};

const SUGGESTIONS = [
  "How many plots are duplicates?",
  "Which plot has invalid geometry?",
  "What is the total area?",
  "Fix the invalid geometry",
];

/** Floating messenger-style assistant: launcher button bottom-right, popup panel. */
export function AssistantChat() {
  const fileId = useApp((s) => s.fileId);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, open]);

  const send = useMutation({
    mutationFn: (history: Msg[]) =>
      askAssistant(
        fileId as string,
        history.map(({ role, content }) => ({ role, content }))
      ),
    onSuccess: (res) => {
      setMessages((m) => [...m, { role: "assistant", content: res.reply, tools: res.toolCalls }]);
      if (res.toolCalls.some((t) => MUTATING_TOOLS.includes(t))) {
        queryClient.invalidateQueries({ queryKey: ["qa", fileId] });
        queryClient.invalidateQueries({ queryKey: ["rows", fileId] });
        queryClient.invalidateQueries({ queryKey: ["features", fileId] });
      }
    },
    onError: (e: Error) => {
      const content = e instanceof ApiError && e.hint ? `${e.message} ${e.hint}` : e.message;
      setMessages((m) => [...m, { role: "assistant", content, error: true }]);
    },
  });

  const ask = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || send.isPending) return;
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    send.mutate(next);
  };

  if (!fileId) return null;

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 z-[1200] flex h-[min(32rem,calc(100dvh-8rem))] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[1.75rem] bg-card ring-1 ring-chip">
          <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold tracking-tight">Assistant</h2>
              <p className="truncate text-xs text-muted-foreground">
                Answers come from the QA engine, not the model's memory
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip transition-colors hover:bg-chip/70"
              aria-label="Close assistant"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-2">
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-full bg-chip px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-chip/70 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <span className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm text-primary-foreground">
                    {m.content}
                  </span>
                </div>
              ) : (
                <div key={i} className="flex gap-2.5">
                  <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-chip">
                    <Bot className="size-3.5" />
                  </span>
                  <div className="max-w-[85%] space-y-1.5">
                    <span
                      className={cn(
                        "block whitespace-pre-wrap rounded-2xl rounded-tl-md bg-raised px-4 py-2 text-sm",
                        m.error && "text-destructive"
                      )}
                    >
                      {m.content}
                    </span>
                    {m.tools && m.tools.length > 0 && (
                      <span className="flex flex-wrap gap-1.5">
                        {m.tools.map((t, j) => (
                          <Badge key={j} variant="secondary" className="text-[11px]">
                            <Wrench /> {TOOL_LABELS[t] ?? t}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              )
            )}

            {send.isPending && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <span className="flex size-7 items-center justify-center rounded-full bg-chip">
                  <Bot className="size-3.5 animate-pulse" />
                </span>
                Consulting the QA engine…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="flex gap-2 p-4 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this dataset…"
              disabled={send.isPending}
            />
            <Button type="submit" size="icon" disabled={send.isPending || !input.trim()}>
              <SendHorizontal className="size-4" />
            </Button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-4 z-[1200] flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 active:scale-95"
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>
    </>
  );
}
