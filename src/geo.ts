/** Distance and point-in-polygon helpers for the simulator. MongoDB does the real boundary query. */
import type { LngLat } from "./farmengage/types.ts";

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthMeters(path: LngLat[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += haversineMeters(path[index - 1], path[index]);
  }
  return total;
}

export function pointInRing(point: LngLat, ring: LngLat[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const crosses = yi > y !== yj > y;
    if (!crosses) continue;
    const edgeX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (x < edgeX) inside = !inside;
  }
  return inside;
}

export function bearingDeg(a: LngLat, b: LngLat): number {
  const y = Math.sin(toRadians(b[0] - a[0])) * Math.cos(toRadians(b[1]));
  const x =
    Math.cos(toRadians(a[1])) * Math.sin(toRadians(b[1])) -
    Math.sin(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.cos(toRadians(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export type RoutePose = { point: LngLat; headingDeg: number };

/** Walk `distanceMeters` along a path, then reverse, so a machine keeps moving. */
export function pointAtDistance(path: LngLat[], distanceMeters: number): RoutePose {
  if (path.length === 0) throw new Error("Route has no points");
  if (path.length === 1) return { point: path[0], headingDeg: 0 };

  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    const length = haversineMeters(path[index - 1], path[index]);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return { point: path[0], headingDeg: 0 };

  let distance = distanceMeters % (total * 2);
  let forward = true;
  if (distance > total) {
    distance = total * 2 - distance;
    forward = false;
  }

  let walked = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const segment = lengths[index];
    if (walked + segment < distance && index < lengths.length - 1) {
      walked += segment;
      continue;
    }
    const span = segment === 0 ? 0 : Math.min(1, (distance - walked) / segment);
    const start = path[index];
    const end = path[index + 1];
    const point: LngLat = [start[0] + (end[0] - start[0]) * span, start[1] + (end[1] - start[1]) * span];
    const headingDeg = forward ? bearingDeg(start, end) : bearingDeg(end, start);
    return { point, headingDeg };
  }

  const last = path[path.length - 1];
  return { point: last, headingDeg: bearingDeg(path[path.length - 2], last) };
}
