/**
 * Local 384-d embeddings stored on notes for Vector Search.
 * https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/
 */
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { EMBEDDING_DIMENSIONS } from "./db.ts";

env.cacheDir = path.join(process.cwd(), ".cache", "transformers");

type EmbeddingOutput = { tolist: () => unknown };
type Extractor = (text: string, options: { pooling: "mean"; normalize: true }) => Promise<EmbeddingOutput>;

let extractorPromise: Promise<Extractor> | undefined;

function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    const created = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
    extractorPromise = Promise.resolve(created).then((extractor) => extractor as Extractor);
  }
  return extractorPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Cannot embed empty text");
  const output = await (await getExtractor())(trimmed, { pooling: "mean", normalize: true });
  const listed: unknown = output.tolist();
  const vector = Array.isArray(listed) && Array.isArray(listed[0]) ? listed[0] : listed;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    const length = Array.isArray(vector) ? vector.length : 0;
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-d embedding, got ${length}`);
  }
  return vector.map((value: unknown) => {
    if (typeof value !== "number" || Number.isNaN(value)) throw new Error("Embedding contained a non-number");
    return value;
  });
}
