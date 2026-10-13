import assert from "node:assert/strict";
import { EMBEDDING_DIMENSIONS } from "./db.ts";
import { EMBEDDING_MODEL, embedText } from "./embed.ts";

process.env.VOYAGE_API_KEY = "test-key";
const originalFetch = globalThis.fetch;

globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { model: string; input_type: string; output_dimension: number };
  assert.equal(body.model, EMBEDDING_MODEL);
  assert.equal(body.input_type, "query");
  assert.equal(body.output_dimension, EMBEDDING_DIMENSIONS);
  const headers = new Headers(init?.headers);
  assert.equal(headers.get("authorization"), "Bearer test-key");
  return Response.json({ data: [{ embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01) }] });
};

const vector = await embedText("variable rate spray", "query");
assert.equal(vector.length, EMBEDDING_DIMENSIONS);

globalThis.fetch = async () => Response.json({ detail: "nope" }, { status: 401 });
await assert.rejects(() => embedText("spray", "document"), /Voyage embeddings failed \(401\): nope/);

delete process.env.VOYAGE_API_KEY;
await assert.rejects(() => embedText("spray", "document"), /VOYAGE_API_KEY/);

globalThis.fetch = originalFetch;
