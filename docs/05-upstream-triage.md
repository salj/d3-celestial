# Upstream triage and implementation status

Reviewed 2026-09-14 against `celestial-chart` at `78c1977` and live upstream
`master` at `7e720a3de062059d4c5400a379146a601d9010e0`.

The GitHub API returned **44 open issues and 8 open PRs**. This review includes
all issue bodies and comments, PR file changes and available reviews. The web
listing was cached and undercounted; the API inventory is the source of truth.
Sources: [open issues](https://github.com/ofrohn/d3-celestial/issues?q=is%3Aissue+is%3Aopen)
and [open PRs](https://github.com/ofrohn/d3-celestial/pulls?q=is%3Apr+is%3Aopen).

This is a plan for this branch, not a proposal to merge everything into the
legacy upstream release. "Resolved here" does not mean resolved upstream.
No upstream comments, closures or merges were made. The inventory below records
the findings at the review date. The implementation status that follows updates
those findings for `upstream-fixes`; historical descriptions of broken code in
the inventory are not claims about the current implementation.

## Implementation status, 2026-09-15

Changes are committed by concern. **No tests, builds or browser checks were run
in this implementation pass**, as requested. Changed JavaScript and regression
files received syntax checks; patches received whitespace checks. Added test
cases are evidence of intended coverage, not passing results.

| Unit | Implemented change | Evidence still needed |
| --- | --- | --- |
| G1/G2 | Pass the map transform into grid helpers; cache and refresh view-relative anchors while retaining fixed-coordinate labels. [Grid tests](../test/grid.test.mjs). | Run numeric/center/outline cases in Canvas and SVG, including date/location changes. |
| P1 | Begin a new Canvas path and save/restore drawing state for each planet. | Reproduce the stars-off Sun/Milky Way case and inspect pixels across symbol modes. |
| S1 | Keep projection base scale independent of zoom, retain relative zoom through resize/reprojection, handle DPR changes and preserve noninteractive canvas dimensions. | Run initial-vs-applied zoom and width cases at DPR 1/2; confirm #101/#138 symptoms separately. |
| I1 | Add idempotent `destroy()`, namespaced listeners, owned forms/canvas/data nodes, cancelled timers/loads and stale-load guards. Scope form state, observer state and validation errors. [Lifecycle tests](../test/lifecycle.test.mjs). | Run mount/unmount/remount and independent resizing; exercise disposal during active work. Existing supplied canvas state is not restored. |
| I2 | Capture instance metrics, configuration, observer/planet positions and name tables; isolate each temporary SVG root and clean it up. Standalone exports do not run global legacy save callbacks. | Run concurrent exports of different maps and repeated exports of one map. Legacy custom save callbacks remain global. |
| T1a/T1b | Keep an absolute instant, edit offset-shifted UTC calendar fields, accept zero, initialize date/location directly and apply observer updates atomically. Rewrite #135 with time-aware deduplication and stale/disposed-result guards. [Time tests](../test/time.test.mjs). | Run browser cases under different host zones and across DST, plus calendar interactions and async offset replies. |
| A1 | Replace the longitude nudge with a stable great-circle tangent, including polar antipodes and exact endpoints. [Interpolation tests](../test/interpolation.test.mjs) call the actual implementation. | Run the numeric cases and inspect animated pole-to-pole rotation. |
| U1 | Port selected #155 CSS, add lifecycle-owned classes for arbitrary hosts, make current demos responsive, wrap forms and enlarge controls. | Run 320/375/768px layouts and coarse-pointer controls; drag, pinch and page scrolling remain unverified. |
| D1 | Extract #150's weekday `font-size` correction as one commit. | Check the computed 11px size in a browser. |
| D2 | Add [usage examples](06-usage.md), correct the numeric year-range type and document coordinate units, observer semantics and data/export limits. | Execute examples before using them as upstream closure evidence. |
| Additional #110 finding | Recursively merge partial nested styles instead of dropping unspecified widths, opacity, fonts and label options. Arrays remain replacements. [Config tests](../test/config.test.mjs). | Run the unit cases and line-color update/export example. |
| #51 Canvas portion, from `misc.patch` | Clip Canvas geometry, symbols, labels and legacy redraw layers to the projected outline, preserving the border stroke outside the content clip. | Inspect edge labels and symbols across projections and zoom levels. SVG glyph clipping remains unimplemented, so #51 is not fully resolved. |
| DATA1 | Record current data/distribution inventory in [NOTICE](../NOTICE.md), alongside the existing provenance account. | Permission evidence remains unresolved; no replacement data or upstream contact. |

[Browser regressions](../harness/instance-checks.mjs) are wired into the existing
`--smoke` and `--all` harness modes. They cover rendered symbol radii, grid
anchors, resize/reprojection zoom, observer isolation, concurrent SVG snapshots,
remount/disposal and narrow custom-container layouts. They have not been run.
V1 remains open: especially the stars-off planet image, DPR 2, initial observer
follow, noninteractive quarter-globe and constellation-animation reports need
reproduction before claiming closure.

S2 (configurable inset), H1/H2 (headless and horizontal-view APIs), projected
imagery, hit testing and the other optional features remain separate work.
The PR dispositions remain unchanged: selected intent from #135/#155 and the
#150 typo were implemented; no whole upstream PR was merged.

## Decisions

- **No whole PR is ready to merge into this branch unchanged.** Port the mobile
  CSS intent from #155; rewrite the date-refresh intent from #135. The other
  PRs are obsolete tooling, unrelated hosting changes, or overlapping bundles.
- The highest-value independent fixes are grid-label scope, planet drawing
  path isolation, initial zoom sizing, explicit UTC handling, and instance
  lifecycle/resize/export isolation.
- Several old tickets can be answered with current APIs and examples. Do not
  turn every support question into another configuration option.
- Browser-free rendering, horizontal views and projected imagery are separate
  features. ESM and custom-layer callbacks do not make them automatically done.
- #160 is a data provenance dependency. Keep its investigation separate from
  renderer correctness and record what evidence is actually available.

The imported fork's earlier `docs/03-issues.md` survey is historical and was
not retained in this reconstruction. In particular, its
claims about #81 and #107 are too broad, and it omits #51, #56 and #112 as well
as the newer #159 and #160. Its advertised category counts also do not match
its rows.

## PR inventory at review

| PR | Decision for this branch | Evidence and independent action |
| --- | --- | --- |
| [#135](https://github.com/ofrohn/d3-celestial/pull/135) Refresh position when time changes | Rewrite; relevant to #95/#128 | One change in `src/location.js`. It assigns undeclared `prev_date`, which throws in ESM strict mode. It also stores a mutable `Date` reference; current date setters mutate that object. Refreshing the resolver must handle explicit offsets, recursive `go()` calls and stale async replies. Implement T1 below, not a cherry-pick. |
| [#140](https://github.com/ofrohn/d3-celestial/pull/140) minimatch update | Irrelevant here | Lockfile-only update to the retired build toolchain. Current `package-lock.json` has no minimatch entry. It may still be useful on a separately maintained legacy branch. |
| [#143](https://github.com/ofrohn/d3-celestial/pull/143) tough-cookie/jsdom update | Irrelevant here | Both dependencies are absent from this branch's lockfile. Do not bring back the old dependency graph to apply its update. |
| [#150](https://github.com/ofrohn/d3-celestial/pull/150) Add index.html | Reject bundle; extract one typo fix | Five commits also add editor/IDX settings, rewrite the generated `celestial.js`, churn the lockfile, and force form sections visible with `!important`. The latter overrides configured visibility. Its `font-sixe` -> `font-size` correction still applies to `celestial.css`; make that a tiny independent commit. The generated bundle rewrite was not adopted or execution-tested. |
| [#152](https://github.com/ofrohn/d3-celestial/pull/152) Move demo to docs | Irrelevant here | Renames twelve old demo pages with no content changes. This branch has different demos and uses `docs/` for engineering documentation. No library fix. |
| [#154](https://github.com/ofrohn/d3-celestial/pull/154) Pages deployment | Reject bundle | Despite its title, includes all of #155's CSS/demo changes, plus a workflow that uploads the entire checkout. Hosting is separate from the library; if Pages is wanted later, build a deliberate artifact in the site repository. |
| [#155](https://github.com/ofrohn/d3-celestial/pull/155) Mobile support | Port selected changes independently | Useful removal of 720px minimum width, larger controls and wrapping forms. But selectors assume `#celestial-map`, twelve patched demos no longer exist here, and CSS alone does not establish touch behavior. Adapt selectors for arbitrary instance containers and add viewports to current demos. See U1. |
| [#156](https://github.com/ofrohn/d3-celestial/pull/156) Mobile UI branch | Superseded bundle | Contains #154/#155 plus a 525-line mobile demo using old D3 v3 script paths. Shared CSS and twelve demo blobs are byte-identical across #154/#155/#156. Take the mobile library work once, from #155; treat the extra demo as optional site work. |

Reviewed PR heads: #135 `8af281d`, #140 `be5f729`, #143 `830661f`,
#150 `0c6d9e7`, #152 `c0eeabd`, #154 `6b4242e`, #155 `01a6a88`, #156 `2d090a7`.
GitHub's mergeability field describes merging into upstream master, not this
modernized branch and not semantic correctness.

## Issue inventory at review

### Fix already present: six issues

These have concrete implementation evidence. Existing tests were inspected,
not rerun during this planning pass; dependencies are not installed.

| Issue | Disposition | Evidence / closure requirement |
| --- | --- | --- |
| [#148](https://github.com/ofrohn/d3-celestial/issues/148) horizontal.inverse sign | Resolved here; independently backportable | Sign correction and clamping in [horizontal.js](../src/horizontal.js); round-trip coverage in [horizontal tests](../test/horizontal.test.mjs). Backport only the math change and focused tests if maintaining upstream. |
| [#130](https://github.com/ofrohn/d3-celestial/issues/130) Moon phase | Resolved reported case here; independently backportable | [Moon tests](../test/moon.test.mjs) cover 2022-03-18; [drawing tests](../test/moon-drawing.test.mjs) cover Canvas/SVG terminators. Preserve the distinction between phase computation, coordinate conversion and drawing geometry when splitting backports. |
| [#147](https://github.com/ofrohn/d3-celestial/issues/147) Old D3 | Superseded here | D3 v7 modules and local drag adapter replace the old global D3 path. No additional version bump is needed to answer this request. |
| [#141](https://github.com/ofrohn/d3-celestial/issues/141) ESM refactor | Resolved core request here | [ESM entry](../src/index.js), [build](../build.mjs), package exports. The projection reference harness supports the migration; do not interpret ESM alone as proof that every module is independently tree-shakable. |
| [#134](https://github.com/ofrohn/d3-celestial/issues/134) d3 undefined | Superseded import failure here | Internal D3 imports and bundled output replace the failing upstream `require('./lib/d3.js')` integration. Type declarations also exist. Verify a browser consumer using the published artifact before posting a migration answer. |
| [#115](https://github.com/ofrohn/d3-celestial/issues/115) Namespace import lacks display | Resolved through supported API | Use `import Celestial from 'celestial-chart'` or named `{ Celestial }`, then call `display`. `import * as Celestial` is a module namespace and is not the same API. Include an Angular/browser integration example rather than promising old imports work unchanged. |

### Partial fixes and closure candidates: nine issues

| Issue | Disposition | Remaining work |
| --- | --- | --- |
| [#157](https://github.com/ofrohn/d3-celestial/issues/157) 12-hour interpolation | Partial fix | Longitude turns are covered, but [interpolation tests](../test/interpolation.test.mjs) explicitly assert the pole-antipode limitation still exists. A1 must cover north/south pole transitions before claiming all antipodes fixed. |
| [#96](https://github.com/ofrohn/d3-celestial/issues/96) Multiple configurations | Basic case implemented; isolation incomplete | Instance state and forms exist. `d3.select(window).on('resize', ...)` overwrites the preceding instance's handler; SVG still reads global metrics. I1/I2 before broad closure. |
| [#131](https://github.com/ofrohn/d3-celestial/issues/131) Multiple maps | Same work as #96 | Keep one implementation task, two issue references. Existing two-form harness covers changes through forms, not independent resize/export/disposal. |
| [#86](https://github.com/ofrohn/d3-celestial/issues/86) React integration | Imports improved; lifecycle remains | Thread includes SVG export failures, not just importing. Add mount/unmount/remount and independent exports after I1/I2. There is no `destroy()` lifecycle today. |
| [#100](https://github.com/ofrohn/d3-celestial/issues/100) Invalid selector/repeated display | Original selector fixed; cleanup needs validation | Missing space was fixed upstream. Last report concerns leftover forms. Current harness checks form count after redisplay, but cleanup of listeners, timers and pending data loads belongs to I1. |
| [#103](https://github.com/ofrohn/d3-celestial/issues/103) showConstellation animations | Likely fixed; verify narrow behavior | Maintainer reports fix in 0.7.35. `zoomBy`, `rotate` and `reproject` honor `disableAnimations`; `showCon` queues these with zero durations. Assert settled final state and no delayed visible transition. This is not a headless-rendering solution. |
| [#94](https://github.com/ofrohn/d3-celestial/issues/94) Initial animation | Support/verification | Document `follow: 'center'`, explicit center, `disableAnimations: true`. Test initial observer-follow separately because location updates can trigger rotation. No new animation switch. |
| [#93](https://github.com/ofrohn/d3-celestial/issues/93) Initial geopos ignored | Upstream fix present; verify initialization | Maintainer identified deprecated `location:false` gating. Current constructor calls location setup, then rotates when location fields are enabled. Test nonzero geopos, `follow:'zenith'`, fields enabled and form hidden; coordinate/time interaction belongs to T1. |
| [#101](https://github.com/ofrohn/d3-celestial/issues/101) Noninteractive quarter-globe | Needs reproduction, not speculative patch | Maintainer could not reproduce. Recreate altstars-equivalent orthographic map at fixed size and auto width, `interactive:false`, DPR 1/2, before any resize. Compare with interactive initial render. Route a confirmed width issue to S1. |

### Independent correctness and layout work: seven issues

| Issue | Disposition | Evidence / plan |
| --- | --- | --- |
| [#125](https://github.com/ofrohn/d3-celestial/issues/125) Moving grid labels | Active; G1 then G2 | `getGridValues` receives `sky`, but sibling helper `getLine` references it without a parameter. Numeric label positions currently throw `ReferenceError`. Then fix label positions generated only at load, so center/outline labels follow changed date/location/rotation. |
| [#113](https://github.com/ofrohn/d3-celestial/issues/113) Initial zoom changes star sizes | Active; S1 | Initialization multiplies the reference `scale` by `zoomlevel`; redraw uses `sqrt(projection.scale()/scale)`. Initial zoom 5 produces adaptation 1, while zooming from 1 to 5 produces sqrt(5). Resize/reproject repeat this baseline mutation. |
| [#138](https://github.com/ofrohn/d3-celestial/issues/138) Width behavior | Reproduce its three symptoms; S1 | Missing-container `getWidth` and resize-event argument fixes do not prove this report fixed. Test initial auto width, explicit width via form/API, and symbol sizing after repeated resize. Share scale correction with #113; keep independent width defects in their own commit. |
| [#142](https://github.com/ofrohn/d3-celestial/issues/142) Forced margins | Valid independent change; S2 | `margin=[16,16]` and `getWidth()` still subtract 32px from parent width. Define a compatibility policy, preferably default-preserving configurable inset with zero supported. Keep parent CSS padding distinct from projection drawing extent; cover Canvas and SVG dimensions. |
| [#124](https://github.com/ofrohn/d3-celestial/issues/124) Planets without stars flood canvas | Strong source-level candidate; P1 | Planet disk drawing calls `Canvas.symbol('circle')` then `fill` without starting a path; circle helper appends to the existing path. Prior stars can hide the bug by resetting that path. Reproduce with only Sun/disk plus background/Milky Way, then isolate each filled symbol's path/state. |
| [#95](https://github.com/ofrohn/d3-celestial/issues/95) DST rotation jumps | Active; T1 | Current code caches host `localZone`, parses local wall-clock strings, and only resolves zone when coordinates change. Removing the bundled API key did not fix time semantics. Explicit UTC must remain continuous across host DST transitions. |
| [#128](https://github.com/ofrohn/d3-celestial/issues/128) Initial date/location | Part support, part T1 | Thread reports inconsistent timezone between initial config and later location update. Specify one atomic date/location/offset update; test explicit offset including zero. Document center as sky longitude/latitude/orientation in degrees, geographic position as latitude/longitude. |

### Support, documentation and data work: ten issues

| Issue | Disposition | Independent resolution |
| --- | --- | --- |
| [#137](https://github.com/ofrohn/d3-celestial/issues/137) Date range | Existing year-range API; document/test | `[2020,2030]` selects inclusive years; `[5]` means current year +/-5; `[2026,2]` means 2024..2028. Read `getDateRange`/`fillYrSel` in [datetimepicker](../src/datetimepicker.js). Exact day limits are not implemented and should be a separate request. The early `years` initializer runs before `dtrange`, but the actual select recomputes after initialization; do not misdiagnose that dead initializer as the reported bug. |
| [#110](https://github.com/ofrohn/d3-celestial/issues/110) Change line color | Existing API | Example: `sky.apply({constellations:{lineStyle:{stroke:'#f00'}}})`. Verify no extra canvas/form and updated export. No `display()` required. |
| [#112](https://github.com/ofrohn/d3-celestial/issues/112) Zoom using apply | API clarification | `apply` merges styles/config and redraws; it does not apply a new projection scale. Use `sky.zoomBy(target / sky.zoomBy())`, with supported limits; verify after S1. If absolute zoom through `apply` is desired, scope it explicitly as an API behavior change. |
| [#91](https://github.com/ofrohn/d3-celestial/issues/91) Add language | Data + registration example | Both catalogue name properties and the supported formats registry must include the language. Demonstrate a minimal fixture and fallback behavior, not just `lang='ua'`. No need to disable language validation. |
| [#123](https://github.com/ofrohn/d3-celestial/issues/123) Custom cultural borders | Needs clearer requested data; docs candidate | Explain names vs constellation line/boundary geometry and the expected GeoJSON. The branch only bundles a minimal harness catalogue; it does not contain the full upstream cultural datasets. A supplied small custom layer can be documented independently; a new authoritative catalogue is separate work. |
| [#64](https://github.com/ofrohn/d3-celestial/issues/64) RA headings | Existing intended feature, blocked by G1 | Despite the title this asks for RA hours, not N/E/S/W horizon labels. Maintainer recommends longitude labels along selected declinations, e.g. `lines.graticule.lon.pos:[30,-30]`. That currently reaches the broken `getLine`; verify after G1, use G2 for moving outline labels. |
| [#79](https://github.com/ofrohn/d3-celestial/issues/79) Image background | CSS solution for page display | Use transparent map background over parent CSS image. Explicitly state CSS backgrounds are not part of Canvas PNG or exported SVG. Exportable imagery is separate from this simple page composition. |
| [#153](https://github.com/ofrohn/d3-celestial/issues/153) Precession/nutation question | Answer independently; feature only if requested | Coordinate transforms use fixed Euler matrices in [transform](../src/transform.js)/[projection](../src/projection.js), without date/epoch arguments. Explain that limitation; do not claim a complete epoch-aware astrometry pipeline because planet or Moon routines are time-dependent. Implementing one requires a separate accuracy/epoch design. |
| [#109](https://github.com/ofrohn/d3-celestial/issues/109) Missing HAT-P stars | Catalogue work | Maintainer describes Hipparcos selection. Check IDs, catalogue membership, magnitude limits and proper-name mappings for each requested star. Add a sourced fixture or optional catalogue; do not confuse absent data with a rendering defect. Independent of D3. |
| [#159](https://github.com/ofrohn/d3-celestial/issues/159) Maintained fork announcement | Informational; no merge/fix | Announces the project imported into this branch. Useful context, not evidence that every claimed fix is complete. This review checks those claims against source. |

### Separate features: eleven issues

| Issue | Disposition | Scope / dependencies |
| --- | --- | --- |
| [#81](https://github.com/ofrohn/d3-celestial/issues/81) Node module | Unresolved headless feature | Actual request is SVG output without a browser. ESM/CJS import does not solve DOM-dependent construction/export. Design data loading, projection and SVG generation independently of forms/Canvas; see H1. |
| [#56](https://github.com/ofrohn/d3-celestial/issues/56) Star pixel coordinates only | Smaller headless feature; H1 first step | Accept explicit catalogue/config and return projected positions plus visibility, without constructing a map. It can share pure projection work with #81 but need not wait for an SVG renderer. Define transforms, magnitude filters and clipping. |
| [#145](https://github.com/ofrohn/d3-celestial/issues/145) Human sky view | Docs plus horizontal-view feature | A projection recommendation alone does not provide azimuth/altitude camera controls. Explain available projections; share observer-frame design with #107. |
| [#107](https://github.com/ofrohn/d3-celestial/issues/107) Straight horizon/N-E-S-W | Unresolved; H2 | Maintainer explicitly says the library cannot keep the horizon straight. Use horizontal coordinates and observer-frame orientation, cardinal labels and time updates. Depends on settled T1 semantics; do not equate `horizon.show` with this feature. |
| [#151](https://github.com/ofrohn/d3-celestial/issues/151) Constellation art | Optional imagery feature | Start with a scoped custom-layer example, but define how images track sky coordinates, distortion and clipping. Shared design with #144, not with a CSS page background. |
| [#144](https://github.com/ofrohn/d3-celestial/issues/144) Image/map overlay | Optional imagery feature | Distinguish fixed screen overlay from reprojected sky raster. For the latter specify coordinate mapping, resampling and export parity. Do not promise a `drawImage` callback solves arbitrary projection warping. |
| [#149](https://github.com/ofrohn/d3-celestial/issues/149) Radial star glow | Optional layer/style feature | Custom layer can demonstrate gradients independently. Built-in per-star glow needs radius/cache/performance policy and an SVG equivalent. No evidence this should block correctness fixes. |
| [#139](https://github.com/ofrohn/d3-celestial/issues/139) Clickable custom objects | Independent optional feature | Canvas labels are not anchors. Offer a callback with projected hit testing, clipping and pixel-ratio handling. Keep navigation application-owned. Keyboard access/DOM overlay belongs in the example or a defined API. |
| [#106](https://github.com/ofrohn/d3-celestial/issues/106) Existing canvas | Partial incidental support, API undefined | Constructor selects existing canvas children under the container, but overwrites size/transform. It does not accept a canvas/context directly or promise shared drawing ownership. Define ownership and cleanup before adding that API; coordinate with I1. |
| [#97](https://github.com/ofrohn/d3-celestial/issues/97) Style one constellation | Optional layer example or API | Current rank-based styling and selected-constellation behavior are not arbitrary per-ID styles. A custom-layer example is independent; a general style callback/map must cover Canvas and SVG without mutating catalogue ranks. |
| [#51](https://github.com/ofrohn/d3-celestial/issues/51) Labels outside map | Valid independent enhancement | Current point visibility does not clip glyph extents. Choose opt-in outline clipping versus hiding labels whose measured bounds cross the outline. Mirror behavior with SVG clipping; preserve current label placement by default. |

### External evidence: one issue

| Issue | Disposition | Action |
| --- | --- | --- |
| [#160](https://github.com/ofrohn/d3-celestial/issues/160) Milky Way provenance | Relevant, unresolved permission evidence | Maintainer says the original archive gave no licensing information and his contact attempt failed. Posted provenance traces the outer layer to Mourao's atlas and inner layers to Mellinger's photomosaic. Record that evidence and the absence of an explicit permission record; do not mark it solved by the repository BSD notice. Inventory `harness/data/mw.json`, `site/html/data/mw.json`, reference images and package/site distribution separately. Update the vague data paragraph in `NOTICE.md` in its own task. Obtain documented terms or scope replacement data independently; no contact or data removal is authorized by this plan alone. |

## Independent implementation units

These are the concern boundaries and acceptance criteria from the review.
Implementation status is recorded above; unexecuted acceptance checks remain
outstanding. A task is independent unless a dependency is listed.

| Unit | Scope | Acceptance evidence | Dependencies |
| --- | --- | --- | --- |
| G1 | Pass instance/config through `getGridValues` -> `getLine`; #125/#64 | Numeric, center and outline positions produce finite RA/Dec labels; two maps with different transforms do not share settings; exercise Canvas and SVG callers | None |
| G2 | Recompute view-relative grid label anchors; #125 | Date, location and rotation move center/outline anchors correctly; fixed-coordinate labels remain fixed; export agrees | G1 |
| P1 | Isolate planet disk paths/state; #124 | With stars and DSOs disabled, Sun/disk draws only its disk; vary Milky Way, horizon, Moon, symbol mode and draw order | None |
| S1 | Keep base projection scale separate from zoom; #113, part of #138 | Fresh zoom=5 and interactive zoom to 5 have equal star/DSO sizes; repeated resize/reproject has no cumulative drift; auto/explicit widths at DPR 1/2 | None; keep unrelated width corrections separate |
| S2 | Define zero-inset sizing; #142 | Parent width/padding, explicit width and Canvas/SVG size agree for default and zero inset | Separate API change; test alongside S1 once available |
| T1a | Correct explicit time/offset handling; #95/#128 | UTC timestamp +1 second advances continuously over host spring/fall DST; explicit timezone zero works; same instant is independent of host zone | None |
| T1b | Rewrite #135's automatic offset refresh | Resolver gets changed time at unchanged location, no update loop, stale replies discarded, explicit offset respected, two instances independent | T1a time contract |
| I1 | Own resize listeners, lifecycle and pending work; #96/#131/#100/#86 | Resize updates both maps; disposing/remounting one leaves the other alive; no orphan forms/listeners/timers or late load callbacks | None |
| I2 | Finish per-instance SVG/state paths; #96/#131/#86 | Export two different sizes/centers/dates in both orders, concurrently and through standalone instances. Remove global metrics dependency and shared temporary export-ID collision | Can start independently of I1 |
| A1 | Robust interpolation at polar antipodes; #157 | Replace existing known-limitation assertion with bounded, finite, smooth pole-to-pole behavior and exact endpoints; retain longitude regression coverage | None |
| U1 | Port mobile CSS intent from #155 | Current demos at 320/375/768px, default/custom container IDs, two forms, usable zoom/calendar controls; verify drag/pinch and page scrolling rather than asserting CSS implements touch | Can start independently; coordinate resize checks with I1/S1 |
| D1 | Correct `font-sixe` typo from #150 | Calendar weekday computed font size is 11px | None; tiny separate commit |
| D2 | Focused usage examples for #137/#110/#112/#91/#123/#64/#79/#153 | Each example runs against this branch and states output/data limits | #64 needs G1; absolute zoom example checked with S1; other examples independent |
| V1 | Reproduction/closure pass for #93/#94/#100/#101/#103 | Minimal fixed-config browser fixtures, final-state assertions and no console errors; report unconfirmed symptoms honestly | Relevant I1/T1 fixes if fixtures expose them |
| H1 | Pure catalogue-to-pixel API, then browser-free SVG | Node process with no `window`/`document`, deterministic coordinates/visibility; separate later test for SVG string output | #56 independent; #81 builds on data/projection separation |
| H2 | Horizontal observer view; #107/#145 | Horizon remains level across time updates and camera azimuth/altitude changes; cardinal headings agree with observer frame | T1 semantics |
| DATA1 | Document/resolve Milky Way provenance; #160 | Inventory each shipped copy and cite actual provenance/permission evidence or a documented replacement source | External evidence; parallel to code work |

Suggested order:

1. G1, P1, S1, T1a, I1/I2. These address reachable defects, not speculative
   feature work. D1 and DATA1 can proceed independently.
2. G2, T1b, A1, U1 and V1. Keep each concern in its own reviewable commit.
3. D2 and supported closure answers. Do not close the upstream reports merely
   because this fork has a fix.
4. Decide separately whether S2 and optional features are wanted. If headless
   output matters, #56 is the smallest useful H1 slice; #81 follows later.

The code changes for #148 and #130 can also be backported to legacy master
independently of this queue. D3/ESM and multiple-instance work are architectural
changes, not small upstream cherry-picks. The first fork skeleton commit also
removes legacy files, so do not cherry-pick that whole commit just to obtain #148.

## Verification performed for this plan

- Compared live master SHA with local base; both are `7e720a3`.
- Enumerated all 52 open records via GitHub API; read issue discussion and PR
  change/review data. Compared shared PR file blob IDs to establish the mobile
  overlap instead of relying on titles.
- Checked the current lockfile: no jsdom, tough-cookie or minimatch entries.
- Executed the grid helper source in an isolated Node VM with numeric longitude
  labels: `ReferenceError: sky is not defined`.
- Executed #135's added lines in strict mode with unchanged coordinates:
  `ReferenceError: prev_date is not defined`.
- Traced zoom adaptation, Canvas circle/path ownership, instance resize and SVG
  globals, date flow, form animation calls and catalogue/format handling.
- Inspected existing math, packaging and browser verification coverage. No
  dependency installation, full test run or browser symptom reproduction was
  performed. Source-backed candidates and confirmed VM failures are distinguished
  above. Future implementation should run focused regressions, then the existing
  `npm run verify` suite where the environment supports it.
