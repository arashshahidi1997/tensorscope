# Observable Plot — Reference Study

**Repo:** https://github.com/observablehq/plot
**Version studied:** v0.6.17 (February 2025)
**Date:** 2026-03-11
**Focus:** grammar-of-graphics API design, rendering, interaction, extensibility — filtered for TensorScope relevance

---

## 1. Repo Overview

Observable Plot is a JavaScript/TypeScript visualization library implementing a layered grammar of graphics. It renders to SVG (with a canvas fallback for raster and density marks). The library is lightweight, has no mandatory peer dependencies beyond D3 subpackages, and targets browser-first rendering.

**Source layout:**

```
src/
  plot.js            — top-level plot() assembly function
  mark.js            — Mark base class + channel/transform pipeline
  channel.js         — channel resolution (field names, accessors, Arrow tables)
  scales.js          — scale creation, domain inference, color scales
  axes.js            — axis marks (built as composite marks internally)
  style.js           — direct/indirect SVG style application
  dimensions.js      — margin/layout geometry
  facet.js           — small-multiples partitioning
  context.js         — rendering context (document, clip)
  memoize.js         — single-argument memoize for render caching
  marks/             — 30 mark types (line, cell, raster, crosshair, tip, ...)
  transforms/        — bin, group, hexbin, window, normalize, dodge, stack, ...
  interactions/      — pointer.js (crosshair + tip backbone)
  scales/            — scale implementations
  legends/           — legend rendering
```

Language split: ~82% HTML (docs), ~12% JS, ~6% TypeScript (types only — the library is JS with `.d.ts` files for type contracts). No WebGL. No React dependency.

**Core mental model:** `plot({ marks: [...], scales: {...} })` returns an SVG `<figure>`. Marks share scales automatically. Transforms pre-process data in abstract space; initializers run in screen space after scales are resolved. The render pipeline is:

1. Flatten and normalize marks
2. Collect all mark channels into `channelsByScale`
3. `createScales()` — infer domains from all channels simultaneously
4. `createDimensions()` + `autoScaleRange()`
5. `createScaleFunctions()` — produce callable scale objects
6. Per mark: `initialize()` → `applyScaleTransforms()` → `render()` → append SVG node

---

## 2. Features Worth Borrowing

### 2.1 Channel resolution with Apache Arrow support — ADAPT

`src/options.js` implements `valueof()`, the universal accessor dispatcher. It distinguishes three input forms without user annotation: a string field name (becomes `data[i].field`), a function (applied element-wise via `maybeTypedMap`), and an object with a `.transform` method (lazy column — evaluated on demand). For Apache Arrow tables specifically, it calls `column.getChild(name)` and handles Arrow date encoding (millisecond timestamps with typeId 8 or 10) via `maybeTypedArrowify()`.

The `column()` / setter pattern is notable: it returns both a transform object (for reading) and a setter function (for writing), enabling deferred population of column values when one transform's output feeds another's input without materialising intermediate arrays.

**TensorScope relevance:** TensorScope already uses Apache Arrow IPC and has `frontend/src/api/arrow.ts` for extraction. Plot's pattern of a single `valueof(data, spec)` entry point — where `spec` is a string, function, or lazy column — is cleaner than handling these three cases at each call site. The lazy column pattern is directly applicable when client-side derived channels (e.g., z-scored amplitude) feed into display logic without a server round-trip.

### 2.2 Transform / Initializer split — ADAPT

`src/transforms/basic.js` formalises two levels of data processing:

- **Transforms** (`composeTransform`) work in abstract data space. They receive raw `(data, facets)` and return `{data, facets}`. They run before any scale is resolved. Composable via `composeTransform(t1, t2)`.
- **Initializers** (`composeInitializer`) work in screen space. They receive already-scaled channel arrays and can reposition marks based on pixel geometry (dodge, hexbin) or resample based on plot width. They run after `createScales()` but before `render()`.

This two-level separation cleanly answers: "does this operation need to know the pixel width of the plot?" If yes, it is an initializer. If no, it is a transform.

**TensorScope relevance:** TensorScope's downsampling currently happens server-side before scales exist — the server does not know the client's canvas pixel width. An adaptive client-side decimation step (downsample to N samples where N = canvas width in pixels) fits exactly into the initializer slot: it runs after the time scale is resolved and knows the pixel width. This distinction also clarifies where client-side rolling-mean smoothing belongs: it is a transform (no scale knowledge needed), not a server concern.

### 2.3 Raster mark: canvas pixel buffer inside SVG — DIRECT REFERENCE

`src/marks/raster.js` renders arbitrary grids by:

1. Creating an off-screen `<canvas>` sized to `(w, h)` pixels.
2. Filling an `ImageData` buffer per pixel, applying the color scale inline: `rgb(colorScale(F[i]))`.
3. Embedding the canvas as an SVG `<image>` element with a `transform` for positioning.
4. Supporting four interpolation modes: `none` (last-value wins per pixel), `nearest` (Delaunay Voronoi), `barycentric` (triangle interpolation), `random-walk` (walk-on-spheres).

For pre-gridded row-major data, `denseX()` / `denseY()` generate implicit coordinate arrays without materialising them, saving memory proportional to grid size. The `pixelSize` option controls spatial resolution vs. rendering cost. `imageRendering: "pixelated"` suppresses browser bilinear blurring for sharp-edged heatmaps.

**TensorScope relevance:** TensorScope's spectrogram view already uses a Canvas 2D heatmap with an inferno-like colormap. The Raster pattern — implicit `denseX`/`denseY` coordinates for row-major grids, `imageRendering: "pixelated"` to avoid browser interpolation blurring shared pixel edges, and the `blur` option for smoothing sparse data — directly applies. The canvas-inside-SVG embedding pattern is also worth examining for the spatial electrode map when it needs to coexist with SVG axis and label layers.

### 2.4 Crosshair as mark composition, not a special overlay — ADAPT

`src/marks/crosshair.js` implements crosshairs as a **composition of four existing marks**: two `rule` lines and two `text` labels, all driven by the same `pointer()` initializer. The crosshair holds no rendering logic of its own; it delegates entirely. The three variants (`crosshair`, `crosshairX`, `crosshairY`) differ only in the `(kx, ky)` weighting applied to the pointer distance metric: `pointerX` uses `(1, 0.01)` (prioritise horizontal proximity), `pointerY` uses `(0.01, 1)`, and `pointer` uses `(1, 1)`.

**TensorScope relevance:** TensorScope's timeseries cursor is drawn via a uPlot canvas hook, which is correct for that view. For SVG-rendered views (spatial map, PSD), a crosshair implemented as composed marks — rather than a separate overlay component — would share the scale system automatically with no coordinate re-derivation. The `kx/ky` axis-weighting idea is directly applicable: for PSD curves, `pointerX` behaviour (snap to nearest frequency bin along x, ignore y distance) is correct; for the spectrogram, full 2D proximity is appropriate.

### 2.5 Tip mark with deferred layout via `getBBox` — NOTE

`src/marks/tip.js` defers tooltip sizing to a `postrender()` callback, calling `getBBox()` on text elements after DOM insertion to obtain exact pixel dimensions before computing the tooltip box path. The auto-anchor system tests all four cardinal directions for fit (using plot margins as clip bounds) before falling back to diagonal anchors. The `format` option controls which channels appear in the tooltip and how each is formatted — `format: { channel: false }` suppresses a channel; passing a function formats its value.

**TensorScope relevance:** TensorScope's event table uses a React panel for inspection. If hover tooltips are added to SVG/canvas views (spectrogram pixel hover showing `(time, freq, power)`, electrode hover on the spatial map), the deferred-layout pattern (`getBBox` after DOM insertion) is more robust than a font-size heuristic. The `format` option maps directly to TensorScope's need to show channel-specific units (Hz, μV, z-score).

### 2.6 `pointer()` WeakMap state + `rAF` batching — ADAPT

`src/interactions/pointer.js` uses a `WeakMap<SVGElement, PointerState>` to store per-plot state (sticky mode, currently rendered nodes, active facet). Sticky mode is toggled by `pointerdown` — the crosshair freezes until clicked again — without any React state. `requestAnimationFrame` batches faceted pointer updates: multiple `pointermove` events across facets are collected within a single frame, and only the facet with the smallest squashed distance wins.

**TensorScope relevance:** TensorScope uses Zustand for crosshair position today. For canvas-drawn cursors in uPlot this is appropriate. For any SVG-rendered interaction overlay added to spectrogram or PSD views, the WeakMap-on-the-DOM-node pattern avoids React re-render cycles for purely visual feedback (cursor position does not need to round-trip through the React reconciler). The `rAF` batching pattern is worth adopting for any multi-panel linked cursor that must pick a winner across panels within a single frame.

### 2.7 Scale `apply` / `invert` contract on exposed scale objects — DIRECT

`src/scales.js` `exposeScale()` returns a plain object with `apply(value)`, optional `invert(value)`, and metadata (`domain`, `range`, `bandwidth`, `step`). This is the public API contract for scales — marks never call the D3 scale closure directly; they go through the wrapper. `Plot.scale(options)` creates standalone reusable scales independently of any plot.

**TensorScope relevance:** TensorScope translates between data space and pixel space only in the server (`apply_slice_request` in `src/tensorscope/server/state.py`) and inside uPlot's internal scale. There is no explicit, testable scale object on the client that maps `time → pixel_x`, `freq → pixel_y`, `AP → grid_col`. Adding `{ apply, invert, domain, range }` scale objects as part of the Arrow payload decoding step in `frontend/src/api/arrow.ts` would: (a) allow click-to-select on the spectrogram canvas to convert pixel coordinates back to `(time, freq)` without ad-hoc arithmetic, (b) make coordinate mapping unit-testable, and (c) provide a clean interface for any future client-side zoom that needs to compose scale transforms.

### 2.8 Window transform (sliding-window reducers) — ADAPT

`src/transforms/window.js` implements a sliding-window transform with reducers: `mean`, `median`, `deviation`, `sum`, `difference`, `ratio`, `min`, `max`, `mode`, and percentiles. It handles edge modes (`strict`: output `NaN` when the window is incomplete; non-strict: allow partial windows at boundaries). The transform composes with any mark via `mapX` / `mapY`.

**TensorScope relevance:** TensorScope's backend sends raw samples. A client-side rolling-mean or rolling-RMS for visually smoothing noisy neural signals — applied as a transform before the uPlot series array is constructed — maps exactly to this pattern. The `difference` reducer (last − first within window) produces derivative traces without a backend round-trip. Implementing this as a composable transform keeps the raw data intact for export while changing only the visual representation.

### 2.9 Facet `exclude` and `super` options for context overlays — ADAPT

`src/facet.js` supports `facet: "exclude"` on individual marks, which draws the mark's data from *outside* the current facet — used for "context" overlays: show all data as a grey background in every facet, with the current facet's data highlighted. The `facet: "super"` option draws a mark across all facets in a single frame (no position scales involved), used for global annotations.

**TensorScope relevance:** TensorScope's navigator strip is a global context view. The `facet: "super"` / `facet: "exclude"` distinction maps to TensorScope's concept of a "global" event overlay drawn over all time windows vs. a "local" event marker shown only in the current time window. If TensorScope adds small-multiples (e.g., comparing multiple recording sessions side by side), this facet option pattern clarifies how reference marks and global event overlays should behave relative to each small-multiple panel.

### 2.10 `defined(x)` — NaN gap encoding for missing epochs — DIRECT

`src/defined.js`: `defined(x) = x != null && !Number.isNaN(x)`. All marks use this as the default channel filter. Gaps in lines (discontinuities from recording gaps or artefact rejection) are produced by returning `defined = false` for a sample rather than by splitting data arrays and re-indexing. The `positive`, `negative`, and `finite` helper variants map invalid values to `NaN` rather than dropping them, preserving index alignment with other channels.

**TensorScope relevance:** TensorScope renders neural traces that frequently have missing epochs. Encoding gaps as `NaN` in the sample buffer — rather than removing them and shifting indices — keeps the time axis stable and avoids recomputing the sample-to-pixel mapping after gaps. This is the canonical approach; Plot demonstrates it rigorously.

### 2.11 Implicit scale domain inference from all marks simultaneously — DIRECT

`src/plot.js` collects channels from all marks into a `channelsByScale` map before calling `createScales()`. The domain of the `x` scale is the union of all marks' `x` channel extents. No individual mark needs to know about other marks. Axes, reference lines, and data marks all contribute to the shared domain automatically.

**TensorScope relevance:** When a timeseries view and its event overlay share a time axis, the time domain should encompass both. Currently the selection store in TensorScope manages this. Plot shows that scale inference can be separated from mark rendering: collecting channel extents is a distinct pass, not a concern of each mark's render function.

---

## 3. Interaction / UX Ideas Worth Studying

### 3.1 Sticky pointer for measurement

The `pointerdown` toggle (crosshair freezes until clicked again) is the correct interaction model for "I want to measure this peak frequency" in a PSD view, or "I want to inspect this spike amplitude" in a timeseries. It is distinct from hover-only tooltips (transient, no user intent) and from a persistent range selection (requires drag). TensorScope has no equivalent for point-specific measurements. This is a low-cost, high-value interaction to add to the PSD and spectrogram views.

### 3.2 Axis-weighted pointer proximity (`kx/ky`)

The explicit `(kx, ky)` weighting of the 2D distance metric — `(1, 0.01)` for `pointerX`, `(0.01, 1)` for `pointerY`, `(1, 1)` for `pointer` — is an acknowledgment that proximity semantics are data-type-specific. For a multichannel PSD plot with many overlapping curves, `pointerX` (snap to nearest frequency, ignore amplitude distance) is the correct default; for a 2D spatial electrode map, equal `(1, 1)` weighting is correct. TensorScope should codify this distinction when adding pointer interactions to its non-timeseries views.

### 3.3 Tip `format` option for channel-specific labelling

The `format` option controlling which channels appear in a tooltip and how each is formatted — with per-channel format functions and explicit suppression via `false` — is cleaner than building tooltip content inside a render function. For TensorScope, this pattern would allow a single tooltip component parameterised by the view type to show `(time: 1.234 s, freq: 42 Hz, power: −15 dB)` for spectrogram or `(AP: 3.2 mm, ML: −1.1 mm, RMS: 87 μV)` for the spatial map, without branching inside the tooltip renderer.

### 3.4 Brush / region selection is absent — confirms uPlot is correct

Observable Plot explicitly documents brush selection as "under development." There is no brush mark in v0.6.17 and no zoom/pan primitive. This confirms that TensorScope is correct to handle time-range selection via uPlot's `select` hook and `setScale` API in the navigator view. Plot is not a candidate for replacing that interaction.

---

## 4. Engineering Patterns Worth Borrowing

### 4.1 Marks as the unit of composition for axes, grids, and overlays

Every visual element in Plot — including axes, reference grids, crosshairs, and tips — is a `Mark`. Axes are not a special layout concern; they are marks that consume scale metadata as their data source. Render order is explicit (array position in `marks: [...]`). There is no separate "decoration layer" to manage.

**For TensorScope:** TensorScope's event markers are currently implemented as a canvas hook (`useOverviewDetail`) drawing on the uPlot canvas after the signal traces render. For non-uPlot views (spectrogram, spatial map), event markers should be a mark layer alongside the data marks, sharing the time scale automatically. This eliminates the coordinate re-derivation that currently occurs in the canvas hook.

### 4.2 Composable render pipeline via `composeRender`

`src/mark.js` `composeRender(r1, r2)` chains render functions so each can call `next(index, scales, values, dimensions, context)` to proceed. This is the same pattern as Express middleware. The pointer interaction wraps downstream mark render functions this way — without subclassing. The `RenderFunction` TypeScript type in `src/mark.d.ts` formalises this contract: `(index, scales, values, dimensions, context, next?) => SVGElement | null`.

**For TensorScope:** TensorScope's `viewRegistry.ts` dispatches to named React components. If custom canvas marks are added (e.g., a waveform density plot), a typed `RenderFunction` contract for canvas marks — `(data: SliceDTO, scales: ScaleContext, canvas: HTMLCanvasElement) => void` — would enable the same composable wrapping: a "loading overlay" render function wraps any canvas mark's render function during React Query fetch states.

### 4.3 Hexbin as a screen-space initializer

`src/transforms/hexbin.js` operates on `(X_pixels, Y_pixels)` after scale projection, not on data values. It partitions points into hexagonal bins in pixel space, computes centroids, and inverts centroids back to data space for axis labels. The `outputs` option specifies reducers per output channel (`count`, `mean`, `first`, custom).

**For TensorScope:** A spatial electrode map with many electrodes displayed in a small panel should adaptively aggregate. Hexbin demonstrates the initializer pattern for this: the number of bins scales with the available pixels, not with the data extent. The `outputs` reducer system maps directly to "show mean LFP power per spatial bin" or "show peak event rate per spatial bin."

### 4.4 TypeScript type contracts without TypeScript implementation

Plot ships `.d.ts` files alongside `.js` source. The type surface covers: `RenderFunction`, `MarkOptions` (50+ properties), `ScaleOptions` (with `ColorScheme`, `Interpolate`, `ScaleType` unions), `ChannelValueSpec` (constant | field name | accessor | channel object), `Data` (Iterable | ArrayLike | Arrow Table). This is a pragmatic choice — the library is readable JS without losing type safety for TypeScript consumers.

The `ChannelValueSpec` union type is particularly clean: it allows `fill: "red"` (constant), `fill: "channel_name"` (field), and `fill: (d) => d.value` (accessor) to all type-check without overloads.

**For TensorScope:** TensorScope's `frontend/src/types/index.ts` already maintains canonical domain types. Adopting a `ChannelSpec` union type analogous to `ChannelValueSpec` for any view that accepts configurable data mappings (e.g., "which dimension to colour the spatial map by") would make the view API more composable and its misuse detectable at compile time.

### 4.5 `memoize1` for expensive per-render computations

`src/memoize.js` provides a single-key memoize using `Object.is` identity check. It caches Delaunay triangulations (used for nearest-neighbour raster interpolation) across render calls when data has not changed. Without this, rebuilding a triangulation on every pointer event would make nearest-neighbour raster interaction unusably slow.

**For TensorScope:** The spectrogram canvas is rebuilt on every `timeWindow` change. If the colormap LUT or the frequency-axis pixel mapping is expensive to recompute, memoising those computations keyed on `[colorMin, colorMax, numFreqBins, canvasHeight]` follows this pattern directly. The `Object.is` check is important: it distinguishes a new array reference (recompute) from the same reference (cache hit), which matters when React Query returns a cached Arrow table reference unchanged.

### 4.6 Axes as composite marks with multi-fallback tick generation

`src/marks/axis.js` implements axes as composite marks (tick rules + label text). Tick generation falls back through: explicit `ticks` array → interval-based ticks → `scale.ticks(count)` → `scale.domain()`. For time scales, D3's UTC interval hierarchy (`utcSecond`, `utcMinute`, `utcHour`, etc.) is tried in descending order until a count near the target is found.

**For TensorScope:** TensorScope's uPlot axes use uPlot's built-in tick generation. For the spectrogram frequency axis (log scale) and the PSD view axes, understanding Plot's multi-fallback tick generation is useful when implementing custom SVG axis components that need to handle both linear and log scales with appropriate interval selection.

---

## 5. Not a Good Fit for TensorScope

### 5.1 SVG rendering for dense timeseries

Plot renders all non-raster marks to SVG. For 10,000+ samples across 32+ channels (typical for 1 second of electrophysiology at 30 kHz), SVG path elements become the dominant bottleneck — one `<path>` per series, one point per sample. uPlot renders to a single canvas with a single path stroke per series and is 10–100x faster for this use case. TensorScope is correct to use uPlot for the timeseries view and should not replace it with Plot.

### 5.2 No brush / zoom / pan

As confirmed by the Plot docs, brush selection is not implemented in v0.6.17. There is no pan or zoom primitive. TensorScope's time-range selection via uPlot's `select` hook and `setScale` API in the navigator is the right approach and cannot be replaced by Plot.

### 5.3 Tabular / tidy data assumption

Plot's entire channel system assumes tidy data: an iterable of row objects where each row is one observation. TensorScope's canonical format is a dense `xr.DataArray` with named dimensions (`time`, `AP`, `ML`, `freq`). The mapping from a 3D array slice to a flat row array requires explicit reshaping — already handled server-side via Arrow IPC. Plot does not help with multi-dimensional tensor data; it operates downstream of the reshape step.

### 5.4 No WebGL / no GPU path

Plot uses Canvas 2D for raster marks and SVG for everything else. There is no WebGL path. For TensorScope's spatial electrode map at high density, or for spectrogram with very fine frequency resolution (512+ frequency bins × 10,000+ time bins), a WebGL-based renderer would be necessary. Plot does not provide this and cannot be extended to provide it without replacing the render backend.

### 5.5 Grammar-of-graphics API verbosity for domain-specific views

Plot's API is optimised for general exploratory visualisation. Expressing "multichannel neural trace with event markers and a navigator overview" requires composing ~6 marks with explicit channel bindings per view instantiation. TensorScope's domain-specific React components (`TimeseriesSliceView`, `SpectrogramView`) encapsulate this complexity behind typed props interfaces. Plot patterns are more useful as internal implementation idioms than as user-facing APIs in TensorScope.

### 5.6 No data streaming or progressive loading

`plot(options)` returns a DOM node synchronously from data already in memory. There is no concept of streaming updates, partial renders, or tile-based loading. TensorScope's React Query + Arrow IPC pipeline already handles progressive loading correctly; Plot has nothing to add here.

---

## 6. Top Recommendations for TensorScope

These are new recommendations not covered by the HiGlass or Neuroglancer studies.

### R1: Formalise the transform / initializer split in the frontend data pipeline

TensorScope's data pipeline currently conflates three distinct operations:

1. Server-side downsampling — depends on time window, but not on canvas pixel width
2. Client-side reshape — Arrow IPC → typed arrays
3. View-local derivations — rolling mean, z-score normalisation for display

Operations 1 and 3 map to Plot's transform/initializer distinction. Codify this in TensorScope as: **transforms** produce new channel arrays from raw Arrow data (no pixel geometry knowledge), **initializers** adjust values once the canvas dimensions are known.

Concrete payoff: when the spectrogram canvas is resized, the client can re-bin the cached Arrow data to the new pixel dimensions without a new server request, using an initializer that knows `canvasWidth`. Currently, the server sets downsampling parameters without knowing the client canvas width, which leads to either over-fetching (server sends more samples than the canvas can display) or under-fetching (server sends fewer samples than a wide monitor can use).

### R2: Add `apply` / `invert` scale objects to the client-side Arrow decoding step

TensorScope has no explicit, testable scale objects on the client that map `time → pixel_x`, `freq → pixel_y`, `AP → grid_col`. All coordinate translation happens implicitly inside uPlot or via ad-hoc arithmetic in canvas hooks.

Following Plot's `exposeScale()` pattern, add `{ apply, invert, domain, range }` scale objects as output of the Arrow payload decoding step in `frontend/src/api/arrow.ts`. This enables:

- Click-to-select on the spectrogram canvas converting `(pixelX, pixelY)` to `(time, freq)` via `timeScale.invert(px)` without inline arithmetic
- Unit-testable coordinate mapping in Vitest without rendering a canvas
- A clean interface for any future client-side zoom that needs to compose scale transforms (e.g., `scale.invert(zoomedScale.apply(value))`)

### R3: Model the cursor and event overlay as scale-aware layers, not canvas hooks

TensorScope's event markers and crosshair cursor are React hooks that draw on the uPlot canvas by computing pixel positions from time window bounds. This is fragile when axes are rescaled or when plot margins change. For the spectrogram and PSD views (which are not uPlot-based), there are no shared scale objects to hook into at all.

Plot demonstrates that composing a crosshair from two rule marks driven by a pointer initializer keeps all coordinate math in the scale layer and makes the cursor automatically correct across zoom levels.

For TensorScope specifically: implement the spectrogram cursor as an SVG overlay element positioned via `timeScale.apply(cursorTime)` and `freqScale.apply(cursorFreq)` scale objects (from R2), rather than computing pixel positions manually from `(timeWindow.start, timeWindow.end, canvasWidth)` each time the cursor moves. The result is a cursor that is always correctly positioned even when the canvas resizes or the scale domain changes mid-session.

---

## 7. Evidence

| Topic | File(s) | What it demonstrates |
|---|---|---|
| Channel resolution (string / function / Arrow) | `src/options.js` | `valueof()` unified accessor; `isArrowTable()` + `getChild()` for Arrow columns; lazy `column()` setter pattern for deferred channel population |
| Transform vs. initializer split | `src/transforms/basic.js` | `composeTransform` (abstract data space, before scales) vs. `composeInitializer` (screen space, after scales); clean separation of "needs pixel width" |
| Raster mark: canvas pixel buffer inside SVG | `src/marks/raster.js` | Off-screen `<canvas>`, `ImageData` fill loop, `rgb(colorScale(F[i]))` per pixel, `denseX`/`denseY` implicit coordinates, 4 interpolation modes |
| Raster mark API and options | `https://observablehq.com/plot/marks/raster` | `imageRendering: "pixelated"`, `blur`, `pixelSize`, function-evaluated grids, color channel encoding |
| Crosshair as mark composition | `src/marks/crosshair.js` | 4 marks (2 rules + 2 text) composed via single pointer initializer; `kx/ky` axis weighting for 1D vs 2D proximity |
| Pointer WeakMap state + sticky mode + rAF batching | `src/interactions/pointer.js` | `WeakMap<SVGElement, state>`, `rAF` batching for faceted plots, sticky toggle on `pointerdown`, `maxRadius` cutoff |
| Tip deferred layout via `getBBox` | `src/marks/tip.js` | `postrender()` calls `getBBox()` after DOM insertion; 9-anchor auto-placement testing cardinal fit; `format` option for per-channel display control |
| Facet `exclude` / `super` options | `src/facet.js`, `https://observablehq.com/plot/features/facets` | `facet: "exclude"` for context overlay (background data); `facet: "super"` for global annotation marks spanning all panels |
| Window transform (rolling statistics) | `src/transforms/window.js` | `mean`, `median`, `deviation`, `difference`, `ratio`; strict/non-strict edge modes; composable via `mapX`/`mapY` |
| Hexbin as screen-space initializer | `src/transforms/hexbin.js` | Operates on pixel `(X, Y)` post-projection; inverts centroids to data space for labels; `outputs` reducer system |
| Scale `apply` / `invert` contract | `src/scales.js` (`exposeScale`) | Materialised scale object with `apply`/`invert`, `domain`, `range`, `bandwidth`, `step`; `Plot.scale()` for standalone scales |
| Implicit scale domain from all marks | `src/plot.js` | `channelsByScale` aggregation across all marks before `createScales()`; domain is union of all channel extents |
| Mark render pipeline composition | `src/mark.js` (`composeRender`) | Middleware-style render chaining; pointer wraps downstream render without subclassing; `next?` optional for terminal marks |
| TypeScript contract surface | `src/mark.d.ts`, `src/scales.d.ts` | `RenderFunction(index, scales, values, dimensions, context, next?)` typed contract; `ChannelValueSpec` union type; `ScaleType` union |
| `ChannelValueSpec` union type | `src/mark.d.ts` | Constant \| field name string \| accessor function — all type-check without overloads |
| `defined` / NaN gap encoding | `src/defined.js` | `defined(x) = x != null && !isNaN(x)`; gaps as NaN preserve index alignment across channels |
| Color scale types and schemes | `src/scales.d.ts` | `sequential`, `diverging`, `cyclical`, `quantile`, `threshold` types; `interpolate` as named string or custom function; `ColorScheme` union |
| Axes as composite marks with multi-fallback tick generation | `src/marks/axis.js` | Tick fallback chain: explicit array → interval → `scale.ticks(count)` → `scale.domain()`; UTC interval hierarchy for time axes |
| Auto mark type inference | `src/marks/auto.js` | Monotonicity + ordinality heuristics for line vs. dot vs. bar; transparent, overridable |
| Contour mark pipeline | `src/marks/contour.js` | Grid → d3-contour → SVG `geoPath`; `blur2()` smoothing; threshold inference via `maybeTicks()`; facet slicing |
| Normalize transform modes | `src/transforms/normalize.js` | 9 modes: `deviation` (z-score), `extent` (0–1), `first`, `last`, `mean`, `median`, `sum`, `min`, `max`; custom function basis |
| `memoize1` for render caching | `src/memoize.js` | Single-key `Object.is` memoize; caches Delaunay triangulations across pointer events; dual strategy for 1 vs. N args |
| SVG rendering ceiling vs. uPlot | `src/marks/line.js` | One `<path>` per z-group; no canvas fallback for line marks — confirms Plot cannot replace uPlot at 30 kHz trace density |
| No brush / zoom | Observable Plot docs | Brush selection documented as "under development" in v0.6.17; no pan/zoom primitive — confirms uPlot navigator is the correct tool |
| Sticky pointer UX | `src/interactions/pointer.js` | `pointerdown` freezes crosshair until next click — measurement interaction not present in TensorScope today |
