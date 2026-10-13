/**
 * Voyage text embeddings for notes, via the Atlas Embedding and Reranking API.
 * https://www.mongodb.com/docs/api/doc/atlas-embedding-and-reranking-api/operation/operation-createembedding
 */
import { EMBEDDING_DIMENSIONS } from "./db.ts";

const EMBEDDING_URL = "https://ai.mongodb.com/v1/embeddings";
export const EMBEDDING_MODEL = "voyage-4";

export type EmbeddingInputType = "document" | "query";

function requireModelKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("Set VOYAGE_API_KEY to an Atlas model API key");
  return key;
}

function readVector(payload: unknown): number[] {
  if (typeof payload !== "object" || payload === null) throw new Error("Voyage embeddings returned an empty body");
  const data = (payload as { data?: unknown }).data;
  const first = Array.isArray(data) ? data[0] : undefined;
  const embedding = typeof first === "object" && first !== null ? (first as { embedding?: unknown }).embedding : undefined;
  if (!Array.isArray(embedding)) throw new Error("Voyage embeddings response had no vector");
  return embedding.map((value: unknown) => {
    if (typeof value !== "number" || Number.isNaN(value)) throw new Error("Embedding contained a non-number");
    return value;
  });
}

function readDetail(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const detail = (payload as { detail?: unknown }).detail;
  return typeof detail === "string" ? detail : "";
}

export async function embedText(text: string, inputType: EmbeddingInputType): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Cannot embed empty text");
  const response = await fetch(EMBEDDING_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${requireModelKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: [trimmed],
      model: EMBEDDING_MODEL,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMENSIONS,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = readDetail(payload);
    throw new Error(`Voyage embeddings failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const vector = readVector(payload);
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-d embedding, got ${vector.length}`);
  }
  return vector;
}
