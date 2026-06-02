# Encoding-driven HeatmapView — assignable axes for 2-D field views

**Status:** plan + phase 1 implementation (2026-06-01)
**Motivation:** user asked "can plots be editable — let the user change which axis is
which variable? marimo/Perspective do this cleverly." Today each heatmap view
(`psd_heatmap`, `spectrogram`, `raster`) hardcodes its axes, so "put depth on Y"
is a code change per view. This generalizes the 2-D-field family.

## 1. The smell

`psd_heatmap` *is* "channel-on-X, freq-on-Y" baked into a render loop;
`spectrogram` *is* "time-on-X, freq-on-Y"; `raster` *is* "time-on-X,
channel-on-Y". They are the **same kind of object** — a 2-D field over two
chosen dims, colored by value, with the remaining dims reduced — drawn three
hardcoded ways. Every axis-orientation question becomes a commit.

## 2. Inspiration (from `resources/`)

- **Observable Plot** (`resources/observable-plot`): declarative `encoding` —
  `Plot.cell(data, {x: field, y: field, fill: field})`. Renderer is generic;
  the spec is data. Fields aren't locked to roles — swap `x`↔`y` freely.
- **Perspective** (`resources/perspective`): `group_by` / `split_by` /
  `aggregates` — two independent pivot axes + a reduction for everything else.
  Re-pivot live, no code.

Common pattern both share: **which dim → X, which dim → Y, which → color, and
how to reduce the rest** — expressed as a small `encoding` object, edited live.

## 3. Key enabler — the v1 wire is already dim-generic

`encode_arrow_payload` emits **long format**: one row per cell, one column per
`data.dims` + `value` (+ now non-dim coords like `depth`, per commit `4e1224f`).
So the decoded slice already carries every dim as a named column. A generic
pivot needs no new wire format and no v2 dependency:

```
DecodedSlice {columns, rows}  →  pick xDim, yDim from columns  →
  reduce (mean) over the other dims  →  2-D grid {xVals, yVals, values}
```

This is the whole trick: the data is already tidy; only the *view* was rigid.

## 4. Design

### 4.1 Encoding object

```ts
type HeatmapEncoding = {
  x: string;            // dim name → X axis
  y: string;            // dim name → Y axis
  reduce?: "mean" | "max";   // applied to all dims other than x/y (default mean)
  // color is always `value`; log handling is per-view (freqLog, log-power)
};
```

Per-panel state (keyed by view id), like `panelTensorOverrides` — so two panels
of the same view can hold different orientations. Each view_type ships a
**default encoding** that sets the initial axes; the user can swap/reassign.

Defaults (channel/depth on Y per the user's preference):

| view_type   | default x | default y | note |
|-------------|-----------|-----------|------|
| `psd_heatmap` | `freq`  | `channel` | was channel-X/freq-Y; flipped so depth/channel is vertical |
| `raster`      | `time`  | `channel` | already channel-Y |
| `spectrogram` | `time`  | `freq`    | unchanged default; freq stays vertical |

A `(freq, AP, ML)` PSD cube exposes dims `{freq, AP, ML}` (+ a synthesized
`channel`); the user can put `AP` on Y and `ML` on X for a true spatial PSD, or
`freq` on Y vs `channel` on X — all from one component.

### 4.2 Generic extractor

`extractHeatmapND(decoded, encoding) → HeatmapGrid` (`frontend/src/api/heatmap.ts`):

```ts
type HeatmapGrid = {
  xDim: string; yDim: string;
  xVals: number[];          // sorted unique coord values for x
  yVals: number[];          // sorted unique coord values for y
  values: Float64Array;     // row-major [yIdx * nx + xIdx], reduced over other dims
  nx: number; ny: number;
  availableDims: string[];  // numeric dim columns the user can assign
};
```

Pivot: bucket each row by (xVal, yVal), accumulate `value` with the reduce op
over every other dim, emit the dense grid. NaN where no cell. O(rows).

### 4.3 Component

One `HeatmapView` (`frontend/src/components/views/HeatmapView.tsx`):
- canvas paint (ImageData blit, nearest-neighbor) — y top = max(yVal).
- **axis controls** in the panel toolbar: an `X:[dim▾] Y:[dim▾]` pair of
  dropdowns (populated from `availableDims`) + a `⇄` swap button. Changing them
  updates the per-panel encoding → repaint (no refetch — same slice, re-pivoted).
- reuses `useHeatmapGestures`, `ColorBar`, `XTicks`/`YTicks`.
- color: linear by default; `log` toggle for power-like data.

### 4.4 Crosshair

`CrosshairOverlay` gains an axis-aware mode. Today it assumes time→X, freq→Y.
Generalize to "value on a given axis": the heatmap reports which dim is on which
axis; the overlay maps `hoverTime`/`hoverFreq` (and a new generic hover) to the
correct axis. For phase 1, the freq cursor follows whichever axis `freq` is on.

## 5. Phasing

- **Phase 1 (this change):** `extractHeatmapND` + `HeatmapView` + per-panel
  encoding store. Migrate **`raster`** and **`psd_heatmap`** to it (the two
  where depth-on-Y matters and which have no time-window coupling). Defaults
  put channel/depth on Y. psd_heatmap's three siblings (curve/spatial) stay.
- **Phase 2:** migrate `spectrogram` (it has the `externalXRange` time-window
  coupling + v2 path + "Computing…" state — more care). Then retire the three
  bespoke components.
- **Phase 3:** persist encoding to the layout store (survives reload); allow
  `color`-dim assignment for >3-D cubes; optional per-axis scale (log) in the
  encoding rather than per-view flags.

## 6. Risks

- **Reduction surprise.** Putting two dims on axes silently means-reduces the
  rest. Surface the reduced dims + op in the panel (e.g. "mean over AP") so it's
  not a silent average.
- **Discrete vs continuous axes.** `channel` is ordinal; `freq`/`time` are
  continuous. The grid treats both as sorted unique values (band cells) — fine
  for a heatmap, but tick formatting should respect the dim.
- **Perf.** Re-pivot on axis swap is O(rows); for the largest raster (~0.5 M
  rows) that's a few ms — acceptable. The slice itself is not refetched.
