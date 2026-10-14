/**
 * Writes telemetry samples and updates fleetState.
 * Inserts into a time series collection: https://www.mongodb.com/docs/manual/core/timeseries-collections/
 */
import type { Db } from "mongodb";
import { pointAtDistance, pointInRing } from "./geo.ts";
import { oemColor, type AnomalyType, type FieldDoc, type FleetStateDoc, type SyncJobDoc, type TelemetryDoc, type VehicleDoc, type WorkOrderDoc } from "./farmengage/types.ts";

export const MIN_INTERVAL_MS = 500;
export const MAX_INTERVAL_MS = 5000;
const DEFAULT_INTERVAL_MS = 1000;

export type SimulatorStatus = {
  isRunning: boolean;
  intervalMs: number;
  activeMachines: number;
  totalEmitted: number;
  eventsPerSec: number;
};

export type SimulatorController = {
  start: () => void;
  stop: () => void;
  setIntervalMs: (intervalMs: number) => void;
  status: () => SimulatorStatus;
  inject: (type: AnomalyType, vehicleId: string) => Promise<void>;
};

export class UnknownVehicleError extends Error {
  constructor() {
    super("Unknown vehicle");
    this.name = "UnknownVehicleError";
  }
}

export function clampIntervalMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(value)));
}

/** Speed and whether the machine moves for one injected or normal sample. */
export function anomalySample(speedKph: number, type: AnomalyType): { speedKph: number; advance: boolean } {
  switch (type) {
    case "DEVICE_FAILURE":
    case "FREEZE_EVENT":
      return { speedKph: 0, advance: false };
    case "SPEED_SPIKE":
      return { speedKph: speedKph * 3, advance: true };
    default: {
      const unexpected: never = type;
      return unexpected;
    }
  }
}

function metersThisTick(speedKph: number, intervalMs: number): number {
  return ((speedKph * 1000) / 3600) * (intervalMs / 1000);
}

type TickResult = { emitted: number; machines?: number };

async function advance(db: Db, intervalMs: number, inject?: { vehicleId: string; type: AnomalyType }): Promise<TickResult> {
  const vehicles = await db.collection<VehicleDoc>("vehicles").find(inject ? { id: inject.vehicleId } : {}).toArray();
  if (inject && vehicles.length === 0) throw new UnknownVehicleError();
  if (vehicles.length === 0) return { emitted: 0, machines: 0 };

  const fields = await db.collection<FieldDoc>("fields").find({}).toArray();
  const fleet = await db.collection<FleetStateDoc>("fleetState").find({}).toArray();
  const fleetByVehicle = new Map(fleet.map((row) => [row.vehicleId, row]));
  const jobs = inject
    ? []
    : await db
        .collection<SyncJobDoc>("syncJobs")
        .find({ apiStatus: "sent", cabStatus: { $in: ["pending", "acknowledged", "in_progress"] } })
        .sort({ createdAt: -1 })
        .toArray();
  const jobByVehicle = new Map<string, SyncJobDoc>();
  for (const job of jobs) {
    if (!jobByVehicle.has(job.vehicleId)) jobByVehicle.set(job.vehicleId, job);
  }
  const orderIds = [...new Set([...jobByVehicle.values()].map((job) => job.workOrderId))];
  const orders = orderIds.length === 0 ? [] : await db.collection<WorkOrderDoc>("workOrders").find({ id: { $in: orderIds } }).toArray();
  const orderById = new Map(orders.map((order) => [order.id, order]));

  const now = new Date();
  const telemetry: TelemetryDoc[] = [];
  const fleetWrites: FleetStateDoc[] = [];

  for (const vehicle of vehicles) {
    const previous = fleetByVehicle.get(vehicle.id);
    const effect = inject ? anomalySample(vehicle.speedKph, inject.type) : { speedKph: vehicle.speedKph, advance: true };
    const traveled = effect.advance ? metersThisTick(effect.speedKph, intervalMs) : 0;
    const routeOffsetMeters = (previous?.routeOffsetMeters ?? 0) + traveled;
    const pose = pointAtDistance(vehicle.route, routeOffsetMeters);
    const field = fields.find((candidate) => pointInRing(pose.point, candidate.extent.coordinates[0]));
    const job = jobByVehicle.get(vehicle.id);
    const order = job ? orderById.get(job.workOrderId) : undefined;
    let activeWorkOrderId: string | null = inject ? (previous?.activeWorkOrderId ?? null) : null;

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
      activeWorkOrderId = cabStatus === "done" ? null : order.id;
    }

    const row: FleetStateDoc = {
      vehicleId: vehicle.id,
      orgId: vehicle.orgId,
      oem: vehicle.oem,
      name: vehicle.name,
      color: oemColor(vehicle.oem),
      location: { type: "Point", coordinates: pose.point },
      speedKph: effect.speedKph,
      headingDeg: pose.headingDeg,
      fieldId: field?.id ?? null,
      activeWorkOrderId,
      routeOffsetMeters,
      ts: now,
    };
    fleetWrites.push(row);
    const sample: TelemetryDoc = {
      ts: now,
      meta: { orgId: vehicle.orgId, vehicleId: vehicle.id, oem: vehicle.oem },
      location: row.location,
      speedKph: row.speedKph,
      headingDeg: row.headingDeg,
      workOrderId: activeWorkOrderId,
    };
    if (inject) sample.anomaly = inject.type;
    telemetry.push(sample);
  }

  await db.collection<TelemetryDoc>("telemetry").insertMany(telemetry);
  await db.collection<FleetStateDoc>("fleetState").bulkWrite(
    fleetWrites.map((row) => ({
      updateOne: { filter: { vehicleId: row.vehicleId }, update: { $set: row }, upsert: true },
    })),
  );
  return inject ? { emitted: telemetry.length } : { emitted: telemetry.length, machines: vehicles.length };
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

export function startSimulator(db: Db): SimulatorController {
  let intervalMs = DEFAULT_INTERVAL_MS;
  let running = false;
  let ticking = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let totalEmitted = 0;
  let activeMachines = 0;
  const recent: number[] = [];

  function noteEmitted(count: number): void {
    const now = Date.now();
    for (let i = 0; i < count; i += 1) recent.push(now);
    totalEmitted += count;
    prune(now);
  }

  function prune(now: number): void {
    while (recent.length > 0 && now - recent[0] >= 1000) recent.shift();
  }

  function schedule(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (!running) return;
    timer = setInterval(() => {
      if (ticking) return;
      ticking = true;
      void advance(db, intervalMs)
        .then((result) => {
          noteEmitted(result.emitted);
          if (result.machines !== undefined) activeMachines = result.machines;
        })
        .catch((error: unknown) => {
          console.error("simulator tick failed", error);
        })
        .finally(() => {
          ticking = false;
        });
    }, intervalMs);
  }

  const controller: SimulatorController = {
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    setIntervalMs(value: number) {
      intervalMs = clampIntervalMs(value);
      schedule();
    },
    status() {
      prune(Date.now());
      return { isRunning: running, intervalMs, activeMachines, totalEmitted, eventsPerSec: recent.length };
    },
    async inject(type: AnomalyType, vehicleId: string) {
      const result = await advance(db, intervalMs, { vehicleId, type });
      noteEmitted(result.emitted);
    },
  };
  controller.start();
  return controller;
}
