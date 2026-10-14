/**
 * HTTP API and the map page. Machine-in-field counts use $geoWithin.
 * $geoWithin: https://www.mongodb.com/docs/manual/reference/operator/query/geoWithin/
 * Node driver: https://www.mongodb.com/docs/drivers/node/current/
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { close, connect, indexIsReady, readIndexInfo } from "./db.ts";
import { NOTES_VECTOR_INDEX, WORKORDER_SEARCH_INDEX } from "./db.ts";
import { OPERATIONS, ORG_ID, ORG_NAME } from "./fixtures.ts";
import { ANOMALY_TYPES, type AnomalyType, type FieldDoc, type FleetStateDoc, type GuidanceDoc, type PrescriptionDoc, type SyncJobDoc, type TelemetryDoc, type VehicleDoc, type WorkOrderDoc } from "./farmengage/types.ts";
import { searchWorkOrders, similarNotes } from "./queries.ts";
import { startSimulator, UnknownVehicleError, type SimulatorController } from "./simulator.ts";
import { HttpError, createWorkOrder, sendWorkOrder } from "./workorders.ts";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const ROOT = path.join(PUBLIC_DIR, "..");
const ZIP_ENTRIES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  "CURSOR_PROMPT.md",
  ".env.example",
  ".gitignore",
  "src",
  "public/index.html",
  "public/app.js",
];
const FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/icons/john-deere-8r.png": { file: "icons/john-deere-8r.png", type: "image/png" },
  "/icons/agco-rogator.png": { file: "icons/agco-rogator.png", type: "image/png" },
  "/icons/raven-rcm.png": { file: "icons/raven-rcm.png", type: "image/png" },
  "/icons/trimble-gfx.png": { file: "icons/trimble-gfx.png", type: "image/png" },
};
const ARCHITECTURE_RELATIVE = ".archify/architecture-farmengage-poc-20261014-103734/farmengage-poc.html";
const ARCHITECTURE_FILE = path.resolve(ROOT, ARCHITECTURE_RELATIVE);

const SEND_PATH = /^\/api\/workorders\/([^/]+)\/send$/;

function sendSourceZip(res: ServerResponse): void {
  const child = spawn("zip", ["-r", "-q", "-", ...ZIP_ENTRIES], { cwd: ROOT });
  child.once("error", () => {
    if (!res.headersSent) sendJson(res, 500, { error: "Could not zip source" });
  });
  child.stdout.once("data", (chunk: Buffer) => {
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="farmengage-atlas-poc.zip"',
      "cache-control": "no-store",
    });
    res.write(chunk);
    child.stdout.pipe(res);
  });
  child.on("close", (code) => {
    if (!res.headersSent) sendJson(res, 500, { error: `Could not zip source (${code ?? "unknown"})` });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new HttpError("Body too large", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new HttpError("Invalid JSON", 400));
      }
    });
    req.on("error", reject);
  });
}

function withoutId<T extends { _id?: unknown }>(doc: T): Omit<T, "_id"> {
  const copy = { ...doc };
  delete copy._id;
  return copy;
}

async function indexState(db: Awaited<ReturnType<typeof connect>>, collection: string, name: string): Promise<string> {
  const indexes = await db.collection(collection).listSearchIndexes(name).toArray();
  const index = readIndexInfo(indexes[0]);
  if (!indexes[0]) return "MISSING";
  if (indexIsReady(index)) return "READY";
  return index.status ?? "PENDING";
}

async function snapshot(db: Awaited<ReturnType<typeof connect>>): Promise<unknown> {
  const since = new Date(Date.now() - 3 * 60 * 1000);
  const [fields, guidance, prescriptions, vehicles, fleet, workOrders, syncJobs, samples] = await Promise.all([
    db.collection<FieldDoc>("fields").find({ orgId: ORG_ID }).toArray(),
    db.collection<GuidanceDoc>("guidanceLines").find({ orgId: ORG_ID }).toArray(),
    db.collection<PrescriptionDoc>("prescriptions").find({ orgId: ORG_ID }).toArray(),
    db.collection<VehicleDoc>("vehicles").find({ orgId: ORG_ID }).toArray(),
    db.collection<FleetStateDoc>("fleetState").find({ orgId: ORG_ID }).toArray(),
    db.collection<WorkOrderDoc>("workOrders").find({ orgId: ORG_ID }).sort({ modifiedAt: -1 }).toArray(),
    db.collection<SyncJobDoc>("syncJobs").find({ orgId: ORG_ID }).sort({ createdAt: -1 }).limit(12).toArray(),
    db.collection<TelemetryDoc>("telemetry").find({ ts: { $gte: since } }).sort({ ts: 1 }).toArray(),
  ]);

  const fieldsWithCounts = await Promise.all(
    fields.map(async (field) => {
      const machinesInside = await db.collection("fleetState").countDocuments({
        location: { $geoWithin: { $geometry: field.extent } },
      });
      return { ...withoutId(field), machinesInside };
    }),
  );

  const speeds = new Map<string, { speedKph: number; ts: string }[]>();
  for (const sample of samples) {
    const vehicleId = sample.meta.vehicleId;
    const list = speeds.get(vehicleId) ?? [];
    list.push({ speedKph: Math.round(sample.speedKph * 10) / 10, ts: sample.ts.toISOString() });
    speeds.set(vehicleId, list);
  }

  return {
    org: { id: ORG_ID, name: ORG_NAME },
    operations: OPERATIONS,
    search: await indexState(db, "workOrders", WORKORDER_SEARCH_INDEX),
    vector: await indexState(db, "notes", NOTES_VECTOR_INDEX),
    fields: fieldsWithCounts,
    guidance: guidance.map(withoutId),
    prescriptions: prescriptions.map(withoutId),
    vehicles: vehicles.map((vehicle) => {
      const { route: _route, routeLengthMeters: _length, ...rest } = vehicle;
      return withoutId(rest);
    }),
    fleet: fleet.map((row) => ({ ...withoutId(row), ts: row.ts.toISOString() })),
    workOrders: workOrders.map(withoutId),
    syncJobs: syncJobs.map(withoutId),
    telemetry: [...speeds.entries()].map(([vehicleId, points]) => {
      const avgSpeedKph = points.reduce((sum, point) => sum + point.speedKph, 0) / points.length;
      return { vehicleId, samples: points.length, avgSpeedKph: Math.round(avgSpeedKph * 10) / 10, spark: points.slice(-40) };
    }),
  };
}

function readIntervalMs(body: unknown): number {
  if (typeof body !== "object" || body === null) throw new HttpError("Body required", 400);
  const value = (body as { intervalMs?: unknown }).intervalMs;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError("intervalMs is required", 400);
  return value;
}

function readAnomaly(body: unknown): { type: AnomalyType; vehicleId: string } {
  if (typeof body !== "object" || body === null) throw new HttpError("Body required", 400);
  const record = body as { type?: unknown; vehicleId?: unknown };
  const type = ANOMALY_TYPES.find((item) => item === record.type);
  if (!type) throw new HttpError("type must be DEVICE_FAILURE, SPEED_SPIKE, or FREEZE_EVENT", 400);
  if (typeof record.vehicleId !== "string" || record.vehicleId.length === 0) throw new HttpError("vehicleId is required", 400);
  return { type, vehicleId: record.vehicleId };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  db: Awaited<ReturnType<typeof connect>>,
  simulator: SimulatorController,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (req.method === "GET" && url.pathname === "/source.zip") {
    sendSourceZip(res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/architecture") {
    const allowed = path.resolve(ROOT, ".archify", "architecture-farmengage-poc-20261014-103734", "farmengage-poc.html");
    if (ARCHITECTURE_FILE !== allowed) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const body = await readFile(allowed);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/snapshot") {
    sendJson(res, 200, await snapshot(db));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/search") {
    if (!query) throw new HttpError("q is required", 400);
    if (query.length > 200) throw new HttpError("q is too long", 400);
    sendJson(res, 200, { results: await searchWorkOrders(db, query) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/similar") {
    if (!query) throw new HttpError("q is required", 400);
    if (query.length > 300) throw new HttpError("q is too long", 400);
    sendJson(res, 200, { results: await similarNotes(db, query) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/simulator/status") {
    sendJson(res, 200, simulator.status());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/simulator/start") {
    simulator.start();
    sendJson(res, 200, simulator.status());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/simulator/stop") {
    simulator.stop();
    sendJson(res, 200, simulator.status());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/simulator/config") {
    simulator.setIntervalMs(readIntervalMs(await readBody(req)));
    sendJson(res, 200, simulator.status());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/simulator/inject-anomaly") {
    const anomaly = readAnomaly(await readBody(req));
    await simulator.inject(anomaly.type, anomaly.vehicleId);
    sendJson(res, 200, simulator.status());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/workorders") {
    sendJson(res, 201, await createWorkOrder(db, await readBody(req)));
    return;
  }
  const sendMatch = req.method === "POST" ? SEND_PATH.exec(url.pathname) : null;
  if (sendMatch) {
    sendJson(res, 200, await sendWorkOrder(db, sendMatch[1], await readBody(req)));
    return;
  }

  const file = req.method === "GET" ? FILES[url.pathname] : undefined;
  if (!file) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  const body = await readFile(path.join(PUBLIC_DIR, file.file));
  res.writeHead(200, { "content-type": file.type, "cache-control": "no-store" });
  res.end(body);
}

export async function main(): Promise<void> {
  const db = await connect();
  const simulator = startSimulator(db);
  const port = Number(process.env.PORT ?? 8787);
  const server = createServer((req, res) => {
    void handle(req, res, db, simulator).catch((error: unknown) => {
      if (res.headersSent) return;
      const status = error instanceof HttpError ? error.status : error instanceof UnknownVehicleError ? 400 : 500;
      const message = error instanceof Error ? error.message : "Unknown error";
      sendJson(res, status, { error: message });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
  console.log(`FarmENGAGE PoC listening on http://127.0.0.1:${port}`);

  const shutdown = async (): Promise<void> => {
    simulator.stop();
    server.close();
    await close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

await main();
