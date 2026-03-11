# Prompt 33: Phase And Power Maps

Read first:

- [00_context.md](./00_context.md)
- [31_channel_grid_renderer.md](./31_channel_grid_renderer.md)
- [32_spatial_selection.md](./32_spatial_selection.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)

Goal: visualize spatial maps of signal features.

Scope:

- band power
- phase maps
- feature overlays

Implementation Tasks:

- define the view/data contract for spatial feature maps
- specify how band power and phase values map onto spatial layouts
- define overlay behavior for derived feature layers
- keep updates tied to the active time window and shared navigation state

Constraints:

- do not treat derived feature maps as unrelated to the shared selection model
- keep feature-layer semantics explicit
- preserve a CPU-first rendering path

Acceptance Criteria:

- spatial heatmaps update based on time window
- band power and phase mapping rules are explicit
- overlays fit within the existing spatial renderer direction

Deliverables:

- scoped prompt for spatial feature-map implementation
- explicit derived-feature mapping contract


## Reference

Observable Plot's `Raster` mark (`src/marks/raster.js`) is the strongest available reference for spatial heatmap rendering from irregular point data:

**Barycentric interpolation mode**: for phase maps — where phase wraps cyclically and spatial gradients are meaningful — Plot's `interpolate: "barycentric"` mode fills each pixel by interpolating within Delaunay triangles using barycentric weights. This produces smooth gradients across electrodes without grid assumptions. For TensorScope's phase maps, this is more appropriate than the "nearest electrode wins" approach used for discrete power maps.

**`imageRendering: "pixelated"`**: for power maps where each electrode's contribution should fill a discrete region with a hard boundary (no browser bilinear blur between electrode territories), set `canvas.style.imageRendering = "pixelated"` on the heatmap canvas. This is the same pattern as the spectrogram (`15_spectrogram_view.md`).

**Color scale `cyclical` type**: phase values are angles in `[0, 2π)`. Plot's `ScaleOptions` includes a `cyclical` scale type (maps to `d3.interpolateRainbow` or a custom circular colormap). The power maps use `sequential` (one-sided), while phase maps require a `cyclical` colormap — this distinction should be explicit in the feature-layer metadata: `{ featureType: "power", colorScale: "sequential" }` vs. `{ featureType: "phase", colorScale: "cyclical" }`.

See [docs/reference-studies/observable-plot.md §2.3, §4.1](../../reference-studies/observable-plot.md).
