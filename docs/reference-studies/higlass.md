# HiGlass as a Design Reference for TensorScope

> **Note on search completeness:** Code search results are capped at 10 results per query. All claims below are grounded in specific files retrieved; some secondary patterns may exist beyond what was surfaced.

---

### 1. Repo Overview

**What this app is:**
HiGlass is a production-grade, tiled, multi-view genomic data browser. It renders large 2D matrix data (Hi-C contact maps), 1D signal tracks (bar, line, multivec), gene annotation overlays, and geographic tiles — all in a synchronized, zoomable, multi-panel workspace. The core rendering stack is React (class components) + Pixi.js for GPU-accelerated tile rendering, D3 for brushing/axes/scales, and a custom tiled data fetching pipeline backed by a Python/Django tile server.

**Why it is a meaningful reference for TensorScope:**
The overlap is deep and specific:
- Both deal with dense, large scientific arrays sliced into viewport-relevant windows
- Both require synchronized multi-view navigation (zoom lock, location lock)
- Both require overlays, brush selection, and value-scale linking
- Both sit on a tiled backend API and must handle zoom-level-aware data fetching
- The data shape analogy is strong: HiGlass's genomic coordinate space ↔ TensorScope's `(time, AP, ML)` tensor coordinate space

This is not a superficial parallel. HiGlass has solved — at production scale — nearly every hard problem TensorScope needs to solve, just in a different scientific domain.

---

### 2. Features Worth Borrowing

#### 2.1 Tiled, Zoom-Level-Aware Data Fetching

**Where it lives:**
```javascript name=app/scripts/TiledPixiTrack.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/TiledPixiTrack.js#L134-L227
// fetchedTiles, visibleTiles, fetching (in-flight set), tileGraphics (rendered cache)
// continuousScaling = 'requestIdleCallback' in window
this.visibleTiles = [];
this.visibleTileIds = new Set();
this.renderingTiles = new Set();
this.fetching = new Set();
this.fetchedTiles = {};
this.tileGraphics = {};
this.continuousScaling = 'requestIdleCallback' in window;
```

```javascript name=app/scripts/services/tile-proxy.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/services/tile-proxy.js#L344-L370
export const fetchTilesDebounced = createBatchedExecutor({
  processBatch: async (requests, pubSub) => {
    const promises = Array.from(
      optimizeRequests(requests.map((r) => r.value)),
      (request) => workerFetchTiles(request, { authHeader, sessionId, pubSub }),
    );
    const index = indexTiles(await Promise.all(promises));
    for (const request of requests) {
      request.resolve(index.resolveTileDataForRequest(request.value));
    }
  },
  interval: TILE_FETCH_DEBOUNCE,
  finalWait: TILE_FETCH_DEBOUNCE,
});
```

**Why valuable for TensorScope:** The pattern of `visibleTiles` (what should show) vs. `fetchedTiles` (what has been retrieved) vs. `tileGraphics` (what has been rendered) is the correct three-stage pipeline for dense tensor windowing. TensorScope's `(time, AP, ML)` slices are exactly this kind of tiled 1D/2D problem. The debounced, batched tile request executor prevents request storms during rapid pan/zoom.

**Borrow:** Adapt directly. Replace HiGlass's `[zoomLevel, tileX, tileY]` tile ID scheme with TensorScope's windowed tensor slice requests (time window + downsampling level).

---

#### 2.2 View Synchronization: Zoom Locks and Location Locks

**Where it lives:**
```javascript name=app/scripts/HiGlassComponent.jsx url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/HiGlassComponent.jsx#L130-L153
this.zoomLocks = {};
this.locationLocks = {};
this.scalesChangedListeners = {};
this.draggingChangedListeners = {};
this.valueScalesChangedListeners = {};
```

```javascript name=app/scripts/HiGlassComponent.jsx url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/HiGlassComponent.jsx#L2024-L2048
handleZoomLockChosen(uid1, uid2) {
  // ...
  this.addLock(uid1, uid2, this.zoomLocks, this.viewScalesLockData.bind(this));
  // ...
}
```

```javascript name=app/scripts/HiGlassComponent.jsx url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/HiGlassComponent.jsx#L1832-L1841
handleScalesChanged(uid, xScale, yScale, notify = true) {
  // propagates scale changes to all locked views
}
```

**Why valuable for TensorScope:** TensorScope's "linked interaction" is described as a core feature: time selection linking, AP/ML selection linking across spatial maps and timeseries panels. HiGlass has a fully worked out, battle-tested model: locks stored by UID pair, propagated via `handleScalesChanged`, with `zoomLocks`, `locationLocks`, and `valueScaleLocks` as separate orthogonal concerns.

**Borrow:** Adapt. Replace genomic coordinate domains with TensorScope's time/AP/ML domains. The lock/unlock/yank mental model ("take zoom from", "lock zoom with") is exactly what TensorScope's scientist users will want for comparing recordings.

---

#### 2.3 Viewport Tracker as a Projection Overlay

**Where it lives:**
```javascript name=app/scripts/ViewportTrackerHorizontal.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/ViewportTrackerHorizontal.js#L29-L133
this.brush = brushX().on('brush', this.brushed.bind(this));
// ...
viewportChanged(viewportXScale, viewportYScale, update = true) {
  this.viewportXDomain = viewportXScale.domain();
  this.viewportYDomain = viewportYScale.domain();
  this.draw();
}
```

```javascript name=app/scripts/ViewportTracker2D.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/ViewportTracker2D.js#L20-L124
// brush on 2D projection
// viewportChanged redraws the brush to reflect the linked view's domain
registerViewportChanged(uid, this.viewportChanged.bind(this));
```

**Why valuable for TensorScope:** This pattern — where one view renders a "shadow" of another view's current viewport as a brushed overlay — is exactly what TensorScope needs for showing the current time window on a summary/overview track, or the current spatial selection on an overview electrode map. The 2D version directly maps to AP/ML selection projection.

**Borrow:** Adapt directly. `ViewportTrackerHorizontal` → TensorScope time cursor / window overlay. `ViewportTracker2D` → TensorScope AP/ML selection overlay on electrode map.

---

#### 2.4 `BackgroundTaskScheduler` with `requestIdleCallback`

**Where it lives:**
```javascript name=app/scripts/utils/background-task-scheduler.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/utils/background-task-scheduler.js#L1-L115
class BackgroundTaskScheduler {
  enqueueTask(taskHandler, taskData, trackId = null) {
    if (trackId !== null) {
      // deduplicate: drop old tasks for same track, only keep latest
      this.taskList = this.taskList.filter((task) => task.trackId !== trackId);
      this.taskList.push({ handler: taskHandler, data: taskData, trackId });
    }
    if (!this.taskHandle) {
      this.taskHandle = requestIdleCallback(this.runTaskQueue.bind(this), {
        timeout: this.requestIdleCallbackTimeout,
      });
    }
  }
  runTaskQueue(deadline) {
    while ((deadline.timeRemaining() > 0 || deadline.didTimeout) && this.taskList.length) {
      const task = this.taskList.shift();
      // ...execute
    }
    if (this.taskList.length) {
      this.taskHandle = requestIdleCallback(this.runTaskQueue.bind(this), { timeout: 300 });
    }
  }
}
```

**Why valuable for TensorScope:** For dense timeseries rendering (many channels, high-frequency signal), re-render tasks need to be deduplicated per track and deferred to idle time. The per-`trackId` deduplication is critical — it prevents the render queue from filling with stale tasks when users scroll rapidly through a multichannel view.

**Borrow:** Directly copy this utility. It is self-contained and has no HiGlass-specific dependencies.

---

#### 2.5 `DenseDataExtrema1D` — Precomputed Subset Extrema

**Where it lives:**
```javascript name=app/scripts/utils/DenseDataExtrema1D.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/utils/DenseDataExtrema1D.js#L5-L93
class DenseDataExtrema1D {
  constructor(data) {
    this.numSubsets = Math.min(NUM_PRECOMP_SUBSETS_PER_1D_TTILE, this.paddedTileSize);
    this.subsetMinimums = this.computeSubsetNonZeroMinimums();
    this.subsetMaximums = this.computeSubsetNonZeroMaximums();
    this.minNonZeroInTile = this.getMinNonZeroInTile();
    this.maxNonZeroInTile = this.getMaxNonZeroInTile();
  }
  getMinNonZeroInSubset(indexBounds) { /* uses precomputed subsets */ }
}
```

**Why valuable for TensorScope:** TensorScope multichannel timeseries renders many waveforms simultaneously. Auto-scaling each visible channel's y-axis to the visible data range is a common, expensive operation. This precomputed subset extrema class turns an O(N) scan into O(subsets) + O(remainder). It maps directly to per-channel scale computation in dense LFP/spike data.

**Borrow:** Directly copy and adapt for typed arrays of neurophysiology signal data.

---

#### 2.6 Track/View Type Registry

**Where it lives:**
```javascript name=app/scripts/configs/tracks-info.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/configs/tracks-info.js#L73-L208
export const TRACKS_INFO = [
  { type: 'heatmap', datatype: ['matrix'], orientation: '2d', availableOptions: [...], defaultOptions: {...} },
  { type: 'horizontal-bar', datatype: ['vector'], orientation: '1d-horizontal', ... },
  // ...
];
```

```javascript name=app/scripts/configs/tracks-info-by-type.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/configs/tracks-info-by-type.js#L1-L18
export const TRACKS_INFO_BY_TYPE = TRACKS_INFO.reduce(
  (tracksByType, track) => {
    tracksByType[track.type] = track;
    if (track.aliases) {
      for (const alias of track.aliases) { tracksByType[alias] = track; }
    }
    return tracksByType;
  }, {}
);
```

```javascript name=app/scripts/configs/default-tracks-for-datatype.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/configs/default-tracks-for-datatype.js#L1-L39
export const DEFAULT_TRACKS_FOR_DATATYPE = {
  matrix: { center: 'heatmap', top: 'linear-heatmap', ... },
  vector: { top: 'bar', bottom: 'bar', ... },
};
```

**Why valuable for TensorScope:** TensorScope needs to select the right view type based on tensor dimensionality/signature (e.g., `(time, AP, ML)` → spatial electrode map; `(time, channels)` → multichannel timeseries). This pattern — a static registry mapping `datatype → default views`, plus `type → config` — is the correct architecture for dimension-based view selection.

**Borrow:** Adapt. Replace HiGlass's genomic `orientation` concept with TensorScope's tensor signature concept. Registry keys become tensor dim signatures rather than data orientations.

---

#### 2.7 Pub/Sub for Decoupled Interaction Events

**Where it lives:**
```javascript name=app/scripts/Track.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/Track.js#L26-L67
class Track {
  constructor(context, options) {
    this.pubSub = pubSub ?? fakePubSub;
    this.pubSubs.push(
      this.pubSub.subscribe('app.mouseMove', this.defaultMouseMoveHandler.bind(this))
    );
  }
  remove() {
    this.pubSubs.forEach((subscription) => this.pubSub.unsubscribe(subscription));
  }
}
```

```javascript name=AGENTS.md url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/AGENTS.md#L139-L166
// Pub/Sub Topics:
// app.mouseMove, app.click, app.zoom — User interaction events
// Global and per-component pub-sub instances for decoupled communication
```

**Why valuable for TensorScope:** Pub/sub decouples interaction sources (user drag, keyboard) from consumers (multiple linked views, overlays, sidebars). This is more responsive than prop-drilling and avoids React re-render bottlenecks on every mouse-move event. TensorScope's linked time cursor, AP/ML selection broadcasts, and event overlay updates all benefit from this pattern.

**Borrow:** Adapt. Use `pub-sub-es` (same library) or a React-compatible equivalent. Keep event topics typed. The subscription cleanup pattern in `remove()` is essential for preventing memory leaks in long-running sessions.

---

#### 2.8 D3 Brush as Range Selection Tool

**Where it lives:**
```javascript name=app/scripts/CenterTrack.jsx url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/CenterTrack.jsx#L26-L53
this.brushBehaviorX = brushX().on('brush', this.brushedX.bind(this)).on('end', this.brushedXEnded.bind(this));
this.brushBehaviorXY = brush().on('start', ...).on('brush', ...).on('end', ...);
```

```javascript name=app/scripts/HorizontalTiledPlot.jsx url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/HorizontalTiledPlot.jsx#L28-L48
this.brushBehavior = brushX()
  .on('start', this.brushStarted.bind(this))
  .on('brush', this.brushed.bind(this))
  .on('end', this.brushedEnded.bind(this));
```

**Why valuable for TensorScope:** 1D time-range selection and 2D AP/ML region selection are core TensorScope interactions. HiGlass has a fully worked-out implementation for both with proper event source checking (to distinguish user-initiated brush from programmatic brush moves), animated brush movement, and brush reset.

**Borrow:** Adapt the brush lifecycle pattern directly. The pattern of `rangeSelectionMoved` flag (to distinguish user brush from programmatic move) is a subtle but necessary correctness detail.

---

#### 2.9 `showMousePosition` Utility — Per-Track Crosshair

**Where it lives:**
```javascript name=app/scripts/utils/show-mouse-position.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/utils/show-mouse-position.js#L78-L124
const mouseMoveHandler = (event) => {
  if (event.noHoveredTracks) { clearGraphics(); return graphics; }
  let x = event.dataX;
  let y = event.isFrom2dTrack ? event.dataY : event.dataX;
  // draws crosshair line on Pixi graphics at current mouse data coordinates
};
```

**Why valuable for TensorScope:** A global, synced mouse position crosshair that shows data coordinates across multiple linked panels is a standard neuroscience tool (e.g., knowing the time, AP, and ML value under the cursor simultaneously across all views). HiGlass's implementation is data-coordinate-aware (not pixel-coordinate), handles 1D and 2D tracks separately, and cleans up when the mouse leaves.

**Borrow:** Adapt directly. The `isFrom2dTrack` / `isFromVerticalTrack` flags become TensorScope's `isTimeseries` / `isSpatialMap` flags.

---

#### 2.10 `HorizontalMultivecTrack` — Dense Multi-Row Signal

**Where it lives:**
```javascript name=app/scripts/HorizontalMultivecTrack.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/HorizontalMultivecTrack.js#L12-L223
export default class HorizontalMultivecTrack extends HeatmapTiledPixiTrack {
  calculateVisibleTiles() { /* tile calculation for multivec */ }
  tileDataToCanvas(pixData) { /* pixel-level rendering */ }
  zoomed(newXScale, newYScale, k, tx) { /* responsive to zoom */ }
}
```

**Why valuable for TensorScope:** The multivec track is HiGlass's dense multichannel signal display — a 2D matrix where one axis is time/position and the other is channel index. This is structurally identical to TensorScope's multichannel LFP timeseries view. The tileDataToCanvas path (converting dense float arrays to pixel data via a colormap) is directly applicable to heatmap-style multichannel rendering.

**Borrow:** Study closely. The pixel-conversion pipeline is the most important performance path for dense multichannel data.

---

### 3. Interaction / UX Ideas Worth Studying

#### Navigation
- **Zoom-constrained pan:** `TrackRenderer.setUpInitialScales()` enforces `xDomainLimits`, `yDomainLimits`, and `zoomLimits` so users cannot pan outside data bounds or zoom past the data resolution. TensorScope should implement the same — no panning before time=0, no zooming past the sample rate.
- **"Take zoom from" / "Lock zoom with" distinction:** The UX of one-shot snapping vs. continuous locking is a genuine UX win. "Take zoom from" is useful for quick comparison; "Lock zoom with" is useful for sustained parallel browsing. TensorScope should expose both.
- **Zoom to data extent:** `api.zoomToDataExtent(viewUid)` — a one-click fit-to-data button. Essential for orienting users after loading a new session.

#### Linked Views
- **Viewport Projection overlays:** `ViewportTrackerHorizontal/2D` render a shaded rectangle on one view showing what another view is currently displaying. This is far more intuitive than just sync — it makes the relationship between overview and detail panels visually explicit. TensorScope should use this for its summary ↔ detail view relationships.
- **Value scale locking (`syncValueScales`):** Multiple tracks can have their color/value scales locked together so zooming in on one doesn't cause them to diverge. TensorScope's per-channel normalization needs this for fair comparison across electrodes.

#### Time Selection
- HiGlass has both **continuous brush** (d3-brushX on the plot area) and **programmatic range setting** via `setRangeSelection1dSize`. TensorScope should support both: user drag and API-driven selection (e.g., clicking an event marker sets the selection to the event window).
- The `brushed` vs. `brushedEnded` callback split (live update during drag vs. commit on release) is an important UX choice. TensorScope should use live update for cursor/overlay display and commit on release for expensive backend queries.

#### Dense Data Exploration
- **`getMouseOverHtml`** on each track: HiGlass provides per-track tooltip HTML that is shown in a shared tooltip component. The value reported is data-coordinate–aware (not pixel). TensorScope should implement per-panel tooltips showing: time, channel ID, signal value, and any overlapping event labels.
- **Mouse position crosshair** broadcasting via pub/sub means all linked panels show the same time cursor simultaneously without explicit synchronization code.

#### Annotation / Event Interaction
- `HorizontalRule` / `VerticalRule` / `CrossRule` tracks: These are simple overlay tracks that draw lines at fixed data coordinates. TensorScope's event markers are structurally identical. The mixin pattern (`mix(PixiTrack).with(RuleMixin, VerticalRuleMixin)`) is a clean way to compose overlay behavior.
- The `OverlayTrack` and `Annotations1dTrack` / `Annotations2dTrack` types show how annotation overlays can be separate tracks composed on top of data tracks.

#### Layout Ergonomics
- **`react-grid-layout`** for a 12-column draggable/resizable panel grid is already part of the stack. The view config serializes layout as `{x, y, w, h}` per view. This is the right approach for a scientist-configurable workspace.
- **`handleAddView` duplication logic:** When a user adds a new view, HiGlass finds the first available grid position. TensorScope should consider similar auto-placement.

---

### 4. Engineering Patterns Worth Borrowing

#### Frontend Architecture

HiGlass has a three-layer React architecture:
```
HiGlassComponent (global state: zoom locks, location locks, view registry)
  └─ TiledPlot (per-view: brush, range selection, layout)
       └─ TrackRenderer (per-view rendering engine: D3 zoom, Pixi stage, track objects)
            └─ Track instances (per-track: data fetching, rendering, interaction)
```

This maps cleanly to TensorScope:
```
TensorScopeApp (TensorScopeState: active tensor, global selection)
  └─ ViewPanel (per-view: brush, selection)
       └─ ViewRenderer (per-view: scaling, canvas/WebGL stage)
            └─ TensorView instances (per-view-type: data fetching, rendering)
```

**Borrow the layering.** Keep global coordination at the top, rendering mechanics at the bottom, with clean prop interfaces between layers.

---

#### Data/API Architecture

The `DataFetcher` abstraction:
```javascript name=app/scripts/data-fetchers/DataFetcher.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/data-fetchers/DataFetcher.js#L248-L268
fetchTilesDebounced(receivedTiles, tileIds) {
  if (this.dataConfig.type === 'horizontal-section') {
    return this.fetchHorizontalSection(receivedTiles, tileIds);
  }
  // ...
  return this._tileSource.fetchTiles({
    server: this.dataConfig.server,
    tileIds: tileIds.map((x) => `${this.dataConfig.tilesetUid}.${x}`),
  });
}
```

The `AbstractDataFetcher` interface (`tilesetInfo(callback)`, `fetchTilesDebounced(receivedTiles, tileIds)`, `tile(z, x)`) is clean and swap-able. TensorScope should define an equivalent `TensorDataFetcher` interface:
- `tensorInfo(callback)` — fetch metadata (shape, dtype, sampling rate, channel labels)
- `fetchWindowDebounced(receivedData, windowRequests)` — fetch windowed slices

**Borrow the interface pattern, not the implementation.**

---

#### State Organization

HiGlass explicitly avoids a global state store. From `AGENTS.md`:
> **No global state store** — uses Pub/Sub events + React class component state + instance variables

This is a deliberate performance choice — scale changes need to propagate at ~60fps, which React setState cannot sustain for every zoom frame. The bypass is:
- Fast path: instance variables + pub/sub + direct imperative updates
- Slow path: React state for things that need to trigger re-render (view config, layout)

**For TensorScope:** This is worth knowing but not necessarily worth copying wholesale. TensorScope should consider Zustand or Jotai for `TensorScopeState` (which changes slowly) while keeping interaction-hot paths (time cursor position, brush selection during drag) in local component state or refs updated imperatively.

---

#### Rendering Boundaries

HiGlass's rendering boundary is clear: React owns the DOM structure and layout; Pixi.js owns the canvas pixel content. React never re-renders the canvas elements — it only manages their container divs and passes props to the track objects. This prevents React from becoming a bottleneck in the render loop.

**For TensorScope:** If using WebGL/Canvas for signal rendering, apply the same boundary. React manages panel layout, headers, sidebars, and overlays. Canvas/WebGL manages waveform and heatmap pixels. Do not re-render the canvas through React state changes.

---

#### Extensibility

The plugin system:
```javascript name=app/scripts/TiledPlot.jsx url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/TiledPlot.jsx#L32-L148
if (window.higlassTracksByType) {
  Object.keys(window.higlassTracksByType).forEach((pluginTrackType) => {
    TRACKS_INFO_BY_TYPE[pluginTrackType] = window.higlassTracksByType[pluginTrackType].config;
  });
}
```

The `window.higlassTracksByType` global registry is simple but fragile. TensorScope should use a more explicit registration API (e.g., `tensorScope.registerViewType(config)`) rather than a global window property.

---

#### Testing

From `package.json` and test structure:
- **Vitest** with `@vitest/browser` + Playwright for real-browser interaction tests
- **MSW (Mock Service Worker)** for mocking tile server responses
- Test files live in `test/` and are organized by feature (`api.test.js`, `zoom.test.js`, `three-views-and-linking.test.js`)
- Tests directly call component instance methods (`hgc.instance().handleZoomLockChosen(...)`) to drive interaction

```javascript name=test/HiGlassComponent/three-views-and-linking.test.js url=https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/test/HiGlassComponent/three-views-and-linking.test.js#L34-L54
hgc.instance().handleLocationLockChosen('aa', 'bb');
hgc.instance().handleZoomLockChosen('aa', 'bb');
// ... set center programmatically ...
await new Promise((done) => waitForTilesLoaded(hgc.instance(), done));
// ... assert scales match
```

**For TensorScope:** This test pattern is directly applicable. Write tests that:
1. Mount the component
2. Drive interaction programmatically (set time domain, trigger brush)
3. Assert that linked views updated correctly
4. Use MSW to mock the FastAPI backend tensor slice responses

---

### 5. Not a Good Fit for TensorScope

#### 5.1 React Class Components Throughout
HiGlass is built on React class components with `UNSAFE_componentWillMount`, `UNSAFE_componentWillReceiveProps`, and extensive `shouldComponentUpdate` manual optimization. This is technical debt accumulated over years. TensorScope should use React functional components with hooks from day one — the performance concerns that drove HiGlass's imperative patterns are better addressed with `useRef`, `useCallback`, and careful memoization in modern React.

#### 5.2 The Monolithic `HiGlassComponent.jsx` (~166KB)
The root component accumulates almost all global coordination logic in a single enormous class. This makes the code very hard to follow and impossible to unit test in isolation. TensorScope should decompose global coordination into focused hooks or context providers (`useViewSync`, `useTensorRegistry`, `useSelectionState`) from the start.

#### 5.3 Pixi.js as the Required Rendering Stack
HiGlass is deeply coupled to Pixi.js (v5/v6 as peer dependencies). For TensorScope's use cases (dense LFP waveforms, spatial maps), WebGL via `regl`, raw Canvas 2D, or a purpose-built waveform renderer (like `@bfc/signal-viewer` or custom) may be more appropriate. The Pixi.js indirection adds complexity without benefit for pure timeseries waveform rendering (which doesn't need a scene graph).

#### 5.4 `window.higlassTracksByType` Global Plugin Registry
Registering plugins via global window mutations is fragile, untestable, and incompatible with ES module bundling. TensorScope should define explicit registration APIs.

#### 5.5 No TypeScript for Core Logic
Despite using TypeScript for some newer files and type annotations via JSDoc, the core track implementations (`HiGlassComponent.jsx`, `TiledPlot.jsx`, `TrackRenderer.jsx`) are annotated JavaScript, not TypeScript. TensorScope's architecture explicitly calls for TypeScript — use it fully from the start.

#### 5.6 Serialized ViewConfig as Primary State Model
HiGlass's `viewConfig` JSON blob is simultaneously the serialization format, the initial state, and the in-memory state model. This creates tight coupling between the serialization schema and the runtime state. TensorScope's `TensorScopeState` should be a properly typed runtime state model, with a separate serialization/deserialization layer for session persistence.

#### 5.7 D3 for All Interaction (Zoom, Brush, Drag)
HiGlass uses D3 zoom behaviors on DOM elements, which work well but create an awkward impedance mismatch with React's synthetic event system. This is why HiGlass bypasses React for scale updates entirely. TensorScope could use D3's math (scales, brush geometry calculation) while handling pointer events natively in React, reducing the layering complexity.

---

### 6. Top 5 Recommendations for TensorScope

**#1 — Implement the Three-Stage Tile Pipeline (Visible → Fetched → Rendered)**

The `visibleTiles`/`fetchedTiles`/`tileGraphics` pattern in `TiledPixiTrack.js`, combined with the debounced batched fetcher in `tile-proxy.js`, is the single most impactful engineering pattern for TensorScope. Without it, dense tensor slice fetching will either over-request during pan/zoom or under-respond during rapid navigation. Adapt this pattern to TensorScope's windowed tensor API immediately — it is the foundation everything else sits on.

**#2 — Implement Zoom/Location Lock with the `zoomLocks`/`locationLocks` Pattern**

The HiGlass view synchronization model (`handleScalesChanged` → propagates to lock group → each locked view calls `setCenters`) is directly applicable to TensorScope's linked time selection. The distinction between "take zoom from" (one-shot) and "lock zoom with" (continuous) is a UX nuance that neuroscience users will need for comparing recordings. Implement this in TensorScope's `TensorScopeState` as `timeLocks`, `spatialLocks`.

**#3 — Build `ViewportTracker` Overlays for Overview↔Detail Relationships**

`ViewportTrackerHorizontal` and `ViewportTracker2D` are the highest-value UX patterns in HiGlass for TensorScope. Showing the current time window as a brush on an overview timeseries, or the current AP/ML selection as a highlighted rectangle on an electrode map, makes navigation dramatically more intuitive. These should be first-class view types in TensorScope, not afterthoughts.

**#4 — Copy `BackgroundTaskScheduler` and `DenseDataExtrema1D` Verbatim**

These two utilities are self-contained, have no external dependencies beyond the Web API, and solve real performance problems at TensorScope's density. The `BackgroundTaskScheduler` deduplicates stale render tasks by track ID. `DenseDataExtrema1D` makes per-channel auto-scaling fast enough to do live during pan. Copy these before building the multichannel waveform renderer.

**#5 — Adopt the Pub/Sub Pattern for Interaction Events, Not React State**

The `app.mouseMove`, `app.zoom` pub/sub pattern (bypassing React's event system for hot-path events) is the correct architecture for TensorScope's linked time cursor. Mouse position during hover, real-time brush updates, and crosshair synchronization across panels must not go through React `setState`. Use pub/sub for these, React state only for committed selections and view config changes.

---

### 7. Evidence

The following files from `higlass/higlass` directly support the above analysis:

| File | What it demonstrates |
|---|---|
| [`app/scripts/HiGlassComponent.jsx`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/HiGlassComponent.jsx) | Root component, zoom/location lock system, view synchronization |
| [`app/scripts/TrackRenderer.jsx`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/TrackRenderer.jsx) | D3 zoom integration, pub/sub subscription, Pixi stage management |
| [`app/scripts/TiledPixiTrack.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/TiledPixiTrack.js) | Tile lifecycle, `visibleTiles`/`fetchedTiles`, `backgroundTaskScheduler` |
| [`app/scripts/services/tile-proxy.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/services/tile-proxy.js) | Debounced batched tile fetching, tile calculation from zoom/domain |
| [`app/scripts/data-fetchers/DataFetcher.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/data-fetchers/DataFetcher.js) | Abstracted data fetcher with `fetchTilesDebounced`, `tilesetInfo` |
| [`app/scripts/ViewportTrackerHorizontal.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/ViewportTrackerHorizontal.js) | 1D viewport projection as D3 brush overlay |
| [`app/scripts/ViewportTracker2D.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/ViewportTracker2D.js) | 2D viewport projection |
| [`app/scripts/CenterTrack.jsx`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/CenterTrack.jsx) | 1D/2D brush selection, moveBrushX/Y/XY, source event checking |
| [`app/scripts/HorizontalTiledPlot.jsx`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/HorizontalTiledPlot.jsx) | Range selection brush lifecycle, `shouldComponentUpdate` pattern |
| [`app/scripts/HorizontalMultivecTrack.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/HorizontalMultivecTrack.js) | Dense multichannel signal rendering via tiled pixel conversion |
| [`app/scripts/Track.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/Track.js) | Base track class, pub/sub subscription and cleanup pattern |
| [`app/scripts/utils/background-task-scheduler.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/utils/background-task-scheduler.js) | `requestIdleCallback`-based render queue with per-track deduplication |
| [`app/scripts/utils/DenseDataExtrema1D.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/utils/DenseDataExtrema1D.js) | Precomputed subset extrema for fast visible-range min/max |
| [`app/scripts/utils/show-mouse-position.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/utils/show-mouse-position.js) | Data-coordinate-aware crosshair overlay |
| [`app/scripts/configs/tracks-info.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/configs/tracks-info.js) | Track type registry with datatype→orientation→options mapping |
| [`app/scripts/configs/default-tracks-for-datatype.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/configs/default-tracks-for-datatype.js) | Datatype → default view type mapping |
| [`app/scripts/api.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/api.js) | Public API surface: `zoomTo`, `setViewConfig`, `on('location')`, `on('viewConfig')` |
| [`app/scripts/HeatmapTiledPixiTrack.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/app/scripts/HeatmapTiledPixiTrack.js) | 2D matrix tile rendering, colorbar brush, `getMouseOverHtml` with data coords |
| [`test/HiGlassComponent/three-views-and-linking.test.js`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/test/HiGlassComponent/three-views-and-linking.test.js) | Interaction test pattern: programmatic navigation + tile load wait + scale assertion |
| [`AGENTS.md`](https://github.com/higlass/higlass/blob/ef5a57ea84052f4945035052be70a97fac343837/AGENTS.md#L26-L89) | Authoritative architecture overview, track hierarchy, pub/sub topics |