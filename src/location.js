import * as d3 from "./d3.js";

import { formats, settings } from "./config.js";
import { datetimepicker } from "./datetimepicker.js";
import { testNumber } from "./form.js";
import { horizontal } from "./horizontal.js";
import { Celestial } from "./core.js";
import { Round, has, isArray, isNumber, isValidDate, pad, styles_ } from "./util.js";

import { createTimezoneLookup, isValidTimezone, toWallTime } from "./time.js";

// Observer location and time controls for one map. It receives the instance
// because its input fields live on that map's settings form.
function geo(sky) {
  var cfg = sky.cfg;
  var $form = sky.form.$form,
      enable = sky.form.enable,
      showAdvanced = sky.form.showAdvanced;
  var dtFormat = d3.utcFormat("%Y-%m-%d %H:%M:%S"),
      zenith = [0,0],
      geopos = [0,0], 
      date = isValidDate(cfg.date) ? new Date(cfg.date.valueOf()) : new Date(),
      timeZone = isValidTimezone(cfg.timezone) ? cfg.timezone : -date.getTimezoneOffset(),
      config = settings.set(cfg, cfg),
      frm = d3.select(sky.formRoot).select("form").insert("div", "div#general").attr("id", "loc");

  var dtpick = new datetimepicker(sky, function(instant, tz) {
    date = new Date(instant.valueOf());
    timeZone = tz;
    go(true);
  });
  
  if (has(config, "geopos") && config.geopos !== null && config.geopos.length === 2) geopos = config.geopos.slice();
  var col = frm.append("div").attr("class", "col").attr("id", "location").style("display", "none");
  //Latitude & longitude fields
  col.append("label").attr("title", "Location coordinates lat/lon").attr("for", "lat").html("Location");
  col.append("input").attr("type", "number").attr("id", "lat").attr("title", "Latitude").attr("placeholder", "Latitude").attr("max", "90").attr("min", "-90").attr("step", "0.0001").attr("value", geopos[0]).on("change",  function () {
    if (testNumber(this) === true) go(); 
  });
  col.append("span").html("\u00b0");
  col.append("input").attr("type", "number").attr("id", "lon").attr("title", "Longitude").attr("placeholder", "Longitude").attr("max", "180").attr("min", "-180").attr("step", "0.0001").attr("value", geopos[1]).on("change",  function () { 
    if (testNumber(this) === true) go(); 
  });
  col.append("span").html("\u00b0");
  //Here-button if supported
  if ("geolocation" in navigator) {
    col.append("input").attr("type", "button").attr("value", "Here").attr("id", "here").on("click", here);
  }
  //Datetime field with dtpicker-button
  col.append("label").attr("title", "Local date/time").attr("for", "datetime").html(" Date/time");
  col.append("input").attr("type", "button").attr("id", "day-left").attr("title", "One day back").on("click", function () {
    date.setUTCDate(date.getUTCDate() - 1);
    $form("datetime").value = dateFormat(date, timeZone); 
    go(); 
  });
  col.append("input").attr("type", "text").attr("id", "datetime").attr("title", "Date and time").attr("value", dateFormat(date, timeZone))
  .on("click", showpick, true).on("input", function () { 
    this.value = dateFormat(date, timeZone); 
    if (!dtpick.isVisible()) showpick(); 
  });
  col.append("div").attr("id", "datepick").on("click", showpick);
  col.append("input").attr("type", "button").attr("id", "day-right").attr("title", "One day forward").on("click", function () { 
    date.setUTCDate(date.getUTCDate() + 1);
    $form("datetime").value = dateFormat(date, timeZone); 
    go(); 
  });
  //Now -button sets current time & date of device  
  col.append("input").attr("type", "button").attr("value", "Now").attr("id", "now").on("click", now);
  //Horizon marker
  col.append("br");
  col.append("label").attr("title", "Show horizon marker").attr("for", "horizon-show").html(" Horizon marker");
  col.append("input").attr("type", "checkbox").attr("id", "horizon-show").property("checked", config.horizon.show).on("change", apply);    
  //Daylight
  col.append("label").attr("title", "Show daylight").attr("for", "daylight-show").html("Daylight sky");
  col.append("input").attr("type", "checkbox").attr("id", "daylight-show").property("checked", config.daylight.show).on("change", apply);col.append("br");
    
  //Show planets
  col.append("label").attr("title", "Show solar system objects").attr("for", "planets-show").html(" Planets, Sun & Moon");
  col.append("input").attr("type", "checkbox").attr("id", "planets-show").property("checked", config.planets.show).on("change", apply);    
  //Planet names
  var names = formats.planets[config.culture] || formats.planets.iau;
  
  for (var fld in names) {
    if (!has(names, fld)) continue;
    var keys = Object.keys(names[fld]);
    if (keys.length > 1) {
      //Select List
      var txt = (fld === "symbol") ? "as" : "with";
      col.append("label").attr("for", "planets-" + fld + "Type").html(txt);
      
      var selected = 0;
      col.append("label").attr("title", "Type of planet name").attr("for", "planets-" + fld + "Type").attr("class", "advanced").html("");
      var sel = col.append("select").attr("id", "planets-" + fld + "Type").on("change", apply);
      var list = keys.map(function (key, i) {
        if (key === config.planets[fld + "Type"]) selected = i;    
        return {o:key, n:names[fld][key]}; 
      });
      sel.selectAll("option").data(list).enter().append('option')
         .attr("value", function (d) { return d.o; })
         .text(function (d) { return d.n; });
      sel.property("selectedIndex", selected);

      if (fld === "names") {
        sel.attr("class", "advanced");
        col.append("label").attr("for", "planets-" + fld).html("names");
        col.append("input").attr("type", "checkbox").attr("id", "planets-" + fld).property("checked", config.planets[fld]).on("change", apply);
      }
    } 
  }    
 
  enable($form("planets-show"));
  showAdvanced(config.advanced);
  

  function dismissPicker(event_) { 
    if (!sky.formRoot.contains(event_.target) && dtpick.isVisible()) dtpick.hide();
  }
  document.addEventListener("mousedown", dismissPicker);
  sky._lifecycle.onDispose(function() { document.removeEventListener("mousedown", dismissPicker); });
  
  function now() {
    date.setTime(Date.now());
    $form("datetime").value = dateFormat(date, timeZone);
    go();
  }

  function here() {
    navigator.geolocation.getCurrentPosition( function(pos) {
      if (sky._lifecycle.disposed) return;
      geopos = [Round(pos.coords.latitude, 4), Round(pos.coords.longitude, 4)];
      $form("lat").value = geopos[0];
      $form("lon").value = geopos[1];
      go();
    });  
  }
  
  function showpick() {
    dtpick.show(date, timeZone);
  }
  
  function dateFormat(dt, tz) {
    var tzs;
    if (!tz || tz === "0") tzs = " ±0000";
    else {
      var h = Math.floor(Math.abs(tz) / 60),
          m = Math.abs(tz) - (h * 60),
          s = tz > 0 ? " +" : " −";
      tzs = s + pad(h) + pad(m);
    }
    return dtFormat(toWallTime(dt, +tz || 0)) + tzs;
  }  
  

  function isValidLocation(loc) {
    //[lat, lon] expected
    if (!loc || !isArray(loc) || loc.length < 2) return false;
    if (!isNumber(loc[0]) || loc[0] < -90 || loc[0] > 90)  return false;
    if (!isNumber(loc[1]) || loc[1] < -180 || loc[1] > 180)  return false;
    return true;
  }

  function apply() {
    Object.assign(config, sky.cfg);
    config.horizon.show = !!$form("horizon-show").checked;
    config.daylight.show = !!$form("daylight-show").checked;
    config.planets.show = !!$form("planets-show").checked;    
    config.planets.names = !!$form("planets-names").checked;    
    config.planets.namesType = $form("planets-namesType").value;    
    config.planets.symbolType = $form("planets-symbolType").value;    
    enable($form("planets-show"));

    sky.apply(config);
  }

  var refreshZone = createTimezoneLookup(sky._lifecycle, function(offset) {
    timeZone = offset;
    $form("datetime").value = dateFormat(date, timeZone);
  });

  function updateZenith() {
    zenith = Celestial.getPoint(horizontal.inverse(date, [90, 0], geopos), sky.cfg.transform);
    zenith[2] = 0;
  }

  function go(explicit) {
    if (sky._lifecycle.disposed) return;
    var position = [parseFloat($form("lat").value), parseFloat($form("lon").value)];
    if (!isValidLocation(position)) return;
    geopos = position;
    $form("datetime").value = dateFormat(date, timeZone);
    updateZenith();
    refreshZone(geopos.slice(), date, sky.cfg, explicit === true);
    if (sky.cfg.follow === "zenith") sky.rotate({center: zenith});
    else sky.redraw();
  }

  sky.dateFormat = dateFormat;
  
  sky.date = function(dt, tz) {
    if (dt === undefined) return new Date(date.valueOf());
    if (!isValidDate(dt)) return;
    sky.skyview({date: dt, timezone: tz});
  };
  sky.timezone = function(tz) {
    if (tz === undefined) return timeZone;
    if (isValidTimezone(tz)) sky.skyview({timezone: tz});
  };
  sky.position = function() { return geopos.slice(); };
  sky.location = function(loc, tz) {
    if (loc === undefined) return geopos.slice();
    if (isValidLocation(loc)) sky.skyview({location: loc, timezone: tz});
  };
  // Apply the instant, geographic position and display offset atomically.
  sky.skyview = function(view) {
    if (!view) return {date: new Date(date.valueOf()), location: geopos.slice(), timezone: timeZone};
    if (sky._lifecycle.disposed) return;
    var explicit = isValidTimezone(view.timezone), changed = explicit;
    if (explicit) timeZone = view.timezone;
    if (isValidDate(view.date)) {
      date = new Date(view.date.valueOf());
      changed = true;
    }
    if (isValidLocation(view.location)) {
      geopos = view.location.slice();
      $form("lat").value = geopos[0];
      $form("lon").value = geopos[1];
      changed = true;
    }
    if (!changed) return sky.skyview();
    if (dtpick.isVisible()) dtpick.hide();
    go(explicit);
  };
  sky.dtLoc = sky.skyview;
  sky.zenith = function () { return zenith; };
  sky.nadir = function () {
    var b = -zenith[1],
        l = zenith[0] + 180;
    if (l > 180) l -= 360;    
    return [l, b-0.001]; 
  };

  if (has(config, "formFields") && (config.location === true || config.formFields.location === true)) {
    styles_(d3.select(sky.formRoot).select("#location"), {"display": "inline-block"});
  }
  // Establish the observer before the constructor positions or loads the map.
  // The resolver only changes the displayed offset; it never moves the instant.
  updateZenith();
  refreshZone(geopos.slice(), date, sky.cfg, isValidTimezone(cfg.timezone));

}

export { geo };
