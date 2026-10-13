/**
 * Keyword search uses $search. Similar-work search uses $vectorSearch.
 * $search: https://www.mongodb.com/docs/atlas/atlas-search/query-syntax/
 * $vectorSearch: https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/
 */
import type { Db } from "mongodb";
import { NOTES_VECTOR_INDEX, WORKORDER_SEARCH_INDEX } from "./db.ts";
import { embedText } from "./embed.ts";
import { ORG_ID } from "./fixtures.ts";
import type { WorkOrderDoc } from "./farmengage/types.ts";

export async function searchWorkOrders(db: Db, query: string): Promise<Record<string, unknown>[]> {
  return db
    .collection<WorkOrderDoc>("workOrders")
    .aggregate<Record<string, unknown>>([
      {
        $search: {
          index: WORKORDER_SEARCH_INDEX,
          compound: {
            filter: [{ equals: { path: "orgId", value: ORG_ID } }],
            must: [
              {
                text: {
                  query,
                  path: ["name", "comments", "operationType", "materialName"],
                },
              },
            ],
          },
        },
      },
      { $limit: 8 },
      {
        $project: {
          _id: 0,
          name: 1,
          comments: 1,
          operationType: 1,
          materialName: 1,
          fieldName: 1,
          score: { $meta: "searchScore" },
        },
      },
    ])
    .toArray();
}

export async function similarNotes(db: Db, query: string): Promise<Record<string, unknown>[]> {
  const queryVector = await embedText(query, "query");
  return db
    .collection("notes")
    .aggregate<Record<string, unknown>>([
      {
        $vectorSearch: {
          index: NOTES_VECTOR_INDEX,
          path: "embedding",
          queryVector,
          numCandidates: 40,
          limit: 5,
          filter: { orgId: ORG_ID },
        },
      },
      {
        $project: {
          _id: 0,
          text: 1,
          workOrderId: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();
}
