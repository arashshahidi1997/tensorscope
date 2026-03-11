Now I have a comprehensive picture of the repository. Let me compile the full analysis.

---

## Neuroglancer as a Reference for TensorScope: Full Analysis

---

### 1. Repo Overview

**What this app is:**
Neuroglancer is a **WebGL-based, client-side volumetric data viewer** for connectomics and microscopy neuroscience. It renders multi-terabyte 3D image volumes, segmentation masks, and annotations interactively in the browser. It is architecturally mature — built entirely in TypeScript (no React), with a custom reactive state system, a WebWorker-based chunk streaming pipeline, multi-panel linked navigation, and a Python integration layer for notebook-driven workflows.

**Why it is a strong reference for TensorScope:**
- Both tools are scientific visualization products in neuroscience, requiring linked multi-panel views, dense data navigation, annotation/event overlays, and inspection sidebars
- Both have a Python backend supplying data and a browser frontend owning interaction and rendering
- Neuroglancer has solved at scale many of the exact problems TensorScope will face: linked selection state, windowed data fetching, view synchronization, keyboard-driven navigation, and session persistence via URL state

It is not a perfect match — Neuroglancer is fundamentally a **3D volumetric viewer** built without React, while TensorScope is a **2D+time tensor/signal viewer** to be built with React + Vite. The rendering stack (WebGL shaders, WebWorker pipeline, custom reactive state) is not directly portable. But the **interaction semantics, state design, and UX patterns** are directly instructive.

---

### 2. Features Worth Borrowing

---

#### 2.1. `TrackableValue` / `WatchableValue` — Observable State Atoms

**Where it lives:**
```typescript name=src/trackable_value.ts url=https://github.com/google/neuroglancer/blob/78ad594cb03238125f03b686b0593873805fdb90/src/trackable_value.ts#L27-L146
```

**Why valuable:** Every mutable piece of state is wrapped in a `TrackableValue<T>` or `WatchableValue<T>` that emits a `changed` signal. Derived values compose via `makeDerivedWatchableValue`. This is a typed, lightweight, composable reactive state graph — without Redux boilerplate. Every slider, position, zoom factor, and boolean flag participates in the same system.

**For TensorScope:** The core insight is having a **single reactive state atom type** for all session state. TensorScope can implement an equivalent with Zustand slices or custom React context + `useSyncExternalStore`, but the value is the **design pattern** — every piece of `TensorScopeState` (active tensor, time selection, AP/ML selection, zoom, event overlays) should be a typed, subscribable value that any panel can observe.

**Borrow: Adapt** — adopt the pattern in React idiom (Zustand atoms or Jotai atoms), not the class-based implementation.

---

#### 2.2. `LinkedViewerNavigationState` — Three-Mode View Linking

**Where it lives:**
```typescript name=src/layer_group_viewer.ts url=https://github.com/google/neuroglancer/blob/78ad594cb03238125f03b686b0593873805fdb90/src/layer_group_viewer.ts#L160-L274
```
```typescript name=src/navigation_state.ts url=https://github.com/google/neuroglancer/blob/78ad594cb03238125f03b686b0593873805fdb90/src/navigation_state.ts#L44-L152
```

**Why valuable:** Each panel's navigation state (position, zoom, orientation) has an explicit **link mode** — `LINKED`, `RELATIVE`, or `UNLINKED`. When linked, all panels move together. When relative, panels maintain an offset. When unlinked, panels are independent. This is implemented as a pure TS reactive class, propagating changes bidirectionally via `makeLinked()`.

**For TensorScope:** TensorScope needs exactly this for **time cursor linking** (all panels see the same time window), **channel selection linking**, and **AP/ML selection linking**. The three-mode design (linked / relative / unlinked) is a strong UX primitive that is directly applicable to time selection across a multichannel timeseries view and a spatial map view.

**Borrow: Adapt** — the three-mode linking enum and the bidirectional propagation logic are directly translatable into Zustand or React context. The `NavigationLinkType.RELATIVE` mode is especially valuable for TensorScope's potential multi-session or multi-animal comparison workflows.

---

#### 2.3. URL Hash State Persistence

**Where it lives:**
```typescript name=src/ui/url_hash_binding.ts url=https://github.com/google/neuroglancer/blob/master/src/ui/url_hash_binding.ts
```
```typescript name=src/ui/state_editor.ts url=https://github.com/google/neuroglancer/blob/master/src/ui/state_editor.ts
```

**Why valuable:** The entire viewer state is serialized to/from the URL hash (`#!{...}`). Every panel position, layer visibility, zoom level, and selected object is round-trippable via a URL. This enables shareable links, browser back/forward navigation, and session recovery. The `CompoundTrackable` / `TrackableViewerState` pattern ensures that every child state contributes to a single JSON-serializable root.

**For TensorScope:** Session state (active tensor, time window, selected channels, event overlays) should serialize to URL or to a session API endpoint. Neuroglancer shows a clean way to do this: every part of state implements `toJSON()` / `restoreState()`, and the root `TrackableViewerState` composes them. TensorScope's FastAPI backend `session state` API is exactly the target for this.

**Borrow: Directly** — the pattern of `CompoundTrackable` composing child `Trackable` pieces into a single JSON root is a high-value architecture lift.

---

#### 2.4. `ChunkManager` — Priority-Tiered Windowed Data Fetching

**Where it lives:**
```typescript name=src/chunk_manager/base.ts url=https://github.com/google/neuroglancer/blob/78ad594cb03238125f03b686b0593873805fdb90/src/chunk_manager/base.ts#L11-L121
```
```typescript name=src/chunk_manager/frontend.ts url=https://github.com/google/neuroglancer/blob/78ad594cb03238125f03b686b0593873805fdb90/src/chunk_manager/frontend.ts#L357-L458
```

**Why valuable:** Chunks are tracked with a **priority tier** (`VISIBLE`, `PREFETCH`, `RECENT`) and a lifecycle state machine (`QUEUED → DOWNLOADING → SYSTEM_MEMORY → GPU_MEMORY`). The backend WebWorker manages all fetch queuing and decompression; the main thread only draws what is ready. The system gracefully degrades when data is still loading — the UI never blocks.

**For TensorScope:** TensorScope's backend must serve windowed tensor slices. The critical insight from Neuroglancer is: **the frontend should always have something to render**, even if incomplete, and data arrives in a prioritized background pipeline. TensorScope's React frontend should have an equivalent of `visibleChunksAvailable / visibleChunksNeeded` to show loading progress bars per-panel, and windowed slice requests should be cancelled/reprioritized as the user navigates.

**Borrow: Adapt** — TensorScope doesn't need WebWorkers; the priority-tiered cancellable fetch queue pattern can be implemented with React Query + `AbortController` on the FastAPI backend requests.

---

#### 2.5. `DataSourceRegistry` — Plugin-Based Data Source Registration

**Where it lives:**
```typescript name=src/datasource/index.ts url=https://github.com/google/neuroglancer/blob/78ad594cb03238125f03b686b0593873805fdb90/src/datasource/index.ts#L188-L310
```
```typescript name=src/datasource/default_provider.ts url=https://github.com/google/neuroglancer/blob/78ad594cb03238125f03b686b0593873805fdb90/src/datasource/default_provider.ts
```

**Why valuable:** New data sources are registered via `registerProvider(new DataSourceProvider())` — side-effect imports at startup. The registry maps URL scheme → provider, where each provider implements a `get()` method returning a normalized `DataSource`. Adding Zarr, NIfTI, DVID, or BrainMaps support requires only implementing the interface and calling `register`.

**For TensorScope:** TensorScope needs to support NWB, Zarr, proprietary electrophysiology formats, etc. A registry pattern on the **Python backend** (FastAPI routes per data adapter) following this same interface-based design would let TensorScope be extended without modifying core code. The frontend only needs to know about the `TensorMetadata` shape the backend returns, not the format specifics.

**Borrow: Adapt** — implement an equivalent `DataSourceRegistry` in the FastAPI layer. Each adapter implements `load(path) → TensorMetadata + iterator`.

---

#### 2.6. `EventActionMap` + `default_input_event_bindings.ts` — Layered Keyboard Bindings

**Where it lives:**
```typescript name=src/ui/default_input_event_bindings.ts url=https://github.com/google/neuroglancer/blob/78ad594cb03238125f03b686b0593873805fdb90/src/ui/default_input_event_bindings.ts
```

**Why valuable:** Neuroglancer maps keyboard/mouse events to named actions (e.g., `"arrowleft"` → `"x-"`, `"keyz"` → `"snap"`). Event handling is separated from action semantics — the same action `"z-"` could be triggered by keyboard, mouse, or programmatically. This allows easy rebinding and context-sensitive keymaps (different bindings for perspective vs. slice views). Tools (annotation mode, selection mode) layer on top via `parents` inheritance.

**For TensorScope:** Dense signal navigation requires serious keyboard support — arrow keys for time step, Shift+arrow for page navigation, number keys for channel selection, space for play/pause. The `EventActionMap` pattern of decoupling "which key" from "what action" is exactly the right abstraction. TensorScope should define named actions (`"time-next"`, `"channel-toggle-1"`, etc.) and map keys to them, not hardcode keyboard handlers.

**Borrow: Adapt** — implement a named-action event system. React's `useEffect` + `document.addEventListener` is the base, but action namespacing should be adopted from Neuroglancer's pattern.

---

#### 2.7. `AnnotationLayerView` + Annotation Type Registry — Overlays on Views

**Where it lives:**
```typescript name=src/ui/annotations.ts url=https://github.com/google/neuroglancer/blob/78ad594cb03238125f03b686b0593873805fdb90/src/ui/annotations.ts#L384-L402
```
```typescript name=src/annotation url=https://github.com/google/neuroglancer/tree/master/src/annotation
```

**Why valuable:** Annotations (points, lines, bounding boxes, ellipsoids) are typed, serializable, and composable with layer state. They render on top of data panels and have their own side panel list view (filtering, selection, deletion). Each annotation type is registered (like data sources) and has its own render handler. Annotation selection is linked to the global `selectionDetailsState`.

**For TensorScope:** Event markers (spikes, LFP events, behavioral events) are TensorScope's equivalent of annotations. The Neuroglancer model — typed event objects + a side panel list + overlay rendering on the signal view + selection state propagation — is directly applicable. The critical pattern is that **events are first-class state objects**, not ad hoc rendering artifacts.

**Borrow: Adapt** — define a typed `EventAnnotation` interface in TensorScope with `{ time, channel, type, metadata }`, register event types, render overlays in Canvas/SVG, and connect to a side panel list.

---

#### 2.8. `LayerSidePanel` / `SelectionDetailsPanel` — Inspector Sidebars

**Where it lives:**
```typescript name=src/ui/layer_side_panel.ts url=https://github.com/google/neuroglancer/blob/master/src/ui/layer_side_panel.ts
```
```typescript name=src/ui/selection_details.ts url=https://github.com/google/neuroglancer/blob/master/src/ui/selection_details.ts
```

**Why valuable:** Side panels are resizable, dockable, and driven by selection state. They show different tabs (rendering options, data sources, annotations) depending on the active layer type. The `SelectedLayerState` in viewer state controls which panel is open and what layer is focused. Side panels subscribe to the reactive state tree and re-render only on relevant changes.

**For TensorScope:** TensorScope needs an inspector panel that shows tensor metadata, channel properties, event details, and statistical summaries for the selected time/channel window. The Neuroglancer side panel architecture (driven by selection state, tab-based, lazy-rendered) is the right model.

**Borrow: Adapt** — implement as React tabs/drawers whose content is driven by `TensorScopeState.activeTensor` and `globalSelectionState`.

---

### 3. Interaction / UX Ideas Worth Studying

---

#### 3.1. Three-Mode Navigation Linking (Linked / Relative / Unlinked)
The `NavigationLinkType` enum with LINKED, RELATIVE, UNLINKED is the single most useful UX idea in this repo for TensorScope. For TensorScope's linked timeseries + spatial map views, the ability to say "these two panels share a time cursor" (LINKED), "this panel is offset by 500ms" (RELATIVE), or "this panel is independent" (UNLINKED) covers essentially every multi-panel workflow neuroscientists use.
**Files:** `src/navigation_state.ts`, `src/layer_group_viewer.ts`

#### 3.2. Position Widget + Hover Values in Layer Bar
In `src/ui/layer_bar.ts`, the layer bar shows real-time position coordinates and live voxel values for each layer on mouse hover. This is a dense, always-visible "status line" for the current cursor position. For TensorScope, showing current time, AP/ML coordinate, channel index, and signal amplitude in the layer bar during hover is a high-value UX addition.
**Files:** `src/ui/layer_bar.ts`, `src/widget/position_widget.ts`

#### 3.3. Context Menus + Tool Palette
`src/ui/context_menu.ts` and `src/ui/tool_palette.ts` (39KB — substantial) implement a rich context menu system and a floating tool palette. The tool palette in Neuroglancer (39KB) shows available tools with keyboard shortcuts visible. For TensorScope's annotation/event-marking tools, this kind of always-discoverable tool palette (not buried in menus) reduces cognitive load.
**Files:** `src/ui/tool.ts`, `src/ui/tool_palette.ts`

#### 3.4. Keyboard Navigation with Named Actions
`space` toggles layout, `\` toggles statistics, number keys toggle layers, `shift+key*` activates tools. Every action is discoverable via `?` (help overlay at `src/help/`). For dense signal browsing, TensorScope should adopt the same pattern: `←/→` for time step, `[/]` for event navigation, `h` for help, digit keys for channel visibility.
**Files:** `src/ui/default_input_event_bindings.ts`, `src/help/`

#### 3.5. Layout Switching (`4panel`, `3d`, `xy`, `xz`)
`data_panel_layout.ts` implements named layout presets that switch the panel configuration. The `space` key cycles through layouts. TensorScope should have equivalent presets: `timeseries-only`, `timeseries+map`, `map-only`, `4-channel-split`.
**Files:** `src/data_panel_layout.ts`, `src/layer_groups_layout.ts`

#### 3.6. Drag-and-Drop Panel Splitting
`src/ui/layer_drag_and_drop.ts` and `src/layer_groups_layout.ts` implement panel splitting via drag-and-drop — dragging a layer onto a panel edge creates a new split panel. For TensorScope, allowing users to split a timeseries view horizontally (top: multichannel, bottom: spatial map) via drag would be ergonomic.

#### 3.7. Statistics / Chunk Loading Progress Panel
`src/ui/statistics.ts` shows per-layer chunk loading progress (`visibleChunksAvailable / visibleChunksNeeded`). For TensorScope, a status bar or panel showing "tensor slice loading: 3/8 chunks" communicates to users that data is arriving and avoids the perception of hanging.

---

### 4. Engineering Patterns Worth Borrowing

---

#### 4.1. `CompoundTrackable` — Composable Serializable State Tree

The root `TrackableViewerState extends CompoundTrackable` pattern (in `src/viewer.ts`) composes all child state (`navigationState`, `layerManager`, `selectedLayer`, etc.) into a single JSON-serializable tree. Each piece implements `toJSON()` / `restoreState(x)`. This is what enables URL persistence and session restore.

**For TensorScope:** `TensorScopeState` should be a typed, composable tree where each slice (tensor registry, time selection, event overlays, panel layout) serializes to the FastAPI session endpoint and restores from it. The specific class mechanism is not needed — Zustand's `persist` middleware achieves the same with much less ceremony, but the **interface contract** (every state slice must be serializable) is the insight.

#### 4.2. Frontend/Backend Split via WebWorker RPC (`worker_rpc.ts`)

The `src/worker_rpc.ts` and `src/render_layer_backend.ts` files implement a structured RPC protocol between the main thread and the chunk WebWorker. Shared objects have a `rpcId` and methods on both sides. This keeps the main thread free for rendering and interaction.

**For TensorScope:** TensorScope's equivalent is the FastAPI backend — data fetching is offloaded to the backend. The key pattern is: **the frontend never blocks on data**. React Query's async fetching with `suspense` + `keepPreviousData` achieves this. But Neuroglancer's explicit acknowledgment that "the frontend must stay responsive even when data is late" should be a first-class TensorScope design constraint.

#### 4.3. `Trackable` Interface with `toJSON()` / `restoreState()`

Every piece of persistent state in Neuroglancer implements:
```typescript
interface Trackable {
  toJSON(): any;
  restoreState(x: any): void;
  reset(): void;
  changed: NullarySignal;
}
```
This is the contract that makes URL persistence automatic.

**For TensorScope:** Every API-persisted state slice in `TensorScopeState` should implement an equivalent TypeScript interface. FastAPI Pydantic models on the backend side are the other half of this contract.

#### 4.4. `DataSourceRegistry` — Side-Effect Import Registration Pattern

Data sources register themselves via `registerProvider()` called from side-effect imports (`import "#datasource/zarr/register_default"`). This means adding a new format requires zero changes to core code.

**For TensorScope:** The FastAPI data adapter system should use a similar pattern — each adapter is an importable module that registers itself with a central `DataSourceRegistry`. New lab-specific formats can be added without modifying the core backend.

#### 4.5. Layer Type Registry (`layer_types` dict in Python)

In `python/neuroglancer/viewer_state.py`, `layer_types = { "image": ImageLayer, "segmentation": SegmentationLayer, ... }` maps type strings to classes, and `make_layer(json_data)` dispatches on `json_data["type"]`. This is the Python-side registry.

**For TensorScope:** A typed dispatch table for tensor view types (`{ "timeseries": TimeseriesView, "spatial_map": SpatialMapView, ... }`) that selects the correct visualization component based on tensor metadata dimensions is directly applicable to TensorScope's "views chosen based on tensor dims/signature" goal.

#### 4.6. Vitest + Playwright Testing Strategy

The repo uses:
- **Vitest** (`vitest.workspace.ts`) for unit tests of pure logic (coordinate transforms, data structures)
- **Playwright** (`playwright.config.ts`) for end-to-end browser tests
- `.spec.ts` suffix for unit tests, `.browser_test.ts` for browser-context tests

**For TensorScope:** Adopt the same split — Vitest for unit tests on state logic, Playwright for interaction tests (does clicking a channel select it? does the time cursor move?).

---

### 5. Not a Good Fit for TensorScope

---

#### 5.1. Vanilla TypeScript + Custom Reactive State (No React)
Neuroglancer has no React — it builds the DOM imperatively with custom `RefCounted` disposable objects, manual `registerDisposer()` lifecycle management, and signals. This is **extremely complex** and requires discipline to avoid memory leaks. TensorScope's React + Vite stack is the right choice. Do not port the reactive state classes — use Zustand/Jotai instead.

#### 5.2. WebGL2 + WebWorker Rendering Pipeline
Neuroglancer renders everything via WebGL2 shader programs in the browser. This is necessary for 3D volumetric data at interactive rates, but TensorScope renders 2D timeseries and 2D electrode maps. Canvas 2D, SVG, or D3 are simpler and sufficient. The `src/webgl/`, `src/sliceview/`, `src/perspective_view/` subsystems are not applicable.

#### 5.3. Multi-Dimensional Coordinate Transform System
`src/coordinate_transform.ts` (63KB) and `src/render_coordinate_transform.ts` (29KB) handle arbitrary N-dimensional coordinate spaces with affine transforms between spaces. This is overkill for TensorScope's fixed `(time, AP, ML)` schema. TensorScope should not attempt to generalize its coordinate system to match Neuroglancer's flexibility.

#### 5.4. Segmentation / Object Picking
`src/object_picking.ts`, `src/segmentation_graph/`, `src/ui/segment_list.ts` (57KB) implement GPU-based object picking (clicking a pixel identifies a neuron segment ID). TensorScope has no equivalent concept — it selects by time range and channel, not by pixel-level segmentation.

#### 5.5. The Python Integration Torchbearer Anti-Pattern
`src/main_python.ts` and `src/python_integration/` implement a WebSocket-based link between the Python process and the browser viewer — the Python process pushes state to the browser. For TensorScope, this would recreate the Panel/HoloViews anti-pattern of Python driving the UI. TensorScope must not adopt this Python-push model. Neuroglancer's Python integration is well-done but architecturally the wrong direction for TensorScope.

#### 5.6. Global State as a Single Massive `Viewer` Class
`src/viewer.ts` (39KB) is a single class that owns all state. This made sense before React, but for TensorScope it would be an anti-pattern. Zustand slices or Jotai atoms compose better in React's component tree.

---

### 6. Top 5 Recommendations for TensorScope

---

**#1 — Adopt Three-Mode Navigation Linking for Time/Space Axes** *(Highest impact)*

Neuroglancer's `LINKED / RELATIVE / UNLINKED` model for per-axis navigation is the most directly transferable design decision in the entire repo. TensorScope should implement exactly this for the time axis (and optionally for AP/ML). The implementation in `src/navigation_state.ts:makeLinked()` is clear and translatable. A linked time cursor between a multichannel timeseries panel and a spatial electrode map panel is the core TensorScope interaction and needs explicit design, not a hack.

**Files:** `src/navigation_state.ts`, `src/layer_group_viewer.ts`

---

**#2 — Implement `CompoundTrackable`-style Serializable Session State**

TensorScope needs a `TensorScopeState` that serializes fully to the FastAPI session endpoint and restores from it. Neuroglancer proves this is feasible: every child state implements `toJSON/restoreState`, the root composes them. TensorScope's Zustand store should have the same contract — each slice must be serializable. The URL hash binding in `src/ui/url_hash_binding.ts` shows how to tie this to browser navigation.

**Files:** `src/trackable_value.ts`, `src/ui/url_hash_binding.ts`, `src/ui/state_editor.ts`

---

**#3 — Implement Priority-Tiered Windowed Slice Fetching on Both Sides**

The `ChunkManager` + `ChunkPriorityTier` pattern encodes a fundamental truth for large-data scientific visualization: **visible data > prefetch data > cached data**, and the frontend always renders whatever it has. TensorScope's FastAPI `windowed tensor slice` endpoint should respect `priority` and `abort signal` parameters. The React frontend should use React Query with `keepPreviousData` and cancel in-flight requests on navigation, mirroring the `VISIBLE` → `PREFETCH` tier transition.

**Files:** `src/chunk_manager/base.ts`, `src/chunk_manager/frontend.ts`, `src/chunk_manager/backend.ts`

---

**#4 — Adopt Typed Event Annotations as First-Class State**

Neuroglancer's annotation system (typed objects, side panel list, overlay rendering, selection state linkage) is the model for TensorScope's event overlay system. The key lesson: events/annotations must be typed (`{ type, time, channel, metadata }`), serializable (contribute to session state), selectable (drive the inspector panel), and renderable as overlays (drawn on the signal canvas, not just listed). Do not implement events as a rendering-only afterthought.

**Files:** `src/ui/annotations.ts` (85KB), `src/annotation/`, `python/neuroglancer/viewer_state.py` (AnnotationLayer section)

---

**#5 — Named Actions + Discoverable Keyboard Bindings**

The `EventActionMap` + named-action design from `default_input_event_bindings.ts` is essential for dense-data navigation tools. TensorScope's keyboard model should separate "key → action name" from "action name → handler". The `?` help overlay (in `src/help/`) that lists all bindings should be a day-one feature. For neuroscientists navigating hundreds of channels and long recording sessions, keyboard shortcuts are not polish — they are workflow-critical.

**Files:** `src/ui/default_input_event_bindings.ts`, `src/util/event_action_map.ts`, `src/help/`

---

### 7. Evidence (Concrete File Paths)

| Topic | File(s) |
|---|---|
| Viewer state interface | `src/viewer_state.ts` |
| Root viewer + session state | `src/viewer.ts` (39KB) |
| Trackable / WatchableValue reactive atoms | `src/trackable_value.ts` |
| Navigation state + linked mode | `src/navigation_state.ts` (69KB) |
| Linked panel navigation state | `src/layer_group_viewer.ts` |
| Layout / panel splitting | `src/data_panel_layout.ts`, `src/layer_groups_layout.ts` |
| Panel rendering base | `src/rendered_data_panel.ts` (29KB) |
| Slice view panel | `src/sliceview/panel.ts`, `src/sliceview/frontend.ts` |
| Chunk lifecycle model | `src/chunk_manager/base.ts`, `src/chunk_manager/frontend.ts`, `src/chunk_manager/backend.ts` |
| Data source registry | `src/datasource/index.ts`, `src/datasource/default_provider.ts` |
| Annotation system | `src/ui/annotations.ts` (85KB), `src/annotation/` |
| Annotation layer (Python) | `python/neuroglancer/viewer_state.py` |
| Event/action system | `src/ui/default_input_event_bindings.ts`, `src/util/event_action_map.ts` |
| Tool system | `src/ui/tool.ts` (27KB), `src/ui/tool_palette.ts` (39KB) |
| Side panels | `src/ui/layer_side_panel.ts`, `src/ui/selection_details.ts`, `src/ui/side_panel.ts` (25KB) |
| URL hash state persistence | `src/ui/url_hash_binding.ts`, `src/ui/state_editor.ts` |
| Layer bar with hover values | `src/ui/layer_bar.ts` |
| Object picking | `src/object_picking.ts` |
| Worker RPC | `src/worker_rpc.ts` |
| Python viewer state model | `python/neuroglancer/viewer_state.py` |
| Testing strategy | `vitest.workspace.ts`, `playwright.config.ts`, `*.spec.ts`, `*.browser_test.ts` |
| Layout type system (Python) | `python/neuroglancer/viewer_state.py` (StackLayout, LayerGroupViewer, DataPanelLayout) |
| Statistics/loading progress panel | `src/ui/statistics.ts` |

---

> **Note on completeness:** The `src/` directory listing was paginated at 30 results and additional subdirectories exist (notably `src/widget/`, `src/segmentation_display_state/`, `src/segmentation_graph/`). The `src/ui/` listing was also paginated. The analysis above covers all the architecturally significant modules visible across both directory listings and code search results. You can browse the full `src/` tree at [github.com/google/neuroglancer/tree/master/src](https://github.com/google/neuroglancer/tree/master/src).