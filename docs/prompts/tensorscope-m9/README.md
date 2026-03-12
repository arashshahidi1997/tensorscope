# TensorScope M9 Prompt Pack

Milestone: M9 — Multi-Tensor Workspace and Interactive Exploration

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope-m8/README.md](../tensorscope-m8/README.md)

## Milestone purpose

M9 transforms TensorScope from a single-tensor viewer into a multi-tensor exploration workspace. Users can view source and derived tensors side by side, interact with 4D transform outputs (e.g., spectrograms) using orthogonal slice views, build transform pipelines visually through a full-screen DAG editor, and detect events across N-dimensional data.

Primary focus:

- per-panel tensor override: each view panel can display a different tensor
- ortho-slicer for 4D tensors: linked time-frequency + spatial views with crosshairs
- full-screen DAG editor with visual node creation and branching
- event detection framework integrated with the transform DAG
- heatmap interaction gestures for long-axis exploration (spectrogram, PSD heatmap)

## Architectural role

M9 extends the view composition and transform layers. It introduces multi-tensor rendering within the existing slot-based grid, adds the ortho-slicer coordination pattern, and extends the DAG with event detector nodes.

The design must preserve:

- shared navigation state (Invariant 1) — selection coordinates (time, freq, AP, ML) remain global
- view-to-view coordination through shared state (Invariant 2) — crosshairs link views showing different tensors
- navigation / view-local / processing state distinction (Invariant 3) — per-panel tensor override is view-local, not navigation state

## Relationship to earlier milestones

- M1–M3: shell, views, spatial dynamics — the rendering foundation
- M4: transform registry and derived tensors — transforms produce new tensors
- M5: workspace DAG — graph structure for transform lineage
- M6: pipeline export — curated DAG export
- M7: dynamic workspace layout — resizable panels, tabbed sidebar, view grid
- M8: UI polish, stable layout, PSD panel — interaction patterns and live PSD
- M9: multi-tensor workspace — viewing and interacting with multiple tensors simultaneously

## Prompt inventory

| # | Title | Batch | Depends on | Files touched |
|---|-------|-------|------------|---------------|
| 90 | Per-panel tensor selector | 1 | — | ViewPanel.tsx, viewGridLayout.ts, appStore.ts, WorkspaceMain.tsx, styles.css |
| 91 | Ortho-slicer for 4D tensors | 2 | 90 | new OrthoSlicerView.tsx, WorkspaceMain.tsx, viewRegistry.ts, queries.ts |
| 92 | Full-screen DAG editor | 1 | — | DAGGraphView.tsx, SidebarContent.tsx, styles.css |
| 93 | Heatmap interaction gestures (generalized) | 1 | — | new useHeatmapGestures.ts, SpectrogramView.tsx, PSDHeatmapView.tsx |
| 94 | Event detection framework | 3 | 90, 91 | core/events.py, server/routers/events.py, types/event.ts, PipelineTabContent.tsx |
| 95 | PSD settings panel and freq log scale | 1 | — | appStore.ts, ExploreTabContent.tsx, PSD views |

## Execution plan

- **Batch 1** (parallel): P90 (per-panel tensor) + P92 (full-screen DAG) + P93 (heatmap gestures) + P95 (PSD settings) — no file overlap
- **Batch 2**: P91 (ortho-slicer) — needs P90 for multi-tensor panel rendering
- **Batch 3**: P94 (event detection) — needs P90 + P91 for detector output visualization

## Prompt details

### P90 — Per-Panel Tensor Selector

**Problem**: All view panels currently show the same `selectedTensor`. Users need to compare source and derived tensors (e.g., LFP timeseries alongside its spectrogram) in adjacent panels.

**Design**: Each `ViewPanel` gets a tensor selector dropdown in its header chrome. By default, all panels inherit the global `selectedTensor`. A user can pin any panel to a specific tensor. The pin is view-local state (not persisted to the server).

**Key decisions**:
- `ViewPanel` header gets a small tensor dropdown (shows current tensor name, click to select)
- Pinned panels show a "pin" indicator; clicking it resets to global tensor
- `ViewGrid` passes the per-panel tensor name (or global default) into each view's query
- Selection coordinates remain shared — changing time cursor in one panel affects all views
- `appStore` gets `panelTensorOverrides: Record<string, string>` for per-slot overrides

**Files**: ViewPanel.tsx, viewGridLayout.ts, appStore.ts, WorkspaceMain.tsx, styles.css

### P91 — Ortho-Slicer for 4D Tensors

**Problem**: Transform outputs like spectrogram are 4D tensors (time, freq, AP, ML). Currently only the time-freq heatmap is shown. Users need the orthogonal spatial view (AP×ML at a selected time-freq point) alongside the heatmap, with linked crosshairs — the original cogpy ortho-slicer pattern.

**Design**: When a 4D tensor is assigned to a panel, it renders an `OrthoSlicerView` that composes two linked sub-views:
- **Primary slice**: the 2D heatmap (e.g., time × freq for a spectrogram)
- **Orthogonal slice**: the complementary 2D view (e.g., AP × ML spatial map at the selected time-freq point)

The two sub-views share crosshairs through the global selection store. Clicking a point in the spectrogram updates time + freq selection; clicking a channel in the spatial map updates the AP + ML selection. Both views re-render with the new slice.

**Key decisions**:
- `OrthoSlicerView` is a composite view, not a new view type — it composes existing view components
- The ortho pair is determined by tensor dims: `(time, freq, AP, ML)` → primary = time×freq, orthogonal = AP×ML
- The view registry exposes a `getOrthoPair(dims)` helper
- The spatial map in ortho mode slices the 4D tensor at the current time+freq selection
- Ortho-slicer layout: side-by-side (primary 65%, spatial 35%) within one view slot

**Files**: new OrthoSlicerView.tsx, WorkspaceMain.tsx, viewRegistry.ts, queries.ts

### P92 — Full-Screen DAG Editor

**Problem**: The DAG graph in the sidebar is too small for complex pipelines. Users need a full-screen mode for viewing and editing the transform graph.

**Design**: Add a "fullscreen" toggle button to the DAG sidebar tab. When activated, the DAG graph expands to cover the entire center workspace. In fullscreen mode, users can:
- See all tensor and transform nodes with their connections
- Click a "+" button on tensor nodes to add a new transform (opens a transform picker inline)
- Click edges to inspect or modify transform parameters
- Create branches by adding multiple transforms from the same source tensor
- Navigate back to the normal workspace with Escape or the toggle button

**Key decisions**:
- Fullscreen DAG is a modal overlay on the center workspace, not a separate page
- Node interaction: "+" on tensor node → dropdown of compatible transforms → select → param form → execute
- Visual distinction: tensor nodes (rectangles) vs transform nodes (rounded), source (solid) vs derived (dashed border)
- Layout: auto dagre/elk layout or simple force-directed positioning
- The DAG view remains read-only for node positions (no drag-to-rearrange)

**Files**: DAGGraphView.tsx, SidebarContent.tsx, styles.css

### P93 — Generalized Heatmap Interaction Gestures

**Problem**: Interactive zoom/pan/select gestures are needed on all long-axis heatmaps (spectrogram, PSD heatmap). Currently each view has ad-hoc interaction code.

**Design**: Extract a reusable `useHeatmapGestures` hook that provides:
- Box zoom (horizontal → X-axis zoom, vertical → Y-axis zoom, diagonal → both)
- Pan mode (drag to scroll)
- Wheel zoom (centered on cursor)
- Click to select coordinates
- Toolbar integration (zoom/pan/wheel toggle/reset buttons)

The hook works with any canvas-based 2D heatmap that has two continuous axes. Views provide axis mapping functions (pixel → data coordinates) and receive viewport state.

**Key decisions**:
- Hook returns `{ viewport, gestureHandlers, toolbarProps, resetViewport }`
- Views pass `xRange`, `yRange`, and canvas ref
- The hook manages the selection box overlay DOM element
- Spatial maps (small, fixed extent) opt out — gestures are for "long" exploration axes
- SpectrogramView and PSDHeatmapView adopt the hook; SpatialMapSliceView does not

**Files**: new useHeatmapGestures.ts, SpectrogramView.tsx, PSDHeatmapView.tsx

### P94 — Event Detection Framework

**Problem**: TensorScope needs to support event detection algorithms (burst detection, threshold crossing, spectral bumps, band power RMS) that discover discrete events in N-dimensional tensor data. The transform DAG handles data→data transforms but not data→events.

**Design**: Introduce `EventDetector` as a new category in the transform system. Detectors take tensor inputs and produce structured event records (coordinates + attributes). Events flow into the existing `EventRegistry` for rendering as markers on views.

**Key decisions**:
- `EventDetectorNode` is a new DAG node type alongside `TensorNode` and `TransformNode`
- Detectors implement `detect(tensor, params) → EventRecord[]` (same interface as transforms but different output type)
- Output events are registered in `EventRegistry` and immediately available for overlay on all views
- Pipeline tab visually distinguishes detector nodes (different icon/color) from transform nodes
- Priority detectors to implement: threshold crossing (temporal), H-maxima burst detection (spectral), RMS band power

**Detector types**:
- **Spectral**: H-maxima (bursts/bumps in spectrogram), PSD peaks
- **Temporal**: threshold crossing, RMS band power
- **Spatial**: propagation wavefronts, source localization
- **Multi-dim**: joint time-frequency-space patterns

**Files**: core/events.py, server/routers/events.py, types/event.ts, PipelineTabContent.tsx, DAGGraphView.tsx

### P95 — PSD Settings Panel and Frequency Log Scale

**Problem**: PSD views lack user controls for analysis parameters (frequency range, NW parameter) and a log-scale toggle for the frequency axis.

**Design**: Add PSD settings to the Explore tab sidebar. Controls:
- `fmax` slider/input (displayed frequency range cutoff)
- `NW` input (multitaper bandwidth parameter)
- Frequency log scale toggle (applies to PSD heatmap and PSD curve views)

State lives in `appStore` (already partially typed). PSD views read these settings and adjust their rendering.

**Key decisions**:
- `appStore` gets `psdFmax`, `psdNW`, `freqLogScale` with setters
- `WorkspaceMain` reads these from appStore instead of local state and passes to PSD query params
- Log scale: PSD heatmap/curve map freq axis through `Math.log10` for tick positions and rendering
- ExploreTabContent gets a "PSD Settings" collapsible section

**Files**: appStore.ts, ExploreTabContent.tsx, WorkspaceMain.tsx, PSDHeatmapView.tsx, PSDCurveView.tsx

## Guardrails

- per-panel tensor override is view-local state — it does not affect server session or shared navigation
- ortho-slicer composes existing view components — it does not create new rendering backends
- full-screen DAG is a UI overlay — it does not change the DAG data model or execution
- event detectors extend the transform system — they do not replace it
- heatmap gestures are opt-in per view — spatial maps remain stable without zoom/pan
- all existing tests must continue to pass

## Exit criteria

Treat M9 as done when:

- any view panel can be pinned to show a specific tensor (source or derived)
- a 4D spectrogram tensor shows both time-freq heatmap and spatial map with linked crosshairs
- the DAG graph has a full-screen mode with node-level "add transform" interaction
- spectrogram and PSD heatmap have drag-zoom, pan, wheel-zoom, and time scale bar
- at least one event detector (threshold crossing) can be executed from the Pipeline tab
- PSD settings (fmax, NW, log scale) are controllable from the sidebar
- frontend builds clean and all tests pass
