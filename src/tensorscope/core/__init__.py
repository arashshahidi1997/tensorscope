"""TensorScope core — pure Python, no UI dependencies."""

from tensorscope.core.data import (
    DataModality,
    FlatLFPModality,
    GridLFPModality,
    SpectrogramModality,
    SpikeTrainsModality,
    SpikeUnit,
    align_to_common_timebase,
    find_nearest_time_index,
)
from tensorscope.core.events import EventRegistry, EventStream, EventStyle
from tensorscope.core.state import (
    SelectionState,
    TensorNode,
    TensorRegistry,
    TensorScopeState,
)
from tensorscope.core.schema import SchemaError, flatten_grid_to_channels, validate_and_normalize_grid
from tensorscope.core.layout import LayoutManager, LayoutPreset

__all__ = [
    "SelectionState",
    "TensorNode",
    "TensorRegistry",
    "TensorScopeState",
    "SchemaError",
    "validate_and_normalize_grid",
    "flatten_grid_to_channels",
    "DataModality",
    "GridLFPModality",
    "FlatLFPModality",
    "SpectrogramModality",
    "SpikeTrainsModality",
    "SpikeUnit",
    "align_to_common_timebase",
    "find_nearest_time_index",
    "EventStyle",
    "EventStream",
    "EventRegistry",
    "LayoutManager",
    "LayoutPreset",
]
