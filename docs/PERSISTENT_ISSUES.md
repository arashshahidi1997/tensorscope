# Persistent Issues & Architecture Notes

## Current Known Issues

### 1. Timeseries blank on initial load
**Status**: Partially mitigated (double-RAF resize fix), may still occur
**Root cause**: uPlot is created while the flex container has 0×0 dimensions. The chart renders at size 0 and never self-corrects.
**Current fix**: Double `requestAnimationFrame` in TimeseriesSliceView to re-measure after layout settles.
**Proper fix**: Adopt the old tensorscope's pattern — defer chart creation until the container has non-zero dimensions via ResizeObserver, or use LTTB server-side downsampling with a dedicated data pipeline.

### 2. No smart downsampling — full data sent to frontend
**Status**: Not implemented
**Problem**: The server sends the full time slice as Arrow IPC. For large recordings (256 channels × 1250 Hz × multi-second windows), this means megabytes per request. The frontend renders all points, causing:
- Slow network transfers
- High memory usage in the browser
- uPlot struggles with >10k points per channel

**Old tensorscope solution**: MinMaxLTTB downsampling (see Architecture section below).
**Required fix**: Server-side downsampling with a pixel budget parameter (e.g. `n_out=2000`). The `tsdownsample` library's `MinMaxLTTBDownsampler` preserves visual fidelity while reducing to ~2000 points per channel.

### 3. No lazy/chunked data loading for large files
**Status**: `.compute()` loads entire array into memory
**Problem**: The demo2 dataset is 768MB (int16) → ~1.5GB (float32) in memory. Larger recordings will OOM.
**Old tensorscope solution**: Dask-backed xarray arrays with per-window `.compute()` — only the visible time slice is materialized.
**Required fix**: Keep data as dask array in `ServerState`; only `.compute()` the sliced window in `apply_slice_request`.

### 4. Navigator zoom/pan doesn't use overview data
**Status**: Navigator fetches same-resolution data as timeseries
**Problem**: The full-recording overview should use a heavily downsampled version (~10k points total), not the same slice endpoint.
**Old tensorscope solution**: Static overview with ~10,000 points, pre-computed once at load time.

### 5. Processing applied to full tensor on every change
**Status**: Processing cache exists but recomputes entire tensor
**Problem**: Changing a filter parameter triggers reprocessing the entire dataset. For large recordings this is slow.
**Old tensorscope solution**: Processing applied only to the visible window on each render callback.

### 6. localStorage persistence conflicts
**Status**: Known UX issue
**Problem**: `useLayoutStore` uses Zustand `persist` middleware. Old localStorage values (e.g. `bottomPanelCollapsed: true`) override new defaults. Users who tested earlier versions see stale layout state.
**Workaround**: Clear `tensorscope:layout` from localStorage, or bump the persist `version`.

---

## Old CogPy TensorScope: Timeseries Architecture

The old tensorscope (Panel + HoloViews + Bokeh) achieved stable, responsive timeseries visualization through these key patterns:

### 1. MinMaxLTTB Downsampling

```python
from tsdownsample import MinMaxLTTBDownsampler

_ds = MinMaxLTTBDownsampler()

def _downsample(t, y, n_out=2000):
    if len(t) <= n_out:
        return t, y
    idx = _ds.downsample(t, y, n_out=n_out)
    return t[idx], y[idx]
```

- **Algorithm**: MinMaxLTTB (Largest-Triangle-Three-Buckets variant) from `tsdownsample` v0.1.3
- **Per-channel, per-render**: Applied on each zoom/pan, not upfront
- **Pixel budget**: `detail_px=2000` for detail view, `overview_px=10_000` for overview
- **Why it works**: Preserves peaks/troughs (unlike linear decimation), so waveforms look correct at any zoom level

### 2. Dynamic Loading via HoloViews DynamicMap

```python
self._range_stream = streams.RangeX(x_range=(t0, t0 + window_s))

self._detail_dmap = hv.DynamicMap(
    self._build_detail,
    streams=[self._range_stream]
)
```

- User pan/zoom fires `RangeX` stream with new `x_range`
- `_build_detail(x_range)` callback slices data → processes → downsamples → renders
- Only the visible time window is ever materialized from dask
- `RangeToolLink` connects overview strip to detail view bidirectionally

### 3. Window-Only Processing

```python
class ProcessingChain:
    def get_window(self, t0, t1, channels=None):
        # 1. Slice time (lazy dask operation)
        win = self._data.sel({self._time_dim: slice(t0, t1)})
        # 2. Materialize only the window
        win = win.compute()
        # 3. Apply filters only to this small chunk
        win = self._apply_cmr(win)
        win = self._apply_bandpass(win)
        win = self._apply_notch(win)
        return win
```

- Filters (bandpass, notch, CMR) applied **only to the visible window**
- No full-tensor preprocessing — instant response to filter parameter changes
- Channel subsetting via `isel(channel=...)` before compute

### 4. Three-Part Layout

1. **Overview strip** (static): ~10,000 downsampled points, mean of all channels, computed once
2. **Detail view** (dynamic): Current window, per-channel, ~2,000 points/channel after LTTB
3. **Window slider**: Adjusts visible window width (0.5–120s)

### 5. Data Flow

```
User Pan/Zoom
  → RangeX stream fires
  → DynamicMap callback:
    1. searchsorted to find time indices
    2. Dask slice → .compute() (only window)
    3. ProcessingChain filters (window only)
    4. MinMaxLTTB downsample (per channel)
    5. Build HoloViews Curve per channel
  → Bokeh renders in browser
```

### Key Files in Old Codebase

| File | Purpose |
|------|---------|
| `cogpy/core/plot/multichannel_viewer.py` | Main viewer: overview+detail, DynamicMap, LTTB |
| `cogpy/core/plot/processing_chain.py` | Window-only filter chain |
| `cogpy/core/plot/tensorscope/layers/timeseries.py` | Timeseries layer integration |
| `cogpy/core/plot/tensorscope/signal.py` | Signal object with independent processing |
| `cogpy/core/plot/tensorscope/cli.py` | CLI entry point, data loading |

---

## Recommendations for New TensorScope

To achieve parity with the old tensorscope's timeseries stability:

1. **Add server-side LTTB downsampling**: Install `tsdownsample`, add `n_out` parameter to `TensorSliceRequestDTO`. In `apply_slice_request`, downsample each channel to `n_out` points after slicing.

2. **Keep data dask-backed**: Don't `.compute()` the full tensor at load. Only materialize the requested time window in the slice handler.

3. **Pre-compute overview**: On tensor load, compute a ~10k-point overview (mean across channels, LTTB-downsampled). Serve this from a dedicated endpoint or cache it.

4. **Window-only processing**: Move filter application from full-tensor cache to per-request window processing. This makes filter parameter changes instant.

5. **Frontend pixel budget**: The frontend should send its container width as `n_out` in the slice request, so the server returns exactly the right number of points for the display resolution.
