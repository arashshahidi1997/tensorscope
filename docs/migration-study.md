# TensorScope: React + Vite + TypeScript Migration Study

*Date: 2026-03-10*

---

## 1. Current State

### 1.1 The `tensorscope` standalone repo

The repo at `/storage2/arash/projects/tensorscope` is currently a **stub/scaffold**:

```
tensorscope/
  src/tensorscope/__init__.py     # empty (1 line)
  tests/test_tensorscope.py       # import test only (8 lines)
  docs/                           # migration prompt + this document
  pyproject.toml                  # name=tensorscope, version=0.1.0, no deps
  Makefile                        # projio + pytest config
  resources/cogpy -> /storage2/arash/projects/cogpy   # symlink
```

There is no production code here. The repo exists as the **declared home for the future standalone product**. The real implementation is in `cogpy`.

### 1.2 TensorScope implementation lineage in `cogpy`

**Location:** `cogpy/src/cogpy/core/plot/tensorscope/`

The implementation has evolved through a documented versioning sequence:

| Version | Key changes |
|---------|-------------|
| v1.0 | Initial plan; layer-based composition |
| v2.x | Controller-based state (`state.time_hair.t`, `state.spatial_space.selection`); Signal/Layer/Module model |
| v2.6 | Interval events, event-triggered average, full EventStream model |
| v2.8 | PSD explorer module, spectral views |
| v3.0 | **Breaking refactor.** Flat unified state (`SelectionState`); tensor-centric model; dimension-based view discovery |

**v3.0 is the current canonical architecture.** Documented in `tensorscope-v3-spec.md`.

### 1.3 Canonical v3.0 architecture (facts)

**State model** (`state.py`):
```python
TensorNode(name, data: xr.DataArray, source, transform, params)  # immutable
TensorRegistry                        # named tensor store
SelectionState(param.Parameterized)   # time, freq, ap, ml, channel (reactive)
TensorScopeState                      # TensorRegistry + SelectionState + active_tensor
```

**View system** (`views/__init__.py`, 252 lines):
- `View(ABC)` — pure projection: `render(tensor, selection) -> HoloViews`
- Registered by dimension signature via `@register_view(("time", "AP", "ML"))`
- 4 concrete views: `TimeseriesView`, `SpatialMapView`, `PSDAverageView`, `PSDSpatialView`
- Discovery: `get_available_views(tensor_node) -> list[type[View]]`

**Data schema** (`schema.py`, 206 lines):
- Canonical grid representation: `(time, AP, ML)` xarray DataArray
- `validate_and_normalize_grid()` — enforces this from any input permutation
- `flatten_grid_to_channels()` — canonical flattening: `channel = ap * n_ml + ml`

**Events** (`events/model.py`, 168 lines):
- `EventStream(name, df: pd.DataFrame, style: EventStyle)`
- Required columns: `event_id`, `t` (seconds)
- Optional: `t0/t1` (intervals), `channel`, `AP/ML`, `label`, `value`
- Windowed queries: `get_events_in_window(t0, t1)`

**Layout** (`layout.py`, 143 lines):
- `LayoutManager` with 4 named presets: `default`, `spatial_focus`, `timeseries_focus`, `psd_explorer`
- Grid-based: `panel_id → (r0, r1, c0, c1)`

**App assembly** (`app.py`, 181 lines):
```python
app = TensorScopeApp()
app.add_tensor("signal", data)
app.add_psd_tensor("psd", source="signal", window=1.0)
template = app.build()   # returns pn.template.FastListTemplate
pn.serve({"/": template}, port=5006)
```

**CLI** (`cli.py`, 317 lines):
```bash
tensorscope serve <data.nc|zarr|lfp> [--layout default] [--port 5006]
tensorscope presets | modules | config --show
```

### 1.4 Legacy code retained in v3.0 (do not migrate forward)

| Component | Location | Status |
|-----------|----------|--------|
| `CoordinateSpace` (v2.x reactive pub-sub) | `transforms/base.py` | Legacy — superseded by `SelectionState` |
| `TensorLayer` + concrete layers | `layers/*.py` | Legacy — v2.x UI wrapper pattern |
| `ViewPresetModule` + modules | `modules/*.py` | Legacy — v2.x preset layout system |
| `ViewSpec` / `ViewFactory` | `view_spec.py`, `view_factory.py` | Legacy — v2.1 declarative layer |
| `TimeWindowCtrl` | `time_window.py` | Legacy — not used in v3.0 app |
| `SignalObject` / `SignalRegistry` | `signal.py` | Transitional — v2.x naming; v3.0 uses `TensorNode` |

### 1.5 Known conflicts between docs and implementation

1. **User guide API is wrong.** `tensorscope-user-guide.md` shows `TensorScopeApp(data).with_layout().add_layer()` which does not match the actual v3.0 API (`TensorScopeApp()`, then `add_tensor()`, then `build()`). The user guide reflects a v2.x aspirational API.

2. **Module system vs v3.0.** `tensorscope-plan.md` describes a module-centric architecture. v3.0 replaces this with tensor-tab layout. Both paths exist in `cli.py`; `--module` flag invokes the legacy path.

3. **Signal vs Tensor naming.** Some docs use "Signal"; v3.0 canonical terminology is "Tensor."

---

## 2. Core Concepts To Preserve

### Tensor-centric state

`TensorScopeState` (tensor registry + unified selection) is the cleanest concept in the codebase. It separates *what data exists* from *what is selected*. This maps naturally to a Redux/Zustand store in TypeScript. Preserve this boundary.

### Dimension-based view discovery

`@register_view(dims)` + `get_available_views(tensor_node)` is an extensible, declarative pattern. In a React context this becomes a component registry keyed on tensor shape. Worth preserving exactly.

### Canonical grid schema

`(time, AP, ML)` is a well-reasoned, scientifically grounded data layout. The normalization logic in `schema.py` is independent of Panel/HoloViews and should be kept in Python. The frontend only needs to know the resulting shape and coordinate metadata.

### Event model

`EventStream` as a time-indexed, pandas-based table with optional interval and spatial columns is a solid, general abstraction. Keep this in Python. The API contract (what the frontend receives) should be a serialized form of this.

### Layout presets

Named, declarative presets rather than imperative layout code. Preserves the concept; replace Panel grid assignment with CSS grid or a layout descriptor in the frontend.

### View purity

Views are **stateless projections** of tensor + selection. This must survive the migration: backend computes data slices; frontend renders them. No view should store state.

### CLI and data-loading interface

`tensorscope serve <file>` is a user-facing entry point worth preserving. The React migration should keep this as the launch mechanism, with the CLI starting the Python backend server.

---

## 3. Recommended Target Architecture

### 3.1 Repo / package structure

```
tensorscope/                      # This repo (standalone product)
  src/tensorscope/
    server/                       # FastAPI / uvicorn backend
      app.py                      # ASGI app entry point
      routers/
        tensors.py                # GET /tensors, GET /tensors/{name}/slice
        selection.py              # GET/POST /selection
        events.py                 # GET /events
        layout.py                 # GET /layout
      state.py                    # Thin wrapper around core TensorScopeState
      session.py                  # Session/process lifecycle
    core/                         # Python compute (no UI deps)
      state.py                    # TensorScopeState, TensorNode, SelectionState
      schema.py                   # Validation + normalization
      data/                       # Modalities and loaders
      events/                     # EventStream model
      layout.py                   # Layout presets (descriptor only)
      transforms/                 # Transform primitives (optional dep on cogpy)
    adapters/
      cogpy.py                    # Optional: cogpy-specific data loaders
    cli.py                        # Entry point: tensorscope serve ...
  frontend/                       # React + Vite + TypeScript
    src/
      api/                        # Typed API client (generated or hand-written)
      store/                      # Zustand or Redux state (mirrors Python state)
      components/
        views/                    # TimeseriesView, SpatialMapView, etc.
        layout/                   # Layout shell + panel slots
        controls/                 # TimeSlider, FreqSlider, ChannelSelector
        events/                   # EventOverlay, EventNavigator
      registry/                   # View registry keyed by tensor dims
      types/                      # Shared TypeScript types
      App.tsx
    index.html
    vite.config.ts
    tsconfig.json
  tests/
    python/                       # pytest tests for core + server
    e2e/                          # Playwright or Cypress for integration tests
  docs/                           # mkdocs (this file lives here)
  pyproject.toml                  # Dependencies: fastapi, uvicorn, xarray, numpy, pandas
  Makefile
```

### 3.2 Frontend structure

The React frontend is a **pure consumer of the Python API**. It holds:

- **UI state only:** scroll position, panel sizes, unsaved local selections
- **Synced state:** mirrors `SelectionState` (time, freq, ap, ml, channel) — synced to server via HTTP or WebSocket
- **Cached data:** tensor slices fetched on demand; invalidated on selection change

Key frontend architectural decisions:

| Concern | Recommendation |
|---------|---------------|
| State management | Zustand (lightweight, composable) |
| API client | `@tanstack/react-query` for data; plain fetch for selection updates |
| Real-time sync | WebSocket for selection sync if multiple viewers needed; polling acceptable for v1 |
| Rendering | Tiered — see rendering strategy below |
| View registration | Module map: `dims -> ReactComponent` mirroring Python registry |
| Layout | CSS Grid; layout descriptor from API drives slot assignment |
| Type generation | `openapi-typescript` from FastAPI's generated OpenAPI spec |

**Rendering strategy (tiered by view class):**

TensorScope's views have fundamentally different rendering requirements; a single library cannot serve them all well.

| View | Library | Rationale |
|------|---------|-----------|
| Dense multichannel timeseries | **uPlot** | Purpose-built Canvas 2D time-series renderer; handles hundreds of simultaneous line series without performance degradation; much faster than Plotly at this workload |
| Spatial electrode map (AP × ML heatmap) | **Custom Canvas 2D** (or `visx/heatmap`) | Electrode grids are small (e.g., 8×16 = 128 cells); a plain Canvas `fillRect` loop or visx is sufficient and avoids heavy dependencies. deck.gl is over-engineered for this scale |
| PSD / spectrogram summary | **Plotly.js** | Good fit: moderate data density, broad chart support, fast to build |
| Event overlays | **uPlot plugin** or SVG overlay | Rendered on top of timeseries canvas |
| Diagnostic / exploratory charts | **Plotly.js** | High-level, many chart types, good for ad-hoc views |

Plotly.js is the right **bootstrap and secondary visualization layer**, not the backbone for the core waveform and spatial panels. Do not let Plotly define the rendering architecture even in early phases — its API shapes components in ways that are hard to replace later.

The application state and data orchestration layer (Zustand + TanStack Query + FastAPI) does not depend on which renderer is used, so renderer selection per view can be deferred to phase 4 without blocking phase 3 scaffolding.

### 3.3 Python backend structure

The Python backend is **compute + session management only**. No UI code.

```
tensorscope.core      — pure Python; no UI deps; testable in isolation
tensorscope.server    — FastAPI routers; thin adapters over core
tensorscope.adapters  — optional integrations (cogpy, MNE, BIDS, etc.)
tensorscope.cli       — entry point; starts uvicorn + serves built frontend
```

Dependencies:
- `fastapi` + `uvicorn` — HTTP server
- `xarray` + `numpy` + `pandas` — data
- `scipy` — spectral (or delegate to cogpy adapter)
- No `panel`, `holoviews`, `bokeh` in the new architecture

### 3.4 Integration boundary with `cogpy`

```
tensorscope → optional cogpy adapters (not a hard dep)
pixecog → tensorscope + cogpy (host project imports both)
```

Concretely:
- `tensorscope.core` must have **zero hard dependencies on cogpy**
- `tensorscope.adapters.cogpy` provides loaders for `cogpy`-produced datasets
- `cogpy.core.spectral` functions (`compute_psd_window`, `stack_spatial_dims`) are either:
  - Copied into `tensorscope.core.transforms` (pure compute, no deps)
  - Or imported optionally via adapter pattern

This allows TensorScope to be used by projects that do not use cogpy at all.

---

## 4. Ownership Boundaries

### What belongs in `tensorscope`

- Product-domain state model: `TensorScopeState`, `TensorNode`, `SelectionState`
- Data schema contract: canonical `(time, AP, ML)` normalization
- Event model: `EventStream` and temporal windowing
- Layout descriptor model: preset definitions and slot assignments
- View registry: dimension-to-view mapping (Python side: data slicers; TS side: renderers)
- HTTP/WebSocket API: all routes that the frontend talks to
- React frontend: all UI components, state, and rendering
- CLI: `tensorscope serve` entry point
- Docs: user guide, API reference, architecture docs
- Tests: unit tests for core, integration tests for server, e2e tests

### What belongs in `cogpy`

- Scientific compute: PSD computation, spectrograms, filter chains, ICA
- Scientific data loading: BIDS iEEG, NWB, EDF, MNE-compatible loaders
- Statistical analysis: event-triggered averaging, spectral statistics
- Electrode geometry: spatial transforms, montage construction
- Scientific documentation: methods references, algorithm details
- Anything that requires domain neuroscience knowledge to implement or validate

**Boundary rule:** If the function would make sense in a generic signal processing library, it belongs in cogpy. If it is about *displaying* or *navigating* tensors, it belongs in tensorscope.

### What belongs in host projects (e.g., PixECoG)

- Domain-specific data pipelines (how raw recordings become tensors)
- Domain-specific event definitions (trial structures, behavioral annotations)
- Custom views for domain-specific data (e.g., electrode impedance maps)
- Integration glue between `tensorscope` and project-specific infrastructure
- Project-specific layout presets and workflows

---

## 5. Migration Plan

### Phase 0: Stabilize the boundary (no new features)

**Goal:** Draw the line between cogpy and tensorscope clearly. Ensure the canonical v3.0 code is identifiable and tested.

Tasks:
- Read all 14 spec docs in cogpy; mark which spec is canonical for each concept
- Add `# CANONICAL v3.0` / `# LEGACY v2.x` comments to cogpy tensorscope files
- Write minimal unit tests for the canonical path in cogpy (state, schema, views)
- Document exactly which cogpy compute functions tensorscope depends on (by file/function)
- Freeze legacy paths: mark `layers/`, `modules/`, `transforms/base.py`, `signal.py` as deprecated

Deliverable: A clear map of what needs to be extracted vs. what can be archived.

### Phase 1: Extract the Python core

**Goal:** Move `tensorscope.core` to the standalone `tensorscope` repo, with no Panel/HoloViews/param deps.

Tasks:
- Move from `cogpy.core.plot.tensorscope` into `tensorscope/src/tensorscope/core/`:
  - `state.py` — remove `param.Parameterized`; replace with plain dataclasses or Pydantic models
  - `schema.py` — pure xarray/numpy; no UI deps (already clean)
  - `data/modality.py`, `data/modalities.py`, `data/alignment.py`
  - `events/model.py` — pure pandas; no UI deps (already clean)
  - `layout.py` — remove Panel-specific grid assignment; keep preset descriptors as dataclasses
- Extract needed spectral compute from `cogpy.core.spectral` into `tensorscope.core.transforms`
- Replace `param.Parameterized` `SelectionState` with a plain `dataclasses.dataclass` or Pydantic model
- Update `pyproject.toml` with real dependencies
- Write pytest coverage for the extracted core

Deliverable: `tensorscope.core` installable with `pip install tensorscope`; no Panel/HoloViews/cogpy hard deps.

### Phase 2: Define the API contracts

**Goal:** Specify all HTTP endpoints before writing frontend code. Use FastAPI + Pydantic for schema validation and auto-generated OpenAPI docs.

API endpoints (initial set):

```
GET  /api/state              → TensorScopeStateDTO (tensor names, selection, layout)
GET  /api/tensors            → list[TensorMetaDTO]
GET  /api/tensors/{name}     → TensorMetaDTO (dims, shape, coords, available_views)
GET  /api/tensors/{name}/slice?t0=&t1=&ap=&ml=  → TensorSliceDTO (base64 or json array)
GET  /api/selection          → SelectionDTO
PUT  /api/selection          → SelectionDTO (update from frontend)
GET  /api/events             → list[EventStreamMetaDTO]
GET  /api/events/{name}/window?t0=&t1=  → list[EventDTO]
GET  /api/layout             → LayoutDTO (active preset, slot assignments)
PUT  /api/layout/preset/{name}          → LayoutDTO
WS   /ws/selection           → bidirectional SelectionDTO stream (optional for v1)
```

Pydantic models in `tensorscope/src/tensorscope/server/models.py`:
```python
class TensorMetaDTO(BaseModel):
    name: str
    dims: list[str]
    shape: list[int]
    coords: dict[str, list]    # coord name → values
    available_views: list[str]
    transform: str
    source: str | None

class SelectionDTO(BaseModel):
    time: float
    freq: float
    ap: int
    ml: int
    channel: int | None

class TensorSliceDTO(BaseModel):
    name: str
    view_type: str
    data: list             # JSON-safe array
    meta: dict             # axes, labels, units
```

Run `openapi-typescript` on the generated spec to produce `frontend/src/api/types.ts`.

Deliverable: Versioned OpenAPI spec in `docs/api/openapi.yaml`; `tensorscope.server` FastAPI app that returns mock data.

### Phase 3: Scaffold React + Vite + TypeScript frontend

**Goal:** Working shell app that connects to the Phase 2 API, with correct architecture.

Tasks:
- `npm create vite@latest frontend -- --template react-ts`
- Install: `zustand`, `@tanstack/react-query`, `uplot`, `plotly.js`, `openapi-typescript`
- Generate `frontend/src/api/types.ts` from OpenAPI spec
- Scaffold folder structure (see §3.1)
- Implement view registry: `Map<string, React.ComponentType<ViewProps>>`
- Implement layout shell: reads `GET /api/layout`, renders CSS grid with slots
- Implement TimeSlider, FreqSlider connected to `PUT /api/selection`
- Display placeholder views for each registered tensor tab
- Wire `@tanstack/react-query` for tensor slice fetching with cache invalidation on selection change

Deliverable: `tensorscope serve` starts uvicorn + serves built frontend; basic layout visible.

### Phase 4: Migrate one canonical workflow

**Goal:** Make the `(time, AP, ML)` LFP signal workflow fully functional end-to-end.

Tasks:
- Implement `TimeseriesView` React component (uPlot — multichannel Canvas 2D)
- Implement `SpatialMapView` React component (custom Canvas 2D heatmap)
- Implement event overlay on timeseries view
- Implement time-window scroll navigation
- Wire full selection sync: slider changes → `PUT /api/selection` → views refetch
- Integrate one real dataset from cogpy/PixECoG test data

Deliverable: `tensorscope serve data.nc` launches browser with functional timeseries + spatial view, linked selection, event overlay.

### Phase 5: Retire legacy UI paths

**Goal:** Remove Panel/HoloViews dependency from the product.

Tasks:
- Verify all workflows in Phase 4 are covered by new UI
- Remove `panel`, `holoviews`, `bokeh` from tensorscope dependencies
- Archive `cogpy.core.plot.tensorscope` (move to `cogpy.archive.tensorscope_v3`)
- Update cogpy to import tensorscope as an external dependency (not an internal module)
- Update PixECoG to depend on `tensorscope` directly
- Deprecation notice in cogpy docs

Deliverable: `tensorscope` package with no Panel/HoloViews dep. cogpy becomes a compute library only.

---

## 6. Risks and Open Questions

### Technical risks

**R1: xarray → JSON serialization performance**

Large tensors (e.g., 30 min LFP, 128 channels, 1kHz = ~230M samples) cannot be sent as JSON. The slice API must return windowed views only. Need a binary transport format (numpy `.tobytes()` + base64, or Arrow IPC, or msgpack) for large arrays. JSON is acceptable only for small slices (< ~10k samples).

*Mitigation:* Enforce strict window bounds in `GET /api/tensors/{name}/slice`. Design `TensorSliceDTO` for binary payload from the start (phase 2).

**R2: Selection sync latency**

Current Panel reactive binding is process-local. REST round-trips add latency. For linked-view interactions (drag time cursor → all views update), HTTP polling is too slow. WebSocket sync for `SelectionState` should be in scope for phase 3, not deferred.

*Mitigation:* Plan WS endpoint in phase 2. Implement local optimistic updates in frontend Zustand store.

**R3: param.Parameterized removal**

`SelectionState` currently uses `param` library for reactive binding. Removing `param` means losing the Python-side reactive system. This is intentional (Python side becomes stateless per request), but any existing cogpy code that watches `SelectionState` changes will break.

*Mitigation:* Keep `param` in cogpy's internal copy. Replace only in the extracted `tensorscope.core`.

**R4: cogpy spectral compute extraction**

`tensorscope` currently depends on `cogpy.core.spectral` for PSD computation. Extracting these functions without `cogpy` as a dependency requires either copying code or making `cogpy` an optional dep.

*Mitigation:* Copy the minimal spectral functions needed (`compute_psd_window`, `stack_spatial_dims`) into `tensorscope.core.transforms`. These are pure numpy/scipy and have no cogpy-specific logic. Keep `cogpy` as an optional install extra for extended modalities.

**R5: Transform DAG (v4.0 placeholder)**

`TensorNode` has `transform: str` and `params: dict` as lineage metadata, but no DAG execution engine. Advanced workflows (filter → PSD → spectrogram chains) require this. Phase 4 ignores this gap; it becomes a risk if users expect live transform computation.

*Mitigation:* Phase 4 supports pre-computed tensors only (user adds tensors explicitly). Document this limitation. Plan DAG in a dedicated v4.0 spec after React migration is stable.

**R6: Frontend rendering performance**

Channel-dense LFP data (128 channels × 10s × 1kHz = 1.28M points per window) will overwhelm any general-purpose charting library if sent raw. This is not a Plotly-specific problem — it is a data volume problem. uPlot handles high-density line series efficiently but still benefits from server-side reduction.

*Mitigation:* Implement server-side downsampling in `GET /api/tensors/{name}/slice` (LTTB or min/max envelope). Frontend requests display resolution (`n_points=screen_width_px`) as a query parameter. This is an **architectural requirement**, not an optimization — design the slice API with downsampling from phase 2.

### Packaging risks

**R7: cogpy version coupling**

If `tensorscope` uses cogpy compute via adapters, cogpy changes can break tensorscope. PixECoG → tensorscope → cogpy adapter → cogpy creates a fragile chain.

*Mitigation:* Define a stable adapter interface in `tensorscope.adapters.cogpy`. Pin cogpy version in tensorscope's optional extras. Test the adapter in CI against a pinned cogpy version.

### Developer experience risks

**R8: Two-language development complexity**

Developing both Python backend and TypeScript frontend in one repo requires tooling setup for both ecosystems. Hot reload for both must work simultaneously.

*Mitigation:* `Makefile` target `make dev` starts uvicorn (--reload) and vite dev server concurrently. Vite dev server proxies `/api` to uvicorn. Document this in a single `docs/dev-setup.md`.

**R9: No existing frontend tests**

There are currently no JavaScript/TypeScript tests anywhere in the codebase. Starting without a testing plan leads to untestable frontend code.

*Mitigation:* Add Vitest for unit tests in phase 3. Add one Playwright e2e test in phase 4 (the canonical workflow smoke test).

### Open questions

1. **Binary transport format for arrays.** JSON vs. msgpack vs. Arrow IPC for `TensorSliceDTO`? Decide in phase 2 before writing frontend API client.

2. **WebSocket vs. polling for selection sync.** Full WebSocket in phase 3, or polling acceptable for v1? Decision affects frontend architecture.

3. **Multi-session support.** Should multiple browser tabs/users see the same selection state? Phase 1 design (single process, single state) makes this hard to add later. Decide before phase 3.

4. **Authentication / access control.** TensorScope as a local tool (no auth) vs. shared instance (auth required). Not addressed in current architecture. Affects CLI and server design.

5. **Transform DAG priority.** Is live filtering (e.g., apply bandpass, view result immediately) needed in the React migration scope or deferred to v4.0? High impact on API design if needed.

6. **Plugin distribution.** How should third-party views and modalities be installed? Python entry points? npm packages? Decide before phase 3.

---

## Appendix: Package dependency graph (target)

```
tensorscope (pip)
  ├── fastapi
  ├── uvicorn
  ├── xarray
  ├── numpy
  ├── pandas
  ├── scipy          # or optional
  └── [cogpy]        # optional extra: pip install tensorscope[cogpy]

tensorscope (npm/vite — frontend build artifact, included in Python package)
  ├── react
  ├── vite
  ├── zustand
  ├── @tanstack/react-query
  ├── uplot                 # dense timeseries (core views)
  └── plotly.js             # PSD, spectrogram, exploratory charts

cogpy (separate pip package, used by host projects)
  └── no dep on tensorscope

pixecog (host project)
  ├── tensorscope
  └── cogpy
```

---

## Appendix: What can be reused directly

| Component | Action |
|-----------|--------|
| `state.py` (core state model) | Extract + replace `param.Parameterized` with dataclass/Pydantic |
| `schema.py` (grid normalization) | Copy as-is; pure xarray |
| `events/model.py` (EventStream) | Copy as-is; pure pandas |
| `data/modality.py`, `modalities.py` | Copy; remove Panel refs if any |
| `data/alignment.py` | Copy as-is |
| Layout preset descriptors | Extract preset data from `layout.py`; remove Panel grid assignment code |
| CLI structure (`cli.py`) | Rewrite to start uvicorn instead of `pn.serve()` |
| View registry pattern | Re-implement in Python (data slicers) + TypeScript (renderers) |

## Appendix: What should be archived

| Component | Action |
|-----------|--------|
| `layers/*.py` | Archive — v2.x UI wrapper pattern; no role in new architecture |
| `modules/*.py` | Archive — superseded by tensor tabs + view registry |
| `view_spec.py`, `view_factory.py` | Archive — v2.x declarative layer |
| `transforms/base.py` (CoordinateSpace) | Archive — superseded by `SelectionState` |
| `time_window.py` (TimeWindowCtrl) | Archive — not used in v3.0 |
| `signal.py` (SignalObject) | Archive — v2.x naming; replaced by TensorNode |
| Panel/HoloViews rendering code in `app.py`, `views/__init__.py` | Archive once React migration complete |

---

*Study authored from codebase analysis of `/storage2/arash/projects/tensorscope` and `/storage2/arash/projects/cogpy/src/cogpy/core/plot/tensorscope/` as of 2026-03-10.*
