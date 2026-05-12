"""Tests for the event_average view type (G4)."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import xarray as xr

from tensorscope.core.events import EventRegistry, EventStream
from tensorscope.server.models import (
    EventAverageParamsDTO,
    SelectionDTO,
    TensorSliceRequestDTO,
)
from tensorscope.server.state import create_server_state


FS = 1000.0
SPINDLE_FREQ = 13.0
N_CHANNELS = 4


def _make_signal_with_spindles(
    *, n_events: int = 12, spindle_duration_s: float = 0.4, seed: int = 7
) -> tuple[xr.DataArray, np.ndarray]:
    """Build (time, channel) LFP with spindle bursts at known onsets."""
    rng = np.random.default_rng(seed)
    duration_s = 30.0
    n_time = int(duration_s * FS)
    t = np.arange(n_time) / FS
    noise = rng.normal(0.0, 0.05, (n_time, N_CHANNELS))

    # Space events evenly with margin so all peri-event windows fit
    margin = 1.5
    onsets = np.linspace(margin, duration_s - margin, n_events)

    # Each spindle: 13 Hz cosine with a Hann envelope so onsets/offsets taper.
    win_samples = int(spindle_duration_s * FS)
    env = np.hanning(win_samples)
    waveform = env * np.cos(2 * np.pi * SPINDLE_FREQ * np.arange(win_samples) / FS)

    data = noise.copy()
    for onset_s in onsets:
        start = int(onset_s * FS)
        end = start + win_samples
        if end > n_time:
            continue
        data[start:end, :] += waveform[:, None]

    signal = xr.DataArray(
        data,
        dims=("time", "channel"),
        coords={"time": t, "channel": np.arange(N_CHANNELS)},
        attrs={"fs": FS},
    )
    return signal, onsets


def _make_stream(name: str, onsets: np.ndarray) -> EventStream:
    df = pd.DataFrame({"t": onsets, "event_id": np.arange(len(onsets))})
    return EventStream(name=name, df=df, time_col="t", id_col="event_id")


def _make_state(stream_name: str = "spindles") -> tuple[object, np.ndarray]:
    signal, onsets = _make_signal_with_spindles()
    events = EventRegistry()
    events.register(_make_stream(stream_name, onsets))
    state = create_server_state(signal, tensor_name="lfp", events=events)
    return state, onsets


def test_event_average_recovers_spindle_oscillation():
    """Mean across event-locked epochs should oscillate at the spindle freq."""
    state, onsets = _make_state()

    request = TensorSliceRequestDTO(
        view_type="event_average",
        selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
        event_average_params=EventAverageParamsDTO(
            event_stream_name="spindles",
            lag_window=(-0.5, 0.5),
            max_events=None,
            aggregate="mean",
            pool_channels=True,
        ),
    )

    result = state.tensor_slice("lfp", request)
    assert result.dims == ["lag"]
    assert "event_average" in result.meta
    assert result.meta["event_average"]["n_events_used"] == len(onsets)
    assert result.meta["event_average"]["aggregate"] == "mean"

    # Pull the lag axis and values back out of the v1 Arrow envelope so we
    # can verify the trace, not just the metadata.
    import base64
    import pyarrow.ipc as pa_ipc

    buf = base64.b64decode(result.payload)
    table = pa_ipc.open_stream(buf).read_all().to_pandas()
    # Aggregate duplicates (none expected for pooled) and sort by lag.
    by_lag = table.groupby("lag")["value"].mean().sort_index()
    lags = by_lag.index.to_numpy()
    vals = by_lag.to_numpy()

    # The mean trace near lag=0 should carry a 13 Hz oscillation. Take the
    # central ±200 ms and check its peak-frequency bin lines up.
    centre = (lags >= -0.2) & (lags <= 0.2)
    centre_vals = vals[centre]
    centre_lags = lags[centre]
    dt = float(np.median(np.diff(centre_lags)))
    freqs = np.fft.rfftfreq(centre_vals.size, dt)
    spectrum = np.abs(np.fft.rfft(centre_vals - centre_vals.mean()))
    peak_freq = freqs[int(np.argmax(spectrum))]
    assert abs(peak_freq - SPINDLE_FREQ) < 2.5, (
        f"expected dominant freq near {SPINDLE_FREQ} Hz; got {peak_freq:.2f}"
    )


def test_event_average_aggregates_switch():
    """mean / median / std / snr each produce a (lag,) trace of the same length."""
    state, onsets = _make_state()
    shapes: dict[str, tuple[int, ...]] = {}
    for agg in ("mean", "median", "std", "snr"):
        request = TensorSliceRequestDTO(
            view_type="event_average",
            selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
            event_average_params=EventAverageParamsDTO(
                event_stream_name="spindles",
                lag_window=(-0.5, 0.5),
                aggregate=agg,  # type: ignore[arg-type]
                pool_channels=True,
            ),
        )
        result = state.tensor_slice("lfp", request)
        assert result.dims == ["lag"]
        shapes[agg] = tuple(result.shape)
        assert result.meta["event_average"]["aggregate"] == agg
    # All four aggregators emit the same lag axis.
    assert len(set(shapes.values())) == 1


def test_event_average_max_events_caps():
    """max_events truncates the stack and reports `capped=True`."""
    state, onsets = _make_state()
    cap = 3
    request = TensorSliceRequestDTO(
        view_type="event_average",
        selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
        event_average_params=EventAverageParamsDTO(
            event_stream_name="spindles",
            lag_window=(-0.2, 0.2),
            max_events=cap,
            aggregate="mean",
            pool_channels=True,
        ),
    )
    result = state.tensor_slice("lfp", request)
    meta = result.meta["event_average"]
    assert meta["n_events_used"] == cap
    assert meta["n_events_total"] == len(onsets)
    assert meta["capped"] is True


def test_event_average_unknown_stream_raises():
    """Unknown stream name is a KeyError (→ 404 via the router error mapper)."""
    state, _ = _make_state()
    request = TensorSliceRequestDTO(
        view_type="event_average",
        selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
        event_average_params=EventAverageParamsDTO(
            event_stream_name="does-not-exist",
            lag_window=(-0.5, 0.5),
            aggregate="mean",
        ),
    )
    with pytest.raises(KeyError):
        state.tensor_slice("lfp", request)


def test_event_average_requires_params():
    """View validator rejects a request missing event_average_params."""
    with pytest.raises(ValueError):
        TensorSliceRequestDTO(
            view_type="event_average",
            selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
        )


def test_event_average_per_channel_dims():
    """Without pool_channels, the response preserves the channel axis."""
    state, _ = _make_state()
    request = TensorSliceRequestDTO(
        view_type="event_average",
        selection=SelectionDTO(time=0.0, freq=0.0, ap=0, ml=0),
        event_average_params=EventAverageParamsDTO(
            event_stream_name="spindles",
            lag_window=(-0.3, 0.3),
            aggregate="mean",
            pool_channels=False,
        ),
    )
    result = state.tensor_slice("lfp", request)
    assert result.dims[0] == "lag"
    assert "channel" in result.dims
    # Same number of channels as the source.
    chan_axis = result.dims.index("channel")
    assert result.shape[chan_axis] == N_CHANNELS


def test_event_average_in_available_views():
    """`event_average` lists in available_views for (time, channel) tensors."""
    state, _ = _make_state()
    meta = state.tensor_meta("lfp")
    assert "event_average" in meta.available_views
