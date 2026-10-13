/** Fixed Ames demo org, fields, AB lines, prescription, and mixed-fleet vehicles. */
import { pathLengthMeters } from "./geo.ts";
import type { FieldDoc, GuidanceDoc, LngLat, PrescriptionDoc, VehicleDoc } from "./farmengage/types.ts";

export const ORG_ID = "11111111-1111-4111-8111-111111111111";
export const ORG_NAME = "Ames Demo Farm";

/** Stand-in ids. A live gateway would read GET /resources/operationtypes. */
export const OPERATIONS = [
  { id: 1, name: "Plant" },
  { id: 2, name: "Fertilize" },
  { id: 3, name: "Spray" },
  { id: 4, name: "Harvest" },
] as const;

function ring(west: number, south: number, east: number, north: number): LngLat[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

const northRing = ring(-93.81, 42.06, -93.805, 42.064);
const southRing = ring(-93.81, 42.052, -93.805, 42.056);

export const FIELDS: FieldDoc[] = [
  {
    id: "22222222-2222-4222-8222-222222222221",
    orgId: ORG_ID,
    name: "North 40",
    farmName: "Home Farm",
    cropZoneId: "33333333-3333-4333-8333-333333333331",
    crop: "Corn",
    areaAcres: 45,
    extent: { type: "Polygon", coordinates: [northRing] },
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    orgId: ORG_ID,
    name: "South Field",
    farmName: "Home Farm",
    cropZoneId: "33333333-3333-4333-8333-333333333332",
    crop: "Soybeans",
    areaAcres: 45,
    extent: { type: "Polygon", coordinates: [southRing] },
  },
];

function line(fieldId: string, id: string, name: string, latitude: number): GuidanceDoc {
  return {
    id,
    orgId: ORG_ID,
    fieldId,
    name,
    type: "AB",
    geometry: {
      type: "LineString",
      coordinates: [
        [-93.8095, latitude],
        [-93.8055, latitude],
      ],
    },
    isRetired: false,
    modifiedAt: new Date().toISOString(),
  };
}

export const GUIDANCE: GuidanceDoc[] = [
  line(FIELDS[0].id, "44444444-4444-4444-8444-444444444441", "North AB", 42.062),
  line(FIELDS[1].id, "44444444-4444-4444-8444-444444444442", "South AB", 42.054),
];

function vehicle(
  id: string,
  deviceId: string,
  name: string,
  oem: VehicleDoc["oem"],
  manufacturer: string,
  vehicleType: string,
  serial: string,
  route: LngLat[],
  speedKph: number,
): VehicleDoc {
  return {
    id,
    orgId: ORG_ID,
    name,
    oem,
    manufacturer,
    vehicleType,
    speedKph,
    route,
    routeLengthMeters: pathLengthMeters(route),
    devices: [
      {
        deviceId,
        serialNumber: serial,
        deviceTypeId: 1,
        displayName: "TaskDoc",
        isTaskDoc: true,
      },
    ],
  };
}

export const VEHICLES: VehicleDoc[] = [
  vehicle(
    "55555555-5555-4555-8555-555555555551",
    "55555555-5555-4555-8555-555555555561",
    "AGCO Rogator",
    "agco",
    "AGCO",
    "Sprayer",
    "AGC-TD-1001",
    [
      [-93.8095, 42.0612],
      [-93.8055, 42.0612],
    ],
    10,
  ),
  vehicle(
    "55555555-5555-4555-8555-555555555552",
    "55555555-5555-4555-8555-555555555562",
    "Trimble GFX-1060",
    "trimble",
    "PTx Trimble",
    "Tractor",
    "GFX-1060-2002",
    [
      [-93.8095, 42.0628],
      [-93.8055, 42.0628],
    ],
    12,
  ),
  vehicle(
    "55555555-5555-4555-8555-555555555553",
    "55555555-5555-4555-8555-555555555563",
    "John Deere 8R",
    "deere",
    "John Deere",
    "Tractor",
    "JD-8R-3003",
    [
      [-93.8095, 42.0532],
      [-93.8055, 42.0532],
    ],
    9,
  ),
  vehicle(
    "55555555-5555-4555-8555-555555555554",
    "55555555-5555-4555-8555-555555555564",
    "Raven RCM",
    "raven",
    "Raven",
    "Sprayer",
    "RAV-RCM-4004",
    [
      [-93.8095, 42.0548],
      [-93.8055, 42.0548],
    ],
    11,
  ),
];

const northWest: LngLat[] = ring(-93.81, 42.06, -93.8075, 42.064);
const northEast: LngLat[] = ring(-93.8075, 42.06, -93.805, 42.064);

export const PRESCRIPTION: PrescriptionDoc = {
  id: "66666666-6666-4666-8666-666666666661",
  orgId: ORG_ID,
  name: "North 40 variable rate",
  fieldId: FIELDS[0].id,
  field: FIELDS[0].name,
  materialId: "77777777-7777-4777-8777-777777777771",
  material: "Glyphosate",
  rateUnit: "gal/ac",
  createdAt: new Date().toISOString(),
  rxPolygons: [
    { id: "66666666-6666-4666-8666-666666666671", geometry: { type: "Polygon", coordinates: [northWest] }, rate: 12 },
    { id: "66666666-6666-4666-8666-666666666672", geometry: { type: "Polygon", coordinates: [northEast] }, rate: 8 },
  ],
};

export const SEEDED_WORK_ORDER_ID = "88888888-8888-4888-8888-888888888881";
export const SEEDED_SYNC_ID = "99999999-9999-4999-8999-999999999991";

export const NOTE_TEXTS = [
  "Variable rate spray on the north field at 12 gallons per acre for corn",
  "Plant soybeans on the south field following the AB guidance line",
  "Hold spraying when wind exceeds 10 miles per hour",
  "Fertilize the south field with nitrogen before planting",
  "Harvest corn on the north field once moisture is under 20 percent",
  "Push the guidance line and prescription to the in-cab display without a USB stick",
];
