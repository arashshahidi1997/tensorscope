# TensorScope M10 Prompt Pack

Milestone: M10 — Object Workspace, Timeline UX, and Generalized Propagation

Read first:

- [../../architecture/tensorscope.md](../../architecture/tensorscope.md)
- [../../architecture/invariants.md](../../architecture/invariants.md)
- [../context_snapshot.md](../context_snapshot.md)
- [../README.md](../README.md)
- [../tensorscope-m9/README.md](../tensorscope-m9/README.md)
- [../../log/idea/idea-arash-20260313-141041-603439.md](../../log/idea/idea-arash-20260313-141041-603439.md)

## Milestone purpose

M10 turns TensorScope's recent UI improvements into a coherent interaction model. The milestone shifts the product from a single-signal viewer with extra panels toward an object-centric scientific workspace where objects, timeline navigation, transforms, and propagation are first-class concepts.

Primary focus:

- object-centric workspace chrome for source and derived objects
- navigator-led timeline selection with snapped duration presets
- explicit multi-object layout modes
- generalized propagation as a reusable capability
- object-scoped processing UX
- visible transform activity and feedback
- cleanup of low-value or confusing UI surfaces

## Architectural role

M10 is a UX architecture milestone. It does not introduce a new scientific backend model; it reorganizes how existing tensors, derived objects, transforms, and navigation controls are exposed to the user.

The design must preserve:

- shared navigation state (Invariant 1) — selected time and linked coordinates remain global
- view-to-view coordination through shared state (Invariant 2) — object layout must not break linking
- navigation / view-local / processing state distinction (Invariant 3) — object visibility, layout mode, and propagation mode remain workspace-local UI state
- rendering hot paths avoid React rerender loops (Invariant 4) — cursor and animation updates stay imperative

## Relationship to earlier milestones

- M7: introduced the flexible shell and slot-based workspace layout
- M8: improved layout stability, timeseries interaction, and PSD support
- M9: per-panel tensor override (`panelTensorOverrides` in `appStore`), OrthoSlicerView, full-screen DAG, heatmap gestures, PSD settings panel, event detection framework — **M9 complete**
- M10: makes those pieces legible and usable as a coherent object-based environment

## Prompt inventory

| # | Title | Batch | Depends on | Files touched |
|---|-------|-------|------------|---------------|
| 100 | Object-centric workspace chrome | 2 | M9 complete | WorkspaceMain.tsx, appStore.ts, ViewPanel.tsx, styles.css |
| 101 | Timeline cursor and snapped duration model | 1 | — | selectionStore.ts, NavigatorView.tsx, ChartToolbar.tsx, useChartTools.ts, TimeseriesSliceView.tsx |
| 102 | Timeseries Y-mode cleanup | 1 | — | TimeseriesSliceView.tsx, ChartToolbar.tsx, useChartTools.ts, styles.css |
| 103 | Multi-object layout modes | 2 | 100 | WorkspaceMain.tsx, viewGridLayout.ts, ViewGrid.tsx, appStore.ts, styles.css |
| 104 | General propagation controller | 4 | 100, 103 | PropagationView.tsx, AnimationController.tsx, viewGridLayout.ts, viewRegistry.ts, appStore.ts, styles.css |
| 105 | Object-scoped processing UX | 3 | 100 | ProcessingPanel.tsx, ExploreTabContent.tsx, appStore.ts, styles.css |
| 106 | Execution activity and transform feedback | 1 | — | new store/activityStore.ts, PipelineTabContent.tsx, WorkspaceMain.tsx |
| 107 | Channel-stack grouped labeling and track cleanup | 5 | 101, 103 | TimeseriesSliceView.tsx, viewGridLayout.ts, appStore.ts, styles.css |

## Execution plan

- **Batch 1** (parallel): P101 + P102 + P106
  Tighten timeline semantics, fix Y-mode discoverability, and make transforms observable. No file overlap.
- **Batch 2** (parallel): P100 + P103
  Introduce object identity and object-level layout controls. P103 depends on P100's object model.
  Run sequentially within Batch 2: P100 first, then P103.
- **Batch 3**: P105
  Move processing onto the object model after object chrome exists.
- **Batch 4**: P104
  Generalize propagation using the new object and layout model.
- **Batch 5**: P107
  Finish readability and cleanup work after the main interaction surfaces settle.

## Prompt details

### P100 — Object-centric workspace chrome

**Problem**: TensorScope still reads like one selected tensor rendered through several views. Users now need a clearer object model where `signal`, `spectrogram`, `PSD`, and future derived outputs are visible, selectable, and actionable as first-class workspace objects.

**Design**: Introduce an object chip strip in the workspace header area. Each object represents a named scientific entity backed by one tensor. Objects have visibility, active state, type (source vs derived), and per-object actions. This sits above the view grid and makes the workspace's contents legible at a glance.

**Key decisions**:
- `appStore` gets a `workspaceObjects: WorkspaceObject[]` array. Type: `{ id: string; name: string; tensorName: string; type: "source" | "derived"; visible: boolean }`
- Objects are synthesized from the tensor registry on session load: one object per tensor. The active `selectedTensor` maps to the active object.
- `appStore.setSelectedTensor` updates the active object; `appStore.setObjectVisible(id, visible)` toggles a single object in/out.
- The workspace header renders a horizontal chip strip: each chip shows the object name, a colored dot for type (source = solid, derived = dashed), and a visibility toggle. Active object chip is highlighted.
- Per-object actions in a chip context menu: "Process…" (opens processing scoped to this object), "Pin to panel" (triggers per-panel tensor override), "Inspect" (opens Tensor Browser to this tensor).
- The existing `selectedTensor` string and `panelTensorOverrides` in `appStore` are unchanged — the object model is additive, not a replacement.
- `ViewPanel` header tensor dropdown stays for per-panel override. Object chrome is at workspace level, not panel level.

**Files**: WorkspaceMain.tsx, appStore.ts, ViewPanel.tsx, styles.css

---

### P101 — Timeline cursor and snapped duration model

**Problem**: Duration preset buttons in `TimeScaleBar` behave like zoom hints — they change the window width but do not snap to a deterministic centered viewport. The navigator has no persistent selected-time cursor, making it hard to scrub to a precise position.

**Design**: Make the navigator authoritative for time cursor and viewport duration. Duration presets set an exact symmetrical window around the current `timeCursor`. The navigator renders a draggable cursor line; dragging it scrubs `timeCursor` without scrolling the window.

**Key decisions**:
- `selectionStore` gains `viewportDuration: number` (default `2`). This is the single source of truth for window width.
- `setViewportDuration(d: number)` sets `viewportDuration = d` and updates `timeWindow = [timeCursor - d/2, timeCursor + d/2]`, clamped to tensor bounds.
- `setTimeCursor(t: number)` always recomputes `timeWindow` as `[t - viewportDuration/2, t + viewportDuration/2]`, keeping duration constant.
- Preset durations: `[0.1, 0.5, 1, 2, 5, 10, 30, 60, 300]` seconds. Labels: `100ms`, `500ms`, `1s`, `2s`, `5s`, `10s`, `30s`, `1m`, `5m`.
- `TimeScaleBar` in `TimeseriesSliceView` is removed; the pill strip moves to the navigator toolbar row (below `NavigatorView`).
- `NavigatorView` renders a vertical line at `timeCursor` that is draggable. Pointer events on the navigator canvas: click = set cursor, drag = scrub cursor, existing range drag on selection box stays.
- The navigator drag is imperative (canvas pointer events → direct store call), not React state per frame (Invariant 4).

**Files**: selectionStore.ts, NavigatorView.tsx, ChartToolbar.tsx, useChartTools.ts, TimeseriesSliceView.tsx

---

### P102 — Timeseries Y-mode cleanup

**Problem**: Auto-gain mode exists but its control (`A` affordance in `ChartToolbar`) is not discoverable. Y-zoom and gain mode are separate concepts that overlap confusingly. The toolbar exposes too many controls for a single axis concern.

**Design**: Replace current Y-zoom and gain mode controls with an explicit `Y-mode` selector: `Auto | Fixed | Fit`. This is a segmented button group in the ChartToolbar that maps cleanly to what users actually want.

**Key decisions**:
- `useChartTools` replaces `yZoom` + `gainMode` booleans with a single `yMode: "auto" | "fixed" | "fit"` field.
  - `auto`: each channel auto-scales independently on every data update (current auto-gain behavior)
  - `fixed`: Y range is locked; user sets it via ± buttons or scroll; persists across data refreshes
  - `fit`: on first render or explicit reset, fits all channels to the same scale; then holds
- `ChartToolbar` renders a 3-way segmented button: `Auto | Fixed | Fit`
- When `yMode` changes to `auto` or `fit`, `TimeseriesSliceView` calls its uPlot scale reset
- When `yMode === "fixed"`, the existing ± gain buttons remain visible alongside the selector
- Remove the `A` toggle button; remove any separate `yZoom` boolean from the store
- The previous `gainMode` feature (amplitude multiplication) is absorbed into `fixed` mode: the ± buttons adjust the fixed scale range
- Update `useChartTools.test.ts` to test `yMode` transitions

**Files**: TimeseriesSliceView.tsx, ChartToolbar.tsx, useChartTools.ts, useChartTools.test.ts, styles.css

---

### P103 — Multi-object layout modes

**Problem**: Users can now see multiple objects (from P100) but layout still feels panel-first. There is no way to compare signal and spectrogram directly — the slot grid doesn't know about objects.

**Design**: Add object layout modes that control how object rows are arranged. In `row` mode, each visible object's primary view row is labeled with the object name and stacked vertically. In `column` mode, objects appear side by side.

**Key decisions**:
- `appStore` gains `objectLayoutMode: "auto" | "single" | "row" | "column"` (default `"auto"`).
  - `auto`: single when ≤1 visible object, row when ≥2 visible objects
  - `single`: show only the active object's rows; hide rows belonging to other objects
  - `row`: each object's rows stacked vertically; a thin object label header separates them
  - `column`: active object rows placed side by side with another object's rows (max 2 columns for now)
- `ViewGrid` reads `objectLayoutMode` and the `workspaceObjects` list (from P100) to determine row visibility and column arrangement.
- Object-to-row mapping: the object with `tensorName === panelTensorOverride` for a given row is its "owner" in row/column modes. The signal row defaults to the active object's tensor.
- Thin object label bars (16px, object name, colored by type) appear above each object's first row in `row` mode.
- Layout mode toggle: small icon strip (`⊡ ⊟ ⊞`) in the workspace toolbar (near the object chips from P100).
- `viewGridLayout.ts` gains a `getRowsForObject(objectId, layout, objects)` helper but `DEFAULT_SLOT_LAYOUT` is unchanged.

**Files**: WorkspaceMain.tsx, viewGridLayout.ts, ViewGrid.tsx, appStore.ts, styles.css

---

### P104 — General propagation controller

**Problem**: The `propagation_frame` slot is a special-case view that only supports one fixed time-step animation. It cannot be reused for other objects, cannot tile multiple frames, and has no strip mode. Users who want to explore spatial dynamics must use this narrow panel.

**Design**: Replace the special-case panel with a `PropagationController` that wraps any spatial-capable view and adds playback, strip, and tiled-grid modes. It is a capability attached to a spatial object, not a standalone view type.

**Key decisions**:
- `PropagationController` is a wrapper component (not a new view type in the registry). It adds a toolbar row to an existing spatial view (e.g., `SpatialMapSliceView`, `PropagationView`).
- Playback modes:
  - `player`: play/pause/step buttons drive `timeCursor` through a range at a configurable `timestep`; the wrapped spatial view re-renders each frame
  - `strip`: renders N evenly spaced frames as a horizontal row of small spatial maps (fixed-size thumbnails)
  - `tiled`: renders a configurable NxM grid of frames
- Controller settings: `{ axis: "time", t0: number, t1: number, timestep: number, frameCount: number, colorScaleLock: boolean }`
- Color scale lock: in strip/tiled modes, all frames share a single min/max computed over all frames
- `player` mode re-uses the existing `AnimationController` rAF loop; `strip` and `tiled` modes make N parallel batch slice requests (not animation-driven)
- The `propagation_frame` slot in `DEFAULT_SLOT_LAYOUT` is replaced by a slot that renders `PropagationController` wrapping `SpatialMapSliceView`
- `viewRegistry.ts`: `propagation_frame` view descriptor is updated to describe the new controller interface
- The `AnimationController.tsx` component is kept but wired through `PropagationController` instead of used standalone

**Files**: PropagationView.tsx, AnimationController.tsx, viewGridLayout.ts, viewRegistry.ts, appStore.ts, styles.css

---

### P105 — Object-scoped processing UX

**Problem**: Processing is buried in the Explore tab sidebar and feels like a global action on the loaded signal. Users who want to apply a transform to a derived object (e.g., bandpass-filter a spectrogram) have no obvious way to do so. Applying a processing form requires clicking a button rather than pressing `Enter`.

**Design**: Move processing affordances next to each object's identity chip (from P100). Any compatible object can have transforms applied to it. The processing form is keyboard-submittable.

**Key decisions**:
- Each object chip in the workspace header (from P100) gets a "Process…" button that opens a processing popover or sidebar panel scoped to that object.
- `ProcessingPanel` gains a `tensorName: string` prop to target a specific tensor rather than always using `selectedTensor`.
- The Explore tab's Processing section remains as the global fallback (targeting `selectedTensor`), but the per-object action is the primary entry point.
- `Enter` submits the active processing form. `Esc` collapses/closes the processing panel. These are standard form keyboard behaviors — add `onKeyDown` handler on the form.
- Derived objects that are compatible with a transform (schema check via `getAvailableTransforms(tensor)`) show the full transform picker. Incompatible objects show a disabled state with a tooltip.
- Do not add a new server endpoint — re-use the existing `/api/v1/processing` route. Only the `tensor_name` in the payload changes.

**Files**: ProcessingPanel.tsx, ExploreTabContent.tsx, appStore.ts, styles.css

---

### P106 — Execution activity and transform feedback

**Problem**: Transform execution is silent. Users apply a bandpass filter or run PSD and get no feedback — no indication that something is running, how long it took, or whether it succeeded.

**Design**: Add a lightweight activity model that captures transform lifecycle events and surfaces them in the Pipeline tab and the developer console.

**Key decisions**:
- New `store/activityStore.ts` (Zustand, not persisted): `ActivityEntry[]` where each entry is `{ id: string; label: string; status: "running" | "done" | "error"; startedAt: number; endedAt?: number; elapsed?: number; params?: Record<string, unknown>; cacheHit?: boolean; error?: string }`.
- `addActivity(entry)` / `updateActivity(id, patch)` / `clearActivity(id)` store actions.
- Instrument three call sites:
  1. ProcessingPanel form submit → `addActivity` on submit, `updateActivity` on response
  2. DAG transform execution in PipelineTabContent → same pattern
  3. PSD live queries — optionally, only if a `psd_live` compute takes >300ms
- Console surface: `console.group("Transform: bandpass (t=1.2s)")` with params and cache hit/miss info. This is always-on in development builds, gated by `import.meta.env.DEV` in production.
- In-app surface: add an "Activity" collapsible section at the bottom of the Pipeline tab (`PipelineTabContent.tsx`). It shows the last 10 entries. Running entries show a spinner; done entries show elapsed time; errors show a red badge.
- Keep the store shallow — do not store large tensor metadata in activity entries.
- No polling or WebSocket required — activity entries are created synchronously on client-side call sites.

**Files**: new store/activityStore.ts, PipelineTabContent.tsx, WorkspaceMain.tsx, ProcessingPanel.tsx

---

### P107 — Channel-stack grouped labeling and track cleanup

**Problem**: Dense stacked-channel timeseries views flatten all channels onto a single Y-axis with flat integer labels (ch 0, ch 1, …). When electrode metadata provides spatial grouping (shanks, layers, regions), this hierarchy is lost. The hypnogram strip consumes a row in the default layout but does not add value in the majority of sessions.

**Design**: Add a two-level grouped axis label system for stacked channels. Remove the hypnogram from the default workspace layout.

**Key decisions**:
- Grouping source: the `ElectrodeLayoutDTO` from the server. Group channels by the first available non-trivial grouping dimension: shank > region > AP-index band (auto-generated 4-channel groups if no metadata exists).
- uPlot Y-axis customization: implement a custom `axes[0].values` function that returns `"  Group Label\nch N"` for the first channel in a group and `"ch N"` for subsequent channels. Render group separators as a wider tick.
- Alternatively (simpler): draw group labels as a second column to the left of the standard Y-axis using the `drawAxes` hook — only if electrode metadata provides groups.
- If no spatial metadata is available, fall back to the existing flat labels (no regression).
- Remove `hypnogram` from `DEFAULT_SLOT_LAYOUT` rows. The `HypnogramView` component and `showHypnogram` toggle in `appStore` are kept for users who add it manually, but the row is gone from the default.
- `appStore.showHypnogram` defaults stay as `true` for backward compatibility, but the layout no longer has a slot for it by default. Users can re-add via a layout preset.
- Update `layoutPresets.ts` to remove hypnogram from all built-in presets.

**Files**: TimeseriesSliceView.tsx, viewGridLayout.ts, layoutPresets.ts, appStore.ts, styles.css

---

## Guardrails

- object layout is a workspace concern — it must not mutate server-side tensor state or shared navigation state
- snapped duration presets set exact `viewportDuration` state, not relative zoom deltas
- `PropagationController` wraps existing spatial views — it does not create a new rendering backend
- processing remains transform-driven and schema-aware — no hardcoded signal assumptions
- cleanup should remove confusing chrome, not hide it behind more toggles
- activity entries are client-side only — no new server endpoint
- all current tests and builds must continue to pass

## Exit criteria

Treat M10 as done when:

- workspace objects are explicit chips in the header, showing source vs derived type, with visibility toggles
- duration presets snap the viewport to an exact window centered on the time cursor
- the navigator has a persistent, draggable selected-time cursor line
- timeseries Y-mode is a visible 3-way `Auto | Fixed | Fit` selector with stable per-mode behavior
- processing can be launched from any compatible object chip, and the form submits on `Enter`
- `PropagationController` works in player, strip, and tiled modes for any spatial tensor
- transform runs emit activity log entries visible in the Pipeline tab
- stacked channel views show grouped two-level axis labels when electrode metadata supports it
- the hypnogram row is removed from all default layout presets
- frontend builds clean and all tests pass
