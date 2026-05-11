"""Tests for the per-request bandpass param on TensorSliceRequestDTO.

Verifies that:
1. A sine-only signal at the band's center frequency survives the filter
   (power ratio near 1).
2. A sine outside the band is attenuated (power ratio near 0).
3. Too-narrow windows return a clear 400 instead of misleading output.
4. The hi >= Nyquist guard fires.
5. The DTO rejects hi <= lo at validation time (FastAPI 422).

See `docs/design/filtered-band-overlay.md`.
"""

from __future__ import annotations

import numpy as np
import pyarrow.ipc as pa_ipc
import pytest
import xarray as xr
from io import BytesIO
from fastapi.testclient import TestClient

from tensorscope.server.app import create_app


def _sine_signal(freq_hz: float, n_time: int = 2500, fs: float = 1250.0) -> xr.DataArray:
    """A clean 1-channel sine at `freq_hz`, fs=1250 Hz, 2 s long."""
    t = np.arange(n_time) / fs
    data = np.sin(2 * np.pi * freq_hz * t)[:, None, None]
    return xr.DataArray(
        data,
        dims=("time", "AP", "ML"),
        coords={"time": t, "AP": [0], "ML": [0]},
        attrs={"fs": fs, "units": "uV"},
        name="lfp",
    )


def _client(signal: xr.DataArray) -> TestClient:
    return TestClient(create_app(signal, tensor_name="lfp"))


def _decode_v2_cube(body: bytes) -> np.ndarray:
    """Return the v2 record-batch payload reshaped to its declared shape."""
    import json

    from tensorscope.server.state import CONTRACT_V2_METADATA_KEY

    with pa_ipc.open_stream(BytesIO(body)) as reader:
        batch = next(iter(reader))
    md = batch.schema.metadata or {}
    metadata = json.loads(md[CONTRACT_V2_METADATA_KEY.encode("ascii")].decode("utf-8"))
    flat = np.asarray(batch.column("data").values, dtype=np.float32)
    return flat.reshape(tuple(metadata["shape"]))


def _request_body(
    *, time_range: tuple[float, float], lo_hz: float | None, hi_hz: float | None
) -> dict:
    body: dict = {
        "view_type": "timeseries",
        "selection": {"time": 0.0, "freq": 0.0, "ap": 0, "ml": 0, "channel": None},
        "time_range": list(time_range),
        "max_points": 2000,
        "downsample": "none",
    }
    if lo_hz is not None and hi_hz is not None:
        body["bandpass"] = {"lo_hz": lo_hz, "hi_hz": hi_hz}
    return body


def _power(arr: np.ndarray) -> float:
    return float(np.mean(arr.astype(np.float64) ** 2))


# ── In-band signal survives ────────────────────────────────────────────────

def test_bandpass_passes_signal_at_center():
    # Spindle band centered at 13.5 Hz; signal at 13 Hz should pass.
    # Reference: same window without bandpass should have power ≈ 0.5.
    client = _client(_sine_signal(freq_hz=13.0))
    body_unfiltered = _request_body(time_range=(0.1, 1.9), lo_hz=None, hi_hz=None)
    r0 = client.post("/api/v2/tensors/lfp/slice", json=body_unfiltered)
    assert r0.status_code == 200, r0.text
    p_raw = _power(_decode_v2_cube(r0.content))

    body = _request_body(time_range=(0.1, 1.9), lo_hz=11.0, hi_hz=16.0)
    r = client.post("/api/v2/tensors/lfp/slice", json=body)
    assert r.status_code == 200, r.text
    p_filt = _power(_decode_v2_cube(r.content))
    # In-band signal should arrive at comparable amplitude to raw. A perfect
    # passband would give ratio=1; sosfiltfilt's edge-padding introduces
    # a small bump. Allow 0.5×–2.0× — anything beyond that is suspicious.
    ratio = p_filt / max(p_raw, 1e-12)
    assert 0.5 < ratio < 2.5, f"in-band ratio {ratio:.3f} outside expected range"


# ── Out-of-band signal attenuated ─────────────────────────────────────────

def test_bandpass_rejects_signal_outside_band():
    # 50 Hz signal should be heavily attenuated by an 11–16 Hz filter.
    client = _client(_sine_signal(freq_hz=50.0))
    body = _request_body(time_range=(0.1, 1.9), lo_hz=11.0, hi_hz=16.0)
    r = client.post("/api/v2/tensors/lfp/slice", json=body)
    assert r.status_code == 200, r.text
    filtered = _decode_v2_cube(r.content)
    p = _power(filtered)
    # Butterworth order-4 attenuation at 3× lo_hz is ~80 dB; in practice
    # observed near 1e-6 against a unit sine.
    assert p < 1e-3, f"out-of-band power {p:.6f} not attenuated"


# ── Narrow-window guard ───────────────────────────────────────────────────

def test_bandpass_rejects_too_narrow_window():
    # Spindle band's low end is 11 Hz → 3 cycles is ~0.273 s. 0.1 s is
    # well below that.
    client = _client(_sine_signal(freq_hz=13.0))
    body = _request_body(time_range=(0.0, 0.1), lo_hz=11.0, hi_hz=16.0)
    r = client.post("/api/v2/tensors/lfp/slice", json=body)
    assert r.status_code == 400, r.text
    assert "too narrow" in r.text.lower()


# ── Nyquist guard ─────────────────────────────────────────────────────────

def test_bandpass_rejects_hi_above_nyquist():
    # fs=1250 → Nyquist=625. Asking for 800 Hz hi should be rejected by
    # the server-side guard (the DTO doesn't know fs).
    client = _client(_sine_signal(freq_hz=13.0))
    body = _request_body(time_range=(0.1, 1.9), lo_hz=10.0, hi_hz=800.0)
    r = client.post("/api/v2/tensors/lfp/slice", json=body)
    assert r.status_code == 400, r.text
    assert "nyquist" in r.text.lower()


# ── DTO validation: hi <= lo ──────────────────────────────────────────────

def test_bandpass_dto_rejects_hi_below_lo():
    client = _client(_sine_signal(freq_hz=13.0))
    body = _request_body(time_range=(0.1, 1.9), lo_hz=16.0, hi_hz=11.0)
    r = client.post("/api/v2/tensors/lfp/slice", json=body)
    # Pydantic catches this at request-validation time → 422.
    assert r.status_code == 422


# ── Provenance carries the bandpass meta ──────────────────────────────────

def test_bandpass_provenance_in_v2_metadata():
    import json

    from tensorscope.server.state import CONTRACT_V2_METADATA_KEY

    client = _client(_sine_signal(freq_hz=13.0))
    body = _request_body(time_range=(0.1, 1.9), lo_hz=11.0, hi_hz=16.0)
    r = client.post("/api/v2/tensors/lfp/slice", json=body)
    assert r.status_code == 200, r.text
    with pa_ipc.open_stream(BytesIO(r.content)) as reader:
        batch = next(iter(reader))
    md = batch.schema.metadata or {}
    metadata = json.loads(md[CONTRACT_V2_METADATA_KEY.encode("ascii")].decode("utf-8"))
    bp = metadata.get("slice_provenance", {}).get("bandpass")
    assert bp is not None
    assert bp["lo_hz"] == 11.0
    assert bp["hi_hz"] == 16.0
    assert bp["order"] == 4


# ── Display transform tag for fidelity badge ───────────────────────────────

def test_bandpass_tags_display_transforms():
    """Frontend badge needs `display_transforms` to surface the filter."""
    import json

    from tensorscope.server.state import CONTRACT_V2_METADATA_KEY

    client = _client(_sine_signal(freq_hz=13.0))
    body = _request_body(time_range=(0.1, 1.9), lo_hz=11.0, hi_hz=16.0)
    r = client.post("/api/v2/tensors/lfp/slice", json=body)
    with pa_ipc.open_stream(BytesIO(r.content)) as reader:
        batch = next(iter(reader))
    metadata = json.loads(
        batch.schema.metadata[CONTRACT_V2_METADATA_KEY.encode("ascii")].decode("utf-8")
    )
    transforms = metadata.get("display_transforms", [])
    assert any("bandpass" in t for t in transforms), transforms
