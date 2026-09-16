import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { materialiseCatalogue } from "../src/catalogue-adapter.js";
import { buildCatalogue, buildConstellationsCatalogue } from "../tools/build-catalogue.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = name => JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data", name), "utf8"));

test("CELD adapter materialises fresh renderer-shaped catalogue data", () => {
  const bytes = buildCatalogue({stars: json("stars.6.json"), starNames: json("starnames.json"), starsLimit: 5,
    dsos: json("dsos.bright.json"), dsoNames: json("dsonames.json"), dsoProfile: "notable",
    planets: json("planets.json"), planetIds: ["sol", "lun", "mar"]});
  const first = materialiseCatalogue(bytes, {stars: true, starLabels: true, dsos: true, dsoNames: true, planets: true});
  const second = materialiseCatalogue(bytes, {stars: true, starLabels: true, dsos: true, dsoNames: true, planets: true});
  assert.equal(first.stars.type, "FeatureCollection");
  assert.equal(first.stars.features[0].geometry.type, "Point");
  assert.equal(typeof first.stars.features[0].properties.mag, "number");
  assert.equal(first.dsos.type, "FeatureCollection");
  assert.ok(first.dsoNames[Object.keys(first.dsoNames)[0]].name);
  assert.deepEqual(Object.keys(first.planets).sort(), ["lun", "mar", "sol", "ter"]);
  first.stars.features[0].geometry.coordinates[0] = -1;
  assert.notEqual(second.stars.features[0].geometry.coordinates[0], -1);
});

test("CELD adapter preserves constellation rank and MultiLine segmentation", () => {
  const bytes = buildConstellationsCatalogue({constellations: json("constellations.json"), constellationLines: json("constellations.lines.json")});
  const out = materialiseCatalogue(bytes, {constellationLabels: true, constellationLines: true});
  const and = out.constellationLines.features.find(feature => feature.id === "And");
  assert.equal(out.constellationLabels.features[0].geometry.type, "Point");
  assert.equal(typeof out.constellationLabels.features[0].properties.rank, "string");
  assert.equal(and.geometry.type, "MultiLineString");
  assert.equal(and.geometry.coordinates.length, 5);
  assert.equal(and.properties.rank, "1");
});

test("CELD adapter materialises the simplified Milky Way as renderer GeoJSON", () => {
  const bytes = buildCatalogue({stars: json("stars.6.json"), starNames: json("starnames.json"),
    milkyWay: json("mw.json"), milkyWayTolerance: 0.1});
  const out = materialiseCatalogue(bytes, {milkyWay: true});
  assert.equal(out.milkyWay.type, "FeatureCollection");
  assert.ok(out.milkyWay.features.length > 0);
  const ring = out.milkyWay.features[0].geometry.coordinates[0][0];
  assert.equal(ring[0].length, 2);
  assert.deepEqual(ring[0], ring.at(-1));
});

test("CELD adapter rejects requested missing tables", () => {
  const bytes = buildCatalogue({stars: json("stars.6.json"), starNames: json("starnames.json")});
  assert.throws(() => materialiseCatalogue(bytes, {planets: true}), /missing required PLANETS/);
  assert.throws(() => materialiseCatalogue(bytes, {unknown: true}), /unknown CELD dataset/);
});
