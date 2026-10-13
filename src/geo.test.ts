import assert from "node:assert/strict";
import { bearingDeg, haversineMeters, pathLengthMeters, pointAtDistance, pointInRing } from "./geo.ts";
import type { LngLat } from "./farmengage/types.ts";

const square: LngLat[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];

assert.equal(pointInRing([0.5, 0.5], square), true);
assert.equal(pointInRing([2, 2], square), false);
assert.ok(haversineMeters([-93.65, 42.05], [-93.64, 42.05]) > 500);
assert.ok(pathLengthMeters([[0, 0], [0, 0]]) === 0);

const pose = pointAtDistance(
  [
    [0, 0],
    [0.01, 0],
  ],
  0,
);
assert.equal(pose.point[0], 0);
assert.ok(bearingDeg([0, 0], [1, 0]) > 80 && bearingDeg([0, 0], [1, 0]) < 100);

const bounced = pointAtDistance(
  [
    [-93.65, 42.05],
    [-93.64, 42.05],
  ],
  haversineMeters([-93.65, 42.05], [-93.64, 42.05]) + 10,
);
assert.ok(bounced.point[0] < -93.64);
assert.ok(bounced.headingDeg > 180);

console.log("geo checks passed");
