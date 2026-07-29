import fs from "fs/promises";
import mammoth from "mammoth";
// pdf-parse has no types that play nicely with ESM default-import interop,
// so require() it directly rather than fighting the compiler.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse");

const MAX_CHARS = Number(process.env.DOCUMENT_TEXT_MAX_CHARS) || 300_000;

const EXTRACTABLE_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);

export function isExtractable(mimeType: string): boolean {
  return EXTRACTABLE_MIME_TYPES.has(mimeType);
}

/**
 * Extract plain text from an uploaded file so it can be chunked + embedded
 * for retrieval-augmented Q&A. Returns "" for file types we don't (yet)
 * know how to extract from (e.g. audio recordings) rather than throwing --
 * callers should check isExtractable() first if they need to distinguish
 * "unsupported type" from "extraction produced nothing".
 */
export async function extractText(filePath: string, mimeType: string): Promise<string> {
  let text = "";

  if (mimeType === "application/pdf") {
    const buffer = await fs.readFile(filePath);
    const result = await pdfParse(buffer);
    text = result.text || "";
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else if (mimeType === "text/plain" || mimeType === "text/markdown") {
    text = await fs.readFile(filePath, "utf-8");
  } else {
    return "";
  }

  text = text.trim();
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
  }
  return text;
}
