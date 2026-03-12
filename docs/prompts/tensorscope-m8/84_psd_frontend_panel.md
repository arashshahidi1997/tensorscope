# P84 — PSD Frontend Panel (Three Linked Sub-Views)

**Implements:** F5 frontend — channel×freq heatmap, average PSD curve, spatial PSD map

**Depends on:** P80 (stable slot layout with PSD row), P83 (psd_live server endpoint)

## Design

The PSD row in the slot layout (from P80) contains three linked sub-views rendered from a single `psd_live` query response. All three share the frequency axis (Y-axis) and react to the same frequency cursor.

### Data flow

```
WorkspaceMain
  → useSliceQuery("psd_live", { time_range, psd_params })
  → decode Arrow IPC → (freq, AP, ML) or (freq, channel) table
  → extract three derived datasets:
      1. PSD heatmap data: channel × freq × power
      2. PSD average data: freq × mean_power × std_power
      3. PSD spatial data: AP × ML × power (at selected freq)
  → pass to three sub-view components
```

### Arrow decoding

Add to `frontend/src/api/arrow.ts`:

```typescript
type PSDHeatmapData = {
  freqs: number[];           // unique freq values (Y axis)
  channelLabels: string[];   // "AP0_ML0", "AP0_ML1", ... (X axis)
  matrix: Float64Array[];    // [freq_idx][channel_idx] = power
};

type PSDAvgData = {
  freqs: number[];      // Y axis (shared with heatmap)
  mean: number[];       // mean power across channels at each freq
  std: number[];        // std across channels at each freq
};

type PSDSpatialData = {
  cells: { ap: number; ml: number; value: number }[];
};

function extractPSDHeatmap(decoded: DecodedSlice): PSDHeatmapData { ... }
function extractPSDAverage(decoded: DecodedSlice): PSDAvgData { ... }
function extractPSDSpatialAtFreq(decoded: DecodedSlice, targetFreq: number): PSDSpatialData { ... }
```

### Sub-view components

#### 1. PSDHeatmapView

`frontend/src/components/views/PSDHeatmapView.tsx`

- Canvas 2D heatmap (same pattern as SpectrogramSliceView)
- X-axis: channels (AP×ML flattened into linear index, labeled)
- Y-axis: frequency (0 to fmax Hz, bottom=0, top=fmax) — **frequency is the vertical axis**
- Color: log10(power), using inferno-like colormap
- Click on canvas → update `freq` in selection store (no server round-trip)
- Horizontal cursor line at selected frequency
- Container fills its ViewPanel slot

#### 2. PSDCurveView

`frontend/src/components/views/PSDCurveView.tsx`

- uPlot chart with **rotated axes**: Y=frequency (shared with heatmap), X=power
- This is a vertical frequency axis with horizontal power — like a standard PSD plot rotated 90°
- Line: mean PSD across channels
- Band fill: ±1 std shading (using uPlot's band feature or custom draw hook)
- Horizontal cursor line at selected frequency (synced with heatmap)
- Click → update freq in store

**uPlot rotated plot approach:** uPlot doesn't natively support swapped axes. Two options:
- Option A: Use uPlot normally (X=freq, Y=power) but rotate the container 90° with CSS `transform: rotate(-90deg)`. This is hacky but works.
- Option B: Use Canvas 2D directly (same as spectrogram) and draw the curve manually. More control, less code complexity.

**Recommended: Option B (Canvas 2D).** Draw the mean curve and std band on a canvas with freq on Y and power on X. This gives full control over orientation and avoids uPlot axis gymnastics.

#### 3. PSDSpatialView

`frontend/src/components/views/PSDSpatialView.tsx`

- Reuse `SpatialMapSliceView` pattern (Canvas 2D grid renderer)
- Shows PSD power at the selected frequency as a spatial (AP×ML) heatmap
- Updates when `selection.freq` changes (client-side filter, no new server request)
- Click → select AP/ML position (same as spatial_map click handler)

### Integration in WorkspaceMain

Add a `psd_live` query alongside existing queries:

```typescript
const hasPSDLive = effectiveActiveViews.some(v =>
  v === "psd_heatmap" || v === "psd_curve" || v === "psd_spatial"
);

const psdLiveQuery = useSliceQuery(
  selectedTensor,
  hasPSDLive ? {
    view_type: "psd_live",
    selection: selectionDraft,
    time_range: safeWindow ? [safeWindow[0], safeWindow[1]] : undefined,
    psd_params: { NW: 4, fmax: 100 },
  } : null,
);
```

Build view elements for the PSD row:

```typescript
if (psdLiveQuery.data) {
  const decoded = decodeArrowSlice(psdLiveQuery.data);
  const heatmapData = extractPSDHeatmap(decoded);
  const avgData = extractPSDAverage(decoded);

  viewElements["psd_heatmap"] = (
    <PSDHeatmapView data={heatmapData} selection={selectionDraft} onSelectFreq={handleSelectFreq} />
  );
  viewElements["psd_curve"] = (
    <PSDCurveView data={avgData} selection={selectionDraft} onSelectFreq={handleSelectFreq} />
  );
  viewElements["psd_spatial"] = (
    <PSDSpatialView decoded={decoded} selectedFreq={selectionDraft.freq} ... />
  );
}
```

### PSD settings

Add a small settings bar in the PSD row header (or as a collapsible settings panel within the PSD heatmap ViewPanel). Controls:

- **fmax** slider: 50–500 Hz, default 100 Hz
- **NW** selector: 2, 3, 4, 6, 8 (time-bandwidth product), default 4

These params are stored in component state (not global store) and passed to the `psd_live` query. Changing them triggers a refetch.

### View registry updates

Add three new entries to `VIEW_DESCRIPTORS` in `viewRegistry.ts`:

```typescript
{ id: "psd_heatmap", label: "PSD Heatmap", requiredDims: ["time"], priority: 10 },
{ id: "psd_curve", label: "PSD Curve", requiredDims: ["time"], priority: 11 },
{ id: "psd_spatial", label: "PSD Spatial", requiredDims: ["time", "AP", "ML"], priority: 12 },
```

These are available for any tensor with a `time` dimension (PSD is computed on-the-fly).

### Colormap

Reuse the inferno-like colormap from SpectrogramSliceView. Apply log10 scaling to power values before color mapping.

## Files to create

- `frontend/src/components/views/PSDHeatmapView.tsx`
- `frontend/src/components/views/PSDCurveView.tsx`
- `frontend/src/components/views/PSDSpatialView.tsx`

## Files to modify

- `frontend/src/api/arrow.ts` — add `extractPSDHeatmap`, `extractPSDAverage`, `extractPSDSpatialAtFreq`
- `frontend/src/components/views/WorkspaceMain.tsx` — add psd_live query and view elements
- `frontend/src/registry/viewRegistry.ts` — register three new PSD views
- `frontend/src/components/views/viewGridLayout.ts` — PSD row slots already defined in P80; ensure view IDs match
- `frontend/src/styles.css` — PSD-specific styles (settings bar, canvas containers)

## Acceptance criteria

- PSD heatmap shows channels × frequency with power colormap
- PSD curve shows mean±std with frequency on Y-axis, power on X-axis
- PSD spatial map shows spatial power distribution at selected frequency
- All three update from a single server round-trip
- Frequency cursor synced across all three sub-views
- Clicking on heatmap or curve updates selected frequency (no server trip)
- PSD spatial map updates when frequency changes (client-side filter)
- Settings (fmax, NW) trigger refetch when changed
- Build passes, all tests pass
