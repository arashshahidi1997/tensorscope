"""Event detector framework for TensorScope."""
from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
import xarray as xr

from tensorscope.core.events.model import EventStream, EventStyle


@dataclass(frozen=True, slots=True)
class DetectorParamSpec:
    """Describes one parameter of a detector."""
    dtype: str  # "float", "int", "str", "bool"
    default: Any = None
    description: str = ""
    min_value: float | None = None
    max_value: float | None = None
    choices: list[str] | None = None


class EventDetector(ABC):
    """Base class for all event detectors."""
    name: str = ""
    description: str = ""
    param_schema: dict[str, DetectorParamSpec] = {}

    @abstractmethod
    def detect(self, data: xr.DataArray, params: dict[str, Any]) -> EventStream:
        """Run detection on a tensor and return an EventStream."""
        ...

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "param_schema": {
                k: {
                    "dtype": v.dtype,
                    "default": v.default,
                    "description": v.description,
                    "min_value": v.min_value,
                    "max_value": v.max_value,
                    "choices": v.choices,
                }
                for k, v in self.param_schema.items()
            },
        }


class ThresholdDetector(EventDetector):
    """Detects events where a channel's value exceeds a threshold."""
    name = "threshold"
    description = "Mark events where signal exceeds an absolute threshold."
    param_schema = {
        "threshold": DetectorParamSpec(dtype="float", default=3.0, description="Threshold value (in data units or z-score units)"),
        "direction": DetectorParamSpec(dtype="str", default="above", description="Trigger direction", choices=["above", "below", "both"]),
        "min_duration": DetectorParamSpec(dtype="float", default=0.0, description="Minimum event duration (seconds)", min_value=0.0),
        "merge_gap": DetectorParamSpec(dtype="float", default=0.01, description="Merge events closer than this (seconds)", min_value=0.0),
    }

    def detect(self, data: xr.DataArray, params: dict[str, Any]) -> EventStream:
        threshold = float(params.get("threshold", 3.0))
        direction = str(params.get("direction", "above"))
        min_duration = float(params.get("min_duration", 0.0))
        merge_gap = float(params.get("merge_gap", 0.01))

        if "time" not in data.dims:
            raise ValueError("ThresholdDetector requires a 'time' dimension")

        # Collapse spatial dims to get a single timeseries (max across channels)
        reduced = data
        for dim in list(data.dims):
            if dim != "time":
                reduced = reduced.max(dim=dim)

        time_vals = np.asarray(reduced.coords["time"].values, dtype=float)
        values = np.asarray(reduced.values, dtype=float)

        # Apply threshold
        if direction == "above":
            mask = values > threshold
        elif direction == "below":
            mask = values < -threshold
        else:  # both
            mask = np.abs(values) > threshold

        # Find contiguous regions
        events = []
        in_event = False
        event_start = 0.0
        event_peak_val = 0.0
        event_peak_time = 0.0

        for i, (t, v, m) in enumerate(zip(time_vals, values, mask)):
            if m and not in_event:
                in_event = True
                event_start = float(t)
                event_peak_val = float(v)
                event_peak_time = float(t)
            elif m and in_event:
                if abs(float(v)) > abs(event_peak_val):
                    event_peak_val = float(v)
                    event_peak_time = float(t)
            elif not m and in_event:
                in_event = False
                duration = float(t) - event_start
                if duration >= min_duration:
                    events.append({
                        "t": event_peak_time,
                        "event_start": event_start,
                        "event_end": float(t),
                        "duration": duration,
                        "peak_value": event_peak_val,
                    })

        # Close last event
        if in_event:
            duration = float(time_vals[-1]) - event_start
            if duration >= min_duration:
                events.append({
                    "t": event_peak_time,
                    "event_start": event_start,
                    "event_end": float(time_vals[-1]),
                    "duration": duration,
                    "peak_value": event_peak_val,
                })

        # Merge events closer than merge_gap
        if merge_gap > 0 and len(events) > 1:
            merged = [events[0]]
            for ev in events[1:]:
                prev = merged[-1]
                if ev["event_start"] - prev["event_end"] < merge_gap:
                    # Merge: extend end, pick higher peak
                    prev["event_end"] = ev["event_end"]
                    prev["duration"] = prev["event_end"] - prev["event_start"]
                    if abs(ev["peak_value"]) > abs(prev["peak_value"]):
                        prev["peak_value"] = ev["peak_value"]
                        prev["t"] = ev["t"]
                else:
                    merged.append(ev)
            events = merged

        # Add event IDs
        for i, ev in enumerate(events):
            ev["event_id"] = f"threshold_{i}"

        df = pd.DataFrame(events) if events else pd.DataFrame(columns=["t", "event_id", "event_start", "event_end", "duration", "peak_value"])

        stream_name = f"threshold_{uuid.uuid4().hex[:8]}"
        return EventStream(
            name=stream_name,
            df=df,
            style=EventStyle(color="#ff6b35", marker="triangle", alpha=0.9),
        )


# --- cogpy-backed detectors ----------------------------------------------
#
# These thin wrappers adapt the class-based detectors in ``cogpy.detect`` to
# TensorScope's instance-based ``EventDetector`` interface. The cogpy
# detectors produce ``EventCatalog`` objects; we map the underlying
# DataFrame onto an ``EventStream`` and pick a stream name/style here.


def _ensure_fs(data: xr.DataArray) -> xr.DataArray:
    """Attach an `fs` attr inferred from the time coord if missing.

    cogpy's ripple/spindle/burst detectors require a sampling-frequency
    attribute; tensor datasets loaded via xarray often only carry the time
    coordinate.
    """
    if "fs" in data.attrs or "time" not in data.dims or "time" not in data.coords:
        return data
    time_vals = np.asarray(data.coords["time"].values, dtype=float)
    if time_vals.size < 2:
        return data
    diffs = np.diff(time_vals[:101])
    pos = diffs[diffs > 0]
    if pos.size == 0:
        return data
    return data.assign_attrs({**dict(data.attrs), "fs": float(1.0 / pos.mean())})


def _catalog_to_stream(
    catalog: Any,
    *,
    name_prefix: str,
    color: str,
) -> EventStream:
    """Convert a ``cogpy.events.EventCatalog`` to a TensorScope ``EventStream``."""
    df = catalog.df.copy() if hasattr(catalog, "df") else pd.DataFrame(catalog)
    if "t" not in df.columns:
        raise ValueError(f"{name_prefix}: catalog missing 't' column")
    if "event_id" not in df.columns:
        df["event_id"] = [f"{name_prefix}_{i:06d}" for i in range(len(df))]
    stream_name = f"{name_prefix}_{uuid.uuid4().hex[:8]}"
    return EventStream(
        name=stream_name,
        df=df,
        style=EventStyle(color=color, marker="triangle", alpha=0.85),
    )


class CogpyRippleDetector(EventDetector):
    """Ripple detector (``cogpy.detect.RippleDetector``): bandpass→envelope→z-score."""

    name = "cogpy_ripple"
    description = "Ripples via cogpy (bandpass + Hilbert envelope + dual threshold)."
    param_schema = {
        "freq_lo": DetectorParamSpec(dtype="float", default=100.0, description="Bandpass low (Hz)", min_value=0.1),
        "freq_hi": DetectorParamSpec(dtype="float", default=250.0, description="Bandpass high (Hz)", min_value=0.1),
        "threshold_low": DetectorParamSpec(dtype="float", default=2.0, description="Lower z-score threshold"),
        "threshold_high": DetectorParamSpec(dtype="float", default=3.0, description="Upper z-score threshold"),
        "min_duration": DetectorParamSpec(dtype="float", default=0.02, description="Minimum duration (s)", min_value=0.0),
        "max_duration": DetectorParamSpec(dtype="float", default=0.2, description="Maximum duration (s)", min_value=0.0),
        "filter_order": DetectorParamSpec(dtype="int", default=4, description="Butterworth order", min_value=1, max_value=8),
    }

    def detect(self, data: xr.DataArray, params: dict[str, Any]) -> EventStream:
        from cogpy.detect import RippleDetector

        det = RippleDetector(
            freq_range=(
                float(params.get("freq_lo", 100.0)),
                float(params.get("freq_hi", 250.0)),
            ),
            threshold_low=float(params.get("threshold_low", 2.0)),
            threshold_high=float(params.get("threshold_high", 3.0)),
            min_duration=float(params.get("min_duration", 0.02)),
            max_duration=float(params.get("max_duration", 0.2)),
            filter_order=int(params.get("filter_order", 4)),
        )
        return _catalog_to_stream(det.detect(_ensure_fs(data)), name_prefix="ripple", color="#4e9bff")


class CogpySpindleDetector(EventDetector):
    """Spindle detector (``cogpy.detect.SpindleDetector``): sigma-band ripples."""

    name = "cogpy_spindle"
    description = "Sleep spindles via cogpy (11–16 Hz bandpass + envelope + threshold)."
    param_schema = {
        "freq_lo": DetectorParamSpec(dtype="float", default=11.0, description="Bandpass low (Hz)", min_value=0.1),
        "freq_hi": DetectorParamSpec(dtype="float", default=16.0, description="Bandpass high (Hz)", min_value=0.1),
        "threshold_low": DetectorParamSpec(dtype="float", default=2.0, description="Lower z-score threshold"),
        "threshold_high": DetectorParamSpec(dtype="float", default=3.0, description="Upper z-score threshold"),
        "min_duration": DetectorParamSpec(dtype="float", default=0.5, description="Minimum duration (s)", min_value=0.0),
        "max_duration": DetectorParamSpec(dtype="float", default=3.0, description="Maximum duration (s)", min_value=0.0),
        "filter_order": DetectorParamSpec(dtype="int", default=4, description="Butterworth order", min_value=1, max_value=8),
        # Enrichment: emit extra per-event properties (peak frequency, relative
        # band power, waveform symmetry) so the event-filter UI has more numeric
        # columns to threshold on. On by default — spindles are sparse so the
        # added cost is negligible. See event-filtering-plan.md E4.
        "compute_frequency": DetectorParamSpec(dtype="bool", default=True, description="Emit per-event peak frequency (Hz)."),
        "compute_rel_power": DetectorParamSpec(dtype="bool", default=True, description="Emit relative sigma-band power."),
        "compute_symmetry": DetectorParamSpec(dtype="bool", default=True, description="Emit waveform symmetry."),
    }

    def detect(self, data: xr.DataArray, params: dict[str, Any]) -> EventStream:
        from cogpy.detect import SpindleDetector

        det = SpindleDetector(
            freq_range=(
                float(params.get("freq_lo", 11.0)),
                float(params.get("freq_hi", 16.0)),
            ),
            threshold_low=float(params.get("threshold_low", 2.0)),
            threshold_high=float(params.get("threshold_high", 3.0)),
            min_duration=float(params.get("min_duration", 0.5)),
            max_duration=float(params.get("max_duration", 3.0)),
            filter_order=int(params.get("filter_order", 4)),
            compute_frequency=bool(params.get("compute_frequency", True)),
            compute_rel_power=bool(params.get("compute_rel_power", True)),
            compute_symmetry=bool(params.get("compute_symmetry", True)),
        )
        return _catalog_to_stream(det.detect(_ensure_fs(data)), name_prefix="spindle", color="#b388ff")


class CogpySlowWaveDetector(EventDetector):
    """Slow-wave / SO detector (``cogpy.detect.SlowWaveDetector``).

    Negative-going cortical slow waves (down-states) detected by zero-crossing
    segmentation + amplitude/duration criteria. Emits a rich set of filterable
    properties (``amplitude``, ``duration``, ``duration_neg``, ``frequency``,
    ``val_trough``, ``val_peak``, ``state``) — the canonical SO source that was
    missing from the in-repo detectors. See event-filtering-plan.md E4.
    """

    name = "cogpy_slowwave"
    description = "Cortical slow waves / SO via cogpy (0.5–4 Hz, amplitude + duration criteria)."
    param_schema = {
        "freq_lo": DetectorParamSpec(dtype="float", default=0.5, description="Bandpass low (Hz)", min_value=0.01),
        "freq_hi": DetectorParamSpec(dtype="float", default=4.0, description="Bandpass high (Hz)", min_value=0.1),
        "dur_neg_lo": DetectorParamSpec(dtype="float", default=0.08, description="Min negative-deflection duration (s)", min_value=0.0),
        "dur_neg_hi": DetectorParamSpec(dtype="float", default=1.0, description="Max negative-deflection duration (s)", min_value=0.0),
        "dur_cycle_lo": DetectorParamSpec(dtype="float", default=0.3, description="Min full-cycle duration (s)", min_value=0.0),
        "dur_cycle_hi": DetectorParamSpec(dtype="float", default=1.5, description="Max full-cycle duration (s)", min_value=0.0),
        "amp_ptp_percentile": DetectorParamSpec(dtype="float", default=25.0, description="Peak-to-peak amplitude percentile gate", min_value=0.0, max_value=100.0),
        "filter_order": DetectorParamSpec(dtype="int", default=4, description="Butterworth order", min_value=1, max_value=8),
    }

    def detect(self, data: xr.DataArray, params: dict[str, Any]) -> EventStream:
        from cogpy.detect import SlowWaveDetector

        det = SlowWaveDetector(
            freq_range=(
                float(params.get("freq_lo", 0.5)),
                float(params.get("freq_hi", 4.0)),
            ),
            dur_neg=(
                float(params.get("dur_neg_lo", 0.08)),
                float(params.get("dur_neg_hi", 1.0)),
            ),
            dur_cycle=(
                float(params.get("dur_cycle_lo", 0.3)),
                float(params.get("dur_cycle_hi", 1.5)),
            ),
            amp_ptp_percentile=float(params.get("amp_ptp_percentile", 25.0)),
            filter_order=int(params.get("filter_order", 4)),
        )
        return _catalog_to_stream(det.detect(_ensure_fs(data)), name_prefix="slowwave", color="#26a69a")


class CogpyBurstDetector(EventDetector):
    """Burst detector (``cogpy.detect.BurstDetector``): h-maxima on spectrograms."""

    name = "cogpy_burst"
    description = "Burst peaks via cogpy (h-maxima on multitaper spectrogram)."
    param_schema = {
        "h_quantile": DetectorParamSpec(dtype="float", default=0.9, description="Height quantile", min_value=0.0, max_value=1.0),
        "nperseg": DetectorParamSpec(dtype="int", default=256, description="Spectrogram window (samples)", min_value=16),
        "noverlap": DetectorParamSpec(dtype="int", default=128, description="Spectrogram overlap (samples)", min_value=0),
        "bandwidth": DetectorParamSpec(dtype="float", default=4.0, description="Multitaper bandwidth (Hz)", min_value=0.1),
    }

    def detect(self, data: xr.DataArray, params: dict[str, Any]) -> EventStream:
        from cogpy.detect import BurstDetector

        det = BurstDetector(
            h_quantile=float(params.get("h_quantile", 0.9)),
            nperseg=int(params.get("nperseg", 256)),
            noverlap=int(params.get("noverlap", 128)),
            bandwidth=float(params.get("bandwidth", 4.0)),
        )
        return _catalog_to_stream(det.detect(_ensure_fs(data)), name_prefix="burst", color="#ff6b6b")


class CogpyThresholdDetector(EventDetector):
    """Threshold detector (``cogpy.detect.ThresholdDetector``): threshold crossings."""

    name = "cogpy_threshold"
    description = "Threshold crossings via cogpy (optional bandpass + envelope)."
    param_schema = {
        "threshold": DetectorParamSpec(dtype="float", default=3.0, description="Threshold value"),
        "direction": DetectorParamSpec(
            dtype="str", default="both", description="Direction", choices=["positive", "negative", "both"]
        ),
        "bandpass_lo": DetectorParamSpec(dtype="float", default=None, description="Optional bandpass low (Hz)"),
        "bandpass_hi": DetectorParamSpec(dtype="float", default=None, description="Optional bandpass high (Hz)"),
        "use_envelope": DetectorParamSpec(dtype="bool", default=False, description="Hilbert envelope pre-threshold"),
        "min_duration": DetectorParamSpec(dtype="float", default=0.0, description="Minimum duration (s)", min_value=0.0),
        "merge_gap": DetectorParamSpec(dtype="float", default=0.0, description="Merge events within this gap (s)", min_value=0.0),
        "filter_order": DetectorParamSpec(dtype="int", default=4, description="Bandpass order", min_value=1, max_value=8),
    }

    def detect(self, data: xr.DataArray, params: dict[str, Any]) -> EventStream:
        from cogpy.detect import ThresholdDetector as _CogpyThreshold

        bp_lo = params.get("bandpass_lo")
        bp_hi = params.get("bandpass_hi")
        bandpass = (
            (float(bp_lo), float(bp_hi))
            if bp_lo is not None and bp_hi is not None
            else None
        )
        det = _CogpyThreshold(
            threshold=float(params.get("threshold", 3.0)),
            direction=str(params.get("direction", "both")),
            bandpass=bandpass,
            use_envelope=bool(params.get("use_envelope", False)),
            min_duration=float(params.get("min_duration", 0.0)),
            merge_gap=float(params.get("merge_gap", 0.0)),
            filter_order=int(params.get("filter_order", 4)),
        )
        return _catalog_to_stream(det.detect(_ensure_fs(data)), name_prefix="cogpy_thresh", color="#ff6b35")


# --- Detector Registry ---

_DETECTOR_REGISTRY: dict[str, EventDetector] = {}


def register_detector(detector: EventDetector) -> None:
    """Register a detector instance."""
    _DETECTOR_REGISTRY[detector.name] = detector


def get_detector(name: str) -> EventDetector | None:
    """Look up a detector by name."""
    return _DETECTOR_REGISTRY.get(name)


def list_detectors() -> list[EventDetector]:
    """Return all registered detectors."""
    return list(_DETECTOR_REGISTRY.values())


# Register built-in detectors
register_detector(ThresholdDetector())
register_detector(CogpyRippleDetector())
register_detector(CogpySpindleDetector())
register_detector(CogpySlowWaveDetector())
register_detector(CogpyBurstDetector())
register_detector(CogpyThresholdDetector())
