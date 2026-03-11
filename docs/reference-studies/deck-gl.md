# deck.gl — Reference Study

**Repo:** https://github.com/visgl/deck.gl
**Version studied:** v9.2.11 (released 2026-03-05)
**Date:** 2026-03-11
**Focus:** layer compositing, spatial electrode map rendering, Arrow/binary data, picking, animation — filtered for TensorScope relevance

> **Scope note:** This is a **library study**, not a full-application study. deck.gl is a composable WebGL/WebGPU layer rendering library, not a standalone application. Claims are grounded in specific files and documentation pages retrieved from the official docs and GitHub source tree.

---

## 1. Repo Overview

deck.gl is a WebGL2/WebGPU visualization framework built by the vis.gl initiative (now part of the OpenJS Foundation). It maps data arrays to GPU-rendered visual layers placed inside one or more `View` projections.

**Source layout (under `modules/`):**
- `modules/core/src/` — `Deck`, `Layer`, `View`, `AttributeManager`, picking engine, transition system
- `modules/layers/src/` — primitive layers: `scatterplot-layer`, `arc-layer`, `bitmap-layer`, `column-layer`, `icon-layer`, `line-layer`, `path-layer`, `text-layer`, etc.
- `modules/aggregation-layers/src/` — `heatmap-layer`, `grid-layer`, `hexagon-layer`, `contour-layer`
- `modules/extensions/src/` — `data-filter/`, `collision-filter/`, `fill-style-extension/`
- `modules/react/src/` — `@deck.gl/react`: `DeckGL` component, JSX layer API
- `modules/core/src/views/` — `OrthographicView`, `MapView`, `FirstPersonView`, `OrbitView`

**Core mental model:** Data → Layer (GPU buffers + shaders) → View (projection matrix) → Deck (render loop). Layers are declarative value objects; the engine diffs props across frames and uploads only changed attribute buffers. Picking is done via an offscreen color-encoded pass rather than ray/triangle intersection.

**Why it is a relevant reference for TensorScope:**
TensorScope's spatial electrode map view — an (AP, ML) scatter of electrode sites that must support click-to-select, hover, brush filtering, and density overlays — is exactly the kind of 2D non-geographic scatter problem that deck.gl's `OrthographicView` + `ScatterplotLayer` + `DataFilterExtension` stack was designed to solve.

The existing HiGlass and Neuroglancer studies cover tiled fetching, view sync, reactive state atoms, keyboard actions, and typed events. Those patterns are not repeated here. This study focuses exclusively on what deck.gl adds: WebGL layer compositing, GPU-side filtering, pick-buffer hit testing, attribute transitions, and the viability question for the spatial map view.

---

## 2. Features Worth Borrowing

### 2.1 OrthographicView for the Electrode Spatial Map — ADOPT

`modules/core/src/views/orthographic-view.ts` provides a pixel-aligned top-down 2D view that is purpose-built for non-geographic data. Key properties:

- `flipY: true` — top-left origin matching CSS/Canvas 2D conventions
- `zoom: 0` — 1 unit = 1 pixel; each increment doubles size (supports `[zoomX, zoomY]` for non-square grids)
- `controller: true` — activates `OrthographicController` (pan + zoom, no map projection math)
- `target: [cx, cy, 0]` — centers the viewport on a world coordinate

For TensorScope, replace the current CSS-grid heatmap in the spatial map view with a `ScatterplotLayer` (or `ColumnLayer`) inside an `OrthographicView`. Each electrode becomes a circle or disc; position comes from the electrode geometry store. This trivially handles non-uniform probe geometries (Neuropixels, Utah arrays) that CSS `grid-template` cannot express.

### 2.2 ScatterplotLayer for Electrode Glyphs — ADOPT

`modules/layers/src/scatterplot-layer/` renders filled/stroked circles entirely on the GPU. Relevant props for electrode rendering:

- `radiusUnits: 'pixels'` — size stays constant regardless of zoom (appropriate for electrode markers)
- `getFillColor` — accepts an accessor `(electrode, {index}) => [r, g, b, a]`; map amplitude/power to a colormap array computed on the JS side
- `getLineColor` / `stroked: true` — highlight selected electrodes with an outline
- `pickable: true` — single-object hit-test at pointer coordinates
- `updateTriggers: { getFillColor: [timeCursor] }` — tells the engine to re-evaluate the color accessor when `timeCursor` changes without rebuilding the data array

At 64–256 electrodes the GPU overhead is negligible; the main benefit is clean zoom/pan and accurate picking without manual Canvas 2D hit detection.

### 2.3 DataFilterExtension for Linked Brushing — ADAPT

`modules/extensions/src/data-filter/data-filter-extension.ts` injects a GLSL snippet into any layer's fragment shader. Each object has a filter value (1–4 floats); objects whose values fall outside `filterRange` are discarded on the GPU without a JS data copy.

Relevant API surface:
```ts
new ScatterplotLayer({
  extensions: [new DataFilterExtension({ filterSize: 1 })],
  getFilterValue: (electrode) => electrode.meanPower,   // float32
  filterRange: selectionStore.freq,                     // [fMin, fMax]
  filterSoftRange: [fMin - 2, fMax + 2],                // fade edges
  updateTriggers: { getFilterValue: [currentBand] }
})
```

For TensorScope M3 spatial brushing: encode electrode spatial coordinates as a 2-element filter value (`filterSize: 2`), then update `filterRange` from a brush rectangle in the `OrthographicView`. The Zustand `spatial` slice of `SelectionState` maps directly onto `filterRange`.

Key capabilities:
- `filterSize: 1..4` — filter on up to 4 independent dimensions simultaneously (e.g., time + amplitude + frequency band + region)
- `filterSoftRange` — objects outside the soft boundary fade in opacity/size rather than snapping off; relevant for smooth time-cursor scrubbing
- `filterEnabled` — toggle the filter without reconfiguring the extension
- `countItems: true` + `onFilteredItemsChange` callback — get live counts of visible items without a CPU pass
- `fp64: true` — 64-bit precision for large numeric filter keys (e.g., Unix timestamps in microseconds)

**Linked brushing at the application level:** The extension does not provide cross-layer synchronization itself. Application code (a shared Zustand store slice) must hold the `filterRange` value and pass identical values to all layers that should respond to the brush. Since `filterRange` is a plain prop (not a GPU buffer), updating it costs only a uniform upload — well under 1ms per frame.

**Source files:**
- `modules/extensions/src/data-filter/data-filter-extension.ts` — extension class, props injection
- `modules/extensions/src/data-filter/shader-module.ts` — GLSL filter logic

### 2.4 Layer Attribute Transitions for Propagation Animations — ADOPT

The `transitions` prop on any layer triggers GPU-side linear interpolation between old and new attribute buffers. No custom `requestAnimationFrame` loop is needed:

```ts
new ScatterplotLayer({
  transitions: {
    getFillColor: { duration: 400, easing: t => t * (2 - t) },  // ease-out
    getRadius:    { duration: 300, type: 'spring', stiffness: 0.05, damping: 0.7 }
  }
})
```

The animation runs entirely in `AttributeTransitionManager` (`modules/core/src/lib/attribute/`) using a WebGL transform-feedback pass — no CPU work per frame. For TensorScope's M3 propagation animations (color waves over electrodes representing activity spread), set `timeCursor` in the Zustand store and let deck.gl interpolate `getFillColor` between successive voltage snapshots.

Two transition modes:
- `{duration: number, easing?: fn}` — linear interpolation with optional easing
- `{type: 'spring', stiffness, damping}` — physics spring, appropriate for positional snapping

The `enter` callback defines the starting value for newly added data objects (e.g., fade in new electrodes from `[0,0,0,0]` alpha).

### 2.5 DeckGL React Component and Controlled viewState — ADOPT

`@deck.gl/react` exposes a `DeckGL` component whose `viewState` / `onViewStateChange` props fit naturally into Zustand:

```tsx
// In the spatial map view component:
const spatial = useSelectionStore(s => s.spatial);
const setSpatial = useSelectionStore(s => s.setSpatial);

<DeckGL
  views={new OrthographicView({ id: 'spatial', controller: true })}
  viewState={{ target: [spatial.cx, spatial.cy, 0], zoom: spatial.zoom }}
  onViewStateChange={({ viewState }) => setSpatial(viewState)}
  layers={[electrodeLayer]}
/>
```

Layers can be passed as ES6 instances in the `layers` array or as JSX children — both are equivalent in performance. The component is documented as "a thin wrapper"; reconciliation cost is the same as any memoized React component. `onViewStateChange` fires every animation frame during interaction; follow React best practices and use `useMemo` for layer creation.

### 2.6 Color-Encoded Picking / Hit-Testing — ADOPT (mechanism only)

deck.gl uses an offscreen render pass where each pickable object is drawn with a unique RGBA color encoding its layer index (8 bits) and object index (up to 16M objects per layer). On pointer events it reads one pixel from that offscreen buffer — O(1) regardless of object count.

The returned `PickingInfo` object contains:
- `object` — the original data element (e.g., the electrode record)
- `index` — position in the data array
- `coordinate` — world-space position under the pointer
- `layer` — the deck.gl layer that owns the object

Relevant callbacks:
- `onHover(info)` — fires on every pointermove; `info.object` is the hovered electrode or `null`
- `onClick(info)` — fires on click; return `true` to stop propagation
- `pickObjects({x, y, width, height})` — rectangular region pick; maps directly to lasso/box selection

For TensorScope: wire `onClick` → `setSelectedElectrode(info.object.id)` in `useSelectionStore`. The picking system handles non-convex probe geometries correctly, unlike bounding-box CSS hit tests. For lasso selection (M4+), use `pickObjects` on the bounding box of the lasso path.

### 2.7 Binary Attribute API — ADAPT

The `data.attributes` field accepts pre-computed typed arrays or luma.gl `Buffer` objects, bypassing the per-frame accessor iteration:

```ts
new ScatterplotLayer({
  data: {
    attributes: {
      getPosition: new Float32Array(positions),   // [x0,y0,0, x1,y1,0, ...]
      getFillColor: colorUint8Array,              // [r,g,b,a, ...]
    },
    length: N
  }
})
```

Since TensorScope already receives Apache Arrow IPC from the backend and decodes it in `frontend/src/api/arrow.ts`, electrode positions and per-frame voltages can be extracted directly from Arrow `Float32Array` views and passed into `data.attributes` without an intermediate JS object array. This is the lowest-latency path from Arrow buffer to GPU and eliminates the JS accessor loop entirely for large probe counts (10k+ channels on ECoG or NeuroPixels 2.0 4-shank).

---

## 3. Interaction / UX Ideas Worth Studying

### 3.1 Multi-Layer Composition on a Single Canvas

deck.gl stacks layers in declaration order in a single canvas. Each layer has an `id` and layers with the same `id` across renders are matched for state preservation. This means a `ScatterplotLayer` (electrode positions), a `HeatmapLayer` (activity density background), and a `TextLayer` (channel labels) can all share one WebGL context with no extra DOM elements.

TensorScope currently separates the spatial map (CSS grid), event markers (SVG overlay on uPlot), and potential density overlays (not yet implemented) into different rendering contexts. deck.gl's single-canvas compositing is architecturally cleaner for the spatial view.

### 3.2 layerFilter for View-Specific Rendering

When multiple `View` instances share a canvas, `layerFilter({layer, viewport})` is a callback that controls which layers are visible in which viewport. This is the mechanism for a minimap inset (e.g., a zoomed-out overview of the full probe geometry in one corner while the main viewport is zoomed into a shank region). The callback receives both `layer` and `viewport` instances — routing is fully programmable.

### 3.3 Tooltip Pattern via onHover + React Portal

The recommended deck.gl pattern for tooltips: `onHover(info) → setState({tooltip: info})` → render a `<div>` positioned at `info.x, info.y` as a React portal above the canvas. This keeps tooltip rendering in React (accessible, themeable, screen-reader compatible, no canvas text) while hit detection stays in WebGL. TensorScope can adopt the exact same pattern for channel hover cards showing channel name, AP/ML coordinates, and current amplitude.

### 3.4 onViewStateChange for Coordinated Navigation

`onViewStateChange` fires with both `viewState` (new camera) and `interactionState` (isDragging, isZooming, etc.). This can be used to suppress server fetches during rapid pan/zoom (only fetch when `interactionState.isZooming === false` and the viewport has been stable for 100ms), mirroring the debounce pattern used in TensorScope's existing `useOverviewDetail` hook.

---

## 4. Engineering Patterns Worth Borrowing

### 4.1 Cheap Descriptor Objects + GPU State Transfer

deck.gl's layer update model: application creates new layer instances on every React render (they are cheap descriptor objects, not GPU resources). The framework matches old and new layers by `id`, transfers GPU state (compiled shaders, vertex attribute buffers) from old to new, and discards the old instance. GPU objects are never re-created unless attributes are actually invalidated.

This is the same philosophy as React's virtual DOM diffing, applied to GPU resources. TensorScope does not need to implement this — it gets it for free by using deck.gl — but the pattern is worth internalizing: **separate the declaration of what to render (cheap JS) from the GPU resource lifecycle (managed by the framework)**.

### 4.2 Accessor Pattern vs. Uniform Pattern

deck.gl distinguishes two prop categories:
- **Uniforms** (e.g., `opacity`, `radiusScale`): one value for the entire layer, uploaded as a WebGL uniform
- **Accessors** (e.g., `getFillColor`, `getPosition`): per-object values, uploaded as vertex attribute buffers

Accessors can be: a constant value (promoted to a uniform automatically), a function `(object, objectInfo) => value`, or a pre-built typed array (zero-copy). This three-way accessor resolution is a clean API design pattern. TensorScope's own rendering components (uPlot series configs, Canvas 2D draw loops) can benefit from the same uniform-vs-per-object distinction in their data binding logic.

### 4.3 Extension Architecture (Shader Injection)

`DataFilterExtension` demonstrates deck.gl's extension system: an extension object implements `getShaders()` (returns a GLSL snippet injected into the layer's vertex shader) and `initializeState()` / `updateState()` hooks. This is how filter uniforms (`filterRange`, `filterSoftRange`) are wired to the existing layer shader without forking the layer source.

TensorScope may eventually want custom shader behavior (e.g., rendering electrodes as oriented rectangles for Neuropixels contact shapes, or adding a "ring" glow on selected channels). The extension pattern is the right mechanism — write an extension rather than forking a layer.

### 4.4 updateTriggers for Selective Attribute Invalidation

`updateTriggers: { getFillColor: [dependency1, dependency2] }` tells the `AttributeManager` to re-run the `getFillColor` accessor only when those dependency values change. Without this, deck.gl uses JavaScript reference equality on the accessor function itself — which always changes when defined inline in a render.

For TensorScope: wrap all layer accessor functions in `useMemo` hooks and declare `updateTriggers` explicitly. This eliminates spurious GPU buffer re-uploads on unrelated state changes and is the key performance knob for the electrode map view when `timeCursor` is updating at high frequency.

---

## 5. Not a Good Fit for TensorScope

### 5.1 HeatmapLayer — SKIP for electrode maps

`modules/aggregation-layers/src/heatmap-layer/` uses a 2D kernel-density texture pass. It is designed for continuous field estimation from point clouds, not discrete-electrode spatial maps. The iOS Safari fallback (8-bit integer weights, max 255 per pixel) is a correctness hazard for neural amplitudes. The 2048×2048 texture takes 50–100ms to build. Stick with `ScatterplotLayer` per electrode and encode amplitude via `getFillColor`.

### 5.2 GridLayer / HexagonLayer — SKIP

`modules/aggregation-layers/src/grid-layer/` bins data into fixed-size cells; the GPU aggregation path disables custom value functions. Neither applies to fixed-geometry electrode arrays where cell positions are known constants, not variable clusters.

### 5.3 Timeseries Rendering

deck.gl has `LineLayer` (draws line segments between pairs of points) and `PathLayer` (polylines). Neither is designed for dense multichannel timeseries. They would require repacking `Float32Array` waveforms into `[x, y]` vertex pairs every render, and lack the axis/scale/interaction model that uPlot provides. uPlot remains the correct choice for timeseries views.

### 5.4 Spectrogram / 2D Heatmap Patches

deck.gl's `BitmapLayer` can render a pre-computed RGBA texture, but does not handle the colormap-from-scalar workflow that TensorScope's spectrogram view requires (scalar float → inferno palette → RGBA). The existing Canvas 2D spectrogram implementation is adequate and does not benefit from deck.gl's layer system unless the spectrogram is being composited with other layers on the same canvas.

### 5.5 Geospatial Features

The majority of deck.gl's layer catalog is geospatial: `GeoJsonLayer`, `TileLayer`, `H3HexagonLayer`, `MVTLayer`, `TerrainLayer`, etc. None of this is relevant to TensorScope's AP/ML electrode coordinate system, which has centimeter-scale extents and no geographic projection.

### 5.6 Bundle Size

`@deck.gl/core` + `@deck.gl/layers` + `@deck.gl/react` adds approximately 500–700 kB minified (tree-shakeable). For a single view (the spatial map), install only `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/react`, and `@deck.gl/extensions` to keep the bundle lean (~180 kB gzipped for this subset). Avoid the top-level `deck.gl` meta-package which includes all geo and aggregation layers.

### 5.7 No Native Arrow IPC Awareness

deck.gl does not have a built-in Arrow IPC decoder. It accepts typed arrays and can be fed from Arrow-decoded buffers, but TensorScope must handle the Arrow → `Float32Array` extraction step itself (which `arrow.ts` already does). This is not a blocker, but deck.gl is not a substitute for the existing Arrow pipeline — it is downstream of it.

### 5.8 Anti-patterns to Avoid

**WebGL-required initialization.** deck.gl's `Deck` constructor creates a `luma.gl` `WebGLDevice` synchronously. Guard behind a dynamic `import()` or a `typeof WebGLRenderingContext !== 'undefined'` check to avoid failures in JSDOM unit tests and SSR.

**GPU-only DataFilterExtension fallback.** `DataFilterExtension` has no CPU fallback path. Keep the CSS-grid view as a fallback and activate the deck.gl path only when `canvas.getContext('webgl2')` succeeds.

**Treating `transitions` as a substitute for the timeline store.** The deck.gl `transitions` prop interpolates between two static prop snapshots; it does not model a continuous time axis. `timeCursor` must remain the single source of truth. Use `transitions` only for cosmetic smoothing, not for driving selection state.

**Mixing deck.gl canvas with uPlot / Canvas 2D overlays.** deck.gl renders into its own `<canvas>` element. Position it as a CSS sibling of the uPlot and spectrogram canvases, not a stacked overlay, to avoid z-index and pointer-event ambiguity.

---

## 6. Top Recommendations (new vs. HiGlass/Neuroglancer studies)

These recommendations cover ground not addressed in the HiGlass study (tiled fetching, view sync, rendering boundaries) or the Neuroglancer study (reactive atoms, session state, priority tiers, keyboard actions, typed events).

**R1 — Adopt OrthographicView + ScatterplotLayer for the spatial electrode map in M3.**
Replace the CSS grid `SpatialMapView` with a `DeckGL` canvas using `OrthographicView`. This generalizes to arbitrary probe geometries, handles zoom/pan natively via `OrthographicController`, and wires directly to the Zustand `spatial` slice via `viewState` / `onViewStateChange`. Implementation cost is low: the React component shell is preserved; only the rendering internals change. Install only `@deck.gl/core + layers + react + extensions` (~180 kB gzipped) to minimize bundle impact.

**R2 — Use DataFilterExtension for GPU-side linked brushing between timeseries and spatial map.**
When the timeseries brush changes, compute per-channel activity scores client-side from the already-fetched Arrow data, store in a Zustand slice, and pass as `filterRange` to the `ScatterplotLayer`. The GPU discards out-of-range electrodes at zero CPU cost per frame. This is the correct architecture for linked selection before adding a server round-trip. Use `filterSoftRange` to fade rather than snap electrodes at brush boundaries.

**R3 — Use the pick-buffer model for electrode selection, not DOM onClick.**
Replace DOM-event electrode selection with `pickable: true` + `onClick` on `ScatterplotLayer`. For future lasso/box selection (M4+), use `pickObjects({x, y, width, height})`. This handles non-rectangular probe geometries correctly and scales to thousands of electrodes without DOM pressure.

**R4 — Use updateTriggers for selective attribute invalidation.**
Declare `updateTriggers: { getFillColor: [timeCursor] }` on every `ScatterplotLayer` that maps `timeCursor` to electrode color. Without this, deck.gl re-runs the color accessor on every render regardless of what changed. This is the primary performance knob for the spatial view during time-cursor scrubbing.

**R5 — Use attribute transitions for spatial map color updates.**
Add `transitions: { getFillColor: { duration: 120 } }` to the `ScatterplotLayer`. When `timeCursor` advances and electrode colors update, the GPU interpolates between old and new color buffers using a transform-feedback pass — no JS animation loop, no RAF callback, no React re-render per frame. This eliminates visual flashing during navigation.

**R6 — Feed typed arrays directly from Arrow IPC extractors to deck.gl attribute slots.**
The `arrow.ts` extractors already produce `Float32Array` / `Uint8Array` outputs from Arrow IPC batches. Pass them as `data.attributes: { getPosition: posFloat32, getFillColor: colorUint8 }` to bypass the per-object JS accessor loop. This is zero-copy for already-allocated buffers and is the right integration point between TensorScope's existing Arrow pipeline and deck.gl's GPU upload path.

---

## 7. Evidence

| Topic | File / URL | What it demonstrates |
|---|---|---|
| Layer compositing model | deck.gl docs — [Using Layers](https://deck.gl/docs/developer-guide/using-layers) | Layer array rendering order; props vs. accessor distinction; GPU state transfer via id-matching across renders |
| OrthographicView | `modules/core/src/views/orthographic-view.ts`; deck.gl docs — [OrthographicView API](https://deck.gl/docs/api-reference/core/orthographic-view) | Top-down 2D coordinate space; zoom=0 → 1 unit = 1 pixel; flipY; OrthographicController |
| Multi-view model | deck.gl docs — [Views guide](https://deck.gl/docs/developer-guide/views) | Multiple views on one canvas; viewState per view id; layerFilter callback; minimap pattern |
| ScatterplotLayer | `modules/layers/src/scatterplot-layer/`; deck.gl docs — [ScatterplotLayer API](https://deck.gl/docs/api-reference/layers/scatterplot-layer) | getPosition/getRadius/getFillColor accessors; radiusUnits; pickable; updateTriggers; transition-enabled props |
| DataFilterExtension | `modules/extensions/src/data-filter/data-filter-extension.ts`; `shader-module.ts`; deck.gl docs — [DataFilterExtension API](https://deck.gl/docs/api-reference/extensions/data-filter-extension) | filterRange; filterSoftRange; filterTransformColor; fp64; countItems; 60fps uniform update; GLSL injection via getShaders() |
| Pick buffer / hit testing | deck.gl docs — [Interactivity guide](https://deck.gl/docs/developer-guide/interactivity); `modules/core/src/lib/picking/` | RGBA-encoded pick buffer; 16M objects per layer; onHover/onClick/pickObjects callbacks; PickingInfo object |
| React integration | `modules/react/src/deckgl.tsx`; deck.gl docs — [Using with React](https://deck.gl/docs/get-started/using-with-react) | DeckGL component as thin wrapper; React state → layer props; useMemo recommendations; controlled viewState |
| Layer lifecycle | deck.gl docs — [Layer lifecycle](https://deck.gl/docs/developer-guide/custom-layers/layer-lifecycle) | initializeState / updateState / draw; attribute invalidation; state persistence across renders |
| Attribute transitions | `modules/core/src/lib/attribute/`; deck.gl docs — Layer base class `transitions` prop | duration/spring modes; enter callback; getFillColor / getPosition GPU interpolation via transform-feedback |
| updateTriggers | deck.gl docs — Using Layers guide | Selective accessor re-evaluation; avoids spurious GPU buffer re-uploads |
| Binary attribute passthrough | deck.gl docs — performance guide | `data.attributes: {getPosition: Float32Array, getFillColor: Uint8Array}` format; zero-copy GPU upload |
| HeatmapLayer | `modules/aggregation-layers/src/heatmap-layer/`; deck.gl docs — [HeatmapLayer API](https://deck.gl/docs/api-reference/aggregation-layers/heatmap-layer) | GPU KDE aggregation; radiusPixels; colorRange; iOS Safari 8-bit fallback limitation |
| GridLayer | `modules/aggregation-layers/src/grid-layer/`; deck.gl docs — [GridLayer API](https://deck.gl/docs/api-reference/aggregation-layers/grid-layer) | cellSize; gpuAggregation; colorAggregation COUNT/MEAN; picking → cell count |
| Extension architecture | `modules/extensions/src/data-filter/data-filter-extension.ts` | getShaders() injection pattern; initializeState/updateState hooks; how to add shader behavior without forking layers |
| Module structure | `github.com/visgl/deck.gl/tree/master/modules` | 16 modules: core, layers, extensions, react, aggregation-layers, geo-layers, etc.; selective install path |
