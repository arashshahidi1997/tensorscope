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
