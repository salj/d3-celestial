/* Entry wrappers stay distinct: headless drops UI, default keeps old surface. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Celestial, SkyMap } from "../src/celestial.js";
import { CoreSkyMap } from "../src/map.js";
import { HeadlessSkyMap } from "../src/headless.js";
import { headlessUi } from "../src/headless-ui.js";
import { observer } from "../src/observer.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("headless entry installs observer API and has no form implementation", () => {
  assert.equal(headlessUi.observer, observer);
  assert.deepEqual(Object.keys(headlessUi.form()).sort(),
    ["fldEnable", "listConstellations", "setCenter"]);
  assert.throws(() => headlessUi.exportSVG(), /unavailable/);
  assert.ok(HeadlessSkyMap.prototype instanceof CoreSkyMap);
});

test("headless map retains planet draw gate", () => {
  const map = fs.readFileSync(path.join(ROOT, "src/map.js"), "utf8");
  assert.match(map, /if \(cfg\.planets\.show && instance\.origin\)/,
    "programmatic observer state must be enough to draw planets");
});

test("default wrapper retains SkyMap and global Celestial APIs", () => {
  assert.ok(SkyMap.prototype instanceof CoreSkyMap);
  assert.equal(typeof Celestial.display, "function");
  assert.equal(typeof Celestial.exportSVG, "function");
});
