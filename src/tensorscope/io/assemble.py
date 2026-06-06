"""Assemble multi-tensor / multi-probe sessions from in-memory DataArrays.

Pure, no server deps. See ``docs/design/neuropixels-multiprobe.md`` §2.

The load-bearing idea: geometry rides on the DataArray as a per-channel
``depth`` coord, so a ``(time, channel)`` Neuropixels tensor and a
``(time, AP, ML)`` ECoG grid coexist in one session with their own geometry —
no session-wide probe binding needed. ``prepare_linear_probe`` stamps the
depth coord (the DV approximation), ``fs``, optional per-channel ``region``,
and a forward-compatible sync offset (Phase 2) onto an NP array.
"""

from __future__ import annotations

import numpy as np
import xarray as xr

__all__ = ["assemble_session", "prepare_linear_probe", "prepare_planar_probe"]


def prepare_linear_probe(
    data: xr.DataArray,
    *,
    depth: np.ndarray | list[float] | None = None,
    fs: float | None = None,
    region: np.ndarray | list[str] | None = None,
    trim_samples: int | None = None,
    time_offset_s: float | None = None,
) -> xr.DataArray:
    """Normalize a Neuropixels LFP array to the linear-probe contract.

    Parameters
    ----------
    data
        A ``(time, channel)`` array (``(channel, time)`` is transposed).
    depth
        Per-channel depth in µm (the dorsal→ventral approximation). Required
        unless the array already carries a ``depth`` channel coord. Length must
        equal the channel count.
    fs
        Sampling rate (Hz). Stored as the ``fs`` attr; if omitted, any existing
        ``fs`` attr is kept.
    region
        Optional per-channel anatomical label, stored as a ``region`` coord.
    trim_samples, time_offset_s
        Sync offset onto a shared session clock (Phase 2). ``time_offset_s``
        wins if both are given; otherwise it is derived sample-exactly as
        ``trim_samples / fs``. Stamped as the ``time_offset_s`` attr for the
        slice path to consume later; data is left untouched.

    Returns
    -------
    xr.DataArray
        A ``(time, channel)`` array with a ``depth`` coord, ``fs`` attr, and
        (optionally) ``region`` coord + ``time_offset_s`` attr.
    """
    if not isinstance(data, xr.DataArray):
        raise ValueError(f"data must be an xarray.DataArray, got {type(data)!r}")
    dims = set(data.dims)
    if dims != {"time", "channel"}:
        raise ValueError(
            f"linear probe must have dims {{'time','channel'}}, got {tuple(data.dims)}"
        )
    out = data.transpose("time", "channel")
    n_ch = int(out.sizes["channel"])

    if depth is not None:
        depth_arr = np.asarray(depth, dtype=float)
        if depth_arr.shape != (n_ch,):
            raise ValueError(
                f"depth length {depth_arr.shape} must match channel count ({n_ch},)"
            )
        out = out.assign_coords(depth=("channel", depth_arr))
    elif "depth" not in out.coords:
        raise ValueError(
            "linear probe needs a per-channel depth: pass depth=... or supply a "
            "'depth' coord on the channel dim"
        )

    if region is not None:
        region_arr = np.asarray(region, dtype=object)
        if region_arr.shape != (n_ch,):
            raise ValueError(
                f"region length {region_arr.shape} must match channel count ({n_ch},)"
            )
        out = out.assign_coords(region=("channel", region_arr))

    attrs = dict(out.attrs)
    if fs is not None:
        attrs["fs"] = float(fs)

    offset = _resolve_offset(time_offset_s, trim_samples, attrs.get("fs"))
    if offset is not None:
        attrs["time_offset_s"] = offset
        if trim_samples is not None:
            attrs["trim_samples"] = int(trim_samples)
    out = out.assign_attrs(attrs)
    return out


def _resolve_offset(
    time_offset_s: float | None,
    trim_samples: int | None,
    fs: float | None,
) -> float | None:
    """Resolve the shared-clock offset (seconds). ``time_offset_s`` wins."""
    if time_offset_s is not None:
        return float(time_offset_s)
    if trim_samples is not None:
        if fs is None:
            raise ValueError("trim_samples requires fs to derive a time offset")
        return float(trim_samples) / float(fs)
    return None


def prepare_planar_probe(
    data: xr.DataArray,
    *,
    x: np.ndarray | list[float],
    y: np.ndarray | list[float],
    z: np.ndarray | list[float] | None = None,
    shank: np.ndarray | list | None = None,
    region: np.ndarray | list[str] | None = None,
    fs: float | None = None,
    trim_samples: int | None = None,
    time_offset_s: float | None = None,
) -> xr.DataArray:
    """Normalize a probe with arbitrary 2-D electrode positions to the
    channel-native contract.

    The general case of :func:`prepare_linear_probe`: instead of a single
    ``depth`` axis, geometry rides as per-channel ``x``/``y`` (and optional
    ``z``, ``shank``) coords, so a non-rectangular layout — a 4-shank
    Neuropixels, an L-shaped or sparse ECoG, SEEG — is stored as exactly
    ``n_channels`` cells with no dense-lattice padding (faster + smaller; see
    ``bench/RESULTS.md``). A regular ECoG grid is just the special case where
    ``(x, y)`` land on a lattice.

    Parameters
    ----------
    data
        A ``(time, channel)`` array (``(channel, time)`` is transposed).
    x, y
        Per-channel electrode positions (any consistent unit, e.g. µm).
        Lengths must equal the channel count.
    z
        Optional per-channel depth/elevation, stored as a ``z`` coord.
    shank
        Optional per-channel shank/group id (for per-group CMR later), stored
        as a ``shank`` coord.
    region
        Optional per-channel anatomical label, stored as a ``region`` coord.
    fs, trim_samples, time_offset_s
        As in :func:`prepare_linear_probe` — ``fs`` attr and a
        forward-compatible shared-clock offset.

    Returns
    -------
    xr.DataArray
        A ``(time, channel)`` array carrying ``x``/``y`` (and optional ``z``,
        ``shank``, ``region``) coords, ``fs`` attr, and optional
        ``time_offset_s`` attr. Recognised as ``geometry="planar"`` by the
        server (``core.schema.geometry_kind``).
    """
    if not isinstance(data, xr.DataArray):
        raise ValueError(f"data must be an xarray.DataArray, got {type(data)!r}")
    dims = set(data.dims)
    if dims != {"time", "channel"}:
        raise ValueError(
            f"planar probe must have dims {{'time','channel'}}, got {tuple(data.dims)}"
        )
    out = data.transpose("time", "channel")
    n_ch = int(out.sizes["channel"])

    def _per_channel(arr, label, dtype):
        a = np.asarray(arr, dtype=dtype)
        if a.shape != (n_ch,):
            raise ValueError(f"{label} length {a.shape} must match channel count ({n_ch},)")
        return a

    coords = {
        "x": ("channel", _per_channel(x, "x", float)),
        "y": ("channel", _per_channel(y, "y", float)),
    }
    if z is not None:
        coords["z"] = ("channel", _per_channel(z, "z", float))
    if shank is not None:
        coords["shank"] = ("channel", _per_channel(shank, "shank", object))
    if region is not None:
        coords["region"] = ("channel", _per_channel(region, "region", object))
    out = out.assign_coords(coords)

    attrs = dict(out.attrs)
    if fs is not None:
        attrs["fs"] = float(fs)
    offset = _resolve_offset(time_offset_s, trim_samples, attrs.get("fs"))
    if offset is not None:
        attrs["time_offset_s"] = offset
        if trim_samples is not None:
            attrs["trim_samples"] = int(trim_samples)
    out = out.assign_attrs(attrs)
    return out


def assemble_session(tensors: dict[str, xr.DataArray]) -> dict[str, xr.DataArray]:
    """Validate a ``{name: DataArray}`` mapping for ``create_server_state``.

    Light, non-coercing validation — each tensor must be a DataArray carrying a
    ``time`` dim. Geometry is already encoded per-tensor (AP/ML grid vs. depth
    coord), so this just guards against obvious mistakes and returns the dict
    ready to hand to the server. The first key becomes the active tensor.
    """
    if not tensors:
        raise ValueError("assemble_session needs at least one tensor")
    for name, da in tensors.items():
        if not isinstance(da, xr.DataArray):
            raise ValueError(f"tensor {name!r} must be an xarray.DataArray, got {type(da)!r}")
        if "time" not in da.dims:
            raise ValueError(f"tensor {name!r} must have a 'time' dimension, got {tuple(da.dims)}")
    return dict(tensors)
