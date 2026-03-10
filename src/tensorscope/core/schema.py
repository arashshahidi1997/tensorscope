"""
Data schema validation and normalization for TensorScope.

Enforces canonical conventions:
- Grid data: (time, AP, ML) dimension order
- Flat data: (time, channel) with AP/ML coords
- Row-major flattening: channel = ap * n_ml + ml

See the TensorScope design principles (§4.3, §4.4) for boundary validation rules.
"""

from __future__ import annotations

import numpy as np
import xarray as xr


class SchemaError(ValueError):
    """Raised when data doesn't conform to expected schema."""


def _is_strictly_increasing(time_vals: np.ndarray) -> bool:
    if time_vals.size < 2:
        return True
    tv = np.asarray(time_vals)
    if np.issubdtype(tv.dtype, np.datetime64):
        ti = tv.astype("datetime64[ns]").astype("int64")
        return bool(np.all(np.diff(ti) > 0))
    try:
        tf = tv.astype(float)
    except Exception:  # noqa: BLE001
        return False
    return bool(np.all(np.diff(tf) > 0))


def _extract_ap_ml_from_channel(data: xr.DataArray) -> tuple[np.ndarray, np.ndarray]:
    if (
        "AP" in data.coords
        and "ML" in data.coords
        and data.coords["AP"].dims == ("channel",)
        and data.coords["ML"].dims == ("channel",)
    ):
        return np.asarray(data.coords["AP"].values), np.asarray(data.coords["ML"].values)

    try:
        idx = data["channel"].to_index()
        names = set(getattr(idx, "names", []) or [])
        if {"AP", "ML"}.issubset(names):
            return np.asarray(idx.get_level_values("AP")), np.asarray(idx.get_level_values("ML"))
    except Exception:  # noqa: BLE001
        pass

    raise SchemaError(
        "Data must have dimensions {'time','AP','ML'} (grid) or {'time','channel'} (flat with AP/ML coords). "
        "Flat data must provide AP/ML per-channel coords (AP(channel), ML(channel)) "
        "or a MultiIndex channel with AP/ML levels."
    )


def validate_and_normalize_grid(data: xr.DataArray) -> xr.DataArray:
    """
    Validate and normalize iEEG grid data to canonical schema.

    Canonical schema: (time, AP, ML)
    - time: strictly monotonically increasing
    - AP: integer indices (0..n_ap-1)
    - ML: integer indices (0..n_ml-1)

    Accepted inputs:
    - Grid form with dims containing {'time','AP','ML'} in any order.
    - Flat form with dims containing {'time','channel'} *and* AP/ML per-channel coords.

    Parameters
    ----------
    data : xr.DataArray
        Input data

    Returns
    -------
    xr.DataArray
        Normalized data with dims ('time','AP','ML')

    Raises
    ------
    SchemaError
        If data is missing required dimensions or has invalid coordinates
    """
    if not isinstance(data, xr.DataArray):
        raise SchemaError(f"data must be an xarray.DataArray, got {type(data)!r}")

    dims = set(data.dims)
    if {"time", "AP", "ML"}.issubset(dims):
        out = data
        if out.dims != ("time", "AP", "ML"):
            out = out.transpose("time", "AP", "ML")
    elif {"time", "channel"}.issubset(dims):
        flat = data.transpose("time", "channel")
        ap_vals, ml_vals = _extract_ap_ml_from_channel(flat)

        ap_u = np.unique(ap_vals)
        ml_u = np.unique(ml_vals)
        n_ap = int(ap_u.size)
        n_ml = int(ml_u.size)

        n_ch = int(flat.sizes["channel"])
        if n_ch != n_ap * n_ml:
            raise SchemaError(
                "Flat grid-capable data must cover a dense AP×ML grid: "
                f"got channel={n_ch} but AP×ML={n_ap}×{n_ml}={n_ap * n_ml}."
            )

        ap_to_i = {v: i for i, v in enumerate(ap_u)}
        ml_to_i = {v: i for i, v in enumerate(ml_u)}

        t_len = int(flat.sizes["time"])
        grid = np.full((t_len, n_ap, n_ml), np.nan, dtype=np.float64)
        vals = np.asarray(flat.values)
        for ch in range(n_ch):
            ai = ap_to_i[ap_vals[ch]]
            mi = ml_to_i[ml_vals[ch]]
            grid[:, ai, mi] = vals[:, ch]
        if np.isnan(grid).any():
            raise SchemaError("Flat data is missing one or more (AP, ML) locations required for a dense grid.")

        out = xr.DataArray(
            grid,
            dims=("time", "AP", "ML"),
            coords={
                "time": flat["time"].values,
                "AP": np.arange(n_ap),
                "ML": np.arange(n_ml),
                "AP_src": ("AP", ap_u),
                "ML_src": ("ML", ml_u),
            },
            attrs=dict(flat.attrs),
            name=flat.name,
        )
    else:
        raise SchemaError(
            "Data must have dimensions {'time','AP','ML'} (grid) or {'time','channel'} (flat with AP/ML coords); "
            f"got {set(data.dims)}."
        )

    time_vals = np.asarray(out.coords["time"].values)
    if not _is_strictly_increasing(time_vals):
        raise SchemaError("time coordinate must be monotonically increasing")

    n_ap = int(out.sizes["AP"])
    n_ml = int(out.sizes["ML"])

    ap_vals = np.asarray(out.coords["AP"].values) if "AP" in out.coords else np.arange(n_ap)
    ml_vals = np.asarray(out.coords["ML"].values) if "ML" in out.coords else np.arange(n_ml)

    if ap_vals.shape != (n_ap,):
        raise SchemaError(f"AP coordinate must be 1D with length {n_ap}, got shape {ap_vals.shape}")
    if ml_vals.shape != (n_ml,):
        raise SchemaError(f"ML coordinate must be 1D with length {n_ml}, got shape {ml_vals.shape}")

    if not np.array_equal(ap_vals, np.arange(n_ap)):
        out = out.assign_coords(AP_src=("AP", ap_vals), AP=np.arange(n_ap))
    if not np.array_equal(ml_vals, np.arange(n_ml)):
        out = out.assign_coords(ML_src=("ML", ml_vals), ML=np.arange(n_ml))

    return out


def flatten_grid_to_channels(data: xr.DataArray) -> xr.DataArray:
    """
    Flatten (time, AP, ML) to (time, channel) using row-major order.

    Flattening convention (MANDATORY):
        channel = ap * n_ml + ml

    Parameters
    ----------
    data : xr.DataArray
        Grid data with dims (time, AP, ML)

    Returns
    -------
    xr.DataArray
        Flat data with dims (time, channel) and AP(channel), ML(channel) coords.
    """
    if not isinstance(data, xr.DataArray):
        raise SchemaError(f"data must be an xarray.DataArray, got {type(data)!r}")
    if data.dims != ("time", "AP", "ML"):
        raise SchemaError(f"Expected dims (time, AP, ML), got {data.dims}")

    flat = data.stack(channel=("AP", "ML"))

    n_ml = int(data.sizes["ML"])
    ap_vals = np.asarray(flat.coords["AP"].values)
    ml_vals = np.asarray(flat.coords["ML"].values)

    expected = ap_vals * n_ml + ml_vals
    actual = np.arange(int(flat.sizes["channel"]))
    if not np.array_equal(expected, actual):
        raise SchemaError(
            "Flattening produced incorrect channel order. "
            "This should never happen - please file a bug report."
        )

    return flat
