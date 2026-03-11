"""Tests for the TensorScope demo-data bundle generation helper."""
# pylint: disable=redefined-outer-name  # pytest fixture pattern

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from cogpy.datasets.tensor import make_tensorscope_demo_bundle


@pytest.fixture(scope="module")
def bundle():
    # duration=6 at fs=100 gives 600 samples — enough for the multitaper nperseg
    return make_tensorscope_demo_bundle(
        duration=6.0,
        fs=100.0,
        nap=4,
        nml=4,
        n_bursts=3,
        f_min=6.0,
        f_max=24.0,
        burst_amp=1.0,
        background_noise=0.01,
        seed=42,
    )


def test_bundle_keys(bundle):
    assert set(bundle.keys()) == {"signal", "spectrogram", "events", "brainstates", "meta"}


# --- signal ---

def test_signal_dims(bundle):
    assert bundle["signal"].dims == ("time", "AP", "ML")


def test_signal_shape(bundle):
    sig = bundle["signal"]
    assert sig.sizes["AP"] == 4
    assert sig.sizes["ML"] == 4
    assert sig.sizes["time"] > 0


def test_signal_attrs(bundle):
    attrs = bundle["signal"].attrs
    assert attrs["seed"] == 42
    assert "units" in attrs
    assert "source" in attrs


# --- spectrogram ---

def test_spectrogram_dims(bundle):
    assert bundle["spectrogram"].dims == ("time", "freq", "AP", "ML")


def test_spectrogram_spatial_match(bundle):
    sig = bundle["signal"]
    spec = bundle["spectrogram"]
    assert spec.sizes["AP"] == sig.sizes["AP"]
    assert spec.sizes["ML"] == sig.sizes["ML"]


def test_spectrogram_no_nan(bundle):
    spec = bundle["spectrogram"]
    assert not np.isnan(spec.values).any()


# --- events ---

def test_events_is_dataframe(bundle):
    assert isinstance(bundle["events"], pd.DataFrame)


def test_events_columns(bundle):
    expected = {"event_id", "t", "AP", "ML", "freq", "amplitude", "label"}
    assert expected.issubset(set(bundle["events"].columns))


def test_events_count(bundle):
    # n_bursts=3 so we should get exactly 3 events
    assert len(bundle["events"]) == 3


def test_events_label(bundle):
    assert (bundle["events"]["label"] == "burst").all()


def test_events_sorted_by_t(bundle):
    t = bundle["events"]["t"].values
    assert (t[1:] >= t[:-1]).all()


# --- brainstates ---

def test_brainstates_dim(bundle):
    assert bundle["brainstates"].dims == ("time",)


def test_brainstates_time_matches_spectrogram(bundle):
    bs_time = bundle["brainstates"].coords["time"].values
    spec_time = bundle["spectrogram"].coords["time"].values
    np.testing.assert_array_equal(bs_time, spec_time)


def test_brainstates_valid_codes(bundle):
    codes = bundle["brainstates"].values
    assert set(codes).issubset({0, 1, 2})


def test_brainstates_state_names_attr(bundle):
    attrs = bundle["brainstates"].attrs
    assert "state_names" in attrs
    # stored as comma-joined string for NetCDF compatibility
    assert len(attrs["state_names"].split(",")) == 3


# --- meta ---

def test_meta_keys(bundle):
    meta = bundle["meta"]
    assert "seed" in meta
    assert "fs" in meta
    assert "files" in meta


def test_meta_files_keys(bundle):
    files = bundle["meta"]["files"]
    assert set(files.keys()) == {
        "signal.nc", "spectrogram.nc", "events.parquet", "brainstates.nc"
    }


def test_meta_shapes_match(bundle):
    files = bundle["meta"]["files"]
    assert files["signal.nc"]["shape"] == list(bundle["signal"].shape)
    assert files["spectrogram.nc"]["shape"] == list(bundle["spectrogram"].shape)


# --- determinism ---

def test_deterministic(bundle):
    """Same seed must produce identical results."""
    bundle2 = make_tensorscope_demo_bundle(
        duration=6.0,
        fs=100.0,
        nap=4,
        nml=4,
        n_bursts=3,
        f_min=6.0,
        f_max=24.0,
        burst_amp=1.0,
        background_noise=0.01,
        seed=42,
    )
    np.testing.assert_array_equal(
        bundle["signal"].values, bundle2["signal"].values
    )
    pd.testing.assert_frame_equal(
        bundle["events"].reset_index(drop=True),
        bundle2["events"].reset_index(drop=True),
    )
