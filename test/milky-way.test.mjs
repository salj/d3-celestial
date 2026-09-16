import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { polygonTopologySafe, reportCandidates, simplifyMilkyWay } from "../tools/simplify-milky-way.mjs";
import { buildMilkyWayCatalogue, decodeMilkyWayCatalogue, parseArguments } from "../tools/build-catalogue.mjs";
import { CatalogueTable, parseCatalogueContainer } from "../src/catalogue.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/mw.json"), "utf8"));

test("Milky Way candidates retain feature, polygon, ring order, closure and winding", () => {
  const { data, stats } = simplifyMilkyWay(source, { tolerance: 0.15 });
  assert.equal(data.features.length, source.features.length);
  assert.ok(stats.outputPoints < stats.inputPoints);
  for (const [featureIndex, feature] of data.features.entries()) {
    const original = source.features[featureIndex];
    assert.equal(feature.id, original.id);
    assert.equal(feature.geometry.coordinates.length, original.geometry.coordinates.length);
    for (const [polygonIndex, polygon] of feature.geometry.coordinates.entries()) {
      assert.equal(polygon.length, original.geometry.coordinates[polygonIndex].length);
      const unclosed = polygon.map(ring => ring.slice(0, -1));
      assert.ok(polygonTopologySafe(unclosed), `${feature.id}/${polygonIndex} topology`);
      polygon.forEach((ring, ringIndex) => {
        assert.deepEqual(ring[0], ring.at(-1));
        const originalRing = original.geometry.coordinates[polygonIndex][ringIndex];
        const area = value => value.slice(0, -1).reduce((sum, point, index, points) => {
          const next = points[(index + 1) % points.length]; return sum + point[0] * next[1] - next[0] * point[1];
        }, 0);
        assert.equal(Math.sign(area(ring)), Math.sign(area(originalRing)));
      });
    }
  }
});

test("Milky Way candidate generation is deterministic and reports useful reductions", () => {
  const first = simplifyMilkyWay(source, { tolerance: 0.2 });
  const second = simplifyMilkyWay(JSON.parse(JSON.stringify(source)), { tolerance: 0.2 });
  assert.deepEqual(first, second);
  const report = reportCandidates(source);
  assert.deepEqual(report.map(row => row.tolerance), [0.05, 0.1, 0.15, 0.2, 0.25]);
  assert.ok(report.every(row => row.outputPoints <= row.inputPoints && row.bytes <= row.inputBytes));
  assert.ok(report.some(row => row.outputPoints < row.inputPoints * 0.5));
});

test("CELD MILKY_WAY table round-trips selected candidate geometry and remains opt-in", () => {
  const options = {milkyWay: source, tolerance: 0.1, sourceHash: Uint8Array.from({length: 32}, (_, index) => index)};
  const first = buildMilkyWayCatalogue(options);
  const second = buildMilkyWayCatalogue({...options, milkyWay: JSON.parse(JSON.stringify(source))});
  assert.deepEqual(first.container, second.container);
  const parsed = parseCatalogueContainer(first.container);
  assert.deepEqual(parsed.tables.map(table => [table.type, table.count]), [[CatalogueTable.MILKY_WAY, 5]]);
  assert.ok(first.container.byteLength < Buffer.byteLength(JSON.stringify(source)));

  const decoded = decodeMilkyWayCatalogue(first.container);
  assert.equal(decoded.features.length, first.data.features.length);
  for (const [featureIndex, feature] of decoded.features.entries()) {
    const expected = first.data.features[featureIndex];
    assert.equal(feature.id, expected.id);
    assert.equal(feature.geometry.coordinates.length, expected.geometry.coordinates.length);
    feature.geometry.coordinates.forEach((polygon, polygonIndex) => polygon.forEach((ring, ringIndex) => {
      const expectedRing = expected.geometry.coordinates[polygonIndex][ringIndex];
      assert.equal(ring.length, expectedRing.length);
      assert.deepEqual(ring[0], ring.at(-1));
      ring.forEach((point, pointIndex) => {
        const original = expectedRing[pointIndex];
        assert.ok(Math.abs(point[0] - ((original[0] + 360) % 360)) < 0.00002);
        assert.ok(Math.abs(point[1] - original[1]) < 0.00002);
      });
    }));
  }
});

test("CELD builder enables Milky Way only with explicit tolerance", () => {
  assert.equal(parseArguments(["--output", "out.celd"]).milkyWayTolerance, null);
  assert.equal(parseArguments(["--output", "out.celd", "--milky-way-tolerance", "0.1"]).milkyWayTolerance, 0.1);
  assert.throws(() => parseArguments(["--output", "out.celd", "--milky-way-tolerance", "0"]), /positive/);
});
