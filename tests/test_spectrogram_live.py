"""Tests for the spectrogram_live view type."""
from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from tensorscope.server.models import (
    SelectionDTO,
    SpectrogramLiveParamsDTO,
    TensorSliceRequestDTO,
)
from tensorscope.server.state import create_server_state


def _make_signal(n_time: int = 4000, n_ap: int = 4, n_ml: int = 8, fs: float = 1000.0) -> xr.DataArray:
    """Synthetic (time, AP, ML) LFP-shaped signal with known frequency content.

    A 12 Hz sine + a 7 Hz transient burst between 1.0 s and 2.0 s, plus broadband noise.
    Useful for exercising fmin/fmax clipping and the per-freq normalisation path.
    """
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(7)
    base = np.sin(2 * np.pi * 12 * t)
    burst_mask = (t >= 1.0) & (t < 2.0)
    burst = np.zeros_like(t)
    burst[burst_mask] = np.sin(2 * np.pi * 7 * t[burst_mask])
    sig = (base + 0.5 * burst)[:, None, None]
    data = rng.normal(0, 0.05, (n_time, n_ap, n_ml)) + sig
    return xr.DataArray(
        data,
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": np.arange(n_ap), "ML": np.arange(n_ml)},
        attrs={"fs": fs},
    )


def _make_signal_channel(n_time: int = 4000, n_ch: int = 6, fs: float = 1000.0) -> xr.DataArray:
    """Synthetic (time, channel) signal — exercises the alternate dim signature."""
    t = np.arange(n_time) / fs
    rng = np.random.default_rng(11)
    sig = np.sin(2 * np.pi * 10 * t)[:, None]
    data = rng.normal(0, 0.05, (n_time, n_ch)) + sig
    return xr.DataArray(
        data,
        dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(n_ch)},
        attrs={"fs": fs},
    )


# ── shape correctness ────────────────────────────────────────────────────


def test_spectrogram_live_basic_grid_shape() -> None:
    """spectrogram_live on (time, AP, ML) returns (time_seg, freq, AP, ML)."""
    signal = _make_signal()
    state = create_server_state(signal, tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=1.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
    )
    result = state.tensor_slice("lfp", request)
    assert result.dims == ["time", "freq", "AP", "ML"]
    n_t, n_f, n_ap, n_ml = result.shape
    assert n_t > 0 and n_f > 0
    assert n_ap == 4 and n_ml == 8


def test_spectrogram_live_basic_channel_shape() -> None:
    """spectrogram_live on (time, channel) returns (time_seg, freq, channel)."""
    signal = _make_signal_channel()
    state = create_server_state(signal, tensor_name="lfp_ch")
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=1.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
    )
    result = state.tensor_slice("lfp_ch", request)
    assert result.dims == ["time", "freq", "channel"]
    assert result.shape[2] == 6


def test_spectrogram_live_time_centers_aligned_to_window() -> None:
    """Segment-centre timestamps live inside the requested window."""
    signal = _make_signal()
    state = create_server_state(signal, tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=1.5, freq=10.0, ap=0, ml=0),
        time_range=(1.0, 3.0),
    )
    result = state.tensor_slice("lfp", request)
    time_coord = next(c for c in result.meta["coords"] if c["name"] == "time")
    # cogpy returns segment-centres relative to window start; we add window_t0
    # so the global timestamps land somewhere inside [1.0, 3.0].
    assert time_coord["min"] is not None and time_coord["min"] >= 1.0
    assert time_coord["max"] is not None and time_coord["max"] <= 3.0


# ── frequency clipping ────────────────────────────────────────────────────


def test_spectrogram_live_fmin_fmax_clip() -> None:
    """fmin_hz / fmax_hz drop freq rows outside the band."""
    signal = _make_signal()
    state = create_server_state(signal, tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=1.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
        spectrogram_live_params=SpectrogramLiveParamsDTO(fmin_hz=5.0, fmax_hz=20.0),
    )
    result = state.tensor_slice("lfp", request)
    freq_coord = next(c for c in result.meta["coords"] if c["name"] == "freq")
    assert freq_coord["min"] is not None and freq_coord["min"] >= 5.0
    assert freq_coord["max"] is not None and freq_coord["max"] <= 20.0


def test_spectrogram_live_fmax_le_fmin_rejected() -> None:
    """fmax_hz <= fmin_hz fails Pydantic validation."""
    with pytest.raises(ValueError, match="fmax_hz must be greater than fmin_hz"):
        SpectrogramLiveParamsDTO(fmin_hz=20.0, fmax_hz=10.0)


# ── normalisation ─────────────────────────────────────────────────────────


def test_spectrogram_live_normalize_per_freq_median_zero_centers() -> None:
    """With normalize_per_freq_median=True, each freq row's median over time
    is approximately zero (Prerau-style baseline subtraction in log10 space)."""
    signal = _make_signal()
    state = create_server_state(signal, tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=1.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
        spectrogram_live_params=SpectrogramLiveParamsDTO(
            normalize_per_freq_median=True,
        ),
    )
    result = state.tensor_slice("lfp", request)
    # Decode the Arrow payload. Easier path: re-fetch via the executor and
    # inspect the in-memory DataArray that fed encode_arrow_payload.
    # Use the slice response shape directly: meta carries the dim ordering.
    # We re-run apply_slice_request to get the DataArray for assertion.
    from tensorscope.server.state import apply_slice_request
    da = apply_slice_request(signal, request)
    # Median over the time-segment axis, per freq, per (AP, ML) — should be ~0.
    median_per_freq = da.median(dim="time")
    assert np.allclose(median_per_freq.values, 0.0, atol=1e-9)


def test_spectrogram_live_normalize_off_keeps_log_power_scale() -> None:
    """With normalize_per_freq_median=False, values are raw power (not zero-medianed)."""
    signal = _make_signal()
    from tensorscope.server.state import apply_slice_request
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=1.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
        spectrogram_live_params=SpectrogramLiveParamsDTO(
            normalize_per_freq_median=False,
        ),
    )
    da = apply_slice_request(signal, request)
    # Off the normalisation path, freq rows are NOT zero-centred — at least
    # one row's median should be appreciably non-zero on real-power output.
    median_per_freq = da.median(dim="time")
    assert float(np.abs(median_per_freq).max()) > 1e-6


def test_spectrogram_live_single_segment_window_does_not_collapse_to_zero() -> None:
    """Regression: when the visible window is narrow enough that nperseg
    consumes all samples and only one time segment fits, the per-time-axis
    median subtraction must NOT wipe the spectrogram to all-zeros (which
    would render as a uniform purple viridis-min on the canvas). The
    fix falls back to raw log10 power on length-1 time axes.

    Trigger: 1 s window with the default nperseg_s=1.0 at fs=1000 → exactly
    1 segment. Common scenario in event drill-down with focus mode.
    """
    signal = _make_signal()
    from tensorscope.server.state import apply_slice_request
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=1.5, freq=10.0, ap=0, ml=0),
        time_range=(1.0, 2.0),
        spectrogram_live_params=SpectrogramLiveParamsDTO(
            nperseg_s=1.0,
            normalize_per_freq_median=True,
        ),
    )
    da = apply_slice_request(signal, request)
    # The output must span a meaningful range; previously every cell
    # collapsed to 0 and the canvas painted uniform colormap-min.
    span = float(np.nanmax(da.values) - np.nanmin(da.values))
    assert span > 0.5, (
        f"single-segment spectrogram collapsed to constant (span={span:.3e}) — "
        "the canvas would render as uniform purple"
    )


# ── window / validator ───────────────────────────────────────────────────


def test_spectrogram_live_requires_time_range() -> None:
    """Validator rejects spectrogram_live requests without a time_range."""
    with pytest.raises(ValueError, match="time_range is required for spectrogram_live"):
        TensorSliceRequestDTO(
            view_type="spectrogram_live",
            selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
        )


def test_spectrogram_live_too_narrow_window_raises() -> None:
    """A window can't host a usable multitaper segment even after padding → 400.

    Spectral-window decoupling pads the compute window by ±nperseg/2 from the
    full tensor, so a narrow *visible* window is normally fine. The hard reject
    now fires only when even the padded slice is sub-64 samples — i.e. the whole
    tensor is shorter than 64 samples — so use a 40-sample tensor here.
    """
    signal = _make_signal(n_time=40, fs=1000.0)
    state = create_server_state(signal, tensor_name="lfp")
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=0.02, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 0.039),
    )
    with pytest.raises(ValueError, match="window too narrow"):
        state.tensor_slice("lfp", request)


def test_spectrogram_live_resolution_fixed_across_zoom() -> None:
    """Spectral-window decoupling: the segment length (hence frequency
    resolution) is set by `nperseg_s` and stays constant as the user zooms,
    rather than shrinking to fit a narrow visible window. The compute window is
    padded by ±nperseg/2 from the full tensor so a 0.3 s view still runs the full
    1 s segment.  Use a mid-tensor window so the pad isn't truncated at an edge."""
    signal = _make_signal(n_time=4000, fs=1000.0)
    from tensorscope.server.state import apply_slice_request

    def _nperseg(t_range: tuple[float, float]) -> int:
        req = TensorSliceRequestDTO(
            view_type="spectrogram_live",
            selection=SelectionDTO(time=0.5 * (t_range[0] + t_range[1]), freq=10.0, ap=0, ml=0),
            time_range=t_range,
            spectrogram_live_params=SpectrogramLiveParamsDTO(
                nperseg_s=1.0,     # asks for 1000 samples
                bandwidth_hz=8.0,  # NW≥2 minimum = 250 samples, well below 1000
            ),
        )
        return int(apply_slice_request(signal, req).attrs["spectrogram_live_nperseg"])

    narrow = _nperseg((1.5, 1.8))   # 0.3 s visible window
    wide = _nperseg((0.6, 3.4))     # 2.8 s visible window
    # Both honour the requested 1 s / 1000-sample segment — NOT shrunk to the
    # 301-sample narrow window (the pre-decoupling behaviour).
    assert narrow == 1000
    assert wide == 1000
    assert narrow == wide


def test_spectrogram_live_narrow_window_spans_visible_range() -> None:
    """A narrow mid-tensor window yields a spectrogram whose segments span the
    *visible* [t0, t1] (cropped back from the padded compute window) — and more
    than one segment, since nperseg no longer swallows the whole window."""
    signal = _make_signal(n_time=4000, fs=1000.0)
    from tensorscope.server.state import apply_slice_request
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=1.65, freq=10.0, ap=0, ml=0),
        time_range=(1.5, 1.8),
        spectrogram_live_params=SpectrogramLiveParamsDTO(nperseg_s=1.0, noverlap_pct=95.0),
    )
    da = apply_slice_request(signal, request)
    seg_times = np.asarray(da.coords["time"].values, dtype=float)
    assert seg_times.min() >= 1.5
    assert seg_times.max() <= 1.8
    # Pre-decoupling this window collapsed to a single shrunk segment; now the
    # full 1 s segment runs over the padded window and several segments land
    # inside the 0.3 s view.
    assert da.sizes["time"] > 1


def test_spectrogram_live_noverlap_param_respected() -> None:
    """noverlap_pct is honoured (cap disabled): higher overlap → smaller hop →
    more segments, and the effective-overlap attr round-trips the request."""
    signal = _make_signal(n_time=4000, fs=1000.0)
    from tensorscope.server.state import apply_slice_request

    def _run(pct: float):
        req = TensorSliceRequestDTO(
            view_type="spectrogram_live",
            selection=SelectionDTO(time=2.0, freq=10.0, ap=0, ml=0),
            time_range=(1.0, 3.0),
            spectrogram_live_params=SpectrogramLiveParamsDTO(
                nperseg_s=1.0, noverlap_pct=pct, max_time_segments=None,
            ),
        )
        return apply_slice_request(signal, req)

    lo = _run(50.0)
    hi = _run(90.0)
    assert int(hi.attrs["spectrogram_live_n_time_segments"]) > int(
        lo.attrs["spectrogram_live_n_time_segments"]
    )
    # No cap → effective overlap equals the request.
    assert lo.attrs["spectrogram_live_segment_cap_active"] is False
    assert hi.attrs["spectrogram_live_segment_cap_active"] is False
    assert lo.attrs["spectrogram_live_noverlap_pct_effective"] == pytest.approx(50.0, abs=0.5)
    assert hi.attrs["spectrogram_live_noverlap_pct_effective"] == pytest.approx(90.0, abs=0.5)


def test_spectrogram_live_effective_overlap_attrs_when_cap_active() -> None:
    """When max_time_segments widens the hop, the effective overlap drops below
    the request and the cap-active flag flips — so the frontend can surface
    'effective overlap X% (capped from Y%)'."""
    signal = _make_signal(n_time=40_000, fs=1000.0)
    from tensorscope.server.state import apply_slice_request
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=20.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 40.0),
        spectrogram_live_params=SpectrogramLiveParamsDTO(
            nperseg_s=1.0, noverlap_pct=95.0, max_time_segments=200,
        ),
    )
    da = apply_slice_request(signal, request)
    assert da.attrs["spectrogram_live_segment_cap_active"] is True
    assert da.attrs["spectrogram_live_noverlap_pct_requested"] == pytest.approx(95.0)
    assert da.attrs["spectrogram_live_noverlap_pct_effective"] < 95.0
    # Effective fs round-trips through the meta so frontends can render
    # "computed at" chrome without re-deriving from the time coord.
    assert da.attrs["spectrogram_live_fs"] == pytest.approx(1000.0)


# ── time-segment cap ─────────────────────────────────────────────────────


def test_spectrogram_live_segment_cap_widens_hop_on_long_window() -> None:
    """A long window with high overlap would emit thousands of segments;
    max_time_segments caps the count by widening the hop. Default cap is 200."""
    signal = _make_signal(n_time=40_000, fs=1000.0)
    from tensorscope.server.state import apply_slice_request
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=20.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 40.0),
        # default max_time_segments=200, default 95% overlap → would emit ~780
    )
    da = apply_slice_request(signal, request)
    n_segs = da.attrs["spectrogram_live_n_time_segments"]
    assert n_segs <= 200
    # Cap kicked in → effective overlap dropped below the 95% request, so
    # noverlap < ceil(nperseg * 0.95).
    nperseg = da.attrs["spectrogram_live_nperseg"]
    noverlap = da.attrs["spectrogram_live_noverlap"]
    assert noverlap < int(round(nperseg * 0.95))


def test_spectrogram_live_segment_cap_passthrough_on_short_window() -> None:
    """When the natural segment count is below the cap, the cap is a no-op
    and the requested noverlap is preserved."""
    signal = _make_signal(n_time=4000, fs=1000.0)
    from tensorscope.server.state import apply_slice_request
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=2.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 4.0),
        spectrogram_live_params=SpectrogramLiveParamsDTO(
            nperseg_s=1.0, noverlap_pct=95.0, max_time_segments=200,
        ),
    )
    da = apply_slice_request(signal, request)
    n_segs = da.attrs["spectrogram_live_n_time_segments"]
    assert n_segs <= 200
    # 4 s / 0.05 s hop → ~61 segments, well below the cap → keep the 95% overlap.
    nperseg = da.attrs["spectrogram_live_nperseg"]
    noverlap = da.attrs["spectrogram_live_noverlap"]
    assert noverlap == int(round(nperseg * 0.95))


def test_spectrogram_live_segment_cap_disabled_with_none() -> None:
    """max_time_segments=None disables the cap; segment count tracks the
    natural (window, nperseg, overlap) combination."""
    signal = _make_signal(n_time=20_000, fs=1000.0)
    from tensorscope.server.state import apply_slice_request
    request = TensorSliceRequestDTO(
        view_type="spectrogram_live",
        selection=SelectionDTO(time=10.0, freq=10.0, ap=0, ml=0),
        time_range=(0.0, 20.0),
        spectrogram_live_params=SpectrogramLiveParamsDTO(
            nperseg_s=1.0, noverlap_pct=95.0, max_time_segments=None,
        ),
    )
    da = apply_slice_request(signal, request)
    # 20 s window, 1 s nperseg, 95% overlap → hop=50 ms → ~381 segments.
    n_segs = da.attrs["spectrogram_live_n_time_segments"]
    assert n_segs > 200


# ── view registry ────────────────────────────────────────────────────────


def test_spectrogram_live_available_in_views_for_grid_signal() -> None:
    """Available views advertise spectrogram_live for raw (time, AP, ML) tensors."""
    signal = _make_signal()
    state = create_server_state(signal, tensor_name="lfp")
    meta = state.tensor_meta("lfp")
    assert "spectrogram_live" in meta.available_views


def test_spectrogram_live_available_in_views_for_channel_signal() -> None:
    """Available views advertise spectrogram_live for raw (time, channel) tensors."""
    signal = _make_signal_channel()
    state = create_server_state(signal, tensor_name="lfp_ch")
    meta = state.tensor_meta("lfp_ch")
    assert "spectrogram_live" in meta.available_views
