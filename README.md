# celestial-chart

Browser sky maps using D3 v7, with Canvas drawing, SVG export, bundled ESM,
CommonJS and script-tag builds, and TypeScript declarations.

Derived from [d3-celestial](https://github.com/ofrohn/d3-celestial).
See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for attribution.

## Use

```js
import Celestial, { SkyMap } from "celestial-chart";

Celestial.display({
  container: "celestial-map",
  datapath: "/data/",
  projection: "aitoff"
});

const sky = new SkyMap({
  container: "second-map",
  datapath: "/data/",
  projection: "orthographic"
}, { standalone: true });
```

Create the container elements before constructing maps. For script-tag use,
load `celestial.css` and `build/celestial.min.js`; D3 is included in the bundle.
Rendering requires a DOM and Canvas even when the package is imported in Node.

`display()` retains accumulated settings and returns its map instance.
Standalone maps initialize from defaults and their supplied configuration.
Use `apply()` for styles, `rotate()` for the center, `zoomBy()` for relative
zoom and `resize()` for dimensions. Configuration and method types are in
[types/celestial.d.ts](types/celestial.d.ts).

## Timezone lookup

No API key is supplied. Without configuration, the offset is estimated from
longitude without a network request. For date-aware offsets, supply:

```js
Celestial.display({
  timezoneResolver: (lat, lon, epochSeconds) => lookupOffsetMinutes(lat, lon, epochSeconds)
});
```

The resolver takes precedence over an explicit `timezoneid` for the legacy
TimeZoneDB integration. Rejected or invalid resolver results use the longitude
estimate. This does not resolve the remaining DST/date-update behavior.

## Develop

```sh
npm ci
npm run build
npm run serve
# http://127.0.0.1:8877/demo/full.html
```

[Full UI](demo/full.html), [ESM](demo/module.html),
[two maps](demo/two-maps.html), [two forms](demo/two-forms.html).
Serve the demos over HTTP; fetching catalogues does not work through `file://`.
The package does not include catalogues. The repository retains a minimal
upstream subset in `harness/data/` for examples and regression checks.

See [harness/README.md](harness/README.md) for verification commands.

## Scope and remaining limits

The retained fixes cover horizontal inversion/hour angles, negative angle
normalization, lunar coordinates/terminator geometry, ordinary antipodal
rotation, D3 projection/color compatibility and Milky Way winding.

Polar-antipode interpolation remains unresolved. Multiple maps have separate
render/form state, but resize listeners, some export globals and the grid-label
helper still need isolation fixes. Initial-zoom sizing and UTC/DST handling
also remain open. Browser-free rendering and horizontal observer views are
not implemented by the module conversion.
