// Client-side text extraction for PDF, DOCX, TXT.
import mammoth from "mammoth";

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt") || file.type === "text/plain") {
    return await file.text();
  }
  if (name.endsWith(".docx") || file.type.includes("word")) {
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return value;
  }
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return await extractPdf(file);
  }
  throw new Error("Unsupported file type. Use PDF, DOCX, or TXT.");
}

async function extractPdf(file: File): Promise<string> {
  // Dynamic import so pdfjs only loads in the browser.
  const pdfjs = await import("pdfjs-dist");
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    parts.push(text);
  }
  return parts.join("\n\n");
}

// Simple chunker: split by paragraphs then pack into ~1000 char windows with overlap.
export function chunkText(text: string, targetSize = 1000, overlap = 150): string[] {
  const clean = text.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n\s*\n/);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length > targetSize && buf.length > 0) {
      chunks.push(buf.trim());
      // seed next buffer with tail overlap
      buf = buf.length > overlap ? buf.slice(-overlap) + "\n\n" + p : p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());

  // If a single paragraph is huge, hard-split it.
  const final: string[] = [];
  for (const c of chunks) {
    if (c.length <= targetSize * 1.5) {
      final.push(c);
    } else {
      for (let i = 0; i < c.length; i += targetSize - overlap) {
        final.push(c.slice(i, i + targetSize));
      }
    }
  }
  return final.filter((s) => s.trim().length > 0);
}
