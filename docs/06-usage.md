# Usage notes from upstream triage

These examples target this branch. They were checked against the source, but
were not executed during the upstream-fixes pass. See the
[triage record](05-upstream-triage.md) for remaining verification.

## Mount, update and unmount

```js
import { SkyMap } from "celestial-chart";

const sky = new SkyMap({
  container: "chart",
  datapath: "/data/",
  width: 0,
  projection: "orthographic",
  center: [120, 30, 0],
  follow: "center",
  disableAnimations: true
}, { standalone: true });

sky.apply({ constellations: { lineStyle: { stroke: "#f00" } } });
const targetZoom = 3;
sky.zoomBy(targetZoom / sky.zoomBy());
sky.resize({ width: 600 });

// On component unmount:
sky.destroy();
```

The host element must already exist. Width zero measures it; explicit widths
are drawing widths in CSS pixels. The existing automatic-width inset remains
16px per side. `apply()` preserves unspecified nested style properties. It does
not implement an absolute zoom setter: use `zoomBy()` as above, subject to
`zoomextend`. These updates do not require another `display()` call.

`center` uses sky longitude, latitude and orientation in degrees, even for
equatorial coordinates. The equatorial form displays longitude as hours.
`geopos` and `location()` use geographic **latitude, longitude**.

Mounting another map on the same host disposes its predecessor. `destroy()` is
idempotent and removes owned Canvas, data-container and form nodes, listeners,
timers and pending catalogue callbacks. A supplied existing canvas is retained,
but its previous drawing state is not restored. Legacy `Celestial.add()` layers
and save callbacks remain tied to the global `Celestial.display()` interface;
they are not a per-instance extension API.

Export the instance after its required catalogues have loaded:

```js
sky.exportSVG(svg => consumeSvg(svg));
```

Each export captures the map's configuration, dimensions and observer state at
request time. Concurrent exports have separate temporary DOM. Export is still
a browser operation; importing the package in Node does not remove its DOM and
Canvas requirements. Disposal cancels an outstanding export without calling its
success callback.

## Observer time and calendar years

```js
const sky = new SkyMap({
  container: "observer",
  datapath: "/data/",
  form: true,
  formFields: { location: true },
  follow: "zenith",
  date: new Date("2026-03-29T01:00:00Z"),
  geopos: [59.33, 18.07],
  timezone: 0,
  settimezone: false,
  daterange: [2020, 2030]
}, { standalone: true });

sky.skyview({
  date: new Date("2026-10-25T01:00:00Z"),
  location: [59.33, 18.07],
  timezone: 0
});
```

A `Date` is an absolute instant. The numeric timezone is minutes east of UTC;
zero is valid. Changing only the timezone changes the displayed calendar, not
the instant or sky position. Getters return copies of the date and location.
An explicit offset suppresses automatic lookup for that update. Keep
`settimezone: false` when subsequent date/location updates must retain it.
Otherwise the resolver refreshes for changed timestamps as well as coordinates.
Rejected, invalid or throwing resolvers fall back to a longitude estimate;
superseded replies cannot overwrite newer state.

`daterange` limits the calendar's year selector, not accepted API dates:

| Configuration | Years offered |
| --- | --- |
| `[2020, 2030]` | 2020 through 2030 inclusive |
| `[5]` | Displayed year minus five through displayed year plus five |
| `[2026, 2]` | 2024 through 2028 |

It is a numeric year range, not an array of Date objects. Exact day boundaries
are not supported.

## Grid labels and page backgrounds

```js
sky.apply({
  lines: { graticule: {
    lon: { pos: [30, -30] },
    lat: { pos: ["center"] }
  } }
});
```

With the equatorial transform, longitude labels are right ascension in hours.
The example puts them along declinations +30 and -30 degrees. Latitude labels
follow the current central longitude. `"outline"` chooses view-relative edge
anchors. This does not add geographic N/E/S/W headings or a level horizon.

A page image can show through a transparent map:

```css
#chart { background: url("/images/background.jpg") center / cover; }
```

```js
sky.apply({ background: { fill: "transparent", opacity: 0 } });
```

The CSS image is not included in PNG or SVG export. Nor is it reprojected into
sky coordinates. Exportable constellation art or sky rasters require a separate
image-placement and projection design.

## Languages and cultural catalogues

A new language requires catalogue properties and registry entries. There is no
public language-registration API. For a source build, add the language to the
relevant tables in [config.js](../src/config.js), before `formats_all` is built.
For example, add `uk: "Ukrainian"` to `formats.constellations.iau.names` and
provide the matching `uk` property in the constellation catalogue. Star names
use a separate lookup indexed by catalogue ID:

```json
{
  "32349": { "name": "Sirius", "uk": "Сіріус" }
}
```

Register star translations under `formats.starnames.iau.propername`. Rebuild the
package, then select the registered language with `lang`, or choose individual
name fields such as `stars.propernameType`. Star proper names fall back to
`name`; constellation labels directly read the selected property, so populate
it for every displayed constellation. Setting `lang` alone does not translate
catalogue contents.

Names, line geometry and boundary geometry are separate files. A constellation
name feature needs a label position, rank and display center, for example:

```json
{
  "type": "Feature",
  "id": "Example",
  "properties": {
    "name": "Example", "rank": 1, "display": [15, 20, 1]
  },
  "geometry": { "type": "Point", "coordinates": [15, 20] }
}
```

Put features in a GeoJSON FeatureCollection. Line files use LineString or
MultiLineString geometries; boundaries need their actual boundary geometry and
membership IDs. Merely changing the names file does not create cultural borders.
Use a separate `datapath` with compatible files. Adding a culture also requires
filename/format registration and updating `applyDefaults` culture validation,
which currently accepts IAU and Chinese data. The retained harness data is a minimal upstream
subset, not a full collection of cultural catalogues.

## Astrometry limits

The equatorial/ecliptic/galactic transformations use fixed Euler matrices.
They have no date or epoch parameter. Time-dependent planet and Moon positions
do not imply epoch-aware precession and nutation for the whole catalogue.
Applications needing that accuracy must define and transform their catalogue
epochs separately.
