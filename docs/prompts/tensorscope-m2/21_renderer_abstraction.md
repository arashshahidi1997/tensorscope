# Prompt 21: Renderer Abstraction

Read first:

- [00_context.md](./00_context.md)
- [20_spatial_propagation.md](./20_spatial_propagation.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: introduce renderer abstraction.

Scope:

- Canvas renderer
- future WebGL renderer
- render pipeline separation

Implementation Tasks:

- define the minimum renderer interface required by M2 scientific views
- separate view logic from rendering backend concerns
- document how a CPU Canvas path remains primary while a future WebGL path stays optional
- keep the abstraction narrow enough to support current needs

Constraints:

- do not abstract away view semantics into a generic graphics framework
- do not make WebGL a prerequisite for M2
- keep current `uPlot` usage compatible with the architecture

Acceptance Criteria:

- views are decoupled from rendering backend
- Canvas can serve as the first renderer path
- future WebGL work can slot in without rewriting view semantics

Deliverables:

- prompt-ready renderer abstraction spec
- bounded implementation target for a future agent pass

## Reference

HiGlass's rendering boundary is the clearest production example of the pattern TensorScope needs: React owns the DOM structure and layout (container divs, panel headers, tool overlays); Pixi.js owns the canvas pixel content. React never re-renders the canvas elements — it only manages their container and passes props to track objects imperatively.

For TensorScope the same boundary applies: React manages panel layout, toolbars, and overlays; Canvas/WebGL manages waveform and heatmap pixels. The renderer abstraction should enforce this boundary explicitly — a view should not trigger a canvas repaint by updating React state. The `uPlot` path already respects this; the abstraction should make it the required contract for future renderers too.

See [docs/reference-studies/higlass.md §4 "Rendering Boundaries"](../../reference-studies/higlass.md).

Perspective's `IPerspectiveViewerPlugin` interface (`rust/perspective-viewer/src/ts/plugin.ts`) provides the most complete production example of a renderer abstraction contract:

```typescript
interface IPerspectiveViewerPlugin {
    draw(view: View):           Promise<void>;   // full initial render
    update(view: View):         Promise<void>;   // incremental data update
    clear():                    Promise<void>;   // wipe render state
    resize():                   Promise<void>;   // respond to container resize
    save():    Record<string, unknown>;          // serializable view state
    restore(token): Promise<void>;               // restore from saved state
    delete():  Promise<void>;                    // teardown
}
```

For TensorScope, the minimum contract for M2 canvas-backed views is: `draw(data: SliceDTO, ctx: CanvasRenderingContext2D)` + `update(data: SliceDTO, ctx: CanvasRenderingContext2D)` + `resize(width: number, height: number)`. The `save()`/`restore()` pair can be left as stub no-ops in M2 and filled in for M4 session persistence.

The `draw`/`update` split is the most important addition beyond the HiGlass boundary: the renderer abstraction must distinguish full setup from incremental paint to avoid redundant scale and label recomputation on each pan event.

See [docs/reference-studies/perspective.md §2d, §2c](../../reference-studies/perspective.md).

uPlot's under/over layer architecture (`src/domClasses.js`) makes the Canvas/DOM boundary explicit and concrete:

```
<div class="u-wrap">
  <canvas class="u-under" />      ← signal data (repaint only on data/scale change)
  <canvas class="u-over" />       ← mouse capture surface
  <div class="u-cursor-x" />      ← CSS-positioned crosshair: no canvas repaint
  <div class="u-cursor-y" />      ← CSS-positioned crosshair: no canvas repaint
  <div class="u-select" />        ← CSS-positioned selection rect: no canvas repaint
</div>
```

The crosshair lines, selection band, and cursor point are purely CSS `transform: translateX/Y` — they update at pointer speed without touching the canvas. TensorScope should adopt this layer structure as the required rendering boundary contract: never put the time cursor, selection band, or hover tooltip on the same canvas as the signal data.

uPlot's plugin/hooks system provides the composable overlay extension point:

```javascript
const eventOverlayPlugin = {
  hooks: {
    draw:      [(u) => { /* paint event markers onto u.ctx */ }],
    setCursor: [(u) => { /* update inspector tooltip on cursor move */ }],
    setSelect: [(u) => { /* handle drag-selected time window */ }],
  }
};
// opts.plugins = [eventOverlayPlugin, annotationPlugin, selectionPlugin]
// plugins compose by hook-array concatenation — no coupling between them
```

For TensorScope: event epoch bands, spike raster markers, and artifact annotations are each independent plugins injected via `opts.plugins`. They access `valToPos` to convert data coordinates to canvas pixels. Adding a new overlay type requires only a new plugin object — no changes to the base chart.

nivo's layer array pattern provides the React-level equivalent for SVG views:

```typescript
// Per-view LayerId union — explicit, tree-shakeable
type TimeSeriesLayerId = 'grid' | 'axes' | 'signals' | 'events' | 'crosshair' | 'selection';

// layers prop controls render order and allows injection of custom layers
<TimeSeriesView
  layers={['grid', 'axes', 'signals', 'events', customAnnotationLayer, 'crosshair']}
/>
```

Named layers are pre-built elements; function layers receive `customLayerProps` (scales, inner dimensions, data) and render arbitrarily. This is the correct React-side composability mechanism for views that mix standard axes with domain-specific overlays. Define `LayerId` unions per view type and expose a `layers` prop from the start.

See [docs/reference-studies/uPlot.md §2.2, §4.3, §4.4](../../reference-studies/uPlot.md) and [docs/reference-studies/nivo.md §2C, §2E, §4](../../reference-studies/nivo.md).
