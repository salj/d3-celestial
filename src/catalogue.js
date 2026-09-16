/* CELD: Celestial catalogue container directory.
 *
 * This module deliberately stops at container validation.  Decoding table
 * payloads belongs to the individual catalogue readers; accepting a malformed
 * directory here must never leave those readers guessing at offsets.
 */

export const CELD_MAGIC = "CELD";
export const CELD_VERSION = 1;
export const CELD_HEADER_SIZE = 64;
export const CELD_DIRECTORY_ENTRY_SIZE = 24;

export const CatalogueTable = Object.freeze({
  STARS: 1,
  STAR_LABELS: 2,
  DSOS: 3,
  DSO_NAMES: 4,
  CONSTELLATION_LABELS: 5,
  CONSTELLATION_LINES: 6,
  MILKY_WAY: 7,
  PLANETS: 8,
  STRINGS: 9
});

export const CatalogueTableFlag = Object.freeze({
  COMPRESSED: 1
});

const KNOWN_TABLE_TYPES = new Set(Object.values(CatalogueTable));
const KNOWN_TABLE_FLAGS = CatalogueTableFlag.COMPRESSED;
const U32_MAX = 0xffffffff;

export class CatalogueFormatError extends Error {
  constructor(message) {
    super(`Invalid CELD container: ${message}`);
    this.name = "CatalogueFormatError";
  }
}

function fail(message) {
  throw new CatalogueFormatError(message);
}

function asBytes(source) {
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source))
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  fail("expected ArrayBuffer or typed-array view");
}

function range(offset, length, total, name) {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0)
    fail(`${name} has invalid range`);
  if (offset > total || length > total - offset) fail(`${name} is outside container`);
  return { start: offset, end: offset + length, name };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function tableName(type) {
  return Object.entries(CatalogueTable).find(([, value]) => value === type)?.[0] || String(type);
}

function align4(value) {
  return Math.ceil(value / 4) * 4;
}

function writerBytes(value, name) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${name} must be bytes`);
}

// Write an uncompressed CELD v1 container.  The caller owns table payload
// layouts; this owns only alignment, directory order, and fixed header bytes.
// Sorting table types here makes identical logical input byte-identical even if
// a caller assembled its table list in a different order.
export function writeCatalogueContainer({ tables, sourceHash } = {}) {
  if (!Array.isArray(tables) || tables.length === 0) throw new TypeError("tables must be a non-empty array");
  if (tables.length > 0xffff) throw new RangeError("too many CELD tables");
  const hash = sourceHash === undefined ? new Uint8Array(32) : writerBytes(sourceHash, "sourceHash");
  if (hash.byteLength !== 32) throw new RangeError("sourceHash must be exactly 32 bytes");

  const seen = new Set();
  const ordered = tables.map(table => {
    if (!table || !KNOWN_TABLE_TYPES.has(table.type)) throw new TypeError("table has unknown type");
    if (seen.has(table.type)) throw new TypeError(`duplicate ${tableName(table.type)} table`);
    seen.add(table.type);
    if (!Number.isInteger(table.count) || table.count <= 0 || table.count > U32_MAX)
      throw new RangeError(`${tableName(table.type)} count must fit u32 and be non-zero`);
    const bytes = writerBytes(table.bytes, `${tableName(table.type)} bytes`);
    if (bytes.byteLength === 0) throw new RangeError(`${tableName(table.type)} bytes are empty`);
    return { type: table.type, count: table.count, bytes };
  }).sort((a, b) => a.type - b.type);

  const directoryOffset = CELD_HEADER_SIZE;
  const directoryLength = ordered.length * CELD_DIRECTORY_ENTRY_SIZE;
  let offset = align4(directoryOffset + directoryLength);
  const directory = ordered.map(table => {
    offset = align4(offset);
    const entry = { ...table, offset };
    offset += table.bytes.byteLength;
    if (offset > U32_MAX) throw new RangeError("CELD container exceeds u32 offset range");
    return entry;
  });
  const output = new Uint8Array(offset);
  const view = new DataView(output.buffer);
  output.set([0x43, 0x45, 0x4c, 0x44]);
  view.setUint16(4, CELD_VERSION, true);
  view.setUint16(6, CELD_HEADER_SIZE, true);
  view.setUint16(12, directory.length, true);
  view.setUint16(14, CELD_DIRECTORY_ENTRY_SIZE, true);
  view.setUint32(16, directoryOffset, true);
  output.set(hash, 32);
  directory.forEach((table, index) => {
    const base = directoryOffset + index * CELD_DIRECTORY_ENTRY_SIZE;
    view.setUint16(base, table.type, true);
    view.setUint32(base + 4, table.count, true);
    view.setUint32(base + 8, table.offset, true);
    view.setUint32(base + 12, table.bytes.byteLength, true);
    view.setUint32(base + 16, table.bytes.byteLength, true);
    output.set(table.bytes, table.offset);
  });
  return output;
}

// Parse the fixed CELD v1 header and directory. Payload bytes stay untouched.
// Endianness is fixed little-endian so this is portable across browser hosts.
export function parseCatalogueContainer(source) {
  const bytes = asBytes(source);
  if (bytes.byteLength < CELD_HEADER_SIZE) fail("truncated header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== CELD_MAGIC) fail(`magic is ${JSON.stringify(magic)}, expected ${CELD_MAGIC}`);

  const version = view.getUint16(4, true);
  if (version !== CELD_VERSION) fail(`unsupported version ${version}`);
  const headerLength = view.getUint16(6, true);
  if (headerLength !== CELD_HEADER_SIZE) fail(`header length ${headerLength}, expected ${CELD_HEADER_SIZE}`);

  const flags = view.getUint32(8, true);
  if (flags !== 0) fail(`unknown container flags 0x${flags.toString(16)}`);
  const tableCount = view.getUint16(12, true);
  const directoryEntrySize = view.getUint16(14, true);
  if (directoryEntrySize !== CELD_DIRECTORY_ENTRY_SIZE)
    fail(`directory entry size ${directoryEntrySize}, expected ${CELD_DIRECTORY_ENTRY_SIZE}`);
  const directoryOffset = view.getUint32(16, true);
  const manifestOffset = view.getUint32(20, true);
  const manifestLength = view.getUint32(24, true);
  const reserved = view.getUint32(28, true);
  if (reserved !== 0) fail("reserved header bytes are non-zero");

  if (directoryOffset % 4) fail("directory offset is not four-byte aligned");
  const directoryLength = tableCount * CELD_DIRECTORY_ENTRY_SIZE;
  if (directoryLength > U32_MAX || tableCount > Math.floor((bytes.byteLength - directoryOffset) / CELD_DIRECTORY_ENTRY_SIZE))
    fail("directory is outside container");
  const headerRange = range(0, headerLength, bytes.byteLength, "header");
  const directoryRange = range(directoryOffset, directoryLength, bytes.byteLength, "directory");
  if (overlaps(headerRange, directoryRange)) fail("directory overlaps header");

  let manifestRange = null;
  if ((manifestOffset === 0) !== (manifestLength === 0)) fail("manifest offset and length must both be zero or non-zero");
  if (manifestLength) {
    if (manifestOffset % 4) fail("manifest offset is not four-byte aligned");
    manifestRange = range(manifestOffset, manifestLength, bytes.byteLength, "manifest");
    if (overlaps(manifestRange, headerRange) || overlaps(manifestRange, directoryRange))
      fail("manifest overlaps header or directory");
  }

  const occupied = [headerRange, directoryRange];
  if (manifestRange) occupied.push(manifestRange);
  const tables = [];
  const seenTypes = new Set();
  for (let index = 0; index < tableCount; index++) {
    const base = directoryOffset + index * CELD_DIRECTORY_ENTRY_SIZE;
    const type = view.getUint16(base, true);
    const tableFlags = view.getUint16(base + 2, true);
    const count = view.getUint32(base + 4, true);
    const offset = view.getUint32(base + 8, true);
    const length = view.getUint32(base + 12, true);
    const rawLength = view.getUint32(base + 16, true);
    const crc32 = view.getUint32(base + 20, true);

    if (!KNOWN_TABLE_TYPES.has(type)) fail(`table ${index} has unknown type ${type}`);
    if (seenTypes.has(type)) fail(`duplicate ${tableName(type)} table`);
    seenTypes.add(type);
    if (tableFlags & ~KNOWN_TABLE_FLAGS) fail(`table ${tableName(type)} has unknown flags 0x${tableFlags.toString(16)}`);
    if (count === 0) fail(`table ${tableName(type)} has zero records; omit it instead`);
    if (length === 0 || rawLength === 0) fail(`table ${tableName(type)} has empty payload`);
    if (offset % 4) fail(`table ${tableName(type)} offset is not four-byte aligned`);
    if ((tableFlags & CatalogueTableFlag.COMPRESSED) === 0 && rawLength !== length)
      fail(`table ${tableName(type)} is uncompressed but stored/raw lengths differ`);
    if ((tableFlags & CatalogueTableFlag.COMPRESSED) !== 0 && rawLength < length)
      fail(`table ${tableName(type)} compressed raw length is smaller than stored length`);

    const tableRange = range(offset, length, bytes.byteLength, `table ${tableName(type)}`);
    for (const prior of occupied)
      if (overlaps(tableRange, prior)) fail(`table ${tableName(type)} overlaps ${prior.name}`);
    occupied.push(tableRange);
    tables.push(Object.freeze({ type, flags: tableFlags, count, offset, length, rawLength, crc32 }));
  }

  const sourceHash = bytes.slice(32, 64);
  return Object.freeze({
    version,
    flags,
    tableCount,
    directoryOffset,
    directoryLength,
    manifestOffset,
    manifestLength,
    sourceHash,
    tables: Object.freeze(tables)
  });
}
