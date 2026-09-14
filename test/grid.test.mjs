import test from "node:test";
import assert from "node:assert/strict";
import { getGridValues } from "../src/get.js";

const sky = (transform, center) => ({ cfg: { transform, center } });
test("grid labels use the supplied map's coordinate system", () => {
  const eq = getGridValues("lon", [30], sky("equatorial", [0, 0, 0]));
  const gal = getGridValues("lon", [30], sky("galactic", [0, 0, 0]));
  assert.equal(eq.length, 24);
  assert.equal(gal.length, 36);
  assert.equal(eq[1].geometry.coordinates[0], 15);
  assert.equal(gal[1].geometry.coordinates[0], 10);
});
test("relative grid anchors follow center while numeric anchors stay fixed", () => {
  const a = sky("equatorial", [0, 0, 0]), b = sky("equatorial", [60, 20, 0]);
  assert.equal(getGridValues("lon", ["center"], b)[0].geometry.coordinates[1], 20);
  assert.notDeepEqual(getGridValues("lat", ["outline"], a), getGridValues("lat", ["outline"], b));
  assert.deepEqual(getGridValues("lon", [30], a), getGridValues("lon", [30], b));
});
