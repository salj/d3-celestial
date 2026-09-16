import test from "node:test";
import assert from "node:assert/strict";
import { observer } from "../src/observer.js";

const DATE = new Date(Date.UTC(2026, 7, 26, 20, 0, 0));

function sky(config = {}) {
  const calls = {redraw: 0, rotate: []};
  const map = {
    cfg: {date: DATE, geopos: [47.5, 19.2], timezone: 0,
      transform: "equatorial", follow: "center", ...config},
    _lifecycle: {disposed: false},
    redraw() { calls.redraw++; },
    rotate(value) { calls.rotate.push(value); },
  };
  observer(map);
  return {map, calls};
}

test("observer exposes programmatic date and location without DOM", () => {
  const {map, calls} = sky();
  assert.deepEqual(map.skyview(), {date: DATE, location: [47.5, 19.2], timezone: 0});
  assert.deepEqual(map.date(), DATE);
  assert.deepEqual(map.location(), [47.5, 19.2]);
  map.skyview({date: new Date(DATE.valueOf() + 1000), location: [-33.9, 151.2], timezone: 600});
  assert.equal(calls.redraw, 1);
  assert.deepEqual(map.position(), [-33.9, 151.2]);
  assert.equal(map.timezone(), 600);
  assert.ok(map.zenith().every(Number.isFinite));
  assert.ok(map.nadir().every(Number.isFinite));
});

test("observer follows zenith when programmatic state changes", () => {
  const {map, calls} = sky({follow: "zenith"});
  map.location([0, 0]);
  assert.equal(calls.redraw, 0);
  assert.equal(calls.rotate.length, 1);
  assert.deepEqual(calls.rotate[0], {center: map.zenith()});
});

test("observer rejects invalid state and does not redraw disposed maps", () => {
  const {map, calls} = sky();
  map.skyview({location: [91, 0], timezone: 900, date: new Date("no")});
  assert.equal(calls.redraw, 0);
  map._lifecycle.disposed = true;
  map.skyview({location: [0, 0]});
  assert.equal(calls.redraw, 0);
  assert.deepEqual(map.location(), [47.5, 19.2]);
});
