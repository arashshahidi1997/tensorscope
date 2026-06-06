"""Launch a synthetic NON-GRID (4-shank) planar probe for live validation.

Proves the channel-native geometry end-to-end in the live app: a probe whose
electrodes do NOT lie on a dense AP×ML lattice (4 shanks × 2 columns × depths)
loads, advertises the scatter `spatial_map`, and renders position-driven — with
spatial-median (graph op, #2) visibly cleaning the per-frame speckle.

The signal = a smooth 2-D Gaussian "hotspot" sweeping across the shanks over
time (low spatial frequency, survives median smoothing) + sparse impulsive
speckle on random channels (high spatial frequency, removed by spatial median).

Run (served on :8000 so the Vite dev server at :5173 proxies to it):
    PYTHONPATH=src pixi run python bench/serve_planar_probe.py
"""
from __future__ import annotations

import numpy as np
import uvicorn
import xarray as xr

from tensorscope.io.assemble import prepare_planar_probe
from tensorscope.server.app import create_app

FS = 1250.0
DUR_S = 20.0
N_SAMPLES = int(FS * DUR_S)
N_SHANK = 4
N_COL = 2          # two electrode columns per shank (NP-style stagger)
N_DEPTH = 24       # sites per column
SHANK_PITCH = 250.0   # µm between shanks
COL_PITCH = 32.0      # µm between the two columns
DEPTH_PITCH = 40.0    # µm between depth rows


def _positions() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """4-shank staggered layout → per-channel (x, y, shank). Deliberately NOT a
    dense AP×ML grid: x clusters at 4 shank locations (× 2 columns)."""
    xs, ys, shanks = [], [], []
    for s in range(N_SHANK):
        for c in range(N_COL):
            for d in range(N_DEPTH):
                xs.append(s * SHANK_PITCH + c * COL_PITCH)
                # stagger the two columns by half a depth pitch (real NP geometry)
                ys.append(d * DEPTH_PITCH + (c * DEPTH_PITCH / 2.0))
                shanks.append(s)
    return np.array(xs, float), np.array(ys, float), np.array(shanks, int)


def _build() -> xr.DataArray:
    x, y, shank = _positions()
    n_ch = x.size
    t = np.arange(N_SAMPLES) / FS
    rng = np.random.default_rng(0)

    # Normalize positions to [0,1] for the moving-bump distance.
    xn = (x - x.min()) / (np.ptp(x) or 1)
    yn = (y - y.min()) / (np.ptp(y) or 1)

    # Hotspot centre sweeps left→right (x) and oscillates in depth (y) over time.
    cx = 0.5 + 0.45 * np.sin(2 * np.pi * t / DUR_S)          # full sweep across the probe
    cy = 0.5 + 0.30 * np.sin(2 * np.pi * t / (DUR_S / 3))
    # Per-channel amplitude = Gaussian bump around the moving centre, modulating
    # an 8 Hz carrier — so the scatter shows a moving blob and the timeseries
    # shows oscillations.
    carrier = np.sin(2 * np.pi * 8 * t)
    dist2 = (xn[None, :] - cx[:, None]) ** 2 + (yn[None, :] - cy[:, None]) ** 2
    bump = np.exp(-dist2 / (2 * 0.08 ** 2))                  # (time, channel)
    data = (bump * carrier[:, None]).astype(np.float32)
    data += rng.normal(0, 0.05, data.shape).astype(np.float32)

    # Sparse impulsive speckle: a few random channels get a big spike each of
    # many timepoints — high spatial frequency that spatial-median removes.
    n_spikes = N_SAMPLES // 4
    ti = rng.integers(0, N_SAMPLES, n_spikes)
    ci = rng.integers(0, n_ch, n_spikes)
    data[ti, ci] += rng.choice([-1.0, 1.0], n_spikes).astype(np.float32) * 3.0

    da = xr.DataArray(
        data, dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(n_ch)},
    )
    return prepare_planar_probe(da, x=x, y=y, shank=shank, fs=FS)


def main() -> None:
    probe = _build()
    print(f"planar probe: {probe.sizes['channel']} ch, "
          f"{N_SHANK} shanks × {N_COL} col × {N_DEPTH} depth, fs={FS} Hz")
    app = create_app(probe, tensor_name="npx4shank")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")


if __name__ == "__main__":
    main()
