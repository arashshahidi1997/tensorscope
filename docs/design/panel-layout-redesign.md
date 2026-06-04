# Panel-layout redesign — prune, rebalance, real presets

**Status:** spec (ready to implement)
**Created:** 2026-06-04
**Branch:** `refactor/ultracode-batch`
**Motivation:** critical review of the view-grid layout (this session). Core
principle restated by the owner: *seeing a tensor **spatially** is central,
alongside the **temporal** views* — the current layout under-serves space and
over-serves frequency.

## Problems (grounded in the current code)

1. **Spectral is over-represented.** 5 of ~14 views are frequency-domain
   (`spectrogram`/`spectrogram_live`, `psd_heatmap`, `psd_curve`, `psd_average`,
   `psd_spatial`). For a raw LFP tensor, `expandPSDLive` paints the heatmap +
   curve + spatial **trio** every render, plus the spectrogram.
2. **Spatial is demoted.** `DEFAULT_SLOT_LAYOUT`'s signal row is `timeseries`
   75% + `spatial_map` 25%; the richer spatial views (`psd_spatial`,
   `propagation_frame`) are buried in unrelated rows.
3. **Organized by view *type*, not workflow.** Six stacked rows (signal / psd /
   spectrogram / raster / event / trajectory) → a long vertical scroll; you
   can't see signal + space + frequency on one screen.
4. **Homeless views.** `psd_average`, `hypnogram`, `table` have no slot → they
   leak into the overflow "junk drawer."
5. **The presets are broken.** `LAYOUT_PRESETS` (Signal Inspection / Spatial
   Exploration / Spectral Analysis / Overview) each carry a `viewGridLayout`,
   but `ViewGrid` never reads it (it hardcodes `DEFAULT_SLOT_LAYOUT` /
   `PROBE_LANES_LAYOUT`). So they only toggle sidebar/inspector collapse — the
   view arrangement they advertise is dead code. **Misleading.**

## Target — named grid layouts (real presets)

Replace the single `DEFAULT_SLOT_LAYOUT` + the dead preset machinery with a set
of **functional** grid layouts, selected by a topbar picker and driven by the
existing `appStore.gridLayout` field (the one Track C proved out). Each preset
defines its slot layout **and** the active-view set scoped to its slots (so no
overflow), plus optional per-slot tensor overrides.

| id | label | rows (region · widthFraction) | scoped active views |
|---|---|---|---|
| `overview` *(default)* | Overview | **signal**: timeseries L·0.6 + spatial_map/depth_map R·0.4 · **spectral**: spectrogram(_live) L·0.65 + **psd_spatial** R·0.35 · raster 1.0 · event_average 1.0 · trajectory 1.0 | ts, spatial_map, depth_map, spectrogram(_live), **psd_spatial**, raster, event_average, trajectory, propagation_frame |
| `signal_space` | Signal + Space | **signal**: timeseries L·0.55 + spatial_map/depth_map R·0.45 · **dynamics**: propagation_frame 1.0 | ts, spatial_map, depth_map, propagation_frame |
| `spectral` | Spectral | **tf**: spectrogram(_live) 1.0 · **psd**: psd_heatmap L·0.5 + psd_curve C·0.25 + psd_spatial R·0.25 | spectrogram(_live), psd_heatmap, psd_curve, psd_spatial, psd_average |
| `events` | Events | **signal**: timeseries 1.0 (event overlay) · **triggered**: event_average L·0.6 + raster R·0.4 | ts, event_average, raster |
| `probe_lanes` | Probe lanes | *(Track C, unchanged)* | *(unchanged)* |

**PSD pruning.** The heatmap + curve **trio lives only in `spectral`**. The
default `overview` shows just **`psd_spatial`** (the *spatial* frequency view —
the one that earns its place by the spatial-centrality principle) paired beside
the spectrogram, so frequency and space sit side-by-side. `psd_average` (the
duplicate power-vs-freq curve from the precomputed path) is no longer slotted in
the default — it appears only in `spectral` (and only when a precomputed `freq`
tensor exists). No view *types* are deleted (server contract + 4D ortho path
intact); we prune what shows **by default**.

**Spatial elevation.** `spatial_map` goes 25%→40% (overview) / 45%
(signal_space), co-equal with the timeseries; `psd_spatial` is promoted into the
default spectral row; `propagation_frame` (the spatial *movie*) anchors
`signal_space`.

## UX — the picker

Generalize `ProbeLanesToggle` → **`GridLayoutPicker`** (topbar dropdown, mirrors
`LayoutPresetPicker`): lists the presets above; `probe_lanes` shown only when the
session has ≥2 tensors. Selecting one calls `setGridLayout(id)`, which sets
`gridLayout` + the scoped `activeViews` + (for `probe_lanes`) `multiProbeMode` +
`PROBE_LANES_OVERRIDES`. `ViewGrid` already reads `gridLayout`.

**Dead-code cleanup.** Strip the (unused) `viewGridLayout` field from
`LAYOUT_PRESETS` + `LayoutPreset` so the shell presets are honestly
shell-only (sidebar/inspector/bottom-panel). The shell `LayoutPresetPicker`
stays for those; the new `GridLayoutPicker` owns the view arrangement.

## Implementation steps

1. `viewGridLayout.ts`: `GRID_LAYOUTS: Record<GridLayoutId, ViewSlotLayout>`
   (keep `DEFAULT_SLOT_LAYOUT` = `GRID_LAYOUTS.overview`, `PROBE_LANES_LAYOUT` =
   `GRID_LAYOUTS.probe_lanes`). + `GRID_LAYOUT_VIEWS: Record<GridLayoutId, string[]>`
   (scoped active views per preset).
2. `appStore.ts`: extend `GridLayoutId`; `setGridLayout(id)` applies
   `gridLayout` + `activeViews` (from a small per-id config) + overrides/mode.
3. `ViewGrid.tsx`: `const layout = GRID_LAYOUTS[gridLayout]`.
4. `GridLayoutPicker.tsx` (replaces `ProbeLanesToggle`), mounted in `LayoutShell`.
5. `layoutPresets.ts` + `layoutStore`: drop the dead `viewGridLayout` field.
6. Tests: each preset's scoped active-views + layout slots are well-formed and
   collision-free; `probe_lanes` keeps its overrides. Gates green; live-verify
   the picker on the multiprobe + audit sessions.

## Acceptance / non-goals

- Single-probe `overview` shows ≤2 frequency panels (spectrogram + psd_spatial),
  spatial co-equal with the timeseries; no overflow junk-drawer.
- Switching presets re-scopes the view set deterministically; `probe_lanes`
  unchanged.
- **Non-goal:** deleting view *types*, changing server views, per-slot spectral
  ranges. Hypnogram-as-navigator-lane is noted but deferred.
