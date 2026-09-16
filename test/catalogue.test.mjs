import test from "node:test";
import assert from "node:assert/strict";
import {
  CELD_DIRECTORY_ENTRY_SIZE,
  CELD_HEADER_SIZE,
  CatalogueFormatError,
  CatalogueTable,
  CatalogueTableFlag,
  parseCatalogueContainer,
  writeCatalogueContainer
} from "../src/catalogue.js";
import { buildCatalogue, buildConstellationsCatalogue, buildPlanetsCatalogue, buildStarsCatalogue, decodeConstellationsCatalogue, decodeDsosCatalogue, decodePlanetsCatalogue, decodeStarsCatalogue, decodeStrings, encodeStrings, parseArguments } from "../tools/build-catalogue.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const utf8Compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

function fixture({ tables = [{ type: CatalogueTable.STARS, count: 1, length: 4 }],
                   manifestLength = 0 } = {}) {
  const directoryOffset = CELD_HEADER_SIZE;
  const directoryLength = tables.length * CELD_DIRECTORY_ENTRY_SIZE;
  let next = directoryOffset + directoryLength;
  if (next % 4) next += 4 - next % 4;
  const entries = tables.map(table => {
    const offset = table.offset ?? next;
    const length = table.length ?? 4;
    next = Math.max(next, offset + length);
    if (next % 4) next += 4 - next % 4;
    return { flags: 0, rawLength: length, crc32: 0, count: 1, ...table, offset, length };
  });
  const manifestOffset = manifestLength ? next : 0;
  const total = Math.max(next, manifestOffset + manifestLength);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  bytes.set([0x43, 0x45, 0x4c, 0x44]);
  view.setUint16(4, 1, true);
  view.setUint16(6, CELD_HEADER_SIZE, true);
  view.setUint16(12, entries.length, true);
  view.setUint16(14, CELD_DIRECTORY_ENTRY_SIZE, true);
  view.setUint32(16, directoryOffset, true);
  view.setUint32(20, manifestOffset, true);
  view.setUint32(24, manifestLength, true);
  entries.forEach((table, index) => {
    const base = directoryOffset + index * CELD_DIRECTORY_ENTRY_SIZE;
    view.setUint16(base, table.type, true);
    view.setUint16(base + 2, table.flags, true);
    view.setUint32(base + 4, table.count, true);
    view.setUint32(base + 8, table.offset, true);
    view.setUint32(base + 12, table.length, true);
    view.setUint32(base + 16, table.rawLength, true);
    view.setUint32(base + 20, table.crc32, true);
  });
  return { bytes, view, entries, directoryOffset };
}

function invalid(mutator, match) {
  const data = fixture();
  mutator(data);
  assert.throws(() => parseCatalogueContainer(data.bytes),
    error => error instanceof CatalogueFormatError && match.test(error.message));
}

test("CELD v1 parses a bounded directory from a typed-array view", () => {
  const data = fixture({
    tables: [
      { type: CatalogueTable.STARS, count: 1627, length: 24, crc32: 0x12345678 },
      { type: CatalogueTable.STRINGS, count: 18, length: 12 }
    ],
    manifestLength: 8
  });
  const padded = new Uint8Array(data.bytes.length + 9);
  padded.set(data.bytes, 5);
  const parsed = parseCatalogueContainer(padded.subarray(5));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.tables.length, 2);
  assert.deepEqual(parsed.tables[0], {
    type: CatalogueTable.STARS, flags: 0, count: 1627,
    offset: data.entries[0].offset, length: 24, rawLength: 24, crc32: 0x12345678
  });
  assert.equal(parsed.manifestLength, 8);
  assert.deepEqual([...parsed.sourceHash], Array(32).fill(0));
});

test("CELD v1 accepts a compressed table only when raw length is credible", () => {
  const data = fixture({ tables: [{
    type: CatalogueTable.MILKY_WAY, count: 5, length: 12, rawLength: 48,
    flags: CatalogueTableFlag.COMPRESSED
  }] });
  assert.equal(parseCatalogueContainer(data.bytes).tables[0].rawLength, 48);
});

test("CELD rejects malformed headers", () => {
  invalid(({ bytes }) => { bytes[0] = 0; }, /magic/);
  invalid(({ view }) => { view.setUint16(4, 2, true); }, /unsupported version/);
  invalid(({ view }) => { view.setUint16(6, 60, true); }, /header length/);
  invalid(({ view }) => { view.setUint32(8, 1, true); }, /container flags/);
  invalid(({ view }) => { view.setUint16(14, 20, true); }, /entry size/);
  invalid(({ view }) => { view.setUint32(28, 1, true); }, /reserved/);
});

test("CELD rejects directory and manifest range lies", () => {
  invalid(({ view }) => { view.setUint32(16, 66, true); }, /directory offset/);
  invalid(({ view }) => { view.setUint32(16, 64, true); view.setUint16(12, 1000, true); }, /directory is outside/);
  invalid(({ view }) => { view.setUint32(20, 80, true); view.setUint32(24, 4, true); }, /manifest overlaps/);
  invalid(({ view }) => { view.setUint32(20, 1, true); }, /must both be zero/);
  invalid(({ view }) => { view.setUint32(20, 1, true); view.setUint32(24, 4, true); }, /manifest offset/);
});

test("CELD rejects invalid table directory entries", () => {
  invalid(({ view, directoryOffset }) => { view.setUint16(directoryOffset, 99, true); }, /unknown type/);
  invalid(({ view, directoryOffset }) => { view.setUint16(directoryOffset + 2, 2, true); }, /unknown flags/);
  invalid(({ view, directoryOffset }) => { view.setUint32(directoryOffset + 4, 0, true); }, /zero records/);
  invalid(({ view, directoryOffset }) => { view.setUint32(directoryOffset + 8, 65, true); }, /offset is not four-byte aligned/);
  invalid(({ view, directoryOffset }) => { view.setUint32(directoryOffset + 12, 0, true); }, /empty payload/);
  invalid(({ view, directoryOffset }) => { view.setUint32(directoryOffset + 16, 8, true); }, /stored\/raw lengths differ/);
  invalid(({ view, directoryOffset }) => { view.setUint32(directoryOffset + 8, 0xfffffff0, true); }, /outside container/);
});

test("CELD rejects table overlap and duplicate types", () => {
  const overlap = fixture({ tables: [
    { type: CatalogueTable.STARS, count: 1, length: 8, offset: 112 },
    { type: CatalogueTable.STRINGS, count: 1, length: 8, offset: 116 }
  ] });
  assert.throws(() => parseCatalogueContainer(overlap.bytes), /overlaps table STARS/);

  const duplicate = fixture({ tables: [
    { type: CatalogueTable.STARS, count: 1, length: 4 },
    { type: CatalogueTable.STARS, count: 1, length: 4 }
  ] });
  assert.throws(() => parseCatalogueContainer(duplicate.bytes), /duplicate STARS/);
});

test("CELD writer canonicalises table order and parser accepts its output", () => {
  const one = writeCatalogueContainer({ tables: [
    { type: CatalogueTable.STRINGS, count: 1, bytes: Uint8Array.of(1) },
    { type: CatalogueTable.STARS, count: 1, bytes: Uint8Array.of(2) }
  ] });
  const two = writeCatalogueContainer({ tables: [
    { type: CatalogueTable.STARS, count: 1, bytes: Uint8Array.of(2) },
    { type: CatalogueTable.STRINGS, count: 1, bytes: Uint8Array.of(1) }
  ] });
  assert.deepEqual(one, two);
  assert.deepEqual(parseCatalogueContainer(one).tables.map(table => table.type),
    [CatalogueTable.STARS, CatalogueTable.STRINGS]);
});

test("CELD front-coded strings preserve UTF-8 lexical values", () => {
  const encoded = encodeStrings(["Sirius", "Alpha Centauri", "Sirius", "Ανδρομέδα"]);
  assert.deepEqual(decodeStrings(encoded.bytes), ["Alpha Centauri", "Sirius", "Ανδρομέδα"]);
  assert.equal(encoded.ids.get("Sirius"), 1);
});

test("CELD star builder is deterministic and round-trips selected upstream records", () => {
  const stars = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/stars.6.json"), "utf8"));
  const names = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/starnames.json"), "utf8"));
  const options = { stars, starNames: names, starsLimit: 5, starNamesLimit: 1.2,
    sourceHash: Uint8Array.from({ length: 32 }, (_, index) => index) };
  const first = buildStarsCatalogue(options);
  const second = buildStarsCatalogue({ ...options, stars: JSON.parse(JSON.stringify(stars)), starNames: JSON.parse(JSON.stringify(names)) });
  assert.deepEqual(first, second);
  const parsed = parseCatalogueContainer(first);
  assert.deepEqual(parsed.tables.map(table => [table.type, table.count]), [
    [CatalogueTable.STARS, 1627], [CatalogueTable.STAR_LABELS, 18], [CatalogueTable.STRINGS, 18]
  ]);
  assert.deepEqual([...parsed.sourceHash], [...options.sourceHash]);

  const decoded = decodeStarsCatalogue(first);
  const expected = stars.features.filter(feature => feature.properties.mag <= 5)
    .sort((a, b) => a.id - b.id);
  assert.equal(decoded.stars.length, expected.length);
  for (const [index, record] of decoded.stars.entries()) {
    const source = expected[index];
    assert.equal(record.id, source.id);
    assert.equal(record.mag, source.properties.mag);
    assert.ok(Math.abs(record.coordinates[0] - ((source.geometry.coordinates[0] + 360) % 360)) < 0.00002);
    assert.ok(Math.abs(record.coordinates[1] - source.geometry.coordinates[1]) < 0.00002);
    assert.equal(record.bv, source.properties.bv === "" ? null : Number(source.properties.bv));
  }
  const expectedLabels = expected.filter(feature => feature.properties.mag <= 1.2 && names[feature.id]?.name)
    .map(feature => ({ id: feature.id, name: names[feature.id].name }));
  assert.deepEqual(decoded.labels, expectedLabels);
});

test("CELD constellation tables are deterministic and retain label/line structure", () => {
  const labels = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/constellations.json"), "utf8"));
  const lines = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/constellations.lines.json"), "utf8"));
  const options = {constellations: labels, constellationLines: lines,
    sourceHash: Uint8Array.from({length: 32}, (_, index) => 31 - index)};
  const first = buildConstellationsCatalogue(options);
  const second = buildConstellationsCatalogue({
    ...options, constellations: JSON.parse(JSON.stringify(labels)), constellationLines: JSON.parse(JSON.stringify(lines))
  });
  assert.deepEqual(first, second);
  const parsed = parseCatalogueContainer(first);
  assert.deepEqual(parsed.tables.map(table => [table.type, table.count]), [
    [CatalogueTable.CONSTELLATION_LABELS, 89],
    [CatalogueTable.CONSTELLATION_LINES, 89],
    [CatalogueTable.STRINGS, 88]
  ]);

  const decoded = decodeConstellationsCatalogue(first);
  const expectedLabels = labels.features.map(feature => ({
    id: feature.id, label: feature.properties.desig, rank: Number(feature.properties.rank),
    coordinates: [((feature.geometry.coordinates[0] % 360) + 360) % 360, feature.geometry.coordinates[1]]
  })).sort((a, b) => utf8Compare(a.id, b.id) || a.coordinates[0] - b.coordinates[0] || a.coordinates[1] - b.coordinates[1]);
  assert.equal(decoded.labels.length, expectedLabels.length);
  decoded.labels.forEach((record, index) => {
    const expected = expectedLabels[index];
    assert.equal(record.id, expected.id);
    assert.equal(record.label, expected.label);
    assert.equal(record.rank, expected.rank);
    assert.ok(Math.abs(record.coordinates[0] - expected.coordinates[0]) < 0.00002);
    assert.ok(Math.abs(record.coordinates[1] - expected.coordinates[1]) < 0.00002);
  });

  const expectedLines = lines.features.map(feature => ({
    id: feature.id, rank: Number(feature.properties.rank), segments: feature.geometry.coordinates
  })).sort((a, b) => utf8Compare(a.id, b.id) || a.rank - b.rank ||
    a.segments[0][0][0] - b.segments[0][0][0] || a.segments[0][0][1] - b.segments[0][0][1]);
  assert.equal(decoded.lines.length, expectedLines.length);
  decoded.lines.forEach((record, index) => {
    const expected = expectedLines[index];
    assert.equal(record.id, expected.id);
    assert.equal(record.rank, expected.rank);
    assert.equal(record.segments.length, expected.segments.length);
    record.segments.forEach((segment, segmentIndex) => {
      assert.equal(segment.length, expected.segments[segmentIndex].length);
      segment.forEach((point, pointIndex) => {
        const source = expected.segments[segmentIndex][pointIndex];
        assert.ok(Math.abs(point[0] - (((source[0] % 360) + 360) % 360)) < 0.00002);
        assert.ok(Math.abs(point[1] - source[1]) < 0.00002);
      });
    });
  });
});

test("CELD DSO profiles round-trip exact bright-source fields and sparse English names", () => {
  const stars = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/stars.6.json"), "utf8"));
  const starNames = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/starnames.json"), "utf8"));
  const dsos = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/dsos.bright.json"), "utf8"));
  const dsoNames = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/dsonames.json"), "utf8"));
  const options = { stars, starNames, dsos, dsoNames, starsLimit: 5, starNamesLimit: 1.2,
    dsoProfile: "bright", sourceHash: new Uint8Array(32) };
  const first = buildCatalogue(options);
  const second = buildCatalogue({ ...options, dsos: JSON.parse(JSON.stringify(dsos)), dsoNames: JSON.parse(JSON.stringify(dsoNames)) });
  assert.deepEqual(first, second);
  const parsed = parseCatalogueContainer(first);
  assert.deepEqual(parsed.tables.slice(0, 4).map(table => [table.type, table.count]), [
    [CatalogueTable.STARS, 1627], [CatalogueTable.STAR_LABELS, 18],
    [CatalogueTable.DSOS, 32], [CatalogueTable.DSO_NAMES, 30]
  ]);

  const decoded = decodeDsosCatalogue(first);
  const expected = dsos.features.map(feature => ({
    id: feature.id, desig: feature.properties.desig, type: feature.properties.type,
    coordinates: feature.geometry.coordinates, mag: Number(feature.properties.mag), dim: feature.properties.dim
  })).sort((a, b) => (a.id > b.id) - (a.id < b.id));
  assert.equal(decoded.dsos.length, 32);
  for (const [index, record] of decoded.dsos.entries()) {
    const source = expected[index];
    assert.equal(record.id, source.id);
    assert.equal(record.desig, source.desig);
    assert.equal(record.type, source.type);
    assert.equal(record.mag, source.mag);
    assert.equal(record.dim, source.dim);
    assert.ok(Math.abs(record.coordinates[0] - ((source.coordinates[0] + 360) % 360)) < 0.00002);
    assert.ok(Math.abs(record.coordinates[1] - source.coordinates[1]) < 0.00002);
  }
  const expectedNames = expected.filter(dso => dsoNames[dso.id]?.name)
    .map(dso => ({ id: dso.id, name: dsoNames[dso.id].name }));
  assert.deepEqual(decoded.names, expectedNames);

  const notable = buildCatalogue({ ...options, dsoProfile: "notable" });
  const notableDecoded = decodeDsosCatalogue(notable);
  assert.equal(notableDecoded.dsos.length, 30);
  assert.deepEqual(notableDecoded.dsos.map(dso => dso.id), expectedNames.map(dso => dso.id));
});

test("CELD aggregate profile owns one shared STRINGS table", () => {
  const data = name => JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data", name), "utf8"));
  const container = buildCatalogue({
    stars: data("stars.6.json"), starNames: data("starnames.json"), starsLimit: 5, starNamesLimit: 1.2,
    dsos: data("dsos.bright.json"), dsoNames: data("dsonames.json"), dsoProfile: "notable",
    constellations: data("constellations.json"), constellationLines: data("constellations.lines.json"),
    planets: data("planets.json"), planetIds: ["mer", "ven", "mar", "jup"], sourceHash: new Uint8Array(32)
  });
  const tables = parseCatalogueContainer(container).tables;
  assert.deepEqual(tables.map(table => table.type), [
    CatalogueTable.STARS, CatalogueTable.STAR_LABELS, CatalogueTable.DSOS, CatalogueTable.DSO_NAMES,
    CatalogueTable.CONSTELLATION_LABELS, CatalogueTable.CONSTELLATION_LINES, CatalogueTable.PLANETS,
    CatalogueTable.STRINGS
  ]);
  assert.equal(tables.filter(table => table.type === CatalogueTable.STRINGS).length, 1);
});

test("CELD PLANETS profile is deterministic, forces observer bodies, and preserves Kepler input", () => {
  const planets = JSON.parse(fs.readFileSync(path.join(ROOT, "harness/data/planets.json"), "utf8"));
  const options = {planets, planetIds: ["mar", "jup"],
    sourceHash: Uint8Array.from({length: 32}, (_, index) => index ^ 0x5a)};
  const first = buildPlanetsCatalogue(options);
  const second = buildPlanetsCatalogue({...options, planets: JSON.parse(JSON.stringify(planets))});
  assert.deepEqual(first, second);
  const parsed = parseCatalogueContainer(first);
  assert.deepEqual(parsed.tables.map(table => [table.type, table.count]), [[CatalogueTable.PLANETS, 5]]);
  const decoded = decodePlanetsCatalogue(first);
  assert.deepEqual(Object.keys(decoded), ["sol", "lun", "ter", "mar", "jup"]);
  for (const id of Object.keys(decoded)) {
    assert.equal(decoded[id].id, planets[id].id);
    assert.equal(decoded[id].H, Number(planets[id].H));
    assert.equal(decoded[id].elements.length, planets[id].elements.length);
    if (!decoded[id].elements.length) continue;
    const expected = planets[id].elements[0], actual = decoded[id].elements[0];
    assert.equal(actual.ep, expected.ep);
    for (const [field, value] of Object.entries(expected)) {
      if (field === "ep") continue;
      assert.equal(actual[field], Number(value), `${id}.${field}`);
    }
  }
  assert.throws(() => buildPlanetsCatalogue({planets, planetIds: ["bogus"]}), /unknown planet/);
  const malformed = first.slice();
  const table = parsed.tables[0], view = new DataView(malformed.buffer);
  view.setUint16(table.offset + 4, 0, true);
  assert.throws(() => decodePlanetsCatalogue(malformed), /record offset/);
});

test("CELD builder CLI parses planet profiles and retains mandatory bodies in output", () => {
  const options = parseArguments(["--output", "out.celd", "--planets", "mer,ven"]);
  assert.deepEqual(options.planetIds, ["mer", "ven"]);
  assert.throws(() => parseArguments(["--output", "out.celd", "--planets", ""]), /at least one id/);
});
