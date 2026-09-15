import test from "node:test";
import assert from "node:assert/strict";
import { createTimezoneLookup, fromWallTime, isValidTimezone, toWallTime } from "../src/time.js";

// These dates cross host DST transitions. No host-local getter or parser is
// involved in converting the same instant to the configured wall clock.
test("explicit UTC and fractional-hour offsets preserve the instant across DST", () => {
  for (const stamp of ["2026-03-29T00:59:59Z", "2026-10-25T00:59:59Z"]) {
    const instant = new Date(stamp);
    for (const offset of [0, 60, 345, -210]) {
      const wall = toWallTime(instant, offset);
      assert.equal(fromWallTime(wall, offset).valueOf(), instant.valueOf());
      const next = toWallTime(new Date(instant.valueOf() + 1000), offset);
      assert.equal(next.valueOf() - wall.valueOf(), 1000);
    }
  }
  assert.equal(toWallTime(new Date("2026-01-01T23:30:00Z"), 60).toISOString(), "2026-01-02T00:30:00.000Z");
  assert.equal(isValidTimezone(0), true);
  for (const value of [NaN, Infinity, -Infinity, 841, -841, "0", null]) {
    assert.equal(isValidTimezone(value), false);
  }
});

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("time-only changes refresh offsets and superseded replies cannot win", async () => {
  const pending = [], accepted = [];
  const config = { settimezone: true, timezoneResolver: (...args) =>
    new Promise(resolve => pending.push({args, resolve})) };
  const refresh = createTimezoneLookup({disposed: false}, offset => accepted.push(offset));
  refresh([59, 18], new Date(1000), config);
  refresh([59, 18], new Date(1000), config);
  await flush();
  assert.equal(pending.length, 1);
  refresh([59, 18], new Date(2000), config);
  await flush();
  assert.deepEqual(pending.map(p => p.args), [[59, 18, 1], [59, 18, 2]]);
  pending[1].resolve(120);
  await flush();
  pending[0].resolve(60);
  await flush();
  assert.deepEqual(accepted, [120]);
});

test("explicit offsets and disposal invalidate pending lookups", async () => {
  let resolve;
  const accepted = [], life = {disposed: false};
  const config = {timezoneResolver: () => new Promise(done => { resolve = done; })};
  const refresh = createTimezoneLookup(life, value => accepted.push(value));
  refresh([0, 0], new Date(0), config);
  await flush();
  refresh([0, 0], new Date(0), config, true);
  resolve(60);
  await flush();
  assert.deepEqual(accepted, []);
  refresh([0, 0], new Date(1000), config);
  await flush();
  life.disposed = true;
  resolve(120);
  await flush();
  assert.deepEqual(accepted, []);
});

test("resolver failure falls back independently without re-entering lookup", async () => {
  const a = [], b = [];
  const first = createTimezoneLookup({disposed: false}, value => a.push(value));
  const second = createTimezoneLookup({disposed: false}, value => b.push(value));
  first([0, 30], new Date(0), {timezoneResolver() { throw new Error("unavailable"); }});
  second([0, -45], new Date(0), {timezoneResolver: () => NaN});
  await flush();
  assert.deepEqual(a, [120]);
  assert.deepEqual(b, [-180]);
});
