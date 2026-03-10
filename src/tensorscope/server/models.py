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
    max_points: int | None = Field(default=None, ge=1)
    downsample: DownsampleMethod = DownsampleMethod.MINMAX

    @model_validator(mode="after")
    def validate_request(self) -> "TensorSliceRequestDTO":
        time_like = self.view_type in {"timeseries", "navigator", "spectrogram", "psd_average", "psd_spatial"}
        if time_like and self.time_range is None:
            raise ValueError("time_range is required for time-based slice requests")
        if time_like and self.max_points is None:
            raise ValueError("max_points is required for time-based slice requests")

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
