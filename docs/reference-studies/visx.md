# visx Reference Study

**Repo:** https://github.com/airbnb/visx
**Date studied:** 2026-03-11
**Studied by:** Claude (claude-sonnet-4-6)

---

## 1. Repo Overview

visx is a 39-package monorepo of low-level, composable React + SVG visualization primitives from Airbnb. The stated mission is to let teams build custom chart libraries without learning d3's DOM-mutation model: visx wraps d3's math (scales, shapes, layouts) behind React components, eliminating the `enter()`/`exit()`/`update()` mental model entirely.

**Core design axioms:**

1. **Primitives, not charts.** visx never assembles a complete chart for you. You compose `@visx/shape`, `@visx/axis`, `@visx/scale`, `@visx/brush`, etc. yourself. This is explicitly the opposite of Chart.js or Recharts.
2. **Modular by package.** Each concern ships as an independent `@visx/*` npm package. Consumers install only what they need.
3. **No animation included.** Animation is deliberately omitted to avoid bundling a spring library the consumer may already use. `@visx/react-spring` is a separate optional package shipping animated variants of xychart series.
4. **SVG-first, no Canvas option in most packages.** The shapes, axes, and series all render SVG `<path>`, `<rect>`, `<circle>` elements. Only `@visx/zoom` and `@visx/brush` sit on transparent SVG overlay rectangles for interaction capture; they do not expose a Canvas renderer.

**Key packages (39 total):**

| Package | Purpose |
|---|---|
| `visx-scale` | Typed wrappers around all d3 scale types |
| `visx-shape` | LinePath, AreaClosed, Bar, Pie, Arc, etc. (SVG paths) |
| `visx-axis` | Axis component with tick calculation; children render-prop for custom tick renderers |
| `visx-brush` | 1D/2D range selection with drag-to-resize handles, onChange/onBrushEnd callbacks |
| `visx-zoom` | Affine 2D transform matrix for pan/zoom; render-prop exposes transform state |
| `visx-drag` | `useDrag` hook: drag start/move/end with constraint support |
| `visx-heatmap` | `HeatmapRect` and `HeatmapCircle`: 2D grid of color-scaled SVG rects/circles |
| `visx-voronoi` / `visx-delaunay` | Voronoi + Delaunay triangulation for spatial nearest-point hit testing |
| `visx-xychart` | Higher-level coordinated chart system: DataProvider + series + shared tooltip + event bus |
| `visx-event` | `localPoint()`: converts DOM/touch events to SVG local coordinate space via `createSVGPoint()` + `screenCTM.inverse()` |
| `visx-responsive` | `ParentSize` component using ResizeObserver for container-based sizing |
| `visx-annotation` | `Annotation` context provider + Label/Connector/Subject children for data-anchored text |
| `visx-tooltip` | `useTooltip` hook + `useTooltipInPortal` for portal-rendered tooltips |
| `visx-grid` | Grid line components (rows/columns) that accept scale + tick values |
| `visx-stats` | BoxPlot: quartiles, whiskers, outliers |
| `visx-gradient` | SVG `<linearGradient>` wrapper for use as fill reference |
| `visx-pattern` | SVG `<pattern>` wrapper (hatching, etc.) |
| `visx-glyph` | Glyph shapes: circle, cross, diamond, star, triangle, wye |

---

## 2. Features Worth Borrowing

### 2a. `@visx/brush` — Time-range selection primitive (adapt)

The `Brush` component implements drag-to-select with resizable handles and a clean callback API:

- Props: `xScale`, `yScale`, `width`, `height`, `brushDirection` (`'horizontal'|'vertical'|'both'`), `initialBrushPosition`, `resizeTriggerAreas`, `resetOnEnd`
- Callbacks: `onChange(Bounds | null)`, `onBrushStart(point)`, `onBrushEnd(Bounds | null)`, `onClick`
- `Bounds` type: `{ x0, x1, xValues?, y0, y1, yValues? }` — pixel range already converted to domain values via the provided scale's `invert()`

The internal state lives in `BaseBrush` as `{ start, end, extent, bounds, isBrushing, brushingType, activeHandle }`. `onChange` fires continuously during drag; `onBrushEnd` fires on mouse-up. `BrushHandle` uses `@visx/drag`'s `useDrag` internally to track delta movement and calls `updateBrush()` to mutate the extent in real time. An optional `useWindowMoveEvents` flag enables tracking drags that leave the SVG container.

**TensorScope relevance:** The navigator view already uses uPlot's built-in drag-to-zoom which fires `timeWindow` updates into `useSelectionStore`. The visx brush is not a drop-in replacement for uPlot's canvas-based selection, but its TypeScript `Bounds` type design and the `onChange`/`onBrushEnd` separation are worth mirroring when building any custom SVG brush overlay (e.g., a frequency-range brush on the spectrogram, or a 2D region select on the spatial map).

### 2b. `@visx/voronoi` + `@visx/delaunay` — Electrode hit-testing (direct use candidate)

`voronoi()` wraps d3-delaunay's Voronoi diagram for nearest-point queries. `VoronoiPolygon` is a React component for rendering individual Voronoi cells. The `@visx/delaunay` package exports both `delaunay` and `voronoi` utilities plus a `Polygon` component. The usage pattern is:

```ts
const voronoiLayout = voronoi({
  x: (d) => xScale(d.x),
  y: (d) => yScale(d.y),
  width,
  height,
});
const nearest = voronoiLayout(data).find(mouseX, mouseY, radius);
```

**TensorScope relevance:** The spatial electrode map currently uses a CSS grid with click-to-select, which works for regular `(AP, ML)` grids. For irregular probe geometries (e.g., a Neuropixels shank or custom multi-electrode array), Voronoi hit-testing is the correct approach — each click routes to the nearest electrode's Voronoi cell without needing enlarged hit targets or pixel-perfect alignment. This is a direct borrowing candidate when the spatial map gains support for non-rectangular electrode layouts.

### 2c. `@visx/zoom` — Affine transform state manager (adapt)

Zoom manages a 2D affine matrix `{ scaleX, scaleY, translateX, translateY, skewX, skewY }` exposed via a render-prop:

```tsx
<Zoom width={width} height={height} scaleXMin={0.5} scaleXMax={10} constrain={myConstrain}>
  {(zoom) => (
    <svg
      onWheel={zoom.handleWheel}
      onMouseDown={zoom.dragStart}
      onMouseMove={zoom.dragMove}
      onMouseUp={zoom.dragEnd}
    >
      <g transform={zoom.toString()}>
        {/* content */}
      </g>
    </svg>
  )}
</Zoom>
```

`zoom.toString()` outputs `matrix(scaleX, skewY, skewX, scaleY, translateX, translateY)` — a valid CSS/SVG transform string. `applyToPoint()` / `applyInverseToPoint()` convert coordinates bidirectionally. The `constrain` callback intercepts every proposed new matrix and can veto it (revert to previous), enabling bounded panning.

**TensorScope relevance:** The spectrogram and spatial map could use this for smooth wheel-to-zoom interaction. However, the affine matrix approach conflicts with TensorScope's coordinate-semantic model (`timeWindow`, `freqRange`, AP/ML selection stored as domain values in `useSelectionStore`). The correct adaptation is: on `zoom.handleWheel`, compute the new domain bounds from the resulting matrix and write them back to the store rather than using the CSS transform directly. The `constrain` callback is the cleanest mechanism for enforcing data-range limits during pan/zoom.

### 2d. `@visx/event` `localPoint()` — SVG coordinate conversion (direct use)

`localPointGeneric` converts pointer events to SVG local coordinates using `svg.createSVGPoint()` + `screenCTM.inverse()` as the primary path, with a bounding-rect fallback for non-SVG elements:

```ts
// Primary: SVG matrix transform (handles CSS transforms, scales, rotations on ancestors)
const pt = svg.createSVGPoint();
pt.x = event.clientX;
pt.y = event.clientY;
const local = pt.matrixTransform(svg.getScreenCTM()!.inverse());

// Fallback: bounding box subtraction
x = coords.x - rect.left - node.clientLeft;
y = coords.y - rect.top - node.clientTop;
```

This correctly handles devicePixelRatio, CSS `transform` on parent elements, page scroll, and touch events. Bounding-rect subtraction — the common DIY alternative — breaks whenever a CSS transform is applied to an ancestor.

**TensorScope relevance:** Any custom SVG overlay (brush, hover crosshair, event marker click) placed on top of a Canvas view needs this coordinate conversion. It is a tiny package with no dependencies beyond `@visx/point`. Adopt it rather than reimplementing bounding-rect arithmetic.

### 2e. `@visx/xychart` DataProvider + data registry pattern (study, do not import)

The xychart package implements a centralized `DataRegistry` where each `<LineSeries>` / `<BarSeries>` registers its data key and accessor functions on mount and unregisters on unmount. `DataProvider` aggregates all registered series to auto-compute a unified domain for shared scales. Events flow through an `EventEmitterContext` with source-tagged filtering so a hover on one series only triggers intended subscribers. The nearest-datum algorithm uses `d3-bisect` against the inverted mouse coordinate for O(log n) lookup on sorted continuous data.

**TensorScope relevance:** TensorScope uses a different data-flow model (server-side slicing → Arrow IPC → per-view components). Importing xychart would create a second parallel data model. The registry pattern itself — where view components declare their data keys and a container auto-manages domain computation — is worth studying for a future multi-tensor overlay feature where two tensors share a time axis.

### 2f. `@visx/heatmap` `HeatmapRect` — 2D grid cells (study only)

`HeatmapRect` maps a 2D array of `{ bins: BinEntry[] }` columns through `xScale`, `yScale`, `colorScale`, and `opacityScale` to produce a grid of SVG `<rect>` elements, with a `children` render prop for custom cell output.

**TensorScope relevance:** TensorScope's spectrogram already renders on Canvas 2D, which is the correct choice for dense (time × freq) data. `HeatmapRect`'s SVG approach would create ~100,000 DOM nodes for a 500-column × 200-row spectrogram and would be unusable at that scale. The API design — accepting a `colorScale(count)` function per cell and separating opacity from color — is a clean interface pattern to mirror in any custom grid renderer.

---

## 3. Interaction / UX Ideas Worth Studying

### Brush with domain-value callbacks
The brush's `onChange` receives `Bounds` already converted to domain values via scale inversion, not raw pixels. This is the contract TensorScope needs: a time-range selection should always emit `{ t0, t1 }` in seconds. TensorScope's navigator achieves this via uPlot's `setSelect` hook, but for any custom overlay brush (spectrogram frequency selection, 2D region on spatial map), following this pattern — invert through the scale before emitting — avoids raw-pixel leakage into selection state.

### Linked crosshairs via EventEmitterContext
xychart's event bus emits pointer coordinates with a source tag; subscriber hooks filter by `allowedSources` to decide whether to react. This enables linked crosshairs across charts without a global store holding raw pixel positions. TensorScope's Zustand `timeCursor` serves the same purpose at the semantic level, but for within-view crosshair rendering (where pixel coords matter per frame), an emit+filter bus avoids re-rendering all views on every `mousemove`.

### Voronoi for non-grid electrode selection
Clicking on the spatial map could use Voronoi tessellation to route clicks to the nearest electrode even when the click misses the glyph itself. This removes the need for enlarged hit targets and handles crowded electrode regions gracefully.

### `constrain` callback to enforce domain limits during zoom
The Zoom component's `constrain` callback that can veto a proposed transform matrix is a clean pattern for "do not allow panning beyond data range" without imperative min/max clamping scattered through event handlers. The entire boundary constraint is co-located with the zoom component.

---

## 4. Engineering Patterns Worth Borrowing

### Render-prop for transform consumers
Both `@visx/zoom` and `@visx/brush` expose their state via render props, not by directly manipulating the DOM. The consumer decides where to put the transform — SVG `<g transform>`, Canvas `ctx.setTransform()`, or a Zustand store write. This is the correct architecture for TensorScope's mixed Canvas + SVG overlay model, where the interaction layer (SVG) and the rendering layer (Canvas) are separate elements.

### TypeScript `Bounds` type for selection output
```ts
type Bounds = {
  x0: number; x1: number; xValues?: unknown[];
  y0: number; y1: number; yValues?: unknown[];
}
```
Carrying both pixel coordinates and domain values in the same selection object avoids repeated scale inversions downstream. TensorScope's `timeWindow: [number, number]` stores domain values; for crosshair rendering, a combined type that also carries pixel position would simplify canvas draw calls that need both.

### O(log n) nearest-point with `d3-bisect` + scale inversion
```ts
const invertedX = scale.invert(mouseX);
const idx = bisector(accessor).left(data, invertedX);
// compare data[idx] and data[idx-1] for true nearest
```
For TensorScope's timeseries where the time axis is always sorted, this is the correct approach for cursor snap-to-nearest-sample, needed for a value readout tooltip on the timeseries view.

### `ParentSize` via ResizeObserver
`@visx/responsive`'s `ParentSize` wraps a `div` at `width: 100%; height: 100%` and uses a ResizeObserver to pass measured pixel dimensions to a render-prop child. This is cleaner than CSS `vw/vh` calculations and correctly handles panel resize events in a split-pane grid layout.

### Source-tagged event bus for within-view coordination
The `EventEmitterContext` pattern — emit with a string source, subscribe with an `allowedSources` filter — cleanly solves "hover on the timeseries should move the crosshair on the spectrogram but not vice-versa" without Zustand holding volatile per-frame mouse state. Worth adopting as a lightweight in-tree pub/sub for pointer events if TensorScope ever adds linked hover across multiple views.

---

## 5. Not a Good Fit for TensorScope

### visx SVG rendering for dense timeseries or spectrogram
All visx series components (`LineSeries`, `AreaSeries`, `BaseGlyphSeries`) render SVG `<path>` or `<circle>` elements. For a multichannel timeseries with 30 channels × 50,000 samples, SVG path rendering is an order of magnitude slower than uPlot's canvas loop. uPlot renders thousands of points per channel in a single Canvas 2D `lineTo` loop without creating any DOM nodes. This was confirmed directly: no Canvas rendering variant exists anywhere in the visx series component tree (`BaseLineSeries.tsx`, `BaseAreaSeries.tsx`). **Do not replace uPlot with visx for timeseries rendering.**

The spectrogram likewise requires Canvas 2D or WebGL. `HeatmapRect` would create ~100,000 `<rect>` DOM nodes for a 500-column × 200-row spectrogram, which would be unusable.

### xychart as a drop-in chart system
The full xychart stack (DataProvider + series components + EventEmitter + TooltipProvider + DataRegistry) is a self-contained chart system with its own scale management and data-flow conventions. It conflicts with TensorScope's existing architecture: server-side slicing, Arrow IPC deserialization, Zustand-driven selection state, and uPlot canvas rendering. Importing xychart would create a second parallel data model.

### Animation via `@visx/react-spring`
`AnimatedLineSeries` and `AnimatedBarSeries` use react-spring for data-transition animations. TensorScope has no need for data-transition animations in dense signal browsing; the data volume makes it impractical and the scientific context does not call for it.

### visx as a replacement for the CSS-grid spatial map
The current spatial map renders a regular `(AP, ML)` grid via CSS grid cells. `HeatmapRect` renders the same concept in SVG. For a regular grid, CSS is faster and easier to style. visx heatmap adds value only for irregular layouts or if a Voronoi overlay is needed on top — at which point `@visx/voronoi` alone suffices.

---

## 6. Top Recommendations for TensorScope

Compared to what was identified in the HiGlass and Neuroglancer studies, visx adds three genuinely new, actionable items:

**Recommendation 1: Adopt `@visx/voronoi` for spatial electrode hit-testing when electrode layout is irregular.**
The existing CSS-grid click handler works for regular `(AP, ML)` grids. When TensorScope gains support for arbitrary probe geometries (e.g., Neuropixels shank or custom multi-electrode array), replace the click handler with a Voronoi tessellation using `voronoi()` from `@visx/delaunay`. The hit-testing API (`layout.find(mouseX, mouseY, radius)`) is two lines and produces the nearest electrode datum without enlarged hit targets. Package: `@visx/delaunay` (transitively includes `d3-delaunay`).

**Recommendation 2: Use `@visx/event`'s `localPoint()` for SVG coordinate conversion in overlay components.**
TensorScope has custom Canvas overlays (event markers, crosshairs, spectrogram hover). Any SVG layer placed on top needs correct event-to-coordinate conversion. The `localPoint` function handles devicePixelRatio, CSS transforms, and touch events correctly via `createSVGPoint()` + `screenCTM.inverse()`. It is a tiny package. Adopt it rather than reimplementing bounding-rect arithmetic, which breaks when any ancestor has a CSS transform.

**Recommendation 3: Mirror the brush `Bounds` callback contract when building a frequency-range brush on the spectrogram.**
The spectrogram view will eventually need a brush for frequency selection (analogous to the navigator's time brush). Design its `onChange` callback to emit `{ t0, t1, f0, f1 }` in domain units (seconds, Hz) rather than pixel offsets — identical in spirit to visx's `Bounds` with domain values pre-computed via scale inversion. This is a design pattern to mirror, not a package to import.

---

## 7. Evidence

| Topic | File(s) | What it demonstrates |
|---|---|---|
| Brush props and callbacks | `packages/visx-brush/src/Brush.tsx`, `src/types.ts` | `onChange(Bounds \| null)`, `onBrushEnd`, `Bounds = { x0, x1, xValues?, y0, y1, yValues? }`, `ResizeTriggerAreas` union |
| Brush internal state | `packages/visx-brush/src/BaseBrush.tsx` | `{ start, end, extent, bounds, isBrushing, brushingType, activeHandle }`, `useWindowMoveEvents` option |
| Brush selected region rendering | `packages/visx-brush/src/BrushSelection.tsx` | SVG `<rect>` positioned from `brush.extent.x0/x1`; pointer events disabled during active brushing |
| Zoom transform matrix | `packages/visx-zoom/src/Zoom.tsx` | 6-component affine matrix; `constrain` callback vetoes proposed matrix; render-prop `zoom.toString()` = CSS `matrix(...)` |
| Zoom pan/wheel | `packages/visx-zoom/src/Zoom.tsx` | `dragStart/dragMove/dragEnd`, `handleWheel`, `handlePinch`; `scaleXMin/Max` bounds; `applyToPoint` / `applyInverseToPoint` |
| Voronoi hit-testing | `packages/visx-voronoi/src/index.ts`, `packages/visx-delaunay/src/index.ts` | `voronoi({ x, y, width, height })(data).find(x, y, radius)`; `VoronoiPolygon` component; `Polygon` render |
| SVG coordinate conversion | `packages/visx-event/src/localPointGeneric.ts` | `createSVGPoint()` + `screenCTM.inverse()` primary; bounding-rect fallback; touch support |
| xychart event bus | `packages/visx-xychart/src/hooks/useEventEmitter.ts` | Six event types; source-tagged emission; `allowedSources` filter; `EventEmitterContext` |
| DataRegistry pattern | `packages/visx-xychart/src/hooks/useDataRegistry.ts` | Mount-time `registerData`/`unregisterData`; `forceUpdate` on registry change; `get(key)`, `entries()` |
| xychart layered providers | `packages/visx-xychart/src/components/XYChart.tsx` | DataProvider → ParentSize → TooltipProvider → EventEmitterProvider; transparent pointer-capture overlay rect |
| Nearest-datum detection | `packages/visx-xychart/src/components/Tooltip.tsx` | `tooltipData.nearestDatum` from TooltipContext; `snapTooltipToDatumX/Y`; `distanceX`/`distanceY` in event params |
| LineSeries SVG only | `packages/visx-xychart/src/components/series/private/BaseLineSeries.tsx` | Uses `LinePath` → SVG `<path>`; no canvas path; invisible glyphs at every datum for focus events |
| AreaSeries SVG only | `packages/visx-xychart/src/components/series/private/BaseAreaSeries.tsx` | SVG-only confirmed; no Canvas variant |
| HeatmapRect SVG grid | `packages/visx-heatmap/src/heatmaps/HeatmapRect.tsx` | 2D `data → bins` loop → SVG `<rect>` per cell; `colorScale(count)` + `opacityScale(count)`; children render prop |
| Axis customization | `packages/visx-axis/src/axis/Axis.tsx` | Tick computation separated from rendering; `children` render prop for custom tick component; `orientation`, `numTicks`, `tickValues`, `tickFormat` |
| ParentSize ResizeObserver | `packages/visx-responsive/src/components/ParentSize.tsx` | ResizeObserver; render-prop `{ width, height, top, left, ref, resize }` |
| useTooltip hook | `packages/visx-tooltip/src/hooks/useTooltip.ts` | `{ tooltipOpen, tooltipLeft, tooltipTop, tooltipData, showTooltip, hideTooltip, updateTooltip }` |
| useDrag hook | `packages/visx-drag/src/useDrag.ts` | `{ x, y, dx, dy, isDragging, dragStart, dragMove, dragEnd }`; bounds restriction; `resetOnStart` |
| Annotation context | `packages/visx-annotation/src/components/Annotation.tsx` | Context provider for `{ x, y, dx, dy }`; consumed by Label/Connector/Subject children for data-anchored callouts |
| AnimatedLineSeries | `packages/visx-xychart/src/components/series/AnimatedLineSeries.tsx` | Wraps `BaseLineSeries` with `AnimatedPath`; react-spring animation is opt-in via a separate component |
| LinearGradient | `packages/visx-gradient/src/gradients/LinearGradient.tsx` | SVG `<linearGradient>` wrapper; `from`/`to` colors, `fromOffset`/`toOffset`, rotation; referenced by id from fill attribute |
