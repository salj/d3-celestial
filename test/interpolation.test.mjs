import test from "node:test";
import assert from "node:assert/strict";
import { geoDistance, geoInterpolate } from "d3-geo";
import { Round, interpolateAngle } from "../src/util.js";
import { interpolateCenter } from "../src/interpolate.js";

test("interpolateAngle takes the shorter arc across the 0/360 boundary", () => {
  // It rewrites 350° as -10°, so it travels the short 20° arc through 0,
  // not the 340° one.
  const f = interpolateAngle(350, 10);
  assert.equal(Round(f(0.5), 6), 0, "the midpoint of 350°→10° is 0°");
  assert.equal(Round(f(0), 6), -10, `t=0 → ${f(0)}`);
  assert.ok(f(0.25) > -10 && f(0.25) < 0, `t=0.25 → ${f(0.25)}`);
});

test("at 180° interpolateAngle picks an unambiguous direction and stays monotone", () => {
  // The direction of rotation is ambiguous here too, but the function
  // deterministically takes the positive direction and stays linear — no
  // jumping, no NaN.
  const f = interpolateAngle(0, 180);
  const values_ = [0, 0.25, 0.5, 0.75, 1].map(f);
  assert.deepEqual(values_.map(v => Round(v, 6)), [0, 45, 90, 135, 180]);
  for (let i = 1; i < values_.length; i++) {
    assert.ok(values_[i] > values_[i - 1], "monotonically increasing");
  }
});

test("beyond 180° interpolateAngle already turns the shorter, negative way", () => {
  const f = interpolateAngle(0, 181);
  assert.ok(f(0.5) < 0, `for 181° it should head towards -89.5°, got: ${f(0.5)}`);
});


for (const [name, from, to] of [
  ["11h", [0, 0], [165, 0]],
  ["12h", [0, 0], [180, 0]],
  ["inclined antipodes", [0, 30], [180, -30]],
  ["north to south pole", [0, 90], [180, -90]],
  ["south to north pole", [37, -90], [-51, 90]],
  ["near antipodes", [17, 42], [-162.999999, -42.000001]],
  ["longitude wrap", [179, 20], [-179, 21]]
]) {
  test(`${name}: finite, uniform angular steps and exact endpoints`, () => {
    const originalFrom = from.slice(), originalTo = to.slice();
    const tween = interpolateCenter(from, to);
    assert.deepEqual(tween(0), from);
    assert.deepEqual(tween(1), to);
    const points = Array.from({length: 101}, (_, index) => tween(index / 100));
    const expected = geoDistance(from, to) / 100;
    for (let index = 1; index < points.length; index++) {
      assert.ok(points[index].every(Number.isFinite));
      assert.ok(Math.abs(geoDistance(points[index - 1], points[index]) - expected) < 1e-8);
    }
    assert.deepEqual(from, originalFrom);
    assert.deepEqual(to, originalTo);
  });
}

test("ordinary arcs retain the D3 great-circle path", () => {
  const from = [12, -38], to = [111, 63];
  const tween = interpolateCenter(from, to), reference = geoInterpolate(from, to);
  for (let index = 0; index <= 100; index++) {
    assert.ok(geoDistance(tween(index / 100), reference(index / 100)) < 1e-12);
  }
});

test("coincident centers stay finite and do not drift", () => {
  const point = [32, 57], tween = interpolateCenter(point, point);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(geoDistance(tween(t), point) < 1e-12);
  }
});
