"""
Data schema validation and geometry classification for TensorScope.

Canonical spatial representation (ADR-0010): **channel-native** — ``(time,
channel)`` with geometry carried as per-channel coordinates (``x``/``y`` [+
``z``/``shank``/``region``], or ``depth`` for linear probes). Geometry is *data,
not shape*, so non-rectangular probes (4-shank Neuropixels, sparse/L-shaped
ECoG, SEEG) cost nothing extra.

The dense ``(time, AP, ML)`` grid is a **detected fast path** for genuine dense
lattices (regular ECoG), NOT a storage requirement:
- ``geometry_kind(da)`` classifies ``grid | planar | linear | flat``.
- ``validate_and_normalize_grid`` reshapes flat data to ``(time, AP, ML)`` ONLY
  when it tiles a complete lattice; otherwise it stays channel-native.
- ``to_channel_native(da)`` losslessly demotes a grid to the canonical form.
- Row-major lattice flattening convention: ``channel = ap * n_ml + ml``.

See ADR-0010 and the TensorScope design principles (§4.3, §4.4).
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


def _extract_ap_ml_optional(data: xr.DataArray) -> tuple[np.ndarray, np.ndarray] | None:
    """Non-raising variant of ``_extract_ap_ml_from_channel`` — returns ``None``
    when the flat data carries no AP/ML per-channel coords (a legitimate state
    for a non-grid probe), instead of raising."""
    try:
        return _extract_ap_ml_from_channel(data)
    except SchemaError:
        return None


def _is_dense_grid(ap_vals: np.ndarray, ml_vals: np.ndarray, n_ch: int) -> bool:
    """True when per-channel AP/ML cover a *complete* dense lattice — every
    ``n_ap_unique × n_ml_unique`` cell present exactly once. Only then is it
    safe (and meaningful) to reshape flat data into a ``(time, AP, ML)`` grid;
    a 4-shank probe / sparse ECoG fails this and stays channel-native."""
    n_ap = int(np.unique(ap_vals).size)
    n_ml = int(np.unique(ml_vals).size)
    if n_ch != n_ap * n_ml:
        return False
    pairs = {(float(a), float(m)) for a, m in zip(ap_vals, ml_vals)}
    return len(pairs) == n_ch


def channel_positions(data: xr.DataArray) -> tuple[np.ndarray, np.ndarray] | None:
    """Per-channel ``(x, y)`` positions for a *planar* (arbitrary 2-D) layout,
    or ``None``. Reads explicit ``x``/``y`` channel coords. Linear (``depth``)
    and grid (``AP``/``ML``) geometries are classified separately by
    :func:`geometry_kind` — this is specifically the non-lattice case."""
    if (
        "x" in data.coords
        and "y" in data.coords
        and data.coords["x"].dims == ("channel",)
        and data.coords["y"].dims == ("channel",)
    ):
        return (
            np.asarray(data.coords["x"].values, dtype=float),
            np.asarray(data.coords["y"].values, dtype=float),
        )
    return None


def geometry_kind(data: xr.DataArray) -> str:
    """Classify a tensor's electrode geometry from its dims/coords.

    Returns ``"grid"`` (dense AP×ML lattice — either ``(time, AP, ML)`` dims or
    flat channels whose AP/ML cover a complete lattice), ``"planar"`` (flat
    channels with arbitrary ``x``/``y`` positions), ``"linear"`` (flat channels
    with a ``depth`` coord — e.g. a Neuropixels DV strip), or ``"flat"`` (flat
    channels with no geometry). This is the single source of truth the server
    and views should consult instead of sniffing dims ad hoc.
    """
    dims = set(str(d) for d in data.dims)
    if {"AP", "ML"}.issubset(dims):
        return "grid"
    if "channel" in dims:
        if channel_positions(data) is not None:
            return "planar"
        if "depth" in data.coords:
            return "linear"
        ap_ml = _extract_ap_ml_optional(data)
        if ap_ml is not None and _is_dense_grid(ap_ml[0], ap_ml[1], int(data.sizes["channel"])):
            return "grid"
        return "flat"
    return "flat"


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
        n_ch = int(flat.sizes["channel"])
        ap_ml = _extract_ap_ml_optional(flat)

        if ap_ml is None or not _is_dense_grid(ap_ml[0], ap_ml[1], n_ch):
            # Channel-native: a non-rectangular probe (4-shank Neuropixels,
            # sparse/L-shaped ECoG, SEEG), a linear depth strip, or plain flat
            # data. Geometry rides as per-channel coords (x/y, depth, or sparse
            # AP/ML); do NOT force a dense AP×ML lattice — that wastes cells and
            # is measurably slower (bench/RESULTS.md). Validate the time axis and
            # return the data as-is, geometry preserved.
            time_vals = (
                np.asarray(flat.coords["time"].values) if "time" in flat.coords else None
            )
            if time_vals is not None and not _is_strictly_increasing(time_vals):
                raise SchemaError("time coordinate must be monotonically increasing")
            return flat

        ap_vals, ml_vals = ap_ml
        ap_u = np.unique(ap_vals)
        ml_u = np.unique(ml_vals)
        n_ap = int(ap_u.size)
        n_ml = int(ml_u.size)

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


def to_channel_native(data: xr.DataArray) -> xr.DataArray:
    """Demote a spatial tensor to the canonical channel-native form (lossless).

    ``(time, AP, ML)`` grid → ``(time, channel)`` in row-major order
    (``channel = ap*n_ml + ml``), carrying plain per-channel ``AP``/``ML`` coords
    (an integer ``channel`` index, NOT a MultiIndex — so it serialises cleanly).
    A dense lattice is still detected as the grid fast path by
    :func:`geometry_kind` and can be re-gridded with
    :func:`validate_and_normalize_grid`; position-based spatial ops read
    ``(x, y) = (ML, AP)`` via ``core.geometry.resolve_positions``.
    Already-channel-native input is returned unchanged. See ADR-0010.
    """
    if not isinstance(data, xr.DataArray):
        raise SchemaError(f"data must be an xarray.DataArray, got {type(data)!r}")
    dims = set(str(d) for d in data.dims)
    if "channel" in dims and "AP" not in dims and "ML" not in dims:
        return data
    if {"time", "AP", "ML"}.issubset(dims):
        g = data.transpose("time", "AP", "ML")
        n_ap = int(g.sizes["AP"])
        n_ml = int(g.sizes["ML"])
        ap_coord = np.asarray(g.coords["AP"].values) if "AP" in g.coords else np.arange(n_ap)
        ml_coord = np.asarray(g.coords["ML"].values) if "ML" in g.coords else np.arange(n_ml)
        vals = np.asarray(g.values).reshape(int(g.sizes["time"]), n_ap * n_ml)
        return xr.DataArray(
            vals,
            dims=("time", "channel"),
            coords={
                "time": g.coords["time"].values,
                "channel": np.arange(n_ap * n_ml),
                "AP": ("channel", np.repeat(ap_coord, n_ml)),
                "ML": ("channel", np.tile(ml_coord, n_ap)),
            },
            attrs=dict(g.attrs),
            name=g.name,
        )
    raise SchemaError(
        f"to_channel_native expects (time, AP, ML) or (time, channel); got {tuple(data.dims)}"
    )
