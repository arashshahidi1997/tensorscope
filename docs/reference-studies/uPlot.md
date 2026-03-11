I'll systematically inspect the uPlot repository structure and implementation before providing my analysis.Based on thorough inspection of the `leeoniya/uPlot` repository — its source modules, demos, bench suite, and public API surface — here is the full analysis for TensorScope.

---

## 1. Repo Overview

**What this app is:** uPlot is a minimal, extremely high-performance Canvas-2D time-series chart library written in plain JavaScript. It is ~48 KB minified, framework-agnostic, and designed around the premise that all data preprocessing happens *outside* the library. The core lives in a single large file (`src/uPlot.js`, ~82K source), with clean module separation for paths, sync, DOM utilities, opts defaults, and formatting.

**Why it is a meaningful reference for TensorScope:**

uPlot directly solves several problems TensorScope must solve: rendering dense multichannel timeseries at interactive framerates, synchronizing cursors across multiple chart panels, implementing drag-to-zoom with scale-aware auto-rescale, and building a pluggable hook/event system that lets the host application extend rendering without coupling to the library internals. Its benchmark data shows it outperforms every comparable Canvas library at the operations TensorScope cares about most — mousemove throughput and memory footprint during dense data display. It is not a TensorScope architecture blueprint (it has no backend contract, no state model, no TypeScript), but it is the single most relevant rendering-layer reference available in the open-source JS ecosystem for this use case.

---

## 2. Features Worth Borrowing

### 2.1 Named Sync Bus for Cross-Chart Cursor Synchronization

```javascript name=src/sync.js url=https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/sync.js#L1-L27
export const syncs = {};

export function _sync(key, opts) {
  let s = syncs[key];
  if (!s) {
    s = {
      key,
      plots: [],
      sub(plot)  { s.plots.push(plot); },
      unsub(plot){ s.plots = s.plots.filter(c => c != plot); },
      pub(type, self, x, y, w, h, i) {
        for (let j = 0; j < s.plots.length; j++)
          s.plots[j] != self && s.plots[j].pub(type, self, x, y, w, h, i);
      },
    };
    if (key != null) syncs[key] = s;
  }
  return s;
}
```

- **Where:** `src/sync.js`, consumed in `src/uPlot.js` via `_sync(syncKey)` and `syncOpts`
- **Why valuable for TensorScope:** TensorScope requires linked time selection across all views (multichannel timeseries, spatial electrode map, event overlay). uPlot's sync bus is the minimal correct pattern: a keyed registry of subscribers, each emitting normalized `(type, x, y, w, h, i)` events. Charts join by key, receive pub/sub calls, and apply the cursor position to their own scale. It is completely decoupled from rendering.
- **Borrow: adapt directly.** In TensorScope/React, implement this as a lightweight pub/sub context (`SyncBusContext`) keyed by `TensorScopeState.activeTensor`. When time is selected in the multichannel view, the spatial map and event overlay receive the same normalized time coordinate.

---

### 2.2 Declarative Hooks System for Extensible Rendering

```javascript name=src/uPlot.js url=https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L3415-L3430
// external on/off
const hooks = self.hooks = opts.hooks || {};

function fire(evName, a1, a2) {
  if (deferHooks)
    hooksQueue.push([evName, a1, a2]);
  else {
    if (evName in hooks) {
      hooks[evName].forEach(fn => {
        fn.call(null, self, a1, a2);
      });
    }
  }
}

(opts.plugins || []).forEach(p => {
  for (let evName in p.hooks)
    hooks[evName] = (hooks[evName] || []).concat(p.hooks[evName]);
});
```

- **Where:** `src/uPlot.js` — `fire()`, `opts.hooks`, `opts.plugins`
- **Why valuable for TensorScope:** TensorScope views need to draw event overlays, electrode highlights, spike markers, and selection bands on top of the base timeseries. uPlot's hooks (`drawClear`, `drawAxes`, `draw`, `setCursor`, `setSelect`, `setSeries`, `ready`) provide exactly the right extension points: they fire during the render cycle, receive the chart instance, and can be supplied as plain arrays merged from multiple plugins. This avoids tight coupling between overlay logic and base rendering.
- **Borrow: adapt directly.** TensorScope's React chart components should expose an equivalent hook interface. The plugin merge pattern (`opts.plugins.forEach(p => merge hooks)`) is the correct pattern for composing event overlay plugins, annotation plugins, and selection plugins independently.

---

### 2.3 Drag-to-Zoom / Select-Only Cursor Modes

```javascript name=src/opts.js url=https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/opts.js#L454-L494
export const cursorOpts = {
  show: true,
  x: true,
  y: true,
  lock: false,
  move: cursorMove,
  points: { ... },
  bind: {
    mousedown:  filtBtn0,
    mouseup:    filtBtn0,
    click:      filtBtn0,
    dblclick:   filtBtn0,
    mousemove:  filtTarg,
    mouseleave: filtTarg,
    mouseenter: filtTarg,
  },
  drag: {
    setScale: true,   // drag-to-zoom
    x: true,
    y: false,
    ...
  },
};
```

- **Where:** `src/opts.js` (`cursorOpts.drag`), `demos/cursor-bind.html` (runtime toggle between zoom and select-only)
- **Why valuable for TensorScope:** TensorScope needs two distinct cursor modes in the multichannel timeseries view: (a) zoom into a time window, and (b) select a time window for event inspection without zooming. uPlot implements both and allows runtime toggle via `cursor.drag.setScale`. The double-click-to-reset (`autoScaleX()` on `dblclick`) is also present and directly applicable.
- **Borrow: adapt.** In TensorScope, surface a toolbar toggle between "Zoom Mode" and "Select Mode" that updates the chart's drag configuration. This is the same semantics as `demos/cursor-bind.html`.

---

### 2.4 Microtask-Batched Commit / Immediate Batch API

```javascript name=src/uPlot.js url=https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L2151-L2175
function commit() {
  if (!queuedCommit) {
    microTask(_commit);
    queuedCommit = true;
  }
}

// manual batching (aka immediate mode), skips microtask queue
function batch(fn, _deferHooks = false) {
  queuedCommit = true;
  deferHooks = _deferHooks;
  fn(self);
  _commit();
  if (_deferHooks && hooksQueue.length > 0)
    queueMicrotask(flushHooks);
}
```

- **Where:** `src/uPlot.js` — `commit()`, `batch()`, `_commit()`
- **Why valuable for TensorScope:** When TensorScope receives a new tensor slice from the FastAPI backend, it will call `setData` + `setScale` + update event overlays in rapid succession. Without batching, each call triggers a separate redraw. uPlot's `batch(fn)` collapses all mutations into one `_commit()` pass. This pattern is directly applicable to TensorScope's React update cycle when wrapping uPlot (or an equivalent canvas renderer).
- **Borrow: adapt.** TensorScope's chart wrapper hook (e.g., `useChartInstance`) should expose a `batch()` method. Backend-triggered updates (new window slice arrives) should always go through batch to prevent flicker and redundant redraws.

---

### 2.5 Column-Oriented Data Format (Typed Array Alignment)

The entire uPlot data model is `data[0]` = timestamps array, `data[N]` = value arrays — not an array of row objects. The bench suite (`bench/results.json`, comparison files) validates this delivers ~5× less JS time and ~10× less heap than object-array formats used by Chart.js and ECharts.

- **Where:** API contract established in `src/uPlot.js` (`setData`), `src/opts.js` (`xSeriesOpts`/`ySeriesOpts`), demonstrated in all bench files
- **Why valuable for TensorScope:** The FastAPI backend's windowed slice endpoint should return columnar arrays (one array per channel), not row-per-sample JSON objects. This maps directly to uPlot's data model and avoids O(N×channels) object allocation on the frontend.
- **Borrow: directly.** TensorScope's backend slice API should return `{ t: Float64Array, channels: { [id]: Float32Array } }`. The frontend can pass channel arrays directly to the chart renderer without transformation.

---

### 2.6 Pluggable Path Renderer Registry

```
src/paths/
  linear.js
  stepped.js
  bars.js
  monotoneCubic.js
  catmullRomCentrip.js
  spline.js
  points.js
  utils.js
```

- **Where:** `src/paths/`, imported and exposed as `uPlot.paths.*`
- **Why valuable for TensorScope:** Different neurophysiology signals want different path renderers. Raw LFP traces → linear. Event rasters → bars or points. Spike density estimates → stepped or filled areas. uPlot's path renderer is a plain function `(u, seriesIdx, idx0, idx1) => { stroke, fill }` returning `Path2D` objects — completely decoupled from the core render loop. This is an excellent interface contract to adopt.
- **Borrow: adapt.** TensorScope's chart component should expose a `pathRenderer` prop that accepts the same function signature, enabling scientific signal-specific renderers (e.g., a "raster" renderer for event data).

---

### 2.7 `valToPos` / `posToVal` Scale Coordinate API

- **Where:** `src/uPlot.js` — `posToVal(pos, scale, can)` and corresponding `valToPos`
- **Why valuable for TensorScope:** TensorScope needs to hit-test electrode positions on a spatial map against pixel coordinates (for AP/ML selection), and to convert clicked pixel positions back to time values for event annotation. uPlot's bidirectional scale API is the minimal correct interface: it handles both CSS and canvas pixel spaces, supports log/linear/asinh scales.
- **Borrow: directly.** TensorScope's chart instances must expose `valToPos`/`posToVal` equivalents for both the time axis and any spatial axes. This is essential for linked selection between views.

---

## 3. Interaction / UX Ideas Worth Studying

### 3.1 Cross-Chart Cursor Synchronization (Linked Time)
`demos/sync-cursor.html` shows three charts (CPU, RAM, TCP) with cursors synchronized via a named key. Moving the cursor on any chart immediately moves crosshairs on all others. This is the exact interaction TensorScope needs for linking the multichannel timeseries view, the spatial electrode map, and the event overlay at a shared time coordinate. The `uPlot.sync("moo")` call + per-chart `cursor.sync.key = "moo"` is a 3-line integration.

The demo also shows a runtime "Disable Sync" toggle — a direct UX idea for TensorScope: allow the user to detach a panel from the global time sync for independent inspection.

### 3.2 Drag-to-Zoom with Auto-Scale + Double-Click Reset
`cursor.drag.setScale: true` makes drag create a zoom into the selected time window, auto-rescaling the Y axis. Double-click calls `autoScaleX()` to reset. This is the canonical timeseries navigation gesture. TensorScope should implement the same, with the zoom window fed back to the FastAPI backend as the new fetch window (triggering a higher-resolution slice from the tensor).

### 3.3 Cursor Lock (`cursor.lock`)
uPlot supports locking the cursor in place (`cursor.lock = true` on click) while the user reads values. For TensorScope's multichannel inspector, this is directly useful: click to lock crosshair at a time point, then inspect all channel values in the legend/tooltip without the cursor moving.

### 3.4 "Select-Only" Mode (Non-Zoom Region Selection)
`demos/cursor-bind.html` shows toggling between select-and-zoom and select-only. In TensorScope, select-only is the right mode for marking time windows as events or annotations without triggering a data re-fetch. The `setSelect` / `select` API (coordinates: `left`, `width`, `top`, `height`) maps cleanly to an event-window selection state in `TensorScopeState`.

### 3.5 Focus Closest Series
`demos/focus-cursor.html` shows de-emphasizing all series except the one nearest the cursor (via `focus.alpha`). For dense multichannel views with 64+ channels, this is critical UX: TensorScope should fade non-hovered channels to 0.2 opacity when the cursor is near a specific channel trace.

### 3.6 Nearest Non-Null Cursor Hover
`demos/nearest-non-null.html` demonstrates returning `null` from `cursor.dataIdx` when data is missing, so the cursor snaps only to real samples. For neurophysiology data with dropped samples or masked epochs, this prevents misleading cursor positions.

### 3.7 Sparse/Gap-Aware Rendering
`demos/sparse.html` shows `spanGaps: false` to visually break the line at null values, and custom `Path2D` path builders that skip null samples entirely. TensorScope must handle missing electrode data or masked time windows gracefully — uPlot's null-aware gap clipping in `src/paths/utils.js` (`clipGaps`, `addGap`) is directly reusable as a pattern.

---

## 4. Engineering Patterns Worth Borrowing

### 4.1 Feature Flag Module (`src/feats.js`)

```javascript name=src/feats.js url=https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/feats.js
```

- Constants like `FEAT_TIME`, `FEAT_LEGEND`, `FEAT_PATHS_LINEAR` gate entire code paths at build time (tree-shaken out in production bundles). TensorScope should adopt feature flags to keep specialized view components (spatial heatmap renderer, spike raster renderer) out of bundles that don't need them.

### 4.2 Dirty-Flag / Deferred Commit Render Model

uPlot uses boolean dirty flags (`shouldSetScales`, `shouldSetSize`, `shouldSetCursor`, `shouldSetSelect`) and defers all DOM writes + canvas draws to a single `_commit()` pass scheduled via microtask. This is the correct pattern for any canvas-based scientific visualization that receives multiple state updates per frame (scale change + data update + cursor update all in one animation frame). TensorScope's chart render loop should adopt this exact pattern.

### 4.3 Separated Concerns: Under / Over Canvas Layers

uPlot places a `<canvas>` (for chart drawing) and a `<div class="u-over">` (for mouse capture and overlay elements like cursor lines, select region) as distinct layers. This is important: cursor lines and the select rectangle are pure DOM/CSS transforms (no canvas redraw), so they update at pointer speed even when canvas re-render is throttled. TensorScope should apply this pattern: event overlays, cursor indicators, and selection bands belong in DOM layers above the canvas, not painted on canvas.

### 4.4 Plugin Architecture (Hooks Array Merge)

```javascript name=src/uPlot.js url=https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L3423-L3426
(opts.plugins || []).forEach(p => {
  for (let evName in p.hooks)
    hooks[evName] = (hooks[evName] || []).concat(p.hooks[evName]);
});
```

Each plugin is `{ hooks: { [evName]: fn[] } }`. Plugins don't conflict; they compose by array concatenation. TensorScope should adopt this pattern for: event overlay plugins, spatial selection plugins, spike annotation plugins, and inspector popover plugins.

### 4.5 Coordinate System Utilities (`src/paths/utils.js`)

`orient()`, `moveToH`/`moveToV`, `arcH`/`arcV`, `pxRoundGen()` encapsulate the horizontal/vertical orientation switch so that bar, step, and line renderers work for both X-primary and Y-primary orientations with zero code duplication. TensorScope's spatial electrode grid may need to render both horizontal and vertical axis layouts; this abstraction is worth porting directly to TypeScript.

### 4.6 Columnar Data Layout as the API Contract

No row objects. All series are flat typed arrays. uPlot's `setData(data)` accepts `data[0]` as the shared X axis and `data[N]` as per-series Y values. This is a strict API contract that forces preprocessing to happen upstream. **This should be TensorScope's FastAPI slice response format**: time as `float64[T]`, each channel as `float32[T]`, delivered as compact arrays (MessagePack or binary). Never ship `[{t: ..., ch0: ..., ch1: ...}]` row objects.

---

## 5. Not a Good Fit for TensorScope

### 5.1 Vanilla JS / No TypeScript
uPlot is entirely plain JavaScript with no type contracts. TensorScope uses TypeScript throughout and requires typed models for `TensorScopeState`, tensor metadata, and API responses. Directly copying uPlot's JS source into TensorScope would eliminate type safety at the most critical integration boundary. **Use uPlot as a dependency (via npm) or port its patterns into typed abstractions; don't copy its JS source verbatim.**

### 5.2 Single Monolithic Source File
`src/uPlot.js` is 82,000 bytes of a single closure. This is intentional for bundle size and performance. TensorScope's frontend is a React + TypeScript application with many views, components, and state slices. The monolithic closure pattern would make testability, code splitting, and collaborative development impossible. **Borrow the patterns; don't borrow the file structure.**

### 5.3 No State Management / No Session Persistence
uPlot has no concept of session state, tensor registry, global selection state, or any of TensorScope's `TensorScopeState` requirements. uPlot's cursor/scale state is entirely local to each chart instance. TensorScope's interaction state (active time window, active electrode selection, active event) must live in a shared store (Zustand or similar) that drives all views. **Do not model TensorScope's application state after uPlot's per-instance state.**

### 5.4 Imperative DOM API (Not React-Idiomatic)
uPlot creates and manages its own DOM tree imperatively (`placeTag`, `placeDiv`, `setStylePx`). Integrating this with React requires a `useEffect`-based escape hatch (`new uPlot(opts, data, containerRef.current)`). This is workable but means uPlot instances are outside React's reconciliation tree. **TensorScope should treat uPlot as a leaf-node imperative renderer, not as a React component.** All React state drives the imperative instance via ref + effect.

### 5.5 No WebGL / No Scalability to 10K+ Channels Simultaneously
uPlot is Canvas 2D only. For TensorScope's dense multichannel cases (64–256+ electrode grids rendered simultaneously at high sample rates), Canvas 2D will hit CPU limits. The README itself acknowledges: "If that does not help, consider reducing the update frequency or switch to a WebGL/WebGPU solution." TensorScope's 2D spatial heatmap and dense electrode grids should plan for a WebGL layer. uPlot is the right choice for individual channel traces but not for the 2D spatial tensor visualization.

### 5.6 No Data Fetching / No Windowed Slice Semantics
uPlot explicitly excludes data fetching. `setData` accepts already-prepared arrays. It has no concept of lazy loading, windowed fetching triggered by pan/zoom, or backend-aware data contracts. TensorScope's backend slice API and `setScale`-triggered re-fetch must be built entirely in TensorScope. **uPlot's zoom gesture can trigger a backend fetch, but the fetch logic, cache, and re-injection are TensorScope's responsibility.**

### 5.7 No Multi-Dimensional Axes (AP/ML Grid)
uPlot supports X+Y only (plus multiple Y scales). TensorScope's canonical `(time, AP, ML)` electrode grid requires 2D spatial layout as a first-class concept. uPlot's axis model has no analog for this. **The spatial electrode map view must be built independently of uPlot, likely as a Canvas or WebGL component.**

---

## 6. Top 5 Recommendations for TensorScope

### #1 — Implement the Sync Bus Pattern for Linked Time Selection
**Impact: Highest.** Linked views are the central TensorScope interaction promise. uPlot's `src/sync.js` pub/sub model — a named registry of chart instances that broadcast normalized cursor/select events to each other — is the exact correct abstraction. Adapt it as a React context (`SyncBusContext`) keyed by `activeTensor`. Every chart panel (multichannel traces, event timeline, spatial map) subscribes to the same key. When the user scrubs time in any view, all others update in sync with zero cross-component coupling.

> Build this first, before any other linked interaction. It is the architectural foundation.

### #2 — Adopt Drag-to-Zoom → Backend Re-Fetch as the Core Navigation Loop
**Impact: Very high.** uPlot's `cursor.drag.setScale: true` + `setScale` + double-click `autoScaleX()` defines the standard timeseries navigation gesture. In TensorScope, the `setScale` event should trigger a FastAPI windowed slice request with the new `[tMin, tMax]` range, allowing the backend to return a higher-resolution (less-downsampled) tensor slice for the zoomed window. This is the "zoom = higher resolution" semantic that separates scientific tools from consumer dashboards.

> Wire `setScale` hook → debounced fetch → `batch(setData + setScale)` as the primary data navigation loop.

### #3 — Use Columnar Typed Array Format as the Non-Negotiable API Contract
**Impact: Very high.** uPlot's benchmark data is conclusive: columnar arrays are 5–10× cheaper in JS time and heap than row-object arrays for dense timeseries. TensorScope's FastAPI backend must return `float32` / `float64` columnar arrays (ideally as binary MessagePack or Arrow), not JSON row objects. This applies to: channel slice responses, event timestamp arrays, and spatial grid values.

> Make this a backend API constraint from day one. Retrofitting is expensive.

### #4 — Build the Render Layer with Under/Over Layers and DOM-Based Cursor Overlays
**Impact: High.** uPlot's architecture of `canvas (under)` + `div.u-over (mouse capture)` + CSS-positioned cursor elements (no canvas repaint for cursor movement) is why it can sustain 60fps cursor tracking on dense data. TensorScope's multichannel view should use the same pattern: Canvas for signal rendering (repainted only when data or scale changes), DOM/CSS for crosshair lines, selection rectangle, event markers, and tooltips (updated at pointer speed without canvas repaint).

> Never put the cursor crosshair, selection band, or hover tooltip on the same canvas as the data. Separate layers.

### #5 — Adopt the Plugin/Hooks Architecture for Event Overlays and Annotations
**Impact: High.** uPlot's `opts.plugins = [{ hooks: { draw: [fn], setCursor: [fn] } }]` pattern allows event overlays, spike markers, epoch bands, and custom annotations to be composed as independent plugins that inject into the render cycle without coupling to each other or the base renderer. TensorScope's event overlay (showing trial events, artifact windows, stimulation times) and selection overlays should be implemented as plugins against this interface. This keeps the base chart clean and makes the overlay system testable in isolation.

> Design TensorScope's `OverlayPlugin` interface to match this contract. An event overlay plugin should receive `(chartInstance, draw hook)` and paint onto the canvas using the chart's `valToPos` API.

---

## 7. Evidence

| Claim | File(s) |
|---|---|
| Sync bus pub/sub pattern | [`src/sync.js`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/sync.js) |
| Sync used in cursor interaction | [`src/uPlot.js#L3353-L3463`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L3353-L3463) |
| Named sync in demo with toggle | [`demos/sync-cursor.html`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/demos/sync-cursor.html) |
| Hooks & plugin architecture | [`src/uPlot.js#L3415-L3430`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L3415-L3426) |
| Cursor opts, drag, bind, lock | [`src/opts.js#L370-L494`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/opts.js#L370-L494) |
| Cursor select, zoom, resize handling | [`src/uPlot.js#L2224-L2328`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L2224-L2328) |
| Microtask commit / batch API | [`src/uPlot.js#L2151-L2175`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L2151-L2175) |
| setSeries / setScale / posToVal | [`src/uPlot.js#L2468-L2584`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L2468-L2584) |
| Dirty-flag render scheduling | [`src/uPlot.js#L2085-L2210`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L2085-L2211) |
| Feature flags (tree shaking) | [`src/feats.js`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/feats.js) |
| Pluggable path renderers | [`src/paths/`](https://github.com/leeoniya/uPlot/tree/master/src/paths) — `linear.js`, `stepped.js`, `bars.js`, `points.js`, `monotoneCubic.js`, `utils.js` |
| Gap/null-aware rendering | [`demos/sparse.html`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/demos/sparse.html), `src/paths/utils.js` |
| Columnar data perf vs row-objects | [`bench/table.md`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/bench/table.md), [`bench/results.json`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/bench/results.json) |
| Under/over DOM layer model | [`src/domClasses.js`](https://github.com/leeoniya/uPlot/blob/master/src/domClasses.js) — `UNDER`, `OVER`, `SELECT`, `CURSOR_X`, `CURSOR_Y` |
| Cursor focus/alpha per series | [`src/uPlot.js#L2468-L2584`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L2468-L2584) — `setFocus`, `setAlpha` |
| Cursor-bind mode toggle demo | [`demos/index.html#L55`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/demos/index.html#L55) — `cursor-bind.html` |
| No WebGL — documented limitation | [`README.md#L11-L14`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/README.md#L11-L14) |
| Import surface (module structure) | [`src/uPlot.js#L1-L194`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/src/uPlot.js#L1-L194) |
| Stream-data update pattern | [`demos/index.html`](https://github.com/leeoniya/uPlot/blob/976b207e0132a6bff685280c6de653867d0e2b17/demos/index.html) — `stream-data.html`, `sine-stream.html` |