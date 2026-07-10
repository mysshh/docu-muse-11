import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const EMBED_MODEL = "openai/text-embedding-3-small";
const CHAT_MODEL = "openai/gpt-5-mini"; // supported equivalent for gpt-4o-mini

function apiKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  return key;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${GATEWAY}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Rate limit — try again shortly");
    if (res.status === 402) throw new Error("AI credits exhausted — add credits in workspace billing");
    throw new Error(`Embedding failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

// Ingest a document: embed all chunks and store them.
const IngestSchema = z.object({
  documentId: z.string().uuid(),
  chunks: z.array(z.string().min(1)).min(1).max(500),
});

export const ingestDocumentChunks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => IngestSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify document ownership
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id, user_id")
      .eq("id", data.documentId)
      .single();
    if (docErr || !doc) throw new Error("Document not found");

    await supabase.from("documents").update({ status: "processing" }).eq("id", data.documentId);

    try {
      // Embed in batches of 64
      const BATCH = 64;
      const rows: {
        document_id: string;
        user_id: string;
        chunk_index: number;
        content: string;
        embedding: string;
      }[] = [];
      for (let i = 0; i < data.chunks.length; i += BATCH) {
        const slice = data.chunks.slice(i, i + BATCH);
        const embs = await embedBatch(slice);
        embs.forEach((emb, j) => {
          rows.push({
            document_id: data.documentId,
            user_id: userId,
            chunk_index: i + j,
            content: slice[j],
            embedding: `[${emb.join(",")}]`,
          });
        });
      }

      // Insert chunks in batches of 100
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from("document_chunks").insert(rows.slice(i, i + 100));
        if (error) throw new Error(error.message);
      }

      await supabase
        .from("documents")
        .update({ status: "ready", chunk_count: rows.length, error_message: null })
        .eq("id", data.documentId);

      return { ok: true, chunks: rows.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("documents")
        .update({ status: "error", error_message: msg })
        .eq("id", data.documentId);
      throw e;
    }
  });

const AskSchema = z.object({
  conversationId: z.string().uuid(),
  question: z.string().min(1).max(2000),
});

export const askQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AskSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Save user message
    const { error: umErr } = await supabase.from("messages").insert({
      conversation_id: data.conversationId,
      user_id: userId,
      role: "user",
      content: data.question,
    });
    if (umErr) throw new Error(umErr.message);

    // Embed question
    const [qEmb] = await embedBatch([data.question]);

    // Retrieve top 5
    const { data: matches, error: mErr } = await supabase.rpc("match_document_chunks", {
      query_embedding: `[${qEmb.join(",")}]` as unknown as string,
      match_count: 5,
      filter_user_id: userId,
    });
    if (mErr) throw new Error(mErr.message);

    const chunks = (matches ?? []) as {
      id: string;
      document_id: string;
      content: string;
      chunk_index: number;
      similarity: number;
    }[];

    // Fetch document names
    const docIds = Array.from(new Set(chunks.map((c) => c.document_id)));
    const { data: docs } = await supabase
      .from("documents")
      .select("id, filename")
      .in("id", docIds.length ? docIds : ["00000000-0000-0000-0000-000000000000"]);
    const docMap = new Map((docs ?? []).map((d) => [d.id, d.filename]));

    const sources = chunks.map((c, i) => ({
      n: i + 1,
      chunk_id: c.id,
      document_id: c.document_id,
      filename: docMap.get(c.document_id) ?? "Unknown",
      chunk_index: c.chunk_index,
      similarity: c.similarity,
      snippet: c.content.slice(0, 240),
    }));

    // Load recent history (last 10)
    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(20);

    const contextBlock =
      sources.length === 0
        ? "No document context available. Tell the user no relevant information was found in their documents."
        : sources
            .map((s) => `[${s.n}] (${s.filename}, chunk ${s.chunk_index})\n${chunks[s.n - 1].content}`)
            .join("\n\n---\n\n");

    const systemPrompt = `You are a document Q&A assistant. Answer the user's question using ONLY the provided context from their documents. Cite sources inline using [1], [2], etc. matching the numbered sources. If the answer isn't in the context, say so honestly. Be concise and accurate.

CONTEXT:
${contextBlock}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...((history ?? []).slice(0, -1).map((m) => ({ role: m.role, content: m.content }))),
      { role: "user", content: data.question },
    ];

    const chatRes = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({ model: CHAT_MODEL, messages }),
    });

    if (!chatRes.ok) {
      const t = await chatRes.text();
      if (chatRes.status === 429) throw new Error("Rate limit — try again shortly");
      if (chatRes.status === 402) throw new Error("AI credits exhausted");
      throw new Error(`Chat failed: ${chatRes.status} ${t}`);
    }
    const chatJson = (await chatRes.json()) as {
      choices: { message: { content: string } }[];
    };
    const answer = chatJson.choices[0]?.message?.content ?? "(no answer)";

    // Save assistant message
    const { data: assistantMsg, error: aErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        user_id: userId,
        role: "assistant",
        content: answer,
        sources,
      })
      .select()
      .single();
    if (aErr) throw new Error(aErr.message);

    // Bump conversation
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.conversationId);

    return { answer, sources, messageId: assistantMsg.id };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: doc } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", data.documentId)
      .single();
    if (doc?.storage_path) {
      await supabase.storage.from("documents").remove([doc.storage_path]);
    }
    const { error } = await supabase.from("documents").delete().eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
