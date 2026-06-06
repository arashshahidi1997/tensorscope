"""Adjacency-driven spatial ops on non-grid probes (prototype step #2).

Proves the analysis-correctness half of the channel-native goal: positions →
k-NN adjacency, and a spatial-median that runs on a non-rectangular probe (where
the dense-lattice reconstruction can't), plus CMR (already geometry-agnostic).
"""
from __future__ import annotations

import numpy as np
import xarray as xr

from tensorscope.core.geometry import (
    build_knn_adjacency,
    resolve_positions,
    spatial_median_graph,
)
from tensorscope.io.assemble import prepare_planar_probe
from tensorscope.server.models import ProcessingParamsDTO
from tensorscope.server.state import apply_processing


def _flat(n_time: int, n_ch: int, fs: float = 500.0) -> xr.DataArray:
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(1)
    data = (np.sin(2 * np.pi * 8 * t)[:, None] + rng.normal(0, 0.2, (n_time, n_ch))).astype("float32")
    return xr.DataArray(
        data, dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(n_ch)}, attrs={"fs": fs},
    )


def _lattice_positions(n_ap: int, n_ml: int) -> tuple[np.ndarray, np.ndarray]:
    """Row-major (x=ml, y=ap) positions for an n_ap × n_ml lattice."""
    ap, ml = np.divmod(np.arange(n_ap * n_ml), n_ml)
    return ml.astype(float), ap.astype(float)


# ── adjacency ─────────────────────────────────────────────────────────────


def test_knn_includes_self_first() -> None:
    pos = np.array([[0.0, 0.0], [10.0, 0.0], [0.0, 10.0]])
    adj = build_knn_adjacency(pos, k=2)
    assert adj.shape == (3, 2)
    assert list(adj[:, 0]) == [0, 1, 2]  # each channel is its own nearest


def test_knn_recovers_lattice_neighbours() -> None:
    """On a 5×5 grid, k=5 around an interior node = itself + the 4 edge-adjacent
    cells (the von-Neumann neighbourhood that median_spatialx would use)."""
    n = 5
    x, y = _lattice_positions(n, n)
    pos = np.column_stack([x, y])
    adj = build_knn_adjacency(pos, k=5)
    center = 2 * n + 2  # (ap=2, ml=2)
    expected = {center, center - 1, center + 1, center - n, center + n}
    assert set(adj[center].tolist()) == expected


def test_resolve_positions_planar_and_apml_and_none() -> None:
    planar = prepare_planar_probe(_flat(10, 3), x=[0, 1, 2], y=[3, 4, 5])
    pos = resolve_positions(planar)
    assert pos is not None and pos.shape == (3, 2)
    np.testing.assert_array_equal(pos[:, 0], [0, 1, 2])

    apml = _flat(10, 3).assign_coords(AP=("channel", [0, 0, 1]), ML=("channel", [0, 1, 0]))
    pos2 = resolve_positions(apml)
    assert pos2 is not None  # falls back to AP/ML as positions
    np.testing.assert_array_equal(pos2[:, 0], [0, 1, 0])  # x = ML

    assert resolve_positions(_flat(10, 3)) is None  # no geometry


# ── graph spatial median ──────────────────────────────────────────────────


def test_graph_spatial_median_smooths_isolated_spike_on_planar() -> None:
    """A single hot channel surrounded by quiet neighbours is pulled toward the
    neighbourhood median by the graph smoother — proof a spatial op acts on a
    non-grid probe."""
    n = 25
    x, y = _lattice_positions(5, 5)  # 2-D layout, but stored channel-native
    base = _flat(50, n) * 0.0  # zero everywhere
    probe = prepare_planar_probe(base, x=x, y=y)
    vals = np.asarray(probe.values).copy()
    center = 2 * 5 + 2
    vals[:, center] = 100.0  # isolated spike
    probe = probe.copy(data=vals)

    out = spatial_median_graph(probe, size=3)
    out_vals = np.asarray(out.values)
    # The spike is a minority in its 5-neighbourhood → median ~0; original stays 100.
    assert out_vals[:, center].max() < 1.0
    assert vals[:, center].max() == 100.0
    assert out.dims == probe.dims and out.shape == probe.shape


def test_graph_spatial_median_noop_without_positions() -> None:
    plain = _flat(20, 4)
    out = spatial_median_graph(plain, size=3)
    np.testing.assert_array_equal(out.values, plain.values)


def test_graph_matches_dense_grid_median_interior() -> None:
    """On a dense lattice fed as planar positions, the graph median over an
    interior node's 3×3 Moore neighbourhood (size=3 → k=9: self + 4 edge + 4
    diagonal) matches a hand-computed median — i.e. the graph op is consistent
    with the grid `median_spatialx(size=3)` 9-cell footprint on a grid."""
    n = 5
    x, y = _lattice_positions(n, n)
    rng = np.random.default_rng(2)
    vals = rng.normal(0, 1, (3, n * n)).astype("float64")
    probe = xr.DataArray(
        vals, dims=("time", "channel"),
        coords={"time": np.arange(3) / 500.0, "channel": np.arange(n * n),
                "x": ("channel", x), "y": ("channel", y)},
    )
    out = np.asarray(spatial_median_graph(probe, size=3).values)
    center = 2 * n + 2  # (ap=2, ml=2)
    # 3×3 Moore footprint around the interior node (all 9 cells).
    nb = [center + dap * n + dml for dap in (-1, 0, 1) for dml in (-1, 0, 1)]
    expected = np.median(vals[:, nb], axis=1)
    np.testing.assert_allclose(out[:, center], expected)


# ── end-to-end via apply_processing ───────────────────────────────────────


def test_apply_processing_spatial_median_runs_on_planar_probe() -> None:
    """The processing pipeline routes a planar probe's spatial-median through the
    graph op (the dense-lattice path can't handle it) — no NaNs, shape kept."""
    n = 16
    x = np.repeat(np.arange(4), 4).astype(float) * 100  # 4 shanks
    y = np.tile(np.arange(4), 4).astype(float) * 50     # staggered depth
    probe = prepare_planar_probe(_flat(200, n), x=x, y=y, fs=500.0)
    out = apply_processing(probe, ProcessingParamsDTO(spatial_median=True, spatial_median_size=3))
    assert out.dims == probe.dims and out.shape == probe.shape
    assert not np.isnan(np.asarray(out.values)).any()
    # Smoothing changed the data (it isn't a no-op).
    assert not np.allclose(out.values, probe.values)


def test_apply_processing_cmr_runs_on_planar_probe() -> None:
    """CMR is geometry-agnostic (cogpy.cmrx auto-detects the channel axis) — it
    subtracts the across-channel median on a non-grid probe."""
    probe = prepare_planar_probe(_flat(100, 8), x=np.arange(8.0), y=np.zeros(8), fs=500.0)
    out = apply_processing(probe, ProcessingParamsDTO(cmr=True))
    assert out.shape == probe.shape
    # After CMR the per-timepoint across-channel median is ~0.
    med = np.nanmedian(np.asarray(out.transpose("time", "channel").values), axis=1)
    assert np.abs(med).max() < 1e-6
