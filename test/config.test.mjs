import test from "node:test";
import assert from "node:assert/strict";
import { settings } from "../src/config.js";

test("changing a line color preserves width, opacity and other constellation settings", () => {
  const base = settings.set({}, settings);
  const changed = settings.set({constellations: {lineStyle: {stroke: "#f00"}}}, base);
  assert.deepEqual(changed.constellations.lineStyle.stroke, ["#f00", "#f00", "#f00"]);
  assert.deepEqual(changed.constellations.lineStyle.width, base.constellations.lineStyle.width);
  assert.deepEqual(changed.constellations.lineStyle.opacity, base.constellations.lineStyle.opacity);
  assert.deepEqual(changed.constellations.nameStyle, base.constellations.nameStyle);
  assert.notDeepEqual(base.constellations.lineStyle.stroke, changed.constellations.lineStyle.stroke);
});

test("changing label positions retains their style and replaces the position array", () => {
  const base = settings.set({}, settings);
  const changed = settings.set({lines: {graticule: {lon: {pos: [30, -30]}}}}, base);
  assert.deepEqual(changed.lines.graticule.lon.pos, [30, -30]);
  assert.equal(changed.lines.graticule.lon.font, base.lines.graticule.lon.font);
  assert.equal(changed.lines.graticule.show, base.lines.graticule.show);
  assert.deepEqual(changed.lines.graticule.lat, base.lines.graticule.lat);
  changed.lines.graticule.lat.pos.push(0);
  assert.notDeepEqual(changed.lines.graticule.lat.pos, base.lines.graticule.lat.pos);
});
