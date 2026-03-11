# Perspective — Reference Study

**Repo:** https://github.com/finos/perspective
**Version studied:** v4.3.0 (released 2026-03-11)
**Date:** 2026-03-11
**Focus:** Arrow data pipeline, streaming updates, plugin registry, session state — filtered for TensorScope relevance

---

## 1. Repo Overview

Perspective is an interactive analytics and data-visualization component built for large or streaming datasets. It is **not** a scientific signal browser — it is a general-purpose OLAP front-end with a high-performance query engine.

Key stack facts:
- **Engine:** C++ compiled to WebAssembly (primary), with Python and Rust native bindings.
- **Wire format:** Apache Arrow IPC throughout; Protocol Buffers (`perspective.proto`) as the client-server RPC layer.
- **Frontend shell:** Custom Elements (Web Components), not React. Layout via **Lumino** (the JupyterLab widget framework).
- **Languages by share:** C++ 35%, Rust 33%, TypeScript 18%, Python 3%.
- **Visualization backends:** `@finos/perspective-viewer-datagrid` (regular-table), `@finos/perspective-viewer-d3fc` (D3FC charts), `@finos/perspective-viewer-openlayers` (geo).

The architecture is dual-mode: queries run either inside the browser in a WASM worker, or remotely over a WebSocket against a Python/Node/Rust server. All data crosses the boundary as Arrow IPC.

---

## 2. Features Worth Borrowing

### 2a. `OptionalUpdate<T>` — three-state partial config DTO (direct borrow)

Perspective defines `ViewerConfigUpdate` alongside `ViewerConfig`. Every mutable field is wrapped in `OptionalUpdate<T>`:

```rust
pub struct ViewerConfigUpdate {
    pub plugin:       OptionalUpdate<String>,   // PluginUpdate alias
    pub title:        OptionalUpdate<String>,
    pub settings:     OptionalUpdate<bool>,
    pub theme:        OptionalUpdate<String>,
    pub table:        OptionalUpdate<String>,
    pub plugin_config: Option<PluginConfig>,
    pub view_config:  ViewConfigUpdate,
    ...
}
```

`OptionalUpdate<T>` is a three-variant enum:

| Variant | JSON wire | Meaning |
|---------|-----------|---------|
| `Missing` | field absent | no change — leave as-is |
| `SetDefault` | `null` | reset to default |
| `Update(T)` | explicit value | apply this value |

This is directly applicable to TensorScope's `TensorSliceRequestDTO`. Currently, when the user adjusts only `time_range`, the full DTO is re-sent including unchanged `spatial`, `freq`, `event` fields. An `OptionalUpdate`-style Pydantic model would let the server skip re-aggregating unchanged dimensions.

**File:** `rust/perspective-viewer/src/rust/config/viewer_config.rs`

### 2b. Plugin registry — import-side-effect registration (adapt)

Perspective plugins register themselves automatically as an import side effect:

```typescript
// extensions.ts
registerPlugin(name: string): Promise<void>
```

Calling `import "@finos/perspective-viewer-d3fc"` triggers registration with no explicit wiring. The viewer discovers plugins via `customElements.get("perspective-viewer").registerPlugin("my-plugin")`.

TensorScope's `viewRegistry.ts` already has `VIEW_DESCRIPTORS` + `getAvailableViews(schema)`. The side-effect pattern is worth adapting so future view modules (e.g. a connectivity matrix) register themselves by import rather than requiring manual `VIEW_DESCRIPTORS` entries.

**Files:** `rust/perspective-viewer/src/ts/extensions.ts`, `rust/perspective-viewer/src/ts/plugin.ts`

### 2c. `save()` / `restore()` on viewer elements (adapt)

Each Perspective plugin implements:

```typescript
interface IPerspectiveViewerPlugin {
    save():    Record<string, unknown>;  // serializable JSON
    restore(token: Record<string, unknown>): Promise<void>;
}
```

The top-level viewer aggregates these into a `ViewerConfig` via `get_viewer_config()` (Rust model). The workspace adds a further layer: `workspace.save()` traverses the Lumino dock layout and stores each viewer's slot name + its own `save()` output into a JSON tree:

```typescript
type PerspectiveLayout = PerspectiveSplitArea | PerspectiveTabArea
// PerspectiveTabArea.widgets is an array of slot names (strings)
```

TensorScope does not yet have a session-persistence API. The two-level pattern — plugin-local state via `save()`/`restore()` + workspace layout via a layout-tree JSON — maps directly: individual view configs (uPlot axes, colormap range, freq band) could be serialized by each view component, then aggregated into a workspace snapshot stored in the server session.

**Files:** `packages/viewer-datagrid/src/ts/plugin/save.ts`, `packages/viewer-datagrid/src/ts/plugin/restore.ts`, `packages/workspace/src/ts/workspace/workspace.ts`

### 2d. `draw()` vs `update()` two-phase render (direct borrow)

`IPerspectiveViewerPlugin` has two rendering entry points:

```typescript
draw(view: View):   Promise<void>;   // full initial render
update(view: View): Promise<void>;   // data changed, config unchanged
```

The Rust `Renderer` dispatches them through a `DebounceMutex`:

- **draw** acquires an exclusive lock: `draw_mutex.lock(task).await` — no coalescing.
- **update** acquires a debounced lock: `draw_mutex.debounce(task).await` — rapid successive updates are coalesced into one.

A `MovingWindowRenderTimer` tracks the last 5 frame durations and derives a dynamic throttle cap (max 5000 ms). Throttle mode can be set to a constant value or left in adaptive mode.

The D3FC plugin's `draw()` delegates immediately to `update(view, ..., clear=true)`, so a single `update()` path handles both cases — the `clear` flag controls whether to wipe state first.

**Application to TensorScope:** The spectrogram's Canvas 2D currently re-paints on every `useEffect` tick. Splitting into `draw` (full canvas setup + colormap scale) and `update` (append new time slice) would avoid redundant scale recalculation on pan.

**Files:** `rust/perspective-viewer/src/rust/renderer.rs`, `rust/perspective-viewer/src/rust/renderer/render_timer.rs`, `packages/viewer-d3fc/src/ts/plugin/plugin.ts`

---

## 3. Interaction / UX Ideas Worth Studying

### 3a. Staged rendering for off-screen views

The D3FC plugin checks `this.offsetParent === null` before rendering. If the element is hidden (e.g. in an inactive tab), it stores the view in `_staged_view` and defers actual rendering until `resize()` fires or visibility returns. This avoids wasted compute for panels that are not currently visible.

TensorScope's `spectrogram` and `psd_average` views render immediately regardless of viewport visibility. A staged-render guard (check `offsetParent` or use `IntersectionObserver`) would reduce wasted GPU work when multiple views are open.

**File:** `packages/viewer-d3fc/src/ts/plugin/plugin.ts`

### 3b. Lumino-based dockable workspace

`<perspective-workspace>` uses Lumino (`@lumino/widgets`) — the same framework JupyterLab uses — for its split-panel, tab-bar, and dock-panel layout. The layout tree serializes to a recursive `PerspectiveSplitArea | PerspectiveTabArea` JSON that can be saved and restored across sessions.

TensorScope currently uses a static `WorkspaceMain` grid. For M3+, if a full docking workspace is desired, Lumino is a well-tested option with an existing Perspective integration as a reference. However, adopting Lumino is a significant dependency; a lighter custom split-pane is probably sufficient for TensorScope's use case.

**Files:** `packages/workspace/src/ts/workspace/workspace.ts`, `packages/workspace/src/ts/workspace/dockpanel.ts`

### 3c. Settings proxy that fires updates on configuration change

The D3FC plugin wraps its `_settings` state in a `Proxy` that fires an update event whenever a configuration property changes, excluding "data" and "size" to avoid feedback loops. This enables reactive chart reconfiguration without manual event wiring.

Comparable to Zustand's selector subscriptions, but coarser — it fires on any property write. The pattern is useful if TensorScope adds per-view settings panels (colormap range, band filter) that need to feed back into the plugin's render state.

**File:** `packages/viewer-d3fc/src/ts/plugin/plugin.ts`

---

## 4. Engineering Patterns Worth Borrowing

### 4a. `UpdateData` enum — Arrow is one variant of a multi-format input union

Perspective's Rust client defines:

```rust
pub enum UpdateData {
    Arrow(Bytes),
    Csv(String),
    JsonRows(String),
    JsonColumns(String),
    Ndjson(String),
}
```

`table.update(input, options)` accepts any variant; the engine identifies the format via the enum tag. Arrow bytes are passed through directly as `make_table_data::Data::FromArrow(bytes)` in the protobuf request.

TensorScope already commits to Arrow IPC exclusively (via `arrow.ts`). The relevant take-away is not multi-format support, but the `UpdateOptions` struct:

```rust
pub struct UpdateOptions {
    pub port_id: Option<u32>,
    pub format:  Option<TableReadFormat>,
}
```

The `port_id` field lets the client tag an update with a channel identifier so that `on_update` callbacks can distinguish *which* update triggered them. This is directly applicable to TensorScope's multi-tensor session: when multiple tensors share a session, tagging slice responses with a source identifier would allow the frontend to route incremental Arrow payloads to the correct view.

**Files:** `rust/perspective-client/src/rust/table_data.rs`, `rust/perspective-client/src/rust/table.rs`

### 4b. Protobuf as the client-server RPC contract

Perspective uses a single `.proto` file (`perspective.proto`) as the canonical definition of every client-server operation: `MakeTableReq`, `TableUpdateReq`, `ViewToArrowReq`, `ViewOnUpdateReq`, etc. This keeps the Python server, Rust server, Node server, and browser client all in sync from one source of truth.

TensorScope uses Pydantic models (`server/models.py`) for the same purpose, which is equivalent in spirit. The relevant observation is that Perspective's `ViewToArrowReq/Resp` pattern — where the client requests a view slice and receives Arrow IPC — is architecturally identical to TensorScope's `/slice` endpoint. Perspective's design validates TensorScope's current approach.

**File:** `rust/perspective-client/perspective.proto`

### 4c. `DebounceMutex` for update coalescing

The renderer uses a custom `DebounceMutex` (not a standard Rust type) that distinguishes "lock for a full draw" from "lock with debounce for an update". Rapid successive `update()` calls are collapsed into one actual render. Full `draw()` calls bypass debouncing.

TensorScope's React Query already provides some request deduplication via `staleTime`, but has no render-level coalescing. If the spectrogram or multichannel timeseries receives rapid `on_update` events (e.g. from a live-stream), a debounce guard at the render boundary (not just the fetch boundary) would prevent frame-rate collapse.

**File:** `rust/perspective-viewer/src/rust/renderer.rs`

### 4d. Adaptive render throttle with `MovingWindowRenderTimer`

The timer maintains a sliding window of the last 5 render durations. If average frame time exceeds a threshold, it raises the throttle delay (up to 5000 ms). The throttle resets when the browser tab becomes hidden to avoid skewed timing.

This is more sophisticated than a fixed `setTimeout` debounce. For TensorScope's spectrogram (Canvas 2D path that can be expensive at high time resolution), an adaptive throttle based on measured paint duration would gracefully degrade under load without hard-coding a frame budget.

**File:** `rust/perspective-viewer/src/rust/renderer/render_timer.rs`

### 4e. `IntersectionObserver` + `ResizeObserver` as model-layer concerns

Perspective tracks element visibility (`intersection_observer.rs`) and size changes (`resize_observer.rs`) in the model layer, not in the view/component layer. This keeps rendering lifecycle decisions centralized rather than scattered across multiple component `useEffect` hooks.

TensorScope uses `ResizeObserver` inside individual components. Centralizing visibility/size tracking in a layout model (even a simple one) would simplify the spectrogram's current resize-then-redraw pattern.

**Files:** `rust/perspective-viewer/src/rust/model/intersection_observer.rs`, `rust/perspective-viewer/src/rust/model/resize_observer.rs`

---

## 5. Not a Good Fit for TensorScope

### 5a. WebAssembly query engine

Perspective's WASM engine exists to run OLAP aggregations (group-by, filter, pivot) in the browser without a server round-trip. TensorScope's compute happens in Python/cogpy on the server (FFT, PSD, downsampling). Moving compute to WASM would require reimplementing signal-processing pipelines in C++/Rust — not worthwhile.

### 5b. Lumino docking shell

Lumino is a full widget framework (156 kB gzipped) built for notebook-style interfaces. TensorScope's layout needs are simpler: a left NavRail, a main grid of views, and an inspector panel. Adopting Lumino would be significant over-engineering.

### 5c. Multi-format data ingestion (CSV, NDJSON, JSON rows/columns)

Perspective supports six input formats because it is a general-purpose analytics tool. TensorScope is Arrow-only by design — the server always emits Arrow IPC via `apply_slice_request`. Adding other formats would add complexity without benefit.

### 5d. Virtual server / DuckDB / ClickHouse integration

Perspective's virtual server abstraction lets it proxy SQL databases. TensorScope's data model is `xr.DataArray` tensors, not relational tables. The SQL gateway layer is irrelevant.

### 5e. Custom Elements / Web Components API

Perspective's plugin API is built on `HTMLElement` subclasses and `customElements.define()`. TensorScope uses React function components with hooks. Porting Perspective's plugin registration to React requires adapting the interface; the Web Component API itself is not reusable as-is.

---

## 6. Top Recommendations (new vs HiGlass/Neuroglancer studies)

These are patterns not covered by the HiGlass (tiled fetching, view sync) or Neuroglancer (reactive atoms, priority queues, typed events) studies.

**1. Adopt the `OptionalUpdate<T>` pattern in `TensorSliceRequestDTO`.**
Replace full-DTO re-sends with a Pydantic model that uses `Optional[T] = None` for each field, treating `None` as "no change" and a sentinel (or separate `reset` set) for "reset to default". The server `apply_slice_request` already has the right structure to apply only changed dimensions.

**2. Split view render into `draw()` + `update()` at the component boundary.**
Each view component should distinguish an initial setup phase (`draw`: allocate canvas, build scales, set axis labels) from an incremental data phase (`update`: paint new data, shift axis range). This is most impactful for the spectrogram and the multichannel timeseries where re-computing scales on every pan is expensive.

**3. Add a debounced render guard in each view component.**
Use a `useRef`-held debounce (or a custom `DebounceMutex`-inspired hook) to coalesce rapid `update()` calls. The fetch-layer deduplication via React Query is not sufficient if multiple store subscriptions trigger the same component in a single tick.

**4. Add `save()` / `restore()` to each view component.**
Follow the two-level pattern: each view exposes a `getViewState()` / `setViewState(token)` API (analogous to Perspective's plugin `save()`/`restore()`), and the session snapshot aggregates all view states plus the layout. This unblocks M3 session persistence with minimal surface area.

**5. Guard renders with `offsetParent` / `IntersectionObserver` check.**
Before calling expensive render paths (Canvas 2D spectrogram, uPlot full repaint), verify the element is visible. If not, store a "staged" flag and render on the next visibility change. This avoids wasted work when views are scrolled out of the viewport or in collapsed panels.

---

## 7. Evidence

| Topic | File(s) | What it demonstrates |
|-------|---------|----------------------|
| `OptionalUpdate<T>` three-state partial DTO | `rust/perspective-viewer/src/rust/config/viewer_config.rs` | `ViewerConfigUpdate` wraps each field in `OptionalUpdate<T>` with Missing/SetDefault/Update variants; enables minimal JSON patches |
| Plugin interface contract | `rust/perspective-viewer/src/ts/plugin.ts` | `IPerspectiveViewerPlugin` declares `draw(view)`, `update(view)`, `save()`, `restore()`, `clear()`, `resize()`, `delete()` as required methods |
| Side-effect plugin registration | `rust/perspective-viewer/src/ts/extensions.ts` | `registerPlugin(name)` called automatically on module import; no manual registry wiring |
| `draw()` vs `update()` dispatch + `DebounceMutex` | `rust/perspective-viewer/src/rust/renderer.rs` | `draw_mutex.lock()` for full draw, `draw_mutex.debounce()` for incremental update; `is_update` flag routes to `plugin.draw()` or `plugin.update()` |
| Adaptive render throttle | `rust/perspective-viewer/src/rust/renderer/render_timer.rs` | `MovingWindowRenderTimer` maintains 5-sample sliding window; throttle capped at 5000 ms; resets on tab hide |
| Plugin `save()` — datagrid | `packages/viewer-datagrid/src/ts/plugin/save.ts` | Returns `{columns: {col: {column_size_override}}, scroll_lock, edit_mode}` as deep-cloned JSON |
| Plugin `restore()` — datagrid | `packages/viewer-datagrid/src/ts/plugin/restore.ts` | Validates edit mode against `EDIT_MODES` list; applies via toggle methods; errors logged, not thrown |
| Workspace layout serialization | `packages/workspace/src/ts/workspace/workspace.ts` | `save()` traverses Lumino dock layout into `PerspectiveSplitArea | PerspectiveTabArea` tree keyed by slot name; `AsyncMutex` serializes concurrent save/restore |
| Lumino dock panel | `packages/workspace/src/ts/workspace/dockpanel.ts` | Extends `@lumino/widgets.DockPanel`; async `mapAreaWidgets()` traverses split/tab area tree |
| Arrow IPC as `UpdateData` variant | `rust/perspective-client/src/rust/table_data.rs` | `UpdateData::Arrow(Bytes)` → `make_table_data::Data::FromArrow(bytes)` in protobuf |
| `table.update()` with port tagging | `rust/perspective-client/src/rust/table.rs` | `UpdateOptions {port_id, format}` tags update with a channel ID; `on_update` callbacks receive the port ID |
| Proto RPC contract | `rust/perspective-client/perspective.proto` | Single source of truth for `MakeTableReq`, `TableUpdateReq`, `ViewToArrowReq`, `ViewOnUpdateReq` across all server implementations |
| Staged render for hidden elements | `packages/viewer-d3fc/src/ts/plugin/plugin.ts` | `draw()` checks `offsetParent === null`; stores `_staged_view` and defers until `resize()` |
| Settings proxy for reactive config | `packages/viewer-d3fc/src/ts/plugin/plugin.ts` | `_settings` wrapped in `Proxy`; write triggers update event, excludes "data"/"size" keys |
| Heatmap data shaping from View | `packages/viewer-d3fc/src/ts/data/heatmapData.ts` | Transforms `to_columns_string()` output into `{crossValue, mainValue, colorValue, row}` per cell; parses `"val1\|val2\|label"` composite keys |
| `IntersectionObserver` / `ResizeObserver` in model | `rust/perspective-viewer/src/rust/model/intersection_observer.rs`, `resize_observer.rs` | Visibility and size tracking owned by model, not scattered across view components |
| `ViewerConfig` full vs update structure | `rust/perspective-viewer/src/rust/model/get_viewer_config.rs`, `update_and_render.rs` | Full config aggregates session + renderer + presentation; `update_and_render()` accepts `ViewConfigUpdate` for incremental application |
