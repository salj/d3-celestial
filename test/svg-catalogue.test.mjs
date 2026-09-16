import test from "node:test";
import assert from "node:assert/strict";
import { assertSvgCatalogueSupported } from "../src/svg.js";

test("SVG rejects CELD before creating export DOM", () => {
  assert.throws(() => assertSvgCatalogueSupported({catalogue: {format: "celd"}}),
    /SVG export is unavailable for CELD catalogues; use JSON catalogue format/);
});

test("SVG keeps JSON and unspecified catalogue formats enabled", () => {
  assert.doesNotThrow(() => assertSvgCatalogueSupported({catalogue: {format: "json"}}));
  assert.doesNotThrow(() => assertSvgCatalogueSupported({}));
});
