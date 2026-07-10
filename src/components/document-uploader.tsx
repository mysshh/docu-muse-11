import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { supabase } from "@/integrations/supabase/client";
import { extractText, chunkText } from "@/lib/extract-text";
import { ingestDocumentChunks } from "@/lib/rag.functions";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UploadCloud, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type UploadState = { name: string; status: string };

export function DocumentUploader({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const ingest = useServerFn(ingestDocumentChunks);
  const [uploading, setUploading] = useState<UploadState[]>([]);

  const onDrop = useCallback(
    async (files: File[]) => {
      const initial = files.map((f) => ({ name: f.name, status: "Uploading…" }));
      setUploading((s) => [...s, ...initial]);

      for (const file of files) {
        try {
          if (file.size > 20 * 1024 * 1024) throw new Error("File exceeds 20MB");
          const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
          if (!["pdf", "docx", "txt"].includes(ext)) throw new Error("Only PDF, DOCX, TXT");

          const path = `${userId}/${crypto.randomUUID()}-${file.name}`;
          const { error: upErr } = await supabase.storage
            .from("documents")
            .upload(path, file, { upsert: false });
          if (upErr) throw upErr;

          setUploading((s) =>
            s.map((u) => (u.name === file.name ? { ...u, status: "Extracting text…" } : u)),
          );

          const { data: doc, error: docErr } = await supabase
            .from("documents")
            .insert({
              user_id: userId,
              filename: file.name,
              storage_path: path,
              file_type: ext,
              file_size: file.size,
              status: "processing",
            })
            .select()
            .single();
          if (docErr) throw docErr;

          const text = await extractText(file);
          const chunks = chunkText(text);
          if (chunks.length === 0) throw new Error("No text found in document");

          setUploading((s) =>
            s.map((u) =>
              u.name === file.name
                ? { ...u, status: `Embedding ${chunks.length} chunks…` }
                : u,
            ),
          );

          await ingest({ data: { documentId: doc.id, chunks } });

          setUploading((s) => s.filter((u) => u.name !== file.name));
          qc.invalidateQueries({ queryKey: ["documents"] });
          toast.success(`${file.name} ready`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setUploading((s) =>
            s.map((u) => (u.name === file.name ? { ...u, status: `Failed: ${msg}` } : u)),
          );
          toast.error(`${file.name}: ${msg}`);
          setTimeout(() => {
            setUploading((s) => s.filter((u) => u.name !== file.name));
          }, 5000);
        }
      }
    },
    [userId, qc, ingest],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
    },
    multiple: true,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition",
          "bg-card hover:border-primary/50",
          isDragActive && "border-primary bg-primary/5",
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="font-medium">
          {isDragActive ? "Drop files here" : "Drop files or click to upload"}
        </p>
        <p className="text-sm text-muted-foreground mt-1">PDF, DOCX, TXT — up to 20MB each</p>
      </div>

      {uploading.length > 0 && (
        <div className="space-y-2">
          {uploading.map((u, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm"
            >
              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              <span className="truncate flex-1">{u.name}</span>
              <span className="text-muted-foreground text-xs">{u.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
