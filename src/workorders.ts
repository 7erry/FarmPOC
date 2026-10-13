/**
 * Creates a work order and records a TaskDoc-style send in syncJobs.
 * Documents are ordinary MongoDB inserts: https://www.mongodb.com/docs/drivers/node/current/
 */
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { embedText } from "./embed.ts";
import { OPERATIONS, ORG_ID } from "./fixtures.ts";
import { buildTaskDataXml } from "./isoxml.ts";
import type { FieldDoc, GuidanceDoc, SyncJobDoc, VehicleDoc, WorkOrderDoc } from "./farmengage/types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(source: Record<string, unknown>, field: string, max: number): string {
  const value = source[field];
  if (typeof value !== "string") throw new HttpError(`${field} is required`, 400);
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(`${field} is required`, 400);
  if (trimmed.length > max) throw new HttpError(`${field} is too long`, 400);
  return trimmed;
}

function optionalString(source: Record<string, unknown>, field: string, max: number): string {
  const value = source[field];
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new HttpError(`${field} must be a string`, 400);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(`${field} is too long`, 400);
  return trimmed;
}

export async function createWorkOrder(db: Db, body: unknown): Promise<WorkOrderDoc> {
  if (!isRecord(body)) throw new HttpError("Expected a JSON object", 400);
  const name = requiredString(body, "name", 80);
  const fieldId = requiredString(body, "fieldId", 40);
  const operationType = requiredString(body, "operationType", 40);
  const guidanceId = optionalString(body, "guidanceId", 40);
  const materialName = optionalString(body, "materialName", 80);
  const comments = optionalString(body, "comments", 500);
  if (!UUID.test(fieldId)) throw new HttpError("fieldId is not a UUID", 400);

  const operation = OPERATIONS.find((entry) => entry.name === operationType);
  if (!operation) throw new HttpError("operationType must be Plant, Fertilize, Spray, or Harvest", 400);

  const field = await db.collection<FieldDoc>("fields").findOne({ id: fieldId, orgId: ORG_ID });
  if (!field) throw new HttpError("Field not found", 404);

  const guidances: WorkOrderDoc["guidances"] = [];
  if (guidanceId) {
    if (!UUID.test(guidanceId)) throw new HttpError("guidanceId is not a UUID", 400);
    const guidance = await db.collection<GuidanceDoc>("guidanceLines").findOne({ id: guidanceId, fieldId });
    if (!guidance) throw new HttpError("Guidance line is not on that field", 400);
    guidances.push({ guidanceId, fieldId });
  }

  const now = new Date();
  const due = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const workOrder: WorkOrderDoc = {
    id: randomUUID(),
    orgId: ORG_ID,
    name,
    cropZoneId: field.cropZoneId,
    fieldId: field.id,
    fieldName: field.name,
    status: "Planned",
    operationTypeId: operation.id,
    operationType: operation.name,
    materialName,
    comments,
    plannedDateTime: now.toISOString(),
    dueDateTime: due.toISOString(),
    area: field.areaAcres,
    guidances,
    vehicles: [],
    coveredFraction: 0,
    modifiedAt: now.toISOString(),
  };
  await db.collection<WorkOrderDoc>("workOrders").insertOne(workOrder);
  if (comments) await insertNote(db, comments, workOrder.id);
  return workOrder;
}

export async function sendWorkOrder(db: Db, workOrderId: string, body: unknown): Promise<SyncJobDoc> {
  if (!UUID.test(workOrderId)) throw new HttpError("workOrderId is not a UUID", 400);
  if (!isRecord(body)) throw new HttpError("Expected a JSON object", 400);
  const vehicleId = requiredString(body, "vehicleId", 40);
  if (!UUID.test(vehicleId)) throw new HttpError("vehicleId is not a UUID", 400);

  const workOrder = await db.collection<WorkOrderDoc>("workOrders").findOne({ id: workOrderId, orgId: ORG_ID });
  if (!workOrder) throw new HttpError("Work order not found", 404);
  const vehicle = await db.collection<VehicleDoc>("vehicles").findOne({ id: vehicleId, orgId: ORG_ID });
  if (!vehicle) throw new HttpError("Vehicle not found", 404);
  const device = vehicle.devices.find((entry) => entry.isTaskDoc);
  if (!device) throw new HttpError("Vehicle has no TaskDoc device", 400);

  const now = new Date().toISOString();
  const job: SyncJobDoc = {
    id: randomUUID(),
    orgId: ORG_ID,
    workOrderId,
    vehicleId,
    deviceId: device.deviceId,
    apiStatus: "sent",
    cabStatus: "pending",
    isoXml: buildTaskDataXml({
      taskName: workOrder.name,
      fieldName: workOrder.fieldName,
      vehicleName: vehicle.name,
      operationType: workOrder.operationType,
    }),
    statusUtc: now,
    createdAt: now,
  };

  await db.collection<SyncJobDoc>("syncJobs").updateMany(
    { vehicleId, cabStatus: { $in: ["pending", "acknowledged", "in_progress"] } },
    { $set: { apiStatus: "canceled", cabStatus: "canceled", statusUtc: now } },
  );
  await db.collection<SyncJobDoc>("syncJobs").insertOne(job);
  await db.collection<WorkOrderDoc>("workOrders").updateOne(
    { id: workOrderId },
    {
      $set: {
        vehicles: [{ vehicleId: vehicle.id, name: vehicle.name }],
        status: workOrder.status === "Done" ? "Planned" : workOrder.status,
        coveredFraction: workOrder.status === "Done" ? 0 : workOrder.coveredFraction,
        modifiedAt: now,
      },
    },
  );
  return job;
}

async function insertNote(db: Db, text: string, workOrderId: string): Promise<void> {
  await db.collection("notes").insertOne({
    id: randomUUID(),
    orgId: ORG_ID,
    text,
    workOrderId,
    embedding: await embedText(text, "document"),
  });
}
