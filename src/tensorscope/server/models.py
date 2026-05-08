"""Pydantic DTOs for the TensorScope server API."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from tensorscope.core.state import SelectionState, Viewport


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


class ViewportDTO(BaseModel):
    """Serialized viewport (visible-window) state.

    Decoupled from ``SelectionDTO`` so agents can pan the visible range
    without moving the cursor, and vice versa. See the design discussion
    in ``docs/log/issue/issue-arash-20260508-142724-956601.md``.
    """

    model_config = ConfigDict(extra="forbid")

    time_range: tuple[float, float] | None = None

    @classmethod
    def from_viewport(cls, viewport: Viewport) -> "ViewportDTO":
        return cls(**viewport.model_dump())


class ViewportUpdateDTO(BaseModel):
    """Request body for PUT /viewport.

    Either supply ``t_lo`` + ``t_hi`` directly, or ``t_center`` + ``t_window``
    for the centered-window convenience form. The two forms are mutually
    exclusive — one or the other.
    """

    model_config = ConfigDict(extra="forbid")

    t_lo: float | None = None
    t_hi: float | None = None
    t_center: float | None = Field(default=None, ge=0.0)
    t_window: float | None = Field(default=None, gt=0.0)

    def resolve(self) -> tuple[float, float]:
        """Return ``(t_lo, t_hi)``, computed from whichever form was supplied."""
        explicit = self.t_lo is not None and self.t_hi is not None
        centered = self.t_center is not None and self.t_window is not None
        if explicit and centered:
            raise ValueError(
                "specify either (t_lo, t_hi) or (t_center, t_window), not both"
            )
        if explicit:
            assert self.t_lo is not None and self.t_hi is not None
            t_lo, t_hi = float(self.t_lo), float(self.t_hi)
        elif centered:
            assert self.t_center is not None and self.t_window is not None
            half = float(self.t_window) / 2.0
            t_lo = max(0.0, float(self.t_center) - half)
            t_hi = float(self.t_center) + half
        else:
            raise ValueError(
                "set_viewport requires either (t_lo, t_hi) or (t_center, t_window)"
            )
        if t_hi <= t_lo:
            raise ValueError("t_hi must be greater than t_lo")
        return t_lo, t_hi


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


class SpectrogramLiveParamsDTO(BaseModel):
    """Multitaper spectrogram parameters for the ``spectrogram_live`` view.

    Mirrors the kwargs of ``cogpy.spectral.multitaper.mtm_spectrogram``
    (which wraps ghostipy.mtm_spectrogram) plus a Prerau-style per-freq
    median-baseline normalization that makes spindles and bursts pop on
    spectrogram heatmaps.

    All times are in seconds, all frequencies in Hz. The server resolves
    ``nperseg_s`` and ``noverlap_pct`` to sample counts using the tensor's
    inferred ``fs`` at request time.

    Narrow-window guard: if the visible window is shorter than
    ``nperseg_s``, the server auto-shrinks ``nperseg`` to fit (with a
    floor of 64 samples) and reports the effective settings in the
    slice meta. This trades a momentary resolution drop for graceful
    behaviour during fine-grained pan / zoom; see
    ``docs/log/issue/issue-arash-20260508-142724-956601.md`` for the
    interactive-pan use case driving this choice.
    """

    model_config = ConfigDict(extra="forbid")

    bandwidth_hz: float = Field(default=2.0, gt=0.0, description="Multitaper bandwidth (Hz).")
    nperseg_s: float = Field(default=1.0, gt=0.0, description="Window length (s); converted to samples via fs.")
    noverlap_pct: float = Field(default=95.0, ge=0.0, lt=100.0, description="Inter-window overlap as a percentage of nperseg.")
    fmin_hz: float = Field(default=0.5, ge=0.0, description="Lower freq bound (Hz); rows below are clipped.")
    fmax_hz: float = Field(default=30.0, gt=0.0, description="Upper freq bound (Hz); rows above are clipped.")
    normalize_per_freq_median: bool = Field(
        default=True,
        description=(
            "If True, subtract the median over time-segments per freq row "
            "(in log10 power) — Prerau-style baseline subtraction."
        ),
    )

    @model_validator(mode="after")
    def _check_freq_range(self) -> "SpectrogramLiveParamsDTO":
        if self.fmax_hz <= self.fmin_hz:
            raise ValueError("fmax_hz must be greater than fmin_hz")
        return self


class PsdParamsDTO(BaseModel):
    """Multitaper PSD parameters.

    Mirrors the kwargs of ``cogpy.spectral.psd.psd_multitaper``. Field names
    match cogpy exactly so the server can forward them verbatim.
    """

    model_config = ConfigDict(extra="forbid")

    NW: float = Field(default=4.0, ge=0.5, description="Time-bandwidth product")
    K: int | None = Field(
        default=None, ge=1, description="Number of tapers (defaults to int(2*NW-1))"
    )
    fmin: float = Field(
        default=1.0,
        ge=0.0,
        description="Minimum frequency (Hz). Default 1.0 hides DC/sub-Hz drift; pass 0.0 to include them.",
    )
    fmax: float | None = Field(
        default=None, ge=0.1, description="Maximum frequency (Hz); None = Nyquist"
    )
    detrend: bool = Field(
        default=True, description="Remove linear trend before tapering"
    )


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
    psd_params: PsdParamsDTO | None = None
    spectrogram_live_params: SpectrogramLiveParamsDTO | None = None

    @model_validator(mode="after")
    def validate_request(self) -> "TensorSliceRequestDTO":
        # psd_average / psd_spatial may be requested against pre-computed freq-only tensors
        # that have no time dimension, so time_range is optional for those view types.
        time_required = self.view_type in {"timeseries", "navigator", "spectrogram"}
        if time_required and self.time_range is None:
            raise ValueError("time_range is required for time-based slice requests")
        if time_required and self.max_points is None:
            raise ValueError("max_points is required for time-based slice requests")

        # spectrogram_live needs a window but doesn't downsample over time
        # (mtm_spectrogram already produces a bounded segment count).
        if self.view_type == "spectrogram_live" and self.time_range is None:
            raise ValueError("time_range is required for spectrogram_live requests")

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

    enabled: bool = True
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

    def has_any_active(self) -> bool:
        """True if processing is enabled and at least one step is active."""
        if not self.enabled:
            return False
        return (
            self.cmr
            or self.bandpass_lo is not None
            or self.notch_freq is not None
            or bool(self.notch_freqs_list)
            or self.spatial_median
            or self.zscore
        )

    @model_validator(mode="after")
    def validate_bandpass(self) -> "ProcessingParamsDTO":
        if self.bandpass_lo is not None and self.bandpass_hi is not None:
            if self.bandpass_hi <= self.bandpass_lo:
                raise ValueError("bandpass_hi must be greater than bandpass_lo")
        return self


class TransformParamSpecDTO(BaseModel):
    """Single transform parameter specification.

    ``required`` distinguishes "must be supplied" (``required=True``, ``default``
    is ``None`` because no fallback exists) from "optional, library default"
    (``required=False``, ``default=None``) and "optional with fallback"
    (``required=False``, ``default=value``).
    """

    dtype: str
    default: Any = None
    required: bool = False
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


class DAGTensorNodeDTO(BaseModel):
    """Tensor node in the workspace DAG."""

    id: str
    tensor_id: str
    node_type: str  # "source" | "derived"
    visible: bool = True
    exploratory: bool = False
    pipeline_selected: bool = False
    display_name: str = ""


class DAGTransformNodeDTO(BaseModel):
    """Transform node in the workspace DAG."""

    id: str
    transform_name: str
    params: dict[str, Any] = Field(default_factory=dict)
    status: str = "pending"  # "pending" | "computed" | "error"
    error: str | None = None


class TransformEdgeDTO(BaseModel):
    """Directed edge in the workspace DAG."""

    source_id: str
    target_id: str
    edge_type: str  # "input" | "output"


class ProvenanceStepDTO(BaseModel):
    """One step in a provenance chain."""

    input_tensor_id: str
    transform_name: str
    params: dict[str, Any]
    output_tensor_id: str


class WorkspaceDAGDTO(BaseModel):
    """Full workspace DAG serialization."""

    tensor_nodes: list[DAGTensorNodeDTO]
    transform_nodes: list[DAGTransformNodeDTO]
    edges: list[TransformEdgeDTO]


class DAGNodeVisibilityDTO(BaseModel):
    """Request to update tensor node visibility/exploratory state."""

    model_config = ConfigDict(extra="forbid")

    visible: bool | None = None
    exploratory: bool | None = None


class DetectorParamSpecDTO(BaseModel):
    """Single detector parameter specification."""
    dtype: str
    default: Any = None
    description: str = ""
    min_value: float | None = None
    max_value: float | None = None
    choices: list[str] | None = None


class DetectorDefinitionDTO(BaseModel):
    """Public view of a registered detector."""
    name: str
    description: str = ""
    param_schema: dict[str, DetectorParamSpecDTO]


class DetectRequestDTO(BaseModel):
    """Request to run an event detector."""
    model_config = ConfigDict(extra="forbid")

    detector_name: str = Field(min_length=1)
    tensor_name: str = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)
    stream_name: str | None = None  # optional override for the output stream name


class DetectResultDTO(BaseModel):
    """Result of running a detector."""
    stream_name: str
    n_events: int
    detector_name: str


class ApiErrorDTO(BaseModel):
    """Structured API error payload."""

    code: str
    message: str
    details: dict[str, Any] | None = None


class TensorPostDTO(BaseModel):
    """Body for POST /tensors — runtime tensor injection.

    ``payload`` follows the envelope defined in
    ``tensorscope.pairing.wire.dataarray_to_payload``.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    payload: dict[str, Any]
    source: str | None = None
    transform: str = "signal"
    params: dict[str, Any] = Field(default_factory=dict)


class EventStreamPostDTO(BaseModel):
    """Body for POST /events — runtime event-stream injection.

    ``df_b64`` is base64-encoded parquet bytes (see
    ``tensorscope.pairing.wire.dataframe_to_b64``).
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    df_b64: str
    time_col: str = "t"
    id_col: str = "event_id"
    style: dict[str, Any] | None = None


class StateDTO(BaseModel):
    """Top-level state payload."""

    session_id: str
    active_tensor: str
    selection: SelectionDTO
    viewport: ViewportDTO = ViewportDTO()
    layout: LayoutDTO
    tensors: list[TensorSummaryDTO]
    events: list[EventStreamMetaDTO]


# --- Pipeline DTOs (M6) ---

class PipelineSourceTensorDTO(BaseModel):
    tensor_id: str
    data_ref: str = ""

class PipelineTransformNodeDTO(BaseModel):
    node_id: str
    transform_name: str
    params: dict[str, Any] = {}
    inputs: list[str] = []
    output: str = ""

class PipelineDerivedTensorDTO(BaseModel):
    tensor_id: str
    dims: list[str] = []
    dtype: str = ""

class ExecutionMetadataDTO(BaseModel):
    created_at: str = ""
    session_id: str = ""
    description: str = ""

class PipelineSpecDTO(BaseModel):
    version: str = "1.0"
    name: str = ""
    id: str = ""
    source_tensors: list[PipelineSourceTensorDTO] = []
    transforms: list[PipelineTransformNodeDTO] = []
    derived_tensors: list[PipelineDerivedTensorDTO] = []
    outputs: list[str] = []
    execution_metadata: ExecutionMetadataDTO = ExecutionMetadataDTO()
    cooker_profile: str | None = None

class PipelineExportRequestDTO(BaseModel):
    output_tensor_ids: list[str]
    name: str = ""
    cooker_profile: str | None = None
    description: str = ""

class WorkflowArtifactDTO(BaseModel):
    filename: str
    content: str

class PipelineExportResponseDTO(BaseModel):
    spec: PipelineSpecDTO
    workflow_artifacts: list[WorkflowArtifactDTO] = []


class PipelineImportRequestDTO(BaseModel):
    """Import a serialised pipeline and replay its transforms.

    ``content`` carries the raw text of a previously exported pipeline
    (JSON or YAML). ``format`` selects the parser; "auto" infers from the
    leading non-whitespace character.
    """
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    format: str = Field(default="auto")  # "json" | "yaml" | "auto"
    skip_existing: bool = True


class PipelineImportResponseDTO(BaseModel):
    spec: PipelineSpecDTO
    executed: list[str] = []
    skipped: list[str] = []
    errors: dict[str, str] = {}
