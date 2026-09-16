/* CELD payloads materialised into the renderer's existing GeoJSON-ish shape. */
import { CatalogueTable, parseCatalogueContainer } from "./catalogue.js";

const RA_SCALE = 0x1000000 / 360;
const STAR_BYTES = 14, DSO_BYTES = 15, CONSTELLATION_LABEL_BYTES = 11;
const BV_MISSING = 0x7fff, DSO_MAG_UNKNOWN = 0x7fff;
const DSO_TYPES = ["gg", "g", "s", "s0", "sd", "i", "e", "oc", "gc", "en", "bn", "sfr", "rn", "pn", "snr", "dn", "pos"];
const PLANET_IDS = ["sol", "lun", "mer", "ven", "ter", "mar", "cer", "ves", "jup", "sat", "ura", "nep", "plu", "eri", "mak", "hau", "pal"];
const PLANET_EPOCH_UNIX_DAY = 86400000, PLANET_EPOCH_UNIX_OFFSET = 2440588;
const text = new TextDecoder();

function bytesOf(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  throw new TypeError("CELD source must be bytes");
}

function u24(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16); }
function dec(value) { if (value & 0x800000) value -= 0x1000000; return value / RA_SCALE; }
function point(bytes, offset) { return [u24(bytes, offset) / RA_SCALE, dec(u24(bytes, offset + 3))]; }
function feature(id, properties, coordinates) { return {type: "Feature", id, properties, geometry: {type: "Point", coordinates}}; }
function collection(features) { return {type: "FeatureCollection", features}; }

function getUleb(bytes, state) {
  let value = 0, factor = 1;
  for (let n = 0; n < 8; n++) {
    if (state.offset >= bytes.length) throw new RangeError("truncated CELD string ULEB");
    const byte = bytes[state.offset++];
    value += (byte & 0x7f) * factor;
    if (!(byte & 0x80)) return value;
    factor *= 128;
  }
  throw new RangeError("CELD string ULEB exceeds safe range");
}
function u16(bytes, state, name) {
  if (state.offset + 2 > bytes.length) throw new RangeError(`truncated CELD ${name}`);
  const value = bytes[state.offset] | (bytes[state.offset + 1] << 8); state.offset += 2;
  return value;
}
function unzigzag(value) { return value & 1 ? -(value + 1) / 2 : value / 2; }

function strings(bytes) {
  if (!bytes || bytes.length < 2) throw new RangeError("CELD STRINGS table missing or truncated");
  const count = bytes[0] | (bytes[1] << 8), state = {offset: 2}, output = [];
  let previous = new Uint8Array();
  for (let index = 0; index < count; index++) {
    const prefix = getUleb(bytes, state), length = getUleb(bytes, state);
    if (prefix > previous.length || length > bytes.length - state.offset) throw new RangeError("invalid CELD front-coded string");
    const current = new Uint8Array(prefix + length);
    current.set(previous.subarray(0, prefix));
    current.set(bytes.subarray(state.offset, state.offset + length), prefix);
    state.offset += length; output.push(text.decode(current)); previous = current;
  }
  if (state.offset !== bytes.length) throw new RangeError("trailing CELD STRINGS bytes");
  return output;
}

function tables(source) {
  const bytes = bytesOf(source), parsed = parseCatalogueContainer(bytes), found = new Map();
  for (const table of parsed.tables) found.set(table.type, bytes.slice(table.offset, table.offset + table.length));
  return {parsed, found};
}

function requiredTable(found, type) {
  const bytes = found.get(type);
  if (!bytes) throw new RangeError(`CELD missing required ${Object.entries(CatalogueTable).find(([, value]) => value === type)[0]} table`);
  return bytes;
}

function stringAt(values, index, table) {
  if (index >= values.length) throw new RangeError(`${table} string id outside STRINGS table`);
  return values[index];
}

function stars(bytes) {
  if (bytes.length % STAR_BYTES) throw new RangeError("invalid STARS table length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
  for (let offset = 0; offset < bytes.length; offset += STAR_BYTES) {
    let qDec = u24(bytes, offset + 7); if (qDec & 0x800000) qDec -= 0x1000000;
    const bv = view.getInt16(offset + 12, true);
    result.push(feature(view.getUint32(offset, true), {mag: view.getInt16(offset + 10, true) / 100,
      bv: bv === BV_MISSING ? "" : bv / 1000}, [u24(bytes, offset + 4) / RA_SCALE, qDec / RA_SCALE]));
  }
  return collection(result);
}

function starNames(bytes, values) {
  if (bytes.length % 6) throw new RangeError("invalid STAR_LABELS table length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), output = {};
  for (let offset = 0; offset < bytes.length; offset += 6)
    output[view.getUint32(offset, true)] = {name: stringAt(values, view.getUint16(offset + 4, true), "STAR_LABELS")};
  return output;
}

function dsos(bytes, values) {
  if (bytes.length % DSO_BYTES) throw new RangeError("invalid DSOS table length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
  for (let offset = 0; offset < bytes.length; offset += DSO_BYTES) {
    const type = DSO_TYPES[bytes[offset + 4]]; if (!type) throw new RangeError("DSOS type id outside CELD enum");
    result.push(feature(stringAt(values, view.getUint16(offset, true), "DSOS"), {
      desig: stringAt(values, view.getUint16(offset + 2, true), "DSOS"), type,
      mag: view.getInt16(offset + 11, true) === DSO_MAG_UNKNOWN ? 999 : view.getInt16(offset + 11, true) / 100,
      dim: stringAt(values, view.getUint16(offset + 13, true), "DSOS")
    }, point(bytes, offset + 5)));
  }
  return collection(result);
}

function dsoNames(bytes, values) {
  if (bytes.length % 4) throw new RangeError("invalid DSO_NAMES table length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), output = {};
  for (let offset = 0; offset < bytes.length; offset += 4)
    output[stringAt(values, view.getUint16(offset, true), "DSO_NAMES")] = {name: stringAt(values, view.getUint16(offset + 2, true), "DSO_NAMES")};
  return output;
}

function constellationLabels(bytes, values) {
  if (bytes.length % CONSTELLATION_LABEL_BYTES) throw new RangeError("invalid CONSTELLATION_LABELS table length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), output = [];
  for (let offset = 0; offset < bytes.length; offset += CONSTELLATION_LABEL_BYTES) {
    const desig = stringAt(values, view.getUint16(offset + 2, true), "CONSTELLATION_LABELS");
    output.push(feature(stringAt(values, view.getUint16(offset, true), "CONSTELLATION_LABELS"),
      {desig, name: desig, rank: String(bytes[offset + 4])}, point(bytes, offset + 5)));
  }
  return collection(output);
}

function constellationLines(bytes, count, values) {
  const state = {offset: 0}, output = [];
  const need = (length, name) => { if (length > bytes.length - state.offset) throw new RangeError(`truncated CONSTELLATION_LINES ${name}`); };
  const u16 = name => { need(2, name); const value = bytes[state.offset] | (bytes[state.offset + 1] << 8); state.offset += 2; return value; };
  for (let record = 0; record < count; record++) {
    const id = stringAt(values, u16("id"), "CONSTELLATION_LINES"); need(3, "header");
    const rank = bytes[state.offset++], segmentCount = u16("segment count");
    if (!segmentCount) throw new RangeError("CONSTELLATION_LINES has zero segments");
    const segments = [];
    for (let segment = 0; segment < segmentCount; segment++) {
      const points = u16("point count"); if (points < 2) throw new RangeError("CONSTELLATION_LINES segment has fewer than two points");
      need(points * 6, "coordinates"); const coordinates = [];
      for (let pointIndex = 0; pointIndex < points; pointIndex++) { coordinates.push(point(bytes, state.offset)); state.offset += 6; }
      segments.push(coordinates);
    }
    output.push({type: "Feature", id, properties: {rank: String(rank)}, geometry: {type: "MultiLineString", coordinates: segments}});
  }
  if (state.offset !== bytes.length) throw new RangeError("trailing CONSTELLATION_LINES bytes");
  return collection(output);
}

function planets(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6 || view.getUint16(0, true) !== 1) throw new RangeError("invalid PLANETS table header");
  const count = view.getUint16(2, true), header = 4 + (count + 1) * 2;
  if (bytes.length < header) throw new RangeError("invalid PLANETS table count");
  const output = {};
  for (let index = 0; index < count; index++) {
    const start = view.getUint16(4 + index * 2, true), end = view.getUint16(6 + index * 2, true);
    if (start < header || end < start || end > bytes.length || end - start < 16) throw new RangeError("invalid PLANETS record offset");
    const id = PLANET_IDS[bytes[start]], form = bytes[start + 1]; if (!id || output[id]) throw new RangeError("invalid PLANETS body id");
    const fields = form === 1 ? ["a", "e", "i", "L", "W", "N", "da", "de", "di", "dL", "dW", "dN"] : form === 2 ? ["a", "e", "i", "M", "w", "N", "n"] : form === 0 ? [] : null;
    if (!fields || end - start !== 16 + fields.length * 8) throw new RangeError("invalid PLANETS record form");
    const H = view.getFloat64(start + 8, true); if (!Number.isFinite(H)) throw new RangeError(`planet ${id} H is non-finite`);
    if (!fields.length) { if (id !== "sol" && id !== "lun") throw new RangeError("invalid synthetic PLANETS body"); output[id] = {id, H, elements: []}; continue; }
    const epoch = view.getInt32(start + 4, true), date = new Date((epoch - PLANET_EPOCH_UNIX_OFFSET) * PLANET_EPOCH_UNIX_DAY);
    if (!Number.isFinite(date.valueOf())) throw new RangeError(`planet ${id} epoch invalid`);
    const element = {ep: date.toISOString().slice(0, 10)};
    fields.forEach((field, fieldIndex) => { const value = view.getFloat64(start + 16 + fieldIndex * 8, true); if (!Number.isFinite(value)) throw new RangeError(`planet ${id} ${field} non-finite`); element[field] = value; });
    output[id] = {id, H, elements: [element]};
  }
  if (view.getUint16(4 + count * 2, true) !== bytes.length) throw new RangeError("invalid PLANETS trailing offset");
  for (const id of ["ter", "sol", "lun"]) if (!output[id]) throw new RangeError(`PLANETS missing required ${id}`);
  return output;
}

function milkyWay(bytes, count) {
  const state = {offset: 0};
  if (u16(bytes, state, "MILKY_WAY version") !== 1) throw new RangeError("unsupported CELD MILKY_WAY version");
  if (u16(bytes, state, "MILKY_WAY feature count") !== count) throw new RangeError("CELD MILKY_WAY feature count mismatch");
  const features = [];
  for (let featureIndex = 0; featureIndex < count; featureIndex++) {
    if (state.offset >= bytes.length) throw new RangeError("truncated CELD MILKY_WAY feature id");
    const idLength = bytes[state.offset++];
    if (!idLength || idLength > bytes.length - state.offset) throw new RangeError("invalid CELD MILKY_WAY feature id");
    const id = text.decode(bytes.subarray(state.offset, state.offset + idLength)); state.offset += idLength;
    const polygons = [];
    for (let polygon = 0, polygonCount = u16(bytes, state, "MILKY_WAY polygon count"); polygon < polygonCount; polygon++) {
      const rings = [];
      for (let ringIndex = 0, ringCount = u16(bytes, state, "MILKY_WAY ring count"); ringIndex < ringCount; ringIndex++) {
        const points = u16(bytes, state, "MILKY_WAY point count");
        if (points < 3 || state.offset + 6 > bytes.length) throw new RangeError("invalid CELD MILKY_WAY ring");
        let ra = u24(bytes, state.offset), qDec = u24(bytes, state.offset + 3); state.offset += 6;
        if (qDec & 0x800000) qDec -= 0x1000000;
        const ring = [[ra / RA_SCALE, qDec / RA_SCALE]];
        for (let pointIndex = 1; pointIndex < points; pointIndex++) {
          ra += unzigzag(getUleb(bytes, state)); qDec += unzigzag(getUleb(bytes, state));
          if (ra < 0 || ra > 0xffffff || qDec < -0x800000 || qDec > 0x7fffff) throw new RangeError("CELD MILKY_WAY coordinate outside range");
          ring.push([ra / RA_SCALE, qDec / RA_SCALE]);
        }
        ring.push(ring[0].slice()); rings.push(ring);
      }
      polygons.push(rings);
    }
    features.push({type: "Feature", id, properties: {}, geometry: {type: "MultiPolygon", coordinates: polygons}});
  }
  if (state.offset !== bytes.length) throw new RangeError("trailing CELD MILKY_WAY bytes");
  return collection(features);
}

const DATASETS = Object.freeze(["stars", "starLabels", "dsos", "dsoNames", "constellationLabels", "constellationLines", "planets", "milkyWay"]);

// CELD v1 only carries the label variants its builders encode. Keep this
// explicit: silently drawing blank labels is worse than refusing a mismatched
// profile. Milky Way and borders receive their own tables later.
export function catalogueRequirements(cfg) {
  if (cfg.constellations.bounds) throw new RangeError("CELD v1 has no constellation borders table yet");
  if (cfg.stars.show && cfg.stars.designation)
    throw new RangeError("CELD v1 does not support star designation labels");
  if (cfg.stars.show && cfg.stars.propername && cfg.stars.propernameType !== "name")
    throw new RangeError("CELD v1 supports star proper names only with propernameType 'name'");
  if (cfg.constellations.names && cfg.constellations.namesType !== "desig")
    throw new RangeError("CELD v1 supports constellation labels only with namesType 'desig'");
  if (cfg.dsos.show && cfg.dsos.names && !["desig", "name"].includes(cfg.dsos.namesType))
    throw new RangeError("CELD v1 supports DSO names only with namesType 'desig' or 'name'");
  return {
    milkyWay: cfg.mw.show,
    stars: cfg.stars.show,
    starLabels: cfg.stars.show && cfg.stars.propername,
    dsos: cfg.dsos.show,
    dsoNames: cfg.dsos.show && cfg.dsos.names && cfg.dsos.namesType === "name",
    constellationLabels: cfg.constellations.names,
    constellationLines: cfg.constellations.lines,
    planets: cfg.planets.show
  };
}

// Required datasets are materialised into fresh objects. Unrequested tables
// stay opaque; missing requested data fails early with its CELD table name.
export function materialiseCatalogue(source, required = {}) {
  if (!required || typeof required !== "object" || Array.isArray(required)) throw new TypeError("CELD required datasets must be an object");
  for (const key of Object.keys(required)) if (!DATASETS.includes(key)) throw new RangeError(`unknown CELD dataset ${key}`);
  const {parsed, found} = tables(source), output = {};
  const need = key => required[key] === true;
  const needStrings = need("starLabels") || need("dsos") || need("dsoNames") || need("constellationLabels") || need("constellationLines");
  const values = needStrings ? strings(requiredTable(found, CatalogueTable.STRINGS)) : null;
  if (need("stars")) output.stars = stars(requiredTable(found, CatalogueTable.STARS));
  if (need("starLabels")) output.starLabels = starNames(requiredTable(found, CatalogueTable.STAR_LABELS), values);
  if (need("dsos")) output.dsos = dsos(requiredTable(found, CatalogueTable.DSOS), values);
  if (need("dsoNames")) output.dsoNames = dsoNames(requiredTable(found, CatalogueTable.DSO_NAMES), values);
  if (need("constellationLabels")) output.constellationLabels = constellationLabels(requiredTable(found, CatalogueTable.CONSTELLATION_LABELS), values);
  if (need("constellationLines")) {
    const table = parsed.tables.find(table => table.type === CatalogueTable.CONSTELLATION_LINES);
    output.constellationLines = constellationLines(requiredTable(found, CatalogueTable.CONSTELLATION_LINES), table.count, values);
  }
  if (need("planets")) output.planets = planets(requiredTable(found, CatalogueTable.PLANETS));
  if (need("milkyWay")) {
    const table = parsed.tables.find(table => table.type === CatalogueTable.MILKY_WAY);
    output.milkyWay = milkyWay(requiredTable(found, CatalogueTable.MILKY_WAY), table.count);
  }
  return output;
}
