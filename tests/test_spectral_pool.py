"""P4 — process-pool offload for the spectral compute (navigation-perf plan).

``psd_live`` + ``spectrogram_live`` are CPU-bound. Running them inline holds the
single uvicorn worker's GIL, so a heavy spectral request blocks the cheap Tier-0
``timeseries``/``navigator`` requests sharing the process. P4 moves the pure
numpy cores onto ONE long-lived module-level ``ProcessPoolExecutor`` and blocks
on ``.result()`` — the parent GIL is released while the subprocess computes.

What is unit-gatable (the concurrency win itself is not): the extracted cores
are picklable and numerically identical to the prior inline path, the pool is a
module-level singleton (never per-request), and a slice still routes through the
pool to a correct result. Only numpy arrays + plain param dicts cross the
boundary — ``ServerState`` is never shipped.
"""
from __future__ import annotations

import pickle
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import xarray as xr

import tensorscope.server.state as state_mod
from tensorscope.server.models import (
    PsdParamsDTO,
    SelectionDTO,
    SpectrogramLiveParamsDTO,
    TensorSliceRequestDTO,
)
from tensorscope.server.state import (
    _psd_multitaper_core,
    _spectrogram_live_core,
    create_server_state,
)

FS = 500.0


def _multichannel(n_ch: int = 4, n_time: int = 4096) -> np.ndarray:
    """(n_ch, time) — each channel a distinct tone + noise."""
    t = np.arange(n_time) / FS
    rng = np.random.default_rng(7)
    return np.stack(
        [np.sin(2 * np.pi * (5 + 3 * c) * t) + rng.normal(0, 0.2, n_time) for c in range(n_ch)],
        axis=0,
    )


# ── numeric parity: extracted core == prior inline path ─────────────────────


def test_psd_core_matches_inline_multitaper() -> None:
    from cogpy.spectral.psd import psd_multitaper

    flat = _multichannel()
    params = PsdParamsDTO()
    mt_kwargs: dict = {"NW": params.NW, "fmin": params.fmin, "detrend": params.detrend}
    if params.K is not None:
        mt_kwargs["K"] = params.K
    if params.fmax is not None:
        mt_kwargs["fmax"] = params.fmax

    ref_vals, ref_freqs = psd_multitaper(flat, FS, **mt_kwargs)
    core_vals, core_freqs = _psd_multitaper_core(flat, FS, mt_kwargs)

    np.testing.assert_allclose(core_vals, ref_vals, rtol=1e-12, atol=0.0)
    np.testing.assert_allclose(core_freqs, ref_freqs, rtol=1e-12, atol=0.0)


def test_psd_core_matches_inline_single_channel() -> None:
    from cogpy.spectral.psd import psd_multitaper

    arr = _multichannel(n_ch=1)[0]  # (time,)
    mt_kwargs: dict = {"NW": 4, "fmin": 0.0, "detrend": "linear"}
    ref_vals, ref_freqs = psd_multitaper(arr, FS, **mt_kwargs)
    core_vals, core_freqs = _psd_multitaper_core(arr, FS, mt_kwargs)
    np.testing.assert_allclose(core_vals, ref_vals, rtol=1e-12, atol=0.0)
    np.testing.assert_allclose(core_freqs, ref_freqs, rtol=1e-12, atol=0.0)


def test_spectrogram_core_matches_inline_per_channel() -> None:
    import ghostipy as gsp

    flat = _multichannel(n_ch=3, n_time=4096)
    mtm_kwargs = dict(
        bandwidth=8.0, fs=FS, nperseg=256, noverlap=128, remove_mean=True, n_fft_threads=1
    )
    # Reference: the prior per-channel fan-out (stack of single-channel calls).
    ref_rows = [gsp.mtm_spectrogram(flat[i], **mtm_kwargs)[0] for i in range(flat.shape[0])]
    _S0, ref_freqs, ref_t = gsp.mtm_spectrogram(flat[0], **mtm_kwargs)
    ref = np.stack(ref_rows)

    out, freqs, t_centers = _spectrogram_live_core(flat, mtm_kwargs)

    np.testing.assert_allclose(out, ref, rtol=1e-12, atol=0.0)
    np.testing.assert_allclose(freqs, ref_freqs, rtol=1e-12, atol=0.0)
    np.testing.assert_allclose(t_centers, ref_t, rtol=1e-12, atol=0.0)


# ── the cores are picklable (ship numpy + params, never ServerState) ────────


def test_cores_are_picklable_by_reference() -> None:
    # Module-level → picklable by qualified name, the contract that lets them
    # cross the process boundary.
    assert pickle.loads(pickle.dumps(_psd_multitaper_core)) is _psd_multitaper_core
    assert pickle.loads(pickle.dumps(_spectrogram_live_core)) is _spectrogram_live_core
    # The payloads we actually ship are numpy + plain dict — round-trip cleanly.
    flat = _multichannel(n_ch=2, n_time=1024)
    np.testing.assert_array_equal(pickle.loads(pickle.dumps(flat)), flat)
    assert pickle.loads(pickle.dumps({"NW": 4, "fmin": 0.0})) == {"NW": 4, "fmin": 0.0}


# ── the pool is a single module-level singleton, not per-request ────────────


def test_spectral_pool_is_module_level_singleton() -> None:
    p1 = state_mod._get_spectral_pool()
    p2 = state_mod._get_spectral_pool()
    assert p1 is p2, "the spectral pool must be a module-level singleton"
    assert isinstance(p1, ProcessPoolExecutor)
    # Warmed at import → already constructed before first explicit access.
    assert state_mod._SPECTRAL_POOL is p1


# ── end-to-end: a slice still routes through the pool to a correct result ────


def _ts_grid(n_time: int = 4096, n_ap: int = 2, n_ml: int = 2) -> xr.DataArray:
    t = np.arange(n_time) / FS
    rng = np.random.default_rng(3)
    base = np.sin(2 * np.pi * 12 * t)
    data = rng.normal(0, 0.1, (n_time, n_ap, n_ml)) + base[:, None, None]
    return xr.DataArray(
        data,
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
        attrs={"fs": FS},
    )


def test_psd_live_slice_routes_through_pool() -> None:
    state = create_server_state(_ts_grid(), tensor_name="sig")
    req = TensorSliceRequestDTO(
        view_type="psd_live",
        selection=SelectionDTO(time=4.0, freq=12.0, ap=0, ml=0),
        time_range=[0.0, 8.0],
        psd_params={"NW": 4, "fmax": 100},
    )
    out = state._prepare_slice("sig", req)[1]
    assert "freq" in out.dims, "psd_live must replace time with freq"
    assert np.isfinite(np.asarray(out.values, dtype=float)).any(), "pool result must be finite"


def test_spectrogram_live_slice_routes_through_pool() -> None:
    state = create_server_state(_ts_grid(n_time=6000), tensor_name="sig")
    req = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=0.0, freq=12.0, ap=0, ml=0),
        time_range=[0.0, 12.0],
        spectrogram_live_params=SpectrogramLiveParamsDTO().model_dump(),
    )
    out = state._prepare_slice("sig", req)[1]
    assert "freq" in out.dims and "time" in out.dims, "spectrogram_live is (time, freq, …)"
    assert np.isfinite(np.asarray(out.values, dtype=float)).any(), "pool result must be finite"
