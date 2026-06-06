"""Prototype benchmark: dense (time, AP, ML) grid vs channel-native (time, channel).

Question: for a probe whose real channels do NOT fill a dense rectangle (4-shank
Neuropixels, L-shaped / sparse ECoG, SEEG, ...), is the channel-native layout
*faster to work with inside TensorScope's slice path*?

We hold the REAL channel data fixed (256 channels) and represent it two ways:

  * channel-native : (time, channel)        — exactly n_ch_real cells
  * grid           : (time, AP, ML)          — n_ch_real real cells + NaN padding
                     to a dense AP*ML bounding box of size n_ch_real / fill_factor

then run the actual hot path — ``apply_slice_request`` (compute) followed by
``encode_arrow_v2`` (Arrow serialization) — for each common view, and report
wall time + payload bytes.

fill_factor = 1.0 is the dense ECoG case (sanity: the two layouts should tie —
there is no free lunch on dense data). As fill drops, the grid pays compute and
bytes for cells that don't exist, so channel-native should pull ahead ~1/fill.

Run:  PYTHONPATH=src pixi run python bench/bench_geometry_format.py
"""
from __future__ import annotations

import statistics
import time

import numpy as np
import xarray as xr

from tensorscope.server.models import (
    PsdParamsDTO,
    SelectionDTO,
    SpectrogramLiveParamsDTO,
    TensorSliceRequestDTO,
)
from tensorscope.server.state import apply_slice_request, encode_arrow_v2

# ── Benchmark parameters ──────────────────────────────────────────────────
FS = 1250.0
DUR_S = 25.0
N_SAMPLES = int(FS * DUR_S)
N_CH_REAL = 256
WIN_S = 10.0
T0 = 5.0
FILL_FACTORS = [1.0, 0.5, 0.25]
N_REPEAT = 3  # median of N (after one warmup)

RNG = np.random.default_rng(0)


def _make_channel_data() -> np.ndarray:
    """(time, n_ch_real) float32 — a 10 Hz sine + per-channel noise. The SAME
    underlying data is reused by both layouts so only the representation differs."""
    t = np.arange(N_SAMPLES) / FS
    base = np.sin(2 * np.pi * 10 * t)[:, None]
    return (base + RNG.normal(0, 0.3, (N_SAMPLES, N_CH_REAL))).astype(np.float32)


def _channel_native(ch_data: np.ndarray) -> xr.DataArray:
    """(time, channel) + per-channel (x, y) geometry coords — no wasted cells."""
    n_ch = ch_data.shape[1]
    # Arbitrary 2-D positions (e.g. a non-lattice probe). Not used by compute;
    # present to show geometry rides as coordinates, not as array shape.
    x = RNG.uniform(0, 1000, n_ch)
    y = RNG.uniform(0, 4000, n_ch)
    return xr.DataArray(
        ch_data,
        dims=("time", "channel"),
        coords={
            "time": np.arange(N_SAMPLES) / FS,
            "channel": np.arange(n_ch),
            "x": ("channel", x),
            "y": ("channel", y),
        },
        attrs={"fs": FS},
    )


def _grid(ch_data: np.ndarray, fill: float) -> tuple[xr.DataArray, int, int]:
    """(time, AP, ML) dense bounding box; real channels fill the first cells,
    the rest are NaN padding (what you pay for forcing a non-rectangular probe
    onto a lattice)."""
    n_ch = ch_data.shape[1]
    n_cells = int(round(n_ch / fill))
    # Pick a roughly-square AP x ML >= n_cells.
    n_ml = int(np.ceil(np.sqrt(n_cells)))
    n_ap = int(np.ceil(n_cells / n_ml))
    total = n_ap * n_ml
    padded = np.full((N_SAMPLES, total), np.nan, dtype=np.float32)
    padded[:, :n_ch] = ch_data
    grid = padded.reshape(N_SAMPLES, n_ap, n_ml)
    da = xr.DataArray(
        grid,
        dims=("time", "AP", "ML"),
        coords={
            "time": np.arange(N_SAMPLES) / FS,
            "AP": np.arange(n_ap),
            "ML": np.arange(n_ml),
        },
        attrs={"fs": FS},
    )
    return da, n_ap, n_ml


def _requests() -> dict[str, TensorSliceRequestDTO]:
    sel = SelectionDTO(time=T0, freq=10.0, ap=0, ml=0)
    win = (T0, T0 + WIN_S)
    return {
        "timeseries": TensorSliceRequestDTO(
            view_type="timeseries", selection=sel, time_range=win,
            max_points=2000, downsample="minmax",
        ),
        "raster": TensorSliceRequestDTO(
            view_type="raster", selection=sel, time_range=win,
            max_points=2000, downsample="minmax",
        ),
        "psd_live": TensorSliceRequestDTO(
            view_type="psd_live", selection=sel, time_range=win,
            psd_params=PsdParamsDTO(),
        ),
        "spectrogram_live": TensorSliceRequestDTO(
            view_type="spectrogram_live", selection=sel, time_range=win,
            spectrogram_live_params=SpectrogramLiveParamsDTO(nperseg_s=1.0, fmax_hz=30.0),
        ),
    }


def _time_one(da: xr.DataArray, req: TensorSliceRequestDTO) -> tuple[float, float, int]:
    """Return (compute_ms, encode_ms, payload_bytes), median of N_REPEAT.

    Each repeat nudges the window by one sample so nothing can be memoised
    (apply_slice_request is pure today, but this keeps the benchmark honest)."""
    comp, enc, nbytes = [], [], 0
    for k in range(N_REPEAT + 1):  # +1 warmup, discarded
        dt = k / FS
        r = req.model_copy(update={"time_range": (req.time_range[0] + dt, req.time_range[1] + dt)})
        t0 = time.perf_counter()
        sliced = apply_slice_request(da, r)
        t1 = time.perf_counter()
        payload = encode_arrow_v2(sliced)
        t2 = time.perf_counter()
        if k == 0:
            continue  # warmup
        comp.append((t1 - t0) * 1e3)
        enc.append((t2 - t1) * 1e3)
        nbytes = len(payload)
    return statistics.median(comp), statistics.median(enc), nbytes


def main() -> None:
    ch_data = _make_channel_data()
    reqs = _requests()

    print(f"\nfs={FS} Hz  dur={DUR_S}s  n_samples={N_SAMPLES}  "
          f"real channels={N_CH_REAL}  window={WIN_S}s  median of {N_REPEAT}\n")

    for fill in FILL_FACTORS:
        ch_da = _channel_native(ch_data)
        grid_da, n_ap, n_ml = _grid(ch_data, fill)
        cells = n_ap * n_ml
        ch_mb = ch_da.nbytes / 1e6
        grid_mb = grid_da.nbytes / 1e6
        print("=" * 92)
        print(f"FILL FACTOR {fill:>4}  |  channel-native: {N_CH_REAL} ch ({ch_mb:.1f} MB)   "
              f"grid: {n_ap}x{n_ml}={cells} cells ({grid_mb:.1f} MB, "
              f"{cells - N_CH_REAL} NaN-padding cells)")
        print("-" * 92)
        print(f"{'view':<18}{'layout':<10}{'compute ms':>12}{'encode ms':>12}"
              f"{'total ms':>11}{'payload KB':>13}")
        for view, req in reqs.items():
            rows = {}
            for label, da in (("channel", ch_da), ("grid", grid_da)):
                try:
                    c, e, b = _time_one(da, req)
                    rows[label] = (c, e, b)
                    print(f"{view:<18}{label:<10}{c:>12.1f}{e:>12.1f}"
                          f"{c + e:>11.1f}{b / 1024:>13.1f}")
                except Exception as exc:  # noqa: BLE001
                    rows[label] = None
                    print(f"{view:<18}{label:<10}  ERROR: {type(exc).__name__}: {exc}")
            if rows.get("channel") and rows.get("grid"):
                cc, ce, cb = rows["channel"]
                gc, ge, gb = rows["grid"]
                speed = (gc + ge) / (cc + ce) if (cc + ce) else float("nan")
                size = gb / cb if cb else float("nan")
                print(f"{'':<18}{'-> grid/chan':<10}{'':>12}{'':>12}"
                      f"{speed:>10.2f}x{size:>12.2f}x")
        print()


if __name__ == "__main__":
    main()
