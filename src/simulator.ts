/**
 * Writes one telemetry sample per vehicle each second and updates fleetState.
 * Inserts into a time series collection: https://www.mongodb.com/docs/manual/core/timeseries-collections/
 */
import type { Db } from "mongodb";
import { pointAtDistance, pointInRing } from "./geo.ts";
import { oemColor, type FieldDoc, type FleetStateDoc, type SyncJobDoc, type TelemetryDoc, type VehicleDoc, type WorkOrderDoc } from "./farmengage/types.ts";

const TICK_MS = 1000;

export function startSimulator(db: Db): () => void {
  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void advance(db)
      .catch((error: unknown) => {
        console.error("simulator tick failed", error);
      })
      .finally(() => {
        ticking = false;
      });
  }, TICK_MS);
  return () => clearInterval(timer);
}

async function advance(db: Db): Promise<void> {
  const vehicles = await db.collection<VehicleDoc>("vehicles").find({}).toArray();
  if (vehicles.length === 0) return;
  const fields = await db.collection<FieldDoc>("fields").find({}).toArray();
  const fleet = await db.collection<FleetStateDoc>("fleetState").find({}).toArray();
  const fleetByVehicle = new Map(fleet.map((row) => [row.vehicleId, row]));
  const jobs = await db
    .collection<SyncJobDoc>("syncJobs")
    .find({ apiStatus: "sent", cabStatus: { $in: ["pending", "acknowledged", "in_progress"] } })
    .sort({ createdAt: -1 })
    .toArray();
  const jobByVehicle = new Map<string, SyncJobDoc>();
  for (const job of jobs) {
    if (!jobByVehicle.has(job.vehicleId)) jobByVehicle.set(job.vehicleId, job);
  }
  const orderIds = [...new Set([...jobByVehicle.values()].map((job) => job.workOrderId))];
  const orders = await db.collection<WorkOrderDoc>("workOrders").find({ id: { $in: orderIds } }).toArray();
  const orderById = new Map(orders.map((order) => [order.id, order]));

  const now = new Date();
  const telemetry: TelemetryDoc[] = [];
  const fleetWrites: FleetStateDoc[] = [];

  for (const vehicle of vehicles) {
    const previous = fleetByVehicle.get(vehicle.id);
    const traveled = (vehicle.speedKph * 1000) / 3600;
    const routeOffsetMeters = (previous?.routeOffsetMeters ?? 0) + traveled;
    const pose = pointAtDistance(vehicle.route, routeOffsetMeters);
    const field = fields.find((candidate) => pointInRing(pose.point, candidate.extent.coordinates[0]));
    const job = jobByVehicle.get(vehicle.id);
    const order = job ? orderById.get(job.workOrderId) : undefined;
    let activeWorkOrderId: string | null = null;

    if (job && order) {
      const next = nextCab(job.cabStatus);
      let coveredFraction = order.coveredFraction;
      let status = order.status;
      if (next === "in_progress") {
        status = "InProgress";
        if (field?.id === order.fieldId) {
          coveredFraction = Math.min(1, coveredFraction + traveled / vehicle.routeLengthMeters);
          if (coveredFraction >= 1) status = "Done";
        }
      }
      const cabStatus = status === "Done" ? "done" : next;
      await db.collection<SyncJobDoc>("syncJobs").updateOne(
        { id: job.id },
        { $set: { cabStatus, statusUtc: now.toISOString() } },
      );
      await db.collection<WorkOrderDoc>("workOrders").updateOne(
        { id: order.id },
        { $set: { coveredFraction, status, modifiedAt: now.toISOString() } },
      );
      if (cabStatus !== "done") activeWorkOrderId = order.id;
    }

    const row: FleetStateDoc = {
      vehicleId: vehicle.id,
      orgId: vehicle.orgId,
      oem: vehicle.oem,
      name: vehicle.name,
      color: oemColor(vehicle.oem),
      location: { type: "Point", coordinates: pose.point },
      speedKph: vehicle.speedKph,
      headingDeg: pose.headingDeg,
      fieldId: field?.id ?? null,
      activeWorkOrderId,
      routeOffsetMeters,
      ts: now,
    };
    fleetWrites.push(row);
    telemetry.push({
      ts: now,
      meta: { orgId: vehicle.orgId, vehicleId: vehicle.id, oem: vehicle.oem },
      location: row.location,
      speedKph: row.speedKph,
      headingDeg: row.headingDeg,
      workOrderId: activeWorkOrderId,
    });
  }

  await db.collection<TelemetryDoc>("telemetry").insertMany(telemetry);
  await db.collection<FleetStateDoc>("fleetState").bulkWrite(
    fleetWrites.map((row) => ({
      updateOne: { filter: { vehicleId: row.vehicleId }, update: { $set: row }, upsert: true },
    })),
  );
}

function nextCab(status: SyncJobDoc["cabStatus"]): SyncJobDoc["cabStatus"] {
  switch (status) {
    case "pending":
      return "acknowledged";
    case "acknowledged":
      return "in_progress";
    case "in_progress":
      return "in_progress";
    case "done":
      return "done";
    case "canceled":
      return "canceled";
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}
