"""Built-in transform definitions for TensorScope.

Each transform is a declarative definition with input/output specs and
a compute function.  Heavy implementations may delegate to cogpy or
scipy; placeholder implementations are used where the full algorithm
is not yet needed (M4 scope: establish architecture).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import xarray as xr

from tensorscope.core.transforms.registry import (
    InputSpec,
    OutputSpec,
    ParamSpec,
    TransformDefinition,
    TransformRegistry,
)


# ---------------------------------------------------------------------------
# Compute functions
# ---------------------------------------------------------------------------

def _compute_bandpass(inputs: list[xr.DataArray], params: dict[str, Any]) -> xr.DataArray:
    """Bandpass filter along time axis."""
    data = inputs[0]
    lo = float(params["lo_hz"])
    hi = float(params["hi_hz"])
    order = int(params.get("order", 4))

    # Infer sampling rate.
    time_vals = np.asarray(data.coords["time"].values, dtype=float)
    if len(time_vals) < 2:
        return data
    fs = 1.0 / np.median(np.diff(time_vals))

    try:
        from scipy.signal import butter, sosfiltfilt
        sos = butter(order, [lo, hi], btype="bandpass", fs=fs, output="sos")
        filtered = sosfiltfilt(sos, data.values, axis=data.dims.index("time"))
        return xr.DataArray(
            filtered, dims=data.dims, coords=data.coords, attrs=data.attrs,
        )
    except ImportError:
        # Fallback: return unfiltered (scipy not available).
        return data


def _compute_spectrogram(inputs: list[xr.DataArray], params: dict[str, Any]) -> xr.DataArray:
    """Short-time Fourier transform → power spectrogram."""
    data = inputs[0]
    window_s = float(params.get("window_s", 0.5))
    overlap = float(params.get("overlap", 0.5))

    time_vals = np.asarray(data.coords["time"].values, dtype=float)
    if len(time_vals) < 2:
        raise ValueError("Not enough time points for spectrogram")
    fs = 1.0 / np.median(np.diff(time_vals))

    nperseg = max(4, int(window_s * fs))
    noverlap = int(nperseg * overlap)

    try:
        from scipy.signal import spectrogram as scipy_spectrogram
    except ImportError:
        raise ImportError("scipy is required for spectrogram transform")

    # For multi-channel data, compute spectrogram along time axis.
    non_time_dims = [d for d in data.dims if d != "time"]

    if non_time_dims:
        # Flatten non-time dims into a single axis using raw numpy.
        # This avoids xarray stacking issues with coord name conflicts.
        arr = np.asarray(data.values)  # (time, d1, d2, ...)
        orig_shape = arr.shape[1:]  # spatial dims shape
        n_time = arr.shape[0]
        n_ch = int(np.prod(orig_shape))
        flat = arr.reshape(n_time, n_ch)  # (time, n_ch)

        freqs, times, Sxx = scipy_spectrogram(
            flat, fs=fs, nperseg=nperseg, noverlap=noverlap, axis=0,
        )
        # Sxx shape: (freq, n_ch, time_segments)
        Sxx = np.transpose(Sxx, (2, 0, 1))  # (time_seg, freq, n_ch)
        # Reshape back to original spatial dims.
        out_shape = (Sxx.shape[0], Sxx.shape[1]) + orig_shape
        Sxx = Sxx.reshape(out_shape)

        t_start = float(time_vals[0])
        time_coords = t_start + times
        coords: dict[str, Any] = {"time": time_coords, "freq": freqs}
        for d in non_time_dims:
            if d in data.coords:
                coords[d] = data.coords[d].values

        ordered_dims = ("time", "freq") + tuple(non_time_dims)
        result = xr.DataArray(
            Sxx, dims=ordered_dims, coords=coords, attrs=data.attrs,
        )
    else:
        vals = np.asarray(data.values)
        freqs, times, Sxx = scipy_spectrogram(
            vals, fs=fs, nperseg=nperseg, noverlap=noverlap,
        )
        t_start = float(time_vals[0])
        time_coords = t_start + times
        # Sxx shape: (freq, time_seg) → transpose to (time, freq)
        result = xr.DataArray(
            Sxx.T,
            dims=("time", "freq"),
            coords={"time": time_coords, "freq": freqs},
            attrs=data.attrs,
        )

    return result


def _compute_psd(inputs: list[xr.DataArray], params: dict[str, Any]) -> xr.DataArray:
    """Power spectral density via Welch's method."""
    data = inputs[0]
    window_s = float(params.get("window_s", 1.0))
    overlap = float(params.get("overlap", 0.5))

    time_vals = np.asarray(data.coords["time"].values, dtype=float)
    if len(time_vals) < 2:
        raise ValueError("Not enough time points for PSD")
    fs = 1.0 / np.median(np.diff(time_vals))
    nperseg = max(4, int(window_s * fs))
    noverlap = int(nperseg * overlap)

    try:
        from scipy.signal import welch
    except ImportError:
        raise ImportError("scipy is required for PSD transform")

    time_axis = list(data.dims).index("time")
    non_time_dims = [d for d in data.dims if d != "time"]

    if non_time_dims:
        stacked = data.stack(_ch=non_time_dims)
        vals = np.asarray(stacked.values)  # (time, _ch)
        freqs, pxx = welch(vals, fs=fs, nperseg=nperseg, noverlap=noverlap, axis=0)
        # pxx shape: (freq, _ch)
        result = xr.DataArray(
            pxx,
            dims=("freq", "_ch"),
            coords={"freq": freqs, "_ch": stacked.coords["_ch"]},
            attrs=data.attrs,
        )
        result = result.unstack("_ch")
        ordered_dims = ["freq"] + non_time_dims
        result = result.transpose(*ordered_dims)
    else:
        vals = np.asarray(data.values)
        freqs, pxx = welch(vals, fs=fs, nperseg=nperseg, noverlap=noverlap)
        result = xr.DataArray(
            pxx, dims=("freq",), coords={"freq": freqs}, attrs=data.attrs,
        )

    return result


def _compute_bandpower(inputs: list[xr.DataArray], params: dict[str, Any]) -> xr.DataArray:
    """Band power: integrate spectrogram over frequency bands."""
    data = inputs[0]
    bands = params["bands"]  # list of {"name": str, "lo_hz": float, "hi_hz": float}

    if "freq" not in data.dims:
        raise ValueError("bandpower requires input with 'freq' dimension")

    freq_vals = np.asarray(data.coords["freq"].values, dtype=float)
    non_freq_dims = [d for d in data.dims if d != "freq"]

    band_results = []
    band_names = []
    for band in bands:
        lo = float(band["lo_hz"])
        hi = float(band["hi_hz"])
        mask = (freq_vals >= lo) & (freq_vals <= hi)
        if not mask.any():
            continue
        band_data = data.isel(freq=mask).mean(dim="freq", keep_attrs=True)
        band_results.append(band_data)
        band_names.append(band["name"])

    if not band_results:
        raise ValueError("No frequency bands matched the available frequencies")

    result = xr.concat(band_results, dim="band")
    result = result.assign_coords(band=band_names)

    # Reorder dims: put band after time if time is present.
    if "time" in result.dims:
        ordered = ["time", "band"] + [d for d in non_freq_dims if d != "time"]
    else:
        ordered = ["band"] + non_freq_dims
    result = result.transpose(*ordered)

    return result


def _compute_coherence(inputs: list[xr.DataArray], params: dict[str, Any]) -> xr.DataArray:
    """Pairwise coherence between channels (placeholder for large-scale)."""
    data = inputs[0]

    if "channel" not in data.dims and ("AP" not in data.dims or "ML" not in data.dims):
        raise ValueError("coherence requires channel or AP/ML dimensions")

    # For M4: simplified implementation using scipy.signal.coherence
    # on a subset of channel pairs.
    window_s = float(params.get("window_s", 1.0))
    max_pairs = int(params.get("max_pairs", 100))

    time_vals = np.asarray(data.coords["time"].values, dtype=float)
    if len(time_vals) < 2:
        raise ValueError("Not enough time points for coherence")
    fs = 1.0 / np.median(np.diff(time_vals))
    nperseg = max(4, int(window_s * fs))

    try:
        from scipy.signal import coherence as scipy_coherence
    except ImportError:
        raise ImportError("scipy is required for coherence transform")

    # Flatten to (time, channel).
    if "AP" in data.dims and "ML" in data.dims:
        flat = data.stack(channel=("AP", "ML"))
    else:
        flat = data

    n_ch = int(flat.sizes["channel"])
    vals = np.asarray(flat.values)  # (time, channel)

    # Build sparse pair list (limit to max_pairs).
    pairs: list[tuple[int, int]] = []
    for i in range(n_ch):
        for j in range(i + 1, n_ch):
            pairs.append((i, j))
            if len(pairs) >= max_pairs:
                break
        if len(pairs) >= max_pairs:
            break

    if not pairs:
        raise ValueError("Need at least 2 channels for coherence")

    # Compute coherence for each pair.
    freqs = None
    coh_values = []
    pair_indices = []
    for i, j in pairs:
        f, cxy = scipy_coherence(vals[:, i], vals[:, j], fs=fs, nperseg=nperseg)
        if freqs is None:
            freqs = f
        coh_values.append(cxy)
        pair_indices.append((i, j))

    coh_array = np.stack(coh_values, axis=0)  # (n_pairs, freq)
    pair_labels = [f"{i}-{j}" for i, j in pair_indices]

    result = xr.DataArray(
        coh_array,
        dims=("pair", "freq"),
        coords={"pair": pair_labels, "freq": freqs},
        attrs={**data.attrs, "pair_indices": pair_indices},
    )
    return result


def _compute_event_align(inputs: list[xr.DataArray], params: dict[str, Any]) -> xr.DataArray:
    """Extract event-aligned windows from a time-series tensor."""
    data = inputs[0]
    event_times = params["event_times"]  # list of float (seconds)
    pre_s = float(params.get("pre_s", 0.5))
    post_s = float(params.get("post_s", 1.0))

    if "time" not in data.dims:
        raise ValueError("event_align requires 'time' dimension")

    time_vals = np.asarray(data.coords["time"].values, dtype=float)
    fs = 1.0 / np.median(np.diff(time_vals)) if len(time_vals) > 1 else 1.0
    n_pre = int(pre_s * fs)
    n_post = int(post_s * fs)
    window_len = n_pre + n_post

    non_time_dims = [d for d in data.dims if d != "time"]
    time_axis = list(data.dims).index("time")

    windows = []
    valid_event_indices = []
    for idx, t_evt in enumerate(event_times):
        # Find nearest time index.
        center = int(np.argmin(np.abs(time_vals - t_evt)))
        start = center - n_pre
        end = center + n_post
        if start < 0 or end > len(time_vals):
            continue
        win = data.isel(time=slice(start, end))
        windows.append(win.values)
        valid_event_indices.append(idx)

    if not windows:
        raise ValueError("No valid event windows found")

    stacked = np.stack(windows, axis=0)  # (n_events, window_len, ...)
    time_offsets = np.linspace(-pre_s, post_s, window_len, endpoint=False)

    # Build coordinates.
    coords: dict[str, Any] = {
        "event": valid_event_indices,
        "time_offset": time_offsets,
    }
    # Carry non-time coords through.
    for d in non_time_dims:
        if d in data.coords:
            coords[d] = data.coords[d].values

    result = xr.DataArray(
        stacked,
        dims=("event", "time_offset") + tuple(non_time_dims),
        coords=coords,
        attrs={**data.attrs, "event_times": [float(event_times[i]) for i in valid_event_indices]},
    )
    return result


def _compute_dim_reduction(inputs: list[xr.DataArray], params: dict[str, Any]) -> xr.DataArray:
    """Dimensionality reduction (PCA) along channel dimension."""
    data = inputs[0]
    n_components = int(params.get("n_components", 3))
    method = params.get("method", "pca")

    if method != "pca":
        raise ValueError(f"Only 'pca' method is supported in M4 (got {method!r})")

    # Flatten to (time, features).
    if "AP" in data.dims and "ML" in data.dims:
        flat = data.stack(channel=("AP", "ML"))
    elif "channel" in data.dims:
        flat = data
    else:
        raise ValueError("dim_reduction requires channel or AP/ML dimensions")

    vals = np.asarray(flat.values)  # (time, channel)
    n_time, n_ch = vals.shape
    n_components = min(n_components, n_ch, n_time)

    # Center the data.
    mean = vals.mean(axis=0)
    centered = vals - mean

    # SVD-based PCA (no sklearn dependency needed).
    U, S, Vt = np.linalg.svd(centered, full_matrices=False)
    components = U[:, :n_components] * S[:n_components]

    result = xr.DataArray(
        components,
        dims=("time", "component"),
        coords={
            "time": data.coords["time"].values,
            "component": list(range(n_components)),
        },
        attrs={
            **data.attrs,
            "explained_variance_ratio": (S[:n_components] ** 2 / (S**2).sum()).tolist(),
        },
    )
    return result


def _compute_prewhiten(inputs: list[xr.DataArray], params: dict[str, Any]) -> xr.DataArray:
    """Prewhiten: remove temporal autocorrelation (simple AR(1) decorrelation)."""
    data = inputs[0]
    if "time" not in data.dims:
        raise ValueError("prewhiten requires 'time' dimension")

    time_axis = list(data.dims).index("time")
    vals = np.asarray(data.values, dtype=float)

    # Simple first-difference prewhitening.
    diff = np.diff(vals, axis=time_axis)
    time_vals = np.asarray(data.coords["time"].values)
    new_time = (time_vals[:-1] + time_vals[1:]) / 2

    coords = dict(data.coords)
    coords["time"] = new_time

    result = xr.DataArray(
        diff, dims=data.dims, coords=coords, attrs=data.attrs,
    )
    return result


# ---------------------------------------------------------------------------
# Transform definitions
# ---------------------------------------------------------------------------

BANDPASS = TransformDefinition(
    name="bandpass",
    description="Bandpass filter along time axis",
    input_spec=InputSpec(required_dims=("time",)),
    param_schema={
        "lo_hz": ParamSpec(dtype="float", description="Low cutoff frequency (Hz)", min_value=0.1),
        "hi_hz": ParamSpec(dtype="float", description="High cutoff frequency (Hz)", min_value=0.1),
        "order": ParamSpec(dtype="int", default=4, description="Filter order", min_value=1, max_value=8),
    },
    output_spec=OutputSpec(dims=("time",), coord_rules={"time": "passthrough"}),
    compute=_compute_bandpass,
)

SPECTROGRAM = TransformDefinition(
    name="spectrogram",
    description="Short-time Fourier transform power spectrogram",
    input_spec=InputSpec(required_dims=("time",)),
    param_schema={
        "window_s": ParamSpec(dtype="float", default=0.5, description="STFT window length (seconds)", min_value=0.01),
        "overlap": ParamSpec(dtype="float", default=0.5, description="Window overlap fraction", min_value=0.0, max_value=0.99),
    },
    output_spec=OutputSpec(dims=("time", "freq"), dtype="float64"),
    compute=_compute_spectrogram,
)

PSD = TransformDefinition(
    name="psd",
    description="Power spectral density via Welch's method",
    input_spec=InputSpec(required_dims=("time",)),
    param_schema={
        "window_s": ParamSpec(dtype="float", default=1.0, description="Welch window length (seconds)", min_value=0.01),
        "overlap": ParamSpec(dtype="float", default=0.5, description="Window overlap fraction", min_value=0.0, max_value=0.99),
    },
    output_spec=OutputSpec(dims=("freq",), dtype="float64"),
    compute=_compute_psd,
)

BANDPOWER = TransformDefinition(
    name="bandpower",
    description="Band power: integrate over frequency bands",
    input_spec=InputSpec(required_dims=("freq",)),
    param_schema={
        "bands": ParamSpec(
            dtype="list",
            description="List of {name, lo_hz, hi_hz} band definitions",
            default=[
                {"name": "delta", "lo_hz": 0.5, "hi_hz": 4.0},
                {"name": "theta", "lo_hz": 4.0, "hi_hz": 8.0},
                {"name": "alpha", "lo_hz": 8.0, "hi_hz": 13.0},
                {"name": "beta", "lo_hz": 13.0, "hi_hz": 30.0},
                {"name": "gamma", "lo_hz": 30.0, "hi_hz": 100.0},
            ],
        ),
    },
    output_spec=OutputSpec(dims=("band",), dtype="float64"),
    compute=_compute_bandpower,
)

COHERENCE = TransformDefinition(
    name="coherence",
    description="Pairwise coherence between channels",
    input_spec=InputSpec(required_dims=("time",)),
    param_schema={
        "window_s": ParamSpec(dtype="float", default=1.0, description="Coherence window (seconds)", min_value=0.01),
        "max_pairs": ParamSpec(dtype="int", default=100, description="Maximum number of channel pairs", min_value=1),
    },
    output_spec=OutputSpec(dims=("pair", "freq"), dtype="float64"),
    compute=_compute_coherence,
)

EVENT_ALIGN = TransformDefinition(
    name="event_align",
    description="Extract event-aligned windows from time-series",
    input_spec=InputSpec(required_dims=("time",)),
    param_schema={
        "event_times": ParamSpec(dtype="list", description="Event onset times in seconds"),
        "pre_s": ParamSpec(dtype="float", default=0.5, description="Pre-event window (seconds)", min_value=0.0),
        "post_s": ParamSpec(dtype="float", default=1.0, description="Post-event window (seconds)", min_value=0.01),
    },
    output_spec=OutputSpec(dims=("event", "time_offset"), dtype="float64"),
    compute=_compute_event_align,
)

DIM_REDUCTION = TransformDefinition(
    name="dim_reduction",
    description="Dimensionality reduction (PCA) of multi-channel data",
    input_spec=InputSpec(required_dims=("time",)),
    param_schema={
        "n_components": ParamSpec(dtype="int", default=3, description="Number of components", min_value=1, max_value=50),
        "method": ParamSpec(dtype="str", default="pca", description="Reduction method", choices=("pca",)),
    },
    output_spec=OutputSpec(dims=("time", "component"), dtype="float64"),
    compute=_compute_dim_reduction,
)

PREWHITEN = TransformDefinition(
    name="prewhiten",
    description="Prewhiten: remove temporal autocorrelation",
    input_spec=InputSpec(required_dims=("time",)),
    param_schema={},
    output_spec=OutputSpec(dims=("time",), coord_rules={"time": "shortened"}),
    compute=_compute_prewhiten,
)

# All built-in transforms for bulk registration.
BUILTIN_TRANSFORMS: list[TransformDefinition] = [
    BANDPASS,
    SPECTROGRAM,
    PSD,
    BANDPOWER,
    COHERENCE,
    EVENT_ALIGN,
    DIM_REDUCTION,
    PREWHITEN,
]


def register_builtins(registry: TransformRegistry) -> None:
    """Register all built-in transforms into the given registry."""
    for defn in BUILTIN_TRANSFORMS:
        if defn.name not in registry:
            registry.register(defn)
