# TensorScope M2 Context

Use this file as the shared context preamble for M2 tasks.

Read first:

- [../README.md](../README.md)
- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../tensorscope/11_m1_integration.md](../tensorscope/11_m1_integration.md)

## Architecture summary

TensorScope is organized around four layers:

- Domain
- Server/API
- Workspace shell
- Views

Shared navigation state remains the coordination mechanism across views.

Views must not call each other directly.

## M1 outcome

M1 establishes the architectural spine:

- backend tensor/session API
- workspace shell
- initial linked views
- navigator/detail pattern
- `uPlot` timeseries foundation
- prompt/docs structure for bounded agent work

M1 does not finish scalable data access or the full scientific view set.

## Purpose of M2

M2 extends TensorScope from an architectural prototype into a scalable scientific workspace.

Primary goals:

- interactive handling of larger recordings
- chunked and asynchronous data access
- LOD-aware rendering for overview and detail views
- real scientific views such as spectrogram, channel grid, peri-event views, and event browser
- cross-view cursor linking
- early renderer abstraction that stays CPU-first

## Guardrails

- shared navigation state remains the cross-view contract
- keep navigation state, view-local state, and processing state separate
- rendering hot paths must avoid React rerender loops
- CPU-first rendering is required
- GPU acceleration is optional future work, not a baseline requirement
- data access layers should avoid forcing full tensor loads into views
- keep each M2 task scoped to one implementation step

## Reference studies

[docs/reference-studies/higlass.md](../../reference-studies/higlass.md) contains a detailed analysis of HiGlass (a production tiled genomic browser). The domain parallel is strong: both systems deal with dense scientific arrays sliced into viewport-relevant windows with synchronized multi-view navigation. Relevant sections are linked from individual M2 prompts.

[docs/reference-studies/neuroglancer.md](../../reference-studies/neuroglancer.md) contains a detailed analysis of Neuroglancer (a WebGL volumetric viewer in TypeScript without React). Its rendering stack is not portable, but its state design and interaction semantics are directly instructive: priority-tiered data fetching, typed event annotations as first-class state, serializable state slices, and named-action keyboard bindings. Relevant sections are linked from individual M2 prompts.

[docs/reference-studies/observable-plot.md](../../reference-studies/observable-plot.md) contains an analysis of Observable Plot (grammar-of-graphics library). Not a candidate for replacing uPlot (no canvas line renderer, no brush/zoom). Three M2-relevant patterns: (1) transform/initializer split — clarifies that canvas-width-aware adaptive decimation is a client-side initializer step, not a server concern (linked from `13_lod_pipeline.md`); (2) `apply`/`invert` scale objects — explicit client-side scale contracts enable testable click-to-select coordinate conversion on the spectrogram canvas (linked from `15_spectrogram_view.md`); (3) WeakMap pointer state + `rAF` batching — avoids React re-render loops for 60fps crosshair updates across multiple views (linked from `17_linked_crosshair.md`).

[docs/reference-studies/perspective.md](../../reference-studies/perspective.md) contains a Perspective analytics tool analysis. Three M2-relevant patterns: (1) `OptionalUpdate<T>` partial DTO — tag optional fields so the server skips re-aggregating unchanged dimensions (linked from `12_data_source.md`); (2) `draw()` / `update()` two-phase render with `DebounceMutex` coalescing — split full canvas setup from incremental data paint; debounce rapid update calls at the render boundary, not just at the fetch boundary (linked from `15_spectrogram_view.md` and `21_renderer_abstraction.md`); (3) staged render guard — `offsetParent` / `IntersectionObserver` check before painting; defer render when view is in a hidden tab or collapsed panel.

[docs/reference-studies/jupyterlab.md](../../reference-studies/jupyterlab.md) contains a JupyterLab frontend analysis (kernel/backend patterns explicitly excluded). Two M2-relevant patterns: (1) `@lumino/commands` `CommandRegistry` — a standalone npm package that provides named actions with `isEnabled`/`isToggled` guards, selector-scoped keybindings, and a `commandChanged` signal that drives toolbar button state without manual `useState`; this is the right backbone for `ChartToolbar` and keyboard navigation once M2 views are in place; (2) `InspectorPanel` via `FocusTracker` / `WidgetTracker` — each view registers with a shared focus tracker on mount; `currentChanged` drives the inspector panel to swap content; eliminates the need for `InspectorPanel` to enumerate every view type. Not applicable: Lumino `Widget` class hierarchy, `SessionContext`, `DocumentRegistry` — all require abandoning React component model.

[docs/reference-studies/uPlot.md](../../reference-studies/uPlot.md) contains a deep analysis of uPlot (the Canvas timeseries library TensorScope already uses). Four M2-relevant patterns: (1) named sync bus (`src/sync.js`) — keyed pub/sub registry that cross-links chart panels without direct coupling; adapt as `SyncBusContext` with `uPlot.sync("tensorscope")` key for linked time cursor across all views (linked from `17_linked_crosshair.md`); (2) under/over layer model (`div.u-over`, `div.u-cursor-x/y`) — CSS-positioned cursor and selection overlays update at pointer speed without canvas repaints; required rendering boundary contract for M2 (linked from `21_renderer_abstraction.md`); (3) plugin/hooks system (`opts.plugins = [{ hooks: { draw, setCursor, setSelect } }]`) — composable overlay plugins that inject into the render cycle without coupling (linked from `21_renderer_abstraction.md`); (4) `cursor.lock` + `cursor.drag.setScale` — cursor lock for inspection mode, drag.setScale toggle for zoom-vs-select toolbar modes (linked from `17_linked_crosshair.md`).

[docs/reference-studies/nivo.md](../../reference-studies/nivo.md) contains an analysis of the nivo React visualization library. Three M2-relevant patterns: (1) layer array pattern (`layers: (LayerId | CustomLayer)[]`) — each view exposes composable named and custom layers; define `LayerId` unions per view type; directly applicable to TensorScope's renderer abstraction (linked from `21_renderer_abstraction.md`); (2) annotation pipeline (`AnnotationMatcher → BoundAnnotation → ComputedAnnotation`) — three-stage declarative pipeline that separates event matching (data space) from geometry computation (pixel space); both SVG and Canvas renderers consume the same output; applicable to event overlay and event browser (linked from `18_event_browser.md`); (3) split Actions/State tooltip context (`TooltipActionsContext` / `TooltipStateContext`) — write context separate from read context to avoid re-rendering the full tree on every pointer event; model for TensorScope's `SelectionActionsContext` / `SelectionStateContext`.

## M2 success condition

Large recordings remain interactive while TensorScope gains real linked scientific views without breaking the M1 architectural boundaries.
