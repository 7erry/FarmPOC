/**
 * Loads the Ames demo farm, then waits until Atlas Search and Vector Search answer.
 * Atlas Search: https://www.mongodb.com/docs/atlas/atlas-search/atlas-search-overview/
 * Vector Search: https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/
 */
import assert from "node:assert/strict";
import { close, connect, dropTelemetry, ensureStorage } from "./db.ts";
import { embedText } from "./embed.ts";
import {
  FIELDS,
  GUIDANCE,
  NOTE_TEXTS,
  ORG_ID,
  ORG_NAME,
  PRESCRIPTION,
  SEEDED_SYNC_ID,
  SEEDED_WORK_ORDER_ID,
  VEHICLES,
} from "./fixtures.ts";
import { pointAtDistance, pointInRing } from "./geo.ts";
import { buildTaskDataXml } from "./isoxml.ts";
import type { DeviceDoc, FleetStateDoc, NoteDoc, TelemetryDoc, WorkOrderDoc } from "./farmengage/types.ts";
import { oemColor } from "./farmengage/types.ts";
import { searchWorkOrders, similarNotes } from "./queries.ts";

const HISTORY_SECONDS = 180;
const STEP_SECONDS = 5;
const START_OFFSETS = [0, 80, 40, 120];

async function seed(): Promise<void> {
  const db = await connect();
  await dropTelemetry(db);
  for (const name of [
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
  ]) {
    await db.collection(name).deleteMany({});
  }
  await ensureStorage(db);

  const now = new Date();
  const agco = VEHICLES[0];
  const workOrder: WorkOrderDoc = {
    id: SEEDED_WORK_ORDER_ID,
    orgId: ORG_ID,
    name: "Spray North 40",
    cropZoneId: FIELDS[0].cropZoneId,
    fieldId: FIELDS[0].id,
    fieldName: FIELDS[0].name,
    status: "InProgress",
    operationTypeId: 3,
    operationType: "Spray",
    materialName: "Glyphosate",
    comments: NOTE_TEXTS[0],
    plannedDateTime: now.toISOString(),
    dueDateTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    area: FIELDS[0].areaAcres,
    guidances: [{ guidanceId: GUIDANCE[0].id, fieldId: FIELDS[0].id }],
    vehicles: [{ vehicleId: agco.id, name: agco.name }],
    coveredFraction: 0.15,
    modifiedAt: now.toISOString(),
  };

  const telemetry: TelemetryDoc[] = [];
  const fleet: FleetStateDoc[] = [];
  for (const [index, vehicle] of VEHICLES.entries()) {
    const start = START_OFFSETS[index] ?? 0;
    const speedMps = (vehicle.speedKph * 1000) / 3600;
    for (let age = HISTORY_SECONDS; age >= 0; age -= STEP_SECONDS) {
      const pose = pointAtDistance(vehicle.route, start + speedMps * (HISTORY_SECONDS - age));
      telemetry.push({
        ts: new Date(now.getTime() - age * 1000),
        meta: { orgId: ORG_ID, vehicleId: vehicle.id, oem: vehicle.oem },
        location: { type: "Point", coordinates: pose.point },
        speedKph: vehicle.speedKph,
        headingDeg: pose.headingDeg,
        workOrderId: vehicle.id === agco.id ? workOrder.id : null,
      });
    }
    const finalPose = pointAtDistance(vehicle.route, start + speedMps * HISTORY_SECONDS);
    const field = FIELDS.find((candidate) => pointInRing(finalPose.point, candidate.extent.coordinates[0]));
    fleet.push({
      vehicleId: vehicle.id,
      orgId: ORG_ID,
      oem: vehicle.oem,
      name: vehicle.name,
      color: oemColor(vehicle.oem),
      location: { type: "Point", coordinates: finalPose.point },
      speedKph: vehicle.speedKph,
      headingDeg: finalPose.headingDeg,
      fieldId: field?.id ?? null,
      activeWorkOrderId: vehicle.id === agco.id ? workOrder.id : null,
      routeOffsetMeters: start + speedMps * HISTORY_SECONDS,
      ts: now,
    });
  }

  const devices: DeviceDoc[] = VEHICLES.map((vehicle) => {
    const device = vehicle.devices[0];
    return {
      id: device.deviceId,
      orgId: ORG_ID,
      serialNumber: device.serialNumber,
      type: "TaskDoc",
      model: device.displayName,
      vehicleId: vehicle.id,
      vehicle: vehicle.name,
    };
  });

  const notes: NoteDoc[] = [];
  for (const [index, text] of NOTE_TEXTS.entries()) {
    notes.push({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
      orgId: ORG_ID,
      text,
      workOrderId: index === 0 ? workOrder.id : null,
      embedding: await embedText(text),
    });
  }

  await db.collection("organizations").insertOne({
    id: ORG_ID,
    name: ORG_NAME,
    timezoneName: "America/Chicago",
    isMetric: false,
  });
  await db.collection("fields").insertMany(FIELDS);
  await db.collection("guidanceLines").insertMany(GUIDANCE);
  await db.collection("prescriptions").insertOne(PRESCRIPTION);
  await db.collection("vehicles").insertMany(VEHICLES);
  await db.collection("devices").insertMany(devices);
  await db.collection("workOrders").insertOne(workOrder);
  await db.collection("fleetState").insertMany(fleet);
  await db.collection("syncJobs").insertOne({
    id: SEEDED_SYNC_ID,
    orgId: ORG_ID,
    workOrderId: workOrder.id,
    vehicleId: agco.id,
    deviceId: agco.devices[0].deviceId,
    apiStatus: "sent",
    cabStatus: "in_progress",
    isoXml: buildTaskDataXml({
      taskName: workOrder.name,
      fieldName: workOrder.fieldName,
      vehicleName: agco.name,
      operationType: workOrder.operationType,
    }),
    statusUtc: now.toISOString(),
    createdAt: now.toISOString(),
  });
  await db.collection("notes").insertMany(notes);
  await db.collection("telemetry").insertMany(telemetry);

  const northCount = await db.collection("fleetState").countDocuments({
    location: { $geoWithin: { $geometry: FIELDS[0].extent } },
  });
  const southCount = await db.collection("fleetState").countDocuments({
    location: { $geoWithin: { $geometry: FIELDS[1].extent } },
  });
  assert.ok(northCount >= 2, `expected machines in North 40, got ${northCount}`);
  assert.ok(southCount >= 2, `expected machines in South Field, got ${southCount}`);
  assert.ok(telemetry.length > 100, "expected seeded telemetry");
  console.log(`geoWithin North 40=${northCount} South Field=${southCount} telemetry=${telemetry.length}`);

  await waitFor("Atlas Search", async () => (await searchWorkOrders(db, "spray")).length > 0);
  await waitFor("Vector Search", async () => (await similarNotes(db, "variable rate spray on the north field")).length > 0);
  console.log("seed complete");
}

async function waitFor(label: string, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      if (await probe()) {
        console.log(`${label} ready`);
        return;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError) {
        console.log(`${label}: ${message}`);
        lastError = message;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${label} was not queryable within 3 minutes`);
}

try {
  await seed();
} finally {
  await close();
}
