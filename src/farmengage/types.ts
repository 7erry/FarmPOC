/**
 * Subset of the FarmENGAGE Data API models stored in Atlas.
 * GeoJSON points and polygons follow https://www.mongodb.com/docs/manual/reference/geojson/
 */

export const OEMS = ["agco", "trimble", "deere", "raven"] as const;
export type Oem = (typeof OEMS)[number];

export const WORK_ORDER_STATUSES = [
  "Unknown",
  "Planned",
  "InProgress",
  "OnHold",
  "Done",
  "Cancelled",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Device file send status from the public API. */
export const API_SEND_STATUSES = ["pending", "sent", "canceled"] as const;
export type ApiSendStatus = (typeof API_SEND_STATUSES)[number];

/** Cab acknowledgement tracked only by this PoC, after the API returns sent. */
export const CAB_STATUSES = [
  "pending",
  "acknowledged",
  "in_progress",
  "done",
  "canceled",
] as const;
export type CabStatus = (typeof CAB_STATUSES)[number];

export type GeoPoint = { type: "Point"; coordinates: [number, number] };
export type GeoLineString = { type: "LineString"; coordinates: [number, number][] };
export type GeoPolygon = { type: "Polygon"; coordinates: [number, number][][] };
export type LngLat = [number, number];

export type OrganizationDoc = {
  id: string;
  name: string;
  timezoneName: string;
  isMetric: boolean;
};

export type FieldDoc = {
  id: string;
  orgId: string;
  name: string;
  farmName: string;
  cropZoneId: string;
  crop: string;
  areaAcres: number;
  extent: GeoPolygon;
};

export type GuidanceDoc = {
  id: string;
  orgId: string;
  fieldId: string;
  name: string;
  type: "AB" | "Curve";
  geometry: GeoLineString;
  isRetired: boolean;
  modifiedAt: string;
};

export type RxPolygon = {
  id: string;
  geometry: GeoPolygon;
  rate: number;
};

export type PrescriptionDoc = {
  id: string;
  orgId: string;
  name: string;
  fieldId: string;
  field: string;
  materialId: string;
  material: string;
  rateUnit: "gal/ac";
  createdAt: string;
  rxPolygons: RxPolygon[];
};

export type VehicleDevice = {
  deviceId: string;
  serialNumber: string;
  deviceTypeId: number;
  displayName: string;
  isTaskDoc: true;
};

export type VehicleDoc = {
  id: string;
  orgId: string;
  name: string;
  oem: Oem;
  manufacturer: string;
  vehicleType: string;
  devices: VehicleDevice[];
  /** Swath the simulator drives. Not a FarmENGAGE vehicle field. */
  route: LngLat[];
  routeLengthMeters: number;
  speedKph: number;
};

export type DeviceDoc = {
  id: string;
  orgId: string;
  serialNumber: string;
  type: string;
  model: string;
  vehicleId: string;
  vehicle: string;
};

export type WorkOrderDoc = {
  id: string;
  orgId: string;
  name: string;
  cropZoneId: string;
  fieldId: string;
  fieldName: string;
  status: WorkOrderStatus;
  operationTypeId: number;
  operationType: string;
  materialName: string;
  comments: string;
  plannedDateTime: string;
  dueDateTime: string;
  area: number;
  guidances: { guidanceId: string; fieldId: string }[];
  vehicles: { vehicleId: string; name: string }[];
  /** 0 to 1. PoC progress, not part of WorkOrderDetail. */
  coveredFraction: number;
  modifiedAt: string;
};

export type FleetStateDoc = {
  vehicleId: string;
  orgId: string;
  oem: Oem;
  name: string;
  color: string;
  location: GeoPoint;
  speedKph: number;
  headingDeg: number;
  fieldId: string | null;
  activeWorkOrderId: string | null;
  routeOffsetMeters: number;
  ts: Date;
};

export const ANOMALY_TYPES = ["DEVICE_FAILURE", "SPEED_SPIKE", "FREEZE_EVENT"] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export type TelemetryDoc = {
  ts: Date;
  meta: { orgId: string; vehicleId: string; oem: Oem };
  location: GeoPoint;
  speedKph: number;
  headingDeg: number;
  workOrderId: string | null;
  /** Set only on an injected sample. A stream processor matches this field. */
  anomaly?: AnomalyType;
};

export type SyncJobDoc = {
  id: string;
  orgId: string;
  workOrderId: string;
  vehicleId: string;
  deviceId: string;
  apiStatus: ApiSendStatus;
  cabStatus: CabStatus;
  /** Illustrative TASKDATA fragment, not a full ISO 11783 file. */
  isoXml: string;
  statusUtc: string;
  createdAt: string;
};

export type NoteDoc = {
  id: string;
  orgId: string;
  text: string;
  workOrderId: string | null;
  embedding: number[];
};

export function oemColor(oem: Oem): string {
  switch (oem) {
    case "agco":
      return "#E87722";
    case "trimble":
      return "#F5C518";
    case "deere":
      return "#367C2B";
    case "raven":
      return "#5DADE2";
    default: {
      const unexpected: never = oem;
      throw new Error(`Unknown OEM ${String(unexpected)}`);
    }
  }
}
