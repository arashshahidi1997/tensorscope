"""TensorScope core event models."""

from tensorscope.core.events.model import EventStream, EventStyle
from tensorscope.core.events.registry import EventRegistry
from tensorscope.core.events.detectors import (
    CogpyBurstDetector,
    CogpyRippleDetector,
    CogpySpindleDetector,
    CogpyThresholdDetector,
    DetectorParamSpec,
    EventDetector,
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
    "CogpyBurstDetector",
    "CogpyRippleDetector",
    "CogpySpindleDetector",
    "CogpyThresholdDetector",
    "get_detector",
    "list_detectors",
    "register_detector",
]
