# Prompt 31: Channel Grid Renderer

Read first:

- [00_context.md](./00_context.md)
- [30_spatial_layout_model.md](./30_spatial_layout_model.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: create a reusable `ChannelGridRenderer`.

Scope:

- render electrodes as grid cells
- color cells by signal value
- hover highlighting

Implementation Tasks:

- define the reusable renderer boundary for spatial grid views
- specify how signal values map to cell colors
- define hover-highlighting behavior
- keep the renderer aligned with the spatial layout model

Constraints:

- must work using Canvas first
- must be compatible with future WebGL acceleration
- do not couple renderer logic directly to other views

Acceptance Criteria:

- electrode grid renders correctly and updates with new data
- color mapping and hover behavior are explicit
- the renderer can evolve behind a later backend abstraction

Deliverables:

- prompt-ready renderer contract for channel-grid rendering
- bounded implementation target for one agent run

## Reference

Observable Plot's `Raster` mark (`src/marks/raster.js`) provides two patterns directly applicable to the `ChannelGridRenderer`:

**Nearest-neighbor interpolation via Delaunay triangulation**: for irregular electrode layouts (probes that do not form a perfect rectangular grid), Plot's `interpolate: "nearest"` mode computes a Voronoi partition from electrode positions and fills each pixel with the value of its nearest electrode. The Delaunay triangulation is computed once at construction and cached via `memoize1`. TensorScope's `ChannelGridRenderer` should adopt the same: build a `Delaunay` from electrode `(AP, ML)` positions at mount time, use it for both hit-testing (which electrode did the user hover?) and interpolated heatmap fill. This replaces the current CSS grid approach with a Canvas-based renderer that handles irregular probe geometries.

**Hexbin as screen-space adaptive aggregation** (`src/transforms/hexbin.js`): when the grid panel is very small (e.g., 100×100px) and electrode count is high (256+), individual 1px cells become invisible. Plot's hexbin initializer operates in pixel space after scale projection — it partitions electrodes into hexagonal bins sized to the panel's pixel dimensions, computes a reducer per bin (`mean`, `max`, etc.), and labels centroids in data space. TensorScope should implement the same as a "density mode" for the channel grid: when `cellSizePx < threshold`, switch to hexbin aggregation using whichever feature channel (power, rate) is currently selected as the color dimension.

See [docs/reference-studies/observable-plot.md §2.3, §4.3](../../reference-studies/observable-plot.md).

Also see [docs/reference-studies/visx.md §2.1](../../reference-studies/visx.md) for `@visx/delaunay` Voronoi hit-testing for irregular electrode hit targets.

deck.gl provides a higher-level alternative for the full spatial map when CSS-grid is insufficient:

**`OrthographicView` + `ScatterplotLayer`** (`modules/core/src/views/orthographic-view.ts`, `modules/layers/src/scatterplot-layer/`): each electrode is a GPU-rendered circle; `getFillColor` is driven by the amplitude/power accessor; `updateTriggers: { getFillColor: [timeCursor] }` re-evaluates the accessor without rebuilding position arrays; `radiusUnits: 'pixels'` keeps marker size constant across zoom. Handles Neuropixels and Utah array geometries without `grid-template` workarounds.

**Color-encoded picking** (`modules/core/src/lib/picking/`): O(1) hit-test returning `PickingInfo.object` (the electrode record). Wire `onClick` → `setSelectedElectrode(info.object.id)` in `useSelectionStore`.

**Binary `data.attributes`**: pass Arrow `Float32Array` views from `frontend/src/api/arrow.ts` directly to `data.attributes.getPosition` / `data.attributes.getFillColor` — skip the per-frame JS object array allocation.

See [docs/reference-studies/deck-gl.md §2.1, §2.2, §2.6, §2.7](../../reference-studies/deck-gl.md).
