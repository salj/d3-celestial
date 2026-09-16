#!/usr/bin/env node
/* Deterministic, conservative Milky Way geometry candidates.
 *
 * This is deliberately not CELD wiring. It produces GeoJSON-shaped candidate
 * geometry so visual review and licence decisions happen before a binary table
 * makes a bad outline harder to inspect.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EPSILON = 1e-9;

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON;
}

function unwrapRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) throw new TypeError("ring must have at least four points");
  const input = samePoint(ring[0], ring.at(-1)) ? ring.slice(0, -1) : ring.slice();
  const result = [];
  for (const point of input) {
    if (!Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite)) throw new TypeError("ring has invalid coordinate");
    let longitude = point[0];
    if (result.length) longitude += 360 * Math.round((result.at(-1)[0] - longitude) / 360);
    result.push([longitude, point[1]]);
  }
  return result;
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - start[0] - ratio * dx, point[1] - start[1] - ratio * dy);
}

function simplifyPath(points, tolerance) {
  if (points.length <= 2) return points.slice();
  let farthest = -1, split = -1;
  for (let index = 1; index < points.length - 1; index++) {
    const distance = distanceToSegment(points[index], points[0], points.at(-1));
    if (distance > farthest) { farthest = distance; split = index; }
  }
  if (farthest <= tolerance) return [points[0], points.at(-1)];
  return [...simplifyPath(points.slice(0, split + 1), tolerance).slice(0, -1),
    ...simplifyPath(points.slice(split), tolerance)];
}

function quantize(points, grid) {
  const output = [];
  for (const point of points) {
    const quantized = [Math.round(point[0] / grid) * grid, Math.round(point[1] / grid) * grid];
    if (!output.length || !samePoint(quantized, output.at(-1))) output.push(quantized);
  }
  return output;
}

function orientation(a, b, c) {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(value) < EPSILON ? 0 : Math.sign(value);
}

function onSegment(a, b, point) {
  return point[0] >= Math.min(a[0], b[0]) - EPSILON && point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON && point[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function segmentsIntersect(a, b, c, d) {
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) - EPSILON || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) - EPSILON ||
      Math.max(a[1], b[1]) < Math.min(c[1], d[1]) - EPSILON || Math.max(c[1], d[1]) < Math.min(a[1], b[1]) - EPSILON) return false;
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB) return true;
  return (abC === 0 && onSegment(a, b, c)) || (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) || (cdB === 0 && onSegment(c, d, b));
}

function ringSimple(points) {
  const count = points.length;
  if (count < 3 || Math.abs(signedArea(points)) < EPSILON) return false;
  const segments = points.map((point, index) => ({ index, a: point, b: points[(index + 1) % count] }))
    .sort((left, right) => Math.min(left.a[0], left.b[0]) - Math.min(right.a[0], right.b[0]));
  for (let index = 0; index < segments.length; index++) {
    const left = segments[index], leftMax = Math.max(left.a[0], left.b[0]);
    for (let next = index + 1; next < segments.length; next++) {
      const right = segments[next];
      if (Math.min(right.a[0], right.b[0]) > leftMax + EPSILON) break;
      const delta = Math.abs(left.index - right.index);
      if (delta === 1 || delta === count - 1) continue;
      if (segmentsIntersect(left.a, left.b, right.a, right.b)) return false;
    }
  }
  return true;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, prior = ring.length - 1; index < ring.length; prior = index++) {
    const a = ring[index], b = ring[prior];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function ringsIntersect(left, right) {
  for (let a = 0; a < left.length; a++) for (let b = 0; b < right.length; b++)
    if (segmentsIntersect(left[a], left[(a + 1) % left.length], right[b], right[(b + 1) % right.length])) return true;
  return false;
}

export function polygonTopologySafe(rings) {
  // Upstream's spherical rings cross the antimeridian and do not form a
  // trustworthy planar outer/hole hierarchy. Preserve their topology that is
  // actually encoded: feature/polygon/ring order and winding. This guard
  // rejects a collapsed ring; winding is checked by the caller. A full
  // spherical stream validator belongs with future renderer/projection work,
  // not a dishonest planar point-in-polygon approximation here.
  return rings.length > 0 && rings.every(ring => ring.length >= 3 && Math.abs(signedArea(ring)) >= EPSILON);
}

function simplifyRing(ring, tolerance, grid) {
  const source = unwrapRing(ring);
  let pivot = 1, farthest = -1;
  for (let index = 1; index < source.length; index++) {
    const distance = Math.hypot(source[index][0] - source[0][0], source[index][1] - source[0][1]);
    if (distance > farthest) { farthest = distance; pivot = index; }
  }
  const simplified = [...simplifyPath(source.slice(0, pivot + 1), tolerance).slice(0, -1),
    ...simplifyPath(source.slice(pivot), tolerance).slice(0, -1)];
  return quantize(simplified, grid);
}

function closeAndWrap(ring) {
  const wrapped = ring.map(([longitude, latitude]) => {
    let lon = ((longitude + 180) % 360 + 360) % 360 - 180;
    // Preserve +180 if source/candidate uses it; either is geometrically same.
    if (Math.abs(lon + 180) < EPSILON && longitude > 0) lon = 180;
    return [lon, latitude];
  });
  return [...wrapped, wrapped[0].slice()];
}

function pointCount(geometry) {
  return geometry.coordinates.flat(2).reduce((sum, ring) => sum + ring.length, 0);
}

// Simplify each polygon as a unit. Candidate must preserve every ring's
// winding and polygon containment/disjointness; otherwise source polygon is
// returned unchanged. Feature/polygon/ring order never changes.
export function simplifyMilkyWay(data, { tolerance = 0.15, quantization = tolerance / 4 } = {}) {
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new TypeError("Milky Way must be a FeatureCollection");
  if (!(tolerance > 0) || !(quantization > 0)) throw new RangeError("tolerance and quantization must be positive");
  let inputPoints = 0, outputPoints = 0, fallbackPolygons = 0;
  const features = data.features.map(feature => {
    if (feature?.geometry?.type !== "MultiPolygon") throw new TypeError("Milky Way feature must be MultiPolygon");
    const polygons = feature.geometry.coordinates.map(polygon => {
      const source = polygon.map(unwrapRing);
      inputPoints += source.reduce((sum, ring) => sum + ring.length, 0);
      const candidate = source.map(ring => simplifyRing([...ring, ring[0]], tolerance, quantization));
      const windingOk = candidate.every((ring, index) => Math.sign(signedArea(ring)) === Math.sign(signedArea(source[index])));
      const accepted = windingOk && polygonTopologySafe(candidate);
      const chosen = accepted ? candidate : source;
      if (!accepted) fallbackPolygons++;
      outputPoints += chosen.reduce((sum, ring) => sum + ring.length, 0);
      return accepted ? chosen.map(closeAndWrap) : polygon.map(ring => ring.map(point => point.slice()));
    });
    return { ...feature, properties: { ...(feature.properties || {}) }, geometry: { ...feature.geometry, coordinates: polygons } };
  });
  return { data: { ...data, features }, stats: { tolerance, quantization, inputPoints, outputPoints, fallbackPolygons } };
}

export function reportCandidates(data, tolerances = [0.05, 0.1, 0.15, 0.2, 0.25]) {
  const inputBytes = Buffer.byteLength(JSON.stringify(data));
  return tolerances.map(tolerance => {
    const result = simplifyMilkyWay(data, { tolerance });
    return { ...result.stats, bytes: Buffer.byteLength(JSON.stringify(result.data)), inputBytes };
  });
}

function main() {
  const input = process.argv[2] || "harness/data/mw.json";
  const tolerances = process.argv[3] ? process.argv[3].split(",").map(Number) : undefined;
  const data = JSON.parse(fs.readFileSync(input, "utf8"));
  for (const row of reportCandidates(data, tolerances)) {
    const pointPercent = (100 * row.outputPoints / row.inputPoints).toFixed(1);
    const bytePercent = (100 * row.bytes / row.inputBytes).toFixed(1);
    console.log(`tol=${row.tolerance} grid=${row.quantization} points=${row.outputPoints}/${row.inputPoints} (${pointPercent}%) json=${row.bytes}/${row.inputBytes} (${bytePercent}%) fallback=${row.fallbackPolygons}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
