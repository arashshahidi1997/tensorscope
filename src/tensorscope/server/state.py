"""Server-side adapters over TensorScope core models."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.ipc as pa_ipc
import xarray as xr

from tensorscope.core.events import EventRegistry, EventStream
from tensorscope.core.layout import LayoutManager
from tensorscope.core.probe_layout import ProbeLayout
from tensorscope.core.state import SelectionState, TensorNode, TensorScopeState, Viewport
from tensorscope.core.transforms import TransformCache, TransformExecutor, TransformRegistry, WorkspaceDAG
from tensorscope.core.transforms.builtins import register_builtins
from tensorscope.core.transforms.dag import DAGTensorNode
from tensorscope.core.transforms.model import DerivedTensor
from tensorscope.server.models import (
    CoordSummaryDTO,
    DownsampleMethod,
    ElectrodeDTO,
    ElectrodeLayoutDTO,
    EventStreamMetaDTO,
    LayoutDTO,
    ProbeLayoutDTO,
    ProcessingParamsDTO,
    SelectionDTO,
    StateDTO,
    TensorMetaDTO,
    TensorSliceDTO,
    TensorSliceRequestDTO,
    TensorSummaryDTO,
    ViewportDTO,
)


_INLINE_COORD_LIMIT = 32
_VIEW_REGISTRY: dict[frozenset[str], list[str]] = {
    frozenset({"time", "AP", "ML"}): ["timeseries", "spatial_map", "propagation_frame", "propagation_movie", "navigator", "psd_live", "spectrogram_live", "event_average"],
    frozenset({"time", "channel"}): ["timeseries", "navigator", "psd_live", "spectrogram_live", "event_average"],
    frozenset({"time", "freq", "AP", "ML"}): ["spectrogram", "psd_spatial"],
    frozenset({"time", "freq", "channel"}): ["spectrogram", "psd_average"],
}


@dataclass
class _Subscriber:
    """One SSE subscriber: an asyncio queue plus the loop it lives on."""

    queue: asyncio.Queue
    loop: asyncio.AbstractEventLoop


@dataclass
class ServerState:
    """Single-session mutable server state."""

    app_state: TensorScopeState
    layout: LayoutManager
    events: EventRegistry
    brainstates: xr.DataArray | None = None
    # G7: per-electrode region annotations loaded from a sidecar JSON file.
    # None when no sidecar accompanied the dataset — the /probe_layout
    # endpoint returns 404 in that case and the frontend renders unchanged.
    probe_layout: ProbeLayout | None = None
    # G9: directory the dataset was loaded from. Used as the destination
    # for review-decision exports (``<dataset_dir>/review/...``). None when
    # the server was constructed from an in-memory DataArray (tests, demos)
    # — review export then returns 403.
    dataset_dir: Path | None = None
    processing: ProcessingParamsDTO = None  # type: ignore[assignment]
    transform_registry: TransformRegistry = None  # type: ignore[assignment]
    _transform_executor: TransformExecutor = None  # type: ignore[assignment]
    _transform_cache: TransformCache = None  # type: ignore[assignment]
    _dag: WorkspaceDAG = None  # type: ignore[assignment]
    _processed_cache: dict = None  # type: ignore[assignment]  # {tensor_name: xr.DataArray}
    _processed_params_hash: str | None = None
    _subscribers: list[_Subscriber] = field(default_factory=list)
    # Per-tensor channel masks (flat channel ids: ap*n_ml+ml for grid, or channel idx).
    # Stored as sorted lists rather than sets so deepcopy + JSON round-trip is stable.
    channel_masks: dict[str, list[int]] = field(default_factory=dict)
    # Status from the last processing attempt — surfaced via slice meta so the
    # frontend can flag a silent fallback. Audit F21.
    _processing_errors: dict[str, str] = field(default_factory=dict)

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
            viewport=ViewportDTO.from_viewport(self.app_state.viewport),
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

    def update_viewport(self, t_lo: float, t_hi: float) -> ViewportDTO:
        self.app_state.viewport = Viewport(time_range=(float(t_lo), float(t_hi)))
        return ViewportDTO.from_viewport(self.app_state.viewport)

    def subscribe(self, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop) -> _Subscriber:
        """Register an async subscriber that will receive published events.

        Caller is responsible for invoking ``unsubscribe`` when done.
        """
        sub = _Subscriber(queue=queue, loop=loop)
        self._subscribers.append(sub)
        return sub

    def unsubscribe(self, sub: _Subscriber) -> None:
        try:
            self._subscribers.remove(sub)
        except ValueError:
            pass

    def publish(self, event_type: str, payload: Any) -> None:
        """Broadcast an event to all subscribers. Safe to call from sync routes."""
        if not self._subscribers:
            return
        message = {"type": event_type, "payload": payload}
        for sub in list(self._subscribers):
            try:
                sub.loop.call_soon_threadsafe(sub.queue.put_nowait, message)
            except Exception:  # noqa: BLE001
                # Loop closed or queue full — drop the subscriber silently.
                self.unsubscribe(sub)

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
        self._processing_errors.clear()
        return self.processing

    def channel_mask_for(self, tensor_name: str) -> list[int]:
        """Return the masked channel ids for ``tensor_name`` (empty list if none)."""
        return list(self.channel_masks.get(tensor_name, []))

    def set_channel_mask(self, tensor_name: str, masked_ids: list[int]) -> list[int]:
        """Set the mask for one tensor.  Returns the deduplicated, sorted list."""
        # Validate the tensor exists so an agent typo doesn't silently store
        # a mask that nothing reads.
        self.app_state.tensors.get(tensor_name)  # raises if missing
        deduped = sorted({int(i) for i in masked_ids if int(i) >= 0})
        if deduped:
            self.channel_masks[tensor_name] = deduped
        else:
            self.channel_masks.pop(tensor_name, None)
        return self.channel_mask_for(tensor_name)

    def probe_layout_dto(self) -> ProbeLayoutDTO | None:
        """Serialise the loaded probe layout, or None if no sidecar was found."""
        layout = self.probe_layout
        if layout is None:
            return None
        return ProbeLayoutDTO(
            n_channels=layout.n_channels,
            electrodes=[
                ElectrodeDTO(
                    region=el.region,
                    channel_id=el.channel_id,
                    ap=el.ap,
                    ml=el.ml,
                    label=el.label,
                )
                for el in layout.electrodes
            ],
        )

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
                self._processing_errors.pop(name, None)
            except Exception as exc:  # noqa: BLE001
                logging.getLogger(__name__).warning(
                    "Processing failed on full tensor, caching raw data: %s", exc,
                )
                processed = node.data
                self._processing_errors[name] = str(exc)
            self._processed_cache[name] = processed

        return self._processed_cache[name]

    def _prepare_slice(
        self, name: str, request: TensorSliceRequestDTO
    ) -> tuple[xr.DataArray, xr.DataArray, dict[str, Any], dict[str, Any]]:
        """Run the slice handler and assemble v1/v2 metadata blobs.

        Returns ``(source_tensor, sliced, processing_meta, slice_provenance)``.
        Factored out of :meth:`tensor_slice` so the v2 raw-bytes endpoint can
        reuse the same handler chain (processing cache → apply_slice_request →
        mask) without re-serialising through the v1 long-format encoder.
        """
        node = self.get_node(name)
        processing_requested = bool(self.processing and self.processing.has_any_active())
        if processing_requested:
            data = self._get_processed_tensor(name)
        else:
            data = node.data
        processing_error = self._processing_errors.get(name)
        masked_ids = self.channel_masks.get(name, [])
        if request.view_type == "event_average":
            # event_average sources from the FULL tensor (not a time-windowed
            # view) since the lag windows are anchored at event onsets that
            # span the recording. apply_slice_request's time/freq windowing
            # and view-specific reducers don't apply here — we drop straight
            # into the dedicated epoch-stacker.
            sliced, extra_provenance = self._slice_event_average(
                data, request, masked_ids=masked_ids
            )
            processing_meta = {
                "requested": processing_requested,
                "applied": processing_requested and processing_error is None,
                "error": processing_error,
            }
            slice_provenance = {
                "method": request.downsample.value,
                "max_points": request.max_points,
                "original_shape": list(node.data.shape),
                "returned_shape": list(sliced.shape),
                "masked_ids": list(masked_ids) if masked_ids else [],
                "event_average": extra_provenance,
            }
            return node.data, sliced, processing_meta, slice_provenance
        sliced = apply_slice_request(data, request, processing=None, masked_ids=masked_ids)
        # Bandpass is applied inside apply_slice_request (before downsample /
        # zscore); it stashes its provenance here. Pop so it never leaks to
        # the client in the Arrow attrs.
        bandpass_meta: dict[str, Any] | None = sliced.attrs.pop("_bandpass_meta", None)
        processing_meta = {
            "requested": processing_requested,
            "applied": processing_requested and processing_error is None,
            "error": processing_error,
        }
        slice_provenance = {
            "method": request.downsample.value,
            "max_points": request.max_points,
            "original_shape": list(node.data.shape),
            "returned_shape": list(sliced.shape),
            "masked_ids": list(masked_ids) if masked_ids else [],
        }
        if bandpass_meta is not None:
            slice_provenance["bandpass"] = bandpass_meta
        return node.data, sliced, processing_meta, slice_provenance

    def _slice_event_average(
        self,
        data: xr.DataArray,
        request: TensorSliceRequestDTO,
        *,
        masked_ids: list[int],
    ) -> tuple[xr.DataArray, dict[str, Any]]:
        """Build an event-locked summary trace.

        Returns ``(reduced_xarray, provenance_dict)`` where ``reduced_xarray``
        has ``lag`` as its first dim (per the v2 frontend extractor contract)
        and ``provenance_dict`` records the stream name, lag window, event
        count, aggregator, and whether the request was capped.
        """
        from cogpy.brainstates.intervals import perievent_epochs
        from cogpy.triggered import (
            triggered_average,
            triggered_median,
            triggered_snr,
            triggered_std,
        )

        params = request.event_average_params
        if params is None:
            raise ValueError("event_average requires event_average_params")
        if "time" not in data.dims or "time" not in data.coords:
            raise ValueError("event_average requires a 'time' dimension with coords")

        stream = self.events.get(params.event_stream_name)
        if stream is None:
            raise KeyError(
                f"event stream '{params.event_stream_name}' is not registered"
            )
        event_times = np.asarray(stream.df[stream.time_col].values, dtype=float)

        pre = -float(params.lag_window[0])
        post = float(params.lag_window[1])
        if pre < 0 or post < 0:
            raise ValueError(
                "lag_window must straddle zero (pre = -lag_window[0] >= 0, post >= 0)"
            )

        # Cap event count BEFORE stacking — perievent_epochs allocates an
        # (n_events, ..., n_lag) cube and a 35 k-event stream against a
        # 256-channel grid would be tens of GB. First-N is intentional:
        # cheap, deterministic, and good enough for "does the mean look
        # like a spindle". Random subsampling is a future option.
        n_total = int(event_times.size)
        cap = params.max_events
        capped = cap is not None and n_total > int(cap)
        if capped:
            event_times = event_times[: int(cap)]
        n_used = int(event_times.size)
        if n_used == 0:
            raise ValueError(
                f"event stream '{params.event_stream_name}' is empty — nothing to align"
            )

        # cogpy filtering already requires `fs`; infer once from coords here
        # so the perievent helper has a clean float to consume.
        time_vals = np.asarray(data.coords["time"].values, dtype=float)
        if time_vals.size < 2:
            raise ValueError("event_average requires a tensor with >= 2 time samples")
        attr_fs = data.attrs.get("fs")
        if attr_fs is not None and float(attr_fs) > 0:
            fs = float(attr_fs)
        else:
            fs = float(1.0 / np.median(np.diff(time_vals)))

        # Mask channels BEFORE stacking. The reducers below use skipna so
        # NaN'd cells drop out of the per-event sample cleanly.
        if masked_ids:
            data = _apply_channel_mask_nan(data, masked_ids)

        epochs = perievent_epochs(
            data, event_times, fs, pre=pre, post=post, time_dim="time"
        )

        aggregate = params.aggregate
        if aggregate == "mean":
            reduced = triggered_average(epochs, event_dim="event")
        elif aggregate == "median":
            reduced = triggered_median(epochs, event_dim="event")
        elif aggregate == "std":
            reduced = triggered_std(epochs, event_dim="event")
        elif aggregate == "snr":
            reduced = triggered_snr(epochs, event_dim="event")
        else:  # pragma: no cover — validated by pydantic Literal
            raise ValueError(f"unknown aggregate '{aggregate}'")

        if not isinstance(reduced, xr.DataArray):
            # cogpy returns ndarray for ndarray input; perievent_epochs
            # produces DataArray so this path should not fire — defensive.
            reduced = xr.DataArray(
                np.asarray(reduced), dims=tuple(epochs.dims[1:])
            )

        if params.pool_channels:
            pool_dims = [d for d in reduced.dims if d != "lag"]
            if pool_dims:
                reduced = reduced.mean(dim=pool_dims, skipna=True, keep_attrs=True)

        # Frontend extractor expects 'lag' as the leading dim so the typed
        # column read is uniform across (lag,), (lag, channel), and
        # (lag, AP, ML) layouts.
        if "lag" in reduced.dims and reduced.dims[0] != "lag":
            other = [d for d in reduced.dims if d != "lag"]
            reduced = reduced.transpose("lag", *other)

        reduced = reduced.assign_attrs(
            {
                **dict(reduced.attrs),
                "event_average_stream": params.event_stream_name,
                "event_average_n_events_used": n_used,
                "event_average_n_events_total": n_total,
                "event_average_aggregate": aggregate,
                "event_average_pre_s": float(pre),
                "event_average_post_s": float(post),
                "event_average_pool_channels": bool(params.pool_channels),
            }
        )

        provenance = {
            "event_stream_name": params.event_stream_name,
            "lag_window": [float(params.lag_window[0]), float(params.lag_window[1])],
            "n_events_total": n_total,
            "n_events_used": n_used,
            "max_events": int(cap) if cap is not None else None,
            "capped": bool(capped),
            "aggregate": aggregate,
            "pool_channels": bool(params.pool_channels),
            "fs": fs,
        }
        return reduced, provenance

    def tensor_slice(self, name: str, request: TensorSliceRequestDTO) -> TensorSliceDTO:
        _, sliced, processing_meta, slice_provenance = self._prepare_slice(name, request)
        payload = encode_arrow_payload(sliced)
        # Audit F3: surface any display-only transforms applied on the server
        # so the frontend can label the Y axis honestly.
        display_transforms = list(sliced.attrs.get("display_transforms", []) or [])
        meta = {
            "coords": [coord_summary(sliced, dim).model_dump() for dim in sliced.dims if dim in sliced.coords],
            "axis_labels": list(sliced.dims),
            "units": sliced.attrs.get("units"),
            "selected_time": sliced.attrs.get("selected_time"),
            "display_transforms": display_transforms,
            # Audit F21: stop pretending processing succeeded when it didn't.
            "processing": processing_meta,
            "downsampling": {
                "method": slice_provenance["method"],
                "max_points": slice_provenance["max_points"],
                "original_shape": slice_provenance["original_shape"],
                "returned_shape": slice_provenance["returned_shape"],
            },
            # Phase 1 contract-v2: v1 ships "1.0" so a single client can
            # tell which contract a payload came from. v2 ships "2.0" in
            # the schema metadata (not in JSON meta).
            "contract_version": "1.0",
        }
        if "event_average" in slice_provenance:
            meta["event_average"] = slice_provenance["event_average"]
        return TensorSliceDTO(
            name=name,
            view_type=request.view_type,
            dims=[str(dim) for dim in sliced.dims],
            shape=[int(size) for size in sliced.shape],
            encoding="arrow_ipc",
            payload=payload,
            meta=meta,
        )

    def tensor_slice_v2_bytes(
        self, name: str, request: TensorSliceRequestDTO
    ) -> bytes:
        """Return the v2 binary slice payload (raw Arrow IPC bytes).

        Shares the slice handler with :meth:`tensor_slice` — only the encoder
        differs (labeled record batch vs long-format table). See
        :func:`encode_arrow_v2` for the wire layout.
        """
        _, sliced, processing_meta, slice_provenance = self._prepare_slice(name, request)
        return encode_arrow_v2(
            sliced,
            processing=processing_meta,
            slice_provenance=slice_provenance,
        )


def create_server_state(
    data: xr.DataArray | dict[str, xr.DataArray],
    *,
    tensor_name: str = "signal",
    events: EventRegistry | None = None,
    layout: LayoutManager | None = None,
    brainstates: xr.DataArray | None = None,
    probe_layout: ProbeLayout | None = None,
    dataset_dir: Path | None = None,
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
        probe_layout=probe_layout,
        dataset_dir=dataset_dir,
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
    dims = frozenset(str(dim) for dim in data.dims)
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


def _apply_bandpass_to_slice(
    sliced: xr.DataArray, params: Any
) -> tuple[xr.DataArray, dict[str, Any]]:
    """Apply a Butterworth zero-phase bandpass along the time axis.

    Used by `_prepare_slice` when the request carries `bandpass`. The
    filter runs on the SLICED data, not the source tensor — so the
    reviewer can flip between bands without invalidating the processing
    cache or rebuilding the DAG. See
    `docs/design/filtered-band-overlay.md`.

    Raises ValueError if the window is too narrow for the requested
    low cutoff (need ≥ 3 cycles of `lo_hz`).
    """
    if "time" not in sliced.dims:
        raise ValueError("bandpass requires a `time` dimension on the sliced output")
    time_vals = np.asarray(sliced.coords["time"].values, dtype=float)
    if time_vals.size < 4:
        raise ValueError("bandpass needs at least 4 samples in the window")
    fs = float(1.0 / np.median(np.diff(time_vals)))
    nyq = fs * 0.5
    lo = float(params.lo_hz)
    hi = float(params.hi_hz)
    if hi >= nyq:
        raise ValueError(f"hi_hz ({hi}) must be below Nyquist ({nyq:.2f})")

    window_s = float(time_vals[-1] - time_vals[0])
    min_cycles = 3.0
    if window_s * lo < min_cycles:
        raise ValueError(
            f"bandpass window too narrow: {window_s:.3f} s at {lo} Hz < "
            f"{min_cycles} cycles. Widen the window or raise lo_hz."
        )

    from scipy.signal import butter, sosfiltfilt

    sos = butter(int(params.order), [lo, hi], btype="bandpass", fs=fs, output="sos")
    axis = sliced.dims.index("time")
    # sosfiltfilt's default padlen (3 * (2*n_sections + 1)) can exceed a short
    # window and raise "input vector must be greater than padlen". Clamp it to
    # the available samples so a narrow overlay window degrades gracefully
    # instead of 500-ing.
    n_samples = int(time_vals.size)
    default_padlen = 3 * (2 * len(sos) + 1)
    padlen = min(default_padlen, n_samples - 1) if n_samples > 1 else 0
    filtered = sosfiltfilt(
        sos, np.asarray(sliced.values, dtype=np.float64), axis=axis, padlen=padlen
    )
    out = xr.DataArray(
        filtered, dims=sliced.dims, coords=sliced.coords, attrs=dict(sliced.attrs)
    )
    out.attrs["display_transforms"] = list(out.attrs.get("display_transforms", []) or []) + [
        f"bandpass({lo}-{hi} Hz)"
    ]
    meta = {"lo_hz": lo, "hi_hz": hi, "order": int(params.order), "fs": fs}
    return out, meta


def _apply_channel_mask_nan(data: xr.DataArray, masked_ids: list[int]) -> xr.DataArray:
    """Set masked cells to NaN in a tensor with (AP, ML) or (channel,) dims.

    For grid tensors the flat id is ``ap_idx * n_ml + ml_idx``. The mask is
    broadcast across all leading dims (time, freq, …) so a single (ap, ml)
    pair gets NaN'd everywhere it appears. Non-spatial tensors pass through.
    """
    if not masked_ids:
        return data
    if "AP" in data.dims and "ML" in data.dims:
        n_ap = int(data.sizes["AP"])
        n_ml = int(data.sizes["ML"])
        mask_grid = np.zeros((n_ap, n_ml), dtype=bool)
        for fid in masked_ids:
            ap, ml = divmod(int(fid), n_ml)
            if 0 <= ap < n_ap and 0 <= ml < n_ml:
                mask_grid[ap, ml] = True
        if not mask_grid.any():
            return data
        arr = np.asarray(data.values, dtype=np.float64)
        broadcast_shape = [1] * arr.ndim
        broadcast_shape[data.dims.index("AP")] = n_ap
        broadcast_shape[data.dims.index("ML")] = n_ml
        arr = np.where(mask_grid.reshape(broadcast_shape), np.nan, arr)
        return xr.DataArray(arr, dims=data.dims, coords=data.coords, attrs=data.attrs)
    if "channel" in data.dims:
        n_ch = int(data.sizes["channel"])
        ch_mask = np.zeros(n_ch, dtype=bool)
        for cid in masked_ids:
            if 0 <= int(cid) < n_ch:
                ch_mask[int(cid)] = True
        if not ch_mask.any():
            return data
        arr = np.asarray(data.values, dtype=np.float64)
        broadcast_shape = [1] * arr.ndim
        broadcast_shape[data.dims.index("channel")] = n_ch
        arr = np.where(ch_mask.reshape(broadcast_shape), np.nan, arr)
        return xr.DataArray(arr, dims=data.dims, coords=data.coords, attrs=data.attrs)
    return data


def apply_slice_request(
    data: xr.DataArray,
    request: TensorSliceRequestDTO,
    processing: ProcessingParamsDTO | None = None,
    masked_ids: list[int] | None = None,
) -> xr.DataArray:
    """Apply selection/windowing/downsampling to a tensor.

    Processing (if provided) is applied after time/freq windowing but before
    channel/AP/ML selection so that CMR and spatial filters see the full array.

    ``masked_ids`` is a flat-channel-id list of cells to exclude. For grid
    (AP, ML) tensors the id is ``ap_idx * n_ml + ml_idx``; for (channel,)
    tensors it's the channel index. The mask is applied AFTER processing
    (so CMR/notch/etc. still see the full grid) but is honoured by the
    downstream FFT and reduction paths via NaN substitution.
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

    # 2a. Apply channel mask (NaN out excluded cells). Done AFTER processing so
    # CMR / notch / spatial-median still see the full grid; downstream
    # reductions either use skipna=True (means/medians) or zero-fill before
    # FFT and re-NaN the output rows (psd_live / spectrogram_live).
    if masked_ids:
        sliced = _apply_channel_mask_nan(sliced, masked_ids)

    # 2b. PSD live: compute multitaper PSD, replacing time dim with freq.
    if request.view_type == "psd_live" and "time" in sliced.dims:
        from cogpy.spectral.psd import psd_multitaper

        from tensorscope.server.models import PsdParamsDTO

        time_vals = np.asarray(sliced.coords["time"].values, dtype=float)
        fs = 1.0 / np.median(np.diff(time_vals)) if len(time_vals) > 1 else 1.0

        psd_params = request.psd_params or PsdParamsDTO()
        mt_kwargs: dict[str, Any] = {
            "NW": psd_params.NW,
            "fmin": psd_params.fmin,
            "detrend": psd_params.detrend,
        }
        if psd_params.K is not None:
            mt_kwargs["K"] = psd_params.K
        if psd_params.fmax is not None:
            mt_kwargs["fmax"] = psd_params.fmax

        non_time_dims = [d for d in sliced.dims if d != "time"]

        if non_time_dims:
            reordered = sliced.transpose("time", *non_time_dims)
            arr = np.asarray(reordered.values)
            orig_shape = arr.shape[1:]
            flat = arr.reshape(arr.shape[0], -1).T  # (n_ch, time)
            # NaN-masked rows: zero them so cogpy's FFT is finite, then NaN
            # the corresponding output rows so reductions skip them.
            row_masked = np.isnan(flat).any(axis=1)
            if row_masked.any():
                flat = np.where(row_masked[:, None], 0.0, flat)
            psd_vals, freqs = psd_multitaper(flat, fs, **mt_kwargs)
            if row_masked.any():
                psd_vals[row_masked] = np.nan
            # psd_vals: (n_ch, freq) -> reshape to (*orig_shape, freq) -> (freq, *orig_shape)
            psd_vals = psd_vals.reshape(*orig_shape, -1)
            psd_vals = np.moveaxis(psd_vals, -1, 0)
        else:
            arr = np.asarray(sliced.values)  # (time,)
            psd_vals, freqs = psd_multitaper(arr, fs, **mt_kwargs)

        coords = {"freq": freqs}
        for d in non_time_dims:
            if d in sliced.coords:
                coords[d] = sliced.coords[d].values

        dims = ("freq",) + tuple(non_time_dims)
        sliced = xr.DataArray(
            psd_vals, dims=dims, coords=coords, attrs=dict(sliced.attrs),
        )

    # 2c. Spectrogram live: compute multitaper spectrogram, replacing time
    #     dim with (time-segments, freq). Mirrors psd_live's reshape pattern.
    #     Defaults are tuned for sleep-band LFP (Prerau-style baseline pops
    #     spindles) but every knob is overridable via SpectrogramLiveParamsDTO.
    #
    #     Note on backend choice: we call ghostipy.mtm_spectrogram directly
    #     under np.apply_along_axis, instead of cogpy.spectral.multitaper.
    #     mtm_spectrogram which wraps the same call. cogpy's wrapper checks
    #     `if dask is None` to choose between numpy and dask paths — since
    #     dask is installed in our env, it ALWAYS routes through
    #     `da.apply_along_axis` + dask's threaded scheduler, even for plain
    #     numpy input. cProfile showed ~99% of a 22 s spec_live request
    #     stuck in dask scheduler lock-wait. Direct ghostipy + numpy
    #     apply_along_axis collapses the same workload to ~150 ms.
    if request.view_type == "spectrogram_live" and "time" in sliced.dims:
        import ghostipy as gsp

        from tensorscope.server.models import SpectrogramLiveParamsDTO

        spec_params = request.spectrogram_live_params or SpectrogramLiveParamsDTO()
        time_vals = np.asarray(sliced.coords["time"].values, dtype=float)
        if len(time_vals) < 2:
            raise ValueError("spectrogram_live requires a time window with ≥2 samples")
        fs = 1.0 / float(np.median(np.diff(time_vals)))
        n_samples = len(time_vals)
        window_t0 = float(time_vals[0])

        # Narrow-window guard. ghostipy.mtm requires NW = bandwidth*nperseg/fs
        # to yield enough DPSS tapers above min_lambda=0.95; empirically NW≥2
        # (~3 tapers) is robust. Below that ghostipy raises a cryptic "None of
        # the tapers satisfied the minimum energy concentration criteria".
        #
        # Three cases worth handling differently:
        # 1. Window so small that we can't run any FFT at all → reject hard.
        # 2. Window genuinely supports the requested bandwidth → use it.
        # 3. Window too small for the *requested* bandwidth but fine for a
        #    higher one → auto-bump bandwidth to the minimum that fits,
        #    keeping the view alive during interactive zoom. Trade-off:
        #    coarser frequency resolution. Effective bandwidth is reported
        #    in the slice attrs so the frontend can surface it later.
        if n_samples < 64:
            raise ValueError(
                f"spectrogram_live: window too narrow ({n_samples} samples at "
                f"fs={fs:.1f} Hz). Need at least 64 samples for any FFT — "
                "widen the visible window."
            )
        bandwidth_min = 2.0 * fs / float(n_samples)
        bandwidth_eff = max(float(spec_params.bandwidth_hz), bandwidth_min)
        # Auto-shrink nperseg to fit the visible window when the request is
        # larger than the data — keeps the spectrogram responsive during pan.
        # Round-to-nearest (not ceil) absorbs sub-sample float jitter in `fs`
        # (computed from time-coord diffs, lands at e.g. 1249.999_999_998).
        nperseg_min = max(64, int(round(2.0 * fs / bandwidth_eff)))
        nperseg_request = int(round(spec_params.nperseg_s * fs))
        nperseg = max(nperseg_min, min(nperseg_request, n_samples))
        noverlap = int(round(nperseg * spec_params.noverlap_pct / 100.0))
        noverlap = max(0, min(noverlap, nperseg - 1))

        # Cap the segment count by widening the hop. mtm_spectrogram emits
        # `(n_samples - nperseg) // (nperseg - noverlap) + 1` segments. With
        # 95% overlap and a 60 s window at 1.25 kHz this is ~1180 segments
        # per channel × 256 channels — which the server returns fine but the
        # frontend tile path can't render in real time, and Arrow encode
        # alone runs ~16 s. Increasing the hop trades temporal resolution
        # for a tractable payload while keeping freq + spatial detail intact.
        cap = spec_params.max_time_segments
        if cap is not None and n_samples > nperseg:
            hop = nperseg - noverlap
            n_segs = (n_samples - nperseg) // hop + 1
            if n_segs > cap:
                hop_for_cap = -(-(n_samples - nperseg) // (cap - 1))  # ceil-div
                hop_for_cap = max(hop, hop_for_cap)
                noverlap = max(0, nperseg - hop_for_cap)

        non_time_dims = [d for d in sliced.dims if d != "time"]
        if non_time_dims:
            reordered = sliced.transpose(*non_time_dims, "time")
            arr = np.asarray(reordered.values, dtype=np.float64)
            orig_shape = arr.shape[:-1]
            flat = arr.reshape(-1, arr.shape[-1])  # (n_ch, T)
        else:
            flat = np.asarray(sliced.values, dtype=np.float64)[None, :]
            orig_shape = ()

        # Channel-mask: zero out NaN'd rows so ghostipy's FFT runs on finite
        # data; we'll re-NaN the corresponding output rows after the spec
        # compute so reductions skip them.
        row_masked = np.isnan(flat).any(axis=1)
        if row_masked.any():
            flat = np.where(row_masked[:, None], 0.0, flat)

        # Probe one fiber to fix the freq / time-segment shapes, then
        # parallelise the rest across channels via a thread pool.
        # ghostipy releases the GIL during FFTW + ndarray ops, so a
        # threaded fan-out gives ~3x speedup on this workload (256
        # channels) without process-fork overhead. Sequential
        # np.apply_along_axis is the fallback if the user has only
        # 1 CPU available. Per-call FFTW threads are pinned to 1 to
        # avoid oversubscription with the outer pool.
        import os
        from concurrent.futures import ThreadPoolExecutor

        mtm_kwargs = dict(
            bandwidth=bandwidth_eff,  # may have been auto-bumped above
            fs=fs,
            nperseg=nperseg,
            noverlap=noverlap,
            remove_mean=True,
            n_fft_threads=1,
        )

        def _mtspec(x: np.ndarray) -> np.ndarray:
            S, _f, _t = gsp.mtm_spectrogram(x, **mtm_kwargs)
            return S

        S0, freqs, t_centers = gsp.mtm_spectrogram(flat[0], **mtm_kwargs)
        n_workers = max(1, min(8, (os.cpu_count() or 1) - 1))
        if n_workers <= 1 or flat.shape[0] <= 4:
            mtspec = np.apply_along_axis(_mtspec, -1, flat)
        else:
            # Pre-allocate the output and write per-channel results into it
            # to avoid the np.stack copy at the end.
            mtspec = np.empty((flat.shape[0], *S0.shape), dtype=S0.dtype)
            with ThreadPoolExecutor(max_workers=n_workers) as ex:
                for i, S in enumerate(ex.map(_mtspec, flat)):
                    mtspec[i] = S
        # mtspec shape: (n_ch, n_freq, n_t_segments)
        mtspec = np.asarray(mtspec, dtype=np.float64)
        freqs = np.asarray(freqs)
        t_centers = np.asarray(t_centers)

        # Re-apply mask to the spec output (rows we zeroed for FFT input).
        if row_masked.any():
            mtspec[row_masked] = np.nan

        # Clip freq window. searchsorted(side="right") for the upper bound
        # so an exact-match fmax_hz is included.
        lo = int(np.searchsorted(freqs, spec_params.fmin_hz, side="left"))
        hi = int(np.searchsorted(freqs, spec_params.fmax_hz, side="right"))
        hi = max(hi, lo + 1)  # guarantee at least one freq row
        mtspec = mtspec[:, lo:hi, :]
        freqs = freqs[lo:hi]

        # Per-freq median baseline subtraction in log10 space (Prerau).
        # Floor at 1e-20 to keep log finite when ghostipy returns zeros at
        # the spectrum edges. nanmedian so masked channels don't drag the
        # baseline of unmasked ones.
        #
        # Skip baseline subtraction when there's only one time segment —
        # `nanmedian(axis=-1)` over a length-1 axis returns that single
        # value, so the subtraction wipes the spectrogram to all-zeros
        # and the frontend renders a uniform color (viridis at 0 = purple).
        # This fires on narrow windows (≤ nperseg_s seconds, common
        # during event drill-down in focus mode). Fall through to raw
        # log10 power instead.
        if spec_params.normalize_per_freq_median and mtspec.shape[-1] > 1:
            log_s = np.log10(np.maximum(mtspec, 1e-20))
            mtspec = log_s - np.nanmedian(log_s, axis=-1, keepdims=True)
        elif spec_params.normalize_per_freq_median:
            # Single-segment fallback: emit log10 power so the reviewer
            # at least sees the spectrum shape, even without baseline
            # normalisation.
            mtspec = np.log10(np.maximum(mtspec, 1e-20))

        # Reshape (n_ch, n_freq, n_t) → (*orig_shape, n_freq, n_t) →
        # (n_t, n_freq, *orig_shape). The frontend's extractSpectrogram
        # groups by (time, freq) and averages over remaining spatial dims.
        if orig_shape:
            mtspec = mtspec.reshape(*orig_shape, len(freqs), len(t_centers))
            # Move freq axis to position -2 → already there; move time axis to position 0.
            mtspec = np.moveaxis(mtspec, -1, 0)  # (n_t, *orig_shape, n_freq)
            mtspec = np.moveaxis(mtspec, -1, 1)  # (n_t, n_freq, *orig_shape)
        else:
            mtspec = mtspec[0].T  # (n_t, n_freq)

        # cogpy's t_centers are seconds-from-window-start; align to global time.
        global_times = t_centers + window_t0
        coords = {"time": global_times, "freq": freqs}
        for d in non_time_dims:
            if d in sliced.coords:
                coords[d] = sliced.coords[d].values

        dims = ("time", "freq") + tuple(non_time_dims)
        sliced = xr.DataArray(
            mtspec, dims=dims, coords=coords,
            attrs={
                **dict(sliced.attrs),
                "spectrogram_live_nperseg": int(nperseg),
                "spectrogram_live_noverlap": int(noverlap),
                "spectrogram_live_n_time_segments": int(len(t_centers)),
                "spectrogram_live_fs": float(fs),
                "spectrogram_live_bandwidth_hz": float(bandwidth_eff),
                "spectrogram_live_bandwidth_requested_hz": float(spec_params.bandwidth_hz),
                "spectrogram_live_bandwidth_auto_bumped": bool(bandwidth_eff > spec_params.bandwidth_hz),
                "spectrogram_live_normalized": bool(spec_params.normalize_per_freq_median),
            },
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

    # propagation_movie: keep the time axis, return N evenly-spaced frames as a
    # (time, AP, ML) cube so the frontend can preload the whole window once and
    # play back via RAF without per-frame round-trips. n_frames defaults to ~30
    # frames/s of the visible window, capped at 240 to keep payloads small.
    if request.view_type == "propagation_movie" and "time" in sliced.dims:
        time_len = int(sliced.sizes.get("time", 0))
        if time_len == 0:
            raise ValueError("propagation_movie: time window is empty")
        if request.n_frames is not None:
            n_frames = int(request.n_frames)
        elif request.time_range is not None:
            window_s = float(request.time_range[1]) - float(request.time_range[0])
            n_frames = max(1, min(240, int(round(window_s * 30.0))))
        else:
            n_frames = min(60, time_len)
        n_frames = max(1, min(n_frames, time_len))
        idx = np.linspace(0, time_len - 1, n_frames, dtype=int)
        idx = np.unique(idx)
        sliced = sliced.isel(time=idx)
        sliced = sliced.assign_attrs(
            {
                **dict(sliced.attrs),
                "view_type": "propagation_movie",
                "n_frames": int(sliced.sizes["time"]),
            }
        )

    # psd_average: collapse time → mean over visible window → (freq, ...)
    # skipna so masked-channel NaN cells don't poison the time mean for
    # unmasked spatial neighbours.
    if request.view_type == "psd_average" and "time" in sliced.dims:
        sliced = sliced.mean(dim="time", keep_attrs=True, skipna=True)

    # psd_spatial: collapse time → select freq point → (AP, ML) or (channel,)
    if request.view_type == "psd_spatial":
        if "time" in sliced.dims:
            sliced = sliced.mean(dim="time", keep_attrs=True, skipna=True)
        if "freq" in sliced.dims:
            target_freq = float(request.selection.freq)
            sliced = sliced.sel(freq=target_freq, method="nearest")
            if "freq" in sliced.coords:
                sliced = sliced.assign_attrs(
                    {**dict(sliced.attrs), "selected_freq": _scalar_or_none(sliced.coords["freq"].values)}
                )

    # z-score + stacking offset is a DISPLAY transform. Apply it on the
    # full-rate windowed data (before downsampling) so the optional bandpass
    # overlay below filters on the same per-channel scale, and so the std is
    # estimated from every sample rather than the decimated subset. Audit F3.
    if request.view_type in ("timeseries", "navigator") and "time" in sliced.dims:
        sliced = zscore_offset(sliced, offset_scale=3.0)
        prior = list(sliced.attrs.get("display_transforms", []) or [])
        sliced = sliced.assign_attrs(
            {**dict(sliced.attrs), "display_transforms": prior + ["zscore_offset(scale=3.0)"]}
        )

    # Bandpass overlay: filter the z-scored, full-rate slice BEFORE
    # downsampling. sosfiltfilt must see the true sample rate — downsampling
    # distorts the time spacing that fs is derived from. The filter also
    # removes each channel's DC (the stacking offset), leaving a zero-centred
    # band trace that the frontend re-stacks by re-adding the raw mean
    # (see TimeseriesSliceView band substitution). Meta is stashed in attrs
    # for the caller's provenance and popped before return.
    if request.bandpass is not None and "time" in sliced.dims:
        sliced, _bandpass_meta = _apply_bandpass_to_slice(sliced, request.bandpass)
        sliced.attrs["_bandpass_meta"] = _bandpass_meta

    if "time" in sliced.dims and request.max_points is not None:
        sliced = downsample_time_axis(sliced, request.max_points, request.downsample)

    if "time" in sliced.dims and sliced.sizes.get("time", 0) == 0:
        raise ValueError("slice request returned no data")
    return sliced


def apply_processing(data: xr.DataArray, params: ProcessingParamsDTO) -> xr.DataArray:
    """Apply the cogpy processing pipeline to the raw tensor.

    Steps (fixed order matching cogpy v2.8):
    CMR → bandpass → notch → spatial median → z-score
    """
    from cogpy.preprocess.filtering import (
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
    from cogpy.preprocess.filtering import median_spatialx

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
    """Reduce the time axis to a bounded number of points.

    The min/max envelope path is fully vectorized via numpy — no Python loop
    over buckets.  This is critical for large recordings (e.g. demo2) where
    the old per-bucket xr.concat loop was the dominant bottleneck.
    """
    time_len = int(data.sizes.get("time", 0))
    if time_len <= max_points or method == DownsampleMethod.NONE:
        return data

    if method == DownsampleMethod.LTTB:
        indices = np.linspace(0, time_len - 1, max_points, dtype=int)
        return data.isel(time=np.unique(indices))

    # ── Vectorized min/max envelope ──────────────────────────────────────
    bucket_count = max(1, max_points // 2)
    edges = np.linspace(0, time_len, bucket_count + 1, dtype=int)
    starts = edges[:-1]
    stops = edges[1:]
    # Remove empty buckets
    valid = stops > starts
    starts = starts[valid]
    stops = stops[valid]

    time_vals = np.asarray(data.coords["time"].values)

    # Transpose so time is axis 0, flatten the rest
    time_axis = list(data.dims).index("time")
    arr = np.moveaxis(np.asarray(data.values, dtype=np.float64), time_axis, 0)
    orig_shape = arr.shape[1:]
    flat = arr.reshape(time_len, -1)  # (time, n_features)

    n_buckets = len(starts)
    n_feat = flat.shape[1]

    # Pre-allocate output: 2 points per bucket (min time, max time)
    out_times = np.empty(n_buckets * 2, dtype=time_vals.dtype)
    out_vals = np.empty((n_buckets * 2, n_feat), dtype=np.float64)

    # Audit F5: emit each bucket's min and max envelope at real source-time
    # positions, not bucket edges.  Each FEATURE keeps its own bucket-min and
    # bucket-max (so a spike in any channel survives, not just the bucket's
    # single most-extreme one).  The output shares one time axis, which can't
    # honour every feature's extremum position simultaneously, so the two
    # emitted timestamps are anchored at the most-extreme feature's real
    # sample times — the dominant channel's peak lands exactly, and a 1 ms
    # spike near the centre of a 100 ms bucket no longer renders 50 ms off.
    feat_idx = np.arange(n_feat)
    for i in range(n_buckets):
        s, e = int(starts[i]), int(stops[i])
        chunk = flat[s:e]  # (bucket_len, n_feat)
        if chunk.shape[0] == 1:
            out_times[2 * i] = time_vals[s]
            out_times[2 * i + 1] = time_vals[s]
            out_vals[2 * i] = chunk[0]
            out_vals[2 * i + 1] = chunk[0]
        else:
            per_feat_argmin = chunk.argmin(axis=0)  # (n_feat,) local indices
            per_feat_argmax = chunk.argmax(axis=0)
            # Per-feature envelope: every channel's true min and max.
            out_vals[2 * i] = chunk[per_feat_argmin, feat_idx]
            out_vals[2 * i + 1] = chunk[per_feat_argmax, feat_idx]
            # Anchor the shared timestamps at the dominant feature's extrema.
            lead_min_feat = int(np.argmin(out_vals[2 * i]))
            lead_max_feat = int(np.argmax(out_vals[2 * i + 1]))
            out_times[2 * i] = time_vals[s + int(per_feat_argmin[lead_min_feat])]
            out_times[2 * i + 1] = time_vals[s + int(per_feat_argmax[lead_max_feat])]

    # De-duplicate consecutive identical times (from single-sample buckets)
    # and sort by time
    sort_idx = np.argsort(out_times, kind="stable")
    out_times = out_times[sort_idx]
    out_vals = out_vals[sort_idx]

    # Reshape back to original non-time dims
    out_arr = out_vals.reshape(len(out_times), *orig_shape)
    # Move time axis back to original position
    out_arr = np.moveaxis(out_arr, 0, time_axis)

    coords = dict(data.coords)
    coords["time"] = out_times
    return xr.DataArray(
        out_arr, dims=data.dims, coords=coords, attrs=dict(data.attrs),
    )


def encode_arrow_payload(data: xr.DataArray) -> str:
    """Serialize a slice into base64-encoded Arrow IPC bytes.

    Long-format columnar encoding: one row per cell, columns =
    (*data.dims, "value"). Frontend decoders (api/arrow.ts) read
    columns by name, so column order doesn't matter.

    Construction goes directly through numpy → pyarrow rather than
    `data.to_series().reset_index()` → `pa.Table.from_pandas()`. The
    pandas detour was ~4x slower on dense N-D outputs (e.g. a 4-D
    spectrogram_live slice) because `to_series()` on a MultiIndex
    materialises the whole index then `from_pandas` re-flattens it.
    """
    shape = data.shape
    arrays: list[pa.Array] = []
    fields: list[pa.Field] = []

    if data.ndim == 0:
        # Degenerate scalar — encode as a single-row table.
        arrays.append(pa.array(np.atleast_1d(data.values).ravel()))
        fields.append(pa.field("value", arrays[-1].type))
    else:
        # Per-axis index grids (ij ordering matches numpy ravel order).
        idx = np.meshgrid(
            *[np.arange(s, dtype=np.int64) for s in shape],
            indexing="ij",
        )
        for dim, ax_idx in zip(data.dims, idx):
            coord_vals = (
                np.asarray(data.coords[dim].values)
                if dim in data.coords
                else np.arange(data.sizes[dim])
            )
            col = coord_vals[ax_idx.ravel()]
            arrays.append(pa.array(col))
            fields.append(pa.field(str(dim), arrays[-1].type))
        arrays.append(pa.array(np.asarray(data.values).ravel()))
        fields.append(pa.field("value", arrays[-1].type))

    table = pa.Table.from_arrays(arrays, schema=pa.schema(fields))
    sink = BytesIO()
    with pa_ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return base64.b64encode(sink.getvalue()).decode("ascii")


# ── contract v2 wire format ─────────────────────────────────────────────────
#
# v1 encodes one row per cell (long-format). For a (time, freq, AP, ML)
# spectrogram_live cube that is ~3 M rows × 5 cols, ~56 MB on the wire after
# base64. v2 encodes the same cube as a single record batch with one row:
#
#   data:           FixedSizeList<float32, prod(shape)>  — row-major values
#   coords/<dim>:   FixedSizeList<float64|str, dim_size> — per-dim coord array
#
# Schema metadata under the `tensorscope` key holds dims/shape/dtype/units/
# attrs/display_transforms/processing/slice_provenance (per §3.1 of
# docs/design/contract-v2.md). The decoder reads metadata first to know the
# dim ordering, then reshapes data by `shape`. No per-row coord duplication,
# no base64 — the response body is raw Arrow IPC bytes.

# Canonical key under which the v2 metadata blob lives on the schema. Kept
# as a constant so the parity test and the JS decoder agree on it.
CONTRACT_V2_METADATA_KEY = "tensorscope"
CONTRACT_V2_VERSION = "2.0"

# Internal attrs we never serialise into the v2 `attrs` blob — they are
# either already represented as top-level metadata fields (display_transforms,
# selected_time) or are bookkeeping for downstream views (spectrogram_live_meta).
_V2_ATTRS_BLACKLIST: frozenset[str] = frozenset({
    "display_transforms",
    "selected_time",
    "spectrogram_live_meta",
})


def _jsonable_attr(value: Any) -> Any:
    """Coerce an xarray attr value into something json.dumps can swallow."""
    if isinstance(value, (str, bool)):
        return value
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        v = float(value)
        return v if np.isfinite(v) else None
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (list, tuple)):
        return [_jsonable_attr(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _jsonable_attr(v) for k, v in value.items()}
    return str(value)


def _coord_field(dim: str, values: np.ndarray) -> tuple[pa.Field, pa.Array]:
    """Build a single-row FixedSizeList column for one dim's coord array.

    Numeric coords go out as float64 (the broadest lossless container — the
    JS decoder turns them into a Float64Array). String/object coords go out
    as a FixedSizeList<utf8> for parity with `dim_size`. Length is always
    `dim_size`, so the FixedSizeList list_size matches the slice extent.
    """
    name = f"coords/{dim}"
    n = int(values.size)
    if values.dtype.kind in ("i", "u", "f"):
        # Plain numeric — float64 keeps every probe-coord representable.
        flat = pa.array(np.asarray(values, dtype=np.float64), type=pa.float64())
        field = pa.field(name, pa.list_(pa.float64(), list_size=n))
    else:
        # Datetime, string, object — stringify defensively. Rare for our
        # current tensors; covered so a string-keyed dim doesn't crash.
        flat = pa.array([str(v) for v in values.tolist()], type=pa.utf8())
        field = pa.field(name, pa.list_(pa.utf8(), list_size=n))
    return field, pa.FixedSizeListArray.from_arrays(flat, list_size=n)


def encode_arrow_v2(
    data: xr.DataArray,
    *,
    processing: dict[str, Any] | None = None,
    slice_provenance: dict[str, Any] | None = None,
) -> bytes:
    """Encode a slice as raw Arrow IPC bytes per the v2 wire contract.

    The output is a single-batch IPC stream (callers send it directly as the
    HTTP body — no base64, no JSON wrapper). Decoders read schema metadata
    under the ``tensorscope`` key, then unpack the FixedSizeList values
    columns. See §3.1 of docs/design/contract-v2.md.

    ``processing`` and ``slice_provenance`` are passed through the slice
    handler so the metadata blob mirrors v1's ``meta.processing`` and
    ``meta.downsampling``. They are optional — omitted means the encoder
    is being used outside the slice path (tests, future tooling).
    """
    shape = tuple(int(s) for s in data.shape)
    n_total = int(np.prod(shape)) if shape else 1

    # ── Metadata blob ───────────────────────────────────────────────────
    units = data.attrs.get("units")
    attrs_clean: dict[str, Any] = {}
    for key, value in dict(data.attrs).items():
        if key in _V2_ATTRS_BLACKLIST:
            continue
        attrs_clean[str(key)] = _jsonable_attr(value)

    display_transforms = list(data.attrs.get("display_transforms", []) or [])

    metadata: dict[str, Any] = {
        "version": CONTRACT_V2_VERSION,
        "dims": [str(d) for d in data.dims],
        "shape": list(shape),
        "dtype": "float32",
        "units": str(units) if units is not None else None,
        "attrs": attrs_clean,
        "display_transforms": display_transforms,
    }
    if processing is not None:
        metadata["processing"] = processing
    if slice_provenance is not None:
        metadata["slice_provenance"] = slice_provenance
    # selected_time is conceptually slice provenance (which sample we
    # snapped to); keep it readable at the top level for parity with v1's
    # meta.selected_time field.
    if "selected_time" in data.attrs:
        metadata["selected_time"] = _jsonable_attr(data.attrs["selected_time"])

    schema_metadata = {
        CONTRACT_V2_METADATA_KEY.encode("ascii"): json.dumps(
            metadata, separators=(",", ":"), default=str,
        ).encode("utf-8"),
    }

    # ── Field layout ────────────────────────────────────────────────────
    # data: FixedSizeList<float32, prod(shape)> with one row containing the
    # full row-major value cube. NaN survives the float32 cast.
    flat_vals = np.ascontiguousarray(data.values, dtype=np.float32).reshape(-1)
    if flat_vals.size != n_total:
        # Defensive: shape() and ravel() should agree, but if the underlying
        # array is somehow non-contiguous + odd-shaped, reshape catches it.
        raise ValueError(
            f"encode_arrow_v2: ravel mismatch (got {flat_vals.size}, expected {n_total})"
        )
    data_inner = pa.array(flat_vals, type=pa.float32())
    data_field = pa.field("data", pa.list_(pa.float32(), list_size=n_total))
    data_arr = pa.FixedSizeListArray.from_arrays(data_inner, list_size=n_total)

    fields: list[pa.Field] = [data_field]
    arrays: list[pa.Array] = [data_arr]
    for dim in data.dims:
        if dim not in data.coords:
            continue
        coord_vals = np.asarray(data.coords[dim].values)
        field, arr = _coord_field(str(dim), coord_vals)
        fields.append(field)
        arrays.append(arr)

    schema = pa.schema(fields, metadata=schema_metadata)
    batch = pa.RecordBatch.from_arrays(arrays, schema=schema)

    sink = BytesIO()
    with pa_ipc.new_stream(sink, schema) as writer:
        writer.write_batch(batch)
    return sink.getvalue()


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
