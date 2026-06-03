"""Adapters that build context tracks from raw session annotations.

A *context track* is an auxiliary, time-aligned strip shown under the main
signal — either a **categorical** band (brainstate, sleep stage) or a **scalar**
trace (speed, EMG, pupil). It generalizes the original single-brainstate slot:
brainstate becomes one categorical track among many.

Representation is deliberately plain: a track is a 1-D ``(time,)``
``xr.DataArray`` whose ``attrs`` carry ``track_kind`` (``"categorical"`` or
``"scalar"``) plus either ``state_names`` (categorical, comma-separated — the
existing brainstate convention reused by :func:`server.state.brainstate_intervals`)
or ``units`` (scalar). No new class threads across the io / core / server
boundary. See ``docs/design/neuropixels-multiprobe.md`` and the context-track
plan.

Pure: numpy / pandas / xarray only, no server deps.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import xarray as xr

__all__ = ["brainstate_track_from_epochs", "scalar_track_from_series"]


def _normalize_tag(tag: object) -> str:
    """Coerce an epochs ``tags`` cell to a single label string.

    NWB ``epochs.tags`` cells are arrays/lists (one label per epoch here); a
    plain string is also accepted. Empty cells become ``"none"``.
    """
    if tag is None:
        return "none"
    if isinstance(tag, (list, tuple, np.ndarray)):
        if len(tag) == 0:
            return "none"
        return str(tag[0])
    return str(tag)


def brainstate_track_from_epochs(
    df: pd.DataFrame,
    *,
    start_col: str = "start_time",
    stop_col: str = "stop_time",
    tag_col: str = "tags",
    step_s: float = 0.5,
) -> xr.DataArray:
    """Rasterize an interval/epoch table into a coded ``(time,)`` track.

    The pixecog NWB stores brainstate as an epochs ``TimeIntervals`` table
    (``start_time``, ``stop_time``, ``tags=[state]``). The server's brainstate
    machinery (meta, intervals, overlay) is built on a uniformly-sampled coded
    DataArray with a ``state_names`` attr, so this samples the epochs onto a
    uniform grid at ``step_s`` resolution and lets
    :func:`server.state.brainstate_intervals` re-derive merged intervals.

    Parameters
    ----------
    df
        Epoch table; one row per epoch.
    start_col, stop_col, tag_col
        Column names for interval bounds and the state label.
    step_s
        Grid spacing (seconds). Boundaries are accurate to ±``step_s``/2, which
        is ample for a coarse hypnogram band. Must be > 0.

    Returns
    -------
    xr.DataArray
        ``(time,)`` integer codes with ``attrs["track_kind"] == "categorical"``
        and ``attrs["state_names"]`` (comma-separated, code = index). Grid
        points falling in no epoch get a trailing ``"none"`` state (only added
        when such gaps exist).
    """
    if step_s <= 0:
        raise ValueError(f"step_s must be > 0, got {step_s}")
    for col in (start_col, stop_col, tag_col):
        if col not in df.columns:
            raise ValueError(f"epochs table missing column {col!r}")
    if len(df) == 0:
        raise ValueError("epochs table is empty")

    starts = np.asarray(df[start_col], dtype=float)
    stops = np.asarray(df[stop_col], dtype=float)
    labels = [_normalize_tag(t) for t in df[tag_col].tolist()]

    # Stable code map: states ordered by first appearance.
    states: list[str] = []
    for lab in labels:
        if lab not in states:
            states.append(lab)
    code_of = {s: i for i, s in enumerate(states)}

    order = np.argsort(starts, kind="stable")
    starts_sorted = starts[order]
    stops_sorted = stops[order]
    codes_sorted = np.array([code_of[labels[i]] for i in order], dtype=int)

    t0 = float(starts.min())
    t1 = float(stops.max())
    n = max(int(np.ceil((t1 - t0) / step_s)) + 1, 1)
    grid = t0 + np.arange(n) * step_s

    gap_code = len(states)  # sentinel; promoted to a real "none" state if used
    out_codes = np.full(n, gap_code, dtype=int)
    # For each grid point, find the last epoch whose start <= t and stop > t.
    idx = np.searchsorted(starts_sorted, grid, side="right") - 1
    valid = idx >= 0
    inside = valid & (grid <= stops_sorted[np.clip(idx, 0, len(idx) - 1)])
    out_codes[inside] = codes_sorted[idx[inside]]

    if np.any(out_codes == gap_code):
        states = [*states, "none"]
    # else: gap_code never appears, so leave states as-is.

    da = xr.DataArray(
        out_codes,
        dims=("time",),
        coords={"time": grid},
        name="brainstate",
    )
    da.attrs["track_kind"] = "categorical"
    da.attrs["state_names"] = ",".join(states)
    return da


def scalar_track_from_series(
    values: np.ndarray | list[float],
    timestamps: np.ndarray | list[float],
    *,
    name: str,
    units: str | None = None,
) -> xr.DataArray:
    """Wrap a continuous behavioral trace (e.g. speed) as a scalar track.

    Parameters
    ----------
    values, timestamps
        Equal-length 1-D arrays of samples and their times (seconds, on the
        session clock).
    name
        Track name (becomes the DataArray name).
    units
        Optional unit string, stamped as ``attrs["units"]`` and surfaced in the
        track meta.

    Returns
    -------
    xr.DataArray
        ``(time,)`` float values with ``attrs["track_kind"] == "scalar"``.
    """
    vals = np.asarray(values, dtype=float).ravel()
    ts = np.asarray(timestamps, dtype=float).ravel()
    if vals.shape != ts.shape:
        raise ValueError(
            f"values {vals.shape} and timestamps {ts.shape} must have equal length"
        )
    if vals.size == 0:
        raise ValueError("scalar track needs at least one sample")
    da = xr.DataArray(vals, dims=("time",), coords={"time": ts}, name=name)
    da.attrs["track_kind"] = "scalar"
    if units is not None:
        da.attrs["units"] = str(units)
    return da
