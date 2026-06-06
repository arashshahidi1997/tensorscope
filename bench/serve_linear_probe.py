"""Launch a synthetic LINEAR (depth) probe for verifying the CSD toggle.

A Neuropixels-DV-style probe: N channels along depth with a depth-localized
oscillating dipole, so the raw LFP shows a smooth blob centred at mid-depth while
the CSD (−d²V/dz²) shows the sharper sink/source structure — making the depth
panel's LFP↔CSD toggle visibly distinct. See ADR-0010 Phase 3.

Run (served on :8000 so the Vite dev server at :5173 proxies to it):
    PYTHONPATH=src pixi run python bench/serve_linear_probe.py
"""
from __future__ import annotations

import numpy as np
import uvicorn
import xarray as xr

from tensorscope.io.assemble import prepare_linear_probe
from tensorscope.server.app import create_app

FS = 1250.0
DUR_S = 20.0
N_SAMPLES = int(FS * DUR_S)
N_CH = 64
DEPTH_PITCH = 20.0  # µm between sites


def _build() -> xr.DataArray:
    t = np.arange(N_SAMPLES) / FS
    depth = np.arange(N_CH, dtype=float) * DEPTH_PITCH
    rng = np.random.default_rng(0)

    # Depth-localized potential profile (Gaussian in depth) modulating a slow
    # oscillation → a fixed dipole whose CSD is a sharp sink/source band at the
    # centre. A second, deeper transient band drifts in to make it lively.
    centre = depth[N_CH // 2]
    sigma = 6 * DEPTH_PITCH
    prof = np.exp(-((depth - centre) ** 2) / (2 * sigma ** 2))
    osc = np.sin(2 * np.pi * 6.0 * t)
    lfp = prof[None, :] * osc[:, None]

    # A second band that sweeps in depth over time (so CSD shows motion).
    drift = depth.min() + (depth.max() - depth.min()) * (0.3 + 0.4 * np.sin(2 * np.pi * t / DUR_S))
    band = np.exp(-((depth[None, :] - drift[:, None]) ** 2) / (2 * (3 * DEPTH_PITCH) ** 2))
    lfp += 0.6 * band * np.sin(2 * np.pi * 9.0 * t)[:, None]

    lfp += rng.normal(0, 0.05, lfp.shape)
    da = xr.DataArray(
        lfp.astype(np.float32),
        dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(N_CH)},
    )
    return prepare_linear_probe(da, depth=depth, fs=FS)


def main() -> None:
    probe = _build()
    print(f"linear probe: {N_CH} ch over {N_CH * DEPTH_PITCH:.0f} µm depth, fs={FS} Hz")
    app = create_app(probe, tensor_name="npx_linear")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")


if __name__ == "__main__":
    main()
