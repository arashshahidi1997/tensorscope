"""TensorScope core event models."""

from tensorscope.core.events.model import EventStream, EventStyle
from tensorscope.core.events.registry import EventRegistry
from tensorscope.core.events.detectors import (
    EventDetector,
    DetectorParamSpec,
    ThresholdDetector,
    get_detector,
    list_detectors,
    register_detector,
)

__all__ = [
    "EventStyle",
    "EventStream",
    "EventRegistry",
    "EventDetector",
    "DetectorParamSpec",
    "ThresholdDetector",
    "get_detector",
    "list_detectors",
    "register_detector",
]
