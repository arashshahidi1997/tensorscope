"""Time alignment helpers for multi-rate TensorScope data."""

from __future__ import annotations

import numpy as np


def align_to_common_timebase(
    times: list[np.ndarray],
    method: str = "nearest",
) -> np.ndarray:
    """Align multiple time bases to a common grid."""
    if len(times) == 0:
        return np.array([])
    if len(times) == 1:
        return np.asarray(times[0])

    t_arrays = [np.asarray(t) for t in times]

    if method == "nearest":
        return t_arrays[0]
    if method not in {"union", "intersection"}:
        raise ValueError(f"Unknown method: {method!r}")

    if method == "intersection":
        t_min = max(float(t[0]) for t in t_arrays)
        t_max = min(float(t[-1]) for t in t_arrays)
    else:
        t_min = min(float(t[0]) for t in t_arrays)
        t_max = max(float(t[-1]) for t in t_arrays)

    if not np.isfinite(t_min) or not np.isfinite(t_max) or t_max <= t_min:
        return np.array([])

    dts: list[float] = []
    for t in t_arrays:
        if t.size < 2:
            continue
        dt = float(np.median(np.diff(t.astype(float))))
        if np.isfinite(dt) and dt > 0:
            dts.append(dt)

    dt = min(dts) if dts else 1.0
    return np.arange(t_min, t_max, dt)


def find_nearest_time_index(target_time: float, time_array: np.ndarray) -> int:
    """Find the index of the nearest time in a sorted array."""
    t = np.asarray(time_array, dtype=float)
    if t.size == 0:
        raise ValueError("time_array must be non-empty")

    idx = int(np.searchsorted(t, float(target_time)))
    if idx <= 0:
        return 0
    if idx >= t.size:
        return int(t.size - 1)

    if abs(t[idx] - target_time) < abs(t[idx - 1] - target_time):
        return idx
    return idx - 1
