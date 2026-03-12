"""Server-side adapters over TensorScope core models."""

from __future__ import annotations

import base64
import logging
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
from tensorscope.core.transforms import TransformCache, TransformExecutor, TransformRegistry, WorkspaceDAG
from tensorscope.core.transforms.builtins import register_builtins
from tensorscope.core.transforms.dag import DAGTensorNode
from tensorscope.core.transforms.model import DerivedTensor
from tensorscope.server.models import (
    CoordSummaryDTO,
    DownsampleMethod,
    ElectrodeLayoutDTO,
    EventStreamMetaDTO,
    LayoutDTO,
    ProcessingParamsDTO,
    SelectionDTO,
    StateDTO,
    TensorMetaDTO,
    TensorSliceDTO,
    TensorSliceRequestDTO,
    TensorSummaryDTO,
)


_INLINE_COORD_LIMIT = 32
_VIEW_REGISTRY: dict[tuple[str, ...], list[str]] = {
    ("time", "AP", "ML"): ["timeseries", "spatial_map", "propagation_frame", "navigator", "psd_live"],
    ("time", "channel"): ["timeseries", "navigator", "psd_live"],
    ("time", "freq", "AP", "ML"): ["spectrogram", "psd_spatial"],
    ("time", "freq", "channel"): ["spectrogram", "psd_average"],
}


@dataclass
class ServerState:
    """Single-session mutable server state."""

    app_state: TensorScopeState
    layout: LayoutManager
    events: EventRegistry
    brainstates: xr.DataArray | None = None
    processing: ProcessingParamsDTO = None  # type: ignore[assignment]
    transform_registry: TransformRegistry = None  # type: ignore[assignment]
    _transform_executor: TransformExecutor = None  # type: ignore[assignment]
    _transform_cache: TransformCache = None  # type: ignore[assignment]
    _dag: WorkspaceDAG = None  # type: ignore[assignment]
    _processed_cache: dict = None  # type: ignore[assignment]  # {tensor_name: xr.DataArray}
    _processed_params_hash: str | None = None

    def __post_init__(self) -> None:
        if self.processing is None:
            self.processing = ProcessingParamsDTO()
        if self._processed_cache is None:
            self._processed_cache = {}
        if self.transform_registry is None:
            self.transform_registry = TransformRegistry()
            register_builtins(self.transform_registry)
        if self._transform_cache is None:
            self._transform_cache = TransformCache()
        if self._dag is None:
            self._dag = WorkspaceDAG()
            # Seed DAG with source tensors already in the registry.
            for name in self.app_state.tensors.list():
                node = self.app_state.tensors.get(name)
                if node.source is None and not self._dag.has_node(name):
                    self._dag.add_tensor_node(DAGTensorNode(
                        id=name, tensor_id=name, node_type="source",
                    ))
        if self._transform_executor is None:
            self._transform_executor = TransformExecutor(
                self.transform_registry,
                self.app_state.tensors,
                self._transform_cache,
                dag=self._dag,
            )

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

    def get_processing(self) -> ProcessingParamsDTO:
        return self.processing

    def set_processing(self, params: ProcessingParamsDTO) -> ProcessingParamsDTO:
        self.processing = params
        # Invalidate cache — will be lazily rebuilt on next slice request
        self._processed_cache.clear()
        self._processed_params_hash = None
        return self.processing

    def electrode_layout(self, name: str) -> ElectrodeLayoutDTO:
        """Extract electrode layout from a tensor's AP/ML coordinates.

        Raises
        ------
        KeyError
            If the tensor does not exist.
        ValueError
            If the tensor has no AP or ML coordinate.
        """
        node = self.get_node(name)
        data = node.data
        if "AP" not in data.coords or "ML" not in data.coords:
            raise ValueError(
                f"Tensor '{name}' has no AP/ML coordinates — "
                "electrode layout is only available for spatial tensors."
            )
        import numpy as np
        ap_vals = np.asarray(data.coords["AP"].values, dtype=float)
        ml_vals = np.asarray(data.coords["ML"].values, dtype=float)
        # These may be per-electrode (1D indexed by AP/ML dim) or grid coords.
        ap_unique = sorted(set(ap_vals.tolist()))
        ml_unique = sorted(set(ml_vals.tolist()))
        return ElectrodeLayoutDTO(
            n_ap=len(ap_unique),
            n_ml=len(ml_unique),
            geometry="grid",
            ap_coords=ap_unique,
            ml_coords=ml_unique,
            n_electrodes=len(ap_vals) if ap_vals.ndim == 1 else len(ap_unique) * len(ml_unique),
        )

    @property
    def dag(self) -> WorkspaceDAG:
        """Access the workspace DAG."""
        return self._dag

    def execute_transform(
        self,
        transform_name: str,
        input_names: list[str],
        params: dict[str, Any] | None = None,
        tensor_id: str | None = None,
    ) -> DerivedTensor:
        """Execute a registered transform and return the derived tensor."""
        return self._transform_executor.execute(
            transform_name=transform_name,
            input_names=input_names,
            params=params or {},
            tensor_id=tensor_id,
        )

    def _get_processed_tensor(self, name: str) -> xr.DataArray:
        """Get processed version of tensor, using cache if available."""
        node = self.get_node(name)
        params_hash = self.processing.model_dump_json()

        if self._processed_params_hash != params_hash:
            self._processed_cache.clear()
            self._processed_params_hash = params_hash

        if name not in self._processed_cache:
            try:
                processed = apply_processing(node.data, self.processing)
            except Exception as exc:  # noqa: BLE001
                logging.getLogger(__name__).warning(
                    "Processing failed on full tensor, caching raw data: %s", exc,
                )
                processed = node.data
            self._processed_cache[name] = processed

        return self._processed_cache[name]

    def tensor_slice(self, name: str, request: TensorSliceRequestDTO) -> TensorSliceDTO:
        node = self.get_node(name)
        # Use cached processed tensor if processing is active
        if self.processing and self.processing.has_any_active():
            data = self._get_processed_tensor(name)
        else:
            data = node.data
        sliced = apply_slice_request(data, request, processing=None)
        payload = encode_arrow_payload(sliced)
        meta = {
            "coords": [coord_summary(sliced, dim).model_dump() for dim in sliced.dims if dim in sliced.coords],
            "axis_labels": list(sliced.dims),
            "units": sliced.attrs.get("units"),
            "selected_time": sliced.attrs.get("selected_time"),
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
    data: xr.DataArray | dict[str, xr.DataArray],
    *,
    tensor_name: str = "signal",
    events: EventRegistry | None = None,
    layout: LayoutManager | None = None,
    brainstates: xr.DataArray | None = None,
) -> ServerState:
    """Create a server-ready state from one or more named tensors.

    Parameters
    ----------
    data
        A single DataArray (registered under ``tensor_name``) or a mapping of
        ``{name: DataArray}`` for multi-tensor sessions. The first key in a
        mapping becomes the active tensor.
    tensor_name
        Name used when ``data`` is a single DataArray.
    events
        Optional pre-populated event registry.
    layout
        Optional pre-configured layout manager.
    brainstates
        Optional 1-D ``(time,)`` DataArray of integer state codes.
        Attributes should include ``state_names`` (comma-separated label string).
    """
    app_state = TensorScopeState()
    if isinstance(data, dict):
        if not data:
            raise ValueError("data dict must contain at least one tensor")
        first_name: str | None = None
        for name, arr in data.items():
            app_state.tensors.add(TensorNode(name=str(name), data=arr))
            if first_name is None:
                first_name = str(name)
        app_state.set_active_tensor(first_name)  # type: ignore[arg-type]
    else:
        app_state.tensors.add(TensorNode(name=tensor_name, data=data))
        app_state.set_active_tensor(tensor_name)
    return ServerState(
        app_state=app_state,
        layout=layout or LayoutManager(),
        events=events or EventRegistry(),
        brainstates=brainstates,
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


def apply_slice_request(
    data: xr.DataArray,
    request: TensorSliceRequestDTO,
    processing: ProcessingParamsDTO | None = None,
) -> xr.DataArray:
    """Apply selection/windowing/downsampling to a tensor.

    Processing (if provided) is applied after time/freq windowing but before
    channel/AP/ML selection so that CMR and spatial filters see the full array.
    """
    sliced = data

    # 1. Window by time + freq first (cheap, reduces data before processing).
    if request.time_range is not None and "time" in sliced.dims:
        sliced = sliced.sel(time=slice(float(request.time_range[0]), float(request.time_range[1])))
    if request.freq_range is not None and "freq" in sliced.dims:
        sliced = sliced.sel(freq=slice(float(request.freq_range[0]), float(request.freq_range[1])))

    # 2. Apply processing pipeline on the windowed data (not the full recording).
    # A ValueError here (e.g. signal too short for the requested filter) is
    # non-fatal: fall back to unprocessed data so the view stays visible.
    if processing is not None:
        try:
            sliced = apply_processing(sliced, processing)
        except Exception as exc:  # noqa: BLE001
            logging.getLogger(__name__).warning("Processing pipeline failed, using raw data: %s", exc)

    # 2b. PSD live: compute multitaper PSD, replacing time dim with freq.
    if request.view_type == "psd_live" and "time" in sliced.dims:
        from cogpy.core.spectral.psd import psd_multitaper

        time_vals = np.asarray(sliced.coords["time"].values, dtype=float)
        fs = 1.0 / np.median(np.diff(time_vals)) if len(time_vals) > 1 else 1.0

        nw = float(request.psd_params.get("NW", 4)) if request.psd_params else 4.0
        fmax = float(request.psd_params.get("fmax", 100)) if request.psd_params else 100.0

        non_time_dims = [d for d in sliced.dims if d != "time"]

        if non_time_dims:
            reordered = sliced.transpose("time", *non_time_dims)
            arr = np.asarray(reordered.values)
            orig_shape = arr.shape[1:]
            flat = arr.reshape(arr.shape[0], -1).T  # (n_ch, time)
            psd_vals, freqs = psd_multitaper(flat, fs, NW=nw, fmax=fmax)
            # psd_vals: (n_ch, freq) -> reshape to (*orig_shape, freq) -> (freq, *orig_shape)
            psd_vals = psd_vals.reshape(*orig_shape, -1)
            psd_vals = np.moveaxis(psd_vals, -1, 0)
        else:
            arr = np.asarray(sliced.values)  # (time,)
            psd_vals, freqs = psd_multitaper(arr, fs, NW=nw, fmax=fmax)

        coords = {"freq": freqs}
        for d in non_time_dims:
            if d in sliced.coords:
                coords[d] = sliced.coords[d].values

        dims = ("freq",) + tuple(non_time_dims)
        sliced = xr.DataArray(
            psd_vals, dims=dims, coords=coords, attrs=dict(sliced.attrs),
        )

    # 3. Channel / AP / ML selection (after processing so CMR sees all channels).
    if request.channels is not None and "channel" in sliced.dims:
        sliced = sliced.isel(channel=request.channels)
    if request.ap_range is not None and "AP" in sliced.dims:
        lo, hi = request.ap_range
        sliced = sliced.isel(AP=slice(int(lo), int(hi) + 1))
    if request.ml_range is not None and "ML" in sliced.dims:
        lo, hi = request.ml_range
        sliced = sliced.isel(ML=slice(int(lo), int(hi) + 1))

    if request.view_type == "spatial_map" and "time" in sliced.dims:
        target_time = float(request.selection.time)
        sliced = sliced.sel(time=target_time, method="nearest")
        if "time" in sliced.coords:
            sliced = sliced.assign_attrs(
                {
                    **dict(sliced.attrs),
                    "selected_time": _scalar_or_none(sliced.coords["time"].values),
                }
            )

    if request.view_type == "propagation_frame" and "time" in sliced.dims:
        target_time = float(request.frame_time)  # type: ignore[arg-type]
        sliced = sliced.sel(time=target_time, method="nearest")
        if "time" in sliced.coords:
            sliced = sliced.assign_attrs(
                {
                    **dict(sliced.attrs),
                    "selected_time": _scalar_or_none(sliced.coords["time"].values),
                    "view_type": "propagation_frame",
                }
            )

    # psd_average: collapse time → mean over visible window → (freq, ...)
    if request.view_type == "psd_average" and "time" in sliced.dims:
        sliced = sliced.mean(dim="time", keep_attrs=True)

    # psd_spatial: collapse time → select freq point → (AP, ML) or (channel,)
    if request.view_type == "psd_spatial":
        if "time" in sliced.dims:
            sliced = sliced.mean(dim="time", keep_attrs=True)
        if "freq" in sliced.dims:
            target_freq = float(request.selection.freq)
            sliced = sliced.sel(freq=target_freq, method="nearest")
            if "freq" in sliced.coords:
                sliced = sliced.assign_attrs(
                    {**dict(sliced.attrs), "selected_freq": _scalar_or_none(sliced.coords["freq"].values)}
                )

    if "time" in sliced.dims and request.max_points is not None:
        sliced = downsample_time_axis(sliced, request.max_points, request.downsample)

    if request.view_type in ("timeseries", "navigator") and "time" in sliced.dims:
        sliced = zscore_offset(sliced, offset_scale=3.0)

    if "time" in sliced.dims and sliced.sizes.get("time", 0) == 0:
        raise ValueError("slice request returned no data")
    return sliced


def apply_processing(data: xr.DataArray, params: ProcessingParamsDTO) -> xr.DataArray:
    """Apply the cogpy processing pipeline to the raw tensor.

    Steps (fixed order matching cogpy v2.8):
    CMR → bandpass → notch → spatial median → z-score
    """
    from cogpy.core.preprocess.filtx import (
        bandpassx,
        cmrx,
        median_spatialx,
        notchesx,
        zscorex,
    )

    out = data

    # cogpy filter functions (bandpassx, notchesx) require an `fs` attribute.
    # Infer it from the time coordinate if not already present.
    if "fs" not in out.attrs and "time" in out.dims and "time" in out.coords:
        time_vals = np.asarray(out.coords["time"].values, dtype=float)
        if len(time_vals) > 1:
            diffs = np.diff(time_vals[:101])
            pos = diffs[diffs > 0]
            if pos.size:
                out = out.assign_attrs({**dict(out.attrs), "fs": float(1.0 / pos.mean())})

    if params.cmr and "time" in out.dims:
        out = cmrx(out)  # auto-detects channel_dims

    if params.bandpass_lo is not None and params.bandpass_hi is not None:
        if "time" in out.dims:
            out = bandpassx(out, params.bandpass_lo, params.bandpass_hi, params.bandpass_order, "time")

    if "time" in out.dims:
        notch_freqs: list[float] = []
        if params.notch_freqs_list:
            notch_freqs = [float(f) for f in params.notch_freqs_list]
        elif params.notch_freq is not None:
            notch_freqs = [params.notch_freq * (i + 1) for i in range(params.notch_harmonics)]
        if notch_freqs:
            out = notchesx(out, freqs=notch_freqs, Q=params.notch_q)

    if params.spatial_median:
        size = int(params.spatial_median_size)
        if "AP" in out.dims and "ML" in out.dims:
            out = median_spatialx(out, size=size)
        elif "channel" in out.dims and _has_ap_ml_coords(out):
            out = _median_spatial_flat(out, size=size)

    if params.zscore and "time" in out.dims:
        out = zscorex(out, dim="time", robust=params.zscore_robust)

    return out


def _has_ap_ml_coords(data: xr.DataArray) -> bool:
    """True if the (time, channel) array carries AP/ML per-channel coords."""
    try:
        return (
            "AP" in data.coords
            and "ML" in data.coords
            and data.coords["AP"].dims == ("channel",)
            and data.coords["ML"].dims == ("channel",)
        )
    except Exception:  # noqa: BLE001
        return False


def _median_spatial_flat(data: xr.DataArray, *, size: int = 3) -> xr.DataArray:
    """Spatial median for (time, channel) arrays with AP/ML per-channel coords.

    Reconstructs a dense (time, AP, ML) grid, applies median_spatialx,
    then samples back at original (AP, ML) positions.
    """
    from cogpy.core.preprocess.filtx import median_spatialx

    sig = data.transpose("time", "channel")
    ap_vals = np.asarray(sig.coords["AP"].values)
    ml_vals = np.asarray(sig.coords["ML"].values)
    ap_u = np.unique(ap_vals)
    ml_u = np.unique(ml_vals)
    ap_to_i = {v: i for i, v in enumerate(ap_u)}
    ml_to_i = {v: i for i, v in enumerate(ml_u)}

    t_len = int(sig.sizes["time"])
    vals = np.asarray(sig.values, dtype=np.float64)
    grid = np.full((t_len, len(ap_u), len(ml_u)), np.nan, dtype=np.float64)
    for ch in range(int(sig.sizes["channel"])):
        grid[:, ap_to_i[ap_vals[ch]], ml_to_i[ml_vals[ch]]] = vals[:, ch]

    grid_x = xr.DataArray(
        grid,
        dims=("time", "AP", "ML"),
        coords={"time": sig.coords["time"].values, "AP": ap_u, "ML": ml_u},
        attrs=dict(sig.attrs),
    )
    grid_f = median_spatialx(grid_x, size=size)
    grid_arr = np.asarray(grid_f.values)

    out_vals = np.empty_like(vals)
    for ch in range(int(sig.sizes["channel"])):
        out_vals[:, ch] = grid_arr[:, ap_to_i[ap_vals[ch]], ml_to_i[ml_vals[ch]]]

    return xr.DataArray(
        out_vals, dims=("time", "channel"), coords=sig.coords, attrs=dict(sig.attrs)
    ).transpose(*data.dims)


def zscore_offset(data: xr.DataArray, *, offset_scale: float = 3.0) -> xr.DataArray:
    """Z-score each channel along the time axis, then add a vertical offset for stacked display.

    Works for both ``(time, channel)`` and ``(time, AP, ML)`` layouts.
    The topmost channel (rank 0) gets the largest offset so channels read
    top-to-bottom as they appear in the sidebar (mimics cogpy v2.8 behaviour).
    """
    spatial = "AP" in data.dims and "ML" in data.dims
    channel_like = "channel" in data.dims

    if not (spatial or channel_like):
        # No channel axis — nothing to stack, just z-score along time.
        mu = data.mean(dim="time")
        sigma = data.std(dim="time")
        return (data - mu) / sigma.where(sigma > 0, other=1.0)

    if spatial:
        # Flatten AP × ML → "channel" for uniform treatment.
        stacked = data.stack(channel=("AP", "ML"))
    else:
        stacked = data  # already (time, channel)

    # Z-score each channel independently.
    mu = stacked.mean(dim="time")
    sigma = stacked.std(dim="time")
    normed = (stacked - mu) / sigma.where(sigma > 0, other=1.0)

    # Add vertical offset: channel 0 sits highest.
    n_ch = int(normed.sizes["channel"])
    ranks = np.arange(n_ch, dtype=float)
    offsets = (n_ch - 1 - ranks) * offset_scale  # shape (n_ch,)

    # Build a DataArray aligned on the channel dimension.
    ch_coord = normed.coords["channel"]
    offset_da = xr.DataArray(offsets, coords={"channel": ch_coord}, dims=["channel"])
    normed = normed + offset_da

    if spatial:
        normed = normed.unstack("channel")
        # Restore original dim order (time, AP, ML).
        normed = normed.transpose(*data.dims)

    return normed


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


def brainstate_intervals(
    bs: xr.DataArray,
    t0: float | None = None,
    t1: float | None = None,
) -> list[dict[str, Any]]:
    """Convert a 1-D brainstate DataArray into a list of interval dicts.

    Each interval has keys ``start``, ``end``, ``state`` (label string).
    Adjacent time steps with the same code are merged.  If ``t0`` / ``t1`` are
    given, only intervals overlapping that window are returned.

    The DataArray must have ``dims == ("time",)`` and an ``attrs["state_names"]``
    string of comma-separated labels.
    """
    time_vals = np.asarray(bs.coords["time"].values, dtype=float)
    codes = np.asarray(bs.values, dtype=int)
    names = [s.strip() for s in str(bs.attrs.get("state_names", "")).split(",")]

    if len(time_vals) == 0:
        return []

    # Estimate the half-step for interval boundaries
    if len(time_vals) > 1:
        dt = float(np.median(np.diff(time_vals))) / 2.0
    else:
        dt = 0.5

    intervals: list[dict[str, Any]] = []
    cur_code = int(codes[0])
    cur_start = float(time_vals[0]) - dt

    for i in range(1, len(codes)):
        if int(codes[i]) != cur_code:
            cur_end = (float(time_vals[i - 1]) + float(time_vals[i])) / 2.0
            label = names[cur_code] if cur_code < len(names) else f"state_{cur_code}"
            intervals.append({"start": cur_start, "end": cur_end, "state": label})
            cur_code = int(codes[i])
            cur_start = cur_end

    # Close the last interval
    cur_end = float(time_vals[-1]) + dt
    label = names[cur_code] if cur_code < len(names) else f"state_{cur_code}"
    intervals.append({"start": cur_start, "end": cur_end, "state": label})

    # Filter to window
    if t0 is not None and t1 is not None:
        intervals = [iv for iv in intervals if iv["end"] > t0 and iv["start"] < t1]

    return intervals


def brainstate_meta(bs: xr.DataArray) -> dict[str, Any]:
    """Return metadata about a brainstate DataArray."""
    time_vals = np.asarray(bs.coords["time"].values, dtype=float)
    names = [s.strip() for s in str(bs.attrs.get("state_names", "")).split(",")]
    return {
        "available": True,
        "state_names": names,
        "time_range": [float(time_vals[0]), float(time_vals[-1])] if len(time_vals) else [None, None],
        "n_steps": len(time_vals),
    }


def _scalar_or_none(value: Any) -> str | float | int | None:
    if value is None:
        return None
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value)
    return str(value)
