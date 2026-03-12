# P83 — PSD Server Endpoint (cogpy Multitaper)

**Implements:** F5 backend — server-side PSD computation using cogpy's `psd_multitaper`

## Problem

The current PSD views only work on tensors that already have a `freq` dimension (pre-computed spectrograms). The user needs on-the-fly PSD computation for the visible time window of any raw signal tensor `(time, AP, ML)` or `(time, channel)`.

## Design

Add a new view type `"psd_live"` that computes PSD on-the-fly during `apply_slice_request`. This view type:
1. Accepts a raw signal tensor (must have `time` dimension)
2. Windows by the requested time range
3. Applies processing pipeline (CMR, bandpass, etc.)
4. Calls `cogpy.core.spectral.psd.psd_multitaper` to compute per-channel PSD
5. Returns an xarray DataArray with dims `(freq, AP, ML)` or `(freq, channel)`

### cogpy API

```python
from cogpy.core.spectral.psd import psd_multitaper

# Signature:
# psd_multitaper(arr, fs, *, NW=4, K=None, fmin=0.0, fmax=None, detrend=True, axis=-1)
#
# arr: (..., time) shaped numpy array
# fs: sampling rate in Hz
# Returns: (psd, freqs) where psd is (..., freq) shaped
```

### Implementation in `apply_slice_request`

After processing but before channel selection, add:

```python
if request.view_type == "psd_live" and "time" in sliced.dims:
    # Infer sampling rate
    time_vals = np.asarray(sliced.coords["time"].values, dtype=float)
    fs = 1.0 / np.median(np.diff(time_vals)) if len(time_vals) > 1 else 1.0

    # PSD params from request (with defaults)
    nw = float(request.psd_params.get("NW", 4)) if request.psd_params else 4.0
    fmax = float(request.psd_params.get("fmax", 100)) if request.psd_params else 100.0

    # Reshape: move time to last axis for cogpy
    time_axis = list(sliced.dims).index("time")
    non_time_dims = [d for d in sliced.dims if d != "time"]
    arr = np.asarray(sliced.transpose("time", *non_time_dims).values if non_time_dims
                     else sliced.values)

    # If multi-dim: flatten non-time dims, compute, reshape back
    if non_time_dims:
        orig_shape = arr.shape[1:]
        flat = arr.reshape(arr.shape[0], -1).T  # (n_ch, time)
        psd_vals, freqs = psd_multitaper(flat, fs, NW=nw, fmax=fmax)
        # psd_vals shape: (n_ch, freq)
        psd_vals = psd_vals.reshape(*orig_shape, -1)  # (...spatial, freq)
        # Transpose to (freq, ...spatial)
        n_freq = len(freqs)
        psd_vals = np.moveaxis(psd_vals, -1, 0)
    else:
        psd_vals, freqs = psd_multitaper(arr, fs, NW=nw, fmax=fmax)

    coords = {"freq": freqs}
    for d in non_time_dims:
        if d in sliced.coords:
            coords[d] = sliced.coords[d].values

    dims = ("freq",) + tuple(non_time_dims)
    sliced = xr.DataArray(psd_vals, dims=dims, coords=coords, attrs=dict(sliced.attrs))
```

### View registry update

Add `psd_live` to the view registry for raw signal tensors:

```python
_VIEW_REGISTRY: dict[tuple[str, ...], list[str]] = {
    ("time", "AP", "ML"): ["timeseries", "spatial_map", "propagation_frame", "navigator", "psd_live"],
    ("time", "channel"): ["timeseries", "navigator", "psd_live"],
    ("time", "freq", "AP", "ML"): ["spectrogram", "psd_spatial"],
    ("time", "freq", "channel"): ["spectrogram", "psd_average"],
}
```

### Request DTO update

Add optional `psd_params` field to `TensorSliceRequestDTO`:

```python
class TensorSliceRequestDTO(BaseModel):
    # ... existing fields ...
    psd_params: dict[str, float] | None = None  # NW, fmax, fmin
```

### Arrow IPC output

The result is `(freq, AP, ML)` or `(freq, channel)` — same shape as the existing `psd_average` output. The existing `encode_arrow_payload` handles this: DataFrame columns will be `["freq", "AP", "ML", "value"]` or `["freq", "channel", "value"]`.

The frontend can use the same `extractFreqCurve` decoder (for average) and a new `extractPSDHeatmap` decoder (for per-channel data).

### Three sub-views from one endpoint

The client sends ONE `psd_live` request per time window change. The response contains per-channel PSD data `(freq, AP, ML)`. The frontend then derives three views:

1. **PSD heatmap**: Use all rows directly — X=flattened channel index, Y=freq, color=power
2. **PSD average curve**: Group by freq, compute mean±std across channels
3. **PSD spatial map**: Filter to selected freq, then (AP, ML) → spatial heatmap

This means one server round-trip populates all three sub-views.

## Files to modify

- `src/tensorscope/server/state.py` — add `psd_live` handling in `apply_slice_request`, update `_VIEW_REGISTRY`
- `src/tensorscope/server/models.py` — add `psd_params` to `TensorSliceRequestDTO`

## Testing

Add a test in `tests/` that:
1. Creates a server state with a raw `(time, AP, ML)` tensor
2. Sends a `psd_live` slice request with a time range
3. Verifies the response has `freq` dimension and correct spatial dims
4. Verifies frequency values are clipped to fmax

```bash
conda run -n cogpy python -m pytest tests/test_psd_live.py -q
```

## Acceptance criteria

- `psd_live` view type available for all `(time, ...)` tensors
- Returns `(freq, AP, ML)` or `(freq, channel)` with cogpy multitaper PSD
- `psd_params.NW` controls time-bandwidth product (default 4)
- `psd_params.fmax` clips frequency range (default 100 Hz)
- Processing pipeline (CMR, bandpass, etc.) applied before PSD computation
- Arrow IPC payload decodable by existing frontend infrastructure
- All existing tests still pass
