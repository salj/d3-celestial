# Regression verification

The harness compares a pinned upstream D3 v3 build with the bundled renderer.
It records 67 projections, four rotations and 413 sky points per combination,
including visibility. Vendor files and numeric references are retained as
fixtures; screenshots are generated artifacts.

```sh
npm run verify       # build, unit tests, declarations and all browser checks
npm run check        # projection references only
npm run check:all    # references, paired screenshots and UI smoke checks
npm run selftest     # verify that the numeric comparator detects changes
```

Local browser runs use installed Chrome. In CI, install Playwright Chromium
and set `CI=1`. Both image versions must be captured in the same environment:
font rendering varies between platforms, so committed PNG byte equality is
not a useful invariant. Numeric reference files are checked for drift.

The smoke checks exercise zoom, drag, projection changes, forms, SVG export,
multiple maps and the missing-container case. This coverage does not establish
that all public configurations or multiple-instance lifecycle paths work.

`reference.html` loads the pinned vendor scripts; `reference-new.html` loads
the current bundle. `visual.html` and `visual-new.html` render the paired views.
`compare.mjs` reports coordinate, visibility and structural differences.
`server.mjs` serves the checkout for these pages and the demos.

Reference data and vendored code are fixtures, not production dependencies.
See [NOTICE.md](../NOTICE.md) for catalogue provenance limits.
