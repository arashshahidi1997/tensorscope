from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import xarray as xr
from pydantic import ValidationError

import tensorscope
from tensorscope.core import (
    EventRegistry,
    EventStream,
    FlatLFPModality,
    GridLFPModality,
    LayoutManager,
    SelectionState,
    SpectrogramModality,
    SpikeTrainsModality,
    TensorNode,
    TensorScopeState,
    align_to_common_timebase,
    find_nearest_time_index,
    flatten_grid_to_channels,
    validate_and_normalize_grid,
)


def _grid_data() -> xr.DataArray:
    values = np.arange(24, dtype=float).reshape(4, 2, 3)
    return xr.DataArray(
        values,
        dims=("time", "AP", "ML"),
        coords={"time": [0.0, 0.5, 1.0, 1.5], "AP": [0, 1], "ML": [0, 1, 2]},
        name="lfp",
    )


def test_import() -> None:
    assert tensorscope.__name__ == "tensorscope"


def test_selection_state_validates_assignment() -> None:
    selection = SelectionState()
    selection.update(time=1.25, ap=2, channel=7, unknown_key="ignored")
    assert selection.time == 1.25
    assert selection.ap == 2
    assert selection.channel == 7

    with pytest.raises(ValidationError):
        selection.update(time=-1.0)


def test_tensor_scope_state_registry_flow() -> None:
    state = TensorScopeState()
    node = TensorNode(name="signal", data=_grid_data())
    state.tensors.add(node)
    state.set_active_tensor("signal")

    assert state.get_active_node().name == "signal"
    state.update_selection(ml=1)
    assert state.selection.ml == 1


def test_validate_and_flatten_grid_round_trip() -> None:
    grid = _grid_data().transpose("ML", "time", "AP")
    normalized = validate_and_normalize_grid(grid)
    assert normalized.dims == ("time", "AP", "ML")

    flat = flatten_grid_to_channels(normalized)
    assert flat.dims == ("time", "channel")
    np.testing.assert_array_equal(flat.coords["AP"].values, [0, 0, 0, 1, 1, 1])
    np.testing.assert_array_equal(flat.coords["ML"].values, [0, 1, 2, 0, 1, 2])

    restored = validate_and_normalize_grid(flat)
    np.testing.assert_allclose(restored.values, normalized.values)


def test_validate_and_normalize_grid_rejects_non_monotonic_time() -> None:
    data = _grid_data().assign_coords(time=[0.0, 0.5, 0.25, 1.0])
    with pytest.raises(ValueError, match="monotonically increasing"):
        validate_and_normalize_grid(data)


def test_layout_manager_serializes_current_preset() -> None:
    manager = LayoutManager(title="Demo", theme="light")
    manager.set_preset("psd_explorer")
    payload = manager.to_dict()

    assert payload["current_preset"] == "psd_explorer"
    assert "psd_explorer" in payload["grid_assignments"]


def test_event_stream_and_registry_round_trip() -> None:
    df = pd.DataFrame(
        {
            "event_id": [2, 1, 3],
            "t": [1.0, 0.5, 1.5],
            "label": ["b", "a", "c"],
        }
    )
    stream = EventStream("ripples", df)
    assert list(stream.df["event_id"]) == [1, 2, 3]
    assert stream.get_prev_event(1.0)["event_id"] == 1
    assert stream.get_next_event(1.0)["event_id"] == 3

    registry = EventRegistry()
    registry.register(stream)
    restored = EventRegistry.from_dict(registry.to_dict())
    assert restored.list() == ["ripples"]
    assert restored.get("ripples") is not None
    assert len(restored.get("ripples")) == 3


def test_modalities_cover_grid_flat_spectrogram_and_spikes() -> None:
    grid = GridLFPModality(_grid_data())
    flat = grid.to_flat()
    spec = SpectrogramModality(
        xr.DataArray(
            np.ones((4, 5, 2, 3), dtype=float),
            dims=("time", "freq", "AP", "ML"),
            coords={"time": [0.0, 0.5, 1.0, 1.5], "freq": [1, 2, 3, 4, 5], "AP": [0, 1], "ML": [0, 1, 2]},
        )
    )
    spikes = SpikeTrainsModality({"u1": np.array([0.1, 0.9, 1.7]), "u2": np.array([])})

    assert isinstance(flat, FlatLFPModality)
    assert grid.sampling_rate == pytest.approx(2.0)
    assert spec.freq_bounds() == (1.0, 5.0)
    assert spikes.time_bounds() == (0.1, 1.7)
    np.testing.assert_array_equal(spikes.get_window(0.2, 1.0)["u1"], [0.9])


def test_alignment_helpers_behave_as_expected() -> None:
    a = np.array([0.0, 0.5, 1.0])
    b = np.array([0.25, 0.75, 1.25])
    union = align_to_common_timebase([a, b], method="union")
    intersection = align_to_common_timebase([a, b], method="intersection")

    assert union[0] == pytest.approx(0.0)
    assert intersection[0] == pytest.approx(0.25)
    assert find_nearest_time_index(0.6, a) == 1
