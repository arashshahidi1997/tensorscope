"""Pydantic DTOs for the TensorScope server API."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from tensorscope.core.state import SelectionState


class DownsampleMethod(str, Enum):
    NONE = "none"
    MINMAX = "minmax"
    LTTB = "lttb"


class SelectionDTO(BaseModel):
    """Serialized selection state."""

    model_config = ConfigDict(extra="forbid")

    time: float = Field(ge=0.0)
    freq: float = Field(ge=0.0)
    ap: int = Field(ge=0)
    ml: int = Field(ge=0)
    channel: int | None = None

    @classmethod
    def from_selection(cls, selection: SelectionState) -> "SelectionDTO":
        return cls(**selection.model_dump())


class CoordSummaryDTO(BaseModel):
    """Lightweight coordinate metadata."""

    name: str
    dtype: str
    length: int = Field(ge=0)
    min: str | float | int | None = None
    max: str | float | int | None = None
    values: list[str | float | int] | None = None


class ElectrodeLayoutDTO(BaseModel):
    """Electrode spatial positions for a tensor with AP/ML dimensions.

    Returned by GET /tensors/{name}/layout.
    """

    n_ap: int = Field(ge=1)
    n_ml: int = Field(ge=1)
    geometry: str = "grid"  # "grid" | "probe" | "custom"
    ap_coords: list[float]  # sorted unique AP coordinate values
    ml_coords: list[float]  # sorted unique ML coordinate values
    n_electrodes: int = Field(ge=0)


class TensorSummaryDTO(BaseModel):
    """Summary view used by GET /state and GET /tensors."""

    name: str
    dims: list[str]
    shape: list[int]
    dtype: str
    transform: str
    source: str | None = None


class TensorMetaDTO(TensorSummaryDTO):
    """Detailed tensor metadata."""

    available_views: list[str]
    coords: list[CoordSummaryDTO]


class EventStreamMetaDTO(BaseModel):
    """Event stream metadata."""

    name: str
    time_col: str
    id_col: str
    n_events: int = Field(ge=0)
    time_range: tuple[float | None, float | None]
    columns: list[str]


class EventRecordDTO(BaseModel):
    """Single event record."""

    record: dict[str, Any]


class LayoutDTO(BaseModel):
    """Current layout descriptor."""

    title: str
    theme: str
    current_preset: str
    grid_assignments: dict[str, tuple[int, int, int, int]]
    sidebar_panels: list[str]
    available_presets: list[str]


class LayoutUpdateDTO(BaseModel):
    """Request to switch layout presets."""

    preset: str = Field(min_length=1)


class TensorSliceRequestDTO(BaseModel):
    """Slice request body."""

    model_config = ConfigDict(extra="forbid")

    view_type: str = Field(min_length=1)
    selection: SelectionDTO
    time_range: tuple[float, float] | None = None
    freq_range: tuple[float, float] | None = None
    channels: list[int] | None = None
    ap_range: tuple[int, int] | None = None
    ml_range: tuple[int, int] | None = None
    frame_time: float | None = Field(default=None, ge=0.0)
    max_points: int | None = Field(default=None, ge=1)
    downsample: DownsampleMethod = DownsampleMethod.MINMAX

    @model_validator(mode="after")
    def validate_request(self) -> "TensorSliceRequestDTO":
        # psd_average / psd_spatial may be requested against pre-computed freq-only tensors
        # that have no time dimension, so time_range is optional for those view types.
        time_required = self.view_type in {"timeseries", "navigator", "spectrogram"}
        if time_required and self.time_range is None:
            raise ValueError("time_range is required for time-based slice requests")
        if time_required and self.max_points is None:
            raise ValueError("max_points is required for time-based slice requests")

        if self.view_type == "propagation_frame" and self.frame_time is None:
            raise ValueError("frame_time is required for propagation_frame requests")

        for value in (self.time_range, self.freq_range, self.ap_range, self.ml_range):
            if value is not None and value[1] < value[0]:
                raise ValueError("range bounds must be increasing")

        return self


class TensorSliceDTO(BaseModel):
    """Arrow-backed slice response."""

    name: str
    view_type: str
    dims: list[str]
    shape: list[int]
    encoding: str
    payload: str
    meta: dict[str, Any]


class ProcessingParamsDTO(BaseModel):
    """Processing pipeline parameters (applied to raw tensor before slicing)."""

    model_config = ConfigDict(extra="forbid")

    cmr: bool = False
    bandpass_lo: float | None = Field(default=None, ge=0.1)
    bandpass_hi: float | None = Field(default=None, ge=0.1)
    bandpass_order: int = Field(default=4, ge=1, le=8)
    notch_freq: float | None = Field(default=None, ge=0.1)
    notch_harmonics: int = Field(default=3, ge=1, le=10)
    notch_freqs_list: list[float] | None = None  # explicit list mode; overrides notch_freq/harmonics
    notch_q: float = Field(default=30.0, ge=1.0)
    spatial_median: bool = False
    spatial_median_size: int = Field(default=3, ge=1, le=15)
    zscore: bool = False
    zscore_robust: bool = False

    @model_validator(mode="after")
    def validate_bandpass(self) -> "ProcessingParamsDTO":
        if self.bandpass_lo is not None and self.bandpass_hi is not None:
            if self.bandpass_hi <= self.bandpass_lo:
                raise ValueError("bandpass_hi must be greater than bandpass_lo")
        return self


class TransformParamSpecDTO(BaseModel):
    """Single transform parameter specification."""

    dtype: str
    default: Any = None
    description: str = ""
    min_value: float | None = None
    max_value: float | None = None
    choices: list[str] | None = None


class TransformDefinitionDTO(BaseModel):
    """Public view of a registered transform."""

    name: str
    description: str = ""
    required_dims: list[str]
    param_schema: dict[str, TransformParamSpecDTO]
    output_dims: list[str]
    output_dtype: str | None = None


class TransformRequestDTO(BaseModel):
    """Request to execute a transform."""

    model_config = ConfigDict(extra="forbid")

    transform_name: str = Field(min_length=1)
    input_names: list[str] = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)
    tensor_id: str | None = None


class TransformProvenanceDTO(BaseModel):
    """Provenance metadata for a derived tensor."""

    transform_name: str
    params: dict[str, Any]
    parent_ids: list[str]


class DerivedTensorDTO(BaseModel):
    """Metadata view of a derived tensor."""

    id: str
    provenance: TransformProvenanceDTO
    dims: list[str]
    shape: list[int]
    dtype: str
    status: str
    cache_key: str | None = None
    error: str | None = None


class ApiErrorDTO(BaseModel):
    """Structured API error payload."""

    code: str
    message: str
    details: dict[str, Any] | None = None


class StateDTO(BaseModel):
    """Top-level state payload."""

    session_id: str
    active_tensor: str
    selection: SelectionDTO
    layout: LayoutDTO
    tensors: list[TensorSummaryDTO]
    events: list[EventStreamMetaDTO]
