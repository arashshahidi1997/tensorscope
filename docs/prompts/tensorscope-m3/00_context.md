# TensorScope M3 Context

Use this file as the shared context preamble for M3 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope-m2/README.md](../tensorscope-m2/README.md)

## Relationship to previous milestones

- M1 establishes the architectural spine: shared navigation state, shell boundaries, linked overview/detail behavior.
- M2 adds scalable data access and core scientific views.
- M3 builds on both by introducing spatial exploration of neural activity over electrode geometry.

## Architectural assumptions

- TensorScope still has four layers: Domain, Server/API, Workspace shell, and Views.
- Shared navigation state remains the coordination mechanism.
- Views must not call each other directly.
- Navigation state, view-local state, and processing state stay distinct.

## Spatial visualization goals

M3 introduces spatial exploration of spatiotemporal structure, including:

- electrode geometry
- spatial activity maps
- propagation animations
- phase and power maps
- spatial brushing and selection
- event-centered spatial dynamics

## Rendering policy

- CPU-first rendering remains required.
- Spatial views should start with Canvas-capable paths.
- GPU acceleration is future optional acceleration, not a requirement for correctness or basic usability.

## Guardrails for spatial views

- spatial views must integrate with shared `SelectionState` rather than inventing a parallel coordination model
- spatial linking should happen through shared state and shared contracts
- hot hover, scrub, and animation paths must avoid React rerender loops
- renderer abstractions must preserve a fully functional CPU path

## Reference studies

[docs/reference-studies/higlass.md](../../reference-studies/higlass.md) contains a HiGlass analysis. Sections §2.3 (`ViewportTracker2D`) and §2.8 (2D brush) are directly relevant to spatial selection and viewport projection overlays in M3.

[docs/reference-studies/neuroglancer.md](../../reference-studies/neuroglancer.md) contains a Neuroglancer analysis. Two M3-relevant patterns: (1) `EventActionMap` + named keyboard actions (`src/ui/default_input_event_bindings.ts`) — M3 spatial navigation (animation scrubbing, channel cycling, layout switching) should use named actions (`"time-scrub-forward"`, `"layout-toggle"`) rather than hardcoded key handlers, so bindings are rebindable and discoverable; (2) `AnnotationLayerView` — spatial event overlays (electrode-level annotations, propagation markers) should follow the same typed first-class state pattern established in M2's event browser.

[docs/reference-studies/observable-plot.md](../../reference-studies/observable-plot.md) contains an Observable Plot analysis. Three M3-relevant patterns: (1) `Raster` mark `interpolate: "barycentric"` / `"nearest"` — smooth spatial heatmaps from irregular electrode positions using Delaunay triangulation, directly applicable to `ChannelGridRenderer` and phase/power maps; (2) hexbin as screen-space initializer (`src/transforms/hexbin.js`) — adaptive aggregation when electrode density exceeds pixel resolution, operating in pixel space after scale projection; (3) cyclical vs. sequential color scale distinction — phase maps require cyclical colormaps, power maps require sequential; this should be encoded in feature-layer metadata.

[docs/reference-studies/visx.md](../../reference-studies/visx.md) contains a visx analysis. M3-relevant: `@visx/delaunay` Voronoi for irregular electrode hit-testing — produces SVG `<path>` regions per electrode suitable for hover and click without per-pixel distance scanning.

[docs/reference-studies/jupyterlab.md](../../reference-studies/jupyterlab.md) contains a JupyterLab frontend analysis (kernel/backend excluded). One M3-relevant pattern: `@lumino/commands` `CommandRegistry` — the concrete npm implementation of Neuroglancer's `EventActionMap` concept. Install as a standalone dependency; register M3 spatial navigation actions (`tensorscope:animation-play`, `tensorscope:animation-step-forward`, `tensorscope:layout-toggle`) as named commands with `isEnabled` guards and selector-scoped keybindings. This makes M3 keyboard bindings rebindable and testable in isolation, consistent with M3's guardrail against hardcoded key handlers.

[docs/reference-studies/deck-gl.md](../../reference-studies/deck-gl.md) contains a deck.gl analysis. Four M3-relevant patterns: (1) `OrthographicView` + `ScatterplotLayer` — drop-in replacement for the CSS-grid electrode map that handles non-uniform probe geometries; (2) `DataFilterExtension` — GPU-side spatial brushing where `filterRange` maps directly to `SelectionState.spatial`; (3) layer `transitions` prop — GPU-interpolated `getFillColor` between time snapshots for propagation animations without a custom `rAF` loop; (4) color-encoded picking — O(1) hit-testing for click-to-select regardless of electrode density. Anti-patterns to avoid: `HeatmapLayer` (wrong model for discrete electrodes), full `deck.gl` meta-package (install `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/react`, `@deck.gl/extensions` only).

## M3 success condition

Users can explore how activity propagates across electrodes through linked spatial views without breaking the earlier milestone architecture.
