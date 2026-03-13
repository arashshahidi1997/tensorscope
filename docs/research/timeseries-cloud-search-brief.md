# Timeseries Cloud Search Brief

## Goal

Research how established tools keep long, dense, multichannel timeseries views stable during:

- first load
- layout changes / hidden-to-visible transitions
- resize / maximize / restore
- pan / zoom
- live or incremental data updates

The immediate product issue is that TensorScope's `timeseries` panel sometimes renders blank on load, and can lose both waveform and x-axis after adjacent panel layout changes.

## Strongest Conclusion

Mature timeseries viewers do not treat the plot as a disposable React child. They keep a plotting object alive, constrain the visible viewport, and update size, data, and interaction state in place. They also avoid initializing against a zero-sized container and avoid trying to render the whole recording at once.

## Current TensorScope Context

- Frontend stack: React + TypeScript + `uPlot`
- File under active investigation: `frontend/src/components/views/TimeseriesSliceView.tsx`
- Data type: long neurophysiology recordings, multichannel traces
- Typical UX:
  - linked timeseries + navigator + spatial map + PSD panels
  - time-window fetches from backend
  - layout can change when sibling views are shown/hidden or maximized

## Observed Failure Mode

- The timeseries panel is sometimes blank on first load.
- After layout changes, the waveform and x-axis can disappear.
- The panel may recover only after another interaction.

## Working Hypotheses

1. Chart instance recreation during data refresh or layout changes is breaking internal state.
2. The chart is sometimes initialized while its container has zero or near-zero size.
3. Resize handling is racing with flex/grid layout settlement.
4. The implementation may be pushing full-resolution data through the renderer too often instead of using multiscale/downsampled display slices.
5. The view may not preserve x-scale / cursor / selection correctly across `setData()` and `setSize()`.

## Research Questions

1. How do mature tools avoid blank charts when a panel is mounted hidden or resized from zero width/height?
2. Do they keep a persistent chart/canvas object alive and update it incrementally, or recreate it?
3. How do they handle very long multichannel traces:
   - fixed viewport duration?
   - channel pagination / vertical scrolling?
   - decimation / min-max envelope downsampling?
   - server-side multiscale tiles?
4. How do they preserve interaction state across resize:
   - x-range
   - cursor position
   - selection window
5. What are the known failure patterns in Canvas / Qt / browser plotting stacks for offscreen or extreme-range data?
6. For `uPlot` specifically, what is the recommended pattern for:
   - resize
   - zoom-then-fetch
   - data updates without recreation
   - hidden container initialization

## Search Prompt

Use this prompt in Perplexity / Gemini / Claude / other cloud research tools:

```text
I’m debugging a scientific plotting UI for long multichannel neurophysiology timeseries.

Stack:
- React + TypeScript frontend
- uPlot for dense timeseries rendering
- linked views: timeseries, navigator, spatial map, PSD
- backend serves time-windowed slices

Problem:
- the timeseries panel is sometimes blank on initial load
- after layout changes (show/hide sibling panels, maximize/restore), the waveform and x-axis can disappear
- the issue looks like chart initialization or resize is happening when the container has zero or unstable dimensions
- there may also be instability from destroying/recreating the chart instance on data updates

I want examples from mature tools that handle long multichannel traces well:
- MNE / mne-qt-browser / PyQtGraph
- HiGlass
- EEGLAB eegplot
- uPlot demos/docs/issues
- other serious scientific viewers for dense time series

Please answer with:
1. the concrete architectural patterns these tools use for stability and performance
2. how they handle hidden containers / resize / offscreen rendering
3. how they avoid rendering the full recording at once
4. whether they rely on persistent chart instances, multiscale pyramids, clipping-to-view, downsampling, or channel pagination
5. any known anti-patterns that cause blank plots or axis disappearance
6. recommended implementation changes for a React + uPlot app

Prefer primary sources: official docs, source code, maintainers’ comments, issue threads, or technical blog posts from the project authors.
Include links.
```

## Initial Findings From Primary Sources

### 1. `uPlot`: persistent updates, resize-aware behavior, zoom-fetch pattern

- `uPlot` is explicitly positioned as a fast Canvas 2D renderer for dense timeseries, with strong zoom and cursor performance.
- The official demos include:
  - `Dynamic data update / streaming`
  - `Resize with window`
  - `Maintains location of cursor/select/hoverPts during resize (test)`
  - `Fetch & update data on zoom`
- That combination strongly suggests the intended pattern is:
  - keep one chart instance alive
  - update data and scales incrementally
  - preserve cursor/selection across resize
  - fetch new data on zoom, rather than rendering the full underlying dataset all the time
- This is closer to an imperative chart-controller model than recreate-on-props-change React usage.

Sources:

- https://leeoniya.github.io/uPlot/
- https://leeoniya.github.io/uPlot/demos/index.html
- https://github.com/leeoniya/uPlot

### 2. MNE: never show the full recording at once; use fixed-duration viewport + channel subset

- `mne.viz.plot_raw()` defaults to:
  - `duration=10.0`
  - `n_channels=20`
  - `decim='auto'`
  - `time_format='float'`
- MNE also supports `precompute` and optional OpenGL in the Qt backend.
- The pattern is clear:
  - show only a fixed time window
  - show only a subset of channels at once
  - decimate for display
  - optionally preprocess/precompute for smoother navigation

Sources:

- https://mne.tools/stable/generated/mne.viz.plot_raw.html
- https://github.com/mne-tools/mne-qt-browser

### 3. PyQtGraph: clip to visible x-range, auto-downsample, protect against extreme offscreen y-range

- `PlotDataItem` exposes:
  - `autoDownsample`
  - `downsampleMethod='peak'`
  - `clipToView`
  - `dynamicRangeLimit`
- The docs explicitly say clipping to the visible x-range can yield significant performance improvements.
- They also document a failure mode where plots can disappear at high magnification due to an upstream Qt issue, and `dynamicRangeLimit` exists to prevent that.
- This is directly relevant because your symptom includes disappearing plots under changing scales/layouts.

Sources:

- https://pyqtgraph.readthedocs.io/en/pyqtgraph-0.12.4/graphicsItems/plotdataitem.html
- https://pyqtgraph.readthedocs.io/en/pyqtgraph-0.14.0/_modules/pyqtgraph/graphicsItems/PlotDataItem.html
- https://pyqtgraph.readthedocs.io/en/pyqtgraph-0.12.4/graphicsItems/plotitem.html

### 4. HiGlass: multiscale server-side tiles matched to zoom level and location

- HiGlass describes its architecture as map-like, with the server delivering small chunks that match the current zoom level and location.
- `clodius` handles aggregation and tile generation.
- For truly large signals, this is the strongest architecture pattern: multiresolution server data, not a monolithic client trace.

Source:

- https://docs.higlass.io/

### 5. EEGLAB: scrolling browser with channel subset and explicit zoom mode

- EEGLAB’s scrolling data browser shows a subset of channels and provides vertical scrolling plus explicit zoom mode.
- The important pattern is again constrained viewport, not “draw everything”.

Source:

- https://eeglab.org/tutorials/06_RejectArtifacts/Scrolling_data.html

## Cross-Tool Pattern Summary

These tools converge on the same ideas:

1. Keep the visible time window small and explicit.
2. Do not render all channels at once when channel count is large.
3. Do not reinitialize the renderer on every data change.
4. Clip work to the visible x-range.
5. Downsample for display, preferably with min/max or peak-preserving methods.
6. Preserve interaction state across resize.
7. For truly long signals, use multiscale server-side data products.
8. Guard against initializing a renderer inside a zero-size or hidden container.

## Revised Hypothesis Ranking

### Most likely

1. Initialization against an unstable or zero-size container.
2. Destroy/recreate lifecycle tied to React renders or prop churn.
3. Over-rendering too much data for the current viewport.

### Also plausible

4. Interaction state not being reapplied after update or resize.

## Likely Anti-Patterns For TensorScope

1. Creating the `uPlot` instance before the panel has a settled non-zero size.
2. Destroying and recreating `uPlot` whenever `slice.payload` changes.
3. Replacing data without preserving current x-scale.
4. Rendering too much raw data directly instead of viewport-specific or multiscale slices.
5. Coupling chart lifecycle to React render timing rather than to container readiness.
6. Allowing resize callbacks to propagate transient collapse sizes during show/hide/maximize transitions.

## Immediate Implementation Direction

For TensorScope specifically, the external evidence points toward:

1. One persistent `uPlot` instance per panel.
2. Create only after container width and height are both stable and non-zero.
3. Update via `setData()` and `setScale()`, not destroy/recreate.
4. Preserve x-range, cursor, and selection across updates and resize.
5. Start with a short default window like 0.5–10s, not the whole recording.
6. Consider display downsampling or server-side multiscale slices for the timeseries panel.
7. Consider channel pagination / vertical scrolling once channel count grows.

## React + uPlot Architecture Recommendation

### 1. Make chart lifetime independent from slice lifetime

- Create one `uPlot` instance per mounted panel.
- Destroy only on unmount or on rare structural option changes that truly require re-init.
- Data refresh, pan, zoom, and resize should all be imperative updates on the existing chart.

### 2. Gate creation on container readiness

- Observe the container with `ResizeObserver`.
- Do not instantiate while width or height is zero.
- Require one or two stable animation frames after layout transitions before first create or major resize.
- Ignore transient zero-size measurements during collapse/hide/maximize transitions.

### 3. Treat timeseries as a viewport, not as the recording

- Default visible duration should be bounded, roughly 1–10 s.
- Visible channel count should be bounded.
- Backend should return only the slice needed for display.
- Display samples should be decimated toward pixel density, ideally with peak-preserving min/max envelope logic.

### 4. Preserve x-state explicitly across updates

Persist in app/controller state:

- `xMin`, `xMax`
- cursor x/time
- selection window
- optional hover/snapped sample state

Then on refresh:

- call `setData(newData, false)` when appropriate
- explicitly restore x-scale if needed
- explicitly restore cursor and selection state

## Timeseries Gesture Review

### Current TensorScope behavior

The current timeseries implementation in [frontend/src/components/views/TimeseriesSliceView.tsx](/storage2/arash/projects/tensorscope/frontend/src/components/views/TimeseriesSliceView.tsx) and [frontend/src/components/views/useChartTools.ts](/storage2/arash/projects/tensorscope/frontend/src/components/views/useChartTools.ts) already separates X and Y interactions:

- X-axis:
  - mouse wheel over plot area: zoom X around cursor
  - click-drag in `zoom` tool: box zoom X
  - click-drag in `pan` tool: pan X
- Y-axis gutter:
  - wheel in `yZoom` mode: zoom Y range around cursor
  - wheel in `yGain` mode: scale waveform amplitude around each channel offset

That means TensorScope already has:

- two X interaction modes: `zoom`, `pan`
- two Y wheel modes: `yZoom`, `yGain`

### Recommended Bokeh-consistent model

To feel more natural to Bokeh users, the interaction model should be phrased as axis-specific tool semantics rather than as a mix of toolbar state and modifier-like behavior.

Recommended target:

- X axis: two modes
  - `zoom`: scroll zooms X
  - `pan`: click-drag pans X
- Y axis: three modes
  - `zoom`: scroll on Y gutter zooms Y range
  - `pan`: click-drag on Y gutter pans Y range
  - `scale up`: `Shift` + scroll on Y gutter changes amplitude gain without redefining the visible Y range

### Why this is closer to Bokeh

Bokeh users expect a small set of tool concepts:

- wheel zoom changes range
- pan drag translates range
- modifier keys refine an existing gesture rather than introduce a completely separate mental model

Under that convention, TensorScope's current `yGain` should not be presented as a peer of `zoom` and `pan`. It is better treated as a modified Y-axis zoom gesture: `Shift` + wheel on the Y gutter.

### Concrete recommendation for TensorScope

1. Keep X behavior as it is now.
2. Rename Y behavior in the UI so the main Y modes are `Zoom` and `Pan`.
3. Move amplitude scaling out of the toolbar mode switch and make it `Shift` + Y-wheel.
4. Add Y-gutter drag handling for Y-pan, so Y has the same zoom/pan split that Bokeh users already know from 2D plots.
5. Keep the amplitude operation implemented as gain on the traces, not as Y-range translation; only the gesture mapping should change.

### Proposed user-facing description

Timeseries axis gestures:

- X axis
  - Scroll: zoom time
  - Drag: pan time
- Y axis
  - Scroll: zoom amplitude range
  - Drag: pan amplitude range
  - `Shift` + scroll: scale waveform amplitude up/down

This gives TensorScope a cleaner rule set:

- plain scroll = zoom
- plain drag = pan
- `Shift` + scroll on Y = scale amplitude

That is simpler, more internally consistent, and closer to what experienced Bokeh users will expect.

### 5. Separate zoom interaction from data acquisition

- User pans or zooms.
- App computes a requested x-range.
- Backend returns a display-appropriate slice at suitable resolution.
- Existing chart updates in place.

This matches uPlot's zoom-fetch pattern and HiGlass's zoom-level-dependent chunking.

## Concrete Implementation Spec For `TimeseriesSliceView.tsx`

1. Replace any construct-on-data-change flow with a persistent chart controller stored in a ref.
2. Add a container readiness state machine:
   - `unmeasured`
   - `measured_zero`
   - `measured_nonzero_unstable`
   - `ready`
3. Use `ResizeObserver` on the chart container.
4. On resize:
   - schedule work with `requestAnimationFrame`
   - ignore transient zero sizes
   - call `u.setSize({ width, height })` only after settled measurement
5. On data change:
   - do not destroy
   - call `setData()`
   - preserve or restore x-scale explicitly
6. Keep separate view-model state for:
   - `xRange`
   - cursor
   - selection
   - visible channels
7. Add display decimation:
   - client-side min/max envelope as a first pass, or
   - backend multiscale slices as the long-term solution
8. Add a visible-duration cap and channel pagination/scrolling before attempting whole-record rendering.

## Codex Prompt

```text
Refactor `frontend/src/components/views/TimeseriesSliceView.tsx` to follow a persistent chart-controller architecture.

Requirements:
- Keep one uPlot instance alive for the lifetime of the mounted panel.
- Do not destroy/recreate the chart on `slice.payload` changes.
- Gate initial creation on a container with stable non-zero width and height.
- Use ResizeObserver + requestAnimationFrame to handle size changes.
- Ignore transient zero-size measurements during layout transitions.
- Preserve x-range, cursor, and selection state across `setData()` and `setSize()`.
- Treat the chart as a viewport: keep visible duration bounded and prepare for decimated display data.
- Do not make chart existence depend on a transient `selection` object.

Implementation notes:
- Introduce a small controller layer in the component or adjacent helper.
- Separate chart creation, size reconciliation, data reconciliation, and selection reconciliation into distinct effects/functions.
- Avoid structural chart option changes on normal data updates.
- If the current data pipeline still delivers too much data, add a clear TODO hook for display decimation or multiscale backend slices.

Success criteria:
- No blank panel on initial load.
- No disappearing waveform/x-axis after sibling layout changes.
- Maximize/restore and show/hide transitions preserve the rendered trace.
- Panning/zooming keeps working without requiring chart recreation.
```

## Bottom Line

This is probably not an isolated plotting bug. It is a view-lifecycle contract bug.

The target behavior is a stable browser widget with:

- persistent chart instance
- explicit viewport contract
- size-gated initialization
- imperative resize and data-update flow
- preserved interaction state
- decimated or multiscale display data
