// DOM-free observer state for a map.
//
// The location form is an optional UI around these APIs. Keeping observer state
// here lets a canvas-only consumer supply time and place programmatically.
import { horizontal } from "./horizontal.js";
import { euler, transformDeg } from "./transform.js";
import { isArray, isNumber, isValidDate } from "./util.js";

function isValidTimezone(offset) {
  return typeof offset === "number" && Number.isFinite(offset) && Math.abs(offset) <= 840;
}

function isValidLocation(location) {
  return isArray(location) && location.length >= 2 &&
    isNumber(location[0]) && location[0] >= -90 && location[0] <= 90 &&
    isNumber(location[1]) && location[1] >= -180 && location[1] <= 180;
}

// Install observer APIs on one map. `rotate` and `redraw` are deliberately
// supplied by the map, so this module knows nothing about canvas or DOM.
function observer(sky) {
  var cfg = sky.cfg,
      zenith = [0, 0],
      geopos = isValidLocation(cfg.geopos) ? cfg.geopos.slice() : [0, 0],
      date = isValidDate(cfg.date) ? new Date(cfg.date.valueOf()) : new Date(),
      timezone = isValidTimezone(cfg.timezone) ? cfg.timezone : -date.getTimezoneOffset();

  function updateZenith() {
    zenith = transformDeg(horizontal.inverse(date, [90, 0], geopos), euler[sky.cfg.transform]);
    zenith[2] = 0;
  }

  function redraw() {
    if (sky.cfg.follow === "zenith") sky.rotate({center: zenith});
    else sky.redraw();
  }

  sky.date = function(dt, tz) {
    if (dt === undefined) return new Date(date.valueOf());
    if (!isValidDate(dt)) return;
    sky.skyview({date: dt, timezone: tz});
  };
  sky.timezone = function(tz) {
    if (tz === undefined) return timezone;
    if (isValidTimezone(tz)) sky.skyview({timezone: tz});
  };
  sky.position = function() { return geopos.slice(); };
  sky.location = function(location, tz) {
    if (location === undefined) return geopos.slice();
    if (isValidLocation(location)) sky.skyview({location, timezone: tz});
  };
  // Apply instant, geographic position and display offset atomically.
  sky.skyview = function(view) {
    if (!view) return {date: new Date(date.valueOf()), location: geopos.slice(), timezone};
    if (sky._lifecycle.disposed) return;
    var changed = false;
    if (isValidTimezone(view.timezone)) {
      timezone = view.timezone;
      changed = true;
    }
    if (isValidDate(view.date)) {
      date = new Date(view.date.valueOf());
      changed = true;
    }
    if (isValidLocation(view.location)) {
      geopos = view.location.slice();
      changed = true;
    }
    if (!changed) return sky.skyview();
    updateZenith();
    redraw();
  };
  sky.dtLoc = sky.skyview;
  sky.zenith = function() { return zenith; };
  sky.nadir = function() {
    var latitude = -zenith[1], longitude = zenith[0] + 180;
    if (longitude > 180) longitude -= 360;
    return [longitude, latitude - 0.001];
  };

  updateZenith();
}

export { isValidLocation, isValidTimezone, observer };
