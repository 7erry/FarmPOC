/**
 * Atlas connection, time series collection, 2dsphere indexes, and search indexes.
 * Time series: https://www.mongodb.com/docs/manual/core/timeseries-collections/
 * 2dsphere: https://www.mongodb.com/docs/manual/core/indexes/index-types/geospatial/2dsphere/
 * Search indexes: https://www.mongodb.com/docs/drivers/node/current/fundamentals/indexes/#search-indexes
 * Vector Search: https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/
 */
import { MongoClient, type Collection, type Db, type Document } from "mongodb";

export const DB_NAME = "farmengage_poc";
export const WORKORDER_SEARCH_INDEX = "workorders_search";
export const NOTES_VECTOR_INDEX = "notes_vector";
export const EMBEDDING_DIMENSIONS = 1024;

const TELEMETRY = "telemetry";
const STANDARD_COLLECTIONS = [
  "organizations",
  "fields",
  "guidanceLines",
  "prescriptions",
  "vehicles",
  "devices",
  "workOrders",
  "fleetState",
  "syncJobs",
  "notes",
];

let client: MongoClient | undefined;

export function requireUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Set MONGODB_URI to the Atlas connection string");
  return uri;
}

export async function connect(): Promise<Db> {
  if (!client) client = new MongoClient(requireUri());
  await client.connect();
  return client.db(DB_NAME);
}

export async function close(): Promise<void> {
  if (!client) return;
  await client.close();
  client = undefined;
}

export async function ensureStorage(db: Db): Promise<void> {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name));
  for (const name of STANDARD_COLLECTIONS) {
    if (!names.has(name)) await db.createCollection(name);
  }
  if (!names.has(TELEMETRY)) {
    await db.createCollection(TELEMETRY, {
      timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
    });
  }

  await db.collection("fields").createIndex({ extent: "2dsphere" });
  await db.collection("guidanceLines").createIndex({ geometry: "2dsphere" });
  await db.collection("fleetState").createIndex({ location: "2dsphere" });
  await db.collection("fleetState").createIndex({ vehicleId: 1 }, { unique: true });
  await db.collection("workOrders").createIndex({ id: 1 }, { unique: true });
  await db.collection("syncJobs").createIndex({ id: 1 }, { unique: true });

  await ensureSearchIndex(
    db.collection("workOrders"),
    WORKORDER_SEARCH_INDEX,
    {
      mappings: {
        dynamic: false,
        fields: {
          name: { type: "string" },
          comments: { type: "string" },
          operationType: { type: "string" },
          materialName: { type: "string" },
          orgId: { type: "token" },
        },
      },
    },
  );

  await ensureSearchIndex(
    db.collection("notes"),
    NOTES_VECTOR_INDEX,
    {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: EMBEDDING_DIMENSIONS,
          similarity: "cosine",
        },
        { type: "filter", path: "orgId" },
      ],
    },
    "vectorSearch",
  );
}

function vectorDimensions(index: Document): number | undefined {
  const raw = index.latestDefinition ?? index.definition;
  if (typeof raw !== "object" || raw === null) return undefined;
  const fields = (raw as Document).fields;
  if (!Array.isArray(fields)) return undefined;
  for (const field of fields) {
    if (typeof field !== "object" || field === null) continue;
    const record = field as Document;
    if (record.type === "vector" && typeof record.numDimensions === "number") return record.numDimensions;
  }
  return undefined;
}

async function ensureSearchIndex(
  collection: Collection,
  name: string,
  definition: Document,
  type?: "vectorSearch",
): Promise<void> {
  const existing = await collection.listSearchIndexes(name).toArray();
  if (existing.length > 0) {
    if (type !== "vectorSearch" || vectorDimensions(existing[0]) === EMBEDDING_DIMENSIONS) return;
    await collection.dropSearchIndex(name);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const still = await collection.listSearchIndexes(name).toArray();
      if (still.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (type) {
    await collection.createSearchIndex({ name, type, definition });
    return;
  }
  await collection.createSearchIndex({ name, definition });
}

export async function dropTelemetry(db: Db): Promise<void> {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name));
  if (names.has(TELEMETRY)) await db.collection(TELEMETRY).drop();
}

export function indexIsReady(index: { status?: string; queryable?: boolean }): boolean {
  return index.queryable === true || index.status === "READY";
}

export function readIndexInfo(value: unknown): { status?: string; queryable?: boolean } {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  return {
    status: typeof record.status === "string" ? record.status : undefined,
    queryable: typeof record.queryable === "boolean" ? record.queryable : undefined,
  };
}
