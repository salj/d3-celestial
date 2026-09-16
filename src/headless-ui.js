import { observer } from "./observer.js";

const formApi = {
  setCenter() {}, fldEnable() {}, listConstellations() {},
};

export const headlessUi = {
  form() { return formApi; },
  observer,
  exportSVG() { throw new Error("SVG export is unavailable in the headless entry"); },
};
