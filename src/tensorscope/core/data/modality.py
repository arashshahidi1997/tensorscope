"""Abstract data modality interface for TensorScope."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class DataModality(ABC):
    """Abstract base class for TensorScope data modalities."""

    @abstractmethod
    def time_bounds(self) -> tuple[float, float]:
        """Return valid time bounds in seconds."""

    @abstractmethod
    def get_window(self, t0: float, t1: float) -> Any:
        """Return data inside the inclusive time window."""

    @property
    @abstractmethod
    def sampling_rate(self) -> float | None:
        """Nominal sampling rate in Hz, or None for irregular sampling."""

    @property
    @abstractmethod
    def modality_type(self) -> str:
        """Stable modality type identifier."""

    def to_dict(self) -> dict:
        return {
            "type": self.modality_type,
            "time_bounds": self.time_bounds(),
            "sampling_rate": self.sampling_rate,
        }
