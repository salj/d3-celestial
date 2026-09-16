import test from "node:test";
import assert from "node:assert/strict";
import { settings } from "../src/config.js";
import { catalogueRequirements } from "../src/catalogue-adapter.js";

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

test("catalogue is explicit CELD opt-in with a non-empty URL", () => {
  const celd = settings.set({catalogue: {format: "celd", url: "data/sky.celd"}}, settings)
    .applyDefaults({catalogue: {format: "celd", url: "data/sky.celd"}}, settings);
  assert.deepEqual(celd.catalogue, {format: "celd", url: "data/sky.celd"});
  assert.throws(() => settings.set({catalogue: {format: "json", url: "sky.json"}}, settings)
    .applyDefaults({catalogue: {format: "json", url: "sky.json"}}, settings), /catalogue must be null/);
  assert.throws(() => settings.set({catalogue: {format: "celd", url: ""}}, settings)
    .applyDefaults({catalogue: {format: "celd", url: ""}}, settings), /catalogue must be null/);
});

test("CELD requirements match enabled data and reject unsupported label modes", () => {
  const cfg = settings.set({
    mw: {show: false},
    stars: {designation: false, propername: true, propernameType: "name"},
    dsos: {show: true, names: true, namesType: "name"},
    constellations: {names: true, namesType: "desig", lines: true, bounds: false},
    planets: {show: true}
  }, settings).applyDefaults({}, settings);
  assert.deepEqual(catalogueRequirements(cfg), {
    milkyWay: false, stars: true, starLabels: true, dsos: true, dsoNames: true,
    constellationLabels: true, constellationLines: true, planets: true
  });
  cfg.stars.designation = true;
  assert.throws(() => catalogueRequirements(cfg), /designation/);
});
