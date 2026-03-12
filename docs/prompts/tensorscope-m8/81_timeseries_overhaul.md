# P81 — Timeseries Interaction Overhaul

**Fixes:** B1 (Y-axis zoom resets), B3 (timeseries goes blank), F1 (two Y modes), F2 (time scale selector), F3 (relative time labels), F4 (persistent time cursor)

## Problem

Multiple timeseries interaction bugs and missing features:
1. Y-axis zoom resets immediately because uPlot auto-ranges Y on every redraw
2. Chart goes blank after layout changes (container size 0 during transition)
3. No separate amplitude gain mode
4. Absolute datetime labels are meaningless for neuroelectrophysiology
5. No persistent time cursor visualization
6. No way to set a preferred time scale

## Changes

### 1. Fix Y-axis zoom reset (B1)

**Root cause:** uPlot's default Y-axis `range` function auto-fits data on every redraw. When the user manually sets Y scale via `chart.setScale("y", ...)`, the next redraw (from data change, resize, or cursor sync) recalculates Y bounds from data.

**Fix:** Add a custom `range` function on the Y axis that respects manually-set bounds:

```typescript
// In chart config
axes: [
  { /* x axis */ },
  {
    stroke: "#8b949e",
    ticks: { stroke: "#30363d" },
    grid: { stroke: "#21262d" },
  },
],
scales: {
  y: {
    range: (u, dataMin, dataMax) => {
      // If user has manually set Y bounds, respect them
      if (yLockedRef.current) return yLockedRef.current;
      return [dataMin, dataMax];
    },
  },
},
```

Add `yLockedRef = useRef<[number, number] | null>(null)` — set by Y-axis gestures, cleared on data change or reset.

The gesture handlers (`onWheelYAxis`) should set `yLockedRef.current = [newMin, newMax]` after computing the new scale, then call `chart.redraw()` to apply.

### 2. Two Y-axis interaction modes (F1)

Add a new tool to `useChartTools`: `"yZoom" | "yGain"`.

**Mode A — Y-scale zoom (yZoom):** Free zoom on Y axis. Scroll on Y gutter expands/contracts Y range. Signal can clip beyond boundaries. This is the Shift+wheel behavior currently, promoted to a named mode.

```typescript
// yZoom mode: zoom around cursor Y position
const yCursor = yMax + yFrac * (yMin - yMax);
yLockedRef.current = [
  yCursor + (yMin - yCursor) * factor,
  yCursor + (yMax - yCursor) * factor,
];
chart.redraw();
```

**Mode B — Amplitude gain (yGain):** Scale signal amplitude without changing Y-axis scale or channel gaps. This works by modifying the data values, not the Y scale. Each channel's waveform grows/shrinks around its offset center.

Implementation: maintain a `gainMultiplier` ref (starts at 1.0). On Y-gutter scroll in gain mode:
```typescript
gainMultiplier *= factor;
// Rebuild uPlot data with scaled values:
// For each channel i: scaledValues[i] = offset[i] + (rawValues[i] - offset[i]) * gainMultiplier
chart.setData(rebuildScaledData(rawData, gainMultiplier));
```

This keeps Y-axis range and channel positions fixed while visually increasing waveform amplitude.

Add two buttons to `ChartToolbar`:
- "Y Zoom" button (magnifier icon or `⤓`) — sets yZoom mode
- "Gain" button (`±` or amplitude icon) — sets yGain mode
- Active mode highlighted

### 3. Fix timeseries blank after layout changes (B3)

**Root cause:** When a sibling view is toggled, the container's size transitions through 0. The ResizeObserver fires with width=0, and uPlot sets size to 0. When the container expands again, the chart doesn't recover.

**Fix:** In the ResizeObserver callback, skip size updates when width or height is 0:

```typescript
const ro = new ResizeObserver((entries) => {
  const rect = entries[0]?.contentRect;
  if (!rect || rect.width < 10 || rect.height < 10) return; // skip degenerate sizes
  if (chartRef.current) {
    chartRef.current.setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
  }
});
```

Also: change chart height from fixed `260` to `100%` of container, using the ResizeObserver height. This allows the chart to fill its ViewPanel slot properly.

```typescript
// Initial creation: use container height
const height = el.clientHeight || 260;
const chart = new uPlot({ width, height, ... }, data, el);

// ResizeObserver: use both dimensions
chartRef.current.setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
```

### 4. Relative time labels (F3)

Replace uPlot's default X-axis formatting. The default formats absolute datetime. Override with a custom `values` function:

```typescript
axes: [
  {
    stroke: "#8b949e",
    ticks: { stroke: "#30363d" },
    grid: { stroke: "#21262d" },
    values: (u, vals) => vals.map((v) => formatRelativeTime(v)),
  },
],
```

```typescript
function formatRelativeTime(seconds: number): string {
  if (seconds < 0.001) return `${(seconds * 1e6).toFixed(0)} µs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(1)} ms`;
  if (seconds < 60) return `${seconds.toFixed(3)} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1)}`;
}
```

### 5. Persistent time cursor line (F4)

Add a draw hook that renders a vertical line at the current `selection.time`, always visible (not just on hover):

```typescript
hooks: {
  draw: [
    // Existing event markers hook...
    // New: persistent time cursor
    (u) => {
      const t = selectionTimeRef.current;
      if (t == null || !Number.isFinite(t)) return;
      const x = Math.round(u.valToPos(t, "x", true));
      if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
      const ctx = u.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, u.bbox.top);
      ctx.lineTo(x, u.bbox.top + u.bbox.height);
      ctx.stroke();
      ctx.restore();
    },
  ],
},
```

Add a ref `selectionTimeRef` that tracks `selection.time` and triggers `chart.redraw()` when it changes.

### 6. Time scale selector (F2)

Add a `TimeScaleSelector` component rendered in the timeseries ViewPanel header or ChartToolbar area. Presets:

```typescript
const TIME_SCALES = [
  { label: "10ms", seconds: 0.01 },
  { label: "50ms", seconds: 0.05 },
  { label: "100ms", seconds: 0.1 },
  { label: "500ms", seconds: 0.5 },
  { label: "1s", seconds: 1 },
  { label: "5s", seconds: 5 },
  { label: "10s", seconds: 10 },
];
```

Clicking a preset calls `setTimeWindow([cursor - half, cursor + half])` centered on the current `timeCursor`. This updates the selection store, which triggers data refetch for the new window.

**Initial scale:** On first load (when `timeWindow` is the full recording range), apply 1s scale centered on `timeCursor`. Add `initialTimeScale` to selection store or apply in the first `initFromDTO` call.

**Interaction priority:** The latest tool (navigator drag-zoom vs. time scale button) dictates the window. Both go through the same `setTimeWindow()` path, so whoever calls last wins naturally.

## Files to modify

- `frontend/src/components/views/TimeseriesSliceView.tsx` — Y-axis range lock, gain mode, relative time labels, persistent cursor, resize fix, dynamic height
- `frontend/src/components/views/useChartTools.ts` — add `yMode: "yZoom" | "yGain"` to GestureTool or as separate state
- `frontend/src/components/views/ChartToolbar.tsx` — add Y-zoom and Gain buttons, time scale selector
- `frontend/src/store/selectionStore.ts` — optional: initial time scale on first load
- `frontend/src/styles.css` — time scale selector styling

## Acceptance criteria

- Y-axis zoom persists across redraws until reset
- Gain mode scales waveform amplitude without changing Y-axis or channel positions
- Chart never goes blank during layout transitions
- X-axis shows relative time (seconds), not datetime
- White vertical cursor line visible at selected time position
- Time scale buttons change the visible window centered on cursor
- App starts with 1s time scale (not full recording)
- Build passes, all tests pass
