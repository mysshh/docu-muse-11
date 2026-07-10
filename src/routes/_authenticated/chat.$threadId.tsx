import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { askQuestion } from "@/lib/rag.functions";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Send, FileText, User, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  component: ChatThread,
});

type Source = {
  n: number;
  filename: string;
  chunk_index: number;
  similarity: number;
  snippet: string;
};

type Message = {
  id: string;
  role: string;
  content: string;
  sources: Source[] | null;
  created_at: string;
};

function ChatThread() {
  const { threadId } = Route.useParams();
  const qc = useQueryClient();
  const ask = useServerFn(askQuestion);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: conv } = useQuery({
    queryKey: ["conversation", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title")
        .eq("id", threadId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, sources, created_at")
        .eq("conversation_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Message[];
    },
  });

  const send = useMutation({
    mutationFn: async (question: string) => {
      return ask({ data: { conversationId: threadId, question } });
    },
    onMutate: (question) => {
      setPending(question);
    },
    onSuccess: async () => {
      // If this is the first exchange, set title from question
      if ((messages?.length ?? 0) === 0 && pending) {
        await supabase
          .from("conversations")
          .update({ title: pending.slice(0, 60) })
          .eq("id", threadId);
        qc.invalidateQueries({ queryKey: ["conversations"] });
      }
      setPending(null);
      qc.invalidateQueries({ queryKey: ["messages", threadId] });
    },
    onError: (e) => {
      setPending(null);
      qc.invalidateQueries({ queryKey: ["messages", threadId] });
      toast.error(e.message);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId, send.isPending]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || send.isPending) return;
    setInput("");
    send.mutate(q);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="border-b px-6 py-3">
        <h2 className="text-sm font-medium truncate">{conv?.title ?? "Loading…"}</h2>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">
          {(messages ?? []).length === 0 && !pending && (
            <div className="text-center text-muted-foreground pt-16">
              <Sparkles className="h-10 w-10 mx-auto mb-3 text-primary/60" />
              <p className="text-sm">Ask a question about your uploaded documents.</p>
            </div>
          )}

          {(messages ?? []).map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {pending && (
            <>
              <MessageBubble
                message={{
                  id: "pending-user",
                  role: "user",
                  content: pending,
                  sources: null,
                  created_at: "",
                }}
              />
              <div className="flex gap-3">
                <Avatar role="assistant" />
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching your documents…
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="border-t p-4">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            placeholder="Ask anything about your documents…"
            rows={1}
            className="resize-none min-h-[52px] max-h-40"
            disabled={send.isPending}
          />
          <Button type="submit" size="icon" className="h-[52px] w-[52px]" disabled={send.isPending || !input.trim()}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Avatar({ role }: { role: string }) {
  return (
    <div
      className={cn(
        "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
        role === "user" ? "bg-secondary" : "bg-primary/20",
      )}
    >
      {role === "user" ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4 text-primary" />}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className="flex gap-3">
      <Avatar role={message.role} />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-xs text-muted-foreground">{isUser ? "You" : "Assistant"}</div>
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-muted">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.sources && message.sources.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Sources</div>
            <div className="grid gap-1.5">
              {message.sources.map((s) => (
                <div
                  key={s.n}
                  className="text-xs rounded-md border bg-card p-2.5 flex gap-2"
                >
                  <span className="text-primary font-semibold shrink-0">[{s.n}]</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 font-medium truncate">
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate">{s.filename}</span>
                      <span className="text-muted-foreground ml-auto shrink-0">
                        {(s.similarity * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 line-clamp-2">{s.snippet}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
