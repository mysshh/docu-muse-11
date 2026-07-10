import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { DocumentUploader } from "@/components/document-uploader";
import { deleteDocument } from "@/lib/rag.functions";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Trash2, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/documents")({
  component: DocumentsPage,
});

function DocumentsPage() {
  const qc = useQueryClient();
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: docs, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => {
      const rows = q.state.data as { status: string }[] | undefined;
      return rows?.some((d) => d.status === "processing" || d.status === "pending") ? 2500 : false;
    },
  });

  const del = useServerFn(deleteDocument);
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { documentId: id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AppShell>
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
            <p className="text-muted-foreground mt-1">
              Upload files to build your knowledge base. Chunks are embedded and searchable
              instantly.
            </p>
          </div>

          {user && <DocumentUploader userId={user.id} />}

          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Your library
            </h2>
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && (docs ?? []).length === 0 && (
              <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
                No documents yet. Upload one above to get started.
              </div>
            )}
            <div className="space-y-2">
              {(docs ?? []).map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
                >
                  <FileText className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.filename}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span className="uppercase">{d.file_type}</span>
                      <span>•</span>
                      <span>{formatBytes(d.file_size)}</span>
                      <span>•</span>
                      <span>{formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}</span>
                      {d.chunk_count > 0 && (
                        <>
                          <span>•</span>
                          <span>{d.chunk_count} chunks</span>
                        </>
                      )}
                    </div>
                    {d.error_message && (
                      <div className="text-xs text-destructive mt-1">{d.error_message}</div>
                    )}
                  </div>
                  <StatusBadge status={d.status} />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm(`Delete ${d.filename}?`)) delMut.mutate(d.id);
                    }}
                    disabled={delMut.isPending}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ready")
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Ready
      </Badge>
    );
  if (status === "error")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircle className="h-3 w-3" /> Error
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Processing
    </Badge>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
