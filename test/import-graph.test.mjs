/* Published browser/module entries must retain a valid static relative graph. */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { relativeEsmImportGraph } from "../tools/relative-esm-import-graph.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = ["src/global.js", "src/index.js"];

test("published source entries resolve every static relative ESM import", () => {
  const graph = relativeEsmImportGraph(ROOT, ENTRIES);
  assert.deepEqual(graph, [...graph].sort(), "graph order must be deterministic");
  assert.ok(graph.includes("src/index.js"));
  assert.ok(graph.includes("src/global.js"));
  assert.ok(graph.includes("src/celestial.js"));
  assert.ok(graph.includes("lib/geo-zoom.js"));
});

test("headless entry excludes browser settings UI", () => {
  const graph = relativeEsmImportGraph(ROOT, ["src/headless.js"]);
  for (const file of ["src/form.js", "src/svg.js", "src/location.js",
                      "src/datetimepicker.js", "src/time.js", "src/timezones.js"]) {
    assert.ok(!graph.includes(file), `headless entry imports ${file}`);
  }
  assert.ok(graph.includes("src/observer.js"));
});
