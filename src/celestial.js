import { Celestial, CoreSkyMap, current, setCurrent } from "./map.js";
import { form } from "./form.js";
import { geo } from "./location.js";
import { exportSVG } from "./svg.js";

const fullUi = {form, observer: geo, exportSVG};

export class SkyMap extends CoreSkyMap {
  constructor(config, options) {
    super(config, Object.assign({}, options, {ui: fullUi}));
  }
}

["constellations", "constellation", "origin"].forEach(function (name_) {
  Object.defineProperty(Celestial, name_, {
    get: function () { return current ? current[name_] : undefined; },
    set: function (value_) { if (current) current[name_] = value_; },
    enumerable: true, configurable: true
  });
});

Celestial.display = function (config) {
  var instance = new SkyMap(config, {compatibility: true});
  setCurrent(instance);
  var descriptors = Object.getOwnPropertyDescriptors(instance);
  for (var key_ in descriptors) {
    if (key_ === "constructor" || key_ === "constellations" || key_ === "constellation" || key_ === "origin" || key_ === "_lifecycle" || key_ === "_legacyLayers") continue;
    Object.defineProperty(Celestial, key_, descriptors[key_]);
  }
  instance.redraw();
  return instance;
};

export { Celestial };
