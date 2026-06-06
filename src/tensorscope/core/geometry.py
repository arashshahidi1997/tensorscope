"""Position-driven electrode geometry: adjacency + graph spatial ops.

The channel-native layout stores geometry as per-channel coordinates (x/y, or
AP/ML, or depth) rather than a dense lattice (see ``core.schema``). Spatial
operations that need *neighbours* — spatial-median smoothing, neighbourhood
bad-channel stats — then run over a **k-NN graph derived from the positions**,
which works for ANY layout: a 4-shank Neuropixels, a sparse/L-shaped ECoG, or a
regular grid (where the k-NN simply recovers the lattice neighbours). The grid
``median_spatialx`` fast path stays for genuine dense lattices; this is the
general fallback. See the channel-native geometry prototype (``bench/RESULTS.md``)
and ``docs/design/neuropixels-multiprobe.md``.
"""
from __future__ import annotations

import numpy as np
import xarray as xr

from tensorscope.core.schema import channel_positions

__all__ = ["resolve_positions", "build_knn_adjacency", "spatial_median_graph"]


def resolve_positions(data: xr.DataArray) -> np.ndarray | None:
    """Per-channel positions as an ``(n_channels, D)`` float array, or ``None``.

    Preference order: explicit ``x``/``y`` (+ optional ``z``) coords (planar) →
    ``AP``/``ML`` per-channel coords (a sparse or grid layout treated as 2-D
    positions). Returns ``None`` when the tensor carries no usable geometry.
    """
    pos = channel_positions(data)
    if pos is not None:
        x, y = pos
        cols = [x, y]
        if "z" in data.coords and data.coords["z"].dims == ("channel",):
            cols.append(np.asarray(data.coords["z"].values, dtype=float))
        return np.column_stack(cols)

    if (
        "AP" in data.coords
        and "ML" in data.coords
        and data.coords["AP"].dims == ("channel",)
        and data.coords["ML"].dims == ("channel",)
    ):
        ap = np.asarray(data.coords["AP"].values, dtype=float)
        ml = np.asarray(data.coords["ML"].values, dtype=float)
        return np.column_stack([ml, ap])  # x=ML (horizontal), y=AP (vertical)

    return None


def build_knn_adjacency(positions: np.ndarray, k: int) -> np.ndarray:
    """k-nearest-neighbour index graph from per-channel positions.

    Returns an ``(n_channels, k_eff)`` int array; row ``i`` lists the indices of
    the ``k_eff = min(k, n_channels)`` channels nearest to channel ``i`` by
    Euclidean distance, channel ``i`` itself first (distance 0). On a regular
    lattice with ``k=9`` this recovers the channel plus its 3×3 footprint — i.e.
    the same neighbourhood ``median_spatialx(size=3)`` uses.
    """
    positions = np.asarray(positions, dtype=float)
    n = positions.shape[0]
    k_eff = max(1, min(int(k), n))
    try:
        from scipy.spatial import cKDTree

        tree = cKDTree(positions)
        _, idx = tree.query(positions, k=k_eff)
        idx = np.atleast_2d(idx)
        if idx.shape[0] == 1 and n != 1:
            idx = idx.T
        return idx.astype(int)
    except Exception:  # noqa: BLE001 — no scipy: O(n^2) fallback (fine for probes)
        d = np.linalg.norm(positions[:, None, :] - positions[None, :, :], axis=-1)
        return np.argsort(d, axis=1)[:, :k_eff].astype(int)


def spatial_median_graph(data: xr.DataArray, *, size: int = 3) -> xr.DataArray:
    """Median-smooth each channel over its k-NN neighbourhood (positions-driven).

    The general-geometry analogue of ``median_spatialx`` / the dense-grid
    ``_median_spatial_flat``: works on any ``(time, channel)`` probe via
    :func:`resolve_positions` + :func:`build_knn_adjacency`. ``size`` mirrors the
    grid window side — a 3×3 footprint → ``k = size*size = 9`` neighbours — so the
    parameter means the same thing across grid and non-grid probes. Returns the
    input unchanged when the tensor has no positions (nothing to smooth over).
    """
    if "channel" not in data.dims:
        return data
    positions = resolve_positions(data)
    if positions is None:
        return data

    sig = data.transpose("time", "channel")
    vals = np.asarray(sig.values, dtype=np.float64)  # (time, channel)
    n_ch = vals.shape[1]
    k = max(1, int(size) * int(size))
    adj = build_knn_adjacency(positions, k)

    out = np.empty_like(vals)
    for ch in range(n_ch):
        out[:, ch] = np.nanmedian(vals[:, adj[ch]], axis=1)

    return xr.DataArray(
        out, dims=("time", "channel"), coords=sig.coords, attrs=dict(sig.attrs)
    ).transpose(*data.dims)
