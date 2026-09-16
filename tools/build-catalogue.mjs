#!/usr/bin/env node
/* Build selected CELD tables from upstream GeoJSON catalogue inputs.
 *
 * Foundation only: STARS, DSOS, sparse labels, and STRINGS.  Keeping this
 * separate from map code means a profile can be measured before renderer work
 * starts pretending JSON is a useful storage format.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CatalogueTable, parseCatalogueContainer, writeCatalogueContainer } from "../src/catalogue.js";
import { simplifyMilkyWay } from "./simplify-milky-way.mjs";

const STAR_BYTES = 14;
const CONSTELLATION_LABEL_BYTES = 11;
const DSO_BYTES = 15;
const RA_SCALE = 0x1000000 / 360;
const BV_MISSING = 0x7fff;
const DSO_MAG_UNKNOWN = 0x7fff;
const DSO_TYPES = ["gg", "g", "s", "s0", "sd", "i", "e", "oc", "gc", "en", "bn", "sfr", "rn", "pn", "snr", "dn", "pos"];
const DSO_TYPE_IDS = new Map(DSO_TYPES.map((type, index) => [type, index]));
const PLANET_IDS = ["sol", "lun", "mer", "ven", "ter", "mar", "cer", "ves", "jup", "sat", "ura", "nep", "plu", "eri", "mak", "hau", "pal"];
const PLANET_ID_CODES = new Map(PLANET_IDS.map((id, index) => [id, index]));
const PLANET_SYNTHETIC = 0;
const PLANET_LWN = 1;
const PLANET_MWN = 2;
const PLANET_EPOCH_UNIX_DAY = 86400000;
const PLANET_EPOCH_UNIX_OFFSET = 2440588;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function requireFinite(value, name) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
  return number;
}

function requireLimit(value, name) {
  const limit = requireFinite(value, name);
  if (limit < -100 || limit > 100) throw new RangeError(`${name} is implausible`);
  return limit;
}

function writeU24(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}

function readU24(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function quantizeRa(value) {
  const degrees = requireFinite(value, "star RA");
  if (degrees < -360 || degrees > 360) throw new RangeError(`star RA ${degrees} outside [-360, 360]`);
  return Math.min(0xffffff, Math.round(((degrees % 360) + 360) % 360 * RA_SCALE));
}

function quantizeDec(value) {
  const degrees = requireFinite(value, "star declination");
  if (degrees < -90 || degrees > 90) throw new RangeError(`star declination ${degrees} outside [-90, 90]`);
  return Math.round(degrees * RA_SCALE);
}

function dequantizeDec(value) {
  if (value & 0x800000) value -= 0x1000000;
  return value / RA_SCALE;
}

function putUleb(out, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("ULEB value invalid");
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
}

function getUleb(bytes, state) {
  let value = 0, factor = 1;
  for (let n = 0; n < 8; n++) {
    if (state.offset >= bytes.length) throw new RangeError("truncated ULEB");
    const byte = bytes[state.offset++];
    value += (byte & 0x7f) * factor;
    if (!(byte & 0x80)) return value;
    factor *= 128;
  }
  throw new RangeError("ULEB exceeds safe range");
}

function putU16(out, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError("u16 value invalid");
  out.push(value & 0xff, value >>> 8);
}

function getU16(bytes, state, name) {
  if (state.offset + 2 > bytes.length) throw new RangeError(`truncated ${name}`);
  const value = bytes[state.offset] | (bytes[state.offset + 1] << 8);
  state.offset += 2;
  return value;
}

function zigzag(value) {
  if (!Number.isSafeInteger(value)) throw new RangeError("delta outside safe integer range");
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function unzigzag(value) {
  return value & 1 ? -(value + 1) / 2 : value / 2;
}

function utf8Compare(a, b) {
  const aa = encoder.encode(a), bb = encoder.encode(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    if (aa[i] !== bb[i]) return aa[i] - bb[i];
  }
  return aa.length - bb.length;
}

export function encodeStrings(strings) {
  const unique = [...new Set(strings)];
  if (unique.length > 0xffff) throw new RangeError("string table exceeds u16 ids");
  unique.sort(utf8Compare);
  const chunks = [unique.length & 0xff, unique.length >>> 8];
  let previous = new Uint8Array();
  for (const value of unique) {
    if (typeof value !== "string") throw new TypeError("string table contains non-string");
    const current = encoder.encode(value);
    let prefix = 0;
    while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix++;
    putUleb(chunks, prefix);
    putUleb(chunks, current.length - prefix);
    chunks.push(...current.subarray(prefix));
    previous = current;
  }
  return { bytes: Uint8Array.from(chunks), ids: new Map(unique.map((value, index) => [value, index])) };
}

export function decodeStrings(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2) throw new RangeError("truncated string table");
  const count = bytes[0] | (bytes[1] << 8);
  const state = { offset: 2 };
  const result = [];
  let previous = new Uint8Array();
  for (let index = 0; index < count; index++) {
    const prefix = getUleb(bytes, state), suffixLength = getUleb(bytes, state);
    if (prefix > previous.length || suffixLength > bytes.length - state.offset) throw new RangeError("invalid front-coded string");
    const current = new Uint8Array(prefix + suffixLength);
    current.set(previous.subarray(0, prefix));
    current.set(bytes.subarray(state.offset, state.offset + suffixLength), prefix);
    state.offset += suffixLength;
    result.push(decoder.decode(current));
    previous = current;
  }
  if (state.offset !== bytes.length) throw new RangeError("trailing bytes in string table");
  return result;
}

function normalisedStars(stars, limit) {
  if (!stars || stars.type !== "FeatureCollection" || !Array.isArray(stars.features))
    throw new TypeError("stars must be a GeoJSON FeatureCollection");
  const selected = [];
  for (const feature of stars.features) {
    const id = requireFinite(feature?.id, "star HIP");
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new RangeError(`star HIP ${id} outside u32`);
    const mag = requireFinite(feature?.properties?.mag, `star ${id} magnitude`);
    if (mag > limit) continue;
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2) throw new TypeError(`star ${id} coordinates missing`);
    const bv = feature.properties?.bv === "" || feature.properties?.bv === undefined || feature.properties?.bv === null
      ? null : requireFinite(feature.properties.bv, `star ${id} B-V`);
    selected.push({
      id, mag, bv, ra: coordinates[0], dec: coordinates[1],
      qRa: quantizeRa(coordinates[0]), qDec: quantizeDec(coordinates[1])
    });
  }
  selected.sort((a, b) => a.id - b.id);
  for (let i = 1; i < selected.length; i++)
    if (selected[i - 1].id === selected[i].id) throw new RangeError(`duplicate star HIP ${selected[i].id}`);
  return selected;
}

function encodeStars(records) {
  const bytes = new Uint8Array(records.length * STAR_BYTES);
  const view = new DataView(bytes.buffer);
  records.forEach((star, index) => {
    const offset = index * STAR_BYTES;
    const mag = Math.round(star.mag * 100);
    const bv = star.bv === null ? BV_MISSING : Math.round(star.bv * 1000);
    if (mag < -0x8000 || mag > 0x7fff || bv < -0x8000 || bv > 0x7fff ||
        (star.bv !== null && bv === BV_MISSING))
      throw new RangeError(`star ${star.id} magnitude/B-V does not fit CELD v1`);
    view.setUint32(offset, star.id, true);
    writeU24(bytes, offset + 4, star.qRa);
    writeU24(bytes, offset + 7, star.qDec < 0 ? star.qDec + 0x1000000 : star.qDec);
    view.setInt16(offset + 10, mag, true);
    view.setInt16(offset + 12, bv, true);
  });
  return bytes;
}

function starLabelRecords(records, names, limit) {
  if (!names || typeof names !== "object") throw new TypeError("star names must be an object");
  return records.flatMap(star => {
    const name = names[star.id]?.name;
    return star.mag <= limit && typeof name === "string" && name.length ? [{ id: star.id, name }] : [];
  });
}

function encodeStarLabels(labels, strings) {
  const bytes = new Uint8Array(labels.length * 6);
  const view = new DataView(bytes.buffer);
  labels.forEach((label, index) => {
    view.setUint32(index * 6, label.id, true);
    view.setUint16(index * 6 + 4, strings.get(label.name), true);
  });
  return bytes;
}

function normalisedDsos(dsos, dsoNames, profile) {
  if (profile !== "bright" && profile !== "notable") throw new RangeError(`unknown DSO profile ${profile}`);
  if (!dsos || dsos.type !== "FeatureCollection" || !Array.isArray(dsos.features))
    throw new TypeError("DSOs must be a GeoJSON FeatureCollection");
  if (!dsoNames || typeof dsoNames !== "object") throw new TypeError("DSO names must be an object");
  const selected = [];
  for (const feature of dsos.features) {
    const id = feature?.id, desig = feature?.properties?.desig;
    if (typeof id !== "string" || !id.length || typeof desig !== "string" || !desig.length)
      throw new TypeError("DSO id/desig missing");
    const name = dsoNames[id]?.name;
    // `bright` preserves upstream's hand-picked 32 records. `notable` has a
    // clear stable rule: records with an English proper name, not subjective
    // magnitude/surface-brightness guesses hidden in code.
    if (profile === "notable" && (typeof name !== "string" || !name.length)) continue;
    const type = feature.properties?.type;
    if (!DSO_TYPE_IDS.has(type)) throw new RangeError(`DSO ${id} has unknown type ${type}`);
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2) throw new TypeError(`DSO ${id} coordinates missing`);
    const mag = requireFinite(feature.properties?.mag, `DSO ${id} magnitude`);
    const dimension = feature.properties?.dim;
    if (typeof dimension !== "string") throw new TypeError(`DSO ${id} dimension missing`);
    selected.push({ id, desig, name: typeof name === "string" && name.length ? name : null,
      type, mag, dim: dimension, qRa: quantizeRa(coordinates[0]), qDec: quantizeDec(coordinates[1]) });
  }
  selected.sort((a, b) => utf8Compare(a.id, b.id));
  for (let index = 1; index < selected.length; index++)
    if (selected[index - 1].id === selected[index].id) throw new RangeError(`duplicate DSO ${selected[index].id}`);
  if (!selected.length) throw new RangeError("DSO profile selected zero records");
  return selected;
}

function encodeDsos(records, strings) {
  const bytes = new Uint8Array(records.length * DSO_BYTES);
  const view = new DataView(bytes.buffer);
  records.forEach((dso, index) => {
    const offset = index * DSO_BYTES;
    const mag = dso.mag === 999 ? DSO_MAG_UNKNOWN : Math.round(dso.mag * 100);
    if (mag < -0x8000 || mag >= DSO_MAG_UNKNOWN) throw new RangeError(`DSO ${dso.id} magnitude does not fit CELD v1`);
    view.setUint16(offset, strings.get(dso.id), true);
    view.setUint16(offset + 2, strings.get(dso.desig), true);
    bytes[offset + 4] = DSO_TYPE_IDS.get(dso.type);
    writeU24(bytes, offset + 5, dso.qRa);
    writeU24(bytes, offset + 8, dso.qDec < 0 ? dso.qDec + 0x1000000 : dso.qDec);
    view.setInt16(offset + 11, mag, true);
    view.setUint16(offset + 13, strings.get(dso.dim), true);
  });
  return bytes;
}

function encodeDsoNames(records, strings) {
  const labels = records.filter(dso => dso.name);
  const bytes = new Uint8Array(labels.length * 4);
  const view = new DataView(bytes.buffer);
  labels.forEach((dso, index) => {
    view.setUint16(index * 4, strings.get(dso.id), true);
    view.setUint16(index * 4 + 2, strings.get(dso.name), true);
  });
  return { labels, bytes };
}

function planetEpochDay(value, id) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new TypeError(`planet ${id} epoch must be YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw new RangeError(`planet ${id} epoch is invalid`);
  return Math.floor(date.valueOf() / PLANET_EPOCH_UNIX_DAY) + PLANET_EPOCH_UNIX_OFFSET;
}

function planetEpochString(day, id) {
  if (!Number.isInteger(day) || day < -2000000 || day > 4000000)
    throw new RangeError(`planet ${id} epoch day is invalid`);
  const date = new Date((day - PLANET_EPOCH_UNIX_OFFSET) * PLANET_EPOCH_UNIX_DAY);
  if (!Number.isFinite(date.valueOf())) throw new RangeError(`planet ${id} epoch is invalid`);
  return date.toISOString().slice(0, 10);
}

function planetNumber(value, id, field) {
  return requireFinite(value, `planet ${id} ${field}`);
}

function normalisedPlanets(planets, requested) {
  if (!planets || typeof planets !== "object" || Array.isArray(planets))
    throw new TypeError("planets must be an object");
  if (!Array.isArray(requested)) throw new TypeError("planet profile must be an array");
  const ids = new Set(["ter", "sol", "lun"]);
  for (const id of requested) {
    if (typeof id !== "string" || !PLANET_ID_CODES.has(id)) throw new RangeError(`unknown planet ${id}`);
    ids.add(id);
  }
  const records = [];
  for (const id of [...ids].sort((a, b) => PLANET_ID_CODES.get(a) - PLANET_ID_CODES.get(b))) {
    const source = planets[id];
    if (!source || typeof source !== "object") throw new RangeError(`planet ${id} missing from source`);
    const elements = source.elements;
    if ((id === "sol" || id === "lun")) {
      if (!Array.isArray(elements) || elements.length !== 0) throw new RangeError(`synthetic planet ${id} must have no elements`);
      records.push({id, form: PLANET_SYNTHETIC, epoch: 0, H: planetNumber(source.H, id, "H"), fields: []});
      continue;
    }
    if (!Array.isArray(elements) || elements.length !== 1 || !elements[0] || typeof elements[0] !== "object")
      throw new RangeError(`planet ${id} must have one element set`);
    const e = elements[0], lwn = ["a", "e", "i", "L", "W", "N"], mwn = ["a", "e", "i", "M", "w", "N", "n"];
    const base = Object.hasOwn(e, "L") ? lwn : mwn;
    if (!base.every(field => Object.hasOwn(e, field)) || (base === mwn && Object.hasOwn(e, "L")))
      throw new RangeError(`planet ${id} has unsupported element form`);
    const rates = base === lwn ? ["da", "de", "di", "dL", "dW", "dN"] : [];
    if (!rates.every(field => Object.hasOwn(e, field))) {
      if (base === lwn) throw new RangeError(`planet ${id} LWN elements require secular rates`);
    }
    records.push({id, form: base === lwn ? PLANET_LWN : PLANET_MWN, epoch: planetEpochDay(e.ep, id),
      H: planetNumber(source.H, id, "H"), fields: [...base, ...rates].map(field => planetNumber(e[field], id, field))});
  }
  return records;
}

function encodePlanets(records) {
  const sizes = records.map(record => 16 + record.fields.length * 8);
  const header = 4 + (records.length + 1) * 2;
  const total = header + sizes.reduce((sum, size) => sum + size, 0);
  if (total > 0xffff) throw new RangeError("PLANETS table exceeds u16 offsets");
  const bytes = new Uint8Array(total), view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true); view.setUint16(2, records.length, true);
  let offset = header;
  records.forEach((record, index) => {
    view.setUint16(4 + index * 2, offset, true);
    bytes[offset] = PLANET_ID_CODES.get(record.id); bytes[offset + 1] = record.form;
    view.setInt32(offset + 4, record.epoch, true); view.setFloat64(offset + 8, record.H, true);
    record.fields.forEach((value, field) => view.setFloat64(offset + 16 + field * 8, value, true));
    offset += sizes[index];
  });
  view.setUint16(4 + records.length * 2, offset, true);
  return bytes;
}

export function buildPlanetsCatalogue({planets, planetIds = PLANET_IDS, sourceHash} = {}) {
  const records = normalisedPlanets(planets, planetIds);
  return writeCatalogueContainer({sourceHash, tables: [{type: CatalogueTable.PLANETS, count: records.length, bytes: encodePlanets(records)}]});
}

export function decodePlanetsCatalogue(container) {
  const planetsTable = tableBytes(container, CatalogueTable.PLANETS);
  if (!planetsTable) return {};
  const bytes = planetsTable.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6 || view.getUint16(0, true) !== 1) throw new RangeError("invalid PLANETS table header");
  const count = view.getUint16(2, true), header = 4 + (count + 1) * 2;
  if (count !== planetsTable.table.count || bytes.length < header) throw new RangeError("invalid PLANETS table count");
  const output = {}, seen = new Set();
  for (let index = 0; index < count; index++) {
    const start = view.getUint16(4 + index * 2, true), end = view.getUint16(6 + index * 2, true);
    if (start < header || end < start || end > bytes.length || end - start < 16)
      throw new RangeError("invalid PLANETS record offset");
    const id = PLANET_IDS[bytes[start]], form = bytes[start + 1];
    if (!id || seen.has(id)) throw new RangeError("invalid PLANETS body id");
    seen.add(id);
    const epoch = view.getInt32(start + 4, true), H = view.getFloat64(start + 8, true);
    const names = form === PLANET_LWN ? ["a", "e", "i", "L", "W", "N", "da", "de", "di", "dL", "dW", "dN"] :
      form === PLANET_MWN ? ["a", "e", "i", "M", "w", "N", "n"] : form === PLANET_SYNTHETIC ? [] : null;
    if (!names || end - start !== 16 + names.length * 8 || !Number.isFinite(H)) throw new RangeError("invalid PLANETS record form");
    if (form === PLANET_SYNTHETIC) {
      if (id !== "sol" && id !== "lun") throw new RangeError("invalid synthetic PLANETS body");
      output[id] = {id, H, elements: []};
      continue;
    }
    const element = {ep: planetEpochString(epoch, id)};
    names.forEach((name, field) => {
      const value = view.getFloat64(start + 16 + field * 8, true);
      if (!Number.isFinite(value)) throw new RangeError(`planet ${id} ${name} is non-finite`);
      element[name] = value;
    });
    output[id] = {id, H, elements: [element]};
  }
  if (view.getUint16(4 + count * 2, true) !== bytes.length) throw new RangeError("invalid PLANETS trailing offset");
  for (const required of ["ter", "sol", "lun"]) if (!output[required]) throw new RangeError(`PLANETS missing required ${required}`);
  return output;
}

function encodeMilkyWay(data) {
  const out = [];
  putU16(out, 1); putU16(out, data.features.length);
  for (const feature of data.features) {
    if (typeof feature.id !== "string") throw new TypeError("Milky Way feature id missing");
    const id = encoder.encode(feature.id);
    if (!id.length || id.length > 0xff) throw new RangeError("Milky Way feature id too long");
    out.push(id.length, ...id);
    const polygons = feature.geometry?.coordinates;
    if (!Array.isArray(polygons) || !polygons.length) throw new TypeError(`Milky Way ${feature.id} polygons missing`);
    putU16(out, polygons.length);
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) throw new TypeError(`Milky Way ${feature.id} rings missing`);
      putU16(out, polygon.length);
      for (const closed of polygon) {
        if (!Array.isArray(closed) || closed.length < 4) throw new TypeError(`Milky Way ${feature.id} ring too short`);
        const ring = closed.slice(0, -1);
        if (ring.length < 3) throw new TypeError(`Milky Way ${feature.id} ring collapsed`);
        putU16(out, ring.length);
        let previousRa = 0, previousDec = 0;
        ring.forEach((point, index) => {
          const ra = quantizeRa(point[0]), dec = quantizeDec(point[1]);
          if (index === 0) {
            out.push(ra & 0xff, (ra >>> 8) & 0xff, (ra >>> 16) & 0xff);
            const signed = dec < 0 ? dec + 0x1000000 : dec;
            out.push(signed & 0xff, (signed >>> 8) & 0xff, (signed >>> 16) & 0xff);
          } else {
            putUleb(out, zigzag(ra - previousRa));
            putUleb(out, zigzag(dec - previousDec));
          }
          previousRa = ra; previousDec = dec;
        });
      }
    }
  }
  return Uint8Array.from(out);
}

// MW table is opt-in. It stores each source feature/polygon/ring in order;
// ring closure is implicit, first coordinate fixed-width, following points
// delta-varint coded. Simplifier fallbacks are already present in `data`.
export function buildMilkyWayCatalogue({ milkyWay, tolerance = 0.1, sourceHash } = {}) {
  const simplified = simplifyMilkyWay(milkyWay, { tolerance });
  return { container: writeCatalogueContainer({ sourceHash, tables: [{
    type: CatalogueTable.MILKY_WAY, count: simplified.data.features.length, bytes: encodeMilkyWay(simplified.data)
  }] }), stats: simplified.stats, data: simplified.data };
}

export function decodeMilkyWayCatalogue(container) {
  const table = tableBytes(container, CatalogueTable.MILKY_WAY);
  if (!table) return null;
  const bytes = table.bytes, state = { offset: 0 };
  if (getU16(bytes, state, "MILKY_WAY version") !== 1) throw new RangeError("unsupported MILKY_WAY table version");
  const count = getU16(bytes, state, "MILKY_WAY feature count");
  if (count !== table.table.count) throw new RangeError("MILKY_WAY feature count mismatch");
  const features = [];
  for (let featureIndex = 0; featureIndex < count; featureIndex++) {
    if (state.offset >= bytes.length) throw new RangeError("truncated MILKY_WAY feature id");
    const idLength = bytes[state.offset++];
    if (!idLength || idLength > bytes.length - state.offset) throw new RangeError("invalid MILKY_WAY feature id");
    const id = decoder.decode(bytes.subarray(state.offset, state.offset + idLength)); state.offset += idLength;
    const polygons = [];
    for (let polygonIndex = 0, polygonCount = getU16(bytes, state, "MILKY_WAY polygon count"); polygonIndex < polygonCount; polygonIndex++) {
      const rings = [];
      for (let ringIndex = 0, ringCount = getU16(bytes, state, "MILKY_WAY ring count"); ringIndex < ringCount; ringIndex++) {
        const pointCount = getU16(bytes, state, "MILKY_WAY point count");
        if (pointCount < 3 || state.offset + 6 > bytes.length) throw new RangeError("invalid MILKY_WAY ring");
        let ra = readU24(bytes, state.offset), dec = readU24(bytes, state.offset + 3); state.offset += 6;
        if (dec & 0x800000) dec -= 0x1000000;
        const ring = [[ra / RA_SCALE, dec / RA_SCALE]];
        for (let point = 1; point < pointCount; point++) {
          ra += unzigzag(getUleb(bytes, state)); dec += unzigzag(getUleb(bytes, state));
          if (ra < 0 || ra > 0xffffff || dec < -0x800000 || dec > 0x7fffff) throw new RangeError("MILKY_WAY coordinate outside fixed-point range");
          ring.push([ra / RA_SCALE, dec / RA_SCALE]);
        }
        ring.push(ring[0].slice()); rings.push(ring);
      }
      polygons.push(rings);
    }
    features.push({type: "Feature", id, properties: {}, geometry: {type: "MultiPolygon", coordinates: polygons}});
  }
  if (state.offset !== bytes.length) throw new RangeError("trailing bytes in MILKY_WAY table");
  return {type: "FeatureCollection", features};
}

// Build an in-memory CELD v1 profile from already-parsed source catalogues.
export function buildStarsCatalogue({ stars, starNames, starsLimit = 6, starNamesLimit = 1.5, sourceHash } = {}) {
  return buildCatalogue({ stars, starNames, starsLimit, starNamesLimit, sourceHash });
}

// Build selected star and optional DSO tables. One STRINGS table is shared by
// every sparse label table; CELD deliberately has only one of each table type.
export function buildCatalogue({ stars, starNames, starsLimit = 6, starNamesLimit = 1.5,
  dsos, dsoNames, dsoProfile = "bright", constellations, constellationLines,
  planets, planetIds, milkyWay, milkyWayTolerance = 0.1, sourceHash } = {}) {
  const selected = normalisedStars(stars, requireLimit(starsLimit, "starsLimit"));
  if (!selected.length) throw new RangeError("star profile selected zero stars");
  const starLabels = starLabelRecords(selected, starNames, requireLimit(starNamesLimit, "starNamesLimit"));
  const dsoRecords = dsos === undefined && dsoNames === undefined ? null : normalisedDsos(dsos, dsoNames, dsoProfile);
  const constellationRecords = constellations === undefined && constellationLines === undefined ? null : {
    labels: normalisedConstellationLabels(constellations),
    lines: normalisedConstellationLines(constellationLines)
  };
  const allStrings = [
    ...starLabels.map(label => label.name),
    ...(dsoRecords || []).flatMap(dso => [dso.id, dso.desig, dso.dim, ...(dso.name ? [dso.name] : [])]),
    ...(constellationRecords || {labels: [], lines: []}).labels.flatMap(label => [label.id, label.label]),
    ...(constellationRecords || {labels: [], lines: []}).lines.map(line => line.id)
  ];
  const stringTable = allStrings.length ? encodeStrings(allStrings) : null;
  const tables = [{ type: CatalogueTable.STARS, count: selected.length, bytes: encodeStars(selected) }];
  if (starLabels.length) tables.push({ type: CatalogueTable.STAR_LABELS, count: starLabels.length, bytes: encodeStarLabels(starLabels, stringTable.ids) });
  if (dsoRecords) {
    tables.push({ type: CatalogueTable.DSOS, count: dsoRecords.length, bytes: encodeDsos(dsoRecords, stringTable.ids) });
    const names = encodeDsoNames(dsoRecords, stringTable.ids);
    if (names.labels.length) tables.push({ type: CatalogueTable.DSO_NAMES, count: names.labels.length, bytes: names.bytes });
  }
  if (constellationRecords) {
    tables.push({type: CatalogueTable.CONSTELLATION_LABELS, count: constellationRecords.labels.length,
      bytes: encodeConstellationLabels(constellationRecords.labels, stringTable)});
    tables.push({type: CatalogueTable.CONSTELLATION_LINES, count: constellationRecords.lines.length,
      bytes: encodeConstellationLines(constellationRecords.lines, stringTable)});
  }
  if (planets !== undefined) {
    const records = normalisedPlanets(planets, planetIds === undefined ? PLANET_IDS : planetIds);
    tables.push({type: CatalogueTable.PLANETS, count: records.length, bytes: encodePlanets(records)});
  }
  if (milkyWay !== undefined) {
    const simplified = simplifyMilkyWay(milkyWay, {tolerance: milkyWayTolerance});
    tables.push({type: CatalogueTable.MILKY_WAY, count: simplified.data.features.length, bytes: encodeMilkyWay(simplified.data)});
  }
  if (stringTable) tables.push({ type: CatalogueTable.STRINGS, count: stringTable.ids.size, bytes: stringTable.bytes });
  return writeCatalogueContainer({ tables, sourceHash });
}

function tableBytes(container, type) {
  const parsed = parseCatalogueContainer(container);
  const table = parsed.tables.find(candidate => candidate.type === type);
  if (!table) return null;
  const bytes = container instanceof Uint8Array ? container : new Uint8Array(container);
  return { table, bytes: bytes.slice(table.offset, table.offset + table.length) };
}

// Test/inspection reader for these first three tables. Renderer wiring will
// consume binary tables directly later; do not make map code depend on this.
export function decodeStarsCatalogue(container) {
  const starsTable = tableBytes(container, CatalogueTable.STARS);
  if (!starsTable || starsTable.table.length !== starsTable.table.count * STAR_BYTES)
    throw new RangeError("invalid STARS table");
  const view = new DataView(starsTable.bytes.buffer, starsTable.bytes.byteOffset, starsTable.bytes.byteLength);
  const stars = [];
  for (let index = 0; index < starsTable.table.count; index++) {
    const offset = index * STAR_BYTES;
    let qDec = readU24(starsTable.bytes, offset + 7);
    if (qDec & 0x800000) qDec -= 0x1000000;
    const bv = view.getInt16(offset + 12, true);
    stars.push({
      id: view.getUint32(offset, true),
      coordinates: [readU24(starsTable.bytes, offset + 4) / RA_SCALE, qDec / RA_SCALE],
      mag: view.getInt16(offset + 10, true) / 100,
      bv: bv === BV_MISSING ? null : bv / 1000
    });
  }
  const labelsTable = tableBytes(container, CatalogueTable.STAR_LABELS);
  const stringsTable = tableBytes(container, CatalogueTable.STRINGS);
  if (!labelsTable && !stringsTable) return { stars, labels: [] };
  if (!labelsTable || !stringsTable || labelsTable.table.length !== labelsTable.table.count * 6)
    throw new RangeError("incomplete STAR_LABELS/STRINGS tables");
  const strings = decodeStrings(stringsTable.bytes);
  const labelsView = new DataView(labelsTable.bytes.buffer, labelsTable.bytes.byteOffset, labelsTable.bytes.byteLength);
  const labels = [];
  for (let index = 0; index < labelsTable.table.count; index++) {
    const id = labelsView.getUint32(index * 6, true), stringId = labelsView.getUint16(index * 6 + 4, true);
    if (stringId >= strings.length) throw new RangeError("STAR_LABELS string id outside STRINGS table");
    labels.push({ id, name: strings[stringId] });
  }
  return { stars, labels };
}

export function decodeDsosCatalogue(container) {
  const dsosTable = tableBytes(container, CatalogueTable.DSOS);
  if (!dsosTable) return { dsos: [], names: [] };
  const stringsTable = tableBytes(container, CatalogueTable.STRINGS);
  if (!stringsTable || dsosTable.table.length !== dsosTable.table.count * DSO_BYTES)
    throw new RangeError("incomplete DSOS/STRINGS tables");
  const strings = decodeStrings(stringsTable.bytes);
  const view = new DataView(dsosTable.bytes.buffer, dsosTable.bytes.byteOffset, dsosTable.bytes.byteLength);
  const string = index => {
    if (index >= strings.length) throw new RangeError("DSOS string id outside STRINGS table");
    return strings[index];
  };
  const dsos = [];
  for (let index = 0; index < dsosTable.table.count; index++) {
    const offset = index * DSO_BYTES;
    let qDec = readU24(dsosTable.bytes, offset + 8);
    if (qDec & 0x800000) qDec -= 0x1000000;
    const mag = view.getInt16(offset + 11, true);
    const type = DSO_TYPES[dsosTable.bytes[offset + 4]];
    if (!type) throw new RangeError("DSOS type id outside CELD v1 enum");
    dsos.push({
      id: string(view.getUint16(offset, true)), desig: string(view.getUint16(offset + 2, true)), type,
      coordinates: [readU24(dsosTable.bytes, offset + 5) / RA_SCALE, qDec / RA_SCALE],
      mag: mag === DSO_MAG_UNKNOWN ? 999 : mag / 100,
      dim: string(view.getUint16(offset + 13, true))
    });
  }
  const namesTable = tableBytes(container, CatalogueTable.DSO_NAMES);
  if (!namesTable) return { dsos, names: [] };
  if (namesTable.table.length !== namesTable.table.count * 4) throw new RangeError("invalid DSO_NAMES table");
  const namesView = new DataView(namesTable.bytes.buffer, namesTable.bytes.byteOffset, namesTable.bytes.byteLength);
  const names = [];
  for (let index = 0; index < namesTable.table.count; index++)
    names.push({ id: string(namesView.getUint16(index * 4, true)), name: string(namesView.getUint16(index * 4 + 2, true)) });
  return { dsos, names };
}

function requireFeatureCollection(value, name) {
  if (!value || value.type !== "FeatureCollection" || !Array.isArray(value.features))
    throw new TypeError(`${name} must be a GeoJSON FeatureCollection`);
  return value.features;
}

function constellationRank(value, name) {
  const rank = requireFinite(value, `${name} rank`);
  if (!Number.isInteger(rank) || rank < 0 || rank > 0xff)
    throw new RangeError(`${name} rank does not fit u8`);
  return rank;
}

function constellationId(feature, name) {
  if (typeof feature?.id !== "string" || !feature.id.length)
    throw new TypeError(`${name} id missing`);
  return feature.id;
}

function constellationPoint(coordinates, name) {
  if (!Array.isArray(coordinates) || coordinates.length !== 2)
    throw new TypeError(`${name} coordinates missing`);
  return {qRa: quantizeRa(coordinates[0]), qDec: quantizeDec(coordinates[1])};
}

function normalisedConstellationLabels(collection) {
  const labels = requireFeatureCollection(collection, "constellation labels").map(feature => {
    const id = constellationId(feature, "constellation label");
    if (feature.geometry?.type !== "Point") throw new TypeError(`constellation label ${id} is not a Point`);
    const point = constellationPoint(feature.geometry.coordinates, `constellation label ${id}`);
    const label = feature.properties?.desig;
    if (typeof label !== "string" || !label.length)
      throw new TypeError(`constellation label ${id} designation missing`);
    return {id, label, rank: constellationRank(feature.properties?.rank, `constellation label ${id}`), ...point};
  }).sort((a, b) => utf8Compare(a.id, b.id) || a.qRa - b.qRa || a.qDec - b.qDec ||
    a.rank - b.rank || utf8Compare(a.label, b.label));
  // Serpens has Caput and Cauda, both with IAU id "Ser".  Its two source
  // records are distinct label placements, not a malformed duplicate.
  return labels;
}

function normalisedConstellationLines(collection) {
  const lines = requireFeatureCollection(collection, "constellation lines").map(feature => {
    const id = constellationId(feature, "constellation line");
    if (feature.geometry?.type !== "MultiLineString" || !Array.isArray(feature.geometry.coordinates))
      throw new TypeError(`constellation line ${id} is not a MultiLineString`);
    const segments = feature.geometry.coordinates.map((segment, segmentIndex) => {
      if (!Array.isArray(segment) || segment.length < 2)
        throw new TypeError(`constellation line ${id} segment ${segmentIndex} needs two points`);
      if (segment.length > 0xffff) throw new RangeError(`constellation line ${id} segment too long`);
      return segment.map((point, pointIndex) => constellationPoint(point,
        `constellation line ${id} segment ${segmentIndex} point ${pointIndex}`));
    });
    if (!segments.length || segments.length > 0xffff) throw new RangeError(`constellation line ${id} has invalid segment count`);
    return {id, rank: constellationRank(feature.properties?.rank, `constellation line ${id}`), segments};
  }).sort((a, b) => {
    const byId = utf8Compare(a.id, b.id) || a.rank - b.rank;
    if (byId) return byId;
    const aa = a.segments.flat(), bb = b.segments.flat();
    for (let index = 0; index < Math.min(aa.length, bb.length); index++) {
      const byPoint = aa[index].qRa - bb[index].qRa || aa[index].qDec - bb[index].qDec;
      if (byPoint) return byPoint;
    }
    return aa.length - bb.length || a.segments.length - b.segments.length;
  });
  // As with labels, the two Serpens halves intentionally share their IAU id.
  return lines;
}

function encodeConstellationLabels(labels, strings) {
  const bytes = new Uint8Array(labels.length * CONSTELLATION_LABEL_BYTES);
  const view = new DataView(bytes.buffer);
  labels.forEach((label, index) => {
    const offset = index * CONSTELLATION_LABEL_BYTES;
    view.setUint16(offset, strings.ids.get(label.id), true);
    view.setUint16(offset + 2, strings.ids.get(label.label), true);
    bytes[offset + 4] = label.rank;
    writeU24(bytes, offset + 5, label.qRa);
    writeU24(bytes, offset + 8, label.qDec < 0 ? label.qDec + 0x1000000 : label.qDec);
  });
  return bytes;
}

function encodeConstellationLines(lines, strings) {
  const out = [];
  for (const line of lines) {
    const id = strings.ids.get(line.id);
    out.push(id & 0xff, id >>> 8, line.rank, line.segments.length & 0xff, line.segments.length >>> 8);
    for (const segment of line.segments) {
      out.push(segment.length & 0xff, segment.length >>> 8);
      for (const point of segment) {
        out.push(point.qRa & 0xff, (point.qRa >>> 8) & 0xff, (point.qRa >>> 16) & 0xff);
        const dec = point.qDec < 0 ? point.qDec + 0x1000000 : point.qDec;
        out.push(dec & 0xff, (dec >>> 8) & 0xff, (dec >>> 16) & 0xff);
      }
    }
  }
  return Uint8Array.from(out);
}

// Build labels and MultiLineString geometry as independently selectable CELD
// tables. Coordinates are fixed-point degrees; line segment boundaries and
// source ranks survive exactly, so renderer policy remains separate from data.
export function buildConstellationsCatalogue({ constellations, constellationLines, sourceHash } = {}) {
  const labels = normalisedConstellationLabels(constellations);
  const lines = normalisedConstellationLines(constellationLines);
  if (!labels.length || !lines.length) throw new RangeError("constellation profile selected zero records");
  const strings = encodeStrings([...labels.flatMap(label => [label.id, label.label]), ...lines.map(line => line.id)]);
  return writeCatalogueContainer({ sourceHash, tables: [
    {type: CatalogueTable.CONSTELLATION_LABELS, count: labels.length, bytes: encodeConstellationLabels(labels, strings)},
    {type: CatalogueTable.CONSTELLATION_LINES, count: lines.length, bytes: encodeConstellationLines(lines, strings)},
    {type: CatalogueTable.STRINGS, count: strings.ids.size, bytes: strings.bytes}
  ]});
}

// Inspection reader. This validates table-local lengths and string references;
// drawing directly from the compact streams is a later renderer concern.
export function decodeConstellationsCatalogue(container) {
  const labelsTable = tableBytes(container, CatalogueTable.CONSTELLATION_LABELS);
  const linesTable = tableBytes(container, CatalogueTable.CONSTELLATION_LINES);
  const stringsTable = tableBytes(container, CatalogueTable.STRINGS);
  if (!labelsTable || !linesTable || !stringsTable) throw new RangeError("incomplete constellation tables");
  if (labelsTable.table.length !== labelsTable.table.count * CONSTELLATION_LABEL_BYTES)
    throw new RangeError("invalid CONSTELLATION_LABELS table");
  const strings = decodeStrings(stringsTable.bytes);
  const labelsView = new DataView(labelsTable.bytes.buffer, labelsTable.bytes.byteOffset, labelsTable.bytes.byteLength);
  const stringAt = (id, table) => {
    if (id >= strings.length) throw new RangeError(`${table} string id outside STRINGS table`);
    return strings[id];
  };
  const labels = [];
  for (let index = 0; index < labelsTable.table.count; index++) {
    const offset = index * CONSTELLATION_LABEL_BYTES;
    labels.push({
      id: stringAt(labelsView.getUint16(offset, true), "CONSTELLATION_LABELS"),
      label: stringAt(labelsView.getUint16(offset + 2, true), "CONSTELLATION_LABELS"),
      rank: labelsTable.bytes[offset + 4],
      coordinates: [readU24(labelsTable.bytes, offset + 5) / RA_SCALE, dequantizeDec(readU24(labelsTable.bytes, offset + 8))]
    });
  }
  const state = {offset: 0}, lines = [];
  const need = (count, name) => {
    if (count > linesTable.bytes.length - state.offset) throw new RangeError(`truncated CONSTELLATION_LINES ${name}`);
  };
  const u16 = name => { need(2, name); const value = linesTable.bytes[state.offset] | (linesTable.bytes[state.offset + 1] << 8); state.offset += 2; return value; };
  for (let record = 0; record < linesTable.table.count; record++) {
    const id = stringAt(u16("id"), "CONSTELLATION_LINES");
    need(3, "header");
    const rank = linesTable.bytes[state.offset++], segmentCount = u16("segment count");
    if (!segmentCount) throw new RangeError("CONSTELLATION_LINES has zero segments");
    const segments = [];
    for (let segment = 0; segment < segmentCount; segment++) {
      const pointCount = u16("point count");
      if (pointCount < 2) throw new RangeError("CONSTELLATION_LINES segment has fewer than two points");
      need(pointCount * 6, "coordinates");
      const points = [];
      for (let point = 0; point < pointCount; point++) {
        points.push([readU24(linesTable.bytes, state.offset) / RA_SCALE,
          dequantizeDec(readU24(linesTable.bytes, state.offset + 3))]);
        state.offset += 6;
      }
      segments.push(points);
    }
    lines.push({id, rank, segments});
  }
  if (state.offset !== linesTable.bytes.length) throw new RangeError("trailing bytes in CONSTELLATION_LINES table");
  return {labels, lines};
}

function usage() {
  return "usage: node tools/build-catalogue.mjs --output FILE [--input-dir DIR] [--stars-limit N] [--star-names-limit N] [--dso-profile bright|notable] [--planets id,...] [--milky-way-tolerance DEG]";
}

export function parseArguments(argv) {
  const options = { inputDir: "harness/data", starsLimit: 6, starNamesLimit: 1.5, dsoProfile: "bright",
    planetIds: ["sol", "lun", "mer", "ven", "mar", "jup", "sat", "ura", "nep"], milkyWayTolerance: null };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--help") return { help: true };
    const value = argv[++index];
    if (value === undefined) throw new Error(`${key} requires a value`);
    if (key === "--input-dir") options.inputDir = value;
    else if (key === "--output") options.output = value;
    else if (key === "--stars-limit") options.starsLimit = requireLimit(value, "starsLimit");
    else if (key === "--star-names-limit") options.starNamesLimit = requireLimit(value, "starNamesLimit");
    else if (key === "--dso-profile") {
      if (value !== "bright" && value !== "notable") throw new Error("--dso-profile must be bright or notable");
      options.dsoProfile = value;
    }
    else if (key === "--planets") {
      options.planetIds = value.split(",").filter(Boolean);
      if (!options.planetIds.length) throw new Error("--planets requires at least one id");
    }
    else if (key === "--milky-way-tolerance") {
      options.milkyWayTolerance = requireFinite(value, "milkyWayTolerance");
      if (!(options.milkyWayTolerance > 0)) throw new Error("--milky-way-tolerance must be positive");
    }
    else throw new Error(`unknown option ${key}`);
  }
  if (!options.output) throw new Error("--output is required");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  const starsPath = path.join(options.inputDir, "stars.6.json");
  const namesPath = path.join(options.inputDir, "starnames.json");
  const dsosPath = path.join(options.inputDir, "dsos.bright.json");
  const dsoNamesPath = path.join(options.inputDir, "dsonames.json");
  const constellationsPath = path.join(options.inputDir, "constellations.json");
  const constellationLinesPath = path.join(options.inputDir, "constellations.lines.json");
  const planetsPath = path.join(options.inputDir, "planets.json");
  const milkyWayPath = path.join(options.inputDir, "mw.json");
  const starsBytes = fs.readFileSync(starsPath), namesBytes = fs.readFileSync(namesPath);
  const dsosBytes = fs.readFileSync(dsosPath), dsoNamesBytes = fs.readFileSync(dsoNamesPath);
  const constellationsBytes = fs.readFileSync(constellationsPath), constellationLinesBytes = fs.readFileSync(constellationLinesPath);
  const planetsBytes = fs.readFileSync(planetsPath);
  const milkyWayBytes = options.milkyWayTolerance === null ? null : fs.readFileSync(milkyWayPath);
  const hash = createHash("sha256")
    .update("CELD/v1 catalogue\n")
    .update(`stars-limit=${options.starsLimit}\nstar-names-limit=${options.starNamesLimit}\ndso-profile=${options.dsoProfile}\nplanets=${options.planetIds.join(",")}\nmilky-way-tolerance=${options.milkyWayTolerance ?? "off"}\n`)
    .update(starsBytes).update(namesBytes).update(dsosBytes).update(dsoNamesBytes)
    .update(constellationsBytes).update(constellationLinesBytes).update(planetsBytes);
  if (milkyWayBytes) hash.update(milkyWayBytes);
  const sourceHash = hash.digest();
  const output = buildCatalogue({
    stars: JSON.parse(starsBytes), starNames: JSON.parse(namesBytes),
    dsos: JSON.parse(dsosBytes), dsoNames: JSON.parse(dsoNamesBytes),
    constellations: JSON.parse(constellationsBytes), constellationLines: JSON.parse(constellationLinesBytes),
    planets: JSON.parse(planetsBytes), planetIds: options.planetIds,
    ...(milkyWayBytes ? {milkyWay: JSON.parse(milkyWayBytes), milkyWayTolerance: options.milkyWayTolerance} : {}),
    starsLimit: options.starsLimit, starNamesLimit: options.starNamesLimit, dsoProfile: options.dsoProfile, sourceHash
  });
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, output);
  const parsed = parseCatalogueContainer(output);
  console.log(`${options.output}: ${output.byteLength} bytes, ${parsed.tables.map(table => `${table.count}x${table.type}`).join(", ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`build-catalogue: ${error.message}`); process.exitCode = 1; });
}
