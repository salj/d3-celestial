// Browser regressions for the upstream fixes. Called by verify --smoke/--all.
// These exercise public behavior, including asynchronous export and remounts.
export async function checkInstances(page, check, baseURL) {
  await page.goto(baseURL + "/demo/two-forms.html", {waitUntil: "load"});
  await page.waitForFunction(() => window.__a && window.__b);
  await page.evaluate(async () => {
    const {SkyMap} = await import("/build/celestial.mjs");
    const options = {
      width: 320, datapath: "/harness/data/", projection: "orthographic",
      center: [0, 0, 0], follow: "center", disableAnimations: true,
      interactive: false, form: true, settimezone: false, timezone: 0,
      date: new Date("2026-03-29T00:59:59Z"),
      planets: {show: false}, horizon: {show: false}, daylight: {show: false},
      lines: {graticule: {lon: {pos: [30, -30]}, lat: {pos: ["center"]}}}
    };
    window.__a = new SkyMap({...options, container: "map-a", zoomlevel: 5}, {standalone: true});
    window.__b = new SkyMap({...options, container: "map-b"}, {standalone: true});
  });
  await page.waitForFunction(() => [window.__a, window.__b].every(sky =>
    sky.container.selectAll(".star").size() > 1000 && sky.container.selectAll(".dso").size() > 0 &&
    Object.keys(sky.starnames).length > 0 && Object.keys(sky.dsonames).length > 0 && sky.origin));

  const scale = await page.evaluate(() => {
    const a = window.__a, b = window.__b;
    b.zoomBy(5);
    function radii(sky) {
      const values = [], context = sky.context, original = context.arc;
      context.arc = function(...args) { values.push(args[2]); return original.apply(this, args); };
      try { sky.redraw(); } finally { context.arc = original; }
      return values;
    }
    const first = radii(a), second = radii(b);
    const fixed = JSON.stringify(a.container.selectAll(".graticule_lon").data());
    const relative = JSON.stringify(a.container.selectAll(".graticule_lat").data());
    a.rotate({center: [60, 30, 0]});
    const labels = fixed === JSON.stringify(a.container.selectAll(".graticule_lon").data()) &&
      relative !== JSON.stringify(a.container.selectAll(".graticule_lat").data());
    a.resize({width: 440}); a.resize({width: 320});
    return {same: first.length > 0 && JSON.stringify(first) === JSON.stringify(second),
      zoom: a.zoomBy(), labels, forms: document.querySelectorAll("#celestial-form").length};
  });
  check("initial zoom and zoomBy draw identical symbol radii", scale.same);
  check("resize retains relative zoom", Math.abs(scale.zoom - 5) < 1e-9);
  check("relative grid labels move while fixed labels stay fixed", scale.labels);
  check("remount replaces forms", scale.forms === 2);

  await page.evaluate(() => window.__a.reproject({projection: "hammer"}));
  await page.waitForFunction(() => window.__a.cfg.projection === "hammer");
  check("reprojection retains relative zoom", await page.evaluate(() => Math.abs(window.__a.zoomBy() - 5) < 1e-9));

  const time = await page.evaluate(() => {
    const a = window.__a, b = window.__b;
    const instant = new Date("2026-03-29T01:00:00Z");
    a.skyview({date: instant, location: [59.33, 18.07], timezone: 0});
    const zenith = a.zenith().slice(), utc = a.dateFormat(a.date(), a.timezone());
    a.timezone(345);
    const offsetOnly = a.date().valueOf() === instant.valueOf() &&
      JSON.stringify(a.zenith()) === JSON.stringify(zenith);
    a.timezone(0);
    const copy = a.date(); copy.setUTCFullYear(1900);
    return {offsetOnly, utc, instant: a.date().toISOString(),
      other: b.date().toISOString(), zero: a.timezone()};
  });
  check("offset setters preserve the instant and accept UTC", time.offsetOnly && time.zero === 0 &&
    time.instant === "2026-03-29T01:00:00.000Z" && time.utc.startsWith("2026-03-29 01:00:00"));
  check("observer dates belong to each map", time.other === "2026-03-29T00:59:59.000Z");

  const exports = await page.evaluate(async () => {
    const a = window.__a, b = window.__b;
    a.resize({width: 320}); b.resize({width: 440});
    a.apply({background: {fill: "#123456"}});
    b.apply({background: {fill: "#654321"}});
    const exportMap = sky => new Promise(resolve => sky.exportSVG(resolve));
    const first = exportMap(a);
    a.apply({background: {fill: "#abcdef"}});
    const [av, bv, again] = await Promise.all([first, exportMap(b), exportMap(a)]);
    const parse = text => new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    return {widths: [av, bv, again].map(text => +parse(text).getAttribute("width")),
      expected: [a.metrics().width, b.metrics().width, a.metrics().width],
      snapshots: av.includes("#123456") && !av.includes("#abcdef") &&
        bv.includes("#654321") && again.includes("#abcdef"),
      clean: document.querySelectorAll(".d3-celestial-svg").length === 0};
  });
  check("concurrent standalone exports retain their map dimensions",
    JSON.stringify(exports.widths) === JSON.stringify(exports.expected));
  check("exports retain the configuration at request time", exports.snapshots);
  check("exports remove their temporary DOM", exports.clean);

  const disposal = await page.evaluate(() => {
    const a = window.__a, b = window.__b;
    const removedForm = a.formRoot;
    a.destroy(); a.destroy();
    a.resize({width: 900}); a.rotate({center: [90, 0, 0]});
    b.resize({width: 360});
    window.dispatchEvent(new Event("resize"));
    return {removed: !removedForm.isConnected &&
        document.querySelectorAll("#map-a canvas, #map-a container").length === 0,
      alive: b.formRoot.isConnected && b.metrics().width > 0 &&
        document.querySelectorAll("#map-b canvas").length === 1,
      forms: document.querySelectorAll("#celestial-form").length};
  });
  check("destroy is idempotent and removes owned DOM", disposal.removed);
  check("disposing one map leaves the other alive", disposal.alive && disposal.forms === 1);

  const originalViewport = page.viewportSize();
  await page.evaluate(() => window.__b.resize(0));
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({width, height: 900});
    const layout = await page.evaluate(() => {
      window.__b.resize();
      const canvas = document.querySelector("#map-b canvas").getBoundingClientRect();
      const form = window.__b.formRoot;
      return {fits: canvas.left >= 0 && canvas.right <= innerWidth,
        wraps: getComputedStyle(form.querySelector(".col")).whiteSpace === "normal",
        font: getComputedStyle(form.querySelector(".weekday")).fontSize};
    });
    check(`custom map and form fit a ${width}px viewport`, layout.fits && layout.wraps);
    check(`weekday font at ${width}px`, layout.font === "11px");
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
}
