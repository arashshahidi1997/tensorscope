"""Server-side adapters over TensorScope core models."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.ipc as pa_ipc
import xarray as xr

from tensorscope.core.events import EventRegistry, EventStream
from tensorscope.core.layout import LayoutManager
from tensorscope.core.state import SelectionState, TensorNode, TensorScopeState
from tensorscope.server.models import (
    CoordSummaryDTO,
    DownsampleMethod,
    EventStreamMetaDTO,
    LayoutDTO,
    SelectionDTO,
    StateDTO,
    TensorMetaDTO,
    TensorSliceDTO,
    TensorSliceRequestDTO,
    TensorSummaryDTO,
)


_INLINE_COORD_LIMIT = 32
_VIEW_REGISTRY: dict[tuple[str, ...], list[str]] = {
    ("time", "AP", "ML"): ["timeseries", "spatial_map", "navigator"],
    ("time", "channel"): ["timeseries", "navigator"],
    ("time", "freq", "AP", "ML"): ["spectrogram", "psd_spatial"],
    ("time", "freq", "channel"): ["spectrogram", "psd_average"],
}


@dataclass
class ServerState:
    """Single-session mutable server state."""

    app_state: TensorScopeState
    layout: LayoutManager
    events: EventRegistry

    def state_dto(self, session_id: str) -> StateDTO:
        return StateDTO(
            session_id=session_id,
            active_tensor=self.app_state.active_tensor,
            selection=SelectionDTO.from_selection(self.app_state.selection),
            layout=self.layout_dto(),
            tensors=[tensor_summary(node) for node in self.iter_nodes()],
            events=[event_stream_meta(stream) for stream in self.iter_events()],
        )

    def iter_nodes(self) -> list[TensorNode]:
        return [self.app_state.tensors.get(name) for name in self.app_state.tensors.list()]

    def iter_events(self) -> list[EventStream]:
        return [self.events.get(name) for name in self.events.list() if self.events.get(name) is not None]

    def get_node(self, name: str) -> TensorNode:
        return self.app_state.tensors.get(name)

    def get_event_stream(self, name: str) -> EventStream | None:
        return self.events.get(name)

    def update_selection(self, selection: SelectionDTO) -> SelectionDTO:
        self.app_state.selection = SelectionState(**selection.model_dump())
        return SelectionDTO.from_selection(self.app_state.selection)

    def layout_dto(self) -> LayoutDTO:
        return LayoutDTO(**self.layout.to_dict())

    def set_layout_preset(self, preset: str) -> LayoutDTO:
        self.layout.set_preset(preset)
        return self.layout_dto()

    def tensor_meta(self, name: str) -> TensorMetaDTO:
        return tensor_meta(self.get_node(name))

    def tensor_slice(self, name: str, request: TensorSliceRequestDTO) -> TensorSliceDTO:
        node = self.get_node(name)
        sliced = apply_slice_request(node.data, request)
        payload = encode_arrow_payload(sliced)
        meta = {
            "coords": [coord_summary(sliced, dim).model_dump() for dim in sliced.dims if dim in sliced.coords],
            "axis_labels": list(sliced.dims),
            "units": sliced.attrs.get("units"),
            "downsampling": {
                "method": request.downsample.value,
                "max_points": request.max_points,
                "original_shape": list(node.data.shape),
                "returned_shape": list(sliced.shape),
            },
        }
        return TensorSliceDTO(
            name=name,
            view_type=request.view_type,
            dims=[str(dim) for dim in sliced.dims],
            shape=[int(size) for size in sliced.shape],
            encoding="arrow_ipc",
            payload=payload,
            meta=meta,
        )


def create_server_state(
    data: xr.DataArray,
    *,
    tensor_name: str = "signal",
    events: EventRegistry | None = None,
    layout: LayoutManager | None = None,
) -> ServerState:
    """Create a server-ready state from a single canonical tensor."""
    app_state = TensorScopeState()
    app_state.tensors.add(TensorNode(name=tensor_name, data=data))
    app_state.set_active_tensor(tensor_name)
    return ServerState(
        app_state=app_state,
        layout=layout or LayoutManager(),
        events=events or EventRegistry(),
    )


def tensor_summary(node: TensorNode) -> TensorSummaryDTO:
    return TensorSummaryDTO(
        name=node.name,
        dims=list(node.dims),
        shape=list(node.shape),
        dtype=str(node.data.dtype),
        transform=node.transform,
        source=node.source,
    )


def tensor_meta(node: TensorNode) -> TensorMetaDTO:
    return TensorMetaDTO(
        **tensor_summary(node).model_dump(),
        available_views=available_views(node.data),
        coords=[coord_summary(node.data, dim) for dim in node.data.dims if dim in node.data.coords],
    )


def event_stream_meta(stream: EventStream) -> EventStreamMetaDTO:
    return EventStreamMetaDTO(
        name=stream.name,
        time_col=stream.time_col,
        id_col=stream.id_col,
        n_events=len(stream),
        time_range=tuple(stream.to_dict()["time_range"]),
        columns=[str(col) for col in stream.df.columns],
    )


def available_views(data: xr.DataArray) -> list[str]:
    dims = tuple(str(dim) for dim in data.dims)
    return list(_VIEW_REGISTRY.get(dims, ["table"]))


def coord_summary(data: xr.DataArray, coord_name: str) -> CoordSummaryDTO:
    values = np.asarray(data.coords[coord_name].values)
    min_value = _scalar_or_none(values[0]) if values.size else None
    max_value = _scalar_or_none(values[-1]) if values.size else None
    inline_values: list[str | float | int] | None = None
    if coord_name != "time" and values.size <= _INLINE_COORD_LIMIT:
        inline_values = [_scalar_or_none(v) for v in values.tolist()]
    return CoordSummaryDTO(
        name=coord_name,
        dtype=str(values.dtype),
        length=int(values.size),
        min=min_value,
        max=max_value,
        values=inline_values,
    )


def apply_slice_request(data: xr.DataArray, request: TensorSliceRequestDTO) -> xr.DataArray:
    """Apply selection/windowing/downsampling to a tensor."""
    sliced = data

    if request.time_range is not None and "time" in sliced.dims:
        sliced = sliced.sel(time=slice(float(request.time_range[0]), float(request.time_range[1])))
    if request.freq_range is not None and "freq" in sliced.dims:
        sliced = sliced.sel(freq=slice(float(request.freq_range[0]), float(request.freq_range[1])))
    if request.channels is not None and "channel" in sliced.dims:
        sliced = sliced.isel(channel=request.channels)
    if request.ap_range is not None and "AP" in sliced.dims:
        lo, hi = request.ap_range
        sliced = sliced.isel(AP=slice(int(lo), int(hi) + 1))
    if request.ml_range is not None and "ML" in sliced.dims:
        lo, hi = request.ml_range
        sliced = sliced.isel(ML=slice(int(lo), int(hi) + 1))

    if "time" in sliced.dims and request.max_points is not None:
        sliced = downsample_time_axis(sliced, request.max_points, request.downsample)

    if sliced.sizes.get("time", 0) == 0:
        raise ValueError("slice request returned no data")
    return sliced


def downsample_time_axis(data: xr.DataArray, max_points: int, method: DownsampleMethod) -> xr.DataArray:
    """Reduce the time axis to a bounded number of points."""
    time_len = int(data.sizes.get("time", 0))
    if time_len <= max_points or method == DownsampleMethod.NONE:
        return data

    if method == DownsampleMethod.LTTB:
        indices = np.linspace(0, time_len - 1, max_points, dtype=int)
        return data.isel(time=np.unique(indices))

    # Min/max envelope doubles the point count per bucket, so cap buckets accordingly.
    bucket_count = max(1, max_points // 2)
    edges = np.linspace(0, time_len, bucket_count + 1, dtype=int)
    samples: list[xr.DataArray] = []
    for start, stop in zip(edges[:-1], edges[1:]):
        if stop <= start:
            continue
        chunk = data.isel(time=slice(int(start), int(stop)))
        if int(chunk.sizes["time"]) == 1:
            samples.append(chunk)
            continue
        mins = chunk.min(dim="time", keep_attrs=True)
        maxs = chunk.max(dim="time", keep_attrs=True)
        t_min = chunk.isel(time=0).coords["time"].values
        t_max = chunk.isel(time=-1).coords["time"].values
        mins = mins.expand_dims(time=[t_min.item() if hasattr(t_min, "item") else t_min])
        maxs = maxs.expand_dims(time=[t_max.item() if hasattr(t_max, "item") else t_max])
        samples.extend([mins, maxs])

    if not samples:
        return data.isel(time=slice(0, max_points))
    return xr.concat(samples, dim="time").sortby("time")


def encode_arrow_payload(data: xr.DataArray) -> str:
    """Serialize a slice into base64-encoded Arrow IPC bytes."""
    frame = data.to_series().rename("value").reset_index()
    table = pa.Table.from_pandas(frame, preserve_index=False)
    sink = BytesIO()
    with pa_ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return base64.b64encode(sink.getvalue()).decode("ascii")


def _scalar_or_none(value: Any) -> str | float | int | None:
    if value is None:
        return None
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value)
    return str(value)
