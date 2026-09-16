import { Celestial, CoreSkyMap } from "./map.js";
import { headlessUi } from "./headless-ui.js";

export class HeadlessSkyMap extends CoreSkyMap {
  constructor(config, options) {
    super(config, Object.assign({}, options, {ui: headlessUi}));
  }
}

export { Celestial };
