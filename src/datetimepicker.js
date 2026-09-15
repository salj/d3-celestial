import * as d3 from "./d3.js";

import { testNumber } from "./form.js";
import { isNumber, classes_, px, styles_ } from "./util.js";

import { fromWallTime, toWallTime } from "./time.js";

// Date and time picker belonging to one map. It receives the instance because
// its fields live on that map's settings form.
var datetimepicker = function(sky, callback) {
  var cfg = sky.cfg;
  var $form = sky.form.$form;
  var date = new Date(), 
      hideTimer,
      offset = -date.getTimezoneOffset(),
      tz = [{"−12:00":-720}, {"−11:00":-660}, {"−10:00":-600}, {"−09:30":-570}, {"−09:00":-540}, {"−08:00":-480}, {"−07:00":-420}, {"−06:00":-360}, {"−05:00":-300}, {"−04:30":-270}, {"−04:00":-240}, {"−03:30":-210}, {"−03:00":-180}, {"−02:30":-150}, {"−02:00":-120}, {"−01:00":-60}, {"±00:00":0}, {"+01:00":60}, {"+02:00":120}, {"+03:00":180}, {"+03:30":210}, {"+04:00":240}, {"+04:30":270}, {"+05:00":300}, {"+05:30":330}, {"+05:45":345}, {"+06:00":360}, {"+06:30":390}, {"+07:00":420}, {"+08:00":480}, {"+08:30":510}, {"+08:45":525}, {"+09:00":540}, {"+09:30":570}, {"+10:00":600}, {"+10:30":630}, {"+11:00":660}, {"+12:00":720}, {"+12:45":765}, {"+13:00":780}, {"+14:00":840}],
      months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      days = ["Su", "M", "Tu", "W", "Th", "F", "Sa"],
      years = getYears(date),
      dateFormat = d3.utcFormat("%Y-%m-%d"),
      dateParse = d3.utcParse("%Y-%m-%d"),
      dtrange = cfg.daterange || [];
    
  var picker = d3.select(sky.formRoot).append("div").attr("id", "celestial-date");
  nav("left");
  monSel();
  yrSel();
  nav("right");
  
  var cal = picker.append("div").attr("id", "cal");

  daySel();
  
  timeSel();
  tzSel();
  
  function daySel() {
    var mo = $form("mon").value, yr = $form("yr").value,
        curdt = new Date(Date.UTC(yr, mo, 1)),
        cal = d3.select(sky.formRoot).select("#cal"),
        today = toWallTime(new Date(), offset);
    yr = parseInt(yr);   
    mo = parseInt(mo);   
    curdt.setUTCDate(curdt.getUTCDate() - curdt.getUTCDay());
    var nd = cal.node();
    while (nd.firstChild) nd.removeChild(nd.firstChild);
    
    for (var i=0; i<7; i++) {
      classes_(cal.append("div"), {"date": true, "weekday": true}).html(days[i]);
    }
    for (i=0; i<42; i++) {
      var curmon = curdt.getUTCMonth(), curday = curdt.getUTCDay(), curid = dateFormat(curdt);
      classes_(cal.append("div"), {
        "date": true, 
        "grey": curmon !== mo,
        "weekend": curmon === mo && (curday === 0 || curday === 6),
        "today": dateFormat(curdt) === dateFormat(today),
        "selected": dateFormat(curdt) === dateFormat(date)
      }).attr("id", curid)
      .on("click", pick)
      .html(curdt.getUTCDate().toString());
      
      curdt.setUTCDate(curdt.getUTCDate()+1);
    }
  }

  function yrSel() {     
    picker.append("select").attr("title", "Year").attr("id", "yr").on("change", daySel);   
    
    fillYrSel();
  }

  function fillYrSel() { 
    var sel = d3.select(sky.formRoot).select("select#yr"),
        year = date.getUTCFullYear(),
        selected = 0,
        years = getYears(date);
        
    sel.selectAll("*").remove();    
    sel.selectAll('option').data(years).enter().append('option')
       .text(function (d, i) { 
         if (d === year) selected = i; 
         return d.toString(); 
       });
    sel.property("selectedIndex", selected);
  }
  
  function monSel() { 
    var sel = picker.append("select").attr("title", "Month").attr("id", "mon").on("change", daySel),
        selected = 0,
        month = date.getUTCMonth();
    
    sel.selectAll('option').data(months).enter().append('option')
       .attr("value", function (d, i) { 
         if (i === month) selected = i; 
         return i; 
       })
       .text(function (d) { return d; });
    sel.property("selectedIndex", selected);
  }
  
  function nav(dir) {
    var lnk = picker.append("div").attr("id", dir).on("click", function () {
      var mon = $form("mon"), yr = $form("yr");
      
      if (dir === "left") {
        if (mon.selectedIndex === 0) {
          mon.selectedIndex = 11;
          yr.selectedIndex--;
        } else mon.selectedIndex--;
      } else {
        if (mon.selectedIndex === 11) {
          mon.selectedIndex = 0;
          yr.selectedIndex++;
        } else mon.selectedIndex++;
      }
      daySel();
    });
  }

  function timeSel() { 
    picker.append("input").attr("type", "number").attr("id", "hr").attr("title", "Hours").attr("max", "24").attr("min", "-1").attr("step", "1").attr("value", date.getUTCHours()).on("change", function () { if (testNumber(this) === true) pick(); });

    picker.append("input").attr("type", "number").attr("id", "min").attr("title", "Minutes").attr("max", "60").attr("min", "-1").attr("step", "1").attr("value", date.getUTCMinutes()).on("change", function () { if (testNumber(this) === true) pick(); });
    
    picker.append("input").attr("type", "number").attr("id", "sec").attr("title", "Seconds").attr("max", "60").attr("min", "-1").attr("step", "1").attr("value", date.getUTCSeconds()).on("change", function () { if (testNumber(this) === true) pick(); });
  }
  
  function tzSel() { 
    var sel = picker.append("select").attr("title", "Time zone offset from UTC").attr("id", "tz").on("change", pick),
        selected = 15,
        tzOffset = -date.getTimezoneOffset();
    sel.selectAll('option').data(tz).enter().append('option')
       .attr("value", function (d, i) { 
         var k = Object.keys(d)[0];
         if (d[k] === tzOffset) selected = i; 
         return d[k]; 
       })
       .text(function (d) { return Object.keys(d)[0]; });
    sel.property("selectedIndex", selected);
  }
  
  function getYears(dt) {
    var r = getDateRange(dt.getUTCFullYear()), res = [];
    for (var i = r[0]; i <= r[1]; i++) res.push(i);
    return res;
  }  
  
  function getDateRange(yr) {
    if (!dtrange || dtrange.length < 1) return [yr - 10, yr + 10];
    
    if (dtrange.length === 1 && isNumber(dtrange[0])) {
      if (dtrange[0] >= 100) return [dtrange[0] - 10, dtrange[0] + 10];
      else return [yr - dtrange[0], yr + dtrange[0]];
    }
    if (dtrange.length === 2 && isNumber(dtrange[0])&& isNumber(dtrange[1])) {
      if (dtrange[1] >= 100) return [dtrange[0], dtrange[1]];
      else return [dtrange[0] - dtrange[1], dtrange[0] + dtrange[1]];
    }      
    return [yr - 10, yr + 10];
  }

  function select(id, val) {
    var sel = $form(id);
    for (var i=0; i<sel.childNodes.length; i++) {
      if (sel.childNodes[i].value == val) {
        sel.selectedIndex = i;
        break;
      }
    }
  }
  
  function set(dt) {
     if (dt) date.setTime(dt.valueOf());
     
     select("yr", date.getUTCFullYear());
     select("mon", date.getUTCMonth());
     daySel();
     $form("hr").value = date.getUTCHours();
     $form("min").value = date.getUTCMinutes();
     $form("sec").value = date.getUTCSeconds();
  } 
  
  this.show = function(dt, tz) {
    var nd = $form("celestial-date"),
        src = $form("datepick"),
        left = Math.max(0, src.offsetLeft + src.offsetWidth - nd.offsetWidth),
        top = src.offsetTop - nd.offsetHeight - 1;
  
    if (!this.isVisible()) {
      sky._lifecycle.cancel(hideTimer);
      offset = tz;
      date = toWallTime(dt, tz);
      fillYrSel();
      if (!Array.from($form("tz").options).some(function(option) { return +option.value === tz; })) {
        d3.select($form("tz")).append("option").attr("value", tz).text("UTC offset " + tz + " min");
      }
      select("tz", tz);
      set();
      styles_(d3.select(sky.formRoot).select("#celestial-date"),
               {"top": px(top), "left": px(left), "opacity": 1});  
      d3.select(sky.formRoot).select("#datepick").classed("active", true);
    } else {
      vanish();
    }
  };
  
  this.isVisible = function () {
    if (!$form("datepick")) return false;
    return d3.select(sky.formRoot).select("#datepick").classed("active") === true;
  };

  this.hide = function () {
    vanish();
  };
  
  function vanish() {
    d3.select(sky.formRoot).select("#celestial-date").style("opacity", 0);
    styles_(d3.select("#error"), {top:"-9999px", left:"-9999px", opacity:0}); 
    d3.select(sky.formRoot).select("#datepick").classed("active", false);
    sky._lifecycle.cancel(hideTimer);
    hideTimer = sky._lifecycle.schedule(function () { $form("celestial-date").style.top = px(-9999); }, 600);
  }
  
  // `this` is the clicked day cell or the time zone select. The hour, minute
  // and second fields call pick() plainly, and in module (strict) code `this`
  // is then undefined, not the global object — hence the guard.
  function pick() {
    var h = $form("hr").value, m = $form("min").value,
        s = $form("sec").value, tz = +$form("tz").value;
        
    if (this && this.id && this.id.search(/^\d/) !== -1) {
      date = dateParse(this.id); 
    }
    fillYrSel();
    
    date.setUTCHours(h, m, s);
    set();
    
    offset = +tz;
    callback(fromWallTime(date, offset), offset);
  } 
  
  
};

export { datetimepicker };
