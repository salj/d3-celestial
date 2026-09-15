import test from "node:test";
import assert from "node:assert/strict";
import { createLifecycle } from "../src/lifecycle.js";
import { settings } from "../src/config.js";

test("disposing a map cancels its work without disposing another map", async () => {
  const a = createLifecycle(), b = createLifecycle();
  let cleaned = 0, ranA = false, ranB = false;
  a.onDispose(() => cleaned++);
  a.schedule(() => { ranA = true; }, 0);
  const finished = new Promise(resolve => b.schedule(() => { ranB = true; resolve(); }, 0));
  a.dispose(); a.dispose();
  await finished;
  assert.equal(cleaned, 1);
  assert.equal(ranA, false);
  assert.equal(ranB, true);
  b.dispose();
});

test("late network completion cannot call a disposed map", async t => {
  let resolve, signal, called = false;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  });
  const life = createLifecycle();
  const pending = life.load("/catalogue.json", () => { called = true; });
  life.dispose();
  assert.equal(signal.aborted, true);
  resolve({ ok: true, json: async () => ({ features: [] }) });
  await pending;
  assert.equal(called, false);
});

test("nested configuration does not alias defaults or another instance", () => {
  const a = settings.set({}, settings), b = settings.set({}, settings);
  a.stars.style.fill = "#123456";
  a.constellations.lineStyle.stroke[0] = "#abcdef";
  assert.notEqual(b.stars.style.fill, a.stars.style.fill);
  assert.notEqual(b.constellations.lineStyle.stroke[0], a.constellations.lineStyle.stroke[0]);
  assert.notEqual(settings.stars.style.fill, a.stars.style.fill);
});
